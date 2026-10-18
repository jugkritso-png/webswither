// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const send = (port, size, extra = [], dur = 40) => spawn('ffmpeg', ['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, '-f', 'lavfi', '-i', 'sine=frequency=600',
  '-t', String(dur), '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-c:a', 'aac', ...extra, '-f', 'mpegts', `srt://127.0.0.1:${port}?mode=caller&pkt_size=1316&latency=500000`], { stdio: 'ignore' });
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'ws://127.0.0.1:8089/?token=abc' })); });
  await p.reload(); await p.waitForTimeout(600);
  const srt = name => p.evaluate(n => { const i = window.webmix.inputs.find(x => x.name === n); return { state: i.srtState, status: i.status, session: i.srtSession, info: i.srtInfo }; }, name);
  // probe: open our own mpegts.js player on the session's data URL and report the decoded media info
  const probe = name => p.evaluate(n => new Promise(res => {
    const i = window.webmix.inputs.find(x => x.name === n);
    const u = new URL(window.webmix.settings.gateway); u.pathname = '/srt-in/data'; u.searchParams.set('id', i.srtSession);
    const v = document.createElement('video');
    const pl = window.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: u.toString() }, { enableWorker: false, enableStashBuffer: false });
    pl.attachMediaElement(v);
    pl.on(window.mpegts.Events.MEDIA_INFO, mi => { res({ video: mi.videoCodec, audio: mi.audioCodec, w: mi.width, h: mi.height }); setTimeout(() => { try { pl.destroy(); } catch (e) {} }, 50); });
    pl.on(window.mpegts.Events.ERROR, (t, d) => {});
    pl.load();
    setTimeout(() => res(null), 15000);
  }), name);

  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("SRT")');
  await p.fill('.modal input[name=name]', 'OBS STUDIO'); await p.fill('.modal input[name=port]', '9007');
  await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal-title:has-text("ตั้งค่าผู้ส่ง")'); await p.keyboard.press('Escape');
  let tx = send(9007, '1280x720');
  await p.waitForTimeout(6000);
  let st = await srt('OBS STUDIO');
  ok('gateway reports live + source info', st.state === 'live' && st.info && st.info.width === 1280 && st.info.codec === 'h264', JSON.stringify(st));
  ok('clear message when browser lacks H.264', /ถอดรหัสวิดีโอ H\.264 ไม่ได้/.test(await p.textContent('#toasts')));
  const mi = await probe('OBS STUDIO');
  ok('browser player receives + demuxes the stream', mi && mi.w === 1280 && mi.h === 720 && /avc1/.test(mi.video) && /mp4a/.test(mi.audio), JSON.stringify(mi));
  tx.kill('SIGKILL'); await p.waitForTimeout(6000);
  st = await srt('OBS STUDIO');
  ok('sender drop detected', ['waiting', 'error'].includes(st.state), st.state);
  tx = send(9007, '1920x1080');
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(500); st = await srt('OBS STUDIO'); if (st.state === 'live' && st.info && st.info.height === 1080) break; }
  ok('sender returns at 1080p → live again', st.state === 'live' && st.info && st.info.height === 1080, JSON.stringify(st.info));
  const mi2 = await probe('OBS STUDIO');
  ok('player gets the new 1080p stream', mi2 && mi2.h === 1080, JSON.stringify(mi2));
  tx.kill('SIGKILL');
  // HEVC source through the page → transcoded H.264 for the player
  const hevc = spawn('ffmpeg', ['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine', '-t', '30', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error:keyint=60', '-c:a', 'aac',
    '-f', 'mpegts', 'srt://127.0.0.1:9008?mode=caller&pkt_size=1316&latency=500000'], { stdio: 'ignore' });
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("SRT")');
  await p.fill('.modal input[name=name]', 'HEVC CAM'); await p.fill('.modal input[name=port]', '9008');
  await p.click('.modal-foot .btn-primary'); await p.waitForSelector('.modal-title:has-text("ตั้งค่าผู้ส่ง")'); await p.keyboard.press('Escape');
  // เครื่อง CI ต้องเข้ารหัส x265 (ผู้ส่ง) และแปลงเป็น H.264 พร้อมกัน — รอจนสถานะ live แทนการรอเวลาตายตัว
  let hs;
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(500); hs = await srt('HEVC CAM'); if (hs.state === 'live') break; }
  ok('HEVC source detected and transcoded', hs.state === 'live' && hs.info && hs.info.codec === 'hevc', JSON.stringify(hs.info));
  await p.waitForTimeout(2000);
  const mi3 = await probe('HEVC CAM');
  ok('HEVC source arrives as H.264 for the browser', mi3 && /avc1/.test(mi3.video) && mi3.w === 1280, JSON.stringify(mi3));
  hevc.kill('SIGKILL');
  await p.screenshot({ path: S + '/srtin-cards.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close(); process.exit(0);
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
