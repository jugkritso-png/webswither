// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ใช้ได้ทั้ง Gateway Node และ Rust: GATEWAY_BIN)
// ทดสอบก่อนไลฟ์ (design 66): ส่งภาพ Program ถึง Gateway · Gateway ตรวจรหัสปลายทางโดยไม่ส่งภาพ — ปลายทางไม่ได้รับวิดีโอ
const { listenRtmp, probe } = require('../lib');
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 300)); } return false; };
(async () => {
  const rx = listenRtmp(1940, 'dr', `${S}/dryrun.flv`);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // วัดความเร็วเน็ต: ตอบแทน speed.cloudflare.com (เครื่องทดสอบไม่ออกอินเทอร์เน็ต)
  await ctx.route('https://speed.cloudflare.com/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'ws://127.0.0.1:8089/?token=abc', rememberKey: true,
    destinations: [{ id: 'a', platform: 'custom', server: 'rtmp://127.0.0.1:1940/live', key: 'dr', enabled: true }, { id: 'b', platform: 'custom', server: 'rtmp://127.0.0.1:1941/live', key: 'secret-key-9', enabled: true }] })); });
  await p.reload(); await p.waitForTimeout(1200);
  await p.evaluate(() => window.webmix.setDryRunSeconds(8));

  // จากหน้าเตรียมก่อนไลฟ์
  await p.click('#btn-stream'); await p.click('.dest-start-all');
  await p.waitForSelector('.pf-desk [data-pf=test]'); await p.click('.pf-desk [data-pf=test]');
  await p.waitForSelector('.dr-modal');
  ok('pre-live check opens the test window', (await p.textContent('.dr-modal .dr-cap')).includes('8 วินาที'));
  ok('progress shows while testing', await until(() => p.evaluate(() => /กำลังทดสอบ \d/.test(document.querySelector('.dr-stage').textContent)), 6000));
  await p.waitForFunction(() => /ทดสอบเสร็จ|ไม่สำเร็จ/.test(document.querySelector('.dr-stage').textContent), null, { timeout: 40000 });
  const rows = await p.$$eval('.dr-rows .dr-row', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok('encoder speed measured', /เข้ารหัสทันเวลา.*\d\.\d\dx/.test(rows[0] || ''), rows[0]);
  ok('upload capacity measured and the stream did not back up', /อัปโหลด.*วัดได้ \d+\.\d.*ไม่ค้าง/.test(rows[1] || ''), rows[1]);
  const dests = await p.$$eval('.dr-dests .dr-row', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok('working destination: key accepted', /รหัสถูกต้อง/.test(dests[0] || ''), dests[0]);
  ok('dead destination fails with a reason, key masked', /ไม่ผ่าน/.test(dests[1] || '') && /ปฏิเสธ|refused/i.test(dests[1]) && !/secret-key-9/.test(dests[1]), dests[1]);
  ok('verdict: not ready, start disabled', (await p.textContent('.dr-verdict b')) === 'ยังไม่พร้อม' && await p.isDisabled('[data-dr=go]'));
  ok('nothing went live during the test', await p.evaluate(() => !window.webmix.streamer.ws && !window.webmix.streamer.active));
  await p.screenshot({ path: S + '/dryrun.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  rx.kill('SIGINT'); await p.waitForTimeout(800);
  ok('destination received no video (did not go on air)', !/h264/.test(probe(`${S}/dryrun.flv`)), probe(`${S}/dryrun.flv`));

  // ปลายทางที่ใช้ได้อย่างเดียว → พร้อมไลฟ์
  const rx2 = listenRtmp(1940, 'dr', `${S}/dryrun2.flv`); await p.waitForTimeout(600);
  await p.evaluate(() => { const w = window.webmix; w.settings.destinations[1].enabled = false; w.openDryRun(); });
  await p.waitForFunction(() => /ทดสอบเสร็จ|ไม่สำเร็จ/.test(document.querySelector('.dr-stage')?.textContent || ''), null, { timeout: 40000 });
  const v = await p.textContent('.dr-verdict b');
  ok('all good: ready (or ready with a note)', /พร้อมไลฟ์|ไลฟ์ได้/.test(v), v + ' · ' + await p.textContent('.dr-vtext'));
  ok('start button enabled', !(await p.isDisabled('[data-dr=go]')));
  await p.keyboard.press('Escape');
  rx2.kill('SIGINT');

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
