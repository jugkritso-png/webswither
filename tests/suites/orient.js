// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// โหมดแนวตั้ง 9:16: Program 720×1280 · ภาพแนวนอนครอปเต็มจอ · ลากกรอบครอปบนการ์ด · CPU / GPU · สตรีมออกเป็น 720×1280 · บันทึกกับโชว์
const { listenRtmp } = require('../lib');
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const S = process.env.WORK;
const size = f => (spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout || '').trim();
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const rx = listenRtmp(1995, 'v', `${S}/orient.flv`);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(S + '/green.png');
  await p.waitForTimeout(600);
  const img = await p.evaluate(() => { const w = window.webmix; const i = w.inputs.find(x => x.type === 'image'); w.state.programId = i.id; return i.id; });
  await p.click('#seg-orient [data-value=v]'); await p.waitForTimeout(600);
  const dims = await p.evaluate(() => [document.querySelector('#pgm-canvas').width, document.querySelector('#pgm-canvas').height]);
  ok('9:16 makes Program 720×1280', dims.join('x') === '720x1280', dims.join('x'));
  ok('toggle shows 9:16 active', await p.isVisible('#seg-orient [data-value=v].is-active'));
  // สีกลางจอ / ขอบซ้าย-ขวาเป็นภาพจริง ไม่ใช่แถบดำ
  const px = (x, y) => p.evaluate(([x, y]) => Array.from(document.querySelector('#pgm-canvas').getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);
  await p.waitForTimeout(300);
  let c = await px(360, 640), edge = await px(10, 640), top = await px(360, 20);
  ok('landscape picture fills the vertical frame (cropped, no bars)', edge[1] > 200 && top[1] > 200 || top[0] > 200, JSON.stringify({ edge, top }));
  ok('centre crop shows the middle (red box)', c[0] > 200 && c[1] < 80, JSON.stringify(c));
  ok('card shows the orange crop frame', await p.isVisible(`.card[data-id="${img}"] .card-vcrop`));
  // ลากกรอบไปซ้ายสุด → กล่องแดงตรงกลางหายไป
  const box = await p.locator(`.card[data-id="${img}"] .card-vcrop`).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 5 }); await p.mouse.up();
  await p.waitForTimeout(300);
  ok('dragging the frame moves the crop', await p.evaluate(id => window.webmix.inputs.find(i => i.id === id).vx === 0, img));
  c = await px(360, 640);
  ok('Program follows the crop (left part, no red)', c[1] > 200 && c[0] < 80, JSON.stringify(c));
  ok('drag did not change Preview', await p.evaluate(id => window.webmix.state.previewId !== id, img));
  await p.evaluate(() => window.webmix.setRenderer('gpu')); await p.waitForTimeout(600);
  ok('GPU renderer crops the same way', await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 72; c.height = 128; const x = c.getContext('2d'); x.drawImage(document.querySelector('#pgm-canvas'), 0, 0, 72, 128); const d = x.getImageData(36, 64, 1, 1).data; return d[1] > 200 && d[0] < 80; }));
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  ok('crop saved with the show', await p.evaluate(id => window.webmix.show.serialize().inputs.find(i => i.id === id).vx === 0, img));
  // สตรีม: ปลายทาง 16:9 ปกติ ได้ภาพแนวตั้งตามโหมด
  await p.evaluate(() => { const s = window.webmix.settings; s.gateway = 'ws://127.0.0.1:8089/?token=abc';
    s.destinations.splice(0, s.destinations.length, { id: 'v', platform: 'custom', server: 'rtmp://127.0.0.1:1995/live', key: 'v', passphrase: '', latency: 500, enabled: true, orient: 'h' }); });
  await p.click('#btn-stream'); await p.click('.dest-start-all');
  let live = false;
  for (let i = 0; i < 40 && !live; i++) { await p.waitForTimeout(500); live = await p.evaluate(() => [...window.webmix.streamer.dests.values()].some(d => d.state === 'live')); }
  ok('streams live in 9:16', live);
  await p.evaluate(() => window.webmix.setOrient('h')); await p.waitForTimeout(300);
  ok('cannot switch while live', await p.evaluate(() => window.webmix.settings.orient === 'v') && /หยุดก่อน/.test(await p.textContent('#toasts')));
  await p.waitForTimeout(5000);
  await p.click('.dest-stop-all'); await p.click('.modal-foot .btn-danger >> nth=-1'); await p.waitForTimeout(2500);
  rx.kill('SIGINT'); await new Promise(r => setTimeout(r, 1500));
  ok('received stream is 720×1280', size(`${S}/orient.flv`) === '720,1280', size(`${S}/orient.flv`));
  await p.keyboard.press('Escape');
  await p.click('#seg-orient [data-value=h]'); await p.waitForTimeout(400);
  ok('back to 16:9', await p.evaluate(() => document.querySelector('#pgm-canvas').width === 1280 && document.querySelector('#pgm-canvas').height === 720) && !(await p.isVisible('.card-vcrop')));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
