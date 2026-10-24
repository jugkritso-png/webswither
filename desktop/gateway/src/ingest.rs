//! รับสัญญาณภาพเข้ามาเป็น Input ของ WebMix: SRT (รอรับ / ดึง), กล้อง IP (RTSP), RTMP (OBS / มือถือ / โดรน ส่งเข้ามา) และ NDI / OMT ในวง LAN
//! เบราว์เซอร์เล่นสัญญาณเหล่านี้เองไม่ได้ จึงแปลงเป็น MPEG-TS ส่งผ่าน WebSocket ให้ mpegts.js เล่น
//!   ws /srt-in        ช่องควบคุม: client → { type: "open", mode: listener|caller|rtsp|rtmp|ndi|omt, port, url, streamid, passphrase, latency, key, source }
//!                     client → { type: "sources", proto: ndi|omt } → server { type: "sources", proto, list, error } (ก่อน open — ใช้ค้นหาแหล่งในวง LAN)
//!                     server → { type: "opened", id, port } แล้ว { type: "status", state: waiting|connecting|live|error, message, info, transcode }
//!   ws /srt-in/data?id=…  ข้อมูลภาพ MPEG-TS (binary)
//! วิดีโอ H.264 ส่งต่อโดยไม่เข้ารหัสใหม่ — codec อื่น (เช่น HEVC จากกล้อง IP) แปลงเป็น H.264 ให้อัตโนมัติ

use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::Command;
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use crate::{is_srt, netvideo, quiet, Config};

type Sink = SplitSink<WebSocketStream<TcpStream>, Message>;
type Source = SplitStream<WebSocketStream<TcpStream>>;
type Chunk = Arc<Vec<u8>>;

pub const SRT_PORTS: (u16, u16) = (9000, 9009);
pub const RTMP_PORTS: (u16, u16) = (1935, 1944);
const LATENCIES: [u32; 6] = [120, 200, 500, 1000, 2000, 4000];
/// ข้อมูลที่ค้างส่งให้ตัวเล่นที่ช้าได้สูงสุดกี่ชิ้น (เกินแล้วข้าม ไม่ให้หน่วยความจำบวม)
const VIEWER_QUEUE: usize = 256;

struct Ingest {
    viewers: Mutex<Vec<mpsc::Sender<Chunk>>>,
}

fn ingests() -> &'static Mutex<HashMap<String, Arc<Ingest>>> {
    static M: OnceLock<Mutex<HashMap<String, Arc<Ingest>>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

fn used_ports() -> &'static Mutex<HashSet<String>> {
    static M: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

fn new_id() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:x}{:x}", t, std::process::id(), N.fetch_add(1, Ordering::Relaxed))
}

/// rtsp://user:pass@host → rtsp://***@host
pub fn mask_creds(url: &str) -> String {
    if let Some(i) = url.find("://") {
        let rest = &url[i + 3..];
        let end = rest.find('/').unwrap_or(rest.len());
        if let Some(at) = rest[..end].rfind('@') {
            return format!("{}***@{}", &url[..i + 3], &rest[at + 1..]);
        }
    }
    url.to_string()
}

/// ที่อยู่ในวง LAN ของเครื่องนี้ (ไม่ได้ส่งข้อมูลออกไปจริง — แค่ให้ระบบเลือกการ์ดเครือข่ายที่ใช้ออกเน็ต)
fn lan_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| s.connect("8.8.8.8:80").map(|_| s))
        .and_then(|s| s.local_addr())
        .map(|a| a.ip().to_string())
        .unwrap_or_default()
}

pub fn is_rtsp(url: &str) -> bool {
    let l = url.to_ascii_lowercase();
    (l.starts_with("rtsp://") || l.starts_with("rtsps://")) && url.len() > 8 && !url.chars().any(|c| c.is_whitespace() || "\"'<>".contains(c))
}

fn valid_key(k: &str) -> bool {
    (4..=64).contains(&k.len()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// รายละเอียดการรับสัญญาณที่ตรวจแล้ว
#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub mode: String,
    pub port: u16,
    pub target: String,
    pub key: String,
    pub latency: u32,
    pub passphrase: String,
    pub streamid: String,
}

impl Spec {
    /// ตรวจข้อความ open จากหน้า WebMix — ผิดคืนข้อความภาษาไทย
    pub fn parse(v: &Value, srt_supported: bool) -> Result<Spec, String> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
        let mode = match v.get("mode").and_then(Value::as_str) {
            Some(m @ ("caller" | "rtsp" | "rtmp" | "ndi" | "omt")) => m.to_string(),
            _ => "listener".to_string(),
        };
        if (mode == "listener" || mode == "caller") && !srt_supported {
            return Err("ffmpeg ในเครื่องนี้ไม่รองรับ SRT".into());
        }
        let latency = v.get("latency").and_then(Value::as_u64).map(|x| x as u32).filter(|x| LATENCIES.contains(x)).unwrap_or(500);
        let passphrase = s("passphrase");
        if !passphrase.is_empty() && !(10..=64).contains(&passphrase.len()) {
            return Err("รหัสผ่าน SRT ต้องยาว 10–64 ตัวอักษร".into());
        }
        let port = v.get("port").and_then(Value::as_u64).unwrap_or(0);
        let mut spec = Spec { mode: mode.clone(), port: 0, target: String::new(), key: String::new(), latency, passphrase, streamid: s("streamid").chars().take(512).collect() };
        match mode.as_str() {
            "rtsp" => {
                spec.target = s("url");
                if !is_rtsp(&spec.target) {
                    return Err("URL กล้องต้องอยู่ในรูปแบบ rtsp://ผู้ใช้:รหัส@ที่อยู่กล้อง:554/…".into());
                }
            }
            "rtmp" => {
                if port < RTMP_PORTS.0 as u64 || port > RTMP_PORTS.1 as u64 {
                    return Err(format!("พอร์ต RTMP ต้องอยู่ในช่วง {}–{}", RTMP_PORTS.0, RTMP_PORTS.1));
                }
                spec.port = port as u16;
                spec.key = s("key");
                if !valid_key(&spec.key) {
                    return Err("Stream key ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข 4–64 ตัว".into());
                }
            }
            "ndi" | "omt" => {
                spec.target = s("source").chars().filter(|c| !c.is_control()).take(200).collect();
                if spec.target.is_empty() {
                    return Err("ยังไม่ได้เลือกแหล่งสัญญาณ".into());
                }
            }
            "caller" => {
                spec.target = s("url");
                if !is_srt(&spec.target) {
                    return Err("URL ต้องอยู่ในรูปแบบ srt://host:port".into());
                }
            }
            _ => {
                if port < SRT_PORTS.0 as u64 || port > SRT_PORTS.1 as u64 {
                    return Err(format!("พอร์ตต้องอยู่ในช่วง {}–{}", SRT_PORTS.0, SRT_PORTS.1));
                }
                spec.port = port as u16;
            }
        }
        Ok(spec)
    }

    fn port_key(&self) -> Option<String> {
        match self.mode.as_str() {
            "listener" => Some(format!("udp{}", self.port)),
            "rtmp" => Some(format!("tcp{}", self.port)),
            _ => None,
        }
    }

    fn waits(&self) -> bool {
        self.mode == "listener" || self.mode == "rtmp"
    }

    /// อาร์กิวเมนต์ของ ffmpeg ฝั่งรับ (ก่อนส่วน output)
    pub fn input_args(&self) -> Vec<String> {
        let lat = (self.latency * 1000).to_string();
        let mut a: Vec<String> = Vec::new();
        let input = match self.mode.as_str() {
            "rtsp" => {
                // TCP ผ่านเราเตอร์/NAT ได้เสถียรกว่า UDP · กล้องหายไป 5 วินาทีแล้วเชื่อมต่อใหม่
                a.extend(["-rtsp_transport", "tcp", "-timeout", "5000000"].map(String::from));
                self.target.clone()
            }
            "rtmp" => {
                a.extend(["-listen", "1", "-timeout", "-1"].map(String::from));
                format!("rtmp://0.0.0.0:{}/live/{}", self.port, self.key)
            }
            "caller" => {
                if !self.passphrase.is_empty() {
                    a.extend(["-passphrase".to_string(), self.passphrase.clone()]);
                }
                let u = url::Url::parse(&self.target).ok();
                let host = u.as_ref().and_then(|u| u.host_str()).unwrap_or("").to_string();
                let port = u.as_ref().and_then(|u| u.port()).map(|p| format!(":{p}")).unwrap_or_default();
                let mut pairs: Vec<(String, String)> = u.map(|u| u.query_pairs().into_owned().collect()).unwrap_or_default();
                pairs.retain(|(k, _)| !["passphrase", "mode", "latency", "timeout", "streamid"].contains(&k.as_str()));
                pairs.push(("mode".into(), "caller".into()));
                pairs.push(("latency".into(), lat));
                pairs.push(("timeout".into(), "3000000".into()));
                if !self.streamid.is_empty() {
                    pairs.push(("streamid".into(), self.streamid.clone()));
                }
                let q: String = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish();
                format!("srt://{host}{port}?{q}")
            }
            _ => {
                if !self.passphrase.is_empty() {
                    a.extend(["-passphrase".to_string(), self.passphrase.clone()]);
                }
                format!("srt://0.0.0.0:{}?mode=listener&latency={lat}&pkt_size=1316&timeout=3000000", self.port)
            }
        };
        a.extend(["-fflags", "+nobuffer+genpts", "-probesize", "2000000", "-analyzeduration", "2500000", "-i"].map(String::from));
        a.push(input);
        a
    }
}

/// อ่านรายละเอียดวิดีโอจากบรรทัด "Stream #0:0: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1], 30 fps, …"
pub fn parse_video_line(line: &str) -> Option<(String, u32, u32, f64)> {
    if !line.contains("Stream #0:") {
        return None;
    }
    let after = line.split(": Video: ").nth(1)?;
    let codec: String = after.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    let mut size = None;
    let mut fps = 0.0;
    for part in after.split(", ") {
        let first = part.split_whitespace().next().unwrap_or("");
        if size.is_none() {
            if let Some((w, h)) = first.split_once('x') {
                if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                    if w >= 16 && h >= 16 {
                        size = Some((w, h));
                    }
                }
            }
        }
        if let Some(f) = part.strip_suffix(" fps") {
            fps = f.trim().parse().unwrap_or(0.0);
        }
    }
    let (w, h) = size?;
    Some((codec, w, h, fps))
}

struct Shared {
    out: mpsc::UnboundedSender<Message>,
    state: Mutex<(String, Option<Value>, bool)>,
}

impl Shared {
    fn status(&self, state: &str, message: &str) {
        let (info, transcode) = {
            let mut st = self.state.lock().unwrap();
            st.0 = state.to_string();
            (st.1.clone(), st.2)
        };
        let _ = self.out.send(Message::Text(json!({ "type": "status", "state": state, "message": message, "info": info, "transcode": transcode }).to_string().into()));
    }
}

fn to_viewers(ing: &Ingest, chunk: &Chunk) {
    let mut v = ing.viewers.lock().unwrap();
    v.retain(|tx| !matches!(tx.try_send(chunk.clone()), Err(mpsc::error::TrySendError::Closed(_))));
}

pub async fn control(mut sink: Sink, mut source: Source, cfg: std::sync::Arc<Config>, srt_supported: bool, tag: String) {
    let send_json = |v: Value| Message::Text(v.to_string().into());
    // รอข้อความ open
    let spec = loop {
        match source.next().await {
            Some(Ok(Message::Text(t))) => {
                let Ok(v) = serde_json::from_str::<Value>(&t) else { continue };
                if v.get("type").and_then(Value::as_str) == Some("sources") {
                    let name = v.get("proto").and_then(Value::as_str).unwrap_or("").to_string();
                    let Some(proto) = netvideo::Proto::parse(&name) else { continue };
                    // ค้นหาใช้เวลาได้ถึง ~1.5 วินาที — ทำในเธรดแยก
                    let r = tokio::task::spawn_blocking(move || netvideo::sources(proto)).await.unwrap_or_else(|e| Err(e.to_string()));
                    let msg = match r {
                        Ok(list) => json!({ "type": "sources", "proto": name, "list": list }),
                        Err(e) => json!({ "type": "sources", "proto": name, "list": [], "error": e }),
                    };
                    if sink.send(send_json(msg)).await.is_err() {
                        return;
                    }
                    continue;
                }
                if v.get("type").and_then(Value::as_str) != Some("open") {
                    continue;
                }
                match Spec::parse(&v, srt_supported) {
                    Ok(s) => break s,
                    Err(e) => {
                        let _ = sink.send(send_json(json!({ "type": "error", "message": e }))).await;
                        let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::Policy, reason: "rejected".into() }))).await;
                        return;
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
            _ => {}
        }
    };
    if let Some(k) = spec.port_key() {
        if !used_ports().lock().unwrap().insert(k) {
            let _ = sink.send(send_json(json!({ "type": "error", "message": format!("พอร์ต {} ถูกใช้โดย Input อื่นอยู่แล้ว", spec.port) }))).await;
            let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::Policy, reason: "rejected".into() }))).await;
            return;
        }
    }
    let id = new_id();
    let ing = Arc::new(Ingest { viewers: Mutex::new(Vec::new()) });
    ingests().lock().unwrap().insert(id.clone(), ing.clone());
    let label = match spec.mode.as_str() {
        "listener" => format!("UDP {}", spec.port),
        "rtmp" => format!("RTMP {}", spec.port),
        "ndi" | "omt" => spec.target.clone(),
        _ => mask_creds(&spec.target).split('?').next().unwrap_or("").to_string(),
    };
    eprintln!("{tag} input open {} {label}", spec.mode);

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();
    let range = if spec.mode == "rtmp" { RTMP_PORTS } else { SRT_PORTS };
    let _ = out_tx.send(send_json(json!({ "type": "opened", "id": id, "mode": spec.mode, "port": spec.port, "portRange": [range.0, range.1], "lanIp": lan_ip() })));
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            if sink.send(m).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let closed = Arc::new(AtomicBool::new(false));
    let stop = Arc::new(Notify::new());
    let shared = Arc::new(Shared { out: out_tx.clone(), state: Mutex::new(("starting".into(), None, false)) });
    let runner = {
        let (spec, ing, closed, stop, shared, cfg, tag) = (spec.clone(), ing.clone(), closed.clone(), stop.clone(), shared.clone(), cfg.clone(), tag.clone());
        tokio::spawn(async move {
            while !closed.load(Ordering::Relaxed) {
                let ended = run_once(&spec, &ing, &shared, &cfg, &stop, &tag).await;
                // แหล่งสัญญาณหยุด/หลุด — ปิดตัวเล่นเดิม แล้วรอรับ/ดึงสัญญาณใหม่
                ing.viewers.lock().unwrap().clear();
                if closed.load(Ordering::Relaxed) {
                    break;
                }
                let was_live = shared.state.lock().unwrap().0 == "live";
                let msg = if let Some(m) = ended.filter(|m| !m.is_empty()) {
                    m
                } else if was_live {
                    "สัญญาณหยุด — กำลังรอสัญญาณใหม่".into()
                } else {
                    "เชื่อมต่อไม่ได้".into()
                };
                shared.status("error", &msg);
                let wait = if spec.waits() { 1 } else { 3 };
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(wait)) => {}
                    _ = stop.notified() => {}
                }
            }
        })
    };

    while let Some(m) = source.next().await {
        if matches!(m, Ok(Message::Close(_)) | Err(_)) {
            break;
        }
    }
    closed.store(true, Ordering::Relaxed);
    stop.notify_waiters();
    let _ = tokio::time::timeout(Duration::from_secs(3), runner).await;
    ing.viewers.lock().unwrap().clear();
    ingests().lock().unwrap().remove(&id);
    if let Some(k) = spec.port_key() {
        used_ports().lock().unwrap().remove(&k);
    }
    drop(out_tx);
    drop(shared);
    let _ = tokio::time::timeout(Duration::from_secs(2), writer).await;
    eprintln!("{tag} input closed");
}

/// เปิด ffmpeg รับสัญญาณหนึ่งรอบ จนกว่าจะหลุด/ถูกปิด — คืนข้อความผิดพลาด (ถ้ามี)
async fn run_once(spec: &Spec, ing: &Arc<Ingest>, shared: &Arc<Shared>, cfg: &Config, stop: &Notify, tag: &str) -> Option<String> {
    if let Some(proto) = netvideo::Proto::parse(&spec.mode) {
        return run_netvideo(proto, spec, ing, shared, cfg, stop, tag).await;
    }
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "info", "-nostats", "-progress", "pipe:2"].map(String::from).to_vec();
    args.extend(spec.input_args());
    args.extend(
        ["-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-f", "mpegts", "-mpegts_flags", "+resend_headers", "pipe:1"].map(String::from),
    );
    let mut child = match quiet(Command::new(&cfg.ffmpeg).args(&args)).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => return Some(format!("เปิด ffmpeg ไม่ได้: {e}")),
    };
    {
        let mut st = shared.state.lock().unwrap();
        st.1 = None;
        st.2 = false;
    }
    shared.status(if spec.waits() { "waiting" } else { "connecting" }, "");

    // ส่งต่อแบบเดิมถ้าเป็น H.264 · codec อื่นแปลงเป็น H.264 ก่อน (ตัดสินใจเมื่อ ffmpeg เริ่มส่งออก)
    enum Route {
        Undecided(Vec<Chunk>, usize),
        Direct,
        Transcode(mpsc::Sender<Chunk>),
    }
    let route = Arc::new(Mutex::new(Route::Undecided(Vec::new(), 0)));
    let mut transcoder: Option<tokio::process::Child> = None;
    let decide = |codec: &str, transcoder: &mut Option<tokio::process::Child>| {
        let mut r = route.lock().unwrap();
        let Route::Undecided(pending, _) = &mut *r else { return };
        let pending = std::mem::take(pending);
        if codec == "h264" {
            for c in &pending {
                to_viewers(ing, c);
            }
            *r = Route::Direct;
            return;
        }
        eprintln!("{tag} input is {codec} → transcoding to H.264");
        shared.state.lock().unwrap().2 = true;
        let args = [
            "-hide_banner", "-loglevel", "error", "-probesize", "1000000", "-analyzeduration", "1000000", "-f", "mpegts", "-i", "pipe:0", "-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264",
            "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-g", "60", "-c:a", "copy", "-f", "mpegts", "-mpegts_flags", "+resend_headers", "pipe:1",
        ];
        let Ok(mut t) = quiet(Command::new(&cfg.ffmpeg).args(args)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
            *r = Route::Direct;
            return;
        };
        let (tx, mut rx) = mpsc::channel::<Chunk>(VIEWER_QUEUE);
        let mut stdin = t.stdin.take().unwrap();
        tokio::spawn(async move {
            while let Some(c) = rx.recv().await {
                if stdin.write_all(&c).await.is_err() {
                    break;
                }
            }
        });
        let mut out = t.stdout.take().unwrap();
        let ing = ing.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 188 * 700];
            while let Ok(n) = out.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                to_viewers(&ing, &Arc::new(buf[..n].to_vec()));
            }
        });
        for c in pending {
            let _ = tx.try_send(c);
        }
        *r = Route::Transcode(tx);
        *transcoder = Some(t);
    };

    let mut out = child.stdout.take().unwrap();
    let reader = {
        let (route, ing) = (route.clone(), ing.clone());
        tokio::spawn(async move {
            let mut buf = vec![0u8; 188 * 700];
            while let Ok(n) = out.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                let chunk = Arc::new(buf[..n].to_vec());
                let mut r = route.lock().unwrap();
                match &mut *r {
                    Route::Direct => to_viewers(&ing, &chunk),
                    Route::Transcode(tx) => {
                        let _ = tx.try_send(chunk);
                    }
                    Route::Undecided(p, bytes) => {
                        if *bytes < 32 * 1024 * 1024 {
                            *bytes += n;
                            p.push(chunk);
                        }
                    }
                }
            }
        })
    };

    let mut lines = BufReader::new(child.stderr.take().unwrap()).lines();
    let mut input_section = true;
    let mut codec = String::from("h264");
    let mut last_err: Option<String> = None;
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                if line.starts_with("Output #0") {
                    input_section = false;
                    decide(&codec, &mut transcoder);
                }
                if input_section {
                    if let Some((c, w, h, fps)) = parse_video_line(&line) {
                        codec = c.clone();
                        shared.state.lock().unwrap().1 = Some(json!({ "codec": c, "width": w, "height": h, "fps": fps }));
                        if shared.state.lock().unwrap().0 == "live" {
                            shared.status("live", "");
                        }
                    }
                }
                if let Some(v) = line.strip_prefix("out_time_us=") {
                    if v.trim().parse::<i64>().map(|t| t > 0).unwrap_or(false) && shared.state.lock().unwrap().0 != "live" {
                        shared.status("live", "");
                    }
                }
                let low = line.to_ascii_lowercase();
                if ["error", "failed", "refused", "reject", "invalid"].iter().any(|w| low.contains(w)) {
                    last_err = Some(mask_creds(line.trim()).chars().take(200).collect());
                }
                // ffmpeg รับ RTMP ทุก stream key (แค่เตือน) — key ไม่ตรง = ตัดทิ้ง แล้วเปิดรอใหม่
                if spec.mode == "rtmp" && line.contains("Unexpected stream") {
                    eprintln!("{tag} rejected RTMP sender with a wrong key");
                    last_err = Some("มีผู้ส่ง RTMP ที่ใช้ Stream key ไม่ถูกต้อง — ปฏิเสธแล้ว".into());
                    break;
                }
            }
            _ = stop.notified() => break,
        }
    }
    let _ = child.kill().await;
    reader.abort();
    if let Some(mut t) = transcoder {
        let _ = t.kill().await;
    }
    last_err
}

/* ---- NDI / OMT: เฟรมดิบจากไลบรารี → ffmpeg (H.264 ultrafast + AAC) → MPEG-TS → ตัวเล่นในหน้า WebMix
   ภาพเข้าทาง stdin · เสียงเข้าทาง TCP ภายในเครื่อง (ffmpeg รับได้ stdin เดียว) · ประทับเวลาตามนาฬิกาจริงทั้งคู่ เสียงจึงตรงกับภาพ */

async fn run_netvideo(proto: netvideo::Proto, spec: &Spec, ing: &Arc<Ingest>, shared: &Arc<Shared>, cfg: &Config, stop: &Notify, tag: &str) -> Option<String> {
    shared.status("connecting", &format!("กำลังเชื่อมต่อ {} “{}”…", proto.label(), spec.target));
    let quit = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let th = {
        let (source, ing, shared, ffmpeg, quit, tag) = (spec.target.clone(), ing.clone(), shared.clone(), cfg.ffmpeg.clone(), quit.clone(), tag.to_string());
        std::thread::spawn(move || {
            let r = netvideo_loop(proto, &source, &ing, &shared, &ffmpeg, &quit, &tag);
            let _ = done_tx.send(r);
        })
    };
    let r = tokio::select! {
        r = done_rx => r.ok().flatten(),
        _ = stop.notified() => None,
    };
    quit.store(true, Ordering::Relaxed);
    let _ = tokio::task::spawn_blocking(move || th.join()).await;
    r
}

fn netvideo_loop(proto: netvideo::Proto, source: &str, ing: &Arc<Ingest>, shared: &Arc<Shared>, ffmpeg: &str, quit: &AtomicBool, tag: &str) -> Option<String> {
    let mut rx = match netvideo::Receiver::new(proto, source) {
        Ok(r) => r,
        Err(e) => return Some(e),
    };
    let mut enc: Option<RawEncoder> = None;
    let mut last = std::time::Instant::now();
    let mut waiting = false;
    while !quit.load(Ordering::Relaxed) {
        match rx.capture(200) {
            netvideo::Frame::Video(v) => {
                last = std::time::Instant::now();
                let key = (v.pix, v.width, v.height);
                if enc.as_ref().map(|e| e.key != key || !e.alive()).unwrap_or(true) {
                    if let Some(e) = enc.take() {
                        if !e.alive() {
                            let err = e.error();
                            e.stop();
                            return Some(if err.is_empty() { "ตัวแปลงสัญญาณหยุดทำงาน".into() } else { err });
                        }
                        e.stop();
                    }
                    let fps = if v.fps.0 > 0 { format!("{}/{}", v.fps.0, v.fps.1.max(1)) } else { "30".into() };
                    eprintln!("{tag} {} {source}: {}x{} {:?} @ {fps}", proto.label(), v.width, v.height, v.pix);
                    shared.state.lock().unwrap().1 = Some(json!({ "codec": proto.label().to_ascii_lowercase(), "width": v.width, "height": v.height, "fps": v.fps.0 as f64 / v.fps.1.max(1) as f64 }));
                    match RawEncoder::start(ffmpeg, key, &fps, ing.clone(), shared.clone()) {
                        Ok(e) => enc = Some(e),
                        Err(e) => return Some(e),
                    }
                    waiting = false;
                }
                if let Some(e) = &enc {
                    e.video(v.data);
                }
            }
            netvideo::Frame::Audio(a) => {
                if let Some(e) = &enc {
                    e.audio(if a.rate == 48000 { a.stereo } else { netvideo::resample_stereo(&a.stereo, a.rate, 48000) });
                }
            }
            netvideo::Frame::None => {
                // แหล่งหายไป (ปิดโปรแกรม/สายหลุด) — ปิดตัวแปลง รอแหล่งกลับมาในตัวรับเดิม (NDI/OMT ต่อใหม่เอง)
                if last.elapsed() > Duration::from_secs(3) && !waiting {
                    waiting = true;
                    if let Some(e) = enc.take() {
                        e.stop();
                    }
                    ing.viewers.lock().unwrap().clear();
                    shared.status("waiting", &format!("ไม่มีสัญญาณจาก “{source}” — รอแหล่งกลับมา"));
                }
            }
        }
    }
    if let Some(e) = enc.take() {
        e.stop();
    }
    None
}

fn quiet_std(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// ffmpeg หนึ่งตัวต่อรูปแบบภาพหนึ่งแบบ (เปลี่ยนขนาด/รูปแบบ = เปิดตัวใหม่)
struct RawEncoder {
    key: (netvideo::Pix, u32, u32),
    child: std::process::Child,
    vtx: Option<std::sync::mpsc::SyncSender<Vec<u8>>>,
    atx: Option<std::sync::mpsc::SyncSender<Vec<f32>>>,
    alive: Arc<AtomicBool>,
    err: Arc<Mutex<String>>,
}

impl RawEncoder {
    fn start(ffmpeg: &str, key: (netvideo::Pix, u32, u32), fps: &str, ing: Arc<Ingest>, shared: Arc<Shared>) -> Result<RawEncoder, String> {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let (pix, w, h) = key;
        let gop = fps.split('/').next().and_then(|n| n.parse::<u32>().ok()).map(|n| if fps.contains('/') { n / fps.split('/').nth(1).and_then(|d| d.parse::<u32>().ok()).unwrap_or(1).max(1) } else { n }).unwrap_or(30).clamp(10, 120);
        let args: Vec<String> = vec![
            "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", pix.ffmpeg(), "-video_size", &format!("{w}x{h}"), "-framerate", fps, "-use_wallclock_as_timestamps", "1", "-thread_queue_size", "64", "-i", "pipe:0",
            "-f", "f32le", "-ar", "48000", "-ac", "2", "-use_wallclock_as_timestamps", "1", "-thread_queue_size", "1024", "-i", &format!("tcp://127.0.0.1:{port}"),
            "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-g", &gop.to_string(), "-bf", "0",
            "-crf", "20", "-maxrate", "20M", "-bufsize", "10M", "-af", "aresample=async=1000", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-f", "mpegts", "-mpegts_flags", "+resend_headers", "pipe:1",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let mut child = quiet_std(std::process::Command::new(ffmpeg).args(&args))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("เปิด ffmpeg ไม่ได้: {e}"))?;
        let alive = Arc::new(AtomicBool::new(true));
        let err = Arc::new(Mutex::new(String::new()));
        // ภาพ → stdin (คิวสั้น: ช้าแล้วข้ามเฟรม ไม่หน่วงสะสม)
        let (vtx, vrx) = std::sync::mpsc::sync_channel::<Vec<u8>>(3);
        let mut stdin = child.stdin.take().unwrap();
        {
            let alive = alive.clone();
            std::thread::spawn(move || {
                while let Ok(f) = vrx.recv() {
                    if stdin.write_all(&f).is_err() {
                        alive.store(false, Ordering::Relaxed);
                        break;
                    }
                }
            });
        }
        // เสียง → TCP · ไม่มีเสียงจากแหล่ง = ส่งความเงียบแทน เพื่อให้ภาพเดินต่อได้
        let (atx, arx) = std::sync::mpsc::sync_channel::<Vec<f32>>(256);
        {
            let alive = alive.clone();
            std::thread::spawn(move || {
                let _ = listener.set_nonblocking(true);
                let started = std::time::Instant::now();
                let mut sock = loop {
                    match listener.accept() {
                        Ok((s, _)) => break s,
                        Err(_) if started.elapsed() < Duration::from_secs(15) && alive.load(Ordering::Relaxed) => std::thread::sleep(Duration::from_millis(20)),
                        Err(_) => return,
                    }
                };
                let _ = sock.set_nonblocking(false);
                let _ = sock.set_nodelay(true);
                let silence = vec![0u8; 960 * 2 * 4];
                let mut last_real = std::time::Instant::now() - Duration::from_secs(1);
                loop {
                    let r = match arx.recv_timeout(Duration::from_millis(20)) {
                        Ok(a) => {
                            last_real = std::time::Instant::now();
                            let bytes: Vec<u8> = a.iter().flat_map(|v| v.to_le_bytes()).collect();
                            sock.write_all(&bytes)
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) if last_real.elapsed() > Duration::from_millis(100) => sock.write_all(&silence),
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Ok(()),
                        Err(_) => break,
                    };
                    if r.is_err() {
                        break;
                    }
                }
            });
        }
        // MPEG-TS → ตัวเล่น
        let mut stdout = child.stdout.take().unwrap();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 188 * 700];
            let mut first = true;
            while let Ok(n) = stdout.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if first {
                    first = false;
                    shared.status("live", "");
                }
                to_viewers(&ing, &Arc::new(buf[..n].to_vec()));
            }
        });
        {
            let (mut stderr, err, alive) = (child.stderr.take().unwrap(), err.clone(), alive.clone());
            std::thread::spawn(move || {
                let mut s = String::new();
                let _ = stderr.read_to_string(&mut s);
                let last = s.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").chars().take(200).collect::<String>();
                *err.lock().unwrap() = last;
                alive.store(false, Ordering::Relaxed);
            });
        }
        Ok(RawEncoder { key, child, vtx: Some(vtx), atx: Some(atx), alive, err })
    }

    fn alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }

    fn error(&self) -> String {
        self.err.lock().unwrap().clone()
    }

    fn video(&self, data: Vec<u8>) {
        if let Some(tx) = &self.vtx {
            let _ = tx.try_send(data);
        }
    }

    fn audio(&self, stereo: Vec<f32>) {
        if let Some(tx) = &self.atx {
            let _ = tx.try_send(stereo);
        }
    }

    fn stop(mut self) {
        self.vtx = None;
        self.atx = None;
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub async fn data(mut sink: Sink, mut source: Source, id: &str) {
    let ing = ingests().lock().unwrap().get(id).cloned();
    let Some(ing) = ing else {
        let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::Policy, reason: "unknown input".into() }))).await;
        return;
    };
    let (tx, mut rx) = mpsc::channel::<Chunk>(VIEWER_QUEUE);
    ing.viewers.lock().unwrap().push(tx);
    drop(ing);
    loop {
        tokio::select! {
            c = rx.recv() => match c {
                Some(c) => if sink.send(Message::Binary(c.to_vec().into())).await.is_err() { break },
                None => {
                    // สัญญาณเริ่มใหม่ — ให้ตัวเล่นเชื่อมต่อใหม่
                    let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::from(4000), reason: "restart".into() }))).await;
                    break;
                }
            },
            m = source.next() => if matches!(m, None | Some(Ok(Message::Close(_))) | Some(Err(_))) { break },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_messages() {
        let rtsp = Spec::parse(&json!({ "mode": "rtsp", "url": "rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/101" }), false).unwrap();
        let a = rtsp.input_args();
        assert!(a.windows(2).any(|w| w == ["-rtsp_transport", "tcp"]) && a.last().unwrap().starts_with("rtsp://admin:pw@"));
        assert!(Spec::parse(&json!({ "mode": "rtsp", "url": "http://x" }), true).is_err());
        let rtmp = Spec::parse(&json!({ "mode": "rtmp", "port": 1936, "key": "cam_1" }), false).unwrap();
        assert_eq!(rtmp.input_args().last().unwrap(), "rtmp://0.0.0.0:1936/live/cam_1");
        assert!(Spec::parse(&json!({ "mode": "rtmp", "port": 80, "key": "cam_1" }), false).is_err());
        assert!(Spec::parse(&json!({ "mode": "rtmp", "port": 1936, "key": "a b" }), false).is_err());
        assert!(Spec::parse(&json!({ "mode": "listener", "port": 9001 }), false).is_err());
        let srt = Spec::parse(&json!({ "mode": "listener", "port": 9001, "latency": 200 }), true).unwrap();
        assert!(srt.input_args().last().unwrap().contains("srt://0.0.0.0:9001?mode=listener&latency=200000"));
    }

    #[test]
    fn masks_and_parses() {
        assert_eq!(mask_creds("rtsp://admin:pw@10.0.0.2:554/a"), "rtsp://***@10.0.0.2:554/a");
        assert_eq!(mask_creds("rtsp://10.0.0.2/a@b"), "rtsp://10.0.0.2/a@b");
        let v = parse_video_line("  Stream #0:0: Video: hevc (Main), yuvj420p(pc), 2560x1440, 25 fps, 25 tbr, 90k tbn").unwrap();
        assert_eq!(v, ("hevc".into(), 2560, 1440, 25.0));
        assert!(parse_video_line("  Stream #0:1: Audio: aac, 48000 Hz").is_none());
    }
}
