#!/usr/bin/env node
// ชุดทดสอบอัตโนมัติของ WebMix
//   cd tests && npm ci && npm test            รันทุกชุด
//   npm test -- switcher srt-input            รันเฉพาะบางชุด
// ต้องมี ffmpeg (พร้อม libsrt) และ Chromium ของ Playwright
// ตัวทดสอบจะเปิด: เว็บเซิร์ฟเวอร์ :8765, PeerJS :9900, Stream Gateway :8089 แล้วรันแต่ละชุดตามลำดับ
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { ROOT, WORK } = require('./lib');

const ALL = ['switcher', 'multistream', 'mobile', 'srt-output', 'srt-input', 'uhd-4k', 'reconnect', 'record-disk', 'audio-fx', 'show', 'gateway-admin', 'overlay', 'gpu', 'guest', 'multiview', 'graphics', 'playlist', 'desktop', 'wcrec', 'onboarding', 'easy-ui', 'scenes', 'rec-backup', 'vertical', 'color',
  'transitions', 'replay', 'gate', 'midi', 'abr', 'slides', 'viz', 'update', 'recovery', 'macro', 'procam', 'layoutdrag', 'audiosrc', 'duck', 'chat', 'netvideo', 'captions'];
const selected = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const SUITE_TIMEOUT = 6 * 60 * 1000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.wav': 'audio/wav' };

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
}

function makeFixtures() {
  fs.mkdirSync(WORK, { recursive: true });
  const f = n => path.join(WORK, n);
  if (!fs.existsSync(f('clip.webm'))) ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libvpx', '-b:v', '800k', '-c:a', 'libopus', '-shortest', f('clip.webm')]);
  if (!fs.existsSync(f('logo.png'))) ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=400x400', '-frames:v', '1', f('logo.png')]);
  if (!fs.existsSync(f('green.png'))) ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x00ff00:s=640x360', '-vf', 'drawbox=x=270:y=130:w=100:h=100:color=red:t=fill', '-frames:v', '1', f('green.png')]);
  // Stinger: ม่วงเต็มจอช่วง 0.7–1.3 วินาที นอกนั้นโปร่งใส (VP9 alpha)
  if (!fs.existsSync(f('sting.webm'))) ffmpeg(['-f', 'lavfi', '-i', "color=c=0xff00ff:s=320x180:r=30:d=2,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(between(T,0.7,1.3),255,0)'", '-c:v', 'libvpx-vp9', '-auto-alt-ref', '0', '-b:v', '300k', f('sting.webm')]);
  // สไลด์ PDF 3 หน้า (16:9): แดง เขียว น้ำเงิน — เขียนไฟล์ PDF เองทีละไบต์ (ไม่ต้องพึ่งโปรแกรมอื่น)
  if (!fs.existsSync(f('slides.pdf'))) {
    const colors = ['1 0 0', '0 1 0', '0 0 1'];
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${colors.map((c, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${colors.length} >>`];
    colors.forEach((c, i) => {
      const stream = `${c} rg 0 0 1600 900 re f`;
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1600 900] /Contents ${4 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    let pdf = '%PDF-1.4\n';
    const offs = objs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    fs.writeFileSync(f('slides.pdf'), pdf);
  }
  // แหล่งเสียง: เพลงสองไฟล์ (−6 dBFS) และเสียงเอฟเฟกต์สั้น
  for (const [name, hz, sec] of [['song1', 440, 3], ['song2', 660, 3], ['clap', 880, 0.6]]) {
    if (!fs.existsSync(f(name + '.wav'))) ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}:sample_rate=48000,volume=0.5`, '-ac', '2', f(name + '.wav')]);
  }
  // ไลบรารี NDI / OMT จำลอง (ส่ง-รับในโปรเซสเดียว) ให้ Gateway Rust ใช้แทนของจริง
  const mockSrc = path.join(__dirname, 'fixtures', 'netvideo-mock.c');
  if (!fs.existsSync(f('libnetvideo-mock.so')) || fs.statSync(f('libnetvideo-mock.so')).mtimeMs < fs.statSync(mockSrc).mtimeMs) spawnSync('cc', ['-shared', '-fPIC', '-O2', '-o', f('libnetvideo-mock.so'), mockSrc, '-lpthread'], { stdio: 'inherit' });
  if (!fs.existsSync(f('loud.webm'))) ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000,volume=7', '-t', '20', '-c:v', 'libvpx', '-b:v', '500k', '-c:a', 'libopus', '-b:a', '128k', '-shortest', f('loud.webm')]);
}

function staticServer(port) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

function waitHttp(url, ms = 15000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => http.get(url, res => { res.resume(); resolve(); }).on('error', () => Date.now() > until ? reject(new Error('timeout ' + url)) : setTimeout(tick, 300));
    tick();
  });
}

function runSuite(name) {
  return new Promise(resolve => {
    const started = Date.now();
    // detached = กลุ่มโปรเซสของตัวเอง เพื่อปิด ffmpeg ที่ชุดทดสอบเปิดค้างไว้ได้หมด
    const child = spawn(process.execPath, [path.join(__dirname, 'suites', name + '.js')], { env: { ...process.env, WORK, LANG: 'C.UTF-8' }, detached: true });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const timer = setTimeout(() => { output += '\nCRASH suite timed out'; try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} }, SUITE_TIMEOUT);
    child.on('close', code => {
      clearTimeout(timer);
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
      const lines = output.split('\n').filter(l => /^(PASS|FAIL|CRASH)/.test(l));
      const pass = lines.filter(l => l.startsWith('PASS')).length;
      const fail = lines.filter(l => !l.startsWith('PASS'));
      const bad = fail.length > 0 || code !== 0 || pass === 0;
      console.log(`\n${bad ? '✗' : '✓'} ${name}  ${pass} passed${fail.length ? `, ${fail.length} failed` : ''}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
      for (const l of bad || process.env.VERBOSE ? output.split('\n').filter(Boolean) : []) console.log('    ' + l);
      resolve(!bad);
    });
  });
}

(async () => {
  makeFixtures();
  const web = await staticServer(8765);
  const { PeerServer } = require('peer');
  const peer = PeerServer({ port: 9900, host: '127.0.0.1', path: '/' });
  // GATEWAY_BIN=desktop/target/release/webmix-gateway → ทดสอบ Gateway เวอร์ชัน Rust (ของแอปเดสก์ท็อป) แทนเวอร์ชัน Node
  const gwEnv = { ...process.env, PORT: '8089', STREAM_TOKEN: 'abc' };
  const mock = path.join(WORK, 'libnetvideo-mock.so');
  if (fs.existsSync(mock)) Object.assign(gwEnv, { WEBMIX_NDI_LIB: mock, WEBMIX_OMT_LIB: mock });
  const gateway = process.env.GATEWAY_BIN
    ? spawn(path.resolve(ROOT, process.env.GATEWAY_BIN), [], { env: gwEnv, stdio: process.env.VERBOSE ? 'inherit' : 'ignore' })
    : spawn(process.execPath, ['stream-gateway.js'], { cwd: path.join(ROOT, 'server'), env: gwEnv, stdio: 'ignore' });
  await waitHttp('http://127.0.0.1:8089/');
  await waitHttp('http://127.0.0.1:9900/');

  let failed = 0;
  for (const name of selected) if (!(await runSuite(name))) failed++;

  gateway.kill('SIGKILL');
  web.close();
  try { peer._server && peer._server.close(); } catch (e) {}
  console.log(`\n${failed ? `✗ ${failed} of ${selected.length} suites failed` : `✓ all ${selected.length} suites passed`}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
