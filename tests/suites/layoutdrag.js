// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ตำแหน่ง Overlay แบบลากวาง: ลากมุมย่อขนาด (มุมตรงข้ามอยู่กับที่) · ลากย้ายแล้วติดแนวกลาง · Alt = ไม่ติด
// ลากขอบครอป · ปุ่มลูกศรขยับ · ดับเบิลคลิกเต็มจอ · แถบเลื่อนตามค่า · บันทึกเมื่อกดเสร็จ
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(`${S}/logo.png`);
  await p.waitForTimeout(600);
  const id = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'image').id);
  const card = p.locator(`.card[data-id="${id}"]`); await card.hover(); await card.locator('[data-card=layout]').click();
  await p.waitForSelector('.layout-preview'); await p.waitForTimeout(500); await p.screenshot({ path: S + '/ly.png' });
  const box = await p.locator('.layout-preview').boundingBox();
  const at = (fx, fy) => [box.x + fx * box.width, box.y + fy * box.height];
  const L = () => p.evaluate(i => JSON.parse(JSON.stringify(window.webmix.inputs.find(x => x.id === i).layout)), id);
  const dragTo = async (from, to, opts = {}) => { await p.mouse.move(...at(...from)); await p.mouse.down(); await p.mouse.move(...at(...to), { steps: 8 }); if (opts.alt) await p.keyboard.down('Alt'); await p.mouse.move(...at(...to)); if (opts.alt) { await p.mouse.move(at(...to)[0] + 0.5, at(...to)[1]); } await p.mouse.up(); if (opts.alt) await p.keyboard.up('Alt'); };
  // มุมขวาล่างไปกลางจอ → ขนาด 50% มุมซ้ายบนอยู่ที่เดิม
  await dragTo([0.995, 0.995], [0.5, 0.5]);
  let l = await L();
  ok('dragging the corner scales with the opposite corner fixed', near(l.scale, 0.5) && near(l.x, 0.25) && near(l.y, 0.25), JSON.stringify(l));
  ok('sliders follow the drag', (await p.inputValue('.modal input[name=scale]')) === '50' && (await p.inputValue('.modal input[name=x]')) === '25');
  // ลากย้ายไปใกล้กลางจอ → ติดแนวกลาง
  await dragTo([0.25, 0.25], [0.506, 0.25]);
  l = await L();
  ok('moving near the centre snaps to it', l.x === 0.5, JSON.stringify(l));
  await dragTo([0.5, 0.25], [0.51, 0.25], { alt: true });
  l = await L();
  ok('holding Alt does not snap', near(l.x, 0.51, 0.004) && l.x !== 0.5, JSON.stringify(l));
  // ครอปขอบซ้าย: ขีดกลางขอบซ้ายของภาพ (x 0.26, y 0.25) เลื่อนเข้าไป 10% ของกรอบ
  l = await L();
  const left = l.x - l.scale / 2;
  await dragTo([left + 0.002, 0.25], [left + 0.05 + 0.002, 0.25]);
  l = await L();
  ok('dragging an edge crops that side', near(l.crop.l, 0.1, 0.015) && near(l.scale, 0.5), JSON.stringify(l.crop));
  // ปุ่มลูกศร
  const x0 = l.x;
  await p.focus('.layout-preview'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Shift+ArrowDown');
  l = await L();
  ok('arrow keys nudge (Shift = bigger step)', near(l.x, x0 + 0.005, 0.0005) && near(l.y, 0.3, 0.0005), JSON.stringify({ x: l.x, y: l.y }));
  await p.screenshot({ path: S + '/layoutdrag.png' });
  // ดับเบิลคลิก = เต็มจอ (ครอปยังอยู่)
  await p.mouse.dblclick(...at(0.5, 0.3));
  l = await L();
  ok('double-click makes it full frame', l.scale === 1 && l.x === 0.5 && l.y === 0.5);
  await p.mouse.move(...at(0.9, 0.9));
  ok('cursor shows what a drag will do', await p.evaluate(() => getComputedStyle(document.querySelector('.layout-preview')).cursor) === 'move');
  await dragTo([0.995, 0.995], [0.4, 0.4]);
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  l = await L();
  ok('layout kept after Done', l && l.scale < 0.7 && l.crop.l > 0.05, JSON.stringify(l));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
