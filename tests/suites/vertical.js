// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ใช้ได้ทั้ง Gateway Node และ Rust: GATEWAY_BIN)
// ภาพแนวตั้ง 9:16 พร้อมแนวนอน: ส่งขึ้น Gateway ครั้งเดียว ปลายทางแนวตั้งได้ภาพ 720×1280 (ตัดกลาง / ภาพเต็มพื้นเบลอ)
const { listenRtmp } = require('../lib');
const { chromium } = require('playwright');
const S = process.env.WORK;
const { spawnSync } = require('child_process');
const size = f => (spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout || '').trim();
const audio = f => (spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout || '').trim();
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const rx = [['h', 1991], ['vc', 1992], ['vf', 1993]].map(([k, port]) => listenRtmp(port, k, `${S}/vert-${k}.flv`));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  // หน้าตั้งค่า: TikTok ใช้แนวตั้งเป็นค่าเริ่มต้น
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]'); await p.click('.dest-add');
  await p.selectOption('.dest-row >> nth=-1 >> [data-f=platform]', 'tiktok');
  ok('TikTok defaults to vertical 9:16', (await p.inputValue('.dest-row >> nth=-1 >> [data-f=orient]')) === 'vcrop');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { const s = window.webmix.settings; s.gateway = 'ws://127.0.0.1:8089/?token=abc';
    const d = (id, port, orient) => ({ id, platform: 'custom', server: `rtmp://127.0.0.1:${port}/live`, key: id, passphrase: '', latency: 500, enabled: true, orient });
    s.destinations.splice(0, s.destinations.length, d('h', 1991, 'h'), d('vc', 1992, 'vcrop'), d('vf', 1993, 'vfit')); });
  await p.click('#btn-stream'); await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]');
  let live = 0;
  for (let i = 0; i < 60 && live < 3; i++) { await p.waitForTimeout(500); live = await p.evaluate(() => [...window.webmix.streamer.dests.values()].filter(d => d.state === 'live').length); }
  ok('horizontal + two vertical destinations go live', live === 3, `${live}/3`);
  ok('vertical destinations are labelled 9:16', /9:16/.test(await p.textContent('.dest-live')), await p.textContent('.dest-live'));
  await p.waitForTimeout(6000);
  await p.click('.dest-stop-all'); await p.click('.modal-foot .btn-danger >> nth=-1'); await p.waitForTimeout(2500);
  rx.forEach(x => x.kill('SIGINT')); await new Promise(r => setTimeout(r, 1500));
  const h = size(`${S}/vert-h.flv`), vc = size(`${S}/vert-vc.flv`), vf = size(`${S}/vert-vf.flv`);
  ok('horizontal destination gets 1280×720', h === 'h264,1280,720', h);
  ok('vertical (crop) destination gets 720×1280', vc === 'h264,720,1280', vc);
  ok('vertical (fit, blurred background) destination gets 720×1280', vf === 'h264,720,1280', vf);
  ok('vertical streams keep the audio', audio(`${S}/vert-vc.flv`) === 'aac' && audio(`${S}/vert-vf.flv`) === 'aac');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
