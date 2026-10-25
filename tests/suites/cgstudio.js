// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// CG Studio: เปิดจากสตูดิโอ · หน้าตาชุดเดียวกับแอป · Preview / Take / Clear พร้อมป้ายสถานะ ON AIR / PREVIEW
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const popup = ctx.waitForEvent('page');
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("CG Studio"), .add-big button:has-text("CG Studio")');
  const cg = await popup; cg.on('pageerror', e => errs.push('cg ' + e.message));
  await cg.waitForLoadState(); await cg.waitForTimeout(800);
  ok('studio opens CG Studio connected', await until(() => cg.evaluate(() => document.querySelector('.connection').classList.contains('is-connected'))));
  ok('brand matches the app (WebMix + CG STUDIO tag)', (await cg.textContent('.brand-name')).includes('WebMix') && (await cg.textContent('.brand-tag')) === 'CG STUDIO');
  ok('design-system font and colours', await cg.evaluate(() => getComputedStyle(document.body).fontFamily.includes('IBM Plex Sans Thai') && getComputedStyle(document.body).backgroundColor === 'rgb(11, 14, 19)'));
  ok('starts OFF AIR', (await cg.textContent('#air-chip')) === 'OFF AIR');
  await cg.click('[data-left-tab=templates]'); await cg.click('[data-template=lower-third]');
  await cg.click('#preview-webmix');
  ok('Preview → green PREVIEW chip', await until(async () => (await cg.textContent('#air-chip')) === 'PREVIEW' && await cg.evaluate(() => document.querySelector('#air-chip').classList.contains('is-pvw'))));
  await cg.click('#take');
  ok('Take → red ON AIR chip', await until(async () => (await cg.textContent('#air-chip')) === 'ON AIR' && await cg.evaluate(() => document.querySelector('#air-chip').classList.contains('is-pgm'))));
  ok('studio shows the CG on an overlay', await until(() => p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'cg'); return window.webmix.ovl.some(c => c.on && c.inputId === i.id); })));
  await cg.screenshot({ path: S + '/cgstudio.png' });
  await cg.click('#clear');
  ok('Clear → back to OFF AIR', await until(async () => (await cg.textContent('#air-chip')) === 'OFF AIR', 8000) && await until(() => p.evaluate(() => !window.webmix.ovl.some(c => c.on))));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
