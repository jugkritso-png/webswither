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
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`WebMix Stream Gateway: OK (${wss.clients.size} active)\n`);
});
const wss = new WebSocketServer({ server });
server.listen(PORT);

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
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

console.log(`WebMix Stream Gateway (multistream) listening on ws://0.0.0.0:${PORT}${TOKEN ? ' (token required)' : ''} · SRT ${SRT_SUPPORTED ? 'enabled' : 'NOT available in this ffmpeg'}`);
