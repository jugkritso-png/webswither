// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const { spawnSync } = require('child_process');
const { WebmSeekFix } = require('../../assets/webm-seek.js');
const duration = f => parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
const seekFrame = (f, t) => spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' }).status === 0;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  // 1) OPFS: written to disk during recording, downloaded at stop
  const before = await p.evaluate(async () => (await navigator.storage.estimate()).usage);
  await p.click('#btn-rec'); await p.waitForTimeout(4000);
  const grown = await p.evaluate(async b0 => (await navigator.storage.estimate()).usage - b0, before);
  const during = await p.evaluate(() => ({ kind: window.webmix.rec.sink.kind, chunks: window.webmix.rec.sink.chunks }));
  ok('records to disk (OPFS), nothing kept in RAM', during.kind === 'opfs' && during.chunks === undefined, JSON.stringify(during));
  ok('status bar shows destination', /→ ดิสก์/.test(await p.textContent('#st-rec')), await p.textContent('#st-rec'));
  ok('disk usage grows while recording', grown > 200000, `${grown} bytes on disk after 4 s`);
  const dl = p.waitForEvent('download'); await p.click('#btn-rec'); const d = await dl; await d.saveAs(S + '/opfs-rec.webm');
  ok('download at stop', fs.statSync(S + '/opfs-rec.webm').size > 10000, `${fs.statSync(S + '/opfs-rec.webm').size} bytes`);
  // 2) chosen folder: file is written straight into it, no download
  await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.webmix.useRecFolder(await root.getDirectoryHandle('MyRecordings', { create: true })); });
  let downloaded = false; p.on('download', () => { downloaded = true; });
  await p.click('#btn-rec'); await p.waitForTimeout(4000);
  ok('status shows folder', /โฟลเดอร์ MyRecordings/.test(await p.textContent('#st-rec')), await p.textContent('#st-rec'));
  await p.click('#btn-rec'); await p.waitForTimeout(1500);
  const saved = await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('MyRecordings');
    for await (const [name, h] of dir.entries()) { const f = await h.getFile(); const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return { name, size: f.size, b64: btoa(bin) }; }
    return null;
  });
  ok('file written into the chosen folder', saved && saved.size > 10000 && /^WebMix-.*\.webm$/.test(saved.name), saved && `${saved.name} ${saved.size} bytes`);
  ok('no download when saving to a folder', !downloaded);
  if (saved) fs.writeFileSync(S + '/folder-rec.webm', Buffer.from(saved.b64, 'base64'));
  // 3) seekable files: duration + cues written at stop
  for (const f of ['opfs-rec.webm', 'folder-rec.webm']) {
    const dur = duration(S + '/' + f);
    ok(`${f} has a duration`, dur > 3 && dur < 6, `${dur} s`);
    ok(`${f} seeks to the middle`, seekFrame(S + '/' + f, (dur / 2).toFixed(2)));
  }
  const lastFix = await p.evaluate(() => window.webmix.rec.lastFix);
  ok('cue index written', lastFix && lastFix.cues >= 1, JSON.stringify(lastFix));
  // the browser itself sees a finite duration and can jump to a position
  const play = await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('MyRecordings');
    let file; for await (const [, h] of dir.entries()) file = await h.getFile();
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('load')); });
    const d = v.duration; v.currentTime = d * 0.6;
    await new Promise(res => { v.onseeked = res; setTimeout(res, 5000); });
    return { duration: d, at: v.currentTime };
  });
  ok('browser reads the duration (not Infinity)', isFinite(play.duration) && play.duration > 3, JSON.stringify(play));
  ok('browser seeks within the recording', Math.abs(play.at - play.duration * 0.6) < 0.5, JSON.stringify(play));
  // 4) the fixer gives identical output whatever the chunk boundaries (raw MediaRecorder file)
  const raw = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
    let n = 0; const t = setInterval(() => { g.fillStyle = `hsl(${n++ * 7},80%,50%)`; g.fillRect(0, 0, 320, 180); }, 33);
    const ac = new AudioContext(); const osc = ac.createOscillator(); const dst = ac.createMediaStreamDestination(); osc.connect(dst); osc.start();
    const r = new MediaRecorder(new MediaStream([...c.captureStream(30).getTracks(), ...dst.stream.getTracks()]), { mimeType: 'video/webm;codecs=vp8,opus' });
    const parts = []; r.ondataavailable = e => parts.push(e.data); r.start(500);
    await new Promise(res => setTimeout(res, 3000)); r.stop(); await new Promise(res => { r.onstop = res; }); clearInterval(t);
    const buf = new Uint8Array(await new Blob(parts).arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(bin);
  });
  const src = Buffer.from(raw, 'base64');
  const fixWith = sizes => {
    const fx = new WebmSeekFix(); const parts = []; let i = 0, k = 0;
    while (i < src.length) { const n = sizes[k++ % sizes.length]; parts.push(...fx.push(src.subarray(i, i + n))); i += n; }
    const total = parts.reduce((a, x) => a + x.length, 0); const r = fx.finish(total);
    const buf = Buffer.concat([...parts.map(x => Buffer.from(x)), Buffer.from(r ? r.tail : [])]);
    if (r) for (const pt of r.patches) Buffer.from(pt.data).copy(buf, pt.position);
    return buf;
  };
  const outs = [[1], [7, 13, 1], [4096], [src.length]].map(fixWith);
  ok('fixer output independent of chunking', outs.every(o => o.equals(outs[0])), outs.map(o => o.length).join(','));
  fs.writeFileSync(S + '/fixed-raw.webm', outs[0]);
  ok('fixed raw file has a duration', duration(S + '/fixed-raw.webm') > 2.5, `${duration(S + '/fixed-raw.webm')} s`);
  ok('non-WebM input passes through unchanged', (() => { const fx = new WebmSeekFix(); const mp4 = Buffer.from('000000186674797069736f6d', 'hex'); const o = Buffer.concat(fx.push(mp4).map(x => Buffer.from(x))); return o.equals(mp4) && fx.finish(o.length) === null; })());
  ok('toast confirms folder save', /ลงโฟลเดอร์ “MyRecordings”/.test(await p.textContent('#toasts')));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
