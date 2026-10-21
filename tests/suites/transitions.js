// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ทรานซิชันเพิ่ม: PUSH (ภาพใหม่ดันภาพเดิม) ทั้ง CPU/GPU · STINGER (วิดีโอโปร่งใสเล่นทับ สลับภาพที่จุดตัด จำไฟล์ไว้)
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  ok('effect buttons: MIX DIP WIPE PUSH STING', JSON.stringify(await p.$$eval('#seg-transition button', bs => bs.map(x => x.textContent.trim()))) === JSON.stringify(['MIX', 'DIP', 'WIPE', 'PUSH', 'STING']));
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(`${S}/green.png`);
  await p.waitForTimeout(800);
  // A = ดำ (Program), B = ภาพเขียว (Preview)
  const setAB = () => p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'black').id; w.setPreview(w.inputs.find(i => i.type === 'image').id); });
  await setAB();
  const px = (fx, fy = 0.3) => p.evaluate(([fx, fy]) => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; g.getContext('2d').drawImage(c, 0, 0); return Array.from(g.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)); }, [fx, fy]);
  const green = c => c[1] > 200 && c[0] < 60 && c[2] < 60, black = c => Math.max(...c) < 30, magenta = c => c[0] > 200 && c[2] > 200 && c[1] < 60;

  // PUSH ครึ่งทาง: ซ้าย = ภาพเดิม (ดำ) ขวา = ภาพใหม่ (เขียว)
  await p.click('#seg-transition [data-value=push]');
  for (const mode of ['cpu', 'gpu']) {
    await p.evaluate(m => { window.webmix.setRenderer(m); window.webmix.tr.progress = 0.5; }, mode);
    await p.waitForTimeout(400);
    const L = await px(0.25), R = await px(0.75);
    ok(`${mode}: push halfway shows old left / new right`, black(L) && green(R), JSON.stringify({ L, R }));
  }
  await p.evaluate(() => { window.webmix.tr.progress = 0; window.webmix.setRenderer('cpu'); });

  // STINGER: เลือกครั้งแรกเปิดหน้าเลือกวิดีโอ
  await p.click('#seg-transition [data-value=stinger]');
  await p.waitForSelector('[data-st-pick]');
  ok('choosing STING without a video opens the stinger dialog', true);
  const fc2 = p.waitForEvent('filechooser'); await p.click('[data-st-pick]'); await (await fc2).setFiles(`${S}/sting.webm`);
  await p.evaluate(() => { const r = document.querySelector('.modal input[name=cutAt]'); r.value = 50; r.dispatchEvent(new Event('input')); });
  await p.click('.modal-foot .btn-primary');
  await p.waitForFunction(() => window.webmix.stinger.ready, null, { timeout: 5000 }).catch(() => {});
  ok('stinger video loaded', await p.evaluate(() => window.webmix.stinger.ready && window.webmix.settings.stinger.name === 'sting.webm'));

  // ตรวจทีละจุดโดยหยุดวิดีโอไว้ (เครื่องทดสอบถอดรหัสวิดีโอช้า เฟรมจึงกระตุก — ความคืบหน้าอิงเวลาวิดีโอ)
  await p.evaluate(() => { window.webmix.stinger.stallMs = 60000; });
  const at = async t => { await p.evaluate(t => { const v = window.webmix.stinger.el; v.pause(); v.currentTime = t; }, t); await p.waitForTimeout(500); return px(0.25); };
  for (const mode of ['cpu', 'gpu']) {
    await p.evaluate(m => window.webmix.setRenderer(m), mode);
    await setAB(); await p.waitForTimeout(300);
    await p.evaluate(() => window.webmix.autoTransition());
    const c1 = await at(0.3), p1 = await p.evaluate(() => window.webmix.tr.progress);
    ok(`${mode}: before the cut point: old picture, stinger still clear`, black(c1) && p1 > 0.1 && p1 < 0.2, JSON.stringify({ c1, p1 }));
    const c2 = await at(1.0);
    ok(`${mode}: stinger covers the screen mid-way`, magenta(c2), JSON.stringify(c2));
    const c3 = await at(1.6);
    ok(`${mode}: after the cut point: new picture under a clear stinger`, green(c3) && await p.evaluate(() => window.webmix.tr.auto), JSON.stringify(c3));
    const t0 = Date.now();
    await p.evaluate(() => window.webmix.stinger.el.play());
    await p.waitForFunction(() => !window.webmix.tr.auto, null, { timeout: 8000 }).catch(() => {});
    ok(`${mode}: finishes when the video ends and swaps buses`, await p.evaluate(() => window.webmix.state.programId === window.webmix.inputs.find(i => i.type === 'image').id) && Date.now() - t0 < 6000);
    await p.waitForTimeout(300);
    const after = await px(0.25);
    ok(`${mode}: new picture after, no stinger left`, green(after), JSON.stringify(after));
  }

  // วิดีโอค้างเกินกำหนด → จบทรานซิชันเอง ไม่ค้างกลางทาง
  await p.evaluate(() => { window.webmix.stinger.stallMs = 1000; });
  await setAB(); await p.evaluate(() => window.webmix.autoTransition()); await at(0.3);
  await p.waitForFunction(() => !window.webmix.tr.auto, null, { timeout: 5000 }).catch(() => {});
  ok('a stalled stinger still finishes the transition', await p.evaluate(() => !window.webmix.tr.auto && window.webmix.state.programId === window.webmix.inputs.find(i => i.type === 'image').id));

  // CUT ระหว่างสติงเกอร์ หยุดวิดีโอทันที
  await setAB(); await p.evaluate(() => window.webmix.autoTransition()); await p.waitForTimeout(300);
  await p.click('[data-action=cut]'); await p.waitForTimeout(200);
  ok('CUT during a stinger stops it', await p.evaluate(() => !window.webmix.tr.auto && window.webmix.stinger.el.paused));

  // เปิดหน้าใหม่: จำไฟล์ + จุดตัด
  await p.reload(); await p.waitForTimeout(800);
  await p.waitForFunction(() => window.webmix.stinger.ready, null, { timeout: 5000 }).catch(() => {});
  ok('stinger file and effect remembered after reload', await p.evaluate(() => window.webmix.stinger.ready && window.webmix.settings.transition === 'stinger' && window.webmix.settings.stinger.cutAt === 0.5));
  await p.click('#seg-transition [data-value=stinger]');
  ok('pressing STING again opens its settings', await p.isVisible('[data-st-pick]'));
  await p.screenshot({ path: S + '/stinger-dialog.png' });
  await p.click('.modal-foot button:has-text("ยกเลิก")');
  await p.screenshot({ path: S + '/transitions.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
