// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// คลังโชว์ (design 31): บันทึกลงคลัง, บันทึกเป็นชื่อใหม่, เปิดโชว์จากคลัง, ส่งออก, ลบ, ไฟล์สื่อของโชว์ในคลังไม่ถูกลบตอนเปิดหน้า
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const addImage = async () => { const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(S + '/logo.png'); await p.waitForTimeout(600); };
  const openShow = async () => { await p.click('[data-action=show]'); await p.waitForSelector('.modal.sh-modal .sh-grid'); };

  await addImage();
  const saved = await p.evaluate(() => window.webmix.inputs.map(i => i.id)); const imgId = saved[saved.length - 1];
  await openShow();
  ok('empty library shows a hint', /ยังไม่มีโชว์ในคลัง/.test(await p.textContent('.sh-grid')));
  await p.fill('.modal [name=showname]', 'รายการ A');
  await p.click('.modal [data-show=lib-save]');
  await p.waitForSelector('.sh-card');
  ok('save adds a card with a thumbnail', await p.evaluate(() => { const i = document.querySelector('.sh-card img'); return !!i && i.src.startsWith('data:image/jpeg'); }));
  ok('card is marked selected', (await p.$$('.sh-card.is-sel')).length === 1);
  await p.click('.modal [data-show=lib-save]');
  ok('saving again updates the same entry', (await p.$$('.sh-card')).length === 1);
  await p.click('.modal [data-show=lib-saveas]');
  ok('save as adds a copy', (await p.$$('.sh-card')).length === 2 && /สำเนา/.test(await p.textContent('.sh-grid')));
  ok('saved data excludes stream keys', await p.evaluate(() => !JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('webmix:lib:')).map(k => localStorage[k])).includes('"key":"x')));

  // ส่งออกจากคลัง
  await p.click('.sh-card:has-text("รายการ A"):not(:has-text("สำเนา"))');
  ok('selection bar shows the name', (await p.textContent('.sh-sel-name')) === 'รายการ A');
  const dl = p.waitForEvent('download'); await p.click('.modal [data-show=lib-export]'); const d = await dl;
  ok('export downloads a .webmix.json', /รายการ A\.webmix\.json$/.test(d.suggestedFilename()), d.suggestedFilename());
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);

  // เปลี่ยนโชว์ปัจจุบัน แล้วเปิดโชว์จากคลัง
  await addImage();
  ok('current show gained an input', await p.evaluate(n => window.webmix.inputs.length === n + 1, saved.length));
  await openShow();
  await p.click('.sh-card:has-text("รายการ A"):not(:has-text("สำเนา"))');
  await p.click('.modal [data-show=lib-open]');
  await p.waitForFunction(() => document.querySelectorAll('.modal-backdrop').length === 2);
  await Promise.all([p.waitForNavigation(), p.locator('.modal-backdrop').last().locator('.modal-foot .btn').last().click()]);
  await p.waitForTimeout(1200);
  const after = await p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); return { ids: window.webmix.inputs.map(x => x.id), ready: !!i?.el?.naturalWidth }; }, imgId);
  ok('opening restores the saved show', JSON.stringify(after.ids) === JSON.stringify(saved), JSON.stringify(after.ids));
  ok('media of the saved show survived the reload', after.ready);
  await openShow();
  ok('opened show is badged', /เปิดอยู่/.test(await p.textContent('.sh-card:has-text("รายการ A"):not(:has-text("สำเนา")) .sh-thumb')));

  // ลบ
  await p.click('.sh-card:has-text("สำเนา")');
  await p.click('.modal [data-show=lib-del]');
  await p.waitForFunction(() => document.querySelectorAll('.modal-backdrop').length === 2);
  await p.locator('.modal-backdrop').last().locator('.modal-foot .btn').last().click(); await p.waitForTimeout(300);
  ok('delete removes the entry and its data', (await p.$$('.sh-card')).length === 1 && await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('webmix:lib:')).length === 1));

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
