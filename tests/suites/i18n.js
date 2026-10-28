// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ภาษา English: เปิดหน้าจอหลักและหน้าต่างที่ใช้บ่อย แล้วตรวจว่าไม่มีข้อความไทยหลงเหลือ (ยกเว้นชื่อที่ผู้ใช้ตั้งเอง)
// สลับภาษาได้ทันทีไม่โหลดหน้าใหม่ · กลับเป็นไทยได้ครบ · จำภาษาไว้ · ปุ่มในหน้าต่างยังทำงานถูกเมื่อเป็นอังกฤษ
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const MAX_SHOW = 12;

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); });
  await p.reload(); await p.waitForTimeout(800);

  // ---- สลับเป็นอังกฤษจากเมนูหลัก (ไม่โหลดหน้าใหม่) ----
  await p.evaluate(() => { window.__noReload = 1; });
  await p.evaluate(() => window.WebMix.i18n.setLang('en'));
  await p.waitForTimeout(200);
  ok('switch to English without reloading', await p.evaluate(() => window.__noReload === 1 && document.documentElement.lang === 'en'));
  ok('panel title is English', (await p.textContent('.inputs-panel .panel-title')).trim() === 'Sources', await p.textContent('.inputs-panel .panel-title'));

  const left = async (label, root) => {
    const l = await p.evaluate(sel => window.WebMix.i18n.leftovers(sel ? document.querySelector(sel) || document.body : document.body), root || null);
    ok(`no Thai left: ${label}`, l.length === 0, l.length ? `${l.length}: ${JSON.stringify(l.slice(0, MAX_SHOW))}` : '');
    return l;
  };
  const closeAll = async () => { for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(120); } await p.mouse.click(3, 3); };

  await left('main screen');
  await p.click('[data-action=add-menu]'); await p.waitForTimeout(250); await left('add source menu', '.menu'); await closeAll();
  await p.click('[data-action=add-audio]'); await p.waitForTimeout(250); await left('add audio menu', '.menu'); await closeAll();
  for (const tab of ['general', 'output', 'stream', 'netvideo', 'audio', 'control', 'system']) {
    await p.click('[data-action=settings]'); await p.waitForTimeout(300);
    await p.click(`[data-mtab=${tab}]`); await p.waitForTimeout(250);
    await left(`settings › ${tab}`, '.modal'); await closeAll();
  }
  await p.click('[data-action=help]'); await p.waitForTimeout(300); await left('manual & shortcuts', '.modal'); await closeAll();
  await p.click('[data-action=show]'); await p.waitForTimeout(300); await left('show dialog', '.modal'); await closeAll();
  await p.click('[data-action=stream]'); await p.waitForTimeout(300); await left('stream panel', '.modal, .menu, .m-sheet, .st-panel'); await closeAll();
  for (const tab of ['title', 'pip', 'key', 'chat', 'macro', 'overlay']) { await p.click(`.tab[data-tab=${tab}]`); await p.waitForTimeout(150); }
  await left('graphics tabs (all panes)', '.overlays-panel');
  await p.click('[data-tagact=new]'); await p.waitForTimeout(200); await left('new tag dialog', '.modal');
  await p.fill('.modal input[name=name]', 'Cam'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  await p.click('.src-tagbtn'); await p.waitForTimeout(200); await left('manage tags', '.modal'); await closeAll();
  const card = '#inputs-grid .card:nth-child(1)';
  await p.hover(card); await p.click(`${card} [data-card=rename]`); await p.waitForTimeout(300); await left('edit source dialog', '.modal'); await closeAll();
  await p.click(card, { button: 'right' }); await p.waitForTimeout(200); await left('card tag menu', '.tag-menu'); await closeAll();
  await p.click('[data-action=remote]'); await p.waitForTimeout(500); await left('remote / crew dialog', '.modal'); await closeAll();
  // ทุกรายการในเมนูเพิ่มแหล่งภาพ (ยกเว้นที่เปิดตัวเลือกไฟล์ของระบบ) แล้วหน้าแก้ไขของทุกการ์ดที่ได้
  const nAdd = await (async () => { await p.click('[data-action=add-menu]'); await p.waitForTimeout(200); const n = await p.$$eval('.menu .add-tile', t => t.length); await closeAll(); return n; })();
  const addLeft = new Set();
  for (let i = 0; i < nAdd; i++) {
    await p.click('[data-action=add-menu]'); await p.waitForTimeout(150);
    const t = (await p.locator('.menu .add-tile').nth(i).textContent()).trim();
    if (/screen|File|Video file|Picture|PDF|Slides|Playlist|Music/.test(t) && !/Scene/.test(t)) { await closeAll(); continue; }
    await p.locator('.menu .add-tile').nth(i).click(); await p.waitForTimeout(500);
    for (const x of await p.evaluate(() => window.WebMix.i18n.leftovers())) addLeft.add(`${t.slice(0, 20)} → ${x}`);
    await closeAll();
  }
  const nCards = await p.$$eval('#inputs-grid .card', c => c.length);
  for (let i = 0; i < nCards; i++) {
    const c = p.locator('#inputs-grid .card').nth(i);
    await c.scrollIntoViewIfNeeded(); await c.hover();
    if (await c.locator('[data-card=rename]').count()) { await c.locator('[data-card=rename]').click(); await p.waitForTimeout(350); for (const x of await p.evaluate(() => window.WebMix.i18n.leftovers())) addLeft.add(`edit #${i + 1} → ${x}`); await closeAll(); }
  }
  ok(`no Thai left: ${nAdd} add-source dialogs + ${nCards} edit dialogs`, addLeft.size === 0, JSON.stringify([...addLeft].slice(0, MAX_SHOW)));

  // ---- ปุ่มในหน้าต่างหาเจอจากป้ายต้นฉบับ (ไม่ใช่ข้อความที่แปลแล้ว) ----
  const pv = await p.evaluate(() => window.webmix.state.previewId);
  await p.locator('#inputs-grid .card').nth(2).click(); await p.waitForTimeout(200);
  ok('switching still works in English', await p.evaluate(v => window.webmix.state.previewId !== v, pv));
  await p.hover(card); await p.click(`${card} [data-card=remove]`); await p.waitForTimeout(200);
  ok('confirm dialog is English', /Remove/.test(await p.textContent('.modal')), (await p.textContent('.modal-title')));
  await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(300);
  ok('toast is English', /Removed “/.test(await p.textContent('.toast:last-child').catch(() => '')), await p.textContent('.toast:last-child').catch(() => ''));
  await left('after remove (toast)');
  await closeAll();

  // ---- จำภาษา + กลับเป็นไทย ----
  await p.reload(); await p.waitForTimeout(900);
  ok('English remembered after reload', (await p.textContent('.inputs-panel .panel-title')).trim() === 'Sources' && await p.evaluate(() => document.documentElement.lang === 'en'));
  await p.evaluate(() => window.WebMix.i18n.setLang('th')); await p.waitForTimeout(200);
  ok('back to Thai restores the original text', (await p.textContent('.inputs-panel .panel-title')).trim() === 'แหล่งภาพ' && /แตะ = Preview/.test(await p.textContent('.inputs-panel .panel-head')));
  const en = await p.evaluate(() => [...document.querySelectorAll('.tab, .opt-label, .panel-title')].map(e => e.textContent.trim()).filter(t => /^(Sources|Audio|Overlay|Effect|Duration|Lower third)$/.test(t)));
  ok('no English labels left after switching back', en.length === 0, JSON.stringify(en));
  await p.click('[data-action=settings]'); await p.waitForTimeout(250); await p.click('[data-mtab=general]');
  await p.click('[data-x-seg=lang][data-v=en]'); await p.waitForTimeout(200);
  ok('settings language switch works', await p.evaluate(() => window.WebMix.i18n.lang === 'en') && /Settings|General/.test(await p.textContent('.modal')));
  await p.click('[data-x-seg=lang][data-v=th]'); await p.waitForTimeout(200);
  ok('…and back', await p.evaluate(() => window.WebMix.i18n.lang === 'th') && /ทั่วไป/.test(await p.textContent('.modal')));

  // มือถือ: เมนู "เพิ่มเติม" มีปุ่มสลับภาษา
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await mctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const m = await mctx.newPage(); m.on('pageerror', e => errs.push('phone: ' + e.message));
  await m.goto('http://localhost:8765/index.html'); await m.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await m.reload(); await m.waitForTimeout(900);
  await m.tap('#m-tabs [data-mmore]'); await m.waitForTimeout(200);
  await m.tap('.menu button:has-text("English")'); await m.waitForTimeout(250);
  ok('phone: menu toggle switches to English', await m.evaluate(() => window.WebMix.i18n.lang === 'en') && /Switch|Audio/.test(await m.textContent('#m-tabs')), await m.textContent('#m-tabs'));
  const ml = await m.evaluate(() => window.WebMix.i18n.leftovers());
  ok('phone: no Thai left on the main screen', ml.length === 0, JSON.stringify(ml.slice(0, MAX_SHOW)));
  await mctx.close();

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
