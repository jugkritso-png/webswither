// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ใช้ได้ทั้ง Gateway Node และ Rust: GATEWAY_BIN)
// กล้อง IP (RTSP) และรับ RTMP: ใช้ mediamtx เป็นกล้อง IP จำลอง · H.264 ส่งต่อตรง · H.265 แปลงให้ · รหัสผิดบอกวิธีแก้
// RTMP: ได้ที่อยู่ + key, ผู้ส่ง key ผิดถูกปฏิเสธ, key ถูกขึ้นภาพ · จำแหล่งภาพไว้หลังเปิดหน้าใหม่
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const procs = [], errs0 = [];
const run = (cmd, args) => { const p = spawn(cmd, args, { stdio: 'ignore' }); procs.push(p); return p; };

// mediamtx (เซิร์ฟเวอร์ RTSP ขนาดเล็ก) — ดาวน์โหลดครั้งแรกแล้วเก็บไว้ใน WORK
function mediamtx() {
  const bin = path.join(S, 'mediamtx');
  if (!fs.existsSync(bin)) {
    const url = 'https://github.com/bluenviron/mediamtx/releases/download/v1.9.3/mediamtx_v1.9.3_linux_amd64.tar.gz';
    const r = spawnSync('sh', ['-c', `curl -sSfL "${url}" | tar xz -C "${S}" mediamtx`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('download mediamtx failed');
  }
  const cfg = path.join(S, 'mediamtx.yml');
  fs.writeFileSync(cfg, [
    'logLevel: warn', 'rtspAddress: :8554', 'rtsp: yes', 'protocols: [tcp]', 'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no', 'api: no',
    'authInternalUsers:', '- user: any', '  pass:', '  ips: []', '  permissions:', '  - action: publish',
    '- user: viewer', '  pass: secret123', '  ips: []', '  permissions:', '  - action: read',
    'paths:', '  all_others:'
  ].join('\n'));
  return run(bin, [cfg]);
}
const publish = (pathName, codec) => run('ffmpeg', ['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  ...(codec === 'hevc' ? ['-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error:keyint=25'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '25']),
  '-c:a', 'aac', '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:8554/${pathName}`]);

(async () => {
  mediamtx();
  await new Promise(r => setTimeout(r, 1500));
  publish('cam', 'h264'); publish('hevc', 'hevc');
  await new Promise(r => setTimeout(r, 2500));

  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = errs0; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => { const s = window.webmix.settings; s.gateway = 'ws://127.0.0.1:8089/?token=abc'; s.rememberKey = true; });
  const net = mode => p.evaluate(m => window.webmix.inputs.filter(i => i.type === 'srt' && i.srt.mode === m).map(i => ({ id: i.id, name: i.name, status: i.status, state: i.srtState, msg: i.srtMessage || '', w: i.el.videoWidth, info: i.srtInfo, url: i.srt.url, user: i.srt.user, key: i.srt.key, port: i.srt.port })), mode);
  // Chromium ของชุดทดสอบถอดรหัส H.264 ไม่ได้ → ดูสถานะจาก Gateway (live) แล้วเปิดตัวเล่น mpegts.js เองเพื่อตรวจสตรีมที่ได้รับ
  const waitLive = async (mode, idx = 0, ms = 25000) => { for (let t = 0; t < ms; t += 500) { const l = await net(mode); if (l[idx] && l[idx].state === 'live' && l[idx].info) return l[idx]; await p.waitForTimeout(500); } return (await net(mode))[idx]; };
  const probe = id => p.evaluate(id => new Promise(res => {
    const i = window.webmix.inputs.find(x => x.id === id);
    const u = new URL(window.webmix.settings.gateway); u.pathname = '/srt-in/data'; u.searchParams.set('id', i.srtSession);
    const v = document.createElement('video');
    const pl = window.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: u.toString() }, { enableWorker: false, enableStashBuffer: false });
    pl.attachMediaElement(v);
    pl.on(window.mpegts.Events.MEDIA_INFO, mi => { res({ video: mi.videoCodec, audio: mi.audioCodec, w: mi.width, h: mi.height }); setTimeout(() => { try { pl.destroy(); } catch (e) {} }, 50); });
    pl.on(window.mpegts.Events.ERROR, () => {});
    pl.load();
    setTimeout(() => res(null), 15000);
  }), id);

  // ---- กล้อง IP: ใช้แบบฟอร์มยี่ห้อ (Hikvision) แล้วเปลี่ยนเป็นกำหนดเอง
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("กล้อง IP")');
  await p.waitForSelector('.modal select[name=brand]');
  await p.fill('.modal input[name=host]', '192.168.1.64'); await p.fill('.modal input[name=ch]', '2');
  ok('brand template builds the URL', (await p.inputValue('.modal input[name=url]')) === 'rtsp://192.168.1.64:554/Streaming/Channels/201', await p.inputValue('.modal input[name=url]'));
  await p.selectOption('.modal select[name=brand]', 'custom');
  ok('custom hides the IP/channel fields', !(await p.isVisible('.modal input[name=host]')));
  // วาง URL ที่มีรหัสมาด้วย → แยกชื่อผู้ใช้/รหัสออก
  await p.fill('.modal input[name=url]', 'rtsp://viewer:secret123@127.0.0.1:8554/cam');
  await p.fill('.modal input[name=user]', ''); await p.fill('.modal input[name=name]', 'Front door');
  await p.click('.modal-foot .btn-primary');
  let cam = await waitLive('rtsp');
  ok('IP camera (H.264) goes live', cam && cam.state === 'live' && cam.info.codec === 'h264' && cam.info.width === 640, JSON.stringify(cam));
  const mi = await probe(cam.id);
  ok('browser receives the camera as H.264 + AAC', mi && mi.w === 640 && /avc1/.test(mi.video) && /mp4a/.test(mi.audio), JSON.stringify(mi));
  ok('credentials kept apart from the URL', cam && cam.url === 'rtsp://127.0.0.1:8554/cam' && cam.user === 'viewer', JSON.stringify(cam));
  ok('card labelled IP CAM', /IP CAM/.test(await p.textContent(`.card[data-id="${cam.id}"] .card-sub`)), await p.textContent(`.card[data-id="${cam.id}"] .card-sub`));

  // H.265 → แปลงเป็น H.264
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("กล้อง IP")'); await p.waitForSelector('.modal select[name=brand]');
  await p.selectOption('.modal select[name=brand]', 'custom');
  await p.fill('.modal input[name=url]', 'rtsp://127.0.0.1:8554/hevc'); await p.fill('.modal input[name=user]', 'viewer'); await p.fill('.modal input[name=pass]', 'secret123');
  await p.click('.modal-foot .btn-primary');
  const hevc = await waitLive('rtsp', 1, 35000);
  ok('H.265 camera goes live', hevc && hevc.state === 'live' && hevc.info && hevc.info.codec === 'hevc', JSON.stringify(hevc));
  const mi2 = hevc && await probe(hevc.id);
  ok('H.265 is converted to H.264 for the browser', mi2 && /avc1/.test(mi2.video) && mi2.w === 640, JSON.stringify(mi2));

  // รหัสผิด
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("กล้อง IP")'); await p.waitForSelector('.modal select[name=brand]');
  await p.selectOption('.modal select[name=brand]', 'custom');
  await p.fill('.modal input[name=url]', 'rtsp://127.0.0.1:8554/cam'); await p.fill('.modal input[name=user]', 'viewer'); await p.fill('.modal input[name=pass]', 'wrong-pass');
  await p.click('.modal-foot .btn-primary');
  let bad;
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(500); bad = (await net('rtsp'))[2]; if (bad && /รหัสผ่าน/.test(bad.msg)) break; }
  ok('wrong camera password explains how to fix it', bad && bad.state !== 'live' && /รหัสผ่าน/.test(bad.msg), JSON.stringify(bad));
  // แก้ไขที่การ์ด: ใส่รหัสใหม่แล้วขึ้นภาพ
  const bc = p.locator(`.card[data-id="${bad.id}"]`); await bc.hover(); await bc.locator('[data-card=rename]').click();
  await p.waitForSelector('.modal input[name=pass]'); await p.fill('.modal input[name=pass]', 'secret123'); await p.click('.modal-foot .btn-primary');
  bad = await waitLive('rtsp', 2);
  ok('editing the card with the right password fixes it', bad && bad.state === 'live', JSON.stringify(bad));

  // ---- RTMP
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("รับ RTMP")'); await p.waitForSelector('.modal input[name=port]');
  await p.click('.modal-foot .btn-primary');
  await p.waitForSelector('.modal .rtmp-copy');
  const info = await p.$$eval('.modal input[readonly]', els => els.map(e => e.value));
  const rt = (await net('rtmp'))[0];
  ok('RTMP sender info: server, key and full URL', info.length === 3 && /^rtmp:\/\/[^/]+:1935\/live$/.test(info[0]) && info[1] === rt.key && info[2] === `${info[0]}/${rt.key}`, JSON.stringify(info));
  ok('local gateway gives a LAN address, not 127.0.0.1', !/127\.0\.0\.1/.test(info[0]), info[0]);
  await p.click('.modal-foot .btn-primary');
  for (let i = 0; i < 20 && (await net('rtmp'))[0].state !== 'waiting'; i++) await p.waitForTimeout(250);
  ok('RTMP input waits for a sender', (await net('rtmp'))[0].state === 'waiting');
  const pushTo = key => run('ffmpeg', ['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine', '-t', '25', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-c:a', 'aac', '-f', 'flv', `rtmp://127.0.0.1:1935/live/${key}`]);
  const wrong = pushTo('not-the-key');
  await p.waitForTimeout(5000);
  ok('sender with the wrong key is refused', (await net('rtmp'))[0].state !== 'live', JSON.stringify((await net('rtmp'))[0]));
  wrong.kill('SIGKILL');
  await p.waitForTimeout(1500);
  pushTo(rt.key);
  const live = await waitLive('rtmp');
  ok('sender with the right key goes live', live && live.state === 'live' && live.info.width === 320, JSON.stringify(live));
  ok('card labelled RTMP', /RTMP/.test(await p.textContent(`.card[data-id="${rt.id}"] .card-sub`)));

  // ---- จำไว้หลังเปิดหน้าใหม่
  await p.evaluate(() => window.webmix.show.autosave(true));
  await p.reload(); await p.waitForTimeout(1000);
  const again = await waitLive('rtsp');
  const keyAfter = (await net('rtmp'))[0];
  ok('IP camera reconnects after reload', again && again.state === 'live' && (await net('rtsp')).length === 3, JSON.stringify(again));
  ok('RTMP input keeps its port and key', keyAfter && keyAfter.key === rt.key && keyAfter.port === 1935, JSON.stringify(keyAfter));
  await p.screenshot({ path: S + '/netinputs.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message, JSON.stringify(errs0)); process.exitCode = 1; })
  .finally(() => { for (const x of procs) { try { x.kill('SIGKILL'); } catch (e) {} } });
