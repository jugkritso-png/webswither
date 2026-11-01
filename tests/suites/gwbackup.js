// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Gateway สำรอง: ตัวหลักต่อไม่ติดตอนเริ่ม / กำลังอัปเดต (drain) / ล่มระหว่างไลฟ์ → ไลฟ์ย้ายไปตัวสำรองเองและออกอากาศต่อ
// ปลายทางได้ภาพจากตัวสำรองจริง · ไลฟ์ครั้งถัดไปเริ่มที่ตัวหลัก · ไม่ตั้งตัวสำรอง = ทำงานแบบเดิม
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { ROOT } = require('../lib');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const PRIMARY = 8094, BACKUP = 8095;
const gwEnv = (port, dir) => ({ ...process.env, PORT: String(port), STREAM_TOKEN: 'abc', USERS_FILE: path.join(dir, 'users.json') });
const startGw = (port, dir) => { fs.mkdirSync(dir, { recursive: true }); return spawn(process.execPath, ['stream-gateway.js'], { cwd: path.join(ROOT, 'server'), env: gwEnv(port, dir), stdio: 'ignore' }); };
const listen = (key, file) => spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:1937/live/${key}`, '-c', 'copy', '-y', file], { stdio: 'ignore' });
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(250); } return false; };
(async () => {
  const pDir = path.join(S, 'gwb-primary'), bDir = path.join(S, 'gwb-backup');
  let backup = startGw(BACKUP, bDir);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(([pp, bp]) => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); localStorage.setItem('webmix:settings', JSON.stringify({
    gateway: `ws://127.0.0.1:${pp}/?token=abc`, gatewayBackup: `ws://127.0.0.1:${bp}/?token=abc`, rememberKey: true,
    destinations: [{ id: 'a', platform: 'custom', server: 'rtmp://127.0.0.1:1937/live', key: 'k', enabled: true }] })); }, [PRIMARY, BACKUP]);
  await p.reload(); await p.waitForTimeout(1200);
  const btn = async () => (await p.textContent('#btn-stream')).trim();
  const gw = () => p.evaluate(() => window.webmix.gwState());
  const goLive = async () => { await p.click('[data-action=stream]'); await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]').catch(() => {}); await p.click('.pf-desk [data-pf=go]').catch(() => {}); await p.keyboard.press('Escape'); };
  const stop = async () => { await p.evaluate(() => { const w = window.webmix; w.streamer.ws?.close(1000); }); await wait(1500); };

  // 1) ตัวหลักไม่ทำงานเลยตอนเริ่ม → ไปตัวสำรอง ปลายทางได้ภาพ
  let rx = listen('k', `${S}/gwb-1.flv`);
  await goLive();
  ok('primary down at start → live through the backup', await until(async () => (await btn()).includes('ON AIR')) && (await gw()).backup, `${await btn()} ${JSON.stringify(await gw())}`);
  ok('toast says it moved to the backup', /ย้ายไลฟ์ไป Gateway สำรอง/.test(await p.textContent('#toasts')));
  ok('status bar marks the backup', /Gateway สำรอง/.test(await p.textContent('#st-stream')), await p.textContent('#st-stream'));
  await wait(4000); await stop(); rx.kill('SIGINT'); await wait(1000);
  ok('destination received the stream from the backup', fs.existsSync(`${S}/gwb-1.flv`) && fs.statSync(`${S}/gwb-1.flv`).size > 20000);
  ok('after the live ends the next one starts at the primary again', (await gw()).backup === false && /:8094\//.test((await gw()).url));

  // 2) ตัวหลักกำลังอัปเดต (drain) → ไปตัวสำรองทันที
  let primary = startGw(PRIMARY, pDir); await wait(1200);
  fs.writeFileSync(path.join(pDir, 'drain'), '');
  rx = listen('k', `${S}/gwb-2.flv`);
  await goLive();
  ok('primary draining → straight to the backup', await until(async () => (await btn()).includes('ON AIR')) && (await gw()).backup && /กำลังอัปเดต/.test(await p.textContent('#toasts')), `${await btn()} ${await p.textContent('#toasts')}`);
  await stop(); rx.kill('SIGINT'); await wait(800);

  // 3) ล่มระหว่างไลฟ์: ไลฟ์ผ่านตัวหลัก แล้วตัวหลักดับ → ต่อใหม่ไม่ติด → ย้ายไปตัวสำรอง ออกอากาศต่อ
  primary.kill('SIGKILL'); await wait(300); primary = startGw(PRIMARY, pDir); await wait(1200);
  rx = listen('k', `${S}/gwb-3.flv`);
  await goLive();
  ok('normal: live through the primary', await until(async () => (await btn()).includes('ON AIR')) && !(await gw()).backup, JSON.stringify(await gw()));
  primary.kill('SIGKILL'); rx.kill('SIGINT'); await wait(500);
  const rx2 = listen('k', `${S}/gwb-4.flv`);
  ok('primary dies mid-live → back ON AIR through the backup', await until(async () => (await gw()).backup && (await btn()).includes('ON AIR'), 25000), `${await btn()} ${JSON.stringify(await gw())}`);
  await wait(3000); await stop(); rx2.kill('SIGINT'); await wait(800);
  ok('destination keeps receiving after the move', fs.existsSync(`${S}/gwb-4.flv`) && fs.statSync(`${S}/gwb-4.flv`).size > 10000);

  // 4) ไม่ตั้งตัวสำรอง: ตัวหลักต่อไม่ได้ → แจ้งเหมือนเดิม ไม่ย้ายไปไหน
  await p.evaluate(() => { window.webmix.settings.gatewayBackup = ''; });
  await goLive();
  ok('no backup set: start fails with the usual message', await until(async () => /เชื่อมต่อ Stream Gateway ไม่ได้/.test(await p.textContent('#toasts')), 8000) && !(await gw()).backup);

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  backup.kill('SIGKILL');
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
