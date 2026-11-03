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
//   client → { type: 'probe', destination: { id, name, url } }       ตรวจว่าเชื่อมต่อและรหัสสตรีมใช้ได้ โดยไม่ส่งภาพ (ไม่ขึ้นไลฟ์)
//   server → { type: 'probe', id, ok, message }
//   client → { type: 'start', destinations: [] }                     ทดสอบเข้ารหัสอย่างเดียว (ทิ้งผลลัพธ์) — status.rx = kbps ที่รับจากไคลเอนต์
//   server → { type: 'status', destinations: [{ id, name, state, message, kbps, lag }] }  (lag = ms ของข้อมูลที่รอส่งไปปลายทาง)
//            state: connecting | live | error | stopped
//   url: rtmp://… rtmps://… หรือ srt://host:port?streamid=…&passphrase=…&latency=… (SRT ส่งเป็น MPEG-TS)
//   vertical: 'crop' | 'fit' (ไม่ใส่ = แนวนอนตามต้นฉบับ) — ปลายทางนี้ได้ภาพแนวตั้ง 9:16
//   (ยังรองรับแบบเดิม ?rtmp=URL สำหรับปลายทางเดียว)
//
// รับสัญญาณ SRT เข้ามาเป็น Input (รายละเอียดใน lib/ingest.js):
//   ws /srt-in?token=…        client → { type: 'open', mode: 'listener'|'caller'|'rtsp'|'rtmp', port, url, streamid, passphrase, latency, key }
//                             rtsp = ดึงภาพจากกล้อง IP (url rtsp://…) · rtmp = รอรับ RTMP ที่ rtmp://<gateway>:port/live/key (RTMP_PORTS)
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
// กล้องมือถือ (lib/ice.js):
//   PEER_PORT     เปิด PeerJS server ของเราเองที่พอร์ตนี้ (path /peerjs)
//   TURN_SECRET   รหัสลับร่วมกับ coturn (static-auth-secret) · TURN_HOST / TURN_PORT ที่อยู่ของ TURN
//   GET /ice?token=…  →  { iceServers, peer: { host, port, path, secure }, expires }

const users = require('./users');
if (process.argv[2] === 'user') {
  try { users.cli(process.argv.slice(3)); process.exit(0); } catch (e) { console.error(e.message); process.exit(1); }
}

// โครงสร้าง: ไฟล์นี้ = จุดเริ่ม (HTTP + WebSocket) · lib/config ค่าตั้ง · lib/ffmpeg คำสั่ง ffmpeg · lib/auth token และกันเดารหัส
//   lib/sessions การเชื่อมต่อที่ทำงานอยู่และ drain · lib/stream สตรีมออกหลายปลายทาง · lib/ingest สัญญาณขาเข้า
//   lib/ice กล้องมือถือ (PeerJS / TURN) · lib/admin หน้าผู้ดูแล · users.js ผู้ใช้ · monitor.js แจ้งเตือนและ metrics
const http = require('http');
const monitor = require('./monitor');
const { WebSocketServer } = require('ws');
const { MAX_STREAMS, PORT } = require('./lib/config');
const { SRT_SUPPORTED } = require('./lib/ffmpeg');
const { authorize } = require('./lib/auth');
const { countFor, draining, sessionList } = require('./lib/sessions');
const { ingestControl, ingestData, ingests } = require('./lib/ingest');
const { PEER_PORT, TURN_SECRET, iceConfig } = require('./lib/ice');
const { ADMIN_HTML, adminAction, adminStatus } = require('./lib/admin');
const { handleStream } = require('./lib/stream');

const METRICS_TOKEN = process.env.METRICS_TOKEN || '';

// หน้าเช็กสถานะ: เปิด https://โดเมน/ ในเบราว์เซอร์แล้วต้องเห็นข้อความ OK
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
  if (u.pathname === '/admin' || u.pathname === '/admin/') {
    // หน้าเว็บไม่มีข้อมูลอะไร — ใส่ token ในหน้าแล้วหน้าเรียก /admin/status.json เอง (?token= ยังใช้ได้)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'" });
    return res.end(ADMIN_HTML);
  }
  if (u.pathname === '/admin/status.json' || u.pathname.startsWith('/admin/api/')) {
    const a = authorize(req, token);
    if (a.error || !(a.user.admin || a.user.manage)) return json(403, { error: 'admin token required' });
    if (u.pathname === '/admin/status.json') return json(200, adminStatus(a.user));
    // คำสั่งแก้ไขต้องส่ง token ทาง Authorization เท่านั้น (ไม่อยู่ใน URL / log) และเป็น JSON
    if (req.method !== 'POST' || !/^Bearer\s/i.test(String(req.headers.authorization || ''))) return json(405, { error: 'POST with Authorization: Bearer <token>' });
    let body = '';
    req.on('data', d => { body += d; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch (e) { return json(400, { error: 'JSON ไม่ถูกต้อง' }); }
      try { json(200, adminAction(u.pathname.slice('/admin/api/'.length), msg || {}, a.user)); }
      catch (e) { json(400, { error: e.message }); }
    });
    return;
  }
  if (u.pathname === '/metrics') {
    const ok = METRICS_TOKEN ? token === METRICS_TOKEN : (() => { const a = authorize(req, token); return !a.error && a.user.admin; })();
    if (!ok) return json(403, { error: 'token required' });
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' });
    return res.end(monitor.metrics(sessionList()));
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`WebMix Stream Gateway: OK (${countFor('stream', null, s => s.encoding)} streams, ${ingests.size} SRT inputs)${draining() ? ' draining' : ''}\n`);
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
  handleStream(ws, req, auth, reqUrl);
});

console.log(`WebMix Stream Gateway (multistream) listening on ws://0.0.0.0:${PORT}${users.authRequired() ? ' (token required)' : ' (NO TOKEN — open to anyone who can reach this port)'}` +
  ` · users file ${users.USERS_FILE} · alerts ${monitor.alertsEnabled() ? 'on' : 'off'}${MAX_STREAMS ? ' · max ' + MAX_STREAMS + ' streams' : ''}`);
console.log(`WebMix features: SRT ${SRT_SUPPORTED ? 'enabled' : 'NOT available in this ffmpeg'} · PeerJS ${PEER_PORT ? 'on :' + PEER_PORT : 'off'} · TURN ${TURN_SECRET ? 'on' : 'off'}`);
