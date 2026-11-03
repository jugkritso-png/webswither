// สตรีมหนึ่งการเชื่อมต่อ: รับภาพจาก WebMix → เข้ารหัสครั้งเดียว → ส่งหลายปลายทาง (RTMP / SRT / แนวตั้ง)
const crypto = require('crypto');
const monitor = require('../monitor');
const users = require('../users');
const { spawn } = require('child_process');
const { FFMPEG, MAX_DESTINATIONS, MAX_KBPS, MAX_STREAMS, VIDEO_ENCODER } = require('./config');
const { OUTPUT_RE, RETRY_MS, RTMP_RE, SRT_RE, SRT_SUPPORTED, VERTICAL_MODES, maskUrl, outputArgs, probeDest, verticalFilter, verticalSize, videoArgs } = require('./ffmpeg');
const { DRAIN_MSG, countFor, draining, recentlyLive, sessions, streamBack, streamDropped } = require('./sessions');
const { NET_ONLY_DESKTOP } = require('./ingest');

function handleStream(ws, req, auth, reqUrl) {
  const params = reqUrl.searchParams;
  const user = auth.user;
  const tag = `[${auth.ip} ${user.name}]`;
  const sessionId = crypto.randomBytes(8).toString('hex');

  // ค่าที่ส่งมาจากหน้าตั้งค่า (มีค่าเริ่มต้นและจำกัดช่วงไว้เสมอ)
  const fps = [24, 25, 30, 50, 60].includes(Number(params.get('fps'))) ? Number(params.get('fps')) : 30;
  const kbps = Math.min(MAX_KBPS, Math.max(500, Number(params.get('vb')) || 4500));
  // lag = ข้อมูลที่รอส่งให้ ffmpeg ของปลายทาง คิดเป็นมิลลิวินาทีของสตรีม — เพิ่มขึ้นเรื่อย ๆ = เน็ตขาออกไม่พอ (แอปจะลดบิตเรต)
  const lagOf = d => d.state === 'live' && d.proc && d.proc.stdin ? Math.round(d.proc.stdin.writableLength * 8 / (kbps + 160)) : 0;
  const height = Math.min(4320, Math.max(0, Number(params.get('res')) || 0));
  // vcopy=1: วิดีโอที่ส่งมาเป็น H.264 แล้ว (WebCodecs ด้วยชิปของเครื่อง) — ส่งต่อเลย เข้ารหัสเฉพาะเสียง
  const videoCopy = params.get('vcopy') === '1';
  let encoderStats = null, rxBytes = 0, rxKbps = 0;

  const dests = new Map();
  let encoder = null;
  let closed = false;
  // ตัวเข้ารหัสภาพแนวตั้ง แยกตามแบบ (crop / fit) — เริ่มเมื่อมีปลายทางแนวตั้งแบบนั้น
  const verticals = new Map();

  const send = obj => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  // ปฏิเสธพร้อมข้อความภาษาไทย (เหตุผลใน close frame ยาวได้ไม่เกิน 123 ไบต์ จึงส่งเป็นข้อความ JSON ก่อน)
  const reject = (message, reason) => { send({ type: 'error', message }); ws.close(1008, reason); };
  const session = {
    kind: 'stream', user, startedAt: Date.now(), lastSeen: Date.now(), encoding: false, ws,
    // ผู้ดูแลกดหยุดในหน้า /admin: แอปแสดงเหตุผลและไม่ต่อใหม่เอง (1008)
    stop: () => { session.stoppedByAdmin = true; monitor.log(`ผู้ดูแลหยุดไลฟ์ของ ${user.name}`); reject('ผู้ดูแลเซิร์ฟเวอร์หยุดไลฟ์นี้', 'stopped by admin'); },
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
    if (draining() && !(Date.now() - (recentlyLive.get(user.name) || 0) < 120000)) { reject(DRAIN_MSG, 'draining'); return false; }
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
    if (!streamBack(user.name) && !(Date.now() - (recentlyLive.get(user.name) || 0) < 120000)) monitor.log(`${user.name} เริ่มไลฟ์`);
    if (!user.admin) users.touch(user.name);
    return true;
  }

  const report = () => send({
    type: 'status',
    destinations: [...dests.values()].map(d => ({ id: d.id, name: d.name, state: d.state, message: d.message, kbps: d.state === 'live' ? d.kbps : 0, lag: lagOf(d) })),
    encoder: encoderStats,
    rx: rxKbps
  });

  function startEncoder() {
    if (encoder) return true;
    if (!allowEncoder()) return false;
    console.log(`${tag} encoder start ${height ? height + 'p' : ''}${fps} ${kbps}kbps ${videoCopy ? 'copy' : VIDEO_ENCODER}`);
    encoder = spawn(FFMPEG, [
      '-loglevel', 'warning', '-nostats', '-progress', 'pipe:3', '-stats_period', '2',
      '-i', 'pipe:0',
      ...(videoCopy ? ['-c:v', 'copy'] : [
        ...videoArgs(height),
        '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
        '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`
      ]),
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
        if (!d.vertical && d.proc && d.proc.stdin.writable) {
          d.proc.stdin.write(chunk);
          d.bytes += chunk.length;
        }
      }
      for (const v of verticals.values()) if (v.stdin.writable) v.stdin.write(chunk);
    });
    encoder.on('error', err => ws.close(1011, 'ffmpeg not available: ' + err.message));
    encoder.on('close', code => {
      console.log(`${tag} encoder exited (${code})`);
      if (!closed && ws.readyState === ws.OPEN) ws.close(1011, `encoder exited (${code})`);
    });
    return true;
  }

  // MPEG-TS ของ Program → ครอป/ย่อเป็น 9:16 → MPEG-TS ไปปลายทางแนวตั้งแบบเดียวกัน (เสียงคัดลอกตามเดิม)
  function startVertical(mode) {
    if (verticals.has(mode) || closed) return;
    const [w, h] = verticalSize(height);
    console.log(`${tag} vertical ${mode} ${w}x${h}`);
    const proc = spawn(FFMPEG, [
      '-loglevel', 'warning', '-nostats',
      '-probesize', '5000000', '-analyzeduration', '3000000',
      '-f', 'mpegts', '-i', 'pipe:0',
      '-vf', verticalFilter(mode, w, h),
      ...videoArgs(h),
      '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
      '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
      '-c:a', 'copy', '-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    verticals.set(mode, proc);
    proc.stdin.on('error', () => {});
    proc.stderr.on('data', d => process.stderr.write(`${tag} vertical ${mode}: ${d}`));
    proc.stdout.on('data', chunk => {
      for (const d of dests.values()) {
        if (d.vertical === mode && d.proc && d.proc.stdin.writable) {
          d.proc.stdin.write(chunk);
          d.bytes += chunk.length;
        }
      }
    });
    proc.on('error', err => console.log(`${tag} vertical ${mode}: ${err.message}`));
    proc.on('close', code => {
      if (verticals.get(mode) === proc) verticals.delete(mode);
      console.log(`${tag} vertical ${mode} exited (${code})`);
      // ล่มระหว่างไลฟ์ → เริ่มใหม่ ถ้ายังมีปลายทางแนวตั้งแบบนี้อยู่
      if (!closed && [...dests.values()].some(d => d.wanted && d.vertical === mode)) setTimeout(() => startVertical(mode), RETRY_MS).unref();
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
      send({ type: 'status', destinations: [{ id, name: String(raw.name || ''), state: 'error', message: /^(ndi|omt):\/\//i.test(String(raw.url || '')) ? NET_ONLY_DESKTOP : 'URL ต้องเป็น rtmp://, rtmps:// หรือ srt://host:port', kbps: 0 }] });
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
    d.vertical = VERTICAL_MODES.includes(raw.vertical) ? raw.vertical : '';
    d.wanted = true;
    clearTimeout(d.retry);
    if (d.vertical) startVertical(d.vertical);
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
    rxKbps = Math.round(rxBytes * 8 / 2000);
    rxBytes = 0;
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
      } else if (msg.type === 'probe' && msg.destination && typeof msg.destination === 'object') {
        const id = String(msg.destination.id || '').slice(0, 40), url = String(msg.destination.url || '');
        if (!OUTPUT_RE(url)) send({ type: 'probe', id, ok: false, message: /^(ndi|omt):\/\//i.test(url) ? 'ส่งออกในวง LAN — ไม่ต้องตรวจรหัส' : 'URL ต้องเป็น rtmp://, rtmps:// หรือ srt://host:port' });
        else probeDest(url).then(r => send({ type: 'probe', id, ...r }));
      }
      return;
    }
    rxBytes += data.length;
    if (encoder && encoder.stdin.writable) encoder.stdin.write(data);
  });

  ws.on('close', code => {
    closed = true;
    clearInterval(timer);
    // หลุดระหว่างไลฟ์ (ไม่ใช่การกดหยุด) → แจ้งเตือนถ้าไม่กลับมาใน 30 วินาที
    const wasLive = [...dests.values()].some(d => d.wanted && d.state === 'live');
    if (wasLive && code !== 1000 && session.encoding && !session.stoppedByAdmin) streamDropped(user.name, auth.ip);
    if (session.encoding && !session.stoppedByAdmin) recentlyLive.set(user.name, Date.now());
    if (session.encoding && code === 1000) monitor.log(`${user.name} หยุดไลฟ์ (ไลฟ์มา ${Math.max(1, Math.round((Date.now() - session.startedAt) / 60000))} นาที)`);
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
    for (const v of verticals.values()) {
      v.stdin.end();
      setTimeout(() => v.kill('SIGINT'), 5000).unref();
    }
    console.log(`${tag} disconnected`);
  });
}

module.exports = { handleStream };
