// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// อัปเดตแอป (จำลอง Tauri): ตรวจหาเวอร์ชันใหม่จากหน้าตั้งค่า → แจ้งพร้อมปุ่มอัปเดต · ไม่ติดตั้งระหว่างไลฟ์ · ติดตั้งไม่สำเร็จบอกทางเลือก
// เป็นเวอร์ชันล่าสุดแล้วบอกชัด · Android ดูเวอร์ชันจาก GitHub แล้วบอกให้ดาวน์โหลด APK
const { chromium, devices } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const MOCK = () => {
  window.__calls = {}; window.__update = { version: '9.9.9', current: '1.0.0', notes: '- มิเตอร์ความดัง LUFS\n- แก้ไข: การ์ดไม่ถูกตัด' }; window.__installFail = '';
  const cmds = {
    desktop_info: () => ({ version: '1.0.0', os: 'windows', arch: 'x86_64', gateway: { url: 'ws://localhost:8089/?token=abc', srt: true }, gatewayError: null, ffmpeg: { path: 'ffmpeg', version: 'ffmpeg 6' }, recDir: 'C:/Videos', tempDir: 'C:/Temp', selftest: false }),
    update_check: () => window.__update,
    update_install: () => { if (window.__installFail) throw new Error(window.__installFail); window.__installed = true; return null; },
    // ดาวน์โหลดจำลอง 4 ก้อน ก้อนละ 100 ms
    update_download: async ({ onProgress }) => { for (let i = 1; i <= 4; i++) { await new Promise(r => setTimeout(r, 100)); onProgress.onmessage({ done: i * 2500000, total: 10000000 }); } return { version: '9.9.9' }; },
    update_apply: () => { if (window.__installFail) throw new Error(window.__installFail); window.__installed = true; return null; }
  };
  class Channel { constructor() { this.onmessage = null; } }
  window.__TAURI__ = { core: { Channel, invoke: async (cmd, args) => { window.__calls[cmd] = (window.__calls[cmd] || 0) + 1; if (!cmds[cmd]) throw new Error('unknown command ' + cmd); return cmds[cmd](args); } } };
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
  ok('finding a new version: toast with a details button', await p.isVisible('.toast .toast-action:has-text("ดูรายละเอียด")') && /9\.9\.9/.test(await p.textContent('#toasts')));
  ok('settings line now offers the update', /มีเวอร์ชันใหม่ 9\.9\.9/.test(await p.textContent('.app-ver')) && /อัปเดตเลย/.test(await p.textContent('.app-update-btn')));
  await p.click('.app-update-btn'); await p.waitForSelector('.up-modal');
  ok('update dialog lists what is new', (await p.$$('.up-notes li')).length === 2 && /แก้ไข/.test(await p.textContent('.up-notes')));
  await p.waitForTimeout(900);
  ok('downloads in the background with progress', /พร้อมติดตั้ง/.test(await p.textContent('.up-state')) && /9\.5 MB/.test(await p.textContent('.up-mb')), await p.textContent('.up-mb'));
  // ระหว่างไลฟ์ไม่ติดตั้ง
  await p.evaluate(() => { window.webmix.streamer.active = true; }); await p.waitForTimeout(400);
  ok('no restart while live', await p.isDisabled('.up-modal .btn-primary') && await p.isVisible('.up-live'));
  await p.evaluate(() => { window.webmix.streamer.active = false; window.__installFail = 'signature mismatch'; }); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('.up-modal .btn-primary').click()); await p.waitForTimeout(400);
  ok('failed install explains', await p.evaluate(() => window.__calls.update_apply === 1) && /ติดตั้งไม่สำเร็จ: signature mismatch/.test(await p.textContent('#toasts')));
  await p.evaluate(() => { window.__installFail = ''; window.webmix.checkAppUpdate(false); }); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('.app-update-btn')?.click() || document.querySelector('.toast-action')?.click()); await p.waitForSelector('.up-modal');
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('.up-modal .btn-primary').click()); await p.waitForTimeout(400);
  ok('restart and install when idle', await p.evaluate(() => window.__installed === true && window.__calls.update_apply === 2));
  await p.keyboard.press('Escape');
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
