//! webmix-gateway — รัน Stream Gateway (Rust) แยกเป็นโปรแกรม
//!
//!   webmix-gateway [--port 8080] [--bind 0.0.0.0] [--token รหัส] [--ffmpeg /path/ffmpeg]
//!                  [--encoder auto|libx264|h264_nvenc|h264_qsv|h264_videotoolbox|h264_amf|h264_mediacodec] [--max-destinations 6]
//!
//! ค่าเหมือนตัวแปรแวดล้อมของเวอร์ชัน Node: PORT, STREAM_TOKEN, FFMPEG_PATH, VIDEO_ENCODER, X264_PRESET, MAX_DESTINATIONS

use std::env;

#[tokio::main]
async fn main() {
    let mut cfg = webmix_gateway::Config {
        bind: "0.0.0.0".parse().unwrap(),
        port: env::var("PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(8080),
        token: env::var("STREAM_TOKEN").unwrap_or_default(),
        ffmpeg: env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".into()),
        video_encoder: env::var("VIDEO_ENCODER").unwrap_or_else(|_| "libx264".into()),
        x264_preset: env::var("X264_PRESET").unwrap_or_default(),
        max_destinations: env::var("MAX_DESTINATIONS").ok().and_then(|v| v.parse().ok()).unwrap_or(6),
    };
    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        let val = args.get(i + 1).cloned().unwrap_or_default();
        match args[i].as_str() {
            "--port" => cfg.port = val.parse().expect("--port ต้องเป็นตัวเลข"),
            "--bind" => cfg.bind = val.parse().expect("--bind ต้องเป็น IP"),
            "--token" => cfg.token = val,
            "--ffmpeg" => cfg.ffmpeg = val,
            "--encoder" => cfg.video_encoder = val,
            "--max-destinations" => cfg.max_destinations = val.parse().expect("--max-destinations ต้องเป็นตัวเลข"),
            "-h" | "--help" => {
                println!("webmix-gateway [--port 8080] [--bind 0.0.0.0] [--token รหัส] [--ffmpeg path] [--encoder libx264] [--max-destinations 6]");
                return;
            }
            other => panic!("ไม่รู้จักตัวเลือก {other}"),
        }
        i += 2;
    }
    match webmix_gateway::probe_ffmpeg(&cfg.ffmpeg).await {
        Some((version, srt)) => eprintln!("{version} · SRT {}", if srt { "enabled" } else { "NOT available" }),
        None => eprintln!("คำเตือน: เรียก ffmpeg ที่ '{}' ไม่ได้ — การสตรีมจะไม่ทำงาน", cfg.ffmpeg),
    }
    // --encoder auto: ลองตัวเข้ารหัสฮาร์ดแวร์ของเครื่องนี้ ใช้ libx264 ถ้าไม่มีตัวไหนใช้ได้
    if cfg.video_encoder == "auto" {
        cfg.video_encoder = webmix_gateway::pick_encoder(&cfg.ffmpeg, webmix_gateway::hardware_encoders()).await;
        eprintln!("video encoder: {}", cfg.video_encoder);
    }
    let handle = webmix_gateway::start(cfg).await.expect("เปิดพอร์ตไม่ได้");
    eprintln!("WebMix Stream Gateway (Rust) listening on ws://{}{}", handle.addr, if handle.token.is_empty() { "" } else { " (token required)" });
    let _ = tokio::signal::ctrl_c().await;
}
