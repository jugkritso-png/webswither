// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Gateway Rust: ตัวเข้ารหัส (ffmpeg กลาง) ล่มกลางไลฟ์ → เริ่มตัวใหม่ในการเชื่อมต่อเดิม ปลายทางต่อใหม่เองภายในไม่กี่วินาที
// (Android เรียกตัวเข้ารหัสฮาร์ดแวร์คืนได้ตอนแอปไปอยู่เบื้องหลัง) · ตัวเข้ารหัสฮาร์ดแวร์ใช้ไม่ได้ → ใช้ libx264 แทน ·
// ล่มบ่อยเกินกำหนด → ปิดการเชื่อมต่อให้แอปต่อใหม่เองแบบเดิม
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(250); } return false; };
const ROOT = path.join(__dirname, '..', '..');

// เครื่องรับ RTMP ที่รับการเชื่อมต่อใหม่ทุกครั้ง (ไฟล์ละการเชื่อมต่อ)
function receiver(port, key, prefix) {
  let n = 0, stopped = false, child = null;
  const files = [];
  const next = () => {
    if (stopped) return;
    const f = `${S}/${prefix}-${n++}.flv`;
    try { fs.unlinkSync(f); } catch (e) {}
    files.push(f);
    child = spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/${key}`, '-c', 'copy', '-y', f], { stdio: 'ignore' });
    child.on('exit', () => setTimeout(next, 100));
  };
  next();
  return {
    files: () => files.filter(f => fs.existsSync(f) && fs.statSync(f).size > 0),
    stop() { stopped = true; try { child.kill('SIGINT'); } catch (e) {} }
  };
}
// ไฟล์ที่ยังเขียนอยู่ยังไม่มีความยาวในส่วนหัว — นับแพ็กเก็ตวิดีโอแทน (30 fps)
const vframes = f => +(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout || 0);
const encoderPids = () => (spawnSync('pgrep', ['-f', 'stats_period 2 -i pipe:0'], { encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean).map(Number);

// สตรีมจากหน้าเว็บตรงไป Gateway (แคนวาสเคลื่อนไหว + เสียง → MediaRecorder WebM) — บันทึกสถานะ/การปิดการเชื่อมต่อ
const STREAM = ({ gw, dest }) => {
  const st = window.__st = { states: [], closed: null, live: 0 };
  const c = document.createElement('canvas'); c.width = 640; c.height = 360;
  const g = c.getContext('2d'); let n = 0;
  st.timer = setInterval(() => { g.fillStyle = `hsl(${(n * 7) % 360} 70% 45%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText(String(n++), 40, 200); }, 33);
  const stream = c.captureStream(30);
  const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start();
  d.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const ws = st.ws = new WebSocket(`${gw}&fps=30&vb=1200&res=360`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'start', destinations: [{ id: 'd1', name: 'test', url: dest }] }));
    const rec = st.rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 1200000 });
    rec.ondataavailable = e => { if (e.data.size && ws.readyState === 1) ws.send(e.data); };
    rec.start(500);
  };
  ws.onmessage = e => {
    if (typeof e.data !== 'string') return;
    const m = JSON.parse(e.data);
    for (const x of m.destinations || []) { if (st.states[st.states.length - 1] !== x.state) st.states.push(x.state); st.state = x.state; if (x.state === 'live') st.live++; }
  };
  ws.onclose = e => { st.closed = `${e.code} ${e.reason}`; };
};
const STOP = () => { const st = window.__st; clearInterval(st.timer); try { st.rec.stop(); } catch (e) {} try { st.ws.close(1000); } catch (e) {} };

(async () => {
  if (!process.env.GATEWAY_BIN) {
    ok('Node gateway: encoder restart is a Rust-gateway feature (the app reconnects on its own) — skipped', true);
    console.log(results.join('\n')); return;
  }
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext()).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(500);
  const st = () => p.evaluate(() => { const s = window.__st; return { state: s.state, states: s.states.join('>'), closed: s.closed }; });

  // 1) ตัวเข้ารหัสล่มกลางไลฟ์ → เริ่มใหม่ การเชื่อมต่อของแอปไม่หลุด
  const rx = receiver(19371, 'enc', 'encr');
  await p.evaluate(STREAM, { gw: 'ws://127.0.0.1:8089/?token=abc', dest: 'rtmp://127.0.0.1:19371/live/enc' });
  ok('stream goes live', await until(async () => (await st()).state === 'live', 20000), JSON.stringify(await st()));
  await sleep(4000);
  const pids = encoderPids();
  ok('one encoder process running', pids.length === 1, JSON.stringify(pids));
  pids.forEach(pid => { try { process.kill(pid, 'SIGKILL'); } catch (e) {} });
  const t0 = Date.now();
  await until(async () => (await st()).state !== 'live', 6000);
  const back = await until(async () => (await st()).state === 'live', 15000);
  const s1 = await st();
  ok('after the encoder dies the destination is live again', back && /live>(connecting|error)>.*live$/.test(s1.states), `${s1.states} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  ok('the app connection stays open (no reconnect needed)', !s1.closed, s1.closed || '');
  ok('a new encoder process replaced the old one', encoderPids().length === 1 && !encoderPids().includes(pids[0]));
  await sleep(6000);
  const segs = rx.files();
  const f2 = segs[1] ? vframes(segs[1]) : 0;
  ok('the receiver gets a second, playable connection', segs.length >= 2 && f2 > 90, `${segs.length} file(s), 2nd has ${f2} video frames`);

  // ffmpeg ของปลายทางที่ไลฟ์อยู่แล้วหลุด → ลองใหม่หลัง 1 วินาที (เดิม 5) — กลับมา LIVE ราว 5–6 วินาที (เดิมราว 9)
  const destPids = (spawnSync('pgrep', ['-f', 'progress pipe:1.*19371/live/enc'], { encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean).map(Number);
  destPids.forEach(pid => { try { process.kill(pid, 'SIGKILL'); } catch (e) {} });
  const t1 = Date.now();
  await until(async () => (await st()).state !== 'live', 4000);
  const quick = await until(async () => (await st()).state === 'live', 10000);
  const took = (Date.now() - t1) / 1000;
  ok('a live destination that drops is retried quickly', destPids.length === 1 && quick && took < 7.5 && !(await st()).closed, `${destPids.length} process · back in ${took.toFixed(1)} s`);

  // 2) ล่มเกินกำหนด (3 ครั้งต่อนาที) → ปิดการเชื่อมต่อให้แอปต่อใหม่แบบเดิม
  for (let i = 0; i < 3; i++) {
    await until(async () => (await st()).state === 'live', 15000);
    await sleep(1500);
    encoderPids().forEach(pid => { try { process.kill(pid, 'SIGKILL'); } catch (e) {} });
    await sleep(1500);
  }
  const closed = await until(async () => !!(await st()).closed, 10000);
  ok('too many crashes in a minute: connection closed so the app reconnects', closed && /encoder exited/.test((await st()).closed || ''), (await st()).closed || JSON.stringify(await st()));
  await p.evaluate(STOP).catch(() => {});
  rx.stop();

  // 3) ตัวเข้ารหัสฮาร์ดแวร์ใช้ไม่ได้ → ล่มทันที → ใช้ libx264 แทน ไลฟ์ได้
  const gw2 = spawn(path.resolve(ROOT, process.env.GATEWAY_BIN), [], { env: { ...process.env, PORT: '8091', STREAM_TOKEN: 'abc', VIDEO_ENCODER: 'h264_nvenc' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let log2 = ''; gw2.stderr.on('data', d => { log2 += d; });
  await sleep(1500);
  const rx2 = receiver(19372, 'hw', 'encr-hw');
  await p.evaluate(STREAM, { gw: 'ws://127.0.0.1:8091/?token=abc', dest: 'rtmp://127.0.0.1:19372/live/hw' });
  const hwLive = await until(async () => (await st()).state === 'live', 25000);
  ok('unusable hardware encoder falls back to libx264 and goes live', hwLive && !(await st()).closed && /switching to libx264/.test(log2), `${JSON.stringify(await st())} · ${log2.split('\n').filter(l => /encoder|libx264/.test(l)).slice(-4).join(' | ')}`);
  await p.evaluate(STOP).catch(() => {});
  rx2.stop(); gw2.kill('SIGKILL');

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
