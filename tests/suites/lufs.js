// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// มิเตอร์ความดัง LUFS (EBU R128): สัญญาณอ้างอิงไซน์ 1 kHz สเตอริโอ −23 dBFS = −23.0 LUFS (EBU Tech 3341) ·
// M / S / I · สีตามเป้าหมาย · เลือกเป้าหมาย · เริ่มวัดใหม่ · gate −70 (เงียบไม่ดึงค่า I ลง) · ส่งให้รีโมตเสียง
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  ok('LUFS readout in the audio panel', await p.isVisible('#lufs') && (await p.textContent('#lufs')).includes('LUFS'));

  // สัญญาณอ้างอิง: ไซน์ 997 Hz ยอด −23 dBFS ทั้งสองช่อง (ช่องอื่นปิดเสียง)
  await p.evaluate(() => {
    const a = window.webmix.audio; a.ensure(); a.setLimiter(false); // วัดสัญญาณอ้างอิงตรง ๆ (ลิมิตเตอร์ของ Chrome มี makeup gain)
    for (const c of a.channels) { c.muted = true; a.applyGain(c); }
    const o = a.ctx.createOscillator(); o.frequency.value = 997;
    const g = a.ctx.createGain(); g.gain.value = Math.pow(10, -23 / 20);
    o.connect(g); g.connect(a.master); o.start();
    window.__tone = g;
  });
  await p.waitForTimeout(4500);
  const L = () => p.evaluate(() => { const l = window.webmix.lufs; return { m: l.m, s: l.s, i: l.i }; });
  let v = await L();
  ok('reference tone: Momentary −23.0 ±0.3', Math.abs(v.m + 23) < 0.3, JSON.stringify(v));
  ok('reference tone: Short-term −23.0 ±0.3', Math.abs(v.s + 23) < 0.3);
  ok('reference tone: Integrated −23.0 ±0.3', Math.abs(v.i + 23) < 0.3);
  ok('display shows S and I', (await p.textContent('#lufs .lu-s')).trim() === v.s.toFixed(1) || Math.abs(+(await p.textContent('#lufs .lu-s')) + 23) < 0.3);
  ok('−23 against the −14 target is marked too quiet (blue)', await p.getAttribute('#lufs', 'data-level') === 'low');

  // เงียบช่วงหนึ่ง: M/S ตก แต่ I ไม่ถูกดึงลง (gate −70)
  await p.evaluate(() => { window.__tone.gain.value = 0; });
  await p.waitForTimeout(3500);
  v = await L();
  ok('silence: M / S drop away, I held by the gate', v.m < -60 && v.s < -60 && Math.abs(v.i + 23) < 0.4, JSON.stringify(v));

  // ดังขึ้น 9 dB = −14 → เขียวกับเป้า −14
  await p.evaluate(() => { window.__tone.gain.value = Math.pow(10, -14 / 20); });
  await p.waitForTimeout(3500);
  v = await L();
  ok('+9 dB reads −14 LUFS and turns green at the −14 target', Math.abs(v.s + 14) < 0.3 && await p.getAttribute('#lufs', 'data-level') === 'ok', JSON.stringify(v));
  await p.screenshot({ path: S + '/lufs.png', clip: { x: 1030, y: 540, width: 410, height: 200 } });

  // เปลี่ยนเป้าเป็น −23 → ดังเกิน (แดง) · เริ่มวัด I ใหม่
  await p.click('#lufs'); await p.click('.menu [data-t="-23"]');
  ok('target −23 (EBU R128): −14 is marked too loud', await p.getAttribute('#lufs', 'data-level') === 'hot' && (await p.textContent('#lufs .lu-t')).trim() === '-23');
  ok('target remembered', await p.evaluate(() => localStorage.getItem('webmix:lufsTarget')) === '"-23"');
  await p.click('#lufs'); await p.click('.menu [data-reset]');
  await p.waitForTimeout(1500);
  v = await L();
  ok('reset restarts Integrated from the current level', Math.abs(v.i + 14) < 0.5, JSON.stringify(v));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
