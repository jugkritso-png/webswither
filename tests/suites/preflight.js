// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// เตรียมก่อนไลฟ์ (design 25) + สรุปหลังไลฟ์ (design 26) บนเดสก์ท็อป
const { ROOT } = require('../lib');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const listen = (port, key, out) => spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/${key}`, '-c', 'copy', '-y', `${S}/${out}.flv`], { stdio: 'ignore' });
(async () => {
  const g = spawn('node', ['stream-gateway.js'], { cwd: ROOT + '/server', env: { ...process.env, PORT: '8091', STREAM_TOKEN: 'abc' }, stdio: 'ignore' });
  const l1 = listen(1937, 'pf', 'pf1');
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'ws://127.0.0.1:8091/?token=abc', rememberKey: true,
    destinations: [{ id: 'a', platform: 'custom', server: 'rtmp://127.0.0.1:1937/live', key: 'pf', enabled: true }] })); });
  await p.reload(); await p.waitForTimeout(1500);

  await p.click('#btn-stream'); await p.click('.dest-start-all');
  await p.waitForSelector('.pf-desk .pf-row');
  ok('start-all opens the preflight when nothing is live', await p.isVisible('.pf-modal'));
  const rows = await p.$$eval('.pf-row b', r => r.map(x => x.textContent));
  ok('checks: sources, mic, destinations, upload, loudness, machine', ['แหล่งภาพ', 'ไมค์', 'ปลายทาง', 'อัปโหลด', 'ความดัง', 'เครื่องนี้'].every(k => rows.some(r => r.includes(k))), JSON.stringify(rows));
  ok('summary counts passed checks', /ผ่าน \d+ จาก \d+/.test(await p.textContent('.pf-sum b')));
  ok('destinations listed in the side panel', (await p.textContent('.pf-dests')).length > 0);
  ok('Program preview drawn', await p.evaluate(() => { const c = document.querySelector('.pf-pgm'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) n += d[i] + d[i + 1] + d[i + 2]; return n > 0; }));
  ok('go button enabled with a valid setup', !(await p.isDisabled('[data-pf=go]')));
  const rec0 = await p.getAttribute('.pf-rec', 'aria-checked');
  await p.click('.pf-rec');
  ok('record-with-live toggle', (await p.getAttribute('.pf-rec', 'aria-checked')) !== rec0 && await p.evaluate(r => String(!!window.webmix.settings.autoRec) !== r, rec0));
  await p.click('.pf-rec');
  await p.click('[data-cd="3"]');
  ok('countdown choice is remembered', await p.evaluate(() => localStorage.getItem('webmix:pfCountdown') === '3'));
  await p.screenshot({ path: S + '/preflight.png' });
  await p.click('[data-pf=go]');
  await p.waitForSelector('.m-countdown', { timeout: 2000 });
  ok('3-2-1 countdown before going live', true);
  await p.waitForSelector('.m-countdown', { state: 'detached', timeout: 6000 });
  await p.waitForTimeout(6000);
  ok('live after the countdown', (await p.textContent('#btn-stream')).includes('ON AIR'), await p.textContent('#btn-stream'));
  ok('live panel reopens to watch the stream', await p.isVisible('.lv-drawer, .dest-live'));
  // หยุดก่อนครบนาที → ไม่มีหน้าสรุป
  await p.click('.dest-stop-all'); await p.locator('.modal-foot .btn-danger').last().click(); await p.waitForTimeout(1500);
  ok('short live (< 1 min) shows no summary', !(await p.$('.sm-modal')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // หน้าสรุป (ข้อมูลจำลอง)
  await p.evaluate(() => {
    const t = Date.now() - 3725000;
    window.webmix.openDeskSummary({ start: t, end: Date.now(), duration: 3725000, bytes: 2.1e9, kbps: [], all: Array.from({ length: 300 }, (_, i) => (i > 150 && i < 160 ? 1200 : 4400)), fps: [30, 29.8],
      reconnects: 1, dests: { a: { label: 'YouTube Live', live: 3725, down: 0, drops: 0 }, b: { label: 'Facebook Page', live: 3719, down: 6, drops: 1 } },
      events: [{ at: t + 31 * 60000, text: 'เน็ตหลุด — ต่อใหม่อัตโนมัติ' }] }, '');
  });
  await p.waitForSelector('.sm-modal');
  ok('summary title', (await p.textContent('.sm-modal')).includes('ไลฟ์จบเรียบร้อย'));
  ok('five key numbers', (await p.$$('.sm-stats > div')).length === 5 && (await p.textContent('.sm-stats')).includes('1:02:05'), await p.textContent('.sm-stats'));
  ok('bitrate graph with target and event marker', !!(await p.$('.sm-line')) && !!(await p.$('.sm-target')) && (await p.textContent('.sm-graph')).includes('นาที 31'));
  ok('destination rows', (await p.textContent('.sm-cols')).includes('ต่อใหม่ 1 ครั้ง'));
  await p.screenshot({ path: S + '/summary.png' });
  await p.click('[data-sm=save]'); await p.waitForTimeout(200);
  ok('save show for next time goes to the library', await p.evaluate(() => (JSON.parse(localStorage.getItem('webmix:library') || '[]')).length === 1));

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close(); g.kill(); l1.kill();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
