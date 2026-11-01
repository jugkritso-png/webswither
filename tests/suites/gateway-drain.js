// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// อัปเดตเซิร์ฟเวอร์โดยไม่ตัดไลฟ์: มีไฟล์ drain → ไม่รับสตรีม / SRT ใหม่ (ข้อความภาษาไทย) แต่ไลฟ์เดิมไปต่อ
// ไลฟ์ที่หลุดแล้วต่อกลับภายใน 2 นาทียังเข้าได้ · หน้า / และ /admin/status.json บอกสถานะ · Gateway ที่เพิ่งเปิดลบไฟล์ drain เอง
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { ROOT } = require('../lib');
const WebSocket = require(path.join(ROOT, 'server/node_modules/ws'));
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8093;
const USERS_FILE = path.join(S, 'drain-users.json'), DRAIN = path.join(S, 'drain');
const env = { ...process.env, USERS_FILE, PORT: String(PORT), STREAM_TOKEN: 'admintok' };
const cli = (...a) => spawnSync(process.execPath, ['stream-gateway.js', 'user', ...a], { cwd: path.join(ROOT, 'server'), env, encoding: 'utf8' });
const tokenOf = out => (/Token: (\S+)/.exec(out) || [])[1];
const get = p => new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', e => res({ status: 0, body: e.message })));
function connect(pathname, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${pathname}?token=${encodeURIComponent(token)}`);
  ws.msgs = []; ws.closed = null;
  ws.on('message', (d, bin) => { if (!bin) try { ws.msgs.push(JSON.parse(String(d))); } catch (e) {} });
  ws.on('close', (code, reason) => { ws.closed = { code, reason: String(reason) }; });
  ws.on('error', () => {});
  ws.ready = new Promise(r => { ws.on('open', r); ws.on('close', r); });
  return ws;
}
const errorMsg = ws => (ws.msgs.find(m => m.type === 'error') || {}).message || '';
const startGw = () => { const g = spawn(process.execPath, ['stream-gateway.js'], { cwd: path.join(ROOT, 'server'), env, stdio: 'ignore' }); return g; };
const up = async () => { for (let i = 0; i < 40; i++) { if ((await get('/')).status === 200) return true; await wait(150); } return false; };
(async () => {
  for (const f of [USERS_FILE, DRAIN]) try { fs.unlinkSync(f); } catch (e) {}
  const bob = tokenOf(cli('add', 'bob').stdout), carol = tokenOf(cli('add', 'carol').stdout);
  fs.writeFileSync(DRAIN, '');   // ไฟล์ค้างจากการอัปเดตครั้งก่อน
  let gw = startGw(); await up();
  ok('a freshly started gateway clears a leftover drain file', !fs.existsSync(DRAIN));

  const b1 = connect('/', bob); await b1.ready; b1.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(800);
  ok('normal: stream starts', !errorMsg(b1) && b1.readyState === WebSocket.OPEN, errorMsg(b1));

  fs.writeFileSync(DRAIN, '');
  ok('health page says draining', /draining/.test((await get('/')).body), (await get('/')).body);
  ok('admin status reports draining', JSON.parse((await get('/admin/status.json?token=admintok')).body).draining === true);
  const c1 = connect('/', carol); await c1.ready; c1.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(600);
  ok('draining: a new stream is turned away with a Thai message', /กำลังอัปเดต/.test(errorMsg(c1)) && c1.closed, JSON.stringify({ err: errorMsg(c1), closed: c1.closed }));
  const sr = connect('/srt-in', carol); await sr.ready; sr.send(JSON.stringify({ type: 'open', mode: 'listener', port: 9000 })); await wait(400);
  ok('draining: a new SRT input is turned away', /กำลังอัปเดต/.test(errorMsg(sr)), errorMsg(sr));
  ok('draining: the stream already live keeps going', b1.readyState === WebSocket.OPEN && /1 streams/.test((await get('/')).body));

  // หลุดแล้วต่อกลับ (เน็ตสะดุด) ระหว่าง drain → ยังเข้าได้
  b1.terminate(); await wait(500);
  const b2 = connect('/', bob); await b2.ready; b2.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(600);
  ok('draining: a stream that dropped reconnects within 2 minutes', !errorMsg(b2) && b2.readyState === WebSocket.OPEN, errorMsg(b2));
  b2.close(1000); await wait(400);
  ok('no streams left → health shows 0 (install.sh waits for this)', /0 streams, 0 SRT inputs\) draining/.test((await get('/')).body), (await get('/')).body);

  // อัปเดตเสร็จ: เปิด Gateway ใหม่ → ไฟล์ drain หาย รับไลฟ์ใหม่ได้
  gw.kill('SIGKILL'); await wait(300); gw = startGw(); await up();
  const c2 = connect('/', carol); await c2.ready; c2.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(600);
  ok('after the restart new streams are accepted again', !fs.existsSync(DRAIN) && !errorMsg(c2) && c2.readyState === WebSocket.OPEN, errorMsg(c2));
  c2.close(1000);
  gw.kill('SIGKILL');
  console.log(results.join('\n'));
  process.exit(0);
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.stack); process.exit(1); });
