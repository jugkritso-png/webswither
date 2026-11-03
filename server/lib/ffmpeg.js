// คำสั่ง ffmpeg: ตัวเข้ารหัส, ปลายทาง RTMP/SRT, ตรวจปลายทาง, ภาพแนวตั้ง 9:16
const { spawn, spawnSync } = require('child_process');
const { FFMPEG, VIDEO_ENCODER, X264_PRESET } = require('./config');

// ตัวเลือกตัวเข้ารหัสวิดีโอ — การ์ดจอช่วยให้ 4K ลื่นบนเซิร์ฟเวอร์ที่ CPU ไม่แรงมาก
function videoArgs(height) {
  if (VIDEO_ENCODER === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-profile:v', 'high', '-bsf:v', 'dump_extra'];
  }
  if (VIDEO_ENCODER === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-profile:v', 'high', '-bsf:v', 'dump_extra'];
  }
  const preset = X264_PRESET || (height >= 1440 ? 'superfast' : 'veryfast');
  return ['-c:v', 'libx264', '-preset', preset, '-tune', 'zerolatency', '-profile:v', 'high'];
}
const RTMP_RE = /^rtmps?:\/\/[^\s]+$/i;
const SRT_RE = /^srt:\/\/[^\s/?#]+:\d+(\?[^\s]*)?$/i;
const OUTPUT_RE = url => RTMP_RE.test(url) || SRT_RE.test(url);
const SRT_SUPPORTED = (() => {
  try { return /^\s*srt\s*$/m.test(spawnSync(FFMPEG, ['-hide_banner', '-protocols'], { encoding: 'utf8' }).stdout || ''); }
  catch (e) { return false; }
})();

// SRT ส่ง MPEG-TS เป็นแพ็กเก็ตละ 1316 ไบต์ (7 × 188) ตามมาตรฐาน — ใส่ให้ถ้าผู้ใช้ไม่ได้กำหนด
// passphrase ส่งเป็นตัวเลือกของ ffmpeg แยกจาก URL เพราะ ffmpeg ไม่ถอดรหัส %xx ของ passphrase ใน URL
// (รหัสที่มี @ & = เว้นวรรค ฯลฯ จะได้ตรงกับฝั่งรับเสมอ) ส่วน streamid ffmpeg ถอดรหัสจาก URL ให้เองอยู่แล้ว
function outputArgs(url) {
  if (SRT_RE.test(url)) {
    const u = new URL(url);
    const opts = [];
    const passphrase = u.searchParams.get('passphrase');
    u.searchParams.delete('passphrase');
    if (passphrase) opts.push('-passphrase', passphrase);
    if (!u.searchParams.has('pkt_size')) u.searchParams.set('pkt_size', '1316');
    if (!u.searchParams.has('mode')) u.searchParams.set('mode', 'caller');
    return ['-f', 'mpegts', '-mpegts_flags', '+resend_headers', ...opts, `srt://${u.host}?${u.searchParams.toString()}`];
  }
  return ['-f', 'flv', url];
}
const RETRY_MS = 5000;
const PROBE_MS = 15000;

// ตรวจปลายทางโดยไม่ออกอากาศ: เชื่อมต่อ + ขอเผยแพร่ด้วยรหัสสตรีม (เซิร์ฟเวอร์ต้องตอบรับ) แต่ไม่ส่งภาพเลยสักเฟรม
// ส่งแค่หัวไฟล์ของแทร็กเสียงเปล่า แพลตฟอร์มจึงไม่เริ่มไลฟ์ — รหัสผิด/เซิร์ฟเวอร์ปฏิเสธ = ffmpeg เปิดปลายทางไม่ได้
function probeDest(url) {
  return new Promise(resolve => {
    const lines = [];
    const proc = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0', '-c:a', 'aac', ...outputArgs(url)], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve({ ok: false, message: `ปลายทางไม่ตอบภายใน ${PROBE_MS / 1000} วินาที — ตรวจที่อยู่ Server และไฟร์วอลล์` }); }, PROBE_MS);
    proc.stderr.on('data', b => lines.push(...String(b).split('\n').map(l => l.trim()).filter(Boolean)));
    proc.on('error', err => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, message: '' });
      else resolve({ ok: false, message: (lines.filter(l => !/Output file is empty/.test(l)).slice(-2).join(' · ') || `ffmpeg จบด้วยรหัส ${code}`).replace(/\b(rtmps?|srt):\/\/[^\s]+?(?=:?\s|:?$)/gi, m => maskUrl(m)).slice(0, 300) });
    });
  });
}

// ภาพแนวตั้ง 9:16 (TikTok / Reels / Shorts) สร้างจาก Program 16:9 ที่เข้ารหัสแล้ว — เข้ารหัสใหม่เฉพาะปลายทางแนวตั้ง
//   crop = ตัดกลางภาพให้เต็มจอแนวตั้ง · fit = ภาพเต็มกลางจอ พื้นหลังเป็นภาพเดิมขยายแล้วเบลอ
const VERTICAL_MODES = ['crop', 'fit'];
function verticalSize(height) { return height >= 1080 ? [1080, 1920] : [720, 1280]; }
function verticalFilter(mode, w, h) {
  if (mode === 'fit') {
    return `split=2[bg][fg];[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2[b];` +
      `[fg]scale=${w}:-2[f];[b][f]overlay=0:(H-h)/2,setsar=1`;
  }
  return `crop=ih*9/16:ih,scale=${w}:${h},setsar=1`;
}

// rtsp://user:pass@host → rtsp://***@host (ไม่ให้รหัสกล้องไปอยู่ใน log / หน้า admin)
const maskCreds = url => url.replace(/^(\w+:\/\/)[^@/]*@/, '$1***@');
const maskUrl = url => (/^srt:/i.test(url) ? url.replace(/\?.*$/, '?***') : url.replace(/[^/]+$/, '***'));

module.exports = { OUTPUT_RE, RETRY_MS, RTMP_RE, SRT_RE, SRT_SUPPORTED, VERTICAL_MODES, maskCreds, maskUrl, outputArgs, probeDest, verticalFilter, verticalSize, videoArgs };
