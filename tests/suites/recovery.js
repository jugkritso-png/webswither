// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ใช้ได้ทั้ง Gateway Node และ Rust: GATEWAY_BIN)
// กู้งานเมื่อปิดกะทันหัน: บันทึกอยู่แล้วปิดแท็บทิ้ง (ไม่กดหยุด) → เปิดใหม่ เสนอไฟล์ที่กู้ได้ ดาวน์โหลดแล้วเล่นได้และเลื่อนเวลาได้
// ไลฟ์อยู่แล้วปิดแท็บ → เปิดใหม่ ถามว่าจะไลฟ์ต่อไหม → ไลฟ์ต่อไปปลายทางเดิมได้ · หยุดตามปกติไม่ถาม
const { listenRtmp } = require('../lib');
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const dur = f => parseFloat((spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout || '').trim());
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const errs = [];
  const open = async () => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1200); return p; };
  let p = await open();
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1000);
  // ---- บันทึกแล้วปิดแท็บกลางทาง
  await p.click('#btn-rec');
  await p.waitForFunction(() => window.webmix.rec.active, null, { timeout: 5000 }).catch(() => {});
  const sink = await p.evaluate(() => ({ kind: window.webmix.rec.sink && window.webmix.rec.sink.kind, direct: !!(window.webmix.rec.sink && window.webmix.rec.sink.writable.direct) }));
  ok('recording goes to disk (OPFS) and writes straight to the file', sink.kind === 'opfs' && sink.direct, JSON.stringify(sink));
  await p.waitForTimeout(6000);
  await p.close({ runBeforeUnload: false });
  p = await open();
  ok('reopening offers the recording that was cut off', /กู้ไฟล์บันทึกที่ค้าง/.test(await p.textContent('#toasts')) && await p.isVisible('.toast .toast-action:has-text("บันทึกไฟล์ที่กู้ได้")'));
  const dl = p.waitForEvent('download', { timeout: 20000 });
  await p.click('.toast .toast-action:has-text("บันทึกไฟล์ที่กู้ได้")');
  const d = await dl; const file = `${S}/recovered.webm`; await d.saveAs(file);
  const secs = dur(file);
  ok('recovered file is named -recovered and plays with a duration', /-recovered\.webm$/.test(d.suggestedFilename()) && secs > 3, `${d.suggestedFilename()} ${secs}s`);
  await p.reload(); await p.waitForTimeout(1200);
  ok('not offered again once saved', !/กู้ไฟล์บันทึกที่ค้าง/.test(await p.textContent('#toasts')));
  // บันทึกแล้วหยุดตามปกติ → ไม่มีอะไรค้าง
  await p.evaluate(() => document.querySelector('#btn-rec').click());
  await p.waitForTimeout(2500);
  const dl2 = p.waitForEvent('download', { timeout: 20000 });
  await p.evaluate(() => window.webmix.rec.recorder.stop()); await dl2;
  await p.waitForTimeout(500);
  ok('a normal stop leaves nothing to recover', await p.evaluate(() => JSON.parse(localStorage.getItem('webmix:rec-open') || '[]').length === 0));

  // ---- ไลฟ์แล้วปิดแท็บ
  const rx = listenRtmp(1995, 'resume', `${S}/resume-1.flv`);
  await p.evaluate(() => { const s = window.webmix.settings; s.gateway = 'ws://127.0.0.1:8089/?token=abc'; s.rememberKey = true;
    s.destinations.splice(0, s.destinations.length, { id: 'r1', platform: 'custom', server: 'rtmp://127.0.0.1:1995/live', key: 'resume', passphrase: '', latency: 500, enabled: true, orient: 'h' });
    window.webmix.show.autosave(true); });
  await p.evaluate(() => { localStorage.setItem('webmix:settings', JSON.stringify(window.webmix.settings)); });
  await p.click('#btn-stream'); await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]');
  let live = false;
  for (let i = 0; i < 40 && !live; i++) { await p.waitForTimeout(500); live = await p.evaluate(() => window.webmix.streamer.dests.get('r1')?.state === 'live'); }
  ok('stream goes live', live);
  await p.waitForTimeout(1500);
  await p.close({ runBeforeUnload: false });
  rx.kill('SIGKILL');
  const rx2 = listenRtmp(1995, 'resume', `${S}/resume-2.flv`);
  await new Promise(r => setTimeout(r, 1500));
  p = await open();
  await p.waitForSelector('.modal-title:has-text("ไลฟ์ครั้งก่อนหยุดกะทันหัน")', { timeout: 5000 }).catch(() => {});
  ok('reopening asks whether to continue the live', await p.isVisible('.modal-title:has-text("ไลฟ์ครั้งก่อนหยุดกะทันหัน")') && /ไปยัง .+/.test(await p.textContent('.modal')), await p.textContent('.modal').catch(() => ''));
  await p.click('.modal-foot .btn-primary');
  live = false;
  for (let i = 0; i < 40 && !live; i++) { await p.waitForTimeout(500); live = await p.evaluate(() => window.webmix.streamer.dests.get('r1')?.state === 'live'); }
  ok('“continue” goes live to the same destination again', live);
  // หยุดตามปกติ → เปิดใหม่ไม่ถาม
  await p.evaluate(() => window.webmix.streamer.ws.close(1000)); await p.waitForTimeout(800);
  await p.reload(); await p.waitForTimeout(2500);
  ok('a normal stop does not ask again', !(await p.isVisible('.modal-title:has-text("ไลฟ์ครั้งก่อนหยุดกะทันหัน")')));
  rx2.kill('SIGKILL');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
