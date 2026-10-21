// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// สไลด์ PDF: เปิดไฟล์ → เปลี่ยนหน้าด้วยปุ่มบนการ์ด / ลูกศร / Page Up-Down (รีโมตพรีเซนต์) · ภาพถูกทั้ง CPU/GPU · จำไฟล์และหน้า · ไฟล์เสียแจ้งเตือน
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("สไลด์ PDF")'); await (await fc).setFiles(`${S}/slides.pdf`);
  await p.waitForFunction(() => window.webmix.inputs.some(i => i.type === 'slides' && i.status === 'live'), null, { timeout: 15000 }).catch(() => {});
  const sl = () => p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'slides'); return i && { id: i.id, status: i.status, page: i.slides.page, count: i.slides.count, file: i.fileName }; });
  let s = await sl();
  ok('PDF opens as a 3-page slides source', s && s.status === 'live' && s.count === 3 && s.page === 1, JSON.stringify(s));
  ok('card shows page 1/3', /หน้า 1\/3/.test(await p.textContent(`.card[data-id="${s.id}"] .card-sub`)));
  await p.evaluate(id => { window.webmix.state.programId = id; }, s.id);
  const px = () => p.evaluate(() => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = 1; g.height = 1; g.getContext('2d').drawImage(c, c.width / 2, c.height / 2, 1, 1, 0, 0, 1, 1); return Array.from(g.getContext('2d').getImageData(0, 0, 1, 1).data.slice(0, 3)); });
  const col = c => c[0] > 200 && c[1] < 60 && c[2] < 60 ? 'red' : c[1] > 200 && c[0] < 60 && c[2] < 60 ? 'green' : c[2] > 200 && c[0] < 60 && c[1] < 60 ? 'blue' : JSON.stringify(c);
  const until = async want => { let v; for (let i = 0; i < 20; i++) { v = col(await px()); if (v === want) return v; await p.waitForTimeout(150); } return v; };
  ok('page 1 on Program (red)', await until('red') === 'red');
  await p.keyboard.press('ArrowRight');
  ok('→ goes to page 2 (green)', await until('green') === 'green' && (await sl()).page === 2);
  await p.keyboard.press('PageDown');
  ok('Page Down (presenter remote) goes to page 3 (blue)', await until('blue') === 'blue');
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200);
  ok('stays on the last page', (await sl()).page === 3);
  await p.keyboard.press('PageUp');
  ok('Page Up goes back (green)', await until('green') === 'green');
  const card = p.locator(`.card[data-id="${s.id}"]`); await card.hover(); await card.locator('[data-card=slprev]').click();
  ok('card ‹ button goes back to page 1', await until('red') === 'red' && /หน้า 1\/3/.test(await p.textContent(`.card[data-id="${s.id}"] .card-sub`)));
  await p.evaluate(() => window.webmix.setRenderer('gpu'));
  await card.hover(); await card.locator('[data-card=slnext]').click();
  ok('GPU renderer shows the slide too (green)', await until('green') === 'green');
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  // แก้ไข: ไปที่หน้า 3
  await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('.modal input[name=page]');
  await p.fill('.modal input[name=page]', '3'); await p.click('.modal-foot .btn-primary');
  ok('edit dialog jumps to a page', await until('blue') === 'blue');
  ok('MIDI can be mapped to next/previous slide', await p.evaluate(() => true) && await (async () => { await p.click('[data-action=settings]'); await p.click('[data-mtab=control]'); const n = await p.locator('.midi-row[data-midi=slnext], .midi-row[data-midi=slprev]').count(); await p.keyboard.press('Escape'); return n === 2; })());
  // เปิดหน้าใหม่: ไฟล์และหน้าเดิมกลับมา
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(800);
  await p.waitForFunction(() => window.webmix.inputs.some(i => i.type === 'slides' && i.status === 'live'), null, { timeout: 15000 }).catch(() => {});
  s = await sl();
  ok('slides and current page survive a reload', s && s.status === 'live' && s.page === 3 && s.count === 3, JSON.stringify(s));
  // ไฟล์ที่ไม่ใช่ PDF
  const n0 = await p.evaluate(() => window.webmix.inputs.length);
  const fc2 = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("สไลด์ PDF")'); await (await fc2).setFiles(`${S}/logo.png`);
  await p.waitForTimeout(1500);
  ok('a broken file is refused with a message', await p.evaluate(() => window.webmix.inputs.length) === n0 && /เปิด .* ไม่ได้/.test(await p.textContent('#toasts')));
  await p.screenshot({ path: S + '/slides.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
