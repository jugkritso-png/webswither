// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const gw = () => spawn('node', ['stream-gateway.js'], { cwd: ROOT + '/server', env: { ...process.env, PORT: '8090', STREAM_TOKEN: 'abc' }, stdio: 'ignore' });
const listen = (port, key, out) => spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/${key}`, '-c', 'copy', '-y', `${S}/${out}.flv`], { stdio: 'ignore' });
(async () => {
  let g = gw();
  const l1 = listen(1935, 'k1', 'rc1');
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'ws://127.0.0.1:8090/?token=abc', rememberKey: true,
    destinations: [{ id: 'a', platform: 'custom', server: 'rtmp://127.0.0.1:1935/live', key: 'k1', enabled: true }] })); });
  await p.reload(); await p.waitForTimeout(1500);
  const btn = async () => (await p.textContent('#btn-stream')).trim();
  await p.click('[data-action=stream]'); await p.click('.dest-start-all'); await p.keyboard.press('Escape');
  await p.waitForTimeout(7000);
  ok('live before outage', (await btn()).includes('ON AIR 1/1'), await btn());
  const t0 = await p.textContent('#onair-timer');
  // 1) gateway crashes and comes back after 5 s
  g.kill('SIGKILL'); await p.waitForTimeout(1500);
  ok('shows RECONNECTING', (await btn()) === 'RECONNECTING', await btn());
  ok('ON AIR lamp stays on during outage', (await p.textContent('#tally-lamp')).includes('ON AIR'));
  ok('status bar shows attempt', /RECONNECTING/.test(await p.textContent('#st-stream')), await p.textContent('#st-stream'));
  await p.waitForTimeout(4000);
  const l2 = listen(1935, 'k1', 'rc2');
  g = gw(); await p.waitForTimeout(16000);
  ok('reconnected and destination live again', (await btn()).includes('ON AIR 1/1'), await btn());
  const t1 = await p.textContent('#onair-timer');
  ok('on-air timer kept running', t1 > t0, `${t0} → ${t1}`);
  // 2) silent hang: stop the gateway process (no socket close) → watchdog
  execSync(`kill -STOP ${g.pid}`); await p.waitForTimeout(11000);
  ok('watchdog detects frozen gateway', (await btn()) === 'RECONNECTING', await btn());
  execSync(`kill -9 ${g.pid}`);
  // 3) user can cancel while reconnecting
  await p.click('[data-action=stream]'); await p.click('.dest-stop-all'); await p.locator('.modal-foot .btn-danger').last().click(); await p.waitForTimeout(800);
  ok('stop all cancels reconnect', (await btn()) === 'STREAM' && (await p.textContent('#tally-lamp')).includes('OFF AIR'), await btn());
  await p.waitForTimeout(12000);
  ok('no further reconnect attempts after stop', (await btn()) === 'STREAM');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
  [l1, l2].forEach(x => x.kill('SIGKILL'));
  process.exit(0);
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
