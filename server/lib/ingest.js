// รับสัญญาณเข้า: SRT listener/caller, กล้อง IP (RTSP), รับ RTMP — ส่งต่อเป็น MPEG-TS ให้หน้า WebMix
const monitor = require('../monitor');
const { spawn } = require('child_process');
const { FFMPEG } = require('./config');
const { SRT_RE, SRT_SUPPORTED, maskCreds } = require('./ffmpeg');
const { DRAIN_MSG, countFor, draining, sessions } = require('./sessions');

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
// รับ RTMP (OBS / vMix / มือถือ / โดรน ส่งเข้ามา) — พอร์ต TCP ละหนึ่งแหล่งภาพ
const RTMP_PORT_RANGE = (() => {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(process.env.RTMP_PORTS || '1935-1944');
  return m ? [Number(m[1]), Number(m[2])] : [1935, 1944];
})();
// ที่อยู่ในวง LAN ของเครื่องนี้ — ให้อุปกรณ์อื่นส่ง RTMP/SRT เข้ามาได้เมื่อ Gateway อยู่ในเครื่องเดียวกับหน้า WebMix
const lanIp = () => {
  for (const list of Object.values(require('os').networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '';
};
const RTSP_RE = /^rtsps?:\/\/[^\s"'<>]+$/i;
const KEY_RE = /^[A-Za-z0-9_-]{4,64}$/;
const ingests = new Map();
const usedPorts = new Set();

const MAX_SRT_INPUTS = Number(process.env.MAX_SRT_INPUTS) || 0;

const NET_ONLY_DESKTOP = 'NDI / OMT ใช้ได้กับ Gateway ในแอปเดสก์ท็อป WebMix Pro (ต้องอยู่ในวง LAN เดียวกับแหล่งสัญญาณ) — Gateway บนเซิร์ฟเวอร์ใช้ไม่ได้';

function ingestControl(ws, req, auth) {
  const tag = `[${auth.ip} ${auth.user.name} srt-in]`;
  let s = null;
  const send = obj => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  const fail = message => { send({ type: 'error', message }); ws.close(1008, 'rejected'); };

  ws.on('message', (data, isBinary) => {
    if (isBinary || s) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    // NDI / OMT ต้องใช้ไลบรารีบนเครื่องที่อยู่ในวง LAN เดียวกับแหล่งสัญญาณ — มีเฉพาะ Gateway ในแอปเดสก์ท็อป
    if (msg.type === 'sources') return send({ type: 'sources', proto: String(msg.proto || ''), list: [], error: NET_ONLY_DESKTOP });
    if (msg.type !== 'open') return;
    if (msg.mode === 'ndi' || msg.mode === 'omt') return fail(NET_ONLY_DESKTOP);
    if (draining()) return fail(DRAIN_MSG);
    const kind = ['caller', 'rtsp', 'rtmp'].includes(msg.mode) ? msg.mode : 'listener';
    if ((kind === 'listener' || kind === 'caller') && !SRT_SUPPORTED) return fail('ffmpeg ในเซิร์ฟเวอร์นี้ไม่รองรับ SRT');
    const lim = auth.user.limits;
    if (lim && countFor('srt-in', auth.user.name) >= lim.srt) return fail(`บัญชี ${auth.user.name} รับ SRT ได้พร้อมกันสูงสุด ${lim.srt} สัญญาณ`);
    if (MAX_SRT_INPUTS && countFor('srt-in') >= MAX_SRT_INPUTS) return fail(`เซิร์ฟเวอร์รับ SRT พร้อมกันได้สูงสุด ${MAX_SRT_INPUTS} สัญญาณ`);

    const mode = kind;
    const latency = SRT_LATENCIES_MS.includes(Number(msg.latency)) ? Number(msg.latency) : 500;
    const passphrase = String(msg.passphrase || '');
    if (passphrase && (passphrase.length < 10 || passphrase.length > 64)) return fail('รหัสผ่าน SRT ต้องยาว 10–64 ตัวอักษร');
    let port = 0, target = '', key = '';
    if (mode === 'rtsp') {
      target = String(msg.url || '').trim();
      if (!RTSP_RE.test(target)) return fail('URL กล้องต้องอยู่ในรูปแบบ rtsp://ผู้ใช้:รหัส@ที่อยู่กล้อง:554/…');
    } else if (mode === 'rtmp') {
      port = Number(msg.port);
      key = String(msg.key || '');
      if (!Number.isInteger(port) || port < RTMP_PORT_RANGE[0] || port > RTMP_PORT_RANGE[1]) {
        return fail(`พอร์ต RTMP ต้องอยู่ในช่วง ${RTMP_PORT_RANGE[0]}–${RTMP_PORT_RANGE[1]} (ตั้งด้วย RTMP_PORTS บนเซิร์ฟเวอร์)`);
      }
      if (!KEY_RE.test(key)) return fail('Stream key ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข 4–64 ตัว');
      if (usedPorts.has('tcp' + port)) return fail(`พอร์ต ${port} ถูกใช้โดย Input อื่นอยู่แล้ว`);
      usedPorts.add('tcp' + port);
    } else if (mode === 'listener') {
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
      id: crypto.randomBytes(12).toString('hex'), mode, port, target, latency, passphrase, key,
      streamid: String(msg.streamid || '').slice(0, 512),
      transcode: false, proc: null, viewers: new Set(), state: 'starting', info: null, message: '', closed: false, timer: null
    };
    ingests.set(s.id, s);
    const label = mode === 'listener' ? `UDP ${port}` : mode === 'rtmp' ? `RTMP ${port}` : maskCreds(target).replace(/\?.*$/, '');
    sessions.set(s.id, {
      kind: 'srt-in', user: auth.user, startedAt: Date.now(),
      stop: () => { monitor.log(`ผู้ดูแลปิดสัญญาณขาเข้า ${label} ของ ${auth.user.name}`); fail('ผู้ดูแลเซิร์ฟเวอร์ปิดสัญญาณขาเข้านี้'); },
      snapshot: () => ({ id: s.id, kind: 'srt-in', user: auth.user.name, ip: auth.ip, startedAt: sessions.get(s.id)?.startedAt, label, state: s.state, wasLive: !!s.wasLive, info: s.info })
    });
    console.log(`${tag} open ${mode} ${label}`);
    send({ type: 'opened', id: s.id, mode, port, portRange: mode === 'rtmp' ? RTMP_PORT_RANGE : SRT_PORT_RANGE, lanIp: lanIp() });
    startIngest(s, send, tag);
  });

  ws.on('close', () => {
    if (!s) return;
    s.closed = true;
    clearTimeout(s.timer);
    if (s.proc) s.proc.kill('SIGKILL');
    for (const v of s.viewers) v.close(1000, 'closed');
    if (s.mode === 'listener') usedPorts.delete(s.port);
    if (s.mode === 'rtmp') usedPorts.delete('tcp' + s.port);
    ingests.delete(s.id);
    sessions.delete(s.id);
    monitor.forget(`srt:${s.id}`);
    console.log(`${tag} closed`);
  });
}

function startIngest(s, send, tag) {
  if (s.closed) return;
  const lat = String(s.latency * 1000);
  let input, pre = [];
  if (s.mode === 'rtsp') {
    // TCP ผ่านเราเตอร์/NAT ได้เสถียรกว่า UDP · timeout = กล้องหายไป 5 วินาทีแล้วเชื่อมต่อใหม่
    pre = ['-rtsp_transport', 'tcp', '-timeout', '5000000'];
    input = s.target;
  } else if (s.mode === 'rtmp') {
    // รอผู้ส่งเชื่อมต่อเข้ามา (ไม่จำกัดเวลา) — ส่งจบแล้วเปิดรอใหม่อัตโนมัติ
    pre = ['-listen', '1', '-timeout', '-1'];
    input = `rtmp://0.0.0.0:${s.port}/live/${s.key}`;
  } else if (s.mode === 'listener') {
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
    ...pre, '-i', input,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  s.proc = proc;
  s.info = null;
  s.transcode = false;
  setState(s, s.mode === 'listener' || s.mode === 'rtmp' ? 'waiting' : 'connecting', '', send);

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
      if (/error|failed|refused|reject|invalid/i.test(line)) lastErr = maskCreds(line.trim()).slice(0, 200);
      // ffmpeg รับ RTMP ทุก stream key (แค่เตือน) — key ไม่ตรง = ตัดทิ้ง แล้วเปิดรอใหม่
      if (s.mode === 'rtmp' && /Unexpected stream/.test(line) && s.proc === proc) {
        lastErr = 'มีผู้ส่ง RTMP ที่ใช้ Stream key ไม่ถูกต้อง — ปฏิเสธแล้ว';
        console.log(`${tag} rejected RTMP sender with a wrong key`);
        proc.kill('SIGKILL');
      }
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
    s.timer = setTimeout(() => startIngest(s, send, tag), s.mode === 'listener' || s.mode === 'rtmp' ? 1000 : 3000);
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

module.exports = { NET_ONLY_DESKTOP, ingestControl, ingestData, ingests };
