// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ปรับสีต่อแหล่งภาพ: ความสว่าง / ความอิ่มสี เห็นผลทันทีทั้ง CPU และ GPU, ยกเลิกแล้วกลับค่าเดิม, จำค่าไว้กับโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(`${S}/green.png`);
  await p.waitForTimeout(800);
  await p.evaluate(() => { const w = window.webmix; const img = w.inputs.find(i => i.type === 'image'); w.state.programId = img.id; });
  const px = () => p.evaluate(() => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; g.getContext('2d').drawImage(c, 0, 0); return Array.from(g.getContext('2d').getImageData(Math.round(c.width * 0.15), Math.round(c.height * 0.3), 1, 1).data.slice(0, 3)); });
  const until = async test => { let v; for (let i = 0; i < 15; i++) { v = await px(); if (test(v)) return v; await p.waitForTimeout(200); } return v; };
  const green = c => c[1] > 200 && c[0] < 60 && c[2] < 60;
  const base = await until(green);
  ok('image on Program is green', green(base), JSON.stringify(base));
  const card = p.locator('.card').last(); await card.hover(); await card.locator('[data-card=rename]').click();
  await p.waitForSelector('[data-cc=b]');
  const set = (k, v) => p.evaluate(([k, v]) => { const r = document.querySelector(`[data-cc=${k}]`); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  for (const mode of ['cpu', 'gpu']) {
    await p.evaluate(m => window.webmix.setRenderer(m), mode);
    await set('b', 0.5); await set('s', 1);
    const dark = await until(c => c[1] > 70 && c[1] < 160);
    ok(`${mode}: brightness −50% darkens the picture live`, dark[1] > 70 && dark[1] < 160 && dark[0] < 50, JSON.stringify(dark));
    await set('b', 1); await set('s', 0);
    const grey = await until(c => Math.max(...c) - Math.min(...c) < 30);
    ok(`${mode}: saturation 0 turns it grey`, Math.max(...grey) - Math.min(...grey) < 30, JSON.stringify(grey));
    await set('s', 1);
  }
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  await set('b', 0.6);
  await p.click('.modal-foot button:has-text("ยกเลิก")');
  const back = await until(green);
  ok('cancel restores the original colours', green(back), JSON.stringify(back));
  await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('[data-cc=b]');
  await set('t', 0.8); await set('b', 1.2);
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const saved = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'image').color);
  ok('saved colour settings', saved && saved.t === 0.8 && saved.b === 1.2, JSON.stringify(saved));
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'image').color);
  ok('colour settings survive reload', after && after.t === 0.8 && after.b === 1.2, JSON.stringify(after));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
