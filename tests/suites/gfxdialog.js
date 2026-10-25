// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// หน้าต่างกราฟิกข้อมูล: แท็บ สกอร์ / นาฬิกา / ตัววิ่ง · ปุ่ม +/− เปลี่ยนคะแนนทันที · เริ่ม/หยุดนาฬิกา · ตัวอย่างตัววิ่งสด (ยกเลิก = คืนค่า) · แสดงบน Program
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("ป้ายคะแนน")'); await p.waitForSelector('.dg-modal');
  ok('three tabs', (await p.$$('.dg-modal .dg-tab')).length === 3);
  ok('live preview canvas', await p.isVisible('.dg-prev canvas'));
  await p.click('[data-sc="A+"]'); await p.click('[data-sc="A+"]'); await p.click('[data-sc="B+"]');
  const sc = () => p.evaluate(() => { const s = window.webmix.inputs.find(i => i.type === 'score').score; return [s.scoreA, s.scoreB]; });
  ok('+ changes the score right away', JSON.stringify(await sc()) === '[2,1]');
  ok('form field follows', await p.inputValue('.dg-modal [name=scoreA]') === '2');
  await p.click('.dg-modal .modal-foot .btn:has-text("แสดงบน Program")'); await p.waitForTimeout(200);
  ok('show on Program from the dialog', await p.evaluate(() => { const w = window.webmix; const id = w.inputs.find(i => i.type === 'score').id; return w.ovl.some(c => c.on && c.inputId === id); }));
  await p.click('.dg-modal .modal-foot .btn-primary'); await p.waitForTimeout(200);
  ok('score kept after save', JSON.stringify(await sc()) === '[2,1]');
  // แท็บนาฬิกา → ยังไม่มี → สร้างใหม่
  await p.evaluate(() => { const w = window.webmix; const s = w.inputs.find(i => i.type === 'score'); w.renderInputs(); });
  await p.hover('#inputs-grid .card:has-text("SCORE")'); await p.click('#inputs-grid .card:has-text("SCORE") [data-card=rename]'); await p.waitForSelector('.dg-modal');
  await p.click('.dg-modal [data-gfx-tab=timer]'); await p.waitForTimeout(500);
  ok('timer tab creates a timer and opens its dialog', await p.evaluate(() => window.webmix.inputs.some(i => i.type === 'timer')) && await p.isVisible('.dg-modal [data-clock]'));
  await p.click('.dg-modal [data-t=toggle]'); await p.waitForTimeout(1300);
  ok('start runs the clock', await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'timer').timer.running));
  await p.click('.dg-modal [data-t=toggle]');
  await p.click('.dg-modal .modal-foot .btn-primary'); await p.waitForTimeout(200);
  // ตัววิ่ง: แก้แล้วกดยกเลิก = คืนค่า
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("ตัววิ่งข่าว")'); await p.waitForSelector('.dg-modal');
  await p.click('.dg-modal .modal-foot .btn-primary'); await p.waitForTimeout(200);
  await p.hover('#inputs-grid .card:has-text("TICKER")'); await p.click('#inputs-grid .card:has-text("TICKER") [data-card=rename]'); await p.waitForSelector('.dg-modal');
  await p.fill('.dg-modal [name=items]', 'ทดลองพิมพ์');
  ok('ticker edit previews live', await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'ticker').ticker.items[0] === 'ทดลองพิมพ์'));
  await p.click('.dg-modal .modal-foot .btn:has-text("ยกเลิก")');
  ok('cancel restores the ticker text', await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'ticker').ticker.items[0] !== 'ทดลองพิมพ์'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
