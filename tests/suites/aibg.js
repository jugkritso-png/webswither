// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// พื้นหลังด้วย AI (MediaPipe): กล้องปลอมของ Chromium ไม่มีคน → ทั้งภาพเป็น "พื้นหลัง"
// เปลี่ยนเป็นภาพ → เห็นภาพที่เลือก · ลบพื้นหลัง → โปร่งใส (บน Program เป็นสีดำ) · ไม่ใช้ → ภาพกล้องเดิม · จำค่าไว้กับโชว์
// ไฟล์ของ MediaPipe และโมเดลดาวน์โหลดครั้งแรกลง WORK แล้วส่งให้หน้าเว็บแทน CDN (ทดสอบได้แม้ CDN ถูกบล็อก)
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const MP = path.join(S, 'mp', 'package');
const MODEL = path.join(S, 'selfie_segmenter_landscape.tflite');
function fetchAssets() {
  if (!fs.existsSync(path.join(MP, 'vision_bundle.mjs'))) {
    fs.mkdirSync(path.join(S, 'mp'), { recursive: true });
    const r = spawnSync('sh', ['-c', `cd "${path.join(S, 'mp')}" && npm pack @mediapipe/tasks-vision@0.10.21 --silent && tar xzf mediapipe-tasks-vision-0.10.21.tgz`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('npm pack @mediapipe/tasks-vision failed');
  }
  if (!fs.existsSync(MODEL)) {
    const r = spawnSync('curl', ['-sSfL', '-o', MODEL, 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('download model failed');
  }
  if (!fs.existsSync(path.join(S, 'red.png'))) spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff0000:s=640x360', '-frames:v', '1', path.join(S, 'red.png')]);
}
(async () => {
  fetchAssets();
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  let served = 0;
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@0\.10\.21\/(.*)$/, r => {
    const rel = /tasks-vision@0\.10\.21\/([^?#]*)/.exec(r.request().url())[1];
    const file = path.join(MP, rel);
    if (!file.startsWith(MP) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
    served++;
    r.fulfill({ body: fs.readFileSync(file), contentType: rel.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await ctx.route(/storage\.googleapis\.com\/mediapipe-models\/.*selfie_segmenter_landscape\.tflite/, r => r.fulfill({ body: fs.readFileSync(MODEL), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  // กล้อง + ภาพพื้นหลังสีแดง
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("กล้อง /")'); await p.waitForSelector('.modal-foot .btn-primary'); await p.click('.modal-foot .btn-primary');
  await p.waitForFunction(() => window.webmix.inputs.some(i => i.type === 'camera' && i.status === 'live'), null, { timeout: 10000 }).catch(() => {});
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(`${S}/red.png`);
  await p.waitForTimeout(800);
  const cam = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'camera').id);
  await p.evaluate(id => { window.webmix.state.programId = id; }, cam);
  // สัดส่วนพิกเซลสีแดง / ดำ บน Program
  const stats = () => p.evaluate(() => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = 64; g.height = 36; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let red = 0, black = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++; if (d[i] < 25 && d[i + 1] < 25 && d[i + 2] < 25) black++; } return { red: red / 2304, black: black / 2304 }; });
  const base = await stats();
  ok('camera picture is not red to begin with', base.red < 0.2, JSON.stringify(base));
  const card = p.locator(`.card[data-id="${cam}"]`); await card.hover(); await card.locator('[data-card=rename]').click();
  await p.waitForSelector('.modal select[name=bgmode]');
  ok('camera edit dialog has the AI background options', (await p.$$eval('.modal select[name=bgmode] option', o => o.map(x => x.value))).join() === 'none,blur,image,remove');
  await p.selectOption('.modal select[name=bgmode]', 'image');
  ok('choosing “image” shows the picture list', await p.isVisible('.modal select[name=bgimg]'));
  await p.click('.modal-foot .btn-primary');
  await p.waitForFunction(() => window.webmix.inputs.find(i => i.type === 'camera').bgState?.ready, null, { timeout: 45000 }).catch(() => {});
  const st = await p.evaluate(() => { const s = window.webmix.inputs.find(i => i.type === 'camera').bgState; return s && { ready: s.ready, error: s.error, version: s.version }; });
  ok('segmenter loads (MediaPipe from the CDN path) and runs', st && st.ready && !st.error && served > 0, JSON.stringify({ st, served }));
  await p.waitForTimeout(800);
  const rep = await stats();
  ok('background replaced by the chosen picture', rep.red > 0.8, JSON.stringify(rep));
  const v1 = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'camera').bgState.version);
  await p.waitForTimeout(1000);
  const v2 = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'camera').bgState.version);
  ok('keeps processing new frames', v2 - v1 >= 1, `${v2 - v1} frames/s (no GPU here)`);
  await p.evaluate(() => window.webmix.setRenderer('gpu')); await p.waitForTimeout(800);
  ok('GPU renderer shows the replaced background too', (await stats()).red > 0.8);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  // ลบพื้นหลัง → โปร่งใส
  await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('.modal select[name=bgmode]');
  await p.selectOption('.modal select[name=bgmode]', 'remove'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1000);
  const rm = await stats();
  ok('“remove” makes the background transparent (black on Program)', rm.black > 0.8, JSON.stringify(rm));
  // บันทึกกับโชว์
  ok('saved with the show', await p.evaluate(id => window.webmix.show.serialize().inputs.find(i => i.id === id).bg?.mode === 'remove', cam));
  // ยกเลิก → คืนค่าเดิม · ไม่ใช้ → ภาพเดิม
  await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('.modal select[name=bgmode]');
  await p.selectOption('.modal select[name=bgmode]', 'blur'); await p.click('.modal-foot button:has-text("ยกเลิก")'); await p.waitForTimeout(300);
  ok('cancel keeps the previous setting', await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'camera').bg.mode === 'remove'));
  await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('.modal select[name=bgmode]');
  await p.selectOption('.modal select[name=bgmode]', 'none'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800);
  const off = await stats();
  ok('“none” returns the normal camera picture and frees the model', off.red < 0.2 && off.black < 0.8 && await p.evaluate(() => !window.webmix.inputs.find(i => i.type === 'camera').bgState), JSON.stringify(off));
  await p.screenshot({ path: S + '/aibg.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
