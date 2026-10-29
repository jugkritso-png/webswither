// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ค้นหาแหล่งภาพ · ป้ายกลุ่ม (ชื่อ + สี) แบบ vMix · กรองตามป้าย · ลากการ์ดไปวางบนป้าย = ติดป้าย
// ลากการ์ดเพื่อเรียงลำดับ (เมาส์ + จอสัมผัสกดค้าง) · บันทึกในโชว์ เปิดใหม่แล้วยังอยู่
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1400 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const names = () => p.evaluate(() => window.webmix.inputs.map(i => i.name));
  const visible = () => p.$$eval('#inputs-grid .card', cs => cs.filter(c => !c.hidden).map(c => c.querySelector('.card-name').textContent));
  const start = await names();
  ok('starts with four sources', start.length === 4, start.join(','));
  ok('search + tag button in the panel header', await p.isVisible('.panel-head .src-search') && await p.isVisible('.panel-head .src-tagbtn[data-tagact=new]'));
  ok('no tag row until a tag exists (cards keep their space)', await p.isHidden('#src-chips'));

  // ---- ค้นหา (แผงแคบ: ไอคอนค้นหาขยายเมื่อแตะ) ----
  await p.click('.src-search');
  await p.fill('#src-search', 'clock');
  ok('search filters cards', JSON.stringify(await visible()) === '["CLOCK"]', JSON.stringify(await visible()));
  ok('count shows matches/total', (await p.textContent('#input-count')) === '1/4', await p.textContent('#input-count'));
  await p.press('#src-search', 'Enter');
  const pv = await p.evaluate(() => window.webmix.inputs.find(i => i.id === window.webmix.state.previewId)?.name);
  ok('Enter puts the first match in Preview', pv === 'CLOCK', pv);
  await p.fill('#src-search', 'zzz');
  ok('no-match message', await p.isVisible('.src-none'));
  await p.click('[data-srcclear]');
  ok('clear filter shows all again', (await visible()).length === 4 && (await p.inputValue('#src-search')) === '');
  await p.click('body', { position: { x: 5, y: 5 } }); await p.keyboard.press('/');
  ok('"/" focuses search', await p.evaluate(() => document.activeElement?.id === 'src-search'));
  await p.keyboard.press('Escape');
  await p.click('body', { position: { x: 5, y: 5 } }); await p.keyboard.press('Control+f');
  ok('Ctrl+F focuses search', await p.evaluate(() => document.activeElement?.id === 'src-search'));
  await p.keyboard.press('Escape');

  // ---- สร้างป้าย + ลากการ์ดไปวางบนป้าย ----
  await p.click('[data-tagact=new]');
  await p.fill('.modal input[name=name]', 'กล้อง'); await p.click('.modal-foot .btn-primary');
  await p.waitForTimeout(200);
  const tag1 = await p.evaluate(() => window.webmix.show.serialize().tags);
  ok('tag row appears with All + the new tag', await p.isVisible('#src-chips') && /ทั้งหมด\s*4/.test(await p.textContent('.src-chip[data-tag=""]')));
  ok('tag created with a color', tag1.length === 1 && tag1[0].name === 'กล้อง' && /^#[0-9a-f]{6}$/.test(tag1[0].color), JSON.stringify(tag1));
  const dragTo = async (fromSel, toSel, opt = {}) => {
    await (await p.$(toSel)).scrollIntoViewIfNeeded(); await (await p.$(fromSel)).scrollIntoViewIfNeeded();
    const a = await (await p.$(fromSel)).boundingBox(), z = await (await p.$(toSel)).boundingBox();
    await p.mouse.move(a.x + a.width * 0.3, a.y + a.height * 0.7); await p.mouse.down();
    const tx = opt.x ? opt.x(z) : z.x + z.width / 2, ty = z.y + z.height / 2;
    await p.mouse.move(tx, ty, { steps: 12 }); await p.waitForTimeout(80); await p.mouse.up(); await p.waitForTimeout(250);
  };
  const cardOf = n => `#inputs-grid .card:has(.card-name:text-is("${n}"))`;
  await dragTo(`${cardOf('COLOR BARS')} .card-thumb`, `.src-chip[data-tag="${tag1[0].id}"]`);
  const barsTags = await p.evaluate(() => window.webmix.inputs.find(i => i.name === 'COLOR BARS').tags);
  ok('drop card on a tag chip adds the tag', JSON.stringify(barsTags) === JSON.stringify([tag1[0].id]), JSON.stringify(barsTags));
  ok('tagged card shows its color', await p.$eval(cardOf('COLOR BARS'), c => c.classList.contains('has-tag') && !!c.querySelector('.card-tags i')));
  ok('drop on chip does not reorder', JSON.stringify(await names()) === JSON.stringify(start));

  // ---- เมนูป้ายบนการ์ด ----
  await p.hover(cardOf('SLATE')); await p.click(`${cardOf('SLATE')} [data-card=tags]`);
  await p.click(`.tag-menu [data-tg="${tag1[0].id}"]`);
  ok('card tag menu toggles a tag (menu stays open)', await p.isVisible('.tag-menu') && (await p.evaluate(() => window.webmix.inputs.find(i => i.name === 'SLATE').tags || [])).length === 1);
  await p.keyboard.press('Escape'); await p.click('body', { position: { x: 5, y: 5 } });

  // ---- กรองตามป้าย ----
  await p.click(`.src-chip[data-tag="${tag1[0].id}"]`);
  ok('tag chip filters to that group', JSON.stringify((await visible()).sort()) === '["COLOR BARS","SLATE"]', JSON.stringify(await visible()));
  ok('chip shows its count', /2/.test(await p.textContent(`.src-chip[data-tag="${tag1[0].id}"] small`)));
  await p.click(`.src-chip[data-tag="${tag1[0].id}"]`);
  ok('click again = all', (await visible()).length === 4);

  // ---- จัดการป้าย: ชื่อ + สี ----
  await p.click('.src-tagbtn[data-tagact=manage]');
  await p.fill('.tag-row .tag-name', 'กล้องหลัก');
  await p.click('.tag-row [data-color="#a855f7"]');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  const t2 = await p.evaluate(() => window.webmix.show.serialize().tags[0]);
  ok('rename + recolor a tag', t2.name === 'กล้องหลัก' && t2.color === '#a855f7', JSON.stringify(t2));
  ok('chip uses the new name and color', /กล้องหลัก/.test(await p.textContent(`.src-chip[data-tag="${t2.id}"]`))
    && await p.$eval(`.src-chip[data-tag="${t2.id}"]`, c => c.style.getPropertyValue('--tag') === '#a855f7'));

  // ---- ลากเรียงลำดับ (เมาส์) ----
  const pvBefore = await p.evaluate(() => window.webmix.state.previewId);
  const last = start[3];
  await dragTo(`${cardOf(last)} .card-thumb`, `#inputs-grid .card:nth-child(1)`, { x: z => z.x + 10 });
  const n1 = await names();
  ok('drag reorders (last card to first)', n1[0] === last && n1.length === 4, n1.join(','));
  ok('number on cards follows the new order', (await p.textContent('#inputs-grid .card:nth-child(1) .card-num')) === '1' && (await p.textContent('#inputs-grid .card:nth-child(1) .card-name')) === last);
  ok('dropping does not change Preview (no click)', await p.evaluate(() => window.webmix.state.previewId) === pvBefore);
  await dragTo(`${cardOf(n1[0])} .card-thumb`, `#inputs-grid .card:nth-child(3)`, { x: z => z.x + z.width - 10 });
  const n2 = await names();
  ok('drag after a card', JSON.stringify(n2) === JSON.stringify([n1[1], n1[2], n1[0], n1[3]]), n2.join(','));
  await p.keyboard.press('Digit1');
  ok('shortcut 1 follows the new order', await p.evaluate(n => window.webmix.inputs.find(i => i.id === window.webmix.state.previewId)?.name === n, n2[0]) || n2[0] === await p.evaluate(() => window.webmix.inputs.find(i => i.id === window.webmix.state.programId)?.name));

  // ---- บันทึกในโชว์ ----
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(1200);
  ok('order kept after reload', JSON.stringify(await names()) === JSON.stringify(n2), (await names()).join(','));
  const after = await p.evaluate(() => ({ tags: window.webmix.show.serialize().tags, bars: window.webmix.inputs.find(i => i.name === 'COLOR BARS').tags }));
  ok('tags kept after reload', after.tags.length === 1 && after.tags[0].name === 'กล้องหลัก' && after.bars?.[0] === after.tags[0].id, JSON.stringify(after));

  // ---- ลบป้าย: แหล่งภาพยังอยู่ ----
  await p.click('.src-tagbtn[data-tagact=manage]'); await p.click('.tag-row [data-del]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  const del = await p.evaluate(() => ({ tags: window.webmix.show.serialize().tags.length, any: window.webmix.inputs.some(i => (i.tags || []).length), n: window.webmix.inputs.length }));
  ok('delete tag removes it from sources, keeps sources', del.tags === 0 && !del.any && del.n === 4, JSON.stringify(del));

  // ---- จอสัมผัส: กดค้างแล้วลาก = เรียงลำดับ · ปัดเร็ว ๆ = ไม่ลาก ----
  const tctx = await b.newContext({ viewport: { width: 900, height: 1200 }, hasTouch: true, isMobile: true });
  await tctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const t = await tctx.newPage(); t.on('pageerror', e => errs.push('touch: ' + e.message));
  await t.goto('http://localhost:8765/index.html'); await t.evaluate(() => localStorage.clear()); await t.reload(); await t.waitForTimeout(1000);
  const cdp = await tctx.newCDPSession(t);
  const touch = async (from, to, holdMs) => {
    await t.$eval('#inputs-grid', g => g.scrollIntoView({ block: 'center' }));
    const a = await (await t.$(from)).boundingBox(), z = await (await t.$(to)).boundingBox();
    const p0 = { x: a.x + a.width * 0.3, y: a.y + a.height * 0.7 }, p1 = { x: z.x + 8, y: z.y + z.height / 3 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p0] });
    await t.waitForTimeout(holdMs);
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + (p1.x - p0.x) * i / 10, y: p0.y + (p1.y - p0.y) * i / 10 }] }); await t.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await t.waitForTimeout(300);
  };
  const tn = () => t.evaluate(() => window.webmix.inputs.map(i => i.name));
  const t0 = await tn();
  await touch('#inputs-grid .card:nth-child(4) .card-thumb', '#inputs-grid .card:nth-child(1)', 50);
  ok('touch: quick swipe does not reorder', JSON.stringify(await tn()) === JSON.stringify(t0), (await tn()).join(','));
  await touch('#inputs-grid .card:nth-child(4) .card-thumb', '#inputs-grid .card:nth-child(1)', 600);
  const t1 = await tn();
  ok('touch: long-press then drag reorders', t1[0] === t0[3], t1.join(','));
  ok('touch: tag button is on the card foot', await t.isVisible('#inputs-grid .card:nth-child(1) .foot-actions [data-card=tags]'));
  await tctx.close();
  // มือถือแนวตั้ง: ไม่มีปุ่มป้ายในหัวแผง → แถวป้ายขึ้นเสมอพร้อมปุ่ม + ป้าย · แตะจุดสีบนการ์ด = เมนูป้าย
  const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await pctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const ph = await pctx.newPage(); ph.on('pageerror', e => errs.push('phone: ' + e.message));
  await ph.goto('http://localhost:8765/index.html'); await ph.evaluate(() => localStorage.clear()); await ph.reload(); await ph.waitForTimeout(1000);
  ok('phone: tag row shows "+ ป้าย" even before any tag', await ph.isVisible('#src-chips [data-tagact=new]') && await ph.isHidden('.panel-head .src-tagbtn'));
  ok('phone: page still fits the screen width', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ph.evaluate(() => { const w = window.webmix; const d = w.show.serialize(); d.tags = [{ id: 'x1', name: 'กล้อง', color: '#3b82f6' }]; d.inputs[0].tags = ['x1']; localStorage.setItem('webmix:show', JSON.stringify(d)); });
  await ph.reload(); await ph.waitForTimeout(1000);
  await ph.tap('#inputs-grid .card:nth-child(1) .card-tags'); await ph.waitForTimeout(200);
  await ph.tap('.tag-menu [data-tg="x1"]');
  ok('phone: tap tag dots → menu removes the tag', (await ph.evaluate(() => window.webmix.inputs[0].tags || [])).length === 0);
  await ph.keyboard.press('Escape'); await ph.waitForTimeout(150);
  // ปุ่มขนาดการ์ด/จัดการป้ายที่ไม่มีที่บนหัวแผง อยู่ในเมนู "เพิ่มเติม"
  const size0 = await ph.evaluate(() => document.documentElement.dataset.cards || 'm');
  await ph.tap('#m-tabs [data-mmore]'); await ph.waitForTimeout(200);
  await ph.tap('.menu button:has-text("ขนาดการ์ดแหล่งภาพ")'); await ph.waitForTimeout(300);
  ok('phone: More menu changes the card size', await ph.evaluate(s0 => (document.documentElement.dataset.cards || 'm') !== s0, size0));
  await ph.tap('#m-tabs [data-mmore]'); await ph.waitForTimeout(200);
  await ph.tap('.menu button:has-text("จัดการป้ายกลุ่มแหล่งภาพ")'); await ph.waitForTimeout(300);
  ok('phone: More menu opens the tag manager', await ph.isVisible('.modal') && (await ph.inputValue('.modal .tag-name').catch(() => '')) === 'กล้อง');
  await pctx.close();

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
