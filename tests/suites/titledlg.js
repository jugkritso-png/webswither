// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แก้ป้ายชื่อ (แบบใหม่): ตัวอย่างสด · สไตล์ 9 แบบ · สี · ขนาด/ตำแหน่ง · แสดงบน Program จากหน้าต่าง · ซ่อนเอง · บันทึกพรีเซ็ต · บันทึกกับโชว์
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("Title กราฟิก")'); await p.waitForSelector('.tt-modal');
  ok('nine style tiles', (await p.$$('.tt-modal [name=style]')).length === 9);
  ok('colour swatches', (await p.$$('.tt-modal [name=color]')).length >= 6);
  const px = () => p.evaluate(() => { const c = document.querySelector('.tt-prev canvas'); const d = c.getContext('2d').getImageData(40, 380, 400, 120).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90) n++; return n; });
  await p.fill('.tt-modal [name=headline]', 'สมชาย ใจดี'); await p.fill('.tt-modal [name=subtitle]', 'พิธีกร'); await p.waitForTimeout(300);
  ok('live preview draws the red name bar', await px() > 500);
  await p.check('.tt-modal [name=color][value="#3b82f6"]'); await p.waitForTimeout(300);
  ok('colour change updates the preview', await px() < 100);
  await p.check('.tt-modal [name=style][value=pill]');
  await p.selectOption('.tt-modal [name=size]', '1.2'); await p.selectOption('.tt-modal [name=pos]', 'right'); await p.selectOption('.tt-modal [name=autoHide]', '5');
  await p.check('.tt-modal [name=anim]');
  // แสดงบน Program โดยไม่ปิดหน้าต่าง
  await p.click('.tt-modal .modal-foot .btn:has-text("แสดงบน Program")'); await p.waitForTimeout(300);
  const id = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'title').id);
  ok('“show on Program” puts it on an overlay', await p.evaluate(id => window.webmix.overlays ? true : true, id) && await p.evaluate(id => window.webmix.ovl.some(c => c.on && c.inputId === id), id));
  ok('button flips to “hide”', await p.isVisible('.tt-modal .modal-foot .btn:has-text("ซ่อนจาก Program")'));
  await p.click('.tt-modal .modal-foot .btn:has-text("บันทึกเป็นพรีเซ็ต")');
  ok('saved as a preset', await p.evaluate(() => window.webmix.settings.titlePresets.some(t => t.headline === 'สมชาย ใจดี')));
  await p.click('.tt-modal .modal-foot .btn-primary'); await p.waitForTimeout(200);
  const t = await p.evaluate(id => window.webmix.inputs.find(i => i.id === id).title, id);
  ok('style / size / position / auto-hide / animation saved', t.style === 'pill' && t.size === 1.2 && t.pos === 'right' && t.autoHide === 5 && t.anim && t.color === '#3b82f6', JSON.stringify(t));
  ok('animation started when shown', await p.evaluate(id => !!window.webmix.inputs.find(i => i.id === id).shownAt, id));
  await p.waitForTimeout(5600);
  ok('auto-hides after 5 seconds', await p.evaluate(id => !window.webmix.ovl.some(c => c.on && c.inputId === id), id));
  // Program มีป้ายแบบกล่องมนด้านขวาเมื่อเปิดอีกครั้ง
  await p.evaluate(id => { const w = window.webmix; const i = w.ovl.findIndex(c => c.inputId === id); w.setChannel(i, true); }, id);
  await p.waitForTimeout(800);
  const right = await p.evaluate(() => { const c = document.querySelector('#pgm-canvas'); const x = c.getContext('2d') || null; if (!x) return -1; const d = x.getImageData(c.width * 0.55, c.height * 0.78, c.width * 0.4, c.height * 0.15).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; return n; });
  ok('pill title drawn on the right of Program', right > 50, String(right));
  ok('saved with the show', await p.evaluate(() => { const s = window.webmix.show.serialize(); const t = s.inputs.find(i => i.type === 'title').title; return t.style === 'pill' && t.autoHide === 5 && t.pos === 'right'; }));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
