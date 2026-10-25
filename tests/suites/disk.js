// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// พื้นที่ดิสก์ระหว่างบันทึก (design 68/70): ชิปบนแถบสถานะ · รายละเอียด · การ์ดเตือน เหลือง/แดง · หยุด ISO / หยุดบันทึกให้เอง · มือถือ
const { chromium, devices } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const GB = 1e9, rate = kbps => (kbps + 160) * 125; // ไบต์ต่อวินาทีต่อไฟล์
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("กล้อง"), .add-big button:has-text("กล้อง")');
  await p.waitForSelector('.modal-foot .btn-primary'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1500);
  await p.evaluate(async () => { const w = window.webmix; w.settings.isoRec = true; const root = await navigator.storage.getDirectory(); w.useRecFolder(await root.getDirectoryHandle('DISK', { create: true })); });
  const kbps = await p.evaluate(() => window.webmix.settings.videoKbps);

  ok('no disk chip while not recording', await p.isHidden('#st-disk'));
  await p.evaluate(gb => window.webmix.setDiskFree(gb), 200 * GB);
  await p.click('#btn-rec'); await p.waitForTimeout(3000);
  await p.evaluate(() => window.webmix.diskTick());
  ok('recording shows the disk chip (plenty of space, no alert)', await p.isVisible('#st-disk') && /186/.test(await p.textContent('#st-disk')) && !(await p.$('.m-alert[class*=amber], .m-alert.is-red')), await p.textContent('#st-disk'));

  // เหลือราว 20 นาทีของ (Program + ISO 1 กล้อง) → เหลือง
  const files = await p.evaluate(() => 1 + (window.webmix.inputs.filter(i => i.type === 'camera').length));
  await p.evaluate(b => window.webmix.setDiskFree(b), rate(kbps) * files * 60 * 20);
  ok('amber warning under 30 minutes', await until(() => p.evaluate(() => /บันทึกได้อีกราว (19|20) นาที/.test(document.querySelector('#m-alerts')?.textContent || ''))), await p.textContent('#m-alerts'));
  ok('alert offers stop ISO and record elsewhere', /หยุดไฟล์แยกกล้อง/.test(await p.textContent('#m-alerts')) && /บันทึกต่อในโฟลเดอร์อื่น/.test(await p.textContent('#m-alerts')));
  await p.click('#st-disk'); await p.waitForTimeout(200);
  const pop = await p.textContent('#disk-pop');
  ok('chip opens the breakdown (main file, ISO, if ISO stopped)', /ไฟล์หลัก/.test(pop) && /ISO/.test(pop) && /ถ้าหยุด ISO/.test(pop), pop.replace(/\s+/g, ' '));
  await p.screenshot({ path: S + '/disk-amber.png' });
  await p.mouse.click(700, 300);

  // เหลือ 1.5 นาที → หยุด ISO ให้เอง
  await p.evaluate(b => window.webmix.setDiskFree(b), rate(kbps) * files * 60 * 1.5);
  ok('under 2 minutes: ISO stopped automatically', await until(() => p.evaluate(() => !/ISO \d/.test(document.querySelector('#st-rec').textContent))), await p.textContent('#st-rec'));
  ok('red warning', await until(() => p.evaluate(() => !!document.querySelector('#m-alerts .m-alert.is-red'))));
  ok('main recording continues', await p.evaluate(() => window.webmix.rec.active));

  // เหลือไม่ถึง 1 นาทีของไฟล์หลัก → หยุดบันทึกให้เอง ไฟล์ปิดเรียบร้อย
  await p.evaluate(b => window.webmix.setDiskFree(b), rate(kbps) * 40);
  ok('under 1 minute: recording stopped and file closed', await until(() => p.evaluate(() => !window.webmix.rec.active && !!window.webmix.rec.last)));
  ok('full alert explains the file is safe', await until(() => p.evaluate(() => /หยุดบันทึกแล้ว — พื้นที่เต็ม/.test(document.querySelector('#m-alerts').textContent))), await p.textContent('#m-alerts'));
  await p.screenshot({ path: S + '/disk-full.png' });

  // มือถือ
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); m.on('pageerror', e => errs.push('m ' + e.message));
  await m.goto('http://localhost:8765/index.html'); await m.waitForTimeout(1000);
  await m.evaluate(gb => window.webmix.setDiskFree(gb), 1 * GB);
  await m.evaluate(() => document.querySelector('#btn-rec').click()); await m.waitForTimeout(2500);
  await m.evaluate(() => window.webmix.diskTick());
  const mt = await m.textContent('#m-alerts');
  ok('phone: alert card with a stop-recording button', /พื้นที่ดิสก์เหลือ/.test(mt) && /หยุดบันทึก/.test(mt), mt);
  await m.screenshot({ path: S + '/disk-phone.png' });

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
