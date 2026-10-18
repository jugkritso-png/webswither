// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Gateway สำหรับหลายผู้ใช้: token แยกคน, โควตา, จำกัดสตรีมทั้งเซิร์ฟเวอร์, กันเดารหัส, หน้า /admin, /metrics และการแจ้งเตือน
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { ROOT, listenRtmp } = require('../lib');
const WebSocket = require(path.join(ROOT, 'server/node_modules/ws'));
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8091, HOOK = 8092;
const USERS_FILE = path.join(S, 'gw-users.json');
const env = { ...process.env, USERS_FILE, PORT: String(PORT), STREAM_TOKEN: 'admintok', MAX_STREAMS: '2', TRUST_PROXY: '1',
  ALERT_WEBHOOK: `http://127.0.0.1:${HOOK}/hook`, ALERT_AFTER: '3', ALERT_NAME: 'test-gw' };
const cli = (...args) => spawnSync(process.execPath, ['stream-gateway.js', 'user', ...args], { cwd: path.join(ROOT, 'server'), env, encoding: 'utf8' });
const tokenOf = out => (/Token: (\S+)/.exec(out) || [])[1];

// เปิด WebSocket แล้วเก็บข้อความ/สถานะการปิดไว้ตรวจ
function connect(pathname, token, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${pathname}${pathname.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`, { headers });
  ws.msgs = []; ws.closed = null;
  ws.on('message', (d, bin) => { if (!bin) try { ws.msgs.push(JSON.parse(String(d))); } catch (e) {} });
  ws.on('close', (code, reason) => { ws.closed = { code, reason: String(reason) }; });
  ws.on('error', () => {});
  ws.ready = new Promise(r => { ws.on('open', r); ws.on('close', r); });
  return ws;
}
const get = (p, headers = {}) => new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: p, headers }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', e => res({ status: 0, body: e.message })));
const errorMsg = ws => (ws.msgs.find(m => m.type === 'error') || {}).message || '';
const destStatus = (ws, id) => { for (let i = ws.msgs.length - 1; i >= 0; i--) { const d = (ws.msgs[i].destinations || []).find(x => x.id === id); if (d) return d; } return null; };

(async () => {
  try { fs.unlinkSync(USERS_FILE); } catch (e) {}
  const hooks = [];
  const hookServer = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { try { hooks.push(JSON.parse(b)); } catch (e) {} res.end('ok'); }); }).listen(HOOK);
  const procs = [];

  // --- CLI: users with their own tokens and quotas
  const add = cli('add', 'alice', '--streams', '1', '--destinations', '1', '--srt', '0');
  const alice = tokenOf(add.stdout);
  ok('user add prints a token', add.status === 0 && /^[\w-]{20,}$/.test(alice || ''), add.stderr);
  const bob = tokenOf(cli('add', 'bob').stdout);
  const file = fs.readFileSync(USERS_FILE, 'utf8');
  ok('users file stores only token hashes', !file.includes(alice) && !file.includes(bob) && /"tokenHash": "[0-9a-f]{64}"/.test(file));
  ok('users file is private (0600)', (fs.statSync(USERS_FILE).mode & 0o777) === 0o600, (fs.statSync(USERS_FILE).mode & 0o777).toString(8));
  ok('duplicate user rejected', cli('add', 'alice').status === 1);
  ok('bad user name rejected', cli('add', '../x').status === 1);
  ok('user list', /alice\s+1\s+1\s+0/.test(cli('list').stdout) && /bob\s+1\s+6\s+2/.test(cli('list').stdout), cli('list').stdout);

  const gw = spawn(process.execPath, ['stream-gateway.js'], { cwd: path.join(ROOT, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let gwLog = ''; gw.stdout.on('data', d => { gwLog += d; }); gw.stderr.on('data', d => { gwLog += d; });
  procs.push(gw);
  for (let i = 0; i < 50 && !(await get('/')).status; i++) await wait(200);
  ok('health page without token', /OK/.test((await get('/')).body));

  // --- tokens
  let w = connect('/', 'wrong'); await w.ready; await wait(200);
  ok('wrong token rejected', w.closed && w.closed.code === 1008 && w.closed.reason === 'invalid token', JSON.stringify(w.closed));
  ok('/ice needs a valid token', (await get('/ice?token=nope')).status === 403 && (await get(`/ice?token=${alice}`)).status === 200);

  // --- per-user quotas
  const a1 = connect('/', alice); await a1.ready;
  a1.send(JSON.stringify({ type: 'start', destinations: [{ id: 'd1', name: 'Dead end', url: 'rtmp://127.0.0.1:1/live/x' }, { id: 'd2', name: 'Second', url: 'rtmp://127.0.0.1:1/live/y' }] }));
  await wait(800);
  ok('destination quota per user', /เกินจำนวนปลายทางสูงสุด \(1\)/.test(destStatus(a1, 'd2')?.message || ''), JSON.stringify(destStatus(a1, 'd2')));
  const a2 = connect('/', alice); await a2.ready;
  a2.send(JSON.stringify({ type: 'start', destinations: [{ id: 'z', name: 'Z', url: 'rtmp://127.0.0.1:1/live/z' }] }));
  await wait(600);
  ok('stream quota per user (Thai message + close)', /สตรีมพร้อมกันได้สูงสุด 1/.test(errorMsg(a2)) && a2.closed?.code === 1008, errorMsg(a2));
  ok('first stream of the user still running', a1.readyState === WebSocket.OPEN);
  const srt = connect('/srt-in', alice); await srt.ready;
  srt.send(JSON.stringify({ type: 'open', mode: 'listener', port: 9005, latency: 500 }));
  await wait(500);
  ok('SRT input quota per user', /รับ SRT ได้พร้อมกันสูงสุด 0/.test(errorMsg(srt)), errorMsg(srt));

  // --- server-wide stream limit (MAX_STREAMS=2): alice + admin = full
  const adm = connect('/', 'admintok'); await adm.ready;
  adm.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(400);
  const b1 = connect('/', bob); await b1.ready;
  b1.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(600);
  ok('server-wide stream limit', /เต็มจำนวน \(2 สตรีม\)/.test(errorMsg(b1)) && b1.closed?.code === 1008, errorMsg(b1));
  adm.close(1000); await wait(400);
  const b2 = connect('/', bob); await b2.ready;
  b2.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(600);
  ok('slot frees when a stream stops', b2.readyState === WebSocket.OPEN && !errorMsg(b2));

  // --- admin page, status and metrics
  ok('/admin refuses user tokens', (await get(`/admin?token=${alice}`)).status === 403 && (await get('/admin')).status === 403);
  const page = await get('/admin?token=admintok');
  ok('/admin page for the admin', page.status === 200 && /WebMix Stream Gateway/.test(page.body));
  const st = JSON.parse((await get('/admin/status.json?token=admintok')).body);
  const aliceSession = st.sessions.find(x => x.user === 'alice');
  ok('status lists sessions per user', aliceSession && aliceSession.destinations.some(d => d.name === 'Dead end') && st.sessions.some(x => x.user === 'bob'), JSON.stringify(st.sessions.map(x => x.user)));
  ok('status never exposes stream URLs', !JSON.stringify(st).includes('rtmp://'));
  const m = await get('/metrics', { authorization: 'Bearer admintok' });
  ok('/metrics (Prometheus)', m.status === 200 && /webmix_streams 2/.test(m.body) && /webmix_destinations\{state="error"\}/.test(m.body), (m.body.match(/webmix_streams \d+/) || [])[0]);
  ok('/metrics needs a token', (await get('/metrics')).status === 403);

  // --- a stale connection of the same user is replaced (network drop without close)
  await wait(5500);
  const a3 = connect('/', alice); await a3.ready; // a1 has been silent for > 5 s
  a3.send(JSON.stringify({ type: 'start', destinations: [] })); await wait(800);
  ok('silent old session replaced by reconnect', a3.readyState === WebSocket.OPEN && !errorMsg(a3) && a1.closed, JSON.stringify({ err: errorMsg(a3), a1: a1.closed }));

  // --- disabled user / rotated token take effect without restart
  cli('disable', 'bob'); await wait(100);
  w = connect('/', bob); await w.ready; await wait(200);
  ok('disabled user rejected', w.closed?.reason === 'invalid token');
  const bobNew = tokenOf(cli('token', 'alice').stdout);
  w = connect('/', alice); await w.ready; await wait(200);
  ok('rotated token: old one stops working', w.closed?.reason === 'invalid token');
  w = connect('/', bobNew); await w.ready; await wait(200);
  ok('rotated token: new one works', w.readyState === WebSocket.OPEN); w.close(1000);

  // --- live stream: destination down/recovered alerts, then the stream drops without stopping → alert after 30 s
  for (const ws of [a3, b2]) ws.close(1000);
  await wait(500);
  let rx = listenRtmp(1951, 'drop', path.join(S, 'drop.flv')); procs.push(rx); await wait(500);
  const live = connect('/', 'admintok'); await live.ready;
  live.send(JSON.stringify({ type: 'start', destinations: [{ id: 'yt', name: 'YouTube', url: 'rtmp://127.0.0.1:1951/live/drop' }] }));
  const src = spawn('ffmpeg', ['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine', '-t', '120', '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '800k', '-c:a', 'libopus', '-f', 'webm', 'pipe:1']);
  procs.push(src);
  src.stdout.on('data', d => { if (live.readyState === WebSocket.OPEN) live.send(d); });
  for (let i = 0; i < 40 && destStatus(live, 'yt')?.state !== 'live'; i++) await wait(500);
  ok('admin stream goes live', destStatus(live, 'yt')?.state === 'live', JSON.stringify(destStatus(live, 'yt')));
  rx.kill('SIGKILL'); // the platform goes away
  for (let i = 0; i < 30 && !hooks.some(h => /ปลายทาง YouTube ของ admin หลุด/.test(h.text)); i++) await wait(500);
  const destAlert = hooks.find(h => /ปลายทาง YouTube ของ admin หลุด/.test(h.text));
  ok('alert: destination down (after ALERT_AFTER)', !!destAlert, JSON.stringify(hooks.map(h => h.text)));
  ok('alert payload works for Slack and Discord', destAlert && destAlert.text === destAlert.content && /\[test-gw\]/.test(destAlert.text));
  rx = listenRtmp(1951, 'drop', path.join(S, 'drop2.flv')); procs.push(rx);
  for (let i = 0; i < 40 && !hooks.some(h => /YouTube ของ admin กลับมาออนไลน์/.test(h.text)); i++) await wait(500);
  ok('alert: destination recovered', hooks.some(h => /🟢.*YouTube ของ admin กลับมาออนไลน์/.test(h.text)), JSON.stringify(hooks.map(h => h.text)));
  ok('stream live again before the drop', destStatus(live, 'yt')?.state === 'live', JSON.stringify(destStatus(live, 'yt')));
  live.terminate(); src.kill('SIGKILL');
  await wait(3000);
  ok('no drop alert during the 30 s grace period', !hooks.some(h => /ขาดการเชื่อมต่อจาก WebMix/.test(h.text)));
  await wait(29000);
  ok('alert: live stream dropped and did not come back', hooks.some(h => /สตรีมของ admin .* ขาดการเชื่อมต่อจาก WebMix/.test(h.text)), JSON.stringify(hooks.map(h => h.text)));

  // --- brute force from one IP (behind proxy: X-Forwarded-For) → blocked + alert; other IPs unaffected
  for (let i = 0; i < 10; i++) { const x = connect('/', 'guess' + i, { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }); await x.ready; }
  await wait(300);
  w = connect('/', 'admintok', { 'x-forwarded-for': '203.0.113.9' }); await w.ready; await wait(200);
  ok('IP blocked after 10 wrong tokens (even with the right one)', w.closed?.reason === 'too many attempts', JSON.stringify(w.closed));
  ok('alert: IP blocked', hooks.some(h => /บล็อก IP 203\.0\.113\.9/.test(h.text)));
  w = connect('/', 'admintok', { 'x-forwarded-for': '203.0.113.10' }); await w.ready; await wait(200);
  ok('other IPs still work', w.readyState === WebSocket.OPEN); w.close(1000);
  ok('client-supplied X-Forwarded-For prefix ignored (uses the proxy-added address)', !hooks.some(h => /198\.51\.100\.1/.test(h.text)));

  for (const ws of [a2, srt]) try { ws.close(1000); } catch (e) {}
  for (const p of procs) try { p.kill('SIGKILL'); } catch (e) {}
  hookServer.close();
  if (results.some(r => r.startsWith('FAIL'))) console.log(gwLog.split('\n').slice(-30).join('\n'));
  console.log(results.join('\n'));
  process.exit(0);
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.stack); process.exit(1); });
