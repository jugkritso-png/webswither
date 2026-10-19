// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ตัวบันทึก WebCodecs + ตัวเขียน WebM เอง (ใช้แทน MediaRecorder ที่เสียใน WebKitGTK/Linux)
// บังคับใช้ใน Chromium ด้วย localStorage 'webmix-wcrec' แล้วตรวจไฟล์บันทึกและการสตรีมด้วย ffmpeg จริง
const { listenRtmp, probe } = require('../lib');
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const { spawnSync } = require('child_process');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const duration = f => parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
const decodeErrors = f => spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.trim();
const seekFrame = (f, t) => spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' }).status === 0;

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix-wcrec', '1');
    localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'ws://127.0.0.1:8089/?token=abc', destinations: [{ id: 'w1', platform: 'custom', server: 'rtmp://127.0.0.1:1947/live', key: 'wk', enabled: true }], rememberKey: true })); });
  await p.reload(); await p.waitForTimeout(800);
  ok('WebCodecs recorder selected', await p.evaluate(() => window.WebMix.wcrec.preferred()));
  // วิดีโอที่มีเสียงเข้า Program (ให้ไฟล์มีทั้งภาพเคลื่อนไหวและเสียง)
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/loud.webm');
  await p.waitForTimeout(800);
  await p.evaluate(() => { const w = window.webmix; w.setPreview(w.inputs[w.inputs.length - 1].id); w.cut(); });
  await p.click('body'); await p.waitForTimeout(500);

  // ---- บันทึก (โฟลเดอร์ OPFS ที่เลือกไว้ → เขียนไฟล์ระหว่างอัด + แก้ส่วนหัวให้เลื่อนได้ตอนหยุด) ----
  await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.webmix.useRecFolder(await root.getDirectoryHandle('WcRec', { create: true })); });
  await p.click('#btn-rec'); await p.waitForTimeout(5000);
  const mime = await p.evaluate(() => window.webmix.rec.recorder.mimeType);
  ok('records WebM via WebCodecs', /^video\/webm;codecs=(vp8|h264),opus$/.test(mime), mime);
  await p.click('#btn-rec'); await p.waitForTimeout(2000);
  const saved = await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('WcRec');
    for await (const [name, h] of dir.entries()) { const f = await h.getFile(); const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return { name, size: f.size, b64: btoa(bin) }; }
    return null;
  });
  ok('file written', saved && saved.size > 50000 && /\.webm$/.test(saved.name), saved && `${saved.name} ${saved.size} bytes`);
  if (saved) {
    const f = S + '/wcrec.webm'; fs.writeFileSync(f, Buffer.from(saved.b64, 'base64'));
    const pr = probe(f);
    ok('has video and Opus audio', /codec_name=(vp8|h264)\|width=1280/.test(pr) && /codec_name=opus/.test(pr), pr);
    const errsDec = decodeErrors(f);
    ok('ffmpeg decodes the whole file without errors', errsDec === '', errsDec.slice(0, 300));
    const dur = duration(f);
    ok('duration written at stop', dur > 4 && dur < 7, `${dur} s`);
    ok('seeks to the middle', seekFrame(f, (dur / 2).toFixed(2)));
    const frames = parseInt(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
    ok('about 30 fps of video', frames > dur * 22, `${frames} frames in ${dur.toFixed(1)} s`);
    const aDur = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim().split('\n').pop());
    ok('audio covers the recording (A/V in sync)', Math.abs(aDur - dur) < 0.6, `audio to ${aDur}s, file ${dur}s`);
  }
  const play = await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('WcRec');
    let file; for await (const [, h] of dir.entries()) file = await h.getFile();
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('load')); });
    return { duration: v.duration, w: v.videoWidth };
  });
  ok('browser plays it with a finite duration', isFinite(play.duration) && play.w === 1280, JSON.stringify(play));

  // ---- สตรีมผ่าน Gateway ไปเครื่องรับ RTMP ----
  const rtmp = listenRtmp(1947, 'wk', S + '/wcrec-stream.flv');
  await p.waitForTimeout(800);
  await p.click('[data-action=stream]'); await p.waitForSelector('.dest-live-row');
  await p.locator('.dest-live-row').nth(0).locator('[data-dest-toggle]').click(); await p.waitForTimeout(9000);
  ok('stream goes LIVE', (await p.textContent('#btn-stream')).includes('ON AIR 1/1'), (await p.textContent('#btn-stream')).trim());
  await p.locator('.dest-live-row').nth(0).locator('[data-dest-toggle]').click(); await p.waitForTimeout(2500);
  rtmp.kill('SIGINT'); await new Promise(r => setTimeout(r, 1500));
  const sp = probe(S + '/wcrec-stream.flv');
  ok('RTMP receiver got H.264 + AAC', /h264/.test(sp) && /aac/.test(sp), sp);
  ok('streamed for several seconds', duration(S + '/wcrec-stream.flv') > 4, `${duration(S + '/wcrec-stream.flv')} s`);

  // ---- H.264 จาก WebCodecs ส่งต่อโดย Gateway ไม่เข้ารหัสซ้ำ (vcopy=1 — เส้นทางของแอป Android) ----
  const rtmp2 = listenRtmp(1948, 'vc', S + '/wcrec-vcopy.flv');
  await p.waitForTimeout(800);
  const vc = await p.evaluate(async () => {
    const wc = window.WebMix.wcrec;
    const supported = await wc.avcSupported(1280, 720, 30, 2500000);
    if (!supported) return { supported };
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const g = canvas.getContext('2d'); let n = 0;
    const draw = setInterval(() => { g.fillStyle = `hsl(${(n++ * 7) % 360} 70% 45%)`; g.fillRect(0, 0, 1280, 720); }, 33);
    const actx = new AudioContext(); const osc = actx.createOscillator(); osc.start();
    const ws = new WebSocket('ws://127.0.0.1:8089/?token=abc&fps=30&vb=2500&res=720&vcopy=1');
    const rec = wc.recorder({ canvas, audioNode: osc, fps: 30, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000, requireAvc: true, constantBitrate: true });
    let live = false;
    await new Promise(res => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start', destinations: [{ id: 'v', name: 'v', url: 'rtmp://127.0.0.1:1948/live/vc' }] }));
        rec.ondataavailable = e => ws.readyState === 1 && ws.send(e.data);
        rec.start(500);
      };
      ws.onmessage = ev => { try { const m = JSON.parse(ev.data); if ((m.destinations || []).some(d => d.state === 'live')) live = true; } catch (e) {} };
      setTimeout(res, 8000);
    });
    rec.stop(); ws.send(JSON.stringify({ type: 'stop', id: 'v' }));
    await new Promise(r => setTimeout(r, 1500)); ws.close(); clearInterval(draw); actx.close();
    return { supported, live, mime: rec.mimeType };
  });
  if (vc.supported) {
    rtmp2.kill('SIGINT'); await new Promise(r => setTimeout(r, 1500));
    const vp = probe(S + '/wcrec-vcopy.flv');
    ok('H.264 passthrough (vcopy) goes LIVE', vc.live && /h264/.test(vc.mime), JSON.stringify(vc));
    ok('passthrough stream has H.264 720p + AAC', /codec_name=h264\|width=1280\|height=720/.test(vp) && /aac/.test(vp), vp);
    ok('passthrough streamed for several seconds', duration(S + '/wcrec-vcopy.flv') > 4, `${duration(S + '/wcrec-vcopy.flv')} s`);
  } else { rtmp2.kill('SIGINT'); console.log('INFO  WebCodecs H.264 not available in this Chromium — passthrough test skipped'); }

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
