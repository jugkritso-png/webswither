// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// อัปเดตแอป (จำลอง Tauri): ตรวจหาเวอร์ชันใหม่จากหน้าตั้งค่า → แจ้งพร้อมปุ่มอัปเดต · ไม่ติดตั้งระหว่างไลฟ์ · ติดตั้งไม่สำเร็จบอกทางเลือก
// เป็นเวอร์ชันล่าสุดแล้วบอกชัด · Android ดูเวอร์ชันจาก GitHub แล้วบอกให้ดาวน์โหลด APK
const { chromium, devices } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const MOCK = () => {
  window.__calls = {}; window.__update = { version: '9.9.9', current: '1.0.0' }; window.__installFail = '';
  const cmds = {
    desktop_info: () => ({ version: '1.0.0', os: 'windows', arch: 'x86_64', gateway: { url: 'ws://localhost:8089/?token=abc', srt: true }, gatewayError: null, ffmpeg: { path: 'ffmpeg', version: 'ffmpeg 6' }, recDir: 'C:/Videos', tempDir: 'C:/Temp', selftest: false }),
    update_check: () => window.__update,
    update_install: () => { if (window.__installFail) throw new Error(window.__installFail); window.__installed = true; return null; }
  };
  window.__TAURI__ = { core: { invoke: async (cmd, args) => { window.__calls[cmd] = (window.__calls[cmd] || 0) + 1; if (!cmds[cmd]) throw new Error('unknown command ' + cmd); return cmds[cmd](args); } } };
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx.addInitScript(MOCK);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1000);
  const openPane = async () => { await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]'); await p.evaluate(() => document.querySelectorAll('.modal details.adv').forEach(d => { d.open = true; })); };
  await openPane();
  ok('settings shows the app version and a check button', /แอปเวอร์ชัน 1\.0\.0/.test(await p.textContent('.app-ver')) && /ตรวจหาอัปเดต/.test(await p.textContent('.app-update-btn')));
  await p.click('.app-update-btn'); await p.waitForTimeout(300);
  ok('finding a new version: toast with an update button', await p.isVisible('.toast .toast-action:has-text("อัปเดตเลย")') && /9\.9\.9/.test(await p.textContent('#toasts')));
  ok('settings line now offers the update', /มีเวอร์ชันใหม่ 9\.9\.9/.test(await p.textContent('.app-ver')) && /อัปเดตเลย/.test(await p.textContent('.app-update-btn')));
  // ระหว่างไลฟ์ไม่ติดตั้ง
  await p.evaluate(() => { window.webmix.streamer.active = true; });
  await p.click('.app-update-btn'); await p.waitForTimeout(300);
  ok('no install while live', !(await p.evaluate(() => window.__calls.update_install)) && /หยุดก่อน/.test(await p.textContent('#toasts')));
  await p.evaluate(() => { window.webmix.streamer.active = false; window.__installFail = 'signature mismatch'; });
  await p.click('.app-update-btn'); await p.waitForTimeout(400);
  ok('failed install explains and offers the download page', await p.evaluate(() => window.__calls.update_install === 1) && /อัปเดตไม่สำเร็จ: signature mismatch/.test(await p.textContent('#toasts')) && await p.isVisible('.toast .toast-action:has-text("คัดลอกลิงก์")'));
  await p.evaluate(() => { window.__installFail = ''; });
  await p.click('.app-update-btn'); await p.waitForTimeout(400);
  ok('install runs when idle', await p.evaluate(() => window.__installed === true && window.__calls.update_install === 2));
  // ไม่มีเวอร์ชันใหม่
  await p.keyboard.press('Escape');
  await p.reload(); await p.waitForTimeout(1000);
  await p.evaluate(() => { window.__update = null; });
  await openPane(); await p.click('.app-update-btn'); await p.waitForTimeout(300);
  ok('up to date: says so', /เป็นเวอร์ชันล่าสุดแล้ว \(1\.0\.0\)/.test(await p.textContent('#toasts')) && /เป็นเวอร์ชันล่าสุด/.test(await p.textContent('.app-ver')));
  ok('checks by itself ~20 s after start', await (async () => { await p.waitForTimeout(20500); return (await p.evaluate(() => window.__calls.update_check)) >= 2; })());

  // Android: เช็กจาก GitHub
  const m = await b.newContext({ ...devices['Pixel 7'] });
  await m.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  let asked = 0;
  await m.route(/api\.github\.com\/repos\/jugkritso-png\/webswither\/releases\/latest/, r => { asked++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'v9.9.9' }) }); });
  await m.addInitScript(MOCK);
  const a = await m.newPage(); a.on('pageerror', e => errs.push('android ' + e.message));
  await a.goto('http://localhost:8765/index.html'); await a.waitForTimeout(1000);
  await a.evaluate(() => window.webmix.checkAppUpdate(true)); await a.waitForTimeout(400);
  ok('Android: newer release on GitHub → download the APK', asked === 1 && /ดาวน์โหลด APK/.test(await a.textContent('#toasts')) && !(await a.evaluate(() => window.__calls.update_check)));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
