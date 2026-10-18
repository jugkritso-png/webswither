// WebMix Stream Gateway — Multistream
// รับวิดีโอ (WebM/MP4 จาก MediaRecorder) ผ่าน WebSocket เข้ารหัสด้วย FFmpeg เพียงครั้งเดียว
// แล้วกระจายสัญญาณไปหลายปลายทาง RTMP/RTMPS และ SRT พร้อมกัน (YouTube, Facebook, Twitch, vMix, OBS, SRT server ฯลฯ)
// แต่ละปลายทางเริ่ม/หยุด/เชื่อมต่อใหม่ได้อิสระ — ปลายทางหนึ่งหลุดไม่กระทบปลายทางอื่น
//
// ใช้งาน:  cd server && npm install && npm start
// ตัวแปรแวดล้อม:
//   PORT          พอร์ตที่ให้บริการ (ค่าเริ่มต้น 8080)
//   STREAM_TOKEN  ถ้าตั้งไว้ ไคลเอนต์ต้องส่ง ?token=... มาด้วย (แนะนำให้ตั้งเสมอเมื่อเปิดให้เข้าถึงจากอินเทอร์เน็ต)
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
// กล้องมือถือ (ดูส่วน "PeerJS ของเราเอง + TURN"):
//   PEER_PORT     เปิด PeerJS server ของเราเองที่พอร์ตนี้ (path /peerjs)
//   TURN_SECRET   รหัสลับร่วมกับ coturn (static-auth-secret) · TURN_HOST / TURN_PORT ที่อยู่ของ TURN
//   GET /ice?token=…  →  { iceServers, peer: { host, port, path, secure }, expires }

const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
const TOKEN = process.env.STREAM_TOKEN || '';
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

function ingestControl(ws, req) {
  const tag = `[${req.socket.remoteAddress} srt-in]`;
  let s = null;
  const send = obj => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  const fail = message => { send({ type: 'error', message }); ws.close(1008, 'rejected'); };

  ws.on('message', (data, isBinary) => {
    if (isBinary || s) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    if (msg.type !== 'open') return;
    if (!SRT_SUPPORTED) return fail('ffmpeg ในเซิร์ฟเวอร์นี้ไม่รองรับ SRT');

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

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/ice') {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
    if (TOKEN && u.searchParams.get('token') !== TOKEN) { res.writeHead(403, headers); return res.end('{"error":"invalid token"}'); }
    res.writeHead(200, headers);
    return res.end(JSON.stringify(iceConfig(req)));
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`WebMix Stream Gateway: OK (${wss.clients.size} active, ${ingests.size} SRT inputs)\n`);
});
const wss = new WebSocketServer({ server });
server.listen(PORT);

wss.on('connection', (ws, req) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  if (reqUrl.pathname === '/srt-in' || reqUrl.pathname === '/srt-in/data') {
    if (TOKEN && reqUrl.searchParams.get('token') !== TOKEN) return ws.close(1008, 'invalid token');
    return reqUrl.pathname === '/srt-in' ? ingestControl(ws, req) : ingestData(ws, reqUrl);
  }
  const params = reqUrl.searchParams;
  const tag = `[${req.socket.remoteAddress}]`;
  if (TOKEN && params.get('token') !== TOKEN) return ws.close(1008, 'invalid token');

  // ค่าที่ส่งมาจากหน้าตั้งค่า (มีค่าเริ่มต้นและจำกัดช่วงไว้เสมอ)
  const fps = [24, 25, 30, 50, 60].includes(Number(params.get('fps'))) ? Number(params.get('fps')) : 30;
  const kbps = Math.min(MAX_KBPS, Math.max(500, Number(params.get('vb')) || 4500));
  const height = Math.min(4320, Math.max(0, Number(params.get('res')) || 0));
  let encoderStats = null;

  const dests = new Map();
  let encoder = null;
  let closed = false;

  const send = obj => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  const report = () => send({
    type: 'status',
    destinations: [...dests.values()].map(d => ({ id: d.id, name: d.name, state: d.state, message: d.message, kbps: d.state === 'live' ? d.kbps : 0 })),
    encoder: encoderStats
  });

  function startEncoder() {
    if (encoder) return;
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
      if (dests.size >= MAX_DESTINATIONS) {
        send({ type: 'status', destinations: [{ id, name: String(raw.name || ''), state: 'error', message: `เกินจำนวนปลายทางสูงสุด (${MAX_DESTINATIONS})`, kbps: 0 }] });
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
    startEncoder();
    addDest({ id: 'default', name: 'RTMP', url: legacy });
  }

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      let msg;
      try { msg = JSON.parse(String(data)); } catch (e) { return; }
      if (msg.type === 'start') {
        startEncoder();
        (Array.isArray(msg.destinations) ? msg.destinations : []).forEach(addDest);
      } else if (msg.type === 'add') {
        startEncoder();
        addDest(msg.destination);
      } else if (msg.type === 'stop') {
        stopDest(msg.id);
      }
      return;
    }
    if (encoder && encoder.stdin.writable) encoder.stdin.write(data);
  });

  ws.on('close', () => {
    closed = true;
    clearInterval(timer);
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

console.log(`WebMix Stream Gateway (multistream) listening on ws://0.0.0.0:${PORT}${TOKEN ? ' (token required)' : ''} · SRT ${SRT_SUPPORTED ? 'enabled' : 'NOT available in this ffmpeg'} · PeerJS ${PEER_PORT ? 'on :' + PEER_PORT : 'off'} · TURN ${TURN_SECRET ? 'on' : 'off'}`);
