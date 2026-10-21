// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ซีน: หลายแหล่งภาพในจอเดียว (คู่กัน / ภาพซ้อนมุม / 4 ช่อง) — วาดถูกตำแหน่งทั้ง CPU และ GPU, tally, บันทึก/เปิดโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  // แหล่งภาพเริ่มต้น: SLATE, BARS, CLOCK, BLACK
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ซีน / แบ่งจอ")');
  await p.waitForSelector('.sc-layouts');
  ok('scene dialog offers 5 layouts', (await p.locator('.sc-layout').count()) === 5);
  await p.selectOption('select[data-slot="0"]', { index: 2 }); // BARS
  await p.selectOption('select[data-slot="1"]', { index: 4 }); // BLACK
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(400);
  const sc = await p.evaluate(() => { const w = window.webmix; const s = w.inputs.find(i => i.type === 'scene'); return s && { id: s.id, scene: s.scene, pvw: w.state.previewId === s.id }; });
  ok('scene created and put on Preview', sc && sc.scene.layout === 'side' && sc.scene.slots.length === 2 && sc.pvw, JSON.stringify(sc));
  await p.click('[data-action=cut]'); await p.waitForTimeout(500);
  const px = (x, y) => p.evaluate(([x, y]) => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; g.getContext('2d').drawImage(c, 0, 0); return Array.from(g.getContext('2d').getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data.slice(0, 3)); }, [x, y]);
  const isBlack = c => c.every(v => v < 25), colorful = c => Math.max(...c) - Math.min(...c) > 60;
  for (const mode of ['cpu', 'gpu']) {
    await p.evaluate(m => window.webmix.setRenderer(m), mode); await p.waitForTimeout(500);
    let left, right;
    for (let i = 0; i < 15; i++) { left = await px(0.12, 0.3); right = await px(0.85, 0.3); if (colorful(left) && isBlack(right)) break; await p.waitForTimeout(200); }
    ok(`${mode}: side-by-side — bars on the left, black on the right`, colorful(left) && isBlack(right), JSON.stringify({ left, right }));
  }
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  // tally: แหล่งภาพในซีนบน Program ถือว่าออกอากาศ
  const tally = await p.evaluate(() => [...document.querySelectorAll('#inputs-grid .card')].map(c => c.querySelector('.card-tally').textContent));
  ok('sources inside the program scene show SCENE tally', tally[1] === 'SCENE' && tally[3] === 'SCENE' && tally[4] === 'PGM', JSON.stringify(tally));
  // แก้ไขเป็นภาพซ้อนมุม
  const card = p.locator('.card').nth(4); await card.hover(); await card.locator('[data-card=rename]').click();
  await p.click('.sc-layout:has-text("ภาพซ้อนมุม")'); await p.waitForTimeout(100);
  await p.selectOption('select[data-slot="0"]', { index: 4 }); // BLACK เต็มจอ
  await p.selectOption('select[data-slot="1"]', { index: 2 }); // BARS มุมขวาล่าง
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(400);
  let bg, corner;
  for (let i = 0; i < 15; i++) { bg = await px(0.2, 0.2); corner = await px(0.8, 0.78); if (isBlack(bg) && colorful(corner)) break; await p.waitForTimeout(200); }
  ok('picture-in-picture: black full frame, bars in the corner', isBlack(bg) && colorful(corner), JSON.stringify({ bg, corner }));
  await p.screenshot({ path: S + '/scene-pip.png' });
  // บันทึก/เปิดโชว์: ซีนกลับมาพร้อมช่องเดิม
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(1200);
  const back = await p.evaluate(() => { const w = window.webmix; const s = w.inputs.find(i => i.type === 'scene'); return s && { layout: s.scene.layout, slots: s.scene.slots.map(id => (w.inputs.find(i => i.id === id) || {}).name) }; });
  ok('scene survives reload with the same layout and sources', back && back.layout === 'pip' && back.slots[0] === 'BLACK' && back.slots[1] === 'COLOR BARS', JSON.stringify(back));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
