// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// บันทึกแยกทุกกล้อง (ISO) และบันทึกสำรองอัตโนมัติระหว่างไลฟ์
const { listenRtmp } = require('../lib');
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const { spawnSync } = require('child_process');
const duration = f => parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  // กล้อง (อุปกรณ์จำลองของ Chromium)
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("กล้อง")');
  await p.waitForSelector('.modal-foot .btn-primary'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1500);
  ok('camera added', await p.evaluate(() => window.webmix.inputs.some(i => i.type === 'camera' && i.status === 'live')));
  // ตั้งค่า: เปิด ISO ผ่านหน้าตั้งค่า
  await p.click('[data-action=settings]');
  await p.check('.modal input[name=isoRec]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  ok('ISO setting saved', await p.evaluate(() => window.webmix.settings.isoRec === true));
  await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.webmix.useRecFolder(await root.getDirectoryHandle('ISO', { create: true })); });
  await p.click('#btn-rec'); await p.waitForTimeout(4500);
  ok('status bar shows ISO recorders', /ISO 1/.test(await p.textContent('#st-rec')), await p.textContent('#st-rec'));
  await p.click('#btn-rec'); await p.waitForTimeout(2500);
  const files = await p.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ISO'); const out = [];
    for await (const [name, h] of dir.entries()) { const f = await h.getFile(); const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); out.push({ name, size: f.size, b64: btoa(bin) }); }
    return out;
  });
  const prog = files.find(f => !/-ISO\d/.test(f.name)), cam = files.find(f => /-ISO1-/.test(f.name));
  ok('program file and one ISO file per camera', files.length === 2 && prog && cam, files.map(f => `${f.name} ${f.size}`).join(', '));
  ok('ISO file shares the program timestamp', prog && cam && cam.name.startsWith(prog.name.replace(/\.\w+$/, '')), `${prog && prog.name} / ${cam && cam.name}`);
  if (cam) {
    fs.writeFileSync(S + '/iso.webm', Buffer.from(cam.b64, 'base64'));
    const d = duration(S + '/iso.webm');
    ok('ISO file is a playable, seekable recording', d > 3 && d < 7, `${d} s`);
  }
  // บันทึกสำรองอัตโนมัติ: เริ่มไลฟ์ → เริ่มบันทึก · หยุดไลฟ์ → หยุดบันทึก
  const rx = listenRtmp(1981, 'bk', `${S}/backup-live.flv`);
  await p.evaluate(() => { const s = window.webmix.settings; s.isoRec = false; s.autoRec = true; s.gateway = 'ws://127.0.0.1:8089/?token=abc';
    s.destinations.splice(0, s.destinations.length, { id: 'bk', platform: 'custom', server: 'rtmp://127.0.0.1:1981/live', key: 'bk', passphrase: '', latency: 500, enabled: true }); });
  await p.waitForTimeout(400);
  await p.click('#btn-stream'); await p.click('.dest-start-all');
  let live = false;
  for (let i = 0; i < 40 && !live; i++) { await p.waitForTimeout(400); live = await p.evaluate(() => window.webmix.streamer.dests.get('bk')?.state === 'live'); }
  ok('stream goes live', live);
  ok('backup recording started with the stream', await p.evaluate(() => window.webmix.rec.active && window.webmix.rec.auto));
  ok('status bar marks it as automatic', /สำรองอัตโนมัติ/.test(await p.textContent('#st-rec')), await p.textContent('#st-rec'));
  await p.waitForTimeout(2000);
  await p.click('.dest-stop-all'); await p.click('.modal-foot .btn-danger >> nth=-1');
  let stopped = false;
  for (let i = 0; i < 20 && !stopped; i++) { await p.waitForTimeout(300); stopped = await p.evaluate(() => !window.webmix.rec.active && !window.webmix.streamer.ws); }
  ok('stopping the stream stops the backup recording', stopped);
  rx.kill('SIGINT');
  // บันทึกเองก่อนไลฟ์: หยุดไลฟ์แล้วยังบันทึกต่อ (ไม่ใช่การบันทึกสำรอง)
  await p.keyboard.press('Escape');
  await p.click('#btn-rec'); await p.waitForTimeout(800);
  const rx2 = listenRtmp(1982, 'bk2', `${S}/backup-live2.flv`);
  await p.evaluate(() => { const d = window.webmix.settings.destinations[0]; d.server = 'rtmp://127.0.0.1:1982/live'; d.key = 'bk2'; });
  await p.click('#btn-stream'); await p.click('.dest-start-all');
  live = false;
  for (let i = 0; i < 40 && !live; i++) { await p.waitForTimeout(400); live = await p.evaluate(() => window.webmix.streamer.dests.get('bk')?.state === 'live'); }
  await p.click('.dest-stop-all'); await p.click('.modal-foot .btn-danger >> nth=-1'); await p.waitForTimeout(1500);
  ok('a recording started by hand keeps going after the stream stops', await p.evaluate(() => window.webmix.rec.active && !window.webmix.rec.auto));
  await p.keyboard.press('Escape'); await p.click('#btn-rec'); await p.waitForTimeout(800);
  rx2.kill('SIGINT');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
