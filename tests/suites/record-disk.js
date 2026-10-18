// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
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
  ok('toast confirms folder save', /ลงโฟลเดอร์ “MyRecordings”/.test(await p.textContent('#toasts')));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
