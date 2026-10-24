//! NDI® และ OMT (Open Media Transport): รับ/ส่งภาพและเสียงคุณภาพสูงในวง LAN กับ vMix, OBS, กล้อง PTZ ฯลฯ
//!
//! โหลดไลบรารีตอนใช้งาน (ไม่ลิงก์ตอนคอมไพล์) — ไม่มีไลบรารีก็ยังใช้ส่วนอื่นได้ตามปกติ
//!   NDI: ใช้ NDI Runtime ที่ผู้ใช้ติดตั้งเอง (ฟรีใน NDI Tools — https://ndi.video/tools) · ไลบรารีของ NDI แจกต่อเองไม่ได้
//!   OMT: libomt + libvmx (MIT) มากับแอป หรือวางไว้ข้างโปรแกรม
//! ตั้ง WEBMIX_NDI_LIB / WEBMIX_OMT_LIB เป็นพาธของไลบรารีเพื่อบังคับใช้ไฟล์ที่ต้องการได้
//!
//! โครงสร้างข้อมูลตาม Processing.NDI.*.h (MIT) และ libomt.h (MIT)

use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use libloading::Library;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Proto {
    Ndi,
    Omt,
}

impl Proto {
    pub fn parse(s: &str) -> Option<Proto> {
        match s {
            "ndi" => Some(Proto::Ndi),
            "omt" => Some(Proto::Omt),
            _ => None,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Proto::Ndi => "NDI",
            Proto::Omt => "OMT",
        }
    }
}

/// ndi://ชื่อ หรือ omt://ชื่อ → (โปรโตคอล, ชื่อแหล่งที่จะประกาศในวง LAN)
pub fn parse_url(url: &str) -> Option<(Proto, String)> {
    let (scheme, rest) = url.split_once("://")?;
    let proto = Proto::parse(&scheme.to_ascii_lowercase())?;
    let name: String = rest.trim().trim_end_matches('/').chars().filter(|c| !c.is_control()).take(60).collect();
    (!name.is_empty()).then_some((proto, name))
}

/// รูปแบบพิกเซลของเฟรมที่ได้รับ (ชื่อตาม ffmpeg -pix_fmt)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pix {
    Uyvy,
    Bgra,
    Rgba,
}

impl Pix {
    pub fn ffmpeg(self) -> &'static str {
        match self {
            Pix::Uyvy => "uyvy422",
            Pix::Bgra => "bgra",
            Pix::Rgba => "rgba",
        }
    }
    pub fn bytes(self) -> usize {
        match self {
            Pix::Uyvy => 2,
            _ => 4,
        }
    }
}

pub struct VideoFrame {
    pub pix: Pix,
    pub width: u32,
    pub height: u32,
    pub fps: (i32, i32),
    /// พิกเซลเรียงชิดกัน (ตัดส่วนเกินของ stride ออกแล้ว)
    pub data: Vec<u8>,
}

pub struct AudioFrame {
    pub rate: u32,
    /// สเตอริโอแบบสลับช่อง (L R L R …) — แปลงจากหลายช่อง/โมโนแล้ว
    pub stereo: Vec<f32>,
}

pub enum Frame {
    Video(VideoFrame),
    Audio(AudioFrame),
    None,
}

/// คัดลอกภาพที่มี stride ให้เรียงชิดกัน
pub fn pack_rows(src: &[u8], stride: usize, row: usize, rows: usize) -> Vec<u8> {
    if stride == row {
        return src[..row * rows].to_vec();
    }
    let mut out = Vec::with_capacity(row * rows);
    for y in 0..rows {
        out.extend_from_slice(&src[y * stride..y * stride + row]);
    }
    out
}

/// เสียงแบบแยกช่อง (planar) → สเตอริโอสลับช่อง: โมโนซ้ำสองข้าง · มากกว่า 2 ช่องใช้ 2 ช่องแรก
pub fn planar_to_stereo(planar: &[f32], channels: usize, samples: usize, channel_stride: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(samples * 2);
    if channels == 0 {
        out.resize(samples * 2, 0.0);
        return out;
    }
    let right = if channels > 1 { channel_stride } else { 0 };
    for i in 0..samples {
        out.push(planar[i]);
        out.push(planar[right + i]);
    }
    out
}

/// สเตอริโอสลับช่อง → แยกช่อง (สำหรับส่งออก)
pub fn stereo_to_planar(stereo: &[f32]) -> Vec<f32> {
    let n = stereo.len() / 2;
    let mut out = vec![0.0f32; n * 2];
    for i in 0..n {
        out[i] = stereo[i * 2];
        out[n + i] = stereo[i * 2 + 1];
    }
    out
}

/// แปลงอัตราสุ่มแบบเส้นตรง (ใช้เมื่อแหล่งไม่ใช่ 48 kHz ซึ่งพบน้อย)
pub fn resample_stereo(stereo: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || from == 0 || stereo.len() < 4 {
        return stereo.to_vec();
    }
    let n = stereo.len() / 2;
    let m = ((n as u64 * to as u64) / from as u64).max(1) as usize;
    let mut out = Vec::with_capacity(m * 2);
    for j in 0..m {
        let pos = j as f64 * (n - 1) as f64 / (m.max(2) - 1) as f64;
        let i = pos.floor() as usize;
        let f = (pos - i as f64) as f32;
        let k = (i + 1).min(n - 1);
        for c in 0..2 {
            out.push(stereo[i * 2 + c] * (1.0 - f) + stereo[k * 2 + c] * f);
        }
    }
    out
}

fn exe_dirs() -> Vec<PathBuf> {
    let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) else { return vec![] };
    let mut v = vec![dir.join("omt"), dir.clone(), dir.join("resources").join("omt"), dir.join("../Resources/omt"), dir.join("../Resources")];
    // Linux (.deb/.rpm): ไฟล์ประกอบอยู่ที่ /usr/lib/<ชื่อแอป>/
    v.push(PathBuf::from("/usr/lib/WebMix Pro/omt"));
    v.push(PathBuf::from("/usr/lib/webmix-pro/omt"));
    if let Ok(appdir) = std::env::var("APPDIR") {
        v.push(PathBuf::from(&appdir).join("usr/lib/WebMix Pro/omt"));
    }
    v
}

fn open_first(cands: &[PathBuf]) -> Result<Library, String> {
    let mut last = String::new();
    for c in cands {
        // ชื่อไฟล์เปล่า = ให้ระบบค้นหาเอง (PATH / ld.so) · พาธเต็ม = ต้องมีไฟล์อยู่จริง
        if c.components().count() > 1 && !c.exists() {
            continue;
        }
        match unsafe { Library::new(c) } {
            Ok(l) => return Ok(l),
            Err(e) => last = e.to_string(),
        }
    }
    Err(last)
}

/* --------------------------------------------------------------------- NDI */

#[repr(C)]
#[derive(Clone, Copy)]
struct NdiSource {
    name: *const c_char,
    url: *const c_char,
}

#[repr(C)]
struct NdiFindCreate {
    show_local_sources: bool,
    groups: *const c_char,
    extra_ips: *const c_char,
}

#[repr(C)]
struct NdiSendCreate {
    name: *const c_char,
    groups: *const c_char,
    clock_video: bool,
    clock_audio: bool,
}

#[repr(C)]
struct NdiRecvCreate {
    source: NdiSource,
    color_format: i32,
    bandwidth: i32,
    allow_video_fields: bool,
    recv_name: *const c_char,
}

#[repr(C)]
struct NdiVideo {
    xres: i32,
    yres: i32,
    fourcc: u32,
    frame_rate_n: i32,
    frame_rate_d: i32,
    aspect: f32,
    format: i32,
    timecode: i64,
    data: *mut u8,
    line_stride: i32,
    metadata: *const c_char,
    timestamp: i64,
}

#[repr(C)]
struct NdiAudio {
    sample_rate: i32,
    channels: i32,
    samples: i32,
    timecode: i64,
    data: *mut f32,
    channel_stride: i32,
    metadata: *const c_char,
    timestamp: i64,
}

#[repr(C)]
struct NdiMeta {
    length: i32,
    timecode: i64,
    data: *mut c_char,
}

const fn fourcc(s: &[u8; 4]) -> u32 {
    (s[0] as u32) | (s[1] as u32) << 8 | (s[2] as u32) << 16 | (s[3] as u32) << 24
}
const NDI_UYVY: u32 = fourcc(b"UYVY");
const NDI_BGRA: u32 = fourcc(b"BGRA");
const NDI_BGRX: u32 = fourcc(b"BGRX");
const NDI_RGBA: u32 = fourcc(b"RGBA");
const NDI_RGBX: u32 = fourcc(b"RGBX");
const NDI_PROGRESSIVE: i32 = 1;
const NDI_TIMECODE_SYNTH: i64 = i64::MAX;
const NDI_FRAME_VIDEO: i32 = 1;
const NDI_FRAME_AUDIO: i32 = 2;
const NDI_FRAME_METADATA: i32 = 3;
const NDI_COLOR_UYVY_BGRA: i32 = 1;
const NDI_BANDWIDTH_HIGHEST: i32 = 100;

type Inst = *mut c_void;

struct NdiLib {
    _lib: Library,
    find_create: unsafe extern "C" fn(*const NdiFindCreate) -> Inst,
    find_sources: unsafe extern "C" fn(Inst, *mut u32) -> *const NdiSource,
    find_wait: unsafe extern "C" fn(Inst, u32) -> bool,
    send_create: unsafe extern "C" fn(*const NdiSendCreate) -> Inst,
    send_destroy: unsafe extern "C" fn(Inst),
    send_video: unsafe extern "C" fn(Inst, *const NdiVideo),
    send_audio: unsafe extern "C" fn(Inst, *const NdiAudio),
    send_connections: unsafe extern "C" fn(Inst, u32) -> i32,
    recv_create: unsafe extern "C" fn(*const NdiRecvCreate) -> Inst,
    recv_destroy: unsafe extern "C" fn(Inst),
    recv_capture: unsafe extern "C" fn(Inst, *mut NdiVideo, *mut NdiAudio, *mut NdiMeta, u32) -> i32,
    recv_free_video: unsafe extern "C" fn(Inst, *const NdiVideo),
    recv_free_audio: unsafe extern "C" fn(Inst, *const NdiAudio),
    recv_free_meta: unsafe extern "C" fn(Inst, *const NdiMeta),
    version: String,
}

unsafe impl Send for NdiLib {}
unsafe impl Sync for NdiLib {}

fn ndi_candidates() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(p) = std::env::var("WEBMIX_NDI_LIB") {
        v.push(PathBuf::from(p));
    }
    #[cfg(target_os = "windows")]
    {
        for env in ["NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5", "NDI_RUNTIME_DIR_V4"] {
            if let Ok(d) = std::env::var(env) {
                v.push(PathBuf::from(d).join("Processing.NDI.Lib.x64.dll"));
            }
        }
        v.push(PathBuf::from("Processing.NDI.Lib.x64.dll"));
    }
    #[cfg(target_os = "macos")]
    {
        for env in ["NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5"] {
            if let Ok(d) = std::env::var(env) {
                v.push(PathBuf::from(d).join("libndi.dylib"));
            }
        }
        for p in ["/usr/local/lib/libndi.dylib", "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib", "/Library/NDI 6 SDK/lib/macOS/libndi.dylib", "/Applications/NDI Video Monitor.app/Contents/Frameworks/libndi_advanced.dylib"] {
            v.push(PathBuf::from(p));
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        for env in ["NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5"] {
            if let Ok(d) = std::env::var(env) {
                v.push(PathBuf::from(d).join("libndi.so"));
            }
        }
        for n in ["libndi.so.6", "libndi.so.5", "libndi.so.4", "libndi.so"] {
            v.push(PathBuf::from(n));
        }
    }
    v
}

pub const NDI_MISSING: &str = "ไม่พบ NDI Runtime ในเครื่องนี้ — ติดตั้ง NDI Tools (ฟรี) จาก https://ndi.video/tools แล้วเปิดแอปใหม่";

fn ndi() -> Result<&'static NdiLib, String> {
    static LIB: OnceLock<Result<NdiLib, String>> = OnceLock::new();
    LIB.get_or_init(|| unsafe {
        let lib = open_first(&ndi_candidates()).map_err(|e| {
            eprintln!("NDI runtime not found: {e}");
            NDI_MISSING.to_string()
        })?;
        macro_rules! sym {
            ($n:literal) => {
                *lib.get(concat!($n, "\0").as_bytes()).map_err(|e| format!("NDI Runtime เวอร์ชันนี้ใช้ไม่ได้ ({}: {e})", $n))?
            };
        }
        let init: unsafe extern "C" fn() -> bool = sym!("NDIlib_initialize");
        let version: unsafe extern "C" fn() -> *const c_char = sym!("NDIlib_version");
        if !init() {
            return Err("NDI ใช้กับ CPU เครื่องนี้ไม่ได้ (ต้องรองรับ SSE4.2)".into());
        }
        let version = CStr::from_ptr(version()).to_string_lossy().into_owned();
        Ok(NdiLib {
            find_create: sym!("NDIlib_find_create_v2"),
            find_sources: sym!("NDIlib_find_get_current_sources"),
            find_wait: sym!("NDIlib_find_wait_for_sources"),
            send_create: sym!("NDIlib_send_create"),
            send_destroy: sym!("NDIlib_send_destroy"),
            send_video: sym!("NDIlib_send_send_video_v2"),
            send_audio: sym!("NDIlib_send_send_audio_v2"),
            send_connections: sym!("NDIlib_send_get_no_connections"),
            recv_create: sym!("NDIlib_recv_create_v3"),
            recv_destroy: sym!("NDIlib_recv_destroy"),
            recv_capture: sym!("NDIlib_recv_capture_v2"),
            recv_free_video: sym!("NDIlib_recv_free_video_v2"),
            recv_free_audio: sym!("NDIlib_recv_free_audio_v2"),
            recv_free_meta: sym!("NDIlib_recv_free_metadata"),
            version,
            _lib: lib,
        })
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// ตัวค้นหาแหล่ง NDI ตัวเดียวทั้งโปรแกรม — ค้นต่อเนื่องเบื้องหลัง รายการจึงพร้อมทันทีเมื่อเปิดหน้าต่างเลือก
struct Finder(Inst);
unsafe impl Send for Finder {}

fn ndi_sources(wait_ms: u32) -> Result<Vec<String>, String> {
    let lib = ndi()?;
    static FINDER: OnceLock<Mutex<Finder>> = OnceLock::new();
    let f = FINDER.get_or_init(|| {
        let c = NdiFindCreate { show_local_sources: true, groups: std::ptr::null(), extra_ips: std::ptr::null() };
        Mutex::new(Finder(unsafe { (lib.find_create)(&c) }))
    });
    let f = f.lock().unwrap();
    if f.0.is_null() {
        return Err("เปิดตัวค้นหา NDI ไม่ได้".into());
    }
    unsafe {
        let mut n = 0u32;
        let mut list = (lib.find_sources)(f.0, &mut n);
        if n == 0 && wait_ms > 0 {
            (lib.find_wait)(f.0, wait_ms);
            list = (lib.find_sources)(f.0, &mut n);
        }
        Ok((0..n as usize).filter_map(|i| ptr_str((*list.add(i)).name)).collect())
    }
}

fn ptr_str(p: *const c_char) -> Option<String> {
    (!p.is_null()).then(|| unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned())
}

/* --------------------------------------------------------------------- OMT */

#[repr(C)]
struct OmtFrame {
    kind: i32,
    timestamp: i64,
    codec: u32,
    width: i32,
    height: i32,
    stride: i32,
    flags: i32,
    frame_rate_n: i32,
    frame_rate_d: i32,
    aspect: f32,
    color_space: i32,
    sample_rate: i32,
    channels: i32,
    samples: i32,
    data: *mut c_void,
    data_length: i32,
    compressed: *mut c_void,
    compressed_length: i32,
    metadata: *mut c_void,
    metadata_length: i32,
}

const OMT_VIDEO: i32 = 2;
const OMT_AUDIO: i32 = 4;
const OMT_UYVY: u32 = 0x5956_5955;
const OMT_BGRA: u32 = 0x4152_4742;
const OMT_FPA1: u32 = 0x3141_5046;
const OMT_PREF_UYVY_OR_BGRA: i32 = 1;
const OMT_QUALITY_DEFAULT: i32 = 0;
const OMT_COLOR_BT709: i32 = 709;

struct OmtLib {
    _vmx: Option<Library>,
    _lib: Library,
    discovery: unsafe extern "C" fn(*mut i32) -> *mut *mut c_char,
    recv_create: unsafe extern "C" fn(*const c_char, i32, i32, i32) -> Inst,
    recv_destroy: unsafe extern "C" fn(Inst),
    receive: unsafe extern "C" fn(Inst, i32, i32) -> *const OmtFrame,
    send_create: unsafe extern "C" fn(*const c_char, i32) -> Inst,
    send_destroy: unsafe extern "C" fn(Inst),
    send: unsafe extern "C" fn(Inst, *const OmtFrame) -> i32,
    send_connections: unsafe extern "C" fn(Inst) -> i32,
}

unsafe impl Send for OmtLib {}
unsafe impl Sync for OmtLib {}

fn omt_names() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("libomt.dll", "libvmx.dll")
    } else if cfg!(target_os = "macos") {
        ("libomt.dylib", "libvmx.dylib")
    } else {
        ("libomt.so", "libvmx.so")
    }
}

pub const OMT_MISSING: &str = "ไม่พบไลบรารี OMT (libomt + libvmx) — แอปบน Windows / macOS มีมาให้แล้ว · บน Linux วาง libomt.so และ libvmx.so ไว้ข้างโปรแกรม";

fn omt() -> Result<&'static OmtLib, String> {
    static LIB: OnceLock<Result<OmtLib, String>> = OnceLock::new();
    LIB.get_or_init(|| unsafe {
        let (omt_name, vmx_name) = omt_names();
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(p) = std::env::var("WEBMIX_OMT_LIB") {
            if let Some(d) = PathBuf::from(&p).parent() {
                dirs.push(d.to_path_buf());
            }
        }
        dirs.extend(exe_dirs());
        // โหลด libvmx จากโฟลเดอร์เดียวกันก่อน — Windows ไม่ค้นหา DLL ข้างไลบรารีที่โหลดด้วยพาธเต็ม
        let dir = dirs.iter().find(|d| d.join(omt_name).exists());
        let vmx = dir.and_then(|d| Library::new(d.join(vmx_name)).ok());
        let mut cands: Vec<PathBuf> = std::env::var("WEBMIX_OMT_LIB").ok().map(PathBuf::from).into_iter().collect();
        cands.extend(dirs.iter().map(|d| d.join(omt_name)));
        cands.push(PathBuf::from(omt_name));
        let lib = open_first(&cands).map_err(|e| {
            eprintln!("OMT library not found: {e}");
            OMT_MISSING.to_string()
        })?;
        macro_rules! sym {
            ($n:literal) => {
                *lib.get(concat!($n, "\0").as_bytes()).map_err(|e| format!("libomt เวอร์ชันนี้ใช้ไม่ได้ ({}: {e})", $n))?
            };
        }
        Ok(OmtLib {
            discovery: sym!("omt_discovery_getaddresses"),
            recv_create: sym!("omt_receive_create"),
            recv_destroy: sym!("omt_receive_destroy"),
            receive: sym!("omt_receive"),
            send_create: sym!("omt_send_create"),
            send_destroy: sym!("omt_send_destroy"),
            send: sym!("omt_send"),
            send_connections: sym!("omt_send_connections"),
            _vmx: vmx,
            _lib: lib,
        })
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn omt_sources() -> Result<Vec<String>, String> {
    let lib = omt()?;
    // DNS-SD ใช้เวลาค้นครู่หนึ่งหลังเริ่ม — ครั้งแรกรอได้สูงสุด 1.5 วินาที
    for i in 0..6 {
        let mut n = 0i32;
        let list = unsafe { (lib.discovery)(&mut n) };
        if n > 0 && !list.is_null() {
            return Ok((0..n as usize).filter_map(|i| ptr_str(unsafe { *list.add(i) })).collect());
        }
        if i < 5 {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    }
    Ok(vec![])
}

/* ------------------------------------------------------------- public API */

/// โหลดไลบรารีได้ไหม (ใช้แสดงสถานะในหน้าต่างเลือก) — Ok = รุ่นของไลบรารี
pub fn available(proto: Proto) -> Result<String, String> {
    match proto {
        Proto::Ndi => ndi().map(|l| l.version.clone()),
        Proto::Omt => omt().map(|_| "OMT".to_string()),
    }
}

/// รายชื่อแหล่งในวง LAN (บล็อกได้ถึง ~1.5 วินาที — เรียกจากเธรดแยก)
pub fn sources(proto: Proto) -> Result<Vec<String>, String> {
    let mut v = match proto {
        Proto::Ndi => ndi_sources(1500)?,
        Proto::Omt => omt_sources()?,
    };
    v.sort();
    v.dedup();
    Ok(v)
}

pub struct Receiver {
    proto: Proto,
    inst: Inst,
}
unsafe impl Send for Receiver {}

impl Receiver {
    pub fn new(proto: Proto, source: &str) -> Result<Receiver, String> {
        let name = CString::new(source).map_err(|_| "ชื่อแหล่งไม่ถูกต้อง".to_string())?;
        let inst = match proto {
            Proto::Ndi => {
                let lib = ndi()?;
                let me = CString::new("WebMix Pro").unwrap();
                let c = NdiRecvCreate {
                    source: NdiSource { name: name.as_ptr(), url: std::ptr::null() },
                    color_format: NDI_COLOR_UYVY_BGRA,
                    bandwidth: NDI_BANDWIDTH_HIGHEST,
                    allow_video_fields: false,
                    recv_name: me.as_ptr(),
                };
                unsafe { (lib.recv_create)(&c) }
            }
            Proto::Omt => {
                let lib = omt()?;
                unsafe { (lib.recv_create)(name.as_ptr(), OMT_VIDEO | OMT_AUDIO, OMT_PREF_UYVY_OR_BGRA, 0) }
            }
        };
        if inst.is_null() {
            return Err(format!("เปิดตัวรับ {} ไม่ได้", proto.label()));
        }
        Ok(Receiver { proto, inst })
    }

    /// รอเฟรมถัดไปได้นานสุด timeout_ms
    pub fn capture(&mut self, timeout_ms: u32) -> Frame {
        unsafe {
            match self.proto {
                Proto::Ndi => {
                    let lib = ndi().unwrap();
                    let mut v: NdiVideo = std::mem::zeroed();
                    let mut a: NdiAudio = std::mem::zeroed();
                    let mut m: NdiMeta = std::mem::zeroed();
                    match (lib.recv_capture)(self.inst, &mut v, &mut a, &mut m, timeout_ms) {
                        NDI_FRAME_VIDEO => {
                            let pix = match v.fourcc {
                                NDI_UYVY => Some(Pix::Uyvy),
                                NDI_BGRA | NDI_BGRX => Some(Pix::Bgra),
                                NDI_RGBA | NDI_RGBX => Some(Pix::Rgba),
                                _ => None,
                            };
                            let out = match pix {
                                Some(pix) if !v.data.is_null() && v.xres > 0 && v.yres > 0 => {
                                    let (w, h) = (v.xres as usize, v.yres as usize);
                                    let row = w * pix.bytes();
                                    let stride = (v.line_stride as usize).max(row);
                                    let src = std::slice::from_raw_parts(v.data, stride * h);
                                    Frame::Video(VideoFrame { pix, width: w as u32, height: h as u32, fps: (v.frame_rate_n, v.frame_rate_d.max(1)), data: pack_rows(src, stride, row, h) })
                                }
                                _ => Frame::None,
                            };
                            (lib.recv_free_video)(self.inst, &v);
                            out
                        }
                        NDI_FRAME_AUDIO => {
                            let out = if a.data.is_null() || a.samples <= 0 {
                                Frame::None
                            } else {
                                let ch = a.channels.max(0) as usize;
                                let stride = (a.channel_stride as usize / 4).max(a.samples as usize);
                                let src = std::slice::from_raw_parts(a.data, stride * ch.max(1));
                                Frame::Audio(AudioFrame { rate: a.sample_rate as u32, stereo: planar_to_stereo(src, ch, a.samples as usize, stride) })
                            };
                            (lib.recv_free_audio)(self.inst, &a);
                            out
                        }
                        NDI_FRAME_METADATA => {
                            (lib.recv_free_meta)(self.inst, &m);
                            Frame::None
                        }
                        _ => Frame::None,
                    }
                }
                Proto::Omt => {
                    let lib = omt().unwrap();
                    let f = (lib.receive)(self.inst, OMT_VIDEO | OMT_AUDIO, timeout_ms as i32);
                    if f.is_null() {
                        return Frame::None;
                    }
                    let f = &*f;
                    if f.kind == OMT_VIDEO && !f.data.is_null() && f.width > 0 && f.height > 0 {
                        let pix = if f.codec == OMT_UYVY { Pix::Uyvy } else if f.codec == OMT_BGRA || f.codec == fourcc(b"BGRX") { Pix::Bgra } else { return Frame::None };
                        let (w, h) = (f.width as usize, f.height as usize);
                        let row = w * pix.bytes();
                        let stride = (f.stride as usize).max(row);
                        let src = std::slice::from_raw_parts(f.data as *const u8, stride * h);
                        return Frame::Video(VideoFrame { pix, width: w as u32, height: h as u32, fps: (f.frame_rate_n, f.frame_rate_d.max(1)), data: pack_rows(src, stride, row, h) });
                    }
                    if f.kind == OMT_AUDIO && f.codec == OMT_FPA1 && !f.data.is_null() && f.samples > 0 {
                        let ch = f.channels.max(0) as usize;
                        let n = f.samples as usize;
                        let src = std::slice::from_raw_parts(f.data as *const f32, n * ch.max(1));
                        return Frame::Audio(AudioFrame { rate: f.sample_rate as u32, stereo: planar_to_stereo(src, ch, n, n) });
                    }
                    Frame::None
                }
            }
        }
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        unsafe {
            match self.proto {
                Proto::Ndi => (ndi().unwrap().recv_destroy)(self.inst),
                Proto::Omt => (omt().unwrap().recv_destroy)(self.inst),
            }
        }
    }
}

pub struct Sender {
    proto: Proto,
    inst: Inst,
    _name: CString,
}
unsafe impl Send for Sender {}
unsafe impl Sync for Sender {}

impl Sender {
    pub fn new(proto: Proto, name: &str) -> Result<Sender, String> {
        let cname = CString::new(name).map_err(|_| "ชื่อแหล่งไม่ถูกต้อง".to_string())?;
        let inst = match proto {
            Proto::Ndi => {
                let lib = ndi()?;
                // ไม่ให้ NDI หน่วงเวลาเอง — เฟรมมาตามเวลาจริงจาก ffmpeg อยู่แล้ว
                let c = NdiSendCreate { name: cname.as_ptr(), groups: std::ptr::null(), clock_video: false, clock_audio: false };
                unsafe { (lib.send_create)(&c) }
            }
            Proto::Omt => {
                let lib = omt()?;
                unsafe { (lib.send_create)(cname.as_ptr(), OMT_QUALITY_DEFAULT) }
            }
        };
        if inst.is_null() {
            return Err(format!("สร้างแหล่ง {} ไม่ได้ (ชื่อซ้ำกับแหล่งอื่นในเครื่องนี้?)", proto.label()));
        }
        Ok(Sender { proto, inst, _name: cname })
    }

    /// เฟรม UYVY ขนาด width × height (เรียงชิด) · fps = (ตัวเศษ, ตัวส่วน)
    pub fn video(&self, uyvy: &[u8], width: u32, height: u32, fps: (i32, i32)) {
        unsafe {
            match self.proto {
                Proto::Ndi => {
                    let v = NdiVideo {
                        xres: width as i32,
                        yres: height as i32,
                        fourcc: NDI_UYVY,
                        frame_rate_n: fps.0,
                        frame_rate_d: fps.1,
                        aspect: 0.0,
                        format: NDI_PROGRESSIVE,
                        timecode: NDI_TIMECODE_SYNTH,
                        data: uyvy.as_ptr() as *mut u8,
                        line_stride: (width * 2) as i32,
                        metadata: std::ptr::null(),
                        timestamp: 0,
                    };
                    (ndi().unwrap().send_video)(self.inst, &v);
                }
                Proto::Omt => {
                    let mut f: OmtFrame = std::mem::zeroed();
                    f.kind = OMT_VIDEO;
                    f.timestamp = -1;
                    f.codec = OMT_UYVY;
                    f.width = width as i32;
                    f.height = height as i32;
                    f.stride = (width * 2) as i32;
                    f.frame_rate_n = fps.0;
                    f.frame_rate_d = fps.1;
                    f.aspect = width as f32 / height.max(1) as f32;
                    f.color_space = OMT_COLOR_BT709;
                    f.data = uyvy.as_ptr() as *mut c_void;
                    f.data_length = uyvy.len() as i32;
                    (omt().unwrap().send)(self.inst, &f);
                }
            }
        }
    }

    /// เสียงสเตอริโอสลับช่อง 48 kHz
    pub fn audio(&self, stereo: &[f32], rate: u32) {
        let n = stereo.len() / 2;
        if n == 0 {
            return;
        }
        let planar = stereo_to_planar(stereo);
        unsafe {
            match self.proto {
                Proto::Ndi => {
                    let a = NdiAudio {
                        sample_rate: rate as i32,
                        channels: 2,
                        samples: n as i32,
                        timecode: NDI_TIMECODE_SYNTH,
                        data: planar.as_ptr() as *mut f32,
                        channel_stride: (n * 4) as i32,
                        metadata: std::ptr::null(),
                        timestamp: 0,
                    };
                    (ndi().unwrap().send_audio)(self.inst, &a);
                }
                Proto::Omt => {
                    let mut f: OmtFrame = std::mem::zeroed();
                    f.kind = OMT_AUDIO;
                    f.timestamp = -1;
                    f.codec = OMT_FPA1;
                    f.sample_rate = rate as i32;
                    f.channels = 2;
                    f.samples = n as i32;
                    f.data = planar.as_ptr() as *mut c_void;
                    f.data_length = (planar.len() * 4) as i32;
                    (omt().unwrap().send)(self.inst, &f);
                }
            }
        }
    }

    /// จำนวนเครื่องที่กำลังรับภาพนี้อยู่
    pub fn connections(&self) -> i32 {
        unsafe {
            match self.proto {
                Proto::Ndi => (ndi().unwrap().send_connections)(self.inst, 0),
                // OMT นับวิดีโอและเสียงแยกกัน (ผู้รับหนึ่งเครื่อง = 2 การเชื่อมต่อ)
                Proto::Omt => ((omt().unwrap().send_connections)(self.inst) + 1) / 2,
            }
        }
    }
}

impl Drop for Sender {
    fn drop(&mut self) {
        unsafe {
            match self.proto {
                Proto::Ndi => (ndi().unwrap().send_destroy)(self.inst),
                Proto::Omt => (omt().unwrap().send_destroy)(self.inst),
            }
        }
    }
}

/// ทดสอบในเครื่อง: สร้างแหล่ง ส่งภาพสีและเสียง แล้วค้นหาและรับกลับมาเอง — ใช้ตรวจว่าไลบรารีทำงานจริง
pub fn selftest(proto: Proto) -> Result<String, String> {
    let version = available(proto)?;
    let name = format!("WebMix selftest {}", std::process::id());
    let sender = std::sync::Arc::new(Sender::new(proto, &name)?);
    let (w, h) = (320u32, 180u32);
    // ภาพสีเขียวล้วน (UYVY: U=44 Y=145 V=34)
    let frame: Vec<u8> = [44u8, 145, 34, 145].iter().copied().cycle().take((w * h * 2) as usize).collect();
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let pump = {
        let (sender, stop) = (sender.clone(), stop.clone());
        std::thread::spawn(move || {
            let tone: Vec<f32> = (0..1600).flat_map(|i| { let v = (i as f32 * 0.0577).sin() * 0.25; [v, v] }).collect();
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                sender.video(&frame, w, h, (30, 1));
                sender.audio(&tone, 48000);
                std::thread::sleep(std::time::Duration::from_millis(33));
            }
        })
    };
    let result = (|| {
        let started = std::time::Instant::now();
        let full = loop {
            let list = sources(proto)?;
            if let Some(n) = list.into_iter().find(|n| n.contains(&name)) {
                break n;
            }
            if started.elapsed().as_secs() > 15 {
                return Err(format!("ค้นหาแหล่ง {} ของตัวเองไม่เจอใน 15 วินาที", proto.label()));
            }
        };
        let mut rx = Receiver::new(proto, &full)?;
        let (mut video, mut audio) = (None, false);
        while started.elapsed().as_secs() < 25 && (video.is_none() || !audio) {
            match rx.capture(500) {
                Frame::Video(v) => video = Some((v.width, v.height, v.pix, v.data.get(1).copied())),
                Frame::Audio(a) => audio |= a.stereo.iter().any(|x| x.abs() > 0.05),
                Frame::None => {}
            }
        }
        let (vw, vh, pix, y) = video.ok_or("ไม่ได้รับภาพ")?;
        if !audio {
            return Err("ได้ภาพแต่ไม่ได้รับเสียง".into());
        }
        Ok(format!("{} {version}: found \"{full}\", received {vw}x{vh} {pix:?} (Y={y:?}) + audio, receivers seen by sender: {}", proto.label(), sender.connections()))
    })();
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = pump.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(parse_url("ndi://WebMix Program"), Some((Proto::Ndi, "WebMix Program".into())));
        assert_eq!(parse_url("OMT://Cam 1/"), Some((Proto::Omt, "Cam 1".into())));
        assert_eq!(parse_url("ndi://"), None);
        assert_eq!(parse_url("rtmp://x/app"), None);
    }

    #[test]
    fn audio_and_rows() {
        // planar L=[1,2] R=[3,4] (stride 3) → L R L R
        assert_eq!(planar_to_stereo(&[1.0, 2.0, 0.0, 3.0, 4.0, 0.0], 2, 2, 3), vec![1.0, 3.0, 2.0, 4.0]);
        assert_eq!(planar_to_stereo(&[5.0, 6.0], 1, 2, 2), vec![5.0, 5.0, 6.0, 6.0]);
        assert_eq!(stereo_to_planar(&[1.0, 3.0, 2.0, 4.0]), vec![1.0, 2.0, 3.0, 4.0]);
        assert_eq!(pack_rows(&[1, 2, 9, 3, 4, 9], 3, 2, 2), vec![1, 2, 3, 4]);
        let r = resample_stereo(&vec![0.5f32; 44100 * 2 / 10], 44100, 48000);
        assert_eq!(r.len(), 4800 * 2);
        assert!(r.iter().all(|v| (v - 0.5).abs() < 1e-6));
    }

    #[test]
    fn struct_layouts_match_the_c_headers() {
        // ขนาดบน 64 บิต ตามที่คำนวณจาก header ของ NDI / OMT
        if std::mem::size_of::<usize>() == 8 {
            assert_eq!(std::mem::size_of::<NdiVideo>(), 72);
            assert_eq!(std::mem::size_of::<NdiAudio>(), 56);
            assert_eq!(std::mem::size_of::<NdiRecvCreate>(), 40);
            assert_eq!(std::mem::size_of::<OmtFrame>(), 112);
            assert_eq!(std::mem::offset_of!(OmtFrame, data), 64);
            assert_eq!(std::mem::offset_of!(NdiVideo, line_stride), 48);
            assert_eq!(std::mem::size_of::<NdiSendCreate>(), 24);
        }
    }
}
