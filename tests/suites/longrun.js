// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ไม่อยู่ในชุดปกติ: npm test -- longrun · LONGRUN_MIN=นาที ค่าเริ่มต้น 10)
// ไลฟ์ยาว: สตรีมผ่าน Gateway ไปปลายทาง RTMP ต่อเนื่อง สลับภาพทุก 10 วินาที เปิด/ปิด Overlay พร้อมคลิปที่มีเสียง
// เก็บค่าทุก 30 วินาที: หน่วยความจำ (หลังเก็บขยะ) · จำนวน DOM · fps ของภาพ · สถานะไลฟ์ — แล้วตรวจว่าไม่รั่ว ไม่ช้าลง ไม่หลุด
// ไฟล์ที่ปลายทางได้: ยาวเท่าเวลาจริง และเสียงกับภาพไม่เหลื่อมกัน
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const S = process.env.WORK;
const MIN = Math.max(2, +process.env.LONGRUN_MIN || 10);
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
(async () => {
  const file = `${S}/longrun.flv`;
  const recv = spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', 'rtmp://127.0.0.1:19350/live/long', '-c', 'copy', '-y', file], { stdio: 'ignore' });
  const recvDone = new Promise(r => recv.on('exit', r));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'ws://127.0.0.1:8089/?token=abc', rememberKey: true,
    destinations: [{ id: 'a', platform: 'custom', server: 'rtmp://127.0.0.1:19350/live', key: 'long', enabled: true }] })); });
  await p.reload(); await p.waitForTimeout(1500);
  // คลิปวิดีโอที่มีเสียง (วนซ้ำ) — ให้มีทั้งภาพและเสียงตลอดรายการ
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/loud.webm');
  await p.waitForTimeout(1000);
  const ids = await p.evaluate(() => window.webmix.inputs.filter(i => ['media', 'bars', 'slate', 'clock'].includes(i.type)).map(i => i.id));
  const clip = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'media').id);
  await p.evaluate(id => { window.webmix.setPreview(id); window.webmix.cut(); }, clip);

  await p.click('[data-action=stream]'); await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]'); await p.keyboard.press('Escape');
  const btn = async () => (await p.textContent('#btn-stream')).trim();
  const live0 = await (async () => { for (let i = 0; i < 40; i++) { if ((await btn()).includes('ON AIR 1/1')) return true; await sleep(500); } return false; })();
  ok('goes live through the gateway', live0, await btn());
  const t0 = Date.now();

  const samples = [];
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const pg = await p.evaluate(() => ({ ...window.webmix.perf(), js: (performance.memory?.usedJSHeapSize || 0) / 1048576, dom: document.getElementsByTagName('*').length, reconnects: window.webmix.liveStats.session?.reconnects || 0, kbps: window.webmix.streamer?.kbps || 0 }));
    samples.push({ min: (Date.now() - t0) / 60000, heap: heap / 1048576, btn: await btn(), ...pg });
  };
  // ระหว่างไลฟ์: สลับภาพทุก 10 วินาที (ตัดสลับกับ AUTO) · เปิด/ปิด Overlay 1 ทุก 20 วินาที
  let k = 0, nextSample = 0;
  while (Date.now() - t0 < MIN * 60000) {
    const el = Date.now() - t0;
    if (el >= nextSample) { await sample(); nextSample += 30000; }
    k++;
    await p.evaluate(([id, auto]) => { const w = window.webmix; w.setPreview(id); auto ? w.autoTransition() : w.cut(); }, [ids[k % ids.length], k % 2 === 0]);
    if (k % 2 === 0) await p.evaluate(id => window.webmix.toggleInputOverlay(id, 0), ids.find(i => i !== clip) || clip);
    await sleep(10000);
  }
  await sample();
  const elapsed = (Date.now() - t0) / 1000;
  results.push(`INFO  ${samples.map(s => `${s.min.toFixed(1)}m heap ${s.heap.toFixed(1)}MB js ${s.js.toFixed(1)}MB dom ${s.dom} fps ${s.fps.toFixed(1)} ${s.kbps}kbps ${s.btn}`).join('\n        ')}`);

  // หน่วยความจำ: เทียบหลังอุ่นเครื่อง (ตัวอย่างที่ 2) กับตอนจบ — โตได้ไม่เกิน 30 MB หรือ 30%
  const warm = samples[Math.min(2, samples.length - 1)], last = samples[samples.length - 1];
  const grow = last.heap - warm.heap, growJs = last.js - warm.js;
  ok(`JS memory does not keep growing over ${MIN} min`, grow < Math.max(30, warm.heap * 0.3) && growJs < Math.max(30, warm.js * 0.3), `isolate ${warm.heap.toFixed(1)} → ${last.heap.toFixed(1)} MB · page ${warm.js.toFixed(1)} → ${last.js.toFixed(1)} MB`);
  ok('DOM node count stays flat', last.dom - warm.dom < 400, `${warm.dom} → ${last.dom}`);
  const f0 = median(samples.slice(1, 4).map(s => s.fps)), fEnd = median(samples.slice(-3).map(s => s.fps));
  ok('render frame rate does not drop over time', fEnd >= f0 * 0.8, `${f0.toFixed(1)} → ${fEnd.toFixed(1)} fps`);
  ok('stayed ON AIR the whole time, no reconnects', samples.every(s => s.btn.includes('ON AIR 1/1')) && last.reconnects === 0, `${samples.filter(s => !s.btn.includes('ON AIR 1/1')).length} samples off-air · reconnects ${last.reconnects}`);

  await b.close();
  await Promise.race([recvDone, sleep(15000)]); try { recv.kill('SIGINT'); } catch (e) {}
  await Promise.race([recvDone, sleep(5000)]);
  // ความยาวของภาพ / เสียงที่ปลายทางได้ และเสียงเหลื่อมกับภาพไหม (เทียบเวลาของแพ็กเก็ตสุดท้าย)
  const last_pts = sel => { const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 1 << 28 }); const t = (r.stdout || '').split('\n').map(Number).filter(Number.isFinite); return t.length ? { first: Math.min(...t.slice(0, 50)), last: Math.max(...t.slice(-200)), n: t.length } : null; };
  const v = last_pts('v'), a = last_pts('a');
  ok('destination received video for the whole show', v && v.last - v.first >= elapsed * 0.95, v ? `${(v.last - v.first).toFixed(1)} s of ${elapsed.toFixed(1)} s · ${(v.n / (v.last - v.first)).toFixed(1)} fps` : 'no video');
  ok('audio stays in sync with video to the end (< 0.3 s)', v && a && Math.abs((a.last - a.first) - (v.last - v.first)) < 0.3 && Math.abs(a.last - v.last) < 0.3, v && a ? `video ${v.first.toFixed(2)}–${v.last.toFixed(2)} · audio ${a.first.toFixed(2)}–${a.last.toFixed(2)}` : 'missing');
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n'));
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
