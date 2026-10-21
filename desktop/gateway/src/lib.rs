//! WebMix Stream Gateway (Rust)
//!
//! รับวิดีโอ WebM จากหน้า WebMix ผ่าน WebSocket เข้ารหัสด้วย FFmpeg ครั้งเดียว (H.264 + AAC, MPEG-TS)
//! แล้วกระจายไปหลายปลายทาง RTMP/RTMPS/SRT พร้อมกัน — โปรโตคอลเดียวกับ `server/stream-gateway.js`
//!
//!   client → { "type": "start", "destinations": [{ "id", "name", "url" }] }
//!   client → { "type": "add", "destination": { "id", "name", "url" } }
//!   client → { "type": "stop", "id": "…" }
//!   server → { "type": "status", "destinations": [{ "id", "name", "state", "message", "kbps", "lag" }], "encoder": { "speed", "fps" } | null }
//!
//! พารามิเตอร์ของ URL: fps, vb (kbps), res (ความสูง) · vcopy=1 = วิดีโอที่ส่งมาเป็น H.264 อยู่แล้ว (เช่นจาก WebCodecs
//! ด้วยชิปของมือถือ) → ใช้ต่อได้เลยไม่เข้ารหัสซ้ำ เข้ารหัสเฉพาะเสียงเป็น AAC
//!
//! ใช้ในแอปเดสก์ท็อป (ทำงานในเครื่องเดียวกับหน้า WebMix — ไม่ต้องมีเซิร์ฟเวอร์) และรันแยกเป็นโปรแกรม `webmix-gateway` ได้

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

const MAX_KBPS: u32 = 51_000;
const RETRY: Duration = Duration::from_secs(5);
/// ข้อมูลที่ค้างส่งไปปลายทางที่ช้าได้สูงสุดกี่ชิ้น (เกินแล้วทิ้ง ไม่ให้หน่วยความจำบวม)
const DEST_QUEUE: usize = 512;

#[derive(Clone, Debug)]
pub struct Config {
    /// ที่อยู่ที่รับการเชื่อมต่อ (แอปเดสก์ท็อปใช้ 127.0.0.1)
    pub bind: IpAddr,
    /// 0 = ให้ระบบเลือกพอร์ตว่าง
    pub port: u16,
    /// ถ้าไม่ว่าง ไคลเอนต์ต้องส่ง ?token=… ให้ตรง (กันเว็บอื่นในเครื่องสั่งสตรีม)
    pub token: String,
    pub ffmpeg: String,
    pub max_destinations: usize,
    /// libx264 | h264_nvenc | h264_qsv | h264_videotoolbox | h264_amf | h264_mediacodec (Android)
    pub video_encoder: String,
    pub x264_preset: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            bind: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 0,
            token: String::new(),
            ffmpeg: "ffmpeg".into(),
            max_destinations: 6,
            video_encoder: "libx264".into(),
            x264_preset: String::new(),
        }
    }
}

/// Gateway ที่เปิดอยู่: พอร์ตจริงและ token
#[derive(Clone, Debug)]
pub struct Handle {
    pub addr: SocketAddr,
    pub token: String,
    pub srt_supported: bool,
    /// ตัวเข้ารหัสวิดีโอที่ใช้ (libx264 / h264_nvenc / h264_mediacodec …)
    pub encoder: String,
}

impl Handle {
    /// URL สำหรับใส่ในหน้า WebMix
    pub fn url(&self) -> String {
        let host = if self.addr.ip().is_unspecified() { "127.0.0.1".to_string() } else { self.addr.ip().to_string() };
        if self.token.is_empty() {
            format!("ws://{}:{}/", host, self.addr.port())
        } else {
            format!("ws://{}:{}/?token={}", host, self.addr.port(), self.token)
        }
    }
}

/// ตรวจว่ามี ffmpeg และรองรับ SRT หรือไม่: คืน (เวอร์ชัน, รองรับ SRT)
pub async fn probe_ffmpeg(ffmpeg: &str) -> Option<(String, bool)> {
    let version = quiet(Command::new(ffmpeg).args(["-hide_banner", "-version"])).output().await.ok()?;
    if !version.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&version.stdout).lines().next().unwrap_or("").to_string();
    let protocols = quiet(Command::new(ffmpeg).args(["-hide_banner", "-protocols"])).output().await.ok();
    let srt = protocols
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().any(|l| l.trim() == "srt"))
        .unwrap_or(false);
    Some((first, srt))
}

/// สรุปข้อผิดพลาดของ ffmpeg ปลายทาง: บรรทัดสุดท้ายมักเป็นข้อความกว้าง ๆ ("Error opening output files: I/O error")
/// จึงเลือกบรรทัดที่บอกสาเหตุจริง และเติมคำอธิบายภาษาไทยสำหรับสาเหตุที่พบบ่อย
pub fn explain_ffmpeg_error(lines: &[String]) -> String {
    const GENERIC: [&str; 6] = ["Error opening output", "Conversion failed", "Error initializing", "Error writing trailer", "Error submitting", "Terminating thread"];
    let strip = |l: &str| -> String {
        // "[tls @ 0x5555] ข้อความ" → "tls: ข้อความ"
        if let (Some(a), Some(b)) = (l.find('['), l.find(']')) {
            if a == 0 && b > a {
                let tag = l[1..b].split(" @").next().unwrap_or("").trim();
                return format!("{}: {}", tag, l[b + 1..].trim());
            }
        }
        l.to_string()
    };
    let specific = lines.iter().rev().find(|l| !GENERIC.iter().any(|g| l.contains(g)) && !l.contains("Last message repeated"));
    let last = lines.last().map(String::as_str).unwrap_or("");
    let detail = match specific {
        Some(s) if s.as_str() != last => format!("{} ({})", strip(s), last.rsplit(": ").next().unwrap_or(last)),
        Some(s) => strip(s),
        None => last.to_string(),
    };
    let all = lines.join("\n").to_lowercase();
    let hint = if all.contains("resolve hostname") || all.contains("name or service") || all.contains("no address associated") {
        "หาเซิร์ฟเวอร์ไม่เจอ (DNS) — ตรวจอินเทอร์เน็ตและที่อยู่ Server"
    } else if all.contains("mbedtls") || all.contains("ssl routines") || all.contains("tls") && (all.contains("handshake") || all.contains("certificate")) {
        "เชื่อมต่อแบบเข้ารหัส (RTMPS/TLS) ไม่สำเร็จ"
    } else if all.contains("connection refused") {
        "เซิร์ฟเวอร์ปฏิเสธการเชื่อมต่อ — ตรวจที่อยู่และพอร์ต"
    } else if all.contains("timed out") || all.contains("timeout") {
        "เชื่อมต่อไม่ทันเวลา — อินเทอร์เน็ตหรือไฟร์วอลล์อาจบล็อกพอร์ต"
    } else if all.contains("server error") || all.contains("unauthorized") || all.contains("publish") && all.contains("fail") {
        "เซิร์ฟเวอร์ไม่รับสตรีม — ตรวจ Stream Key (คีย์อาจหมดอายุหรือถูกรีเซ็ต)"
    } else {
        ""
    };
    // ไม่ให้ Stream Key หลุดไปในข้อความ (ffmpeg พิมพ์ URL ปลายทางเต็ม ๆ)
    let detail = detail
        .split(' ')
        .map(|w| if ["rtmp://", "rtmps://", "srt://"].iter().any(|p| w.starts_with(p)) { mask_url(w.trim_end_matches(':')) } else { w.to_string() })
        .collect::<Vec<_>>()
        .join(" ");
    let out = if hint.is_empty() { detail } else { format!("{hint} · {detail}") };
    out.chars().take(300).collect()
}

/// ตัวเข้ารหัสฮาร์ดแวร์ที่ควรลองบนระบบนี้ (เรียงตามลำดับที่อยากใช้)
pub fn hardware_encoders() -> &'static [&'static str] {
    if cfg!(target_os = "android") {
        &["h264_mediacodec"]
    } else if cfg!(target_os = "macos") {
        &["h264_videotoolbox"]
    } else if cfg!(windows) {
        &["h264_nvenc", "h264_qsv", "h264_amf"]
    } else {
        &["h264_nvenc", "h264_qsv"]
    }
}

/// ลองเข้ารหัสภาพ 720p 1 วินาทีด้วยตัวเข้ารหัสแต่ละตัว (ใช้อาร์กิวเมนต์ชุดเดียวกับตอนสตรีมจริง)
/// คืนตัวแรกที่ใช้ได้ — ถ้าไม่มีตัวไหนใช้ได้คืน libx264 (ซอฟต์แวร์ ใช้ได้ทุกเครื่อง)
pub async fn pick_encoder(ffmpeg: &str, candidates: &[&str]) -> String {
    pick_encoder_report(ffmpeg, candidates).await.0
}

/// เหมือน pick_encoder แต่คืนเหตุผลที่ตัวเข้ารหัสฮาร์ดแวร์ใช้ไม่ได้ด้วย (แสดงในหน้าตั้งค่า)
pub async fn pick_encoder_report(ffmpeg: &str, candidates: &[&str]) -> (String, Option<String>) {
    const KNOWN: [&str; 5] = ["h264_nvenc", "h264_qsv", "h264_videotoolbox", "h264_amf", "h264_mediacodec"];
    let mut failures = Vec::new();
    for enc in candidates.iter().filter(|e| KNOWN.contains(e)) {
        let cfg = Config { video_encoder: enc.to_string(), ..Default::default() };
        let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30", "-frames:v", "30"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        args.extend(video_args(&cfg, 720));
        args.extend(["-pix_fmt", pix_fmt(enc), "-b:v", "2000k", "-g", "60", "-f", "null", "-"].iter().map(|s| s.to_string()));
        let run = quiet(Command::new(ffmpeg).args(&args)).stdin(Stdio::null()).output();
        match tokio::time::timeout(Duration::from_secs(20), run).await {
            Ok(Ok(out)) if out.status.success() => return (enc.to_string(), None),
            Ok(Ok(out)) => {
                let err = String::from_utf8_lossy(&out.stderr);
                let lines: Vec<&str> = err.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
                let tail = lines[lines.len().saturating_sub(2)..].join(" · ");
                failures.push(format!("{enc}: {}", if tail.is_empty() { format!("exit {}", out.status) } else { tail }));
            }
            Ok(Err(e)) => failures.push(format!("{enc}: {e}")),
            Err(_) => failures.push(format!("{enc}: ไม่ตอบสนองภายใน 20 วินาที")),
        }
    }
    let note = (!failures.is_empty()).then(|| failures.join(" | ").chars().take(400).collect());
    ("libx264".into(), note)
}

/// รูปแบบพิกเซลที่ส่งให้ตัวเข้ารหัส — MediaCodec ของ Android รองรับ NV12 (YUV420SemiPlanar) แทบทุกเครื่อง
/// แต่ตัวเข้ารหัสของ Qualcomm หลายรุ่นไม่รับ YUV420Planar (yuv420p)
fn pix_fmt(encoder: &str) -> &'static str {
    if encoder == "h264_mediacodec" { "nv12" } else { "yuv420p" }
}

/// ภาพแนวตั้ง 9:16 (TikTok / Reels / Shorts) สร้างจาก Program 16:9 ที่เข้ารหัสแล้ว — เข้ารหัสใหม่เฉพาะปลายทางแนวตั้ง
/// crop = ตัดกลางภาพให้เต็มจอแนวตั้ง · fit = ภาพเต็มกลางจอ พื้นหลังเป็นภาพเดิมขยายแล้วเบลอ
fn vertical_size(height: u32) -> (u32, u32) {
    if height >= 1080 { (1080, 1920) } else { (720, 1280) }
}
fn vertical_filter(mode: &str, w: u32, h: u32) -> String {
    if mode == "fit" {
        format!("split=2[bg][fg];[bg]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=20:2[b];[fg]scale={w}:-2[f];[b][f]overlay=0:(H-h)/2,setsar=1")
    } else {
        format!("crop=ih*9/16:ih,scale={w}:{h},setsar=1")
    }
}

/// Windows: ไม่ให้ ffmpeg เปิดหน้าต่าง console ขึ้นมา
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.kill_on_drop(true)
}

/// เปิด Gateway แล้วทำงานเบื้องหลังจนกว่าโปรแกรมจะปิด
pub async fn start(cfg: Config) -> std::io::Result<Handle> {
    let listener = TcpListener::bind(SocketAddr::new(cfg.bind, cfg.port)).await?;
    let addr = listener.local_addr()?;
    let srt_supported = probe_ffmpeg(&cfg.ffmpeg).await.map(|(_, s)| s).unwrap_or(false);
    let handle = Handle { addr, token: cfg.token.clone(), srt_supported, encoder: cfg.video_encoder.clone() };
    let cfg = Arc::new(cfg);
    tokio::spawn(async move {
        loop {
            let Ok((stream, peer)) = listener.accept().await else { continue };
            let cfg = cfg.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_conn(stream, peer, cfg, srt_supported).await {
                    eprintln!("[{peer}] {e}");
                }
            });
        }
    });
    Ok(handle)
}

fn same_secret(a: &str, b: &str) -> bool {
    // เทียบแบบใช้เวลาเท่ากันทุกตัวอักษร
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

fn query_map(query: Option<&str>) -> HashMap<String, String> {
    url::form_urlencoded::parse(query.unwrap_or("").as_bytes()).into_owned().collect()
}

// ชนิด Err ของ callback กำหนดโดย tokio-tungstenite (ตอบ HTTP error กลับได้) — ไม่ได้เลือกเอง
#[allow(clippy::result_large_err)]
async fn handle_conn(stream: TcpStream, peer: SocketAddr, cfg: Arc<Config>, srt_supported: bool) -> Result<(), String> {
    // คำขอ HTTP ธรรมดา (ไม่ใช่ WebSocket) = หน้าเช็กสถานะ
    let mut head = [0u8; 2048];
    let n = stream.peek(&mut head).await.map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&head[..n]).to_ascii_lowercase();
    if !text.contains("upgrade: websocket") {
        let mut stream = stream;
        let body = "WebMix Stream Gateway (Rust): OK\n";
        let resp = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: {}\r\naccess-control-allow-origin: *\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(());
    }

    let mut path = String::new();
    let mut query = None;
    let ws = tokio_tungstenite::accept_hdr_async(stream, |req: &Request, resp: Response| {
        path = req.uri().path().to_string();
        query = req.uri().query().map(str::to_string);
        Ok(resp)
    })
    .await
    .map_err(|e| e.to_string())?;
    let params = query_map(query.as_deref());
    let (mut sink, mut source) = ws.split();

    let reject = |reason: &'static str| Message::Close(Some(CloseFrame { code: CloseCode::Policy, reason: reason.into() }));
    if !cfg.token.is_empty() && !same_secret(params.get("token").map(String::as_str).unwrap_or(""), &cfg.token) {
        let _ = sink.send(reject("invalid token")).await;
        return Ok(());
    }
    if path.starts_with("/srt-in") {
        let msg = json!({ "type": "error", "message": "Gateway ในเครื่อง (แอปเดสก์ท็อป) ยังไม่รองรับการรับสัญญาณ SRT — ใช้ Stream Gateway บนเซิร์ฟเวอร์สำหรับ Input SRT" });
        let _ = sink.send(Message::Text(msg.to_string().into())).await;
        let _ = sink.send(reject("srt input not supported")).await;
        return Ok(());
    }

    let fps = params.get("fps").and_then(|v| v.parse::<u32>().ok()).filter(|f| [24, 25, 30, 50, 60].contains(f)).unwrap_or(30);
    let kbps = params.get("vb").and_then(|v| v.parse::<u32>().ok()).unwrap_or(4500).clamp(500, MAX_KBPS);
    let height = params.get("res").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0).min(4320);
    let video_copy = params.get("vcopy").is_some_and(|v| v == "1");

    // ข้อความที่จะส่งกลับไปหน้า WebMix (ส่งจาก task เดียวตามลำดับ)
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            let close = matches!(m, Message::Close(_));
            if sink.send(m).await.is_err() || close {
                break;
            }
        }
        // ตอบรับการปิดให้ครบขั้นตอน — หน้า WebMix จะได้รู้ว่าเป็นการหยุดตามปกติ (1000) ไม่ใช่เน็ตหลุด
        let _ = sink.close().await;
    });

    let mut session = Session::new(cfg.clone(), srt_supported, fps, kbps, height, out_tx.clone(), format!("[{peer}]"));
    session.video_copy = video_copy;
    eprintln!("{} connected", session.tag);

    if let Some(legacy) = params.get("rtmp").cloned() {
        if !is_rtmp(&legacy) {
            let _ = out_tx.send(reject("invalid rtmp url"));
        } else {
            session.start_encoder();
            session.add_dest(json!({ "id": "default", "name": "RTMP", "url": legacy }));
        }
    }

    let ticker = {
        let s = session.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(2));
            loop {
                iv.tick().await;
                s.tick_kbps();
                s.report();
            }
        })
    };

    while let Some(msg) = source.next().await {
        match msg {
            Ok(Message::Binary(data)) => session.write_input(data.to_vec()),
            Ok(Message::Text(text)) => {
                let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                match v.get("type").and_then(Value::as_str) {
                    Some("start") => {
                        session.start_encoder();
                        if let Some(list) = v.get("destinations").and_then(Value::as_array) {
                            for d in list {
                                session.add_dest(d.clone());
                            }
                        }
                    }
                    Some("add") => {
                        session.start_encoder();
                        if let Some(d) = v.get("destination") {
                            session.add_dest(d.clone());
                        }
                    }
                    Some("stop") => {
                        if let Some(id) = v.get("id").and_then(Value::as_str) {
                            session.stop_dest(id);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    ticker.abort();
    session.close();
    let _ = out_tx.send(Message::Close(Some(CloseFrame { code: CloseCode::Normal, reason: "".into() })));
    let _ = tokio::time::timeout(Duration::from_secs(2), writer).await;
    eprintln!("{} disconnected", session.tag);
    Ok(())
}

fn is_rtmp(url: &str) -> bool {
    let l = url.to_ascii_lowercase();
    (l.starts_with("rtmp://") || l.starts_with("rtmps://")) && url.len() > 8 && !url.chars().any(char::is_whitespace)
}

fn is_srt(url: &str) -> bool {
    // srt://host:port[?query]
    if !url.to_ascii_lowercase().starts_with("srt://") || url.chars().any(char::is_whitespace) {
        return false;
    }
    let rest = &url[6..];
    let hostport = rest.split('?').next().unwrap_or("");
    if hostport.contains('/') || hostport.contains('#') {
        return false;
    }
    match hostport.rsplit_once(':') {
        Some((h, p)) => !h.is_empty() && !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()),
        None => false,
    }
}

fn mask_url(url: &str) -> String {
    if url.to_ascii_lowercase().starts_with("srt:") {
        url.split('?').next().unwrap_or("").to_string() + "?***"
    } else {
        match url.rfind('/') {
            Some(i) => format!("{}/***", &url[..i]),
            None => "***".into(),
        }
    }
}

/// ตัวเข้ารหัสวิดีโอ — การ์ดจอช่วยให้ 4K ลื่น
fn video_args(cfg: &Config, height: u32) -> Vec<String> {
    let v: Vec<&str> = match cfg.video_encoder.as_str() {
        "h264_nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll", "-rc", "cbr", "-profile:v", "high", "-bsf:v", "dump_extra"],
        "h264_qsv" => vec!["-c:v", "h264_qsv", "-preset", "veryfast", "-profile:v", "high", "-bsf:v", "dump_extra"],
        "h264_videotoolbox" => vec!["-c:v", "h264_videotoolbox", "-realtime", "1", "-profile:v", "high", "-bsf:v", "dump_extra"],
        "h264_amf" => vec!["-c:v", "h264_amf", "-usage", "lowlatency", "-profile:v", "high", "-bsf:v", "dump_extra"],
        // Android: ตัวเข้ารหัสฮาร์ดแวร์ของเครื่องผ่าน NDK MediaCodec (ไม่ต้องมี Java VM ในโปรเซส ffmpeg)
        "h264_mediacodec" => vec!["-c:v", "h264_mediacodec", "-ndk_codec", "1", "-bsf:v", "dump_extra"],
        _ => {
            let preset = if !cfg.x264_preset.is_empty() { cfg.x264_preset.as_str() } else if height >= 1440 { "superfast" } else { "veryfast" };
            return ["-c:v", "libx264", "-preset", preset, "-tune", "zerolatency", "-profile:v", "high"].iter().map(|s| s.to_string()).collect();
        }
    };
    v.into_iter().map(String::from).collect()
}

/// SRT: MPEG-TS แพ็กเก็ตละ 1316 ไบต์, passphrase ส่งเป็นตัวเลือกของ ffmpeg (ไม่ถอดรหัส %xx ใน URL)
fn output_args(url: &str) -> Vec<String> {
    if is_srt(url) {
        if let Ok(u) = url::Url::parse(url) {
            let mut pairs: Vec<(String, String)> = u.query_pairs().into_owned().collect();
            let passphrase = pairs.iter().find(|(k, _)| k == "passphrase").map(|(_, v)| v.clone());
            pairs.retain(|(k, _)| k != "passphrase");
            if !pairs.iter().any(|(k, _)| k == "pkt_size") {
                pairs.push(("pkt_size".into(), "1316".into()));
            }
            if !pairs.iter().any(|(k, _)| k == "mode") {
                pairs.push(("mode".into(), "caller".into()));
            }
            let q: String = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish();
            let host = u.host_str().unwrap_or("");
            let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
            let mut args: Vec<String> = ["-f", "mpegts", "-mpegts_flags", "+resend_headers"].iter().map(|s| s.to_string()).collect();
            if let Some(p) = passphrase.filter(|p| !p.is_empty()) {
                args.push("-passphrase".into());
                args.push(p);
            }
            args.push(format!("srt://{host}{port}?{q}"));
            return args;
        }
    }
    vec!["-f".into(), "flv".into(), url.into()]
}

#[derive(Default)]
struct Dest {
    id: String,
    name: String,
    url: String,
    state: &'static str,
    message: String,
    bytes: u64,
    kbps: u64,
    wanted: bool,
    /// "" = แนวนอนตาม Program · "crop" / "fit" = รับภาพจากตัวเข้ารหัสแนวตั้งแบบนั้น
    vertical: String,
    /// ช่องส่งข้อมูลไปยัง ffmpeg ของปลายทางนี้ (None = ไม่ได้ทำงาน)
    tx: Option<mpsc::Sender<Arc<Vec<u8>>>>,
    /// ไบต์ที่รอส่งให้ ffmpeg ของปลายทางนี้ — เพิ่มขึ้นเรื่อย ๆ = เน็ตขาออกไปปลายทางไม่พอ
    queued: Arc<AtomicU64>,
    /// รุ่นของโปรเซส — ใช้แยกโปรเซสเก่าที่ปิดช้าออกจากตัวใหม่
    generation: u64,
}

struct State {
    dests: Vec<Dest>,
    encoder_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
    encoder_started: bool,
    encoder_stats: Option<(f64, f64)>,
    /// ตัวเข้ารหัสภาพแนวตั้ง (แบบ, ช่องส่ง MPEG-TS ของ Program เข้าไป)
    verticals: Vec<(String, mpsc::Sender<Arc<Vec<u8>>>)>,
    closed: bool,
}

#[derive(Clone)]
struct Session {
    cfg: Arc<Config>,
    srt_supported: bool,
    fps: u32,
    kbps: u32,
    height: u32,
    /// วิดีโอที่รับมาเป็น H.264 แล้ว — ไม่ต้องเข้ารหัสซ้ำ
    video_copy: bool,
    out: mpsc::UnboundedSender<Message>,
    tag: String,
    st: Arc<Mutex<State>>,
    last_tick: Arc<Mutex<Instant>>,
}

impl Session {
    fn new(cfg: Arc<Config>, srt_supported: bool, fps: u32, kbps: u32, height: u32, out: mpsc::UnboundedSender<Message>, tag: String) -> Self {
        Self {
            cfg,
            srt_supported,
            fps,
            kbps,
            height,
            video_copy: false,
            out,
            tag,
            st: Arc::new(Mutex::new(State { dests: Vec::new(), encoder_tx: None, encoder_started: false, encoder_stats: None, verticals: Vec::new(), closed: false })),
            last_tick: Arc::new(Mutex::new(Instant::now())),
        }
    }

    fn send(&self, v: Value) {
        let _ = self.out.send(Message::Text(v.to_string().into()));
    }

    fn report(&self) {
        let st = self.st.lock().unwrap();
        let dests: Vec<Value> = st
            .dests
            .iter()
            .map(|d| {
                let live = d.state == "live";
                // lag = ข้อมูลที่ค้างอยู่ คิดเป็นมิลลิวินาทีของสตรีม (ให้แอปลดบิตเรตเมื่อค้างมาก)
                let lag = if live { d.queued.load(Ordering::Relaxed) * 8 / (self.kbps as u64 + 160) } else { 0 };
                json!({ "id": d.id, "name": d.name, "state": d.state, "message": d.message, "kbps": if live { d.kbps } else { 0 }, "lag": lag })
            })
            .collect();
        let encoder = st.encoder_stats.map(|(speed, fps)| json!({ "speed": speed, "fps": fps }));
        drop(st);
        self.send(json!({ "type": "status", "destinations": dests, "encoder": encoder }));
    }

    fn tick_kbps(&self) {
        let mut last = self.last_tick.lock().unwrap();
        let secs = last.elapsed().as_secs_f64().max(0.5);
        *last = Instant::now();
        drop(last);
        let mut st = self.st.lock().unwrap();
        for d in st.dests.iter_mut() {
            d.kbps = (d.bytes as f64 * 8.0 / 1000.0 / secs).round() as u64;
            d.bytes = 0;
        }
    }

    fn write_input(&self, data: Vec<u8>) {
        if let Some(tx) = &self.st.lock().unwrap().encoder_tx {
            let _ = tx.send(data);
        }
    }

    /// ตัวเข้ารหัสกลาง: WebM จากเบราว์เซอร์ → H.264/AAC MPEG-TS (ส่ง SPS/PPS ซ้ำทุกคีย์เฟรม ปลายทางที่เริ่มกลางคันจึงต่อได้)
    fn start_encoder(&self) {
        {
            let mut st = self.st.lock().unwrap();
            if st.encoder_started || st.closed {
                return;
            }
            st.encoder_started = true;
        }
        let (fps, kbps) = (self.fps.to_string(), self.kbps);
        let mut args: Vec<String> = ["-hide_banner", "-loglevel", "warning", "-stats", "-stats_period", "2", "-i", "pipe:0"].iter().map(|s| s.to_string()).collect();
        if self.video_copy {
            args.extend(["-c:v", "copy"].iter().map(|s| s.to_string()));
        } else {
            args.extend(video_args(&self.cfg, self.height));
            for a in [
                "-pix_fmt", pix_fmt(&self.cfg.video_encoder), "-r", &fps, "-g", &(self.fps * 2).to_string(), "-keyint_min", &(self.fps * 2).to_string(), "-sc_threshold", "0",
                "-b:v", &format!("{kbps}k"), "-maxrate", &format!("{kbps}k"), "-bufsize", &format!("{}k", kbps * 2),
            ] {
                args.push(a.to_string());
            }
        }
        for a in [
            "-c:a", "aac", "-ar", "44100", "-b:a", "128k", "-f", "mpegts", "-mpegts_flags", "+resend_headers", "pipe:1",
        ] {
            args.push(a.to_string());
        }
        let venc = if self.video_copy { "copy (H.264 จากเบราว์เซอร์)" } else { self.cfg.video_encoder.as_str() };
        eprintln!("{} encoder start {}p{} {}kbps {}", self.tag, self.height, self.fps, kbps, venc);
        let child = quiet(Command::new(&self.cfg.ffmpeg).args(&args)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                let _ = self.out.send(Message::Close(Some(CloseFrame { code: CloseCode::Error, reason: format!("ffmpeg not available: {e}").into() })));
                return;
            }
        };
        let mut stdin = child.stdin.take().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        self.st.lock().unwrap().encoder_tx = Some(tx);
        tokio::spawn(async move {
            while let Some(chunk) = rx.recv().await {
                if stdin.write_all(&chunk).await.is_err() {
                    break;
                }
            }
            // ปิด stdin → ffmpeg เขียนส่วนท้ายแล้วจบเอง
        });
        // อ่านความเร็วการเข้ารหัสจากบรรทัดสถานะของ ffmpeg (speed=1.0x คือทันเวลาจริง)
        {
            let s = self.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    let mut byte = [0u8; 1];
                    // บรรทัดสถานะจบด้วย \r ไม่ใช่ \n
                    loop {
                        match reader.read(&mut byte).await {
                            Ok(0) | Err(_) => return,
                            Ok(_) => {
                                if byte[0] == b'\r' || byte[0] == b'\n' {
                                    break;
                                }
                                buf.push(byte[0]);
                            }
                        }
                    }
                    let line = String::from_utf8_lossy(&buf);
                    if let Some(speed) = field(&line, "speed=") {
                        let fps = field(&line, "fps=").unwrap_or(0.0);
                        s.st.lock().unwrap().encoder_stats = Some((speed, fps));
                    } else if !line.trim().is_empty() {
                        eprintln!("{} encoder: {}", s.tag, line.trim());
                    }
                }
            });
        }
        // กระจายข้อมูลที่เข้ารหัสแล้วไปทุกปลายทางที่ทำงานอยู่
        {
            let s = self.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 188 * 700];
                loop {
                    match stdout.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let chunk = Arc::new(buf[..n].to_vec());
                            let mut st = s.st.lock().unwrap();
                            for (_, tx) in st.verticals.iter() {
                                let _ = tx.try_send(chunk.clone());
                            }
                            for d in st.dests.iter_mut() {
                                if !d.vertical.is_empty() {
                                    continue;
                                }
                                if let Some(tx) = &d.tx {
                                    if tx.try_send(chunk.clone()).is_ok() {
                                        d.bytes += n as u64;
                                        d.queued.fetch_add(n as u64, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }
        let s = self.clone();
        tokio::spawn(async move {
            let code = child.wait().await.ok().and_then(|c| c.code());
            eprintln!("{} encoder exited ({code:?})", s.tag);
            if !s.st.lock().unwrap().closed {
                let _ = s.out.send(Message::Close(Some(CloseFrame { code: CloseCode::Error, reason: format!("encoder exited ({code:?})").into() })));
            }
        });
    }

    /// MPEG-TS ของ Program → ครอป/ย่อเป็น 9:16 → MPEG-TS ไปปลายทางแนวตั้งแบบเดียวกัน (เสียงคัดลอกตามเดิม)
    fn start_vertical(&self, mode: &str) {
        {
            let st = self.st.lock().unwrap();
            if st.closed || st.verticals.iter().any(|(m, _)| m == mode) {
                return;
            }
        }
        let (w, h) = vertical_size(self.height);
        let (fps, kbps) = (self.fps, self.kbps);
        let mut args: Vec<String> = [
            "-hide_banner", "-loglevel", "warning", "-nostats", "-probesize", "5000000", "-analyzeduration", "3000000", "-f", "mpegts", "-i", "pipe:0", "-vf",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        args.push(vertical_filter(mode, w, h));
        args.extend(video_args(&self.cfg, h));
        for a in [
            "-pix_fmt", pix_fmt(&self.cfg.video_encoder), "-r", &fps.to_string(), "-g", &(fps * 2).to_string(), "-keyint_min", &(fps * 2).to_string(), "-sc_threshold", "0",
            "-b:v", &format!("{kbps}k"), "-maxrate", &format!("{kbps}k"), "-bufsize", &format!("{}k", kbps * 2),
            "-c:a", "copy", "-f", "mpegts", "-mpegts_flags", "+resend_headers", "pipe:1",
        ] {
            args.push(a.to_string());
        }
        eprintln!("{} vertical {} {}x{}", self.tag, mode, w, h);
        let child = quiet(Command::new(&self.cfg.ffmpeg).args(&args)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                eprintln!("{} vertical {}: {e}", self.tag, mode);
                return;
            }
        };
        let (tx, mut rx) = mpsc::channel::<Arc<Vec<u8>>>(DEST_QUEUE);
        self.st.lock().unwrap().verticals.push((mode.to_string(), tx.clone()));
        let mut stdin = child.stdin.take().unwrap();
        tokio::spawn(async move {
            while let Some(chunk) = rx.recv().await {
                if stdin.write_all(&chunk).await.is_err() {
                    break;
                }
            }
        });
        {
            let stderr = child.stderr.take().unwrap();
            let tag = format!("{} vertical {}", self.tag, mode);
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        eprintln!("{tag}: {}", line.trim());
                    }
                }
            });
        }
        {
            let mut stdout = child.stdout.take().unwrap();
            let s = self.clone();
            let mode = mode.to_string();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 188 * 700];
                loop {
                    match stdout.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let chunk = Arc::new(buf[..n].to_vec());
                            let mut st = s.st.lock().unwrap();
                            for d in st.dests.iter_mut().filter(|d| d.vertical == mode) {
                                if let Some(tx) = &d.tx {
                                    if tx.try_send(chunk.clone()).is_ok() {
                                        d.bytes += n as u64;
                                        d.queued.fetch_add(n as u64, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }
        let s = self.clone();
        let mode = mode.to_string();
        tokio::spawn(async move {
            let code = child.wait().await.ok().and_then(|c| c.code());
            eprintln!("{} vertical {} exited ({code:?})", s.tag, mode);
            let again = {
                let mut st = s.st.lock().unwrap();
                st.verticals.retain(|(m, t)| !(m == &mode && t.same_channel(&tx)));
                !st.closed && st.dests.iter().any(|d| d.wanted && d.vertical == mode)
            };
            // ล่มระหว่างไลฟ์ → เริ่มใหม่ ถ้ายังมีปลายทางแนวตั้งแบบนี้อยู่
            if again {
                tokio::time::sleep(RETRY).await;
                s.start_vertical(&mode);
            }
        });
    }

    fn dest_error(&self, id: &str, name: &str, message: &str) {
        self.send(json!({ "type": "status", "destinations": [{ "id": id, "name": name, "state": "error", "message": message, "kbps": 0 }] }));
    }

    fn add_dest(&self, raw: Value) {
        let id: String = raw.get("id").and_then(Value::as_str).unwrap_or("").chars().take(40).collect();
        let name: String = raw.get("name").and_then(Value::as_str).unwrap_or(&id).chars().take(40).collect();
        let url = raw.get("url").and_then(Value::as_str).unwrap_or("").to_string();
        let vertical = match raw.get("vertical").and_then(Value::as_str) {
            Some(m @ ("crop" | "fit")) => m.to_string(),
            _ => String::new(),
        };
        if id.is_empty() {
            return;
        }
        if !is_rtmp(&url) && !is_srt(&url) {
            return self.dest_error(&id, &name, "URL ต้องเป็น rtmp://, rtmps:// หรือ srt://host:port");
        }
        if is_srt(&url) && !self.srt_supported {
            return self.dest_error(&id, &name, "ffmpeg ในเครื่องนี้ไม่รองรับ SRT (ต้องเป็น ffmpeg ที่คอมไพล์พร้อม libsrt)");
        }
        {
            let mut st = self.st.lock().unwrap();
            if !st.dests.iter().any(|d| d.id == id) {
                if st.dests.len() >= self.cfg.max_destinations {
                    drop(st);
                    return self.dest_error(&id, &name, &format!("เกินจำนวนปลายทางสูงสุด ({})", self.cfg.max_destinations));
                }
                st.dests.push(Dest { id: id.clone(), name: name.clone(), state: "stopped", ..Default::default() });
            }
            let d = st.dests.iter_mut().find(|d| d.id == id).unwrap();
            d.url = url;
            d.vertical = vertical.clone();
            d.wanted = true;
            if d.tx.is_some() {
                drop(st);
                return self.report();
            }
        }
        if !vertical.is_empty() {
            self.start_vertical(&vertical);
        }
        self.spawn_dest(&id);
        self.report();
    }

    fn stop_dest(&self, id: &str) {
        let mut st = self.st.lock().unwrap();
        if let Some(d) = st.dests.iter_mut().find(|d| d.id == id) {
            d.wanted = false;
            d.message.clear();
            // ปิดช่องส่งข้อมูล → stdin ของ ffmpeg ปิด → ffmpeg จบเอง (ถ้าไม่จบใน 3 วินาทีจะถูกปิด)
            if d.tx.take().is_none() {
                d.state = "stopped";
            }
        }
        drop(st);
        self.report();
    }

    fn spawn_dest(&self, id: &str) {
        let (url, name, generation) = {
            let mut st = self.st.lock().unwrap();
            if st.closed {
                return;
            }
            let Some(d) = st.dests.iter_mut().find(|d| d.id == id) else { return };
            d.state = "connecting";
            d.message.clear();
            d.generation += 1;
            (d.url.clone(), d.name.clone(), d.generation)
        };
        let mut args: Vec<String> = [
            "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
            // ต้องอ่านนานกว่า 1 ช่วงคีย์เฟรม ปลายทางที่เริ่มกลางไลฟ์จึงเจอ SPS/PPS เสมอ
            "-probesize", "5000000", "-analyzeduration", "3000000",
            "-f", "mpegts", "-i", "pipe:0", "-c", "copy",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        args.extend(output_args(&url));
        eprintln!("{} → {} {}", self.tag, name, mask_url(&url));
        let child = quiet(Command::new(&self.cfg.ffmpeg).args(&args)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
        let mut child: Child = match child {
            Ok(c) => c,
            Err(e) => {
                let mut st = self.st.lock().unwrap();
                if let Some(d) = st.dests.iter_mut().find(|d| d.id == id) {
                    d.state = "error";
                    d.message = format!("เปิด ffmpeg ไม่ได้: {e}");
                }
                return;
            }
        };
        let (tx, mut rx) = mpsc::channel::<Arc<Vec<u8>>>(DEST_QUEUE);
        let queued = Arc::new(AtomicU64::new(0));
        {
            let mut st = self.st.lock().unwrap();
            if let Some(d) = st.dests.iter_mut().find(|d| d.id == id) {
                d.tx = Some(tx);
                d.queued = queued.clone();
            }
        }
        let mut stdin = child.stdin.take().unwrap();
        tokio::spawn(async move {
            while let Some(chunk) = rx.recv().await {
                if stdin.write_all(&chunk).await.is_err() {
                    break;
                }
                queued.fetch_sub((chunk.len() as u64).min(queued.load(Ordering::Relaxed)), Ordering::Relaxed);
            }
        });
        // live = ffmpeg เขียนข้อมูลออกไปยังปลายทางได้จริงแล้ว (out_time เริ่มเดิน)
        let stdout = child.stdout.take().unwrap();
        {
            let s = self.clone();
            let id = id.to_string();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some(v) = line.strip_prefix("out_time_us=") {
                        if v.trim().parse::<i64>().map(|t| t > 0).unwrap_or(false) {
                            let mut st = s.st.lock().unwrap();
                            if let Some(d) = st.dests.iter_mut().find(|d| d.id == id && d.generation == generation) {
                                if d.state == "connecting" {
                                    d.state = "live";
                                    eprintln!("{} ✓ {} live", s.tag, d.name);
                                    drop(st);
                                    s.report();
                                }
                            }
                        }
                    }
                }
            });
        }
        let recent_err = Arc::new(Mutex::new(Vec::<String>::new()));
        {
            let stderr = child.stderr.take().unwrap();
            let recent_err = recent_err.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        let mut r = recent_err.lock().unwrap();
                        r.push(line.trim().chars().take(300).collect());
                        if r.len() > 12 {
                            r.remove(0);
                        }
                    }
                }
            });
        }
        let s = self.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            // ปิดได้ช้าสุด 3 วินาทีหลังหยุดส่งข้อมูล
            let status = loop {
                tokio::select! {
                    r = child.wait() => break r.ok(),
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {
                        let stopping = {
                            let st = s.st.lock().unwrap();
                            st.closed || st.dests.iter().find(|d| d.id == id).map(|d| d.generation != generation || d.tx.is_none()).unwrap_or(true)
                        };
                        if stopping {
                            match tokio::time::timeout(Duration::from_secs(3), child.wait()).await {
                                Ok(r) => break r.ok(),
                                Err(_) => { let _ = child.kill().await; break None; }
                            }
                        }
                    }
                }
            };
            let retry = {
                let mut st = s.st.lock().unwrap();
                let closed = st.closed;
                let Some(d) = st.dests.iter_mut().find(|d| d.id == id && d.generation == generation) else { return };
                d.tx = None;
                if !d.wanted || closed {
                    d.state = "stopped";
                    false
                } else {
                    d.state = "error";
                    let err = explain_ffmpeg_error(&recent_err.lock().unwrap());
                    d.message = if err.is_empty() { format!("การเชื่อมต่อปิดลง ({:?})", status.and_then(|c| c.code())) } else { err };
                    eprintln!("{} ✕ {}: {}", s.tag, d.name, d.message);
                    true
                }
            };
            s.report();
            if retry {
                tokio::time::sleep(RETRY).await;
                let again = {
                    let st = s.st.lock().unwrap();
                    !st.closed && st.dests.iter().any(|d| d.id == id && d.wanted && d.tx.is_none() && d.generation == generation)
                };
                if again {
                    s.spawn_dest(&id);
                    s.report();
                }
            }
        });
    }

    fn close(&self) {
        let mut st = self.st.lock().unwrap();
        st.closed = true;
        st.encoder_tx = None; // ปิด stdin ของตัวเข้ารหัส
        st.verticals.clear(); // ปิด stdin ของตัวเข้ารหัสแนวตั้ง
        for d in st.dests.iter_mut() {
            d.wanted = false;
            d.tx = None;
        }
    }
}

fn field(line: &str, key: &str) -> Option<f64> {
    let i = line.find(key)? + key.len();
    let rest = line[i..].trim_start();
    let num: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    num.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_ffmpeg_errors() {
        let l = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let dns = explain_ffmpeg_error(&l(&["[tcp @ 0x55d1] Failed to resolve hostname live-api-s.facebook.com: No address associated with hostname", "[out#0/flv @ 0x1] Error opening output rtmps://x: I/O error", "Error opening output files: I/O error"]));
        assert!(dns.starts_with("หาเซิร์ฟเวอร์ไม่เจอ (DNS)"), "{dns}");
        assert!(dns.contains("tcp: Failed to resolve hostname live-api-s.facebook.com"), "{dns}");
        let tls = explain_ffmpeg_error(&l(&["[tls @ 0x1] mbedtls_ssl_handshake returned -0x7780", "Error opening output files: I/O error"]));
        assert!(tls.starts_with("เชื่อมต่อแบบเข้ารหัส"), "{tls}");
        assert_eq!(explain_ffmpeg_error(&l(&["something odd"])), "something odd");
        let key = explain_ffmpeg_error(&l(&["[rtmp @ 0x1] Server error: rtmps://live-api-s.facebook.com:443/rbtmp/FB-123-SECRET bad"]));
        assert!(!key.contains("SECRET") && key.contains("***"), "{key}");
        assert_eq!(explain_ffmpeg_error(&[]), "");
    }

    #[tokio::test]
    async fn pick_encoder_falls_back_to_x264() {
        // ไม่มี ffmpeg หรือตัวเข้ารหัสใช้ไม่ได้ → libx264
        assert_eq!(pick_encoder("/nonexistent/ffmpeg", &["h264_nvenc"]).await, "libx264");
        if probe_ffmpeg("ffmpeg").await.is_some() {
            // ชื่อที่ไม่รู้จักไม่ถูกเลือก (video_args จะตีความเป็น libx264 แต่รายงานผิดชื่อ)
            assert_eq!(pick_encoder("ffmpeg", &["h264_does_not_exist"]).await, "libx264");
            // AMF (การ์ดจอ AMD บน Windows) ไม่มีใน ffmpeg ของ Linux → ตกไปที่ libx264
            assert_eq!(pick_encoder("ffmpeg", &["h264_amf"]).await, "libx264");
        }
    }

    #[test]
    fn vertical_filters() {
        assert_eq!(vertical_size(720), (720, 1280));
        assert_eq!(vertical_size(1080), (1080, 1920));
        assert_eq!(vertical_filter("crop", 720, 1280), "crop=ih*9/16:ih,scale=720:1280,setsar=1");
        assert!(vertical_filter("fit", 1080, 1920).contains("boxblur") && vertical_filter("fit", 1080, 1920).contains("overlay=0:(H-h)/2"));
    }

    #[test]
    fn url_checks() {
        assert!(is_rtmp("rtmp://a.rtmp.youtube.com/live2/key"));
        assert!(!is_rtmp("http://x"));
        assert!(is_srt("srt://host:9000"));
        assert!(is_srt("srt://host:9000?streamid=abc&latency=500000"));
        assert!(!is_srt("srt://host"));
        assert!(!is_srt("srt://host:9000/path"));
    }

    #[test]
    fn srt_args_move_passphrase_out_of_url() {
        let a = output_args("srt://example.com:9000?streamid=cam%201&passphrase=s%40cret+pass1&latency=500000");
        assert_eq!(a[0..4], ["-f", "mpegts", "-mpegts_flags", "+resend_headers"]);
        let i = a.iter().position(|x| x == "-passphrase").unwrap();
        assert_eq!(a[i + 1], "s@cret pass1");
        let url = a.last().unwrap();
        assert!(url.starts_with("srt://example.com:9000?"));
        assert!(!url.contains("passphrase"));
        assert!(url.contains("pkt_size=1316") && url.contains("mode=caller") && url.contains("latency=500000"));
    }

    #[test]
    fn rtmp_args() {
        assert_eq!(output_args("rtmp://x/app/key"), ["-f", "flv", "rtmp://x/app/key"]);
        assert_eq!(mask_url("rtmp://x/app/key"), "rtmp://x/app/***");
        assert_eq!(mask_url("srt://x:9000?passphrase=1"), "srt://x:9000?***");
    }

    #[test]
    fn stats_parsing() {
        let l = "frame=  120 fps= 30 q=23.0 size=    512KiB time=00:00:04.00 bitrate=1048.6kbits/s speed=0.98x";
        assert_eq!(field(l, "speed="), Some(0.98));
        assert_eq!(field(l, "fps="), Some(30.0));
    }

    #[test]
    fn token_compare() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }
}
