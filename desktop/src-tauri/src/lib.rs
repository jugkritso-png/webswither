//! WebMix Pro — แอปเดสก์ท็อป (Windows / macOS / Linux) และ Android
//!
//! หน้าตาและการทำงานทั้งหมดใช้หน้า WebMix เดิม (index.html + assets) ส่วน Rust ทำสิ่งที่เบราว์เซอร์ทำเองไม่ได้:
//! - Stream Gateway ในตัว (webmix-gateway): สตรีมไป YouTube/Facebook/SRT จากเครื่องนี้ได้เลย ไม่ต้องมีเซิร์ฟเวอร์
//! - บันทึกวิดีโอลงโฟลเดอร์โดยตรง (ทุกระบบปฏิบัติการ) พร้อมเขียนทับตามตำแหน่งสำหรับแก้ส่วนหัว WebM ตอนหยุด
//! - เลือกโฟลเดอร์ด้วยหน้าต่างของระบบ
//! - หน้าต่าง Program Output / Multiview เปิดเป็นหน้าต่างจริงของแอป (window.open) — เฉพาะเดสก์ท็อป
//! - Android: ffmpeg ที่คอมไพล์มากับแอป (libffmpeg.so) + ตัวเข้ารหัสฮาร์ดแวร์ของเครื่อง, บันทึกลง Movies/WebMix

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{Mutex, OnceCell};

#[derive(Default)]
struct AppState {
    gateway: OnceCell<Result<webmix_gateway::Handle, String>>,
    ffmpeg: OnceCell<Option<(String, String)>>,
    recordings: Mutex<HashMap<u32, Recording>>,
    next_id: AtomicU32,
}

struct Recording {
    file: tokio::fs::File,
    path: PathBuf,
    len: u64,
}

#[derive(Serialize)]
struct GatewayInfo {
    url: String,
    srt: bool,
}

#[derive(Serialize)]
struct FfmpegInfo {
    path: String,
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    gateway: Option<GatewayInfo>,
    encoder: String,
    gateway_error: Option<String>,
    ffmpeg: Option<FfmpegInfo>,
    rec_dir: String,
    temp_dir: String,
    selftest: bool,
    /// โหมดทดสอบตัวเองแบบสตรีมจริง: ปลายทาง RTMP/SRT ที่จะส่งภาพทดสอบไป
    selftest_stream: Option<String>,
}

/// ค่าโหมดทดสอบตัวเอง: เดสก์ท็อปใช้ตัวแปร WEBMIX_SELFTEST, Android ใช้ system property debug.webmix.selftest
/// (`adb shell setprop debug.webmix.selftest 1` หรือใส่ URL rtmp:// เพื่อทดสอบสตรีมจริงด้วย)
fn selftest_value() -> Option<String> {
    #[cfg(target_os = "android")]
    {
        android::system_property("debug.webmix.selftest").filter(|v| !v.is_empty() && v != "0")
    }
    #[cfg(not(target_os = "android"))]
    {
        std::env::var("WEBMIX_SELFTEST").ok().filter(|v| !v.is_empty())
    }
}

/// โฟลเดอร์ชั่วคราวที่แอปเขียนได้ (Android: cache ของแอป — /data/local/tmp เขียนไม่ได้)
fn scratch_dir(app: &AppHandle) -> PathBuf {
    if cfg!(target_os = "android") {
        app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir())
    } else {
        std::env::temp_dir()
    }
}

fn random_token() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("random");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// หา ffmpeg: ตัวแปร WEBMIX_FFMPEG → ไฟล์ที่วางคู่กับแอป → ตำแหน่งที่ติดตั้งบ่อย → PATH
/// (แอปที่เปิดจาก Finder บน macOS ไม่ได้ PATH ของ shell มา จึงต้องหาเองใน /opt/homebrew และ /usr/local)
fn ffmpeg_candidates(app: &AppHandle) -> Vec<String> {
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let mut list = Vec::new();
    // Android: ffmpeg มากับแอปในชื่อ libffmpeg.so (โฟลเดอร์ native library เป็นที่เดียวที่แอปรันโปรแกรมได้)
    #[cfg(target_os = "android")]
    if let Some(dir) = android::native_lib_dir() {
        list.push(dir.join("libffmpeg.so").to_string_lossy().into());
    }
    if let Ok(p) = std::env::var("WEBMIX_FFMPEG") {
        list.push(p);
    }
    if let Ok(dir) = app.path().resource_dir() {
        list.push(dir.join(exe).to_string_lossy().into());
        list.push(dir.join("ffmpeg").join(exe).to_string_lossy().into());
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        list.push(dir.join(exe).to_string_lossy().into());
    }
    if cfg!(target_os = "macos") {
        list.extend(["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/local/bin/ffmpeg"].map(String::from));
    } else if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            list.push(format!("{local}\\Microsoft\\WinGet\\Links\\ffmpeg.exe"));
        }
        list.extend([r"C:\ffmpeg\bin\ffmpeg.exe", r"C:\Program Files\ffmpeg\bin\ffmpeg.exe", r"C:\ProgramData\chocolatey\bin\ffmpeg.exe"].map(String::from));
    } else {
        list.extend(["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"].map(String::from));
    }
    list.push("ffmpeg".into());
    list
}

async fn find_ffmpeg(app: &AppHandle) -> Option<(String, String)> {
    for cand in ffmpeg_candidates(app) {
        if cand != "ffmpeg" && !Path::new(&cand).exists() {
            continue;
        }
        if let Some((version, _)) = webmix_gateway::probe_ffmpeg(&cand).await {
            return Some((cand, version));
        }
    }
    None
}

fn default_rec_dir(app: &AppHandle) -> PathBuf {
    // Android: โฟลเดอร์ Movies ของเครื่อง (เห็นในแกลเลอรี/ตัวจัดการไฟล์) — ถ้าเขียนไม่ได้ rec_open ใช้โฟลเดอร์ของแอปแทน
    if cfg!(target_os = "android") {
        return PathBuf::from("/storage/emulated/0/Movies/WebMix");
    }
    app.path()
        .video_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("WebMix")
}

/// ข้อมูลของแอปเดสก์ท็อป — หน้า WebMix เรียกตอนเปิดเพื่อตั้งค่า Gateway ในเครื่องให้อัตโนมัติ
#[tauri::command]
async fn desktop_info(app: AppHandle, state: State<'_, AppState>) -> Result<DesktopInfo, String> {
    let ffmpeg = state.ffmpeg.get_or_init(|| find_ffmpeg(&app)).await.clone();
    let gw = state
        .gateway
        .get_or_init(|| async {
            let ffmpeg_path = ffmpeg.as_ref().map(|f| f.0.clone()).unwrap_or_else(|| "ffmpeg".into());
            // ตัวเข้ารหัส: กำหนดเองด้วย WEBMIX_VIDEO_ENCODER หรือลองการ์ดจอ/ฮาร์ดแวร์ของเครื่อง (ไม่ได้ใช้ libx264)
            let video_encoder = match std::env::var("WEBMIX_VIDEO_ENCODER") {
                Ok(v) if v != "auto" => v,
                _ if ffmpeg.is_some() => webmix_gateway::pick_encoder(&ffmpeg_path, webmix_gateway::hardware_encoders()).await,
                _ => "libx264".into(),
            };
            let cfg = webmix_gateway::Config { token: random_token(), ffmpeg: ffmpeg_path, video_encoder, ..Default::default() };
            webmix_gateway::start(cfg).await.map_err(|e| e.to_string())
        })
        .await;
    Ok(DesktopInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        gateway: gw.as_ref().ok().map(|h| GatewayInfo { url: h.url(), srt: h.srt_supported }),
        encoder: gw.as_ref().map(|h| h.encoder.clone()).unwrap_or_default(),
        gateway_error: gw.as_ref().err().cloned(),
        ffmpeg: ffmpeg.map(|(path, version)| FfmpegInfo { path, version }),
        rec_dir: default_rec_dir(&app).to_string_lossy().into(),
        temp_dir: scratch_dir(&app).to_string_lossy().into(),
        selftest: selftest_value().is_some(),
        selftest_stream: selftest_value().filter(|v| v.starts_with("rtmp://") || v.starts_with("srt://")),
    })
}

/// เลือกโฟลเดอร์ด้วยหน้าต่างของระบบ (Android ไม่มี — ใช้ Movies/WebMix)
#[cfg(mobile)]
#[tauri::command]
async fn pick_folder() -> Option<String> {
    None
}

#[cfg(desktop)]
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p.map(|p| p.to_string()));
    });
    rx.await.ok().flatten()
}

fn safe_name(name: &str) -> Result<String, String> {
    let ok = !name.is_empty()
        && name.len() <= 200
        && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        && !name.starts_with('.');
    if ok { Ok(name.to_string()) } else { Err("ชื่อไฟล์ไม่ถูกต้อง".into()) }
}

/// เริ่มไฟล์บันทึกใหม่ในโฟลเดอร์ (ค่าเริ่มต้น: วิดีโอ/WebMix) — คืนเลขอ้างอิงของไฟล์
#[tauri::command]
async fn rec_open(app: AppHandle, state: State<'_, AppState>, name: String, dir: Option<String>) -> Result<serde_json::Value, String> {
    let name = safe_name(&name)?;
    let dir = dir.filter(|d| !d.is_empty()).map(PathBuf::from).unwrap_or_else(|| default_rec_dir(&app));
    let opened = match tokio::fs::create_dir_all(&dir).await {
        Ok(()) => tokio::fs::File::create(dir.join(&name)).await.map(|f| (f, dir.clone())),
        Err(e) => Err(e),
    };
    // Android รุ่นที่ไม่ให้เขียนโฟลเดอร์ Movies ตรง ๆ → ใช้ Movies ของแอปเอง (Android/data/<แอป>/files/Movies)
    #[cfg(target_os = "android")]
    let opened = match opened {
        Ok(v) => Ok(v),
        Err(_) => {
            let alt = app.path().video_dir().map_err(|e| e.to_string())?.join("WebMix");
            tokio::fs::create_dir_all(&alt).await.map_err(|e| format!("สร้างโฟลเดอร์ {} ไม่ได้: {e}", alt.display()))?;
            tokio::fs::File::create(alt.join(&name)).await.map(|f| (f, alt))
        }
    };
    let (file, dir) = opened.map_err(|e| format!("สร้างไฟล์ใน {} ไม่ได้: {e}", dir.display()))?;
    let path = dir.join(&name);
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.recordings.lock().await.insert(id, Recording { file, path: path.clone(), len: 0 });
    Ok(serde_json::json!({ "id": id, "path": path.to_string_lossy(), "dir": dir.to_string_lossy() }))
}

fn header<'a>(req: &'a Request<'_>, key: &str) -> Result<&'a str, String> {
    req.headers().get(key).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("missing {key}"))
}

fn body_bytes<'a>(req: &'a Request<'_>) -> Result<&'a [u8], String> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b),
        _ => Err("expected binary body".into()),
    }
}

/// ต่อท้ายไฟล์ (ข้อมูลวิดีโอแบบ binary — ไม่แปลงเป็น JSON)
#[tauri::command]
async fn rec_write(state: State<'_, AppState>, request: Request<'_>) -> Result<u64, String> {
    let id: u32 = header(&request, "x-rec-id")?.parse().map_err(|_| "bad id")?;
    let data = body_bytes(&request)?;
    let mut recs = state.recordings.lock().await;
    let rec = recs.get_mut(&id).ok_or("ไม่พบไฟล์บันทึก")?;
    rec.file.write_all(data).await.map_err(|e| format!("เขียนไฟล์ไม่สำเร็จ: {e}"))?;
    rec.len += data.len() as u64;
    Ok(rec.len)
}

/// เขียนทับตามตำแหน่ง (แก้ส่วนหัว WebM: ความยาว + ดัชนีเลื่อนหาตำแหน่ง) แล้วกลับไปท้ายไฟล์
#[tauri::command]
async fn rec_patch(state: State<'_, AppState>, request: Request<'_>) -> Result<(), String> {
    let id: u32 = header(&request, "x-rec-id")?.parse().map_err(|_| "bad id")?;
    let pos: u64 = header(&request, "x-position")?.parse().map_err(|_| "bad position")?;
    let data = body_bytes(&request)?;
    let mut recs = state.recordings.lock().await;
    let rec = recs.get_mut(&id).ok_or("ไม่พบไฟล์บันทึก")?;
    if pos + data.len() as u64 > rec.len {
        return Err("ตำแหน่งเกินขนาดไฟล์".into());
    }
    rec.file.seek(std::io::SeekFrom::Start(pos)).await.map_err(|e| e.to_string())?;
    rec.file.write_all(data).await.map_err(|e| e.to_string())?;
    rec.file.seek(std::io::SeekFrom::End(0)).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn rec_close(state: State<'_, AppState>, id: u32) -> Result<serde_json::Value, String> {
    let mut rec = state.recordings.lock().await.remove(&id).ok_or("ไม่พบไฟล์บันทึก")?;
    rec.file.flush().await.map_err(|e| e.to_string())?;
    rec.file.sync_all().await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": rec.path.to_string_lossy(), "bytes": rec.len }))
}

/// โหมดทดสอบตัวเอง (WEBMIX_SELFTEST=1): หน้า WebMix ส่งผลตรวจความสามารถของ webview มาที่นี่ แล้วแอปปิดตัวเอง
#[tauri::command]
fn selftest_report(app: AppHandle, report: serde_json::Value) {
    let json = serde_json::to_string(&report).unwrap_or_default();
    println!("WEBMIX_SELFTEST {json}");
    #[cfg(target_os = "android")]
    android::log("WebMix", &format!("WEBMIX_SELFTEST {json}"));
    // บน Windows แอปไม่มีหน้าต่าง console ให้พิมพ์ — CI อ่านผลจากไฟล์แทน
    if let Ok(out) = std::env::var("WEBMIX_SELFTEST_OUT") {
        let tmp = format!("{out}.part");
        if std::fs::write(&tmp, &json).is_ok() {
            let _ = std::fs::rename(&tmp, &out);
        }
    }
    let ok = report.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false);
    app.exit(if ok { 0 } else { 1 });
}

/// WebKitGTK (Linux) ปิดกล้อง/ไมค์, WebRTC และ MediaRecorder ไว้เป็นค่าเริ่มต้น — เปิดให้หน้า WebMix ของแอปเอง
/// แล้วโหลดหน้าใหม่ (ความสามารถเหล่านี้มีผลกับหน้าที่โหลดหลังตั้งค่า) และอนุญาตคำขอใช้กล้อง/ไมค์/จับภาพหน้าจอ
/// (หน้าในแอปเป็นไฟล์ของแอปเท่านั้น)
#[cfg(target_os = "linux")]
fn enable_linux_media(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|pv| {
        use webkit2gtk::glib::prelude::{Cast, ObjectExt};
        use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};
        let view = pv.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
            settings.set_enable_media_capabilities(true);
            settings.set_javascript_can_open_windows_automatically(true);
            // enable-webrtc มีตั้งแต่ WebKitGTK 2.38 — ตั้งเฉพาะเมื่อเวอร์ชันที่ติดตั้งรองรับ
            for prop in ["enable-webrtc", "enable-media"] {
                if settings.find_property(prop).is_some() {
                    settings.set_property(prop, true);
                }
            }
            webkit_features::enable(&settings, &["MediaRecorder", "MediaDevices", "ScreenCapture", "PeerConnection"]);
        }
        view.connect_permission_request(|_, req| {
            if req.downcast_ref::<UserMediaPermissionRequest>().is_some() {
                req.allow();
                return true;
            }
            false
        });
        view.reload();
    });
}

/// เปิด "feature" ของ WebKitGTK (API มีตั้งแต่ 2.42) — หาฟังก์ชันตอนรันด้วย dlsym
/// เพื่อให้แอปยังเปิดได้บน WebKitGTK รุ่นเก่าที่ไม่มี API นี้
#[cfg(target_os = "linux")]
mod webkit_features {
    use std::ffi::{c_char, c_void, CStr};
    use webkit2gtk::glib::translate::ToGlibPtr;

    extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    unsafe fn sym<T>(name: &CStr) -> Option<T> {
        // RTLD_DEFAULT (glibc) = 0: หาในไลบรารีที่โหลดอยู่แล้วทั้งหมด
        let p = dlsym(std::ptr::null_mut(), name.as_ptr());
        (!p.is_null()).then(|| std::mem::transmute_copy(&p))
    }

    pub fn enable(settings: &webkit2gtk::Settings, wanted: &[&str]) {
        type AllFeatures = unsafe extern "C" fn() -> *mut c_void;
        type ListLen = unsafe extern "C" fn(*mut c_void) -> usize;
        type ListGet = unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void;
        type Ident = unsafe extern "C" fn(*mut c_void) -> *const c_char;
        type SetEnabled = unsafe extern "C" fn(*mut c_void, *mut c_void, i32);
        type Unref = unsafe extern "C" fn(*mut c_void);
        unsafe {
            let (Some(all), Some(len), Some(get), Some(ident), Some(set), Some(unref)) = (
                sym::<AllFeatures>(c"webkit_settings_get_all_features"),
                sym::<ListLen>(c"webkit_feature_list_get_length"),
                sym::<ListGet>(c"webkit_feature_list_get"),
                sym::<Ident>(c"webkit_feature_get_identifier"),
                sym::<SetEnabled>(c"webkit_settings_set_feature_enabled"),
                sym::<Unref>(c"webkit_feature_list_unref"),
            ) else {
                return;
            };
            let list = all();
            if list.is_null() {
                return;
            }
            let raw: *mut webkit2gtk::ffi::WebKitSettings = settings.to_glib_none().0;
            for i in 0..len(list) {
                let f = get(list, i);
                let id = ident(f);
                if !id.is_null() && wanted.iter().any(|w| CStr::from_ptr(id).to_bytes() == w.as_bytes()) {
                    set(raw.cast(), f, 1);
                }
            }
            unref(list);
        }
    }
}

/// ลบไฟล์ทดสอบที่โหมดทดสอบตัวเองสร้างไว้ (เฉพาะไฟล์ webmix-selftest-* ในโฟลเดอร์ชั่วคราว)
#[tauri::command]
async fn selftest_cleanup(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let in_temp = p.parent() == Some(scratch_dir(&app).as_path());
    let named = p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("webmix-selftest-"));
    if !in_temp || !named {
        return Err("ไม่ใช่ไฟล์ทดสอบ".into());
    }
    tokio::fs::remove_file(p).await.map_err(|e| e.to_string())
}

/// ส่วนเฉพาะ Android: system property, log (logcat) และตำแหน่ง native library ของแอป
#[cfg(target_os = "android")]
mod android {
    use std::ffi::{c_char, c_int, CStr, CString};
    use std::path::PathBuf;

    extern "C" {
        fn __system_property_get(name: *const c_char, value: *mut c_char) -> c_int;
    }
    #[link(name = "log")]
    extern "C" {
        fn __android_log_write(prio: c_int, tag: *const c_char, text: *const c_char) -> c_int;
    }

    pub fn system_property(name: &str) -> Option<String> {
        let name = CString::new(name).ok()?;
        let mut buf = [0 as c_char; 92]; // PROP_VALUE_MAX
        let n = unsafe { __system_property_get(name.as_ptr(), buf.as_mut_ptr()) };
        (n > 0).then(|| unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned())
    }

    /// เขียนลง logcat — CI อ่านผลทดสอบตัวเองด้วย `adb logcat -s WebMix`
    pub fn log(tag: &str, text: &str) {
        let tag = CString::new(tag).unwrap();
        // logcat ตัดข้อความยาว — แบ่งเป็นช่วงละ 3000 ไบต์ (ตัดที่ขอบตัวอักษร)
        let mut rest = text;
        while !rest.is_empty() {
            let mut end = rest.len().min(3000);
            while !rest.is_char_boundary(end) {
                end -= 1;
            }
            if let Ok(msg) = CString::new(&rest[..end]) {
                unsafe { __android_log_write(4, tag.as_ptr(), msg.as_ptr()) };
            }
            rest = &rest[end..];
        }
    }

    /// Android ทิ้ง stderr — ส่งข้อความของ Gateway/ffmpeg (eprintln) ไป logcat (tag WebMixGateway) แทน
    pub fn stderr_to_logcat() {
        use std::io::BufRead;
        use std::os::fd::FromRawFd;
        extern "C" {
            fn pipe(fds: *mut c_int) -> c_int;
            fn dup2(old: c_int, new: c_int) -> c_int;
        }
        let mut fds = [0 as c_int; 2];
        unsafe {
            if pipe(fds.as_mut_ptr()) != 0 || dup2(fds[1], 2) < 0 {
                return;
            }
        }
        let read = unsafe { std::fs::File::from_raw_fd(fds[0]) };
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(read).lines().map_while(Result::ok) {
                log("WebMixGateway", &line);
            }
        });
    }

    /// ไม่ให้จอดับระหว่างใช้งาน (FLAG_KEEP_SCREEN_ON) — จอดับแล้ว Android หยุดกล้องและการสตรีม
    pub fn keep_screen_on(window: &tauri::WebviewWindow) {
        let _ = window.with_webview(|pv| {
            pv.jni_handle().exec(|env, activity, _webview| {
                if let Ok(win) = env.call_method(activity, "getWindow", "()Landroid/view/Window;", &[]).and_then(|w| w.l()) {
                    let _ = env.call_method(&win, "addFlags", "(I)V", &[jni::objects::JValue::Int(128)]);
                }
            });
        });
    }

    /// โฟลเดอร์ที่ระบบแตกไฟล์ native library ของแอปไว้ (หาจากไลบรารีของแอปเองที่โหลดอยู่ใน /proc/self/maps)
    pub fn native_lib_dir() -> Option<PathBuf> {
        let maps = std::fs::read_to_string("/proc/self/maps").ok()?;
        maps.lines()
            .filter_map(|l| l.split_whitespace().nth(5))
            .find(|p| p.ends_with("/libwebmix_desktop_lib.so"))
            .and_then(|p| PathBuf::from(p).parent().map(PathBuf::from))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![desktop_info, pick_folder, rec_open, rec_write, rec_patch, rec_close, selftest_report, selftest_cleanup])
        .setup(|app| {
            #[cfg(mobile)]
            {
                let _main = WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?;
                #[cfg(target_os = "android")]
                {
                    android::stderr_to_logcat();
                    android::keep_screen_on(&_main);
                }
            }
            #[cfg(desktop)]
            create_desktop_window(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WebMix Pro");
}

#[cfg(desktop)]
fn create_desktop_window(app: &mut tauri::App) -> tauri::Result<()> {
        // หน้าต่างหลักสร้างที่นี่ (ไม่ใช่ใน tauri.conf.json) เพื่อรับ window.open ของหน้า WebMix
        // (หน้าต่าง Program Output / Multiview) แล้วเปิดเป็นหน้าต่างจริงที่ผูกกับหน้าหลัก —
        // หน้าหลักเขียนเนื้อหาและส่งภาพ (srcObject) เข้าไปได้เหมือนในเบราว์เซอร์
        let handle = app.handle().clone();
        let popups = AtomicU32::new(0);
        let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
            .title("WebMix Pro")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1024.0, 640.0)
            .center()
            .on_new_window(move |url, features| {
                let n = popups.fetch_add(1, Ordering::Relaxed);
                let builder = WebviewWindowBuilder::new(&handle, format!("popup-{n}"), WebviewUrl::External(url.clone()))
                    .title("WebMix Pro")
                    .window_features(features)
                    .on_document_title_changed(|w, title| {
                        let _ = w.set_title(&title);
                    });
                match builder.build() {
                    Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                    Err(_) => tauri::webview::NewWindowResponse::Deny,
                }
            })
            .build()?;
        #[cfg(target_os = "linux")]
        enable_linux_media(&main);
        let _ = main;
        Ok(())
}
