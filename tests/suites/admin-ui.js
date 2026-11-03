// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// หน้าผู้ดูแลเซิร์ฟเวอร์ (/admin): เข้าด้วยรหัส → ภาพรวม → เพิ่มคน (ได้ลิงก์เชิญ) → แก้แพ็กเกจ → พัก/เปิด → ทำรหัสใหม่ → ลบ
// ลิงก์เชิญเปิดใน WebMix แล้วตั้ง Gateway ให้เอง · ผู้ดูแลกดหยุดไลฟ์ได้ (แอปไม่ต่อใหม่เอง) · พักรับไลฟ์ใหม่ก่อนอัปเดต
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { ROOT } = require('../lib');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) {} await wait(250); } return false; };
const PORT = 8096;
const dir = path.join(S, 'admin-ui'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const USERS_FILE = path.join(dir, 'users.json');
const post = (p, token, body) => new Promise(res => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) } },
    x => { let d = ''; x.on('data', c => { d += c; }); x.on('end', () => res({ status: x.statusCode, body: d })); });
  r.on('error', e => res({ status: 0, body: e.message })); r.end(b);
});
const get = p => new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: p }, x => { let d = ''; x.on('data', c => { d += c; }); x.on('end', () => res({ status: x.statusCode, body: d })); }).on('error', e => res({ status: 0, body: e.message })));
const listen = (key, file) => spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:1939/live/${key}`, '-c', 'copy', '-y', file], { stdio: 'ignore' });

(async () => {
  const gw = spawn(process.execPath, ['stream-gateway.js'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, PORT: String(PORT), STREAM_TOKEN: 'boss-token', USERS_FILE, MAX_STREAMS: '4', UPLINK_MBPS: '100', STUDIO_URL: 'http://localhost:8765/index.html', ALERT_NAME: 'test-box' }, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await get('/')).status; i++) await wait(200);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const a = await ctx.newPage(); const errs = []; a.on('pageerror', e => errs.push('admin: ' + e.message));
  const csp = []; a.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) csp.push(m.text()); });

  // --- เข้าสู่ระบบ
  await a.goto(`http://127.0.0.1:${PORT}/admin`);
  ok('asks for the admin code first', await a.isVisible('#login-token') && !(await a.isVisible('#page-home')));
  await a.fill('#login-token', 'wrong'); await a.click('#login-form button[type=submit]');
  ok('wrong code: clear message, stays on login', await until(async () => /ไม่ถูกต้อง/.test(await a.textContent('#login-err')), 5000));
  await a.fill('#login-token', 'boss-token'); await a.click('#login-form button[type=submit]');
  ok('right code: overview shows', await until(() => a.isVisible('#summary h1')), await a.textContent('#summary'));
  ok('everything normal, nobody live', /ทุกอย่างปกติ/.test(await a.textContent('#summary')) && /ยังไม่มีใครไลฟ์/.test(await a.textContent('#lives')));
  ok('capacity card from MAX_STREAMS', /ไลฟ์พร้อมกันได้อีก\s*4 รายการ/.test(await a.textContent('#stats')), await a.textContent('#stats'));
  ok('uplink card from UPLINK_MBPS', /จาก 100 Mbps/.test(await a.textContent('#stats')));
  ok('code is not left in the address bar', !/token/.test(a.url()));
  // ลิงก์แบบเดิม ?token= ยังใช้ได้ และถูกลบออกจากแถบที่อยู่
  const a2 = await ctx.newPage(); await a2.goto(`http://127.0.0.1:${PORT}/admin?token=boss-token#/users`);
  ok('old ?token= link still works and is stripped', await until(() => a2.isVisible('#page-users')) && !/token=/.test(a2.url()), a2.url());
  await a2.close();
  // ลิงก์จากตัวติดตั้ง: /admin#token=… (รหัสหลัง # ไม่ถูกส่งไปเซิร์ฟเวอร์) → เข้าได้เลย และรหัสหายจากแถบที่อยู่
  const a3 = await ctx.newPage(); await a3.goto(`http://127.0.0.1:${PORT}/admin#token=boss-token`);
  ok('installer link /admin#token= signs in and is stripped', await until(() => a3.isVisible('#page-home')) && !/token/.test(a3.url()), a3.url());
  await a3.close();

  // --- เพิ่มคน
  await a.click('#nav a[data-page=users]');
  ok('people page: empty state', await until(async () => /ยังไม่มีใคร/.test(await a.textContent('#users'))));
  await a.click('#add-btn');
  await a.fill('#add-name', 'bad name!'); await a.click('#add-form button[type=submit]');
  ok('bad name rejected in the form', /ชื่อใช้ได้เฉพาะ/.test(await a.textContent('#add-err')));
  await a.fill('#add-name', 'shop-live');
  await a.check('#add-plans input[value=shop]');
  await a.click('#add-form button[type=submit]');
  ok('step 2: invite link shown', await until(() => a.isVisible('#tok-dlg')) && /ส่งลิงก์นี้ให้ shop-live/.test(await a.textContent('#tok-h')));
  const link = (await a.textContent('#tok-link')).trim();
  const gwUrl = (await a.textContent('#tok-url')).trim();
  const tok = new URL(gwUrl).searchParams.get('token');
  ok('invite link opens WebMix with the gateway after #', link.startsWith('http://localhost:8765/index.html#gw=') && decodeURIComponent(link.split('#gw=')[1]) === gwUrl, link);
  ok('users file keeps only the hash', !fs.readFileSync(USERS_FILE, 'utf8').includes(tok) && /"tokenHash"/.test(fs.readFileSync(USERS_FILE, 'utf8')));
  await a.click('#tok-dlg [data-close]');
  ok('user listed with the plan in plain words', await until(async () => /shop-live/.test(await a.textContent('#users')) && /ร้านค้า \/ เพจ · ไลฟ์ได้ครั้งละ 2 รายการ · ส่งได้ 4 ช่อง/.test(await a.textContent('#users'))), await a.textContent('#users'));
  await a.click('#add-btn'); await a.fill('#add-name', 'shop-live'); await a.click('#add-form button[type=submit]');
  ok('duplicate name: message from the server', await until(async () => /มีผู้ใช้ "shop-live" อยู่แล้ว/.test(await a.textContent('#add-err')), 4000));
  await a.click('#add-dlg [data-close]');

  // --- แก้แพ็กเกจ (กำหนดเอง)
  await a.click('[data-act=edit][data-user=shop-live]');
  await a.check('[data-edit] input[value=custom]');
  ok('custom numbers appear only for custom', await a.isVisible('[data-edit] [data-lim=streams]'));
  await a.fill('[data-edit] [data-lim=streams]', '3'); await a.fill('[data-edit] [data-lim=destinations]', '5'); await a.fill('[data-edit] [data-lim=srt]', '0');
  await wait(3500); // ระหว่างแก้ หน้าไม่ถูกวาดใหม่ทับ
  ok('typing survives the 3 s refresh', await a.inputValue('[data-edit] [data-lim=streams]') === '3');
  await a.click('[data-act=save][data-user=shop-live]');
  ok('custom plan saved', await until(async () => /ไลฟ์ได้ครั้งละ 3 รายการ · ส่งได้ 5 ช่องต่อรายการ/.test(await a.textContent('#users'))), await a.textContent('#users'));
  const saved = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users[0].limits;
  ok('limits written to users.json', saved.streams === 3 && saved.destinations === 5 && saved.srt === 0, JSON.stringify(saved));

  // --- ลิงก์เชิญเปิดใน WebMix → ตั้ง Gateway ให้
  const app = await ctx.newPage(); app.on('pageerror', e => errs.push('app: ' + e.message));
  await app.goto('http://localhost:8765/index.html');
  await app.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); localStorage.setItem('webmix:settings', JSON.stringify({ rememberKey: true,
    destinations: [{ id: 'a', platform: 'custom', server: 'rtmp://127.0.0.1:1939/live', key: 'adm', enabled: true }] })); });
  await app.goto(link); await app.reload();
  ok('invite link: WebMix asks before using the server', await until(async () => /ใช้เซิร์ฟเวอร์ไลฟ์นี้/.test(await app.textContent('body')), 6000) && /127\.0\.0\.1:8096/.test(await app.textContent('.modal')));
  ok('invite link removed from the address bar', !/gw=/.test(app.url()), app.url());
  await app.click('.modal-foot button:has-text("ใช้เซิร์ฟเวอร์นี้")');
  ok('gateway set from the link', await until(() => app.evaluate(u => window.webmix.settings.gateway === u, gwUrl), 4000), await app.evaluate(() => window.webmix.settings.gateway));

  // --- ไลฟ์ผ่านรหัสของ shop-live → ผู้ดูแลเห็นและหยุดได้
  const rx = listen('adm', `${S}/admin-ui-1.flv`);
  await wait(400);
  await app.click('[data-action=stream]'); await app.click('.dest-start-all'); await app.click('.pf-desk [data-cd="0"]').catch(() => {}); await app.click('.pf-desk [data-pf=go]').catch(() => {}); await app.keyboard.press('Escape');
  ok('user goes ON AIR through the server', await until(async () => (await app.textContent('#btn-stream')).includes('ON AIR'), 20000));
  await a.click('#nav a[data-page=home]');
  ok('overview: live card for shop-live with its destination', await until(async () => /shop-live/.test(await a.textContent('#lives')) && /LIVE/.test(await a.textContent('#lives')) && /ออกอากาศ/.test(await a.textContent('#lives')), 15000), await a.textContent('#lives'));
  ok('people page marks who is live', await (async () => { await a.click('#nav a[data-page=users]'); const t = await until(async () => /กำลังไลฟ์/.test(await a.textContent('#users')), 5000); await a.click('#nav a[data-page=home]'); return t; })());
  ok('event log: started live', await until(async () => /shop-live เริ่มไลฟ์/.test(await a.textContent('#events')), 5000), await a.textContent('#events'));
  ok('no stream key on the page', !/adm\b/.test((await a.textContent('#lives')).replace(/admin/g, '')) && !(await a.content()).includes(tok));
  await a.click('#lives [data-stop]');
  ok('stopping asks first', await a.isVisible('#confirm-dlg') && /หยุดไลฟ์ของ shop-live/.test(await a.textContent('#cf-h')));
  await a.click('#cf-ok');
  ok('app stops and says the admin stopped it', await until(async () => !(await app.textContent('#btn-stream')).includes('ON AIR') && /ผู้ดูแลเซิร์ฟเวอร์หยุดไลฟ์นี้/.test(await app.textContent('#toasts')), 10000), await app.textContent('#toasts'));
  await wait(3000);
  ok('app does not reconnect on its own', !(await app.textContent('#btn-stream')).includes('ON AIR') && !(await app.evaluate(() => window.webmix.streamer.reconnecting)));
  ok('overview: nobody live again', await until(async () => /ยังไม่มีใครไลฟ์/.test(await a.textContent('#lives')), 6000));
  rx.kill('SIGINT');

  // --- พักการใช้งาน (ย้อนกลับได้) → เปิด
  await a.click('#nav a[data-page=users]');
  await until(() => a.isVisible('[data-act=edit][data-user=shop-live]'));
  await a.click('[data-act=edit][data-user=shop-live]'); await a.click('[data-act=disable][data-user=shop-live]');
  ok('paused: card shows it, toast offers undo', await until(async () => /พักการใช้งาน/.test(await a.textContent('#users')) && await a.isVisible('#toast-undo')));
  ok('paused user cannot connect', (await get(`/ice?token=${encodeURIComponent(tok)}`)).status === 403);
  await a.click('#toast-undo');
  ok('undo re-enables', await until(async () => !/เข้าใช้ไม่ได้จนกว่าจะเปิดใหม่/.test(await a.textContent('#users'))) && (await get(`/ice?token=${encodeURIComponent(tok)}`)).status === 200);

  // --- ทำรหัสใหม่: รหัสเดิมใช้ไม่ได้ทันที
  await a.click('[data-act=edit][data-user=shop-live]'); await a.click('[data-act=token][data-user=shop-live]');
  await a.click('#cf-ok');
  ok('new code dialog', await until(() => a.isVisible('#tok-dlg')) && /รหัสใหม่ของ shop-live/.test(await a.textContent('#tok-h')));
  const tok2 = new URL((await a.textContent('#tok-url')).trim()).searchParams.get('token');
  await a.click('#tok-dlg [data-close]');
  ok('old code stops working, new one works', tok2 !== tok && (await get(`/ice?token=${encodeURIComponent(tok)}`)).status === 403 && (await get(`/ice?token=${encodeURIComponent(tok2)}`)).status === 200);

  // --- ผู้ดูแลร่วม: เปิดหน้า /admin ได้ ลบ/พักตัวเองไม่ได้
  await a.click('#add-btn'); await a.fill('#add-name', 'helper'); await a.click('#add-dlg summary'); await a.check('#add-form [name=manage]'); await a.click('#add-form button[type=submit]');
  await until(() => a.isVisible('#tok-dlg'));
  const helperTok = new URL((await a.textContent('#tok-url')).trim()).searchParams.get('token');
  await a.click('#tok-dlg [data-close]');
  ok('co-admin badge', await until(async () => /helper\s*ผู้ดูแล/.test(await a.textContent('#users'))));
  ok('co-admin can read the status', (await new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: '/admin/status.json', headers: { authorization: 'Bearer ' + helperTok } }, x => res(x.statusCode)))) === 200);
  ok('co-admin cannot remove itself', /ลบตัวเองไม่ได้/.test((await post('/admin/api/users/helper/remove', helperTok)).body));
  ok('normal user cannot use the admin API', (await post('/admin/api/users', tok2, { name: 'x' })).status === 403);
  ok('admin API refuses ?token= in the URL', (await post('/admin/api/drain?token=boss-token', '', { on: true })).status !== 200 && !fs.existsSync(path.join(dir, 'drain')));

  // --- ลบ (ถามก่อน)
  await a.click('[data-act=edit][data-user=helper]'); await a.click('[data-act=disable][data-user=helper]');
  await until(() => a.isVisible('[data-act=remove][data-user=helper]'));
  await a.click('[data-act=remove][data-user=helper]');
  ok('delete asks first', /ลบ helper/.test(await a.textContent('#cf-h')));
  await a.click('#cf-ok');
  ok('deleted', await until(async () => !/helper/.test(await a.textContent('#users'))) && !fs.readFileSync(USERS_FILE, 'utf8').includes('"helper"'));

  // --- พักรับไลฟ์ใหม่ (ก่อนอัปเดต)
  await a.click('#nav a[data-page=home]');
  await a.click('#drain-btn'); await a.click('#cf-ok');
  ok('drain on: banner + file + health line', await until(async () => /พักรับไลฟ์ใหม่อยู่/.test(await a.textContent('#summary'))) && fs.existsSync(path.join(dir, 'drain')) && /draining/.test((await get('/')).body));
  // รหัสถูกทำใหม่ไปแล้ว — ใช้รหัสใหม่
  await app.evaluate(u => { window.webmix.settings.gateway = u; }, gwUrl.replace(tok, tok2));
  await app.keyboard.press('Escape'); await wait(300);
  await app.click('[data-action=stream]'); await app.click('.dest-start-all'); await app.click('.pf-desk [data-cd="0"]').catch(() => {}); await app.click('.pf-desk [data-pf=go]').catch(() => {}); await app.keyboard.press('Escape');
  ok('new live refused while draining', await until(async () => /กำลังอัปเดต/.test(await app.textContent('#toasts')), 10000), await app.textContent('#toasts'));
  await a.click('#drain-btn');
  ok('drain off again', await until(async () => !fs.existsSync(path.join(dir, 'drain')) && /ทุกอย่างปกติ/.test(await a.textContent('#summary'))));
  ok('event log lists the admin actions', await until(async () => { const t = await a.textContent('#events'); return /ผู้ดูแลหยุดไลฟ์ของ shop-live/.test(t) && /ทำรหัสใหม่ให้ shop-live/.test(t) && /ลบผู้ใช้ helper/.test(t) && /เปิดรับไลฟ์ใหม่/.test(t); }, 5000), await a.textContent('#events'));

  // --- มือถือ: ไม่มีแถบเลื่อนแนวนอน
  await a.setViewportSize({ width: 390, height: 844 });
  for (const pg of ['home', 'users']) { await a.click(`#nav a[data-page=${pg}]`); await wait(300); }
  ok('phone width: no horizontal scroll', await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), String(await a.evaluate(() => document.documentElement.scrollWidth)));
  // ออกจากระบบ: รหัสหายจากแท็บ
  await a.click('#logout');
  ok('log out clears the code', await a.isVisible('#login-token') && (await a.evaluate(() => sessionStorage.getItem('webmix-admin-token'))) === null);

  ok('no CSP violations', csp.length === 0, csp.slice(0, 2).join(' | '));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  gw.kill('SIGKILL');
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
