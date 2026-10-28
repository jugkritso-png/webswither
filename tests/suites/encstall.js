// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ตัวเข้ารหัส WebCodecs ของมือถือค้าง (กดโฮม/ระบบเอาชิปคืน): ตัวบันทึกต้องสร้างตัวเข้ารหัสใหม่เองในที่เดิม
// ไฟล์/สตรีมเดินต่อโดยไม่ต้องเชื่อมต่อใหม่ · ค้างเกิน 3 ครั้งในหนึ่งนาที = แจ้ง error (แอปเชื่อมต่อใหม่ตามเดิม)
// จำลองการค้างด้วย VideoEncoder ที่ห่อตัวจริงไว้ แล้วหยุดรับเฟรมตามที่สั่ง
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const { spawnSync } = require('child_process');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const frames = f => parseInt(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
const decodeErrors = f => spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.trim();
const maxGap = f => {
  const t = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.split('\n').map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  let g = 0; for (let i = 1; i < t.length; i++) g = Math.max(g, t[i] - t[i - 1]);
  return { gap: g, last: t[t.length - 1] || 0 };
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => window.WebMix && window.WebMix.wcrec);
  // ห่อ VideoEncoder: ตัวที่ถูกสั่ง stall รับเฟรมแต่ไม่ส่งอะไรออกมา (คิวโตขึ้นเรื่อย ๆ, flush ไม่จบ) เหมือน MediaCodec ที่ค้าง
  await p.evaluate(() => {
    const Real = window.VideoEncoder;
    window.__encs = [];
    window.__stallNew = 0; // จำนวนตัวเข้ารหัสที่สร้างใหม่ซึ่งจะค้างทันที
    window.VideoEncoder = class {
      constructor(init) {
        this.stalled = false; this.q = 0; this.init = init;
        this.real = new Real({ output: (c, m) => init.output(c, m), error: e => init.error(e) });
        if (window.__stallNew > 0) { window.__stallNew--; this.stalled = true; }
        window.__encs.push(this);
      }
      configure(c) { this.real.configure(c); }
      encode(f, o) { if (this.stalled) { this.q++; return; } this.real.encode(f, o); }
      get encodeQueueSize() { return this.stalled ? this.q : this.real.encodeQueueSize; }
      get state() { return this.real.state; }
      flush() { return this.stalled ? new Promise(() => {}) : this.real.flush(); }
      close() { this.real.close(); }
      reset() { this.real.reset(); }
      static isConfigSupported(c) { return Real.isConfigSupported(c); }
    };
  });

  // อัด 10 วินาทีจากแคนวาสที่เคลื่อนไหว · stall ตัวที่ใช้อยู่ที่วินาทีที่ 3 · ส่งคืนไฟล์ + สถิติ
  const run = (opts) => p.evaluate(async ({ stallAt, stallNew, errorAt, preferAvc, total }) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let n = 0;
    const draw = setInterval(() => { g.fillStyle = `hsl(${(n * 7) % 360} 70% 45%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.fillRect((n++ * 9) % 600, 150, 40, 40); }, 33);
    window.__encs = [];
    const rec = await window.WebMix.wcrec.createRecorder({ canvas: c, audioNode: null, fps: 30, videoBitsPerSecond: 1500000, preferAvc, requireAvc: preferAvc });
    const parts = [], events = [];
    rec.ondataavailable = e => parts.push(e.data);
    rec.onrestart = e => events.push('restart ' + (e && e.message || ''));
    rec.onerror = e => events.push('error ' + (e.error && e.error.message || ''));
    const stopped = new Promise(r => { rec.onstop = r; });
    rec.start(500);
    const t0 = performance.now();
    if (stallAt) setTimeout(() => { window.__stallNew = stallNew; const e = window.__encs[window.__encs.length - 1]; e.stalled = true; }, stallAt);
    if (errorAt) setTimeout(() => { const e = window.__encs[window.__encs.length - 1]; e.init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError')); }, errorAt);
    await new Promise(r => setTimeout(r, total));
    const stopAt = performance.now();
    if (rec.state !== 'inactive') rec.stop();
    await Promise.race([stopped, new Promise(r => setTimeout(r, 6000))]);
    const stopMs = performance.now() - stopAt;
    clearInterval(draw);
    const blob = new Blob(parts, { type: rec.mimeType });
    const buf = new Uint8Array(await blob.arrayBuffer()); let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    window.__stallNew = 0;
    return { b64: btoa(bin), mime: rec.mimeType, restarts: rec.encoderRestarts, encoders: window.__encs.length, events, stopMs: Math.round(stopMs), state: rec.state, ranMs: Math.round(stopAt - t0) };
  }, opts);

  const avc = await p.evaluate(() => window.WebMix.wcrec.avcSupported(640, 360, 30, 1500000));
  for (const preferAvc of avc ? [true, false] : [false]) {
    const tag = preferAvc ? 'H.264' : 'VP8';
    // 1) ค้างหนึ่งครั้ง → สร้างใหม่ สตรีมเดินต่อ ไฟล์ถอดรหัสได้ ไม่มีช่วงขาดยาว
    const r1 = await run({ stallAt: 3000, stallNew: 0, preferAvc, total: 10000 });
    const f1 = `${S}/encstall-${tag}.webm`; fs.writeFileSync(f1, Buffer.from(r1.b64, 'base64'));
    ok(`${tag}: stalled encoder is replaced once`, r1.restarts === 1 && r1.encoders === 2, JSON.stringify({ restarts: r1.restarts, encoders: r1.encoders, events: r1.events }));
    ok(`${tag}: no error reported (stream keeps going)`, !r1.events.some(e => e.startsWith('error')), r1.events.join(' | '));
    const de = decodeErrors(f1);
    ok(`${tag}: file decodes without errors after the restart`, de === '', de.slice(0, 300));
    const fr = frames(f1), gp = maxGap(f1);
    ok(`${tag}: video continues after the stall`, gp.last > 8.5 && fr > 150, `${fr} frames, last at ${gp.last.toFixed(1)} s`);
    ok(`${tag}: gap during the stall stays short (< 6 s)`, gp.gap < 6, `${gp.gap.toFixed(2)} s`);

    // 2) ระบบเอาตัวเข้ารหัสคืน (error callback) → สร้างใหม่เหมือนกัน
    const r2 = await run({ errorAt: 2500, preferAvc, total: 6000 });
    const f2 = `${S}/encstall-err-${tag}.webm`; fs.writeFileSync(f2, Buffer.from(r2.b64, 'base64'));
    ok(`${tag}: encoder error (codec reclaimed) restarts instead of stopping`, r2.restarts === 1 && !r2.events.some(e => e.startsWith('error')), JSON.stringify(r2.events));
    ok(`${tag}: stream after a reclaimed encoder decodes`, decodeErrors(f2) === '' && maxGap(f2).last > 4.5, `last at ${maxGap(f2).last.toFixed(1)} s`);

    // 3) ค้างซ้ำทุกตัว → หลังเริ่มใหม่ 3 ครั้งแจ้ง error และหยุด (แอปจะเชื่อมต่อใหม่ตามเดิม) · หยุดได้แม้ flush ไม่จบ
    const r3 = await run({ stallAt: 2000, stallNew: 99, preferAvc, total: 26000 });
    ok(`${tag}: gives up after 3 restarts in a minute`, r3.restarts === 3 && r3.events.some(e => e.startsWith('error')), JSON.stringify(r3.events));
    ok(`${tag}: stops even when flush never finishes`, r3.state === 'inactive', `state ${r3.state}`);
  }
  if (!avc) console.log('INFO  WebCodecs H.264 not available in this Chromium — H.264 cases skipped');

  // เวลาหมดของ isConfigSupported: ตัวเข้ารหัสที่ไม่ตอบต้องไม่ทำให้แอปค้าง
  const t = await p.evaluate(async () => {
    const saved = window.VideoEncoder.isConfigSupported;
    window.VideoEncoder.isConfigSupported = () => new Promise(() => {});
    const t0 = performance.now();
    const r = await window.WebMix.wcrec.avcSupported(640, 360, 30, 1500000);
    window.VideoEncoder.isConfigSupported = saved;
    return { r, ms: Math.round(performance.now() - t0) };
  });
  ok('hung isConfigSupported times out (no app hang)', t.r === false && t.ms < 15000, `${t.ms} ms`);

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
