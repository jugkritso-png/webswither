// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// เว็บบนคอม: ตรวจชิปเข้ารหัส H.264 แบบต้องเป็นฮาร์ดแวร์ (prefer-hardware) · ผ่าน = ส่งตรงผ่าน Gateway บนเซิร์ฟเวอร์ (vcopy=1)
// ไม่ผ่าน = Gateway เข้ารหัสเหมือนเดิม · เริ่มไลฟ์แล้วเข้ารหัสด้วยชิปไม่ได้ → ถอยให้ Gateway เข้ารหัส ไลฟ์ยังขึ้น
// (Chromium ของชุดทดสอบไม่มี H.264 — จำลองผลการตรวจชิป ส่วนการส่งตรงจริงทดสอบใน wcrec และ Android emulator)
const { chromium } = require('playwright');
const { listenRtmp } = require('../lib');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // จำลองผลตรวจชิป: บันทึกว่าขอแบบฮาร์ดแวร์ไหม แล้วตอบว่าผ่าน
  await ctx.addInitScript(() => {
    window.__bench = [];
    const hook = () => { const wc = window.WebMix && window.WebMix.wcrec; if (!wc || wc.__hooked) return; wc.__hooked = true; wc.avcBenchmark = async (...a) => { window.__bench.push(a); return { ok: true, fps: 30 }; }; };
    document.addEventListener('DOMContentLoaded', () => { hook(); setTimeout(hook, 0); });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const sockets = []; p.on('websocket', ws => sockets.push(ws.url()));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'ws://127.0.0.1:8089/?token=abc', rememberKey: true,
    destinations: [{ id: 'a', platform: 'custom', server: 'rtmp://127.0.0.1:1949/live', key: 'hw', enabled: true }] })); });
  await p.reload();
  ok('web page checks the H.264 chip, hardware only', await until(() => p.evaluate(() => window.__bench.length > 0 && window.__bench[0][5] === true), 9000), JSON.stringify(await p.evaluate(() => window.__bench)));

  const rx = listenRtmp(1949, 'hw', S + '/webhw.flv');
  await p.waitForTimeout(500);
  await p.click('[data-action=stream]'); await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]').catch(() => {}); await p.click('.pf-desk [data-pf=go]').catch(() => {}); await p.keyboard.press('Escape');
  ok('chip passed → asks the server gateway to pass the video through (vcopy=1)', await until(async () => sockets.some(u => /:8089\/.*vcopy=1/.test(u)), 8000), JSON.stringify(sockets));
  // ไม่มีตัวเข้ารหัส H.264 จริงในเบราว์เซอร์นี้ → ต้องถอยให้ Gateway เข้ารหัส แล้วไลฟ์ขึ้น
  ok('chip fails while going live → falls back to gateway encoding and goes ON AIR', await until(async () => (await p.textContent('#btn-stream')).includes('ON AIR'), 25000), (await p.textContent('#btn-stream')).trim());
  ok('fallback connection has no vcopy', sockets.some(u => /:8089\//.test(u) && !/vcopy=1/.test(u)), JSON.stringify(sockets));
  ok('user told why', /ชิปของเครื่อง/.test(await p.textContent('#toasts')), await p.textContent('#toasts'));
  await p.evaluate(() => window.webmix.streamer.ws?.close(1000)); await p.waitForTimeout(1500);
  rx.kill('SIGINT');
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
