// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แอป Android (จำลอง Tauri + user agent Android): วาดภาพไม่เกินเฟรมเรตเอาต์พุต (ไม่วาด 60 ครั้ง/วินาทีเมื่อส่งออก 30)
// และแผงไลฟ์บอกวิธีเข้ารหัส (ชิปของเครื่องส่งตรง / แปลง 2 ขั้น) — ใช้ดูสาเหตุเวลาเครื่องอืด
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOCK = () => {
  const cmds = {
    desktop_info: () => ({ version: '1.1.18', os: 'android', arch: 'aarch64', gateway: { url: 'ws://localhost:8089/?token=abc', srt: true }, gatewayError: null,
      ffmpeg: { path: 'ffmpeg', version: 'ffmpeg version test' }, recDir: '/storage/emulated/0/Movies/WebMix', tempDir: '/tmp', selftest: false, encoder: 'h264_mediacodec' })
  };
  window.__TAURI__ = { core: { invoke: async cmd => { if (!cmds[cmd]) throw new Error('unknown command ' + cmd); return cmds[cmd](); } } };
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; RMX3700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx.addInitScript(MOCK);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); localStorage.setItem('webmix:settings', JSON.stringify({ fps: 30 })); });
  await p.reload(); await p.waitForTimeout(1500);
  ok('runs as the Android app', await p.evaluate(() => !!window.WebMix.desktop?.mobile));
  const f = []; for (let i = 0; i < 4; i++) { await sleep(1000); f.push(await p.evaluate(() => window.webmix.perf().fps)); }
  ok('phone draws at the output frame rate, not 60', f.every(x => x <= 33) && f.some(x => x >= 20), f.map(x => x.toFixed(0)).join(','));
  // แผงไลฟ์บนมือถือ: บอกวิธีเข้ารหัส
  await p.evaluate(() => window.webmix.renderInputs && 0);
  await p.locator('[data-action=stream]:visible').first().click().catch(e => results.push('INFO  ' + e.message.split('\n')[0]));
  // ยังไม่ได้ไลฟ์: ปุ่มไลฟ์เปิดหน้าเตรียมก่อนไลฟ์ — บอกวิธีเข้ารหัส (ชิปส่งตรง / แปลง 2 ขั้น พร้อมคำแนะนำ)
  await sleep(4500);
  const pf = await p.evaluate(() => document.querySelector('.modal')?.textContent || '');
  ok('pre-live check says how the picture will be encoded', /ตัวเข้ารหัส/.test(pf) && /ชิปของเครื่อง ส่งตรง|แปลงภาพ 2 ขั้น/.test(pf), pf.slice(0, 300));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
