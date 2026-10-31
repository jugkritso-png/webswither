// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แหล่งภาพโปร่งใส (Transparent แบบ vMix): ไม่มีภาพ — บน Overlay / ซีน เห็นภาพด้านล่าง · เป็นภาพหลัก = ดำ · การ์ดเป็นลายตาราง · บันทึกในโชว์
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  const px = (sel, x, y) => p.evaluate(([sel, x, y]) => { const c = document.querySelector(sel); return Array.from(c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3)); }, [sel, x, y]);
  const pgm = (x, y) => px('#pgm-canvas', x, y);
  const near = (a, b2, t = 40) => a.every((v, i) => Math.abs(v - b2[i]) <= t);

  await p.click('[data-action=add-menu]');
  ok('add menu offers Transparent', await p.isVisible('.menu button:has-text("โปร่งใส (Transparent)")'));
  await p.click('.menu button:has-text("โปร่งใส (Transparent)")'); await p.waitForTimeout(400);
  const tid = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'transparent')?.id);
  ok('a TRANSPARENT source is added', !!tid && /TRANSPARENT/.test(await p.textContent(`#inputs-grid .card[data-id="${tid}"] .card-name`)));
  const thumb = await p.evaluate(id => { const c = document.querySelector(`#inputs-grid .card[data-id="${id}"] canvas`); const g = c.getContext('2d'); const a = g.getImageData(1, 1, 1, 1).data, s = Math.max(6, Math.round(c.height / 14)), b2 = g.getImageData(s + 1, 1, 1, 1).data; return [a[0], b2[0]]; }, tid);
  ok('card thumbnail shows a checkerboard', Math.abs(thumb[0] - thumb[1]) > 30, JSON.stringify(thumb));

  // ภาพหลัก = Color Bars แล้วซ้อนแหล่งโปร่งใสบน Overlay 1 → Program ต้องยังเป็นแถบสีเหมือนเดิม
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'bars').id; });
  await p.waitForTimeout(400);
  const before = [await pgm(0.1, 0.3), await pgm(0.5, 0.3), await pgm(0.9, 0.3)];
  const c = p.locator(`#inputs-grid .card[data-id="${tid}"]`); await c.hover();
  await c.locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(900);
  ok('transparent source is on Overlay 1', await p.evaluate(id => window.webmix.ovl[0].on && window.webmix.ovl[0].inputId === id, tid));
  const after = [await pgm(0.1, 0.3), await pgm(0.5, 0.3), await pgm(0.9, 0.3)];
  ok('…and the picture underneath stays fully visible', after.every((v, i) => near(v, before[i], 12)), JSON.stringify({ before, after }));
  await c.locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(600);

  // เป็นภาพหลักของ Program = ดำ
  await p.evaluate(id => { window.webmix.state.programId = id; }, tid);
  await p.waitForTimeout(400);
  ok('as the main Program source it shows black', near(await pgm(0.5, 0.5), [0, 0, 0], 8), JSON.stringify(await pgm(0.5, 0.5)));

  // บันทึก/เปิดโชว์
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(1200);
  ok('kept in the show after reload', await p.evaluate(() => window.webmix.inputs.some(i => i.type === 'transparent')));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
