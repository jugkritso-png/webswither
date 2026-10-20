// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
// ใช้งานง่าย (รอบ 2): หน้าเพิ่มแหล่งภาพแบบการ์ด · เลิกทำการลบ · ตั้งค่าพื้นฐาน/ขั้นสูง · ภาษาไทยสม่ำเสมอ · เสียง/กราฟิกบนมือถือ
const { chromium, devices } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
async function setup(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await setup(ctx);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1000);
  const names = () => p.evaluate(() => window.webmix.inputs.map(i => i.name));

  // ภาษาไทยสม่ำเสมอ
  const titles = await p.evaluate(() => [...document.querySelectorAll('.panel-title, .tabs .tab')].map(e => e.firstChild.textContent.trim()));
  ok('panel titles and tabs are Thai', ['แหล่งภาพ', 'เสียง', 'เปลี่ยนภาพ', 'ซ้อนภาพ', 'ป้ายชื่อ'].every(t => titles.includes(t)) && !titles.some(t => /^(INPUTS|AUDIO|TRANSITION|OVERLAY)$/.test(t)), JSON.stringify(titles));
  ok('add button says เพิ่มแหล่งภาพ', /เพิ่มแหล่งภาพ/.test(await p.textContent('[data-action=add-menu]')));

  // เพิ่มแหล่งภาพ: การ์ดไอคอน + คำอธิบาย เป็นหมวด
  await p.click('[data-action=add-menu]'); await p.waitForSelector('.add-sheet');
  const sheet = await p.evaluate(() => ({ tiles: document.querySelectorAll('.add-sheet .add-tile').length, groups: document.querySelectorAll('.add-sheet .menu-label').length,
    desc: [...document.querySelectorAll('.add-sheet .add-tile small')].every(s => s.textContent.trim().length > 3), fits: (() => { const r = document.querySelector('.add-sheet').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })() }));
  ok('add sheet: 16 tiles in 5 groups, each with a description, on screen', sheet.tiles === 16 && sheet.groups === 5 && sheet.desc && sheet.fits, JSON.stringify(sheet));
  await p.screenshot({ path: S + '/ez-add.png' });
  const n0 = (await names()).length;
  await p.click('.menu button:has-text("Color Bars")'); await p.waitForTimeout(300);
  ok('tile adds the source', (await names()).length === n0 + 1);

  // เลิกทำการลบแหล่งภาพ: กลับมาที่ตำแหน่งเดิม ชื่อ/ID เดิม
  const before = await p.evaluate(() => window.webmix.inputs.map(i => i.id));
  const idx = 1; const victim = before[idx];
  const card = p.locator('.card').nth(idx); await card.hover(); await card.locator('[data-card=remove]').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(300);
  ok('delete removes the source', !(await p.evaluate(id => !!window.webmix.inputs.find(i => i.id === id), victim)));
  ok('toast offers เลิกทำ', await p.isVisible('.toast .toast-action'));
  await p.click('.toast .toast-action'); await p.waitForTimeout(500);
  const after = await p.evaluate(() => window.webmix.inputs.map(i => i.id));
  ok('undo puts it back in the same place', JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }));

  // ภาพนิ่ง: ลบแล้วเลิกทำ ไฟล์ยังอยู่
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(`${S}/logo.png`);
  await p.waitForTimeout(800);
  const img = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'image').id);
  const ic = p.locator(`.card[data-id="${img}"]`);
  if (await ic.count()) { await ic.hover(); await ic.locator('[data-card=remove]').click(); }
  else { const all = await p.evaluate(() => window.webmix.inputs.length); const c2 = p.locator('.card').nth(all - 1); await c2.hover(); await c2.locator('[data-card=remove]').click(); }
  await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(300);
  await p.click('.toast .toast-action'); await p.waitForTimeout(1500);
  ok('undo restores an image with its file', await p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); return !!i && !i.missing && i.el && i.el.naturalWidth > 0; }, img));

  // ตั้งค่า → การสตรีม: Gateway อยู่ใน "ขั้นสูง" (เปิดให้เองถ้ายังไม่ได้ตั้ง) · ลบปลายทางแล้วเลิกทำได้
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]');
  ok('gateway section opens itself while not set up', await p.evaluate(() => document.querySelector('[data-mpane=stream] details.adv').open));
  await p.fill('.modal input[name=gateway]', 'ws://127.0.0.1:8089/?token=abc');
  await p.click('.dest-add');
  const rows0 = await p.locator('.dest-row').count();
  await p.click('.dest-row >> nth=1 >> .dest-remove');
  ok('removed destination leaves an undo bar', (await p.locator('.dest-row').count()) === rows0 - 1 && await p.isVisible('.dest-removed .dest-undo'));
  await p.click('.dest-removed .dest-undo');
  ok('undo brings the destination row back', (await p.locator('.dest-row').count()) === rows0 && (await p.locator('.dest-removed').count()) === 0);
  await p.click('.dest-row >> nth=1 >> .dest-remove');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  ok('saving drops the removed destination', await p.evaluate(n => window.webmix.settings.destinations.length === n, rows0 - 1));
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]');
  ok('gateway tucked away once set', !(await p.evaluate(() => document.querySelector('[data-mpane=stream] details.adv').open)) && !(await p.isVisible('.modal input[name=gateway]')));
  await p.keyboard.press('Escape');

  // มือถือ
  const mctx = await b.newContext({ ...devices['iPhone 13'] }); await setup(mctx);
  const m = await mctx.newPage(); m.on('pageerror', e => errs.push('mobile ' + e.message));
  await m.goto('http://localhost:8765/index.html'); await m.waitForTimeout(1000);
  await m.tap('[data-action=add-menu]'); await m.waitForTimeout(250);
  ok('phone: add sheet is a bottom sheet with one tile per row', await m.evaluate(() => { const r = document.querySelector('.add-sheet').getBoundingClientRect(); const t = [...document.querySelectorAll('.add-tile')].slice(0, 2).map(x => x.getBoundingClientRect()); return Math.abs(r.bottom - innerHeight) < 2 && t[1].top > t[0].bottom - 1 && t[0].height >= 56; }));
  await m.screenshot({ path: S + '/ez-add-phone.png' });
  await m.tap('.add-tile:has-text("Slate")'); await m.waitForTimeout(200);

  // เสียงบนมือถือ: แถวแนวนอน แถบเลื่อนยาว ปุ่มปิดเสียงใหญ่
  await m.tap('#m-tabs [data-mview=audio]'); await m.waitForTimeout(250);
  const hs = await m.evaluate(() => { const s = document.querySelector('.hstrip.master'); const r = s && s.getBoundingClientRect(); const range = s && s.querySelector('.hs-range').getBoundingClientRect(); const mute = s && s.querySelector('.hs-mute').getBoundingClientRect();
    return s ? { w: Math.round(r.width), iw: innerWidth, range: Math.round(range.width), muteH: Math.round(mute.height), vfader: !!document.querySelector('#mixer .vfader') } : null; });
  ok('phone audio: full-width rows, long slider, big mute, no vertical faders', hs && hs.w > hs.iw * 0.85 && hs.range > hs.iw * 0.5 && hs.muteH >= 44 && !hs.vfader, JSON.stringify(hs));
  await m.evaluate(() => { const r = document.querySelector('.hstrip.master .hs-range'); r.value = 50; r.dispatchEvent(new Event('input')); });
  const db = await m.evaluate(() => window.webmix.audio.masterStrip.db);
  ok('phone audio: slider sets the level', db < -3 && db > -40, String(db));
  await m.tap('.hstrip.master .hs-mute');
  ok('phone audio: mute toggles', await m.evaluate(() => window.webmix.audio.masterStrip.muted));
  await m.tap('.hstrip.master .hs-mute');
  await m.screenshot({ path: S + '/ez-audio-phone.png' });

  // กราฟิกบนมือถือ: การ์ดแตะครั้งเดียว
  await m.tap('#m-tabs [data-mview=graphics]'); await m.waitForTimeout(250);
  ok('phone graphics: quick cards shown', await m.isVisible('#m-gfx') && (await m.locator('#m-gfx .gfx-add').count()) === 4);
  await m.tap('#m-gfx [data-gfx-add=title]'); await m.waitForSelector('.modal-foot .btn-primary'); await m.tap('.modal-foot .btn-primary'); await m.waitForTimeout(400);
  const gid = await m.evaluate(() => window.webmix.inputs.find(i => i.type === 'title').id);
  ok('phone graphics: new title appears as a card', (await m.locator(`#m-gfx [data-gfx="${gid}"]`).count()) === 1);
  await m.tap(`#m-gfx [data-gfx="${gid}"]`); await m.waitForTimeout(300);
  ok('phone graphics: one tap puts it on air', await m.evaluate(id => window.webmix.ovl.some(c => c.on && c.inputId === id), gid) && await m.locator(`#m-gfx [data-gfx="${gid}"].is-on`).count() === 1);
  await m.screenshot({ path: S + '/ez-gfx-phone.png' });
  await m.tap(`#m-gfx [data-gfx="${gid}"]`); await m.waitForTimeout(300);
  ok('phone graphics: tap again takes it off', await m.evaluate(id => !window.webmix.ovl.some(c => c.on && c.inputId === id), gid));

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
