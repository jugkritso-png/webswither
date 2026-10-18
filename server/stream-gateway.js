// WebMix Stream Gateway — Multistream
// รับวิดีโอ (WebM/MP4 จาก MediaRecorder) ผ่าน WebSocket เข้ารหัสด้วย FFmpeg เพียงครั้งเดียว
// แล้วกระจายสัญญาณไปหลายปลายทาง RTMP/RTMPS และ SRT พร้อมกัน (YouTube, Facebook, Twitch, vMix, OBS, SRT server ฯลฯ)
// แต่ละปลายทางเริ่ม/หยุด/เชื่อมต่อใหม่ได้อิสระ — ปลายทางหนึ่งหลุดไม่กระทบปลายทางอื่น
//
// ใช้งาน:  cd server && npm install && npm start
// ตัวแปรแวดล้อม:
//   PORT          พอร์ตที่ให้บริการ (ค่าเริ่มต้น 8080)
//   STREAM_TOKEN  token ของผู้ดูแลระบบ — ไคลเอนต์ต้องส่ง ?token=... (ไม่ตั้งทั้งค่านี้และไฟล์ผู้ใช้ = ใครก็ใช้ได้ เหมาะกับวงแลนเท่านั้น)
//   FFMPEG_PATH   path ของ ffmpeg (ค่าเริ่มต้น "ffmpeg")
//   MAX_DESTINATIONS  จำนวนปลายทางสูงสุดต่อการเชื่อมต่อ (ค่าเริ่มต้น 6)
//   VIDEO_ENCODER libx264 (ค่าเริ่มต้น, ใช้ CPU) | h264_nvenc (การ์ดจอ NVIDIA) | h264_qsv (Intel Quick Sync)
//   X264_PRESET   preset ของ libx264 — ถ้าไม่ตั้ง จะใช้ veryfast สำหรับ ≤1080p และ superfast สำหรับ 1440p/4K
//
// โปรโตคอล (ข้อความ JSON แบบ text frame, วิดีโอเป็น binary frame):
//   client → { type: 'start', destinations: [{ id, name, url }] }   เริ่มเข้ารหัสและส่งไปทุกปลายทาง
//   client → { type: 'add', destination: { id, name, url } }        เพิ่ม/เริ่มปลายทางระหว่างไลฟ์
//   client → { type: 'stop', id }                                    หยุดเฉพาะปลายทางนั้น
//   server → { type: 'status', destinations: [{ id, name, state, message, kbps }] }
//            state: connecting | live | error | stopped
//   url: rtmp://… rtmps://… หรือ srt://host:port?streamid=…&passphrase=…&latency=… (SRT ส่งเป็น MPEG-TS)
//   (ยังรองรับแบบเดิม ?rtmp=URL สำหรับปลายทางเดียว)
//
// รับสัญญาณ SRT เข้ามาเป็น Input (ดูรายละเอียดที่ส่วน "SRT Input" ด้านล่าง):
//   ws /srt-in?token=…        client → { type: 'open', mode: 'listener'|'caller', port, url, streamid, passphrase, latency }
//                             server → { type: 'opened', id, port } แล้ว { type: 'status', state: waiting|connecting|live|error, info }
//   ws /srt-in/data?token=…&id=…   ข้อมูลภาพ MPEG-TS (binary) สำหรับ mpegts.js
//   SRT_PORTS     ช่วงพอร์ต UDP สำหรับโหมด listener (ค่าเริ่มต้น 9000-9009)
//
// ผู้ใช้หลายคน (ดู users.js): แต่ละคนมี token และโควตาของตัวเอง — node stream-gateway.js user add <ชื่อ>
//   USERS_FILE    ไฟล์รายชื่อผู้ใช้ (ค่าเริ่มต้น ./data/users.json)
//   MAX_STREAMS   จำนวนสตรีม (ตัวเข้ารหัส) พร้อมกันทั้งเซิร์ฟเวอร์ (0 = ไม่จำกัด)
//   MAX_SRT_INPUTS  จำนวน SRT ขาเข้าพร้อมกันทั้งเซิร์ฟเวอร์ (ค่าเริ่มต้น = จำนวนพอร์ตใน SRT_PORTS)
//   TRUST_PROXY=1 ใช้ IP จาก X-Forwarded-For (เมื่ออยู่หลัง Caddy/nginx)
// เฝ้าระวัง (ดู monitor.js): แจ้งเตือนผ่าน ALERT_WEBHOOK / Telegram, หน้า /admin?token=…, /metrics สำหรับ Prometheus
//
// กล้องมือถือ (ดูส่วน "PeerJS ของเราเอง + TURN"):
//   PEER_PORT     เปิด PeerJS server ของเราเองที่พอร์ตนี้ (path /peerjs)
//   TURN_SECRET   รหัสลับร่วมกับ coturn (static-auth-secret) · TURN_HOST / TURN_PORT ที่อยู่ของ TURN
//   GET /ice?token=…  →  { iceServers, peer: { host, port, path, secure }, expires }

const users = require('./users');
if (process.argv[2] === 'user') {
  try { users.cli(process.argv.slice(3)); process.exit(0); } catch (e) { console.error(e.message); process.exit(1); }
}

const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn, spawnSync } = require('child_process');
const monitor = require('./monitor');

const PORT = Number(process.env.PORT) || 8080;
const MAX_STREAMS = Number(process.env.MAX_STREAMS) || 0;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_DESTINATIONS = Number(process.env.MAX_DESTINATIONS) || 6;
const VIDEO_ENCODER = process.env.VIDEO_ENCODER || 'libx264';
const X264_PRESET = process.env.X264_PRESET || '';
const MAX_KBPS = 51000; // เพดานของ YouTube สำหรับ 4K60

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

const maskUrl = url => (/^srt:/i.test(url) ? url.replace(/\?.*$/, '?***') : url.replace(/[^/]+$/, '***'));

/* ==========================================================================
   ผู้ใช้, โควตา และการกันเดารหัส
   ========================================================================== */
// IP ของผู้ใช้จริง — หลัง reverse proxy ใช้ค่าขวาสุดของ X-Forwarded-For (ค่าที่ proxy ของเราใส่เอง ปลอมไม่ได้)
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',').pop().trim();
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
// ใส่ token ผิดเกิน 10 ครั้งใน 5 นาที → บล็อก IP นั้น 15 นาที
const failures = new Map();
const FAIL_LIMIT = 10, FAIL_WINDOW = 5 * 60 * 1000, BLOCK_MS = 15 * 60 * 1000;
function isBlocked(ip) {
  const f = failures.get(ip);
  return !!(f && f.blockedUntil > Date.now());
}
function authFailed(ip) {
  monitor.counters.authFailures++;
  const now = Date.now();
  let f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW) { f = { first: now, count: 0, blockedUntil: 0 }; failures.set(ip, f); }
  if (++f.count >= FAIL_LIMIT && !f.blockedUntil) {
    f.blockedUntil = now + BLOCK_MS;
    monitor.notify(`block:${ip}`, `บล็อก IP ${ip} 15 นาที — ใส่ token ผิด ${f.count} ครั้ง (อาจมีคนพยายามเดารหัส)`);
  }
}
setInterval(() => { const now = Date.now(); for (const [ip, f] of failures) if (now - f.first > FAIL_WINDOW && f.blockedUntil < now) failures.delete(ip); }, 60000).unref();

function authorize(req, token) {
  const ip = clientIp(req);
  if (isBlocked(ip)) return { error: 'too many attempts' };
  const user = users.authenticate(token);
  if (!user) { authFailed(ip); return { error: 'invalid token' }; }
  return { user, ip };
}

// การเชื่อมต่อทั้งหมด (สตรีมและ SRT ขาเข้า) — ใช้ตรวจโควตาและแสดงในหน้าผู้ดูแล
const sessions = new Map();
const sessionList = () => [...sessions.values()].map(s => s.snapshot());
const countFor = (kind, name, pred = () => true) => [...sessions.values()].filter(s => s.kind === kind && (name == null || s.user.name === name) && pred(s)).length;

// เมื่อสตรีมที่กำลังไลฟ์หลุดโดยไม่ได้กดหยุด และไม่กลับมาภายใน 30 วินาที → แจ้งเตือน
const dropTimers = new Map();
function streamDropped(name, ip) {
  clearTimeout(dropTimers.get(name));
  dropTimers.set(name, setTimeout(() => {
    dropTimers.delete(name);
    monitor.notify(`drop:${name}`, `สตรีมของ ${name} (${ip}) ขาดการเชื่อมต่อจาก WebMix และยังไม่กลับมา — ตรวจอินเทอร์เน็ตของเครื่องที่ไลฟ์`);
  }, 30000));
}
function streamBack(name) {
  if (dropTimers.has(name)) { clearTimeout(dropTimers.get(name)); dropTimers.delete(name); }
}

// หน้าเช็กสถานะ: เปิด https://โดเมน/ ในเบราว์เซอร์แล้วต้องเห็นข้อความ OK
/* ==========================================================================
   SRT Input — รับสัญญาณ SRT (จาก OBS, vMix, encoder, กล้อง) แล้วส่งต่อให้หน้า WebMix
   เบราว์เซอร์รับ SRT เองไม่ได้ จึงแปลงเป็น MPEG-TS ผ่าน WebSocket ให้ mpegts.js เล่น
   - /srt-in        ช่องควบคุม (JSON): เปิด/ปิด session และรายงานสถานะ
   - /srt-in/data   ช่องข้อมูลภาพ (binary MPEG-TS) สำหรับตัวเล่นในเบราว์เซอร์
   วิดีโอ H.264 ส่งต่อโดยไม่เข้ารหัสใหม่ (แทบไม่ใช้ CPU แม้เป็น 4K) — ถ้าเป็น HEVC ฯลฯ จะแปลงเป็น H.264 ให้อัตโนมัติ
   ========================================================================== */
const crypto = require('crypto');
const SRT_PORT_RANGE = (() => {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(process.env.SRT_PORTS || '9000-9009');
  return m ? [Number(m[1]), Number(m[2])] : [9000, 9009];
})();
const SRT_LATENCIES_MS = [120, 200, 500, 1000, 2000, 4000];
const ingests = new Map();
const usedPorts = new Set();

const MAX_SRT_INPUTS = Number(process.env.MAX_SRT_INPUTS) || 0;

function ingestControl(ws, req, auth) {
  const tag = `[${auth.ip} ${auth.user.name} srt-in]`;
  let s = null;
  const send = obj => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  const fail = message => { send({ type: 'error', message }); ws.close(1008, 'rejected'); };

  ws.on('message', (data, isBinary) => {
    if (isBinary || s) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    if (msg.type !== 'open') return;
    if (!SRT_SUPPORTED) return fail('ffmpeg ในเซิร์ฟเวอร์นี้ไม่รองรับ SRT');
    const lim = auth.user.limits;
    if (lim && countFor('srt-in', auth.user.name) >= lim.srt) return fail(`บัญชี ${auth.user.name} รับ SRT ได้พร้อมกันสูงสุด ${lim.srt} สัญญาณ`);
    if (MAX_SRT_INPUTS && countFor('srt-in') >= MAX_SRT_INPUTS) return fail(`เซิร์ฟเวอร์รับ SRT พร้อมกันได้สูงสุด ${MAX_SRT_INPUTS} สัญญาณ`);

    const mode = msg.mode === 'caller' ? 'caller' : 'listener';
    const latency = SRT_LATENCIES_MS.includes(Number(msg.latency)) ? Number(msg.latency) : 500;
    const passphrase = String(msg.passphrase || '');
    if (passphrase && (passphrase.length < 10 || passphrase.length > 64)) return fail('รหัสผ่าน SRT ต้องยาว 10–64 ตัวอักษร');
    let port = 0, target = '';
    if (mode === 'listener') {
      port = Number(msg.port);
      if (!Number.isInteger(port) || port < SRT_PORT_RANGE[0] || port > SRT_PORT_RANGE[1]) {
        return fail(`พอร์ตต้องอยู่ในช่วง ${SRT_PORT_RANGE[0]}–${SRT_PORT_RANGE[1]} (ตั้งด้วย SRT_PORTS บนเซิร์ฟเวอร์)`);
      }
      if (usedPorts.has(port)) return fail(`พอร์ต ${port} ถูกใช้โดย Input อื่นอยู่แล้ว`);
      usedPorts.add(port);
    } else {
      target = String(msg.url || '').trim();
      if (!SRT_RE.test(target)) return fail('URL ต้องอยู่ในรูปแบบ srt://host:port');
    }

    s = {
      id: crypto.randomBytes(12).toString('hex'), mode, port, target, latency, passphrase,
      streamid: String(msg.streamid || '').slice(0, 512),
      transcode: false, proc: null, viewers: new Set(), state: 'starting', info: null, message: '', closed: false, timer: null
    };
    ingests.set(s.id, s);
    const label = mode === 'listener' ? `UDP ${port}` : target.replace(/\?.*$/, '');
    sessions.set(s.id, {
      kind: 'srt-in', user: auth.user, startedAt: Date.now(),
      snapshot: () => ({ id: s.id, kind: 'srt-in', user: auth.user.name, ip: auth.ip, startedAt: sessions.get(s.id)?.startedAt, label, state: s.state, wasLive: !!s.wasLive, info: s.info })
    });
    console.log(`${tag} open ${mode} ${mode === 'listener' ? 'port ' + port : target.replace(/\?.*$/, '')}`);
    send({ type: 'opened', id: s.id, mode, port, portRange: SRT_PORT_RANGE });
    startIngest(s, send, tag);
  });

  ws.on('close', () => {
    if (!s) return;
    s.closed = true;
    clearTimeout(s.timer);
    if (s.proc) s.proc.kill('SIGKILL');
    for (const v of s.viewers) v.close(1000, 'closed');
    if (s.mode === 'listener') usedPorts.delete(s.port);
    ingests.delete(s.id);
    sessions.delete(s.id);
    monitor.forget(`srt:${s.id}`);
    console.log(`${tag} closed`);
  });
}

function startIngest(s, send, tag) {
  if (s.closed) return;
  const lat = String(s.latency * 1000);
  let input;
  if (s.mode === 'listener') {
    // timeout = ตรวจว่าผู้ส่งหายไปภายใน 3 วินาที (ไม่กระทบการรอผู้ส่งเชื่อมต่อเข้ามา)
    input = `srt://0.0.0.0:${s.port}?mode=listener&latency=${lat}&pkt_size=1316&timeout=3000000`;
  } else {
    const u = new URL(s.target);
    u.searchParams.delete('passphrase');
    u.searchParams.set('mode', 'caller');
    u.searchParams.set('latency', lat);
    u.searchParams.set('timeout', '3000000');
    if (s.streamid) u.searchParams.set('streamid', s.streamid);
    input = `srt://${u.host}?${u.searchParams.toString()}`;
  }
  // ขั้นที่ 1: รับ SRT แล้วส่งต่อวิดีโอแบบเดิม (copy) — ไม่ต้องตัดการเชื่อมต่อของผู้ส่งเมื่อต้องแปลง codec
  const proc = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'info', '-nostats', '-progress', 'pipe:3',
    ...(s.passphrase ? ['-passphrase', s.passphrase] : []),
    '-fflags', '+nobuffer+genpts', '-probesize', '2000000', '-analyzeduration', '2500000',
    '-i', input,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  s.proc = proc;
  s.info = null;
  s.transcode = false;
  setState(s, s.mode === 'listener' ? 'waiting' : 'connecting', '', send);

  const toViewers = chunk => {
    for (const v of s.viewers) {
      // ตัวเล่นที่รับไม่ทัน (เน็ตช้า) ข้ามข้อมูลไปก่อน ไม่ให้หน่วยความจำบวม
      if (v.readyState === v.OPEN && v.bufferedAmount < 16 * 1024 * 1024) v.send(chunk);
    }
  };
  // ขั้นที่ 2 (เฉพาะเมื่อไม่ใช่ H.264): แปลงเป็น H.264 เพื่อให้ทุกเบราว์เซอร์เล่นได้
  let route = null, pending = [], pendingBytes = 0, transcoder = null;
  const decide = codec => {
    if (route) return;
    if (codec === 'h264') {
      route = toViewers;
    } else {
      console.log(`${tag} source is ${codec} → transcoding to H.264`);
      s.transcode = true;
      transcoder = spawn(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-probesize', '1000000', '-analyzeduration', '1000000', '-f', 'mpegts', '-i', 'pipe:0',
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '60',
        '-c:a', 'copy', '-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
      transcoder.stdin.on('error', () => {});
      transcoder.stdout.on('data', toViewers);
      transcoder.on('error', () => {});
      route = chunk => { if (transcoder.stdin.writable) transcoder.stdin.write(chunk); };
    }
    pending.forEach(route);
    pending = [];
  };

  let inputSection = true, lastErr = '';
  proc.stderr.on('data', b => {
    for (const line of String(b).split('\n')) {
      if (/^Output #0/.test(line)) {
        inputSection = false;
        if (!route) decide(s.info ? s.info.codec : 'h264');
      }
      const v = inputSection && /Stream #0:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(line);
      if (v) {
        const fps = /([\d.]+) fps/.exec(line);
        s.info = { codec: v[1], width: Number(v[2]), height: Number(v[3]), fps: fps ? Number(fps[1]) : 0 };
        // stderr กับ progress มาคนละท่อ — ถ้าแจ้ง live ไปก่อนรู้รายละเอียดภาพ ให้ส่งสถานะซ้ำพร้อมรายละเอียด
        if (s.state === 'live' && s.proc === proc) setState(s, 'live', '', send);
      }
      if (/error|failed|refused|reject|invalid/i.test(line)) lastErr = line.trim().slice(0, 200);
    }
  });
  proc.stdio[3].on('data', b => {
    const m = /out_time_us=(\d+)/.exec(String(b));
    if (m && Number(m[1]) > 0 && s.state !== 'live' && s.proc === proc) setState(s, 'live', '', send);
  });
  proc.stdout.on('data', chunk => {
    if (route) return route(chunk);
    if (pendingBytes < 32 * 1024 * 1024) { pending.push(chunk); pendingBytes += chunk.length; }
  });
  proc.on('error', err => { lastErr = err.message; });
  proc.on('close', () => {
    if (transcoder) { transcoder.stdin.end(); setTimeout(() => transcoder.kill('SIGKILL'), 1000).unref(); }
    if (s.proc !== proc) return;
    s.proc = null;
    if (s.closed) return;
    // แหล่งสัญญาณหยุด/หลุด — ปิดตัวเล่นเดิม แล้วรอรับ/ดึงสัญญาณใหม่อัตโนมัติ
    for (const v of s.viewers) v.close(4000, 'restart');
    const wasLive = s.state === 'live';
    setState(s, 'error', wasLive ? 'สัญญาณหยุด — กำลังรอสัญญาณใหม่' : (lastErr || 'เชื่อมต่อไม่ได้'), send);
    s.timer = setTimeout(() => startIngest(s, send, tag), s.mode === 'listener' ? 1000 : 3000);
  });
}

function setState(s, state, message, send) {
  s.state = state;
  if (state === 'live') s.wasLive = true;
  s.message = message;
  send({ type: 'status', state, message, info: s.info, transcode: s.transcode });
}

function ingestData(ws, url) {
  const s = ingests.get(url.searchParams.get('id') || '');
  if (!s) return ws.close(1008, 'unknown input');
  s.viewers.add(ws);
  ws.on('close', () => s.viewers.delete(ws));
}

/* ==========================================================================
   กล้องมือถือ: PeerJS ของเราเอง + TURN (coturn)
   - PeerServer (สัญญาณ WebRTC) ที่ PEER_PORT — ผ่าน Caddy ที่ https://โดเมน/peerjs
   - /ice?token=…  ให้ค่า ICE (STUN/TURN) แบบรหัสชั่วคราว (HMAC ตามมาตรฐาน TURN REST API)
     มือถือที่ใช้ 4G/5G หรือ Wi-Fi ที่ปิดกั้น WebRTC จะส่งภาพผ่าน TURN ได้
   ========================================================================== */
const PEER_PORT = Number(process.env.PEER_PORT) || 0;
const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_HOST = process.env.TURN_HOST || '';
const TURN_PORT = Number(process.env.TURN_PORT) || 3478;
const ICE_TTL = 7 * 24 * 3600; // ลิงก์/QR กล้องมือถือใช้ TURN ได้ 7 วัน (เปิดหน้าต่าง QR ใหม่เพื่อต่ออายุ)
if (PEER_PORT) {
  const { PeerServer } = require('peer');
  PeerServer({ port: PEER_PORT, host: process.env.PEER_HOST || '0.0.0.0', path: '/peerjs', proxied: true, allow_discovery: false });
}

function iceConfig(req) {
  const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/:\d+$/, '');
  const host = TURN_HOST || reqHost;
  const iceServers = [];
  let expires = 0;
  if (TURN_SECRET && host) {
    expires = Math.floor(Date.now() / 1000) + ICE_TTL;
    const username = `${expires}:webmix`;
    const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
    iceServers.push({ urls: `stun:${host}:${TURN_PORT}` });
    iceServers.push({ urls: [`turn:${host}:${TURN_PORT}?transport=udp`, `turn:${host}:${TURN_PORT}?transport=tcp`], username, credential });
  }
  iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
  const https = req.headers['x-forwarded-proto'] === 'https';
  const peer = !PEER_PORT ? null : https
    ? { host: reqHost, port: 443, path: '/peerjs', secure: true }
    : { host: reqHost, port: PEER_PORT, path: '/peerjs', secure: false };
  const turn = TURN_SECRET && host ? { host, port: TURN_PORT, username: iceServers[1].username, credential: iceServers[1].credential } : null;
  return { iceServers, peer, turn, expires };
}

const METRICS_TOKEN = process.env.METRICS_TOKEN || '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const token = u.searchParams.get('token') || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const json = (code, obj, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/ice') {
    const cors = { 'access-control-allow-origin': '*' };
    const a = authorize(req, token);
    if (a.error) return json(403, { error: a.error }, cors);
    return json(200, iceConfig(req), cors);
  }
  if (u.pathname === '/admin' || u.pathname === '/admin/status.json') {
    const a = authorize(req, token);
    if (a.error || !a.user.admin) return json(403, { error: 'admin token required' });
    if (u.pathname === '/admin') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
      return res.end(monitor.ADMIN_HTML);
    }
    return json(200, monitor.status(sessionList()));
  }
  if (u.pathname === '/metrics') {
    const ok = METRICS_TOKEN ? token === METRICS_TOKEN : (() => { const a = authorize(req, token); return !a.error && a.user.admin; })();
    if (!ok) return json(403, { error: 'token required' });
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' });
    return res.end(monitor.metrics(sessionList()));
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`WebMix Stream Gateway: OK (${countFor('stream', null, s => s.encoding)} streams, ${ingests.size} SRT inputs)\n`);
});
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 * 1024 });
server.listen(PORT);

// ตัดการเชื่อมต่อที่ค้าง (เน็ตหลุดแบบไม่ปิด socket) ภายใน ~30 วินาที เพื่อคืนโควตาให้การเชื่อมต่อใหม่
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 15000).unref();
setInterval(() => monitor.check(sessionList()), 5000).unref();

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const reqUrl = new URL(req.url, 'http://localhost');
  const auth = authorize(req, reqUrl.searchParams.get('token'));
  if (auth.error) return ws.close(1008, auth.error);
  if (reqUrl.pathname === '/srt-in' || reqUrl.pathname === '/srt-in/data') {
    return reqUrl.pathname === '/srt-in' ? ingestControl(ws, req, auth) : ingestData(ws, reqUrl);
  }
  const params = reqUrl.searchParams;
  const user = auth.user;
  const tag = `[${auth.ip} ${user.name}]`;
  const sessionId = crypto.randomBytes(8).toString('hex');

  // ค่าที่ส่งมาจากหน้าตั้งค่า (มีค่าเริ่มต้นและจำกัดช่วงไว้เสมอ)
  const fps = [24, 25, 30, 50, 60].includes(Number(params.get('fps'))) ? Number(params.get('fps')) : 30;
  const kbps = Math.min(MAX_KBPS, Math.max(500, Number(params.get('vb')) || 4500));
  const height = Math.min(4320, Math.max(0, Number(params.get('res')) || 0));
  let encoderStats = null;

  const dests = new Map();
  let encoder = null;
  let closed = false;

  const send = obj => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  // ปฏิเสธพร้อมข้อความภาษาไทย (เหตุผลใน close frame ยาวได้ไม่เกิน 123 ไบต์ จึงส่งเป็นข้อความ JSON ก่อน)
  const reject = (message, reason) => { send({ type: 'error', message }); ws.close(1008, reason); };
  const session = {
    kind: 'stream', user, startedAt: Date.now(), lastSeen: Date.now(), encoding: false, ws,
    snapshot: () => ({
      id: sessionId, kind: 'stream', user: user.name, ip: auth.ip, startedAt: session.startedAt, encoding: session.encoding,
      format: `${height ? height + 'p' : ''}${fps} · ${kbps} kbps`, encoder: encoderStats,
      destinations: [...dests.values()].map(d => ({ id: d.id, name: d.name, state: d.state, message: d.message, kbps: d.state === 'live' ? d.kbps : 0, wanted: d.wanted, failing: !!d.failing }))
    })
  };
  sessions.set(sessionId, session);
  const userLimits = user.limits;
  const destLimit = userLimits ? Math.min(MAX_DESTINATIONS, userLimits.destinations) : MAX_DESTINATIONS;

  // ตรวจโควตาก่อนเริ่มตัวเข้ารหัส — การเชื่อมต่อเดิมของผู้ใช้คนเดียวกันที่เงียบไปแล้ว (เน็ตหลุด) ถูกตัดทิ้งเพื่อให้เชื่อมต่อใหม่ได้ทันที
  function allowEncoder() {
    if (session.encoding) return true;
    const now = Date.now();
    for (const other of sessions.values()) {
      if (other !== session && other.kind === 'stream' && other.encoding && other.user.name === user.name && now - other.lastSeen > 5000) {
        console.log(`[${user.name}] replacing stale stream session`);
        other.encoding = false;
        other.ws.terminate();
      }
    }
    const mine = countFor('stream', user.name, s => s.encoding);
    if (userLimits && mine >= userLimits.streams) {
      reject(`บัญชี ${user.name} สตรีมพร้อมกันได้สูงสุด ${userLimits.streams} สตรีม — หยุดสตรีมอื่นของบัญชีนี้ก่อน`, 'stream limit');
      return false;
    }
    if (MAX_STREAMS && countFor('stream', null, s => s.encoding) >= MAX_STREAMS) {
      reject(`เซิร์ฟเวอร์กำลังสตรีมเต็มจำนวน (${MAX_STREAMS} สตรีม) — ลองใหม่ภายหลังหรือติดต่อผู้ดูแล`, 'server busy');
      monitor.notify('full', `มีคนเริ่มสตรีมไม่ได้เพราะเซิร์ฟเวอร์เต็ม (${MAX_STREAMS} สตรีม) — ผู้ใช้ ${user.name}`);
      return false;
    }
    session.encoding = true;
    monitor.counters.streamsStarted++;
    streamBack(user.name);
    return true;
  }

  const report = () => send({
    type: 'status',
    destinations: [...dests.values()].map(d => ({ id: d.id, name: d.name, state: d.state, message: d.message, kbps: d.state === 'live' ? d.kbps : 0 })),
    encoder: encoderStats
  });

  function startEncoder() {
    if (encoder) return true;
    if (!allowEncoder()) return false;
    console.log(`${tag} encoder start ${height ? height + 'p' : ''}${fps} ${kbps}kbps ${VIDEO_ENCODER}`);
    encoder = spawn(FFMPEG, [
      '-loglevel', 'warning', '-nostats', '-progress', 'pipe:3', '-stats_period', '2',
      '-i', 'pipe:0',
      ...videoArgs(height),
      '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
      '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
      '-c:a', 'aac', '-ar', '44100', '-b:a', '128k',
      // MPEG-TS ส่ง SPS/PPS ซ้ำทุกคีย์เฟรม ปลายทางที่เริ่มกลางคันจึงต่อสัญญาณได้ทันที
      '-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });

    encoder.stdin.on('error', () => {});
    // ความเร็วการเข้ารหัส (speed=1.0x คือทันเวลาจริง) ส่งกลับไปแสดงในหน้า WebMix
    encoder.stdio[3].on('data', b => {
      const text = String(b);
      const speed = /speed=\s*([\d.]+)x/.exec(text);
      const efps = /fps=\s*([\d.]+)/.exec(text);
      if (speed) encoderStats = { speed: Number(speed[1]), fps: efps ? Number(efps[1]) : 0 };
    });
    encoder.stderr.on('data', d => process.stderr.write(`${tag} encoder: ${d}`));
    encoder.stdout.on('data', chunk => {
      for (const d of dests.values()) {
        if (d.proc && d.proc.stdin.writable) {
          d.proc.stdin.write(chunk);
          d.bytes += chunk.length;
        }
      }
    });
    encoder.on('error', err => ws.close(1011, 'ffmpeg not available: ' + err.message));
    encoder.on('close', code => {
      console.log(`${tag} encoder exited (${code})`);
      if (!closed && ws.readyState === ws.OPEN) ws.close(1011, `encoder exited (${code})`);
    });
    return true;
  }

  function spawnDest(d) {
    d.state = 'connecting';
    d.message = '';
    d.lastErr = '';
    d.startedAt = Date.now();
    const proc = spawn(FFMPEG, [
      '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
      // ต้องอ่านนานกว่า 1 ช่วงคีย์เฟรม (2 วินาที) ปลายทางที่เริ่มกลางไลฟ์จึงเจอ SPS/PPS เสมอ
      '-probesize', '5000000', '-analyzeduration', '3000000',
      '-f', 'mpegts', '-i', 'pipe:0',
      '-c', 'copy', ...outputArgs(d.url)
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    d.proc = proc;
    console.log(`${tag} → ${d.name} ${maskUrl(d.url)}`);

    proc.stdin.on('error', () => {});
    // ถือว่า "live" เมื่อ ffmpeg เขียนข้อมูลออกไปยังปลายทางได้จริงแล้ว (out_time เริ่มเดิน)
    proc.stdout.on('data', b => {
      const m = /out_time_us=(\d+)/.exec(String(b));
      if (m && Number(m[1]) > 0 && d.state === 'connecting' && d.proc === proc) {
        d.state = 'live';
        d.failing = false;
        console.log(`${tag} ✓ ${d.name} live`);
        report();
      }
    });
    proc.stderr.on('data', b => {
      const line = String(b).trim().split('\n').pop();
      if (line) d.lastErr = line.slice(0, 200);
    });
    proc.on('error', err => { d.lastErr = err.message; });
    proc.on('close', code => {
      if (d.proc !== proc) return;
      d.proc = null;
      if (!d.wanted || closed) {
        d.state = 'stopped';
        report();
        return;
      }
      d.state = 'error';
      d.message = d.lastErr || `การเชื่อมต่อปิดลง (${code})`;
      monitor.counters.destinationErrors++;
      d.failing = true; // ยังนับว่าล่มอยู่ระหว่างลองเชื่อมต่อใหม่ จนกว่าจะกลับมา live
      console.log(`${tag} ✕ ${d.name}: ${d.message}`);
      report();
      d.retry = setTimeout(() => {
        if (d.wanted && !closed && !d.proc) { spawnDest(d); report(); }
      }, RETRY_MS);
    });
  }

  function addDest(raw) {
    if (!raw || typeof raw !== 'object') return;
    const id = String(raw.id || '').slice(0, 40);
    const url = String(raw.url || '');
    if (!id) return;
    if (!OUTPUT_RE(url)) {
      send({ type: 'status', destinations: [{ id, name: String(raw.name || ''), state: 'error', message: 'URL ต้องเป็น rtmp://, rtmps:// หรือ srt://host:port', kbps: 0 }] });
      return;
    }
    if (SRT_RE.test(url) && !SRT_SUPPORTED) {
      send({ type: 'status', destinations: [{ id, name: String(raw.name || ''), state: 'error', message: 'ffmpeg ในเซิร์ฟเวอร์นี้ไม่รองรับ SRT (ต้องคอมไพล์พร้อม libsrt)', kbps: 0 }] });
      return;
    }
    let d = dests.get(id);
    if (!d) {
      if (dests.size >= destLimit) {
        send({ type: 'status', destinations: [{ id, name: String(raw.name || ''), state: 'error', message: `เกินจำนวนปลายทางสูงสุด (${destLimit})`, kbps: 0 }] });
        return;
      }
      d = { id, name: String(raw.name || id).slice(0, 40), url, state: 'stopped', message: '', bytes: 0, kbps: 0, proc: null, retry: null, wanted: true };
      dests.set(id, d);
    }
    d.url = url;
    d.wanted = true;
    clearTimeout(d.retry);
    if (!d.proc) spawnDest(d);
    report();
  }

  function stopDest(id) {
    const d = dests.get(String(id));
    if (!d) return;
    d.wanted = false;
    clearTimeout(d.retry);
    if (d.proc) {
      const proc = d.proc;
      proc.stdin.end();
      setTimeout(() => proc.kill('SIGINT'), 3000).unref();
    } else {
      d.state = 'stopped';
    }
    d.message = '';
    report();
  }

  const timer = setInterval(() => {
    for (const d of dests.values()) {
      d.kbps = Math.round(d.bytes * 8 / 2000);
      d.bytes = 0;
    }
    report();
  }, 2000);

  // แบบเดิม: ?rtmp=URL (ปลายทางเดียว)
  const legacy = params.get('rtmp');
  if (legacy) {
    if (!RTMP_RE.test(legacy)) return ws.close(1008, 'invalid rtmp url');
    if (startEncoder()) addDest({ id: 'default', name: 'RTMP', url: legacy });
  }

  ws.on('message', (data, isBinary) => {
    session.lastSeen = Date.now();
    if (!isBinary) {
      let msg;
      try { msg = JSON.parse(String(data)); } catch (e) { return; }
      if (msg.type === 'start') {
        if (startEncoder()) (Array.isArray(msg.destinations) ? msg.destinations : []).forEach(addDest);
      } else if (msg.type === 'add') {
        if (startEncoder()) addDest(msg.destination);
      } else if (msg.type === 'stop') {
        stopDest(msg.id);
      }
      return;
    }
    if (encoder && encoder.stdin.writable) encoder.stdin.write(data);
  });

  ws.on('close', code => {
    closed = true;
    clearInterval(timer);
    // หลุดระหว่างไลฟ์ (ไม่ใช่การกดหยุด) → แจ้งเตือนถ้าไม่กลับมาใน 30 วินาที
    const wasLive = [...dests.values()].some(d => d.wanted && d.state === 'live');
    if (wasLive && code !== 1000 && session.encoding) streamDropped(user.name, auth.ip);
    sessions.delete(sessionId);
    monitor.forget(`enc:${sessionId}`);
    monitor.forget(`dest:${sessionId}:`);
    for (const d of dests.values()) {
      d.wanted = false;
      clearTimeout(d.retry);
      if (d.proc) {
        const proc = d.proc;
        proc.stdin.end();
        setTimeout(() => proc.kill('SIGINT'), 5000).unref();
      }
    }
    if (encoder) {
      const enc = encoder;
      enc.stdin.end();
      setTimeout(() => enc.kill('SIGINT'), 5000).unref();
    }
    console.log(`${tag} disconnected`);
  });
});

console.log(`WebMix Stream Gateway (multistream) listening on ws://0.0.0.0:${PORT}${users.authRequired() ? ' (token required)' : ' (NO TOKEN — open to anyone who can reach this port)'}` +
  ` · users file ${users.USERS_FILE} · alerts ${monitor.alertsEnabled() ? 'on' : 'off'}${MAX_STREAMS ? ' · max ' + MAX_STREAMS + ' streams' : ''}`);
console.log(`WebMix features: SRT ${SRT_SUPPORTED ? 'enabled' : 'NOT available in this ffmpeg'} · PeerJS ${PEER_PORT ? 'on :' + PEER_PORT : 'off'} · TURN ${TURN_SECRET ? 'on' : 'off'}`);
