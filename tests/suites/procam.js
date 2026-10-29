// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// กล้องมือถือแบบโปร (แนว Blackmagic Camera): ปรับ ISO/ชัตเตอร์/WB/โฟกัส/ซูม บนมือถือ · ตัวช่วยดูภาพ · แตะเพื่อโฟกัส
// สตูดิโอควบคุมกล้องจากระยะไกล (ซูม / บันทึกในมือถือ / เฟรมเรต / ข้อความถึงช่างกล้อง / ล็อก)
// กล้องปลอมของ Chromium ไม่มีความสามารถเหล่านี้ จึงจำลอง getCapabilities/getSettings/applyConstraints ของกล้องโปร
const { chromium, devices } = require('playwright');
const fs = require('fs');
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({host:'127.0.0.1',port:9900,path:'/',secure:false},o||{});return id?new P(id,o):new P(o);};})();`;
const qrLib = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route('**/qrcode.min.js', r => r.fulfill({ contentType: 'application/javascript', body: qrLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
const PROCAM = () => {
  const caps = { iso: { min: 50, max: 3200, step: 1 }, exposureTime: { min: 1, max: 3333, step: 1 }, exposureCompensation: { min: -2, max: 2, step: 0.1 },
    colorTemperature: { min: 2500, max: 7500, step: 50 }, focusDistance: { min: 0.1, max: 10, step: 0.01 }, zoom: { min: 1, max: 8, step: 0.1 }, torch: true,
    exposureMode: ['continuous', 'manual'], whiteBalanceMode: ['continuous', 'manual'], focusMode: ['continuous', 'single-shot', 'manual'] };
  const state = new WeakMap();
  window.__applied = [];
  const def = () => ({ exposureMode: 'continuous', iso: 200, exposureTime: 200, exposureCompensation: 0, whiteBalanceMode: 'continuous', colorTemperature: 5600, focusMode: 'continuous', focusDistance: 1, zoom: 1, torch: false });
  const P = MediaStreamTrack.prototype, gc = P.getCapabilities, gs = P.getSettings, ac = P.applyConstraints;
  P.getCapabilities = function () { const b = gc ? gc.call(this) : {}; return this.kind === 'video' ? { ...b, ...caps, frameRate: { min: 1, max: 60 } } : b; };
  P.getSettings = function () { const b = gs.call(this); if (this.kind !== 'video') return b; if (!state.has(this)) state.set(this, def()); return { ...b, ...state.get(this) }; };
  P.applyConstraints = async function (c = {}) {
    if (this.kind !== 'video') return ac.call(this, c);
    const { advanced, ...rest } = c;
    if (advanced) { if (!state.has(this)) state.set(this, def()); for (const a of advanced) { window.__applied.push(a); Object.assign(state.get(this), a); } }
    if (Object.keys(rest).length) return ac.call(this, rest);
  };
};
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const hctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await setup(hctx);
  const host = await hctx.newPage(); host.on('pageerror', e => errs.push('host ' + e.message));
  await host.goto('http://localhost:8765/index.html'); await host.evaluate(() => localStorage.clear()); await host.reload();
  await until(() => host.evaluate(() => window.webmix.wireless.status === 'ready'));
  const link = await host.evaluate(() => window.webmix.wireless.link);
  const pctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true, permissions: ['camera', 'microphone'] }); await setup(pctx);
  await pctx.addInitScript(PROCAM);
  const ph = await pctx.newPage(); ph.on('pageerror', e => errs.push('phone ' + e.message));
  await ph.goto(link.replace(/^https?:\/\/[^/]+\/[^?]*/, 'http://localhost:8765/index.html'));
  ok('phone shows the pro camera rail', await until(() => ph.isVisible('.pc-rail [data-pc=exp]'), 8000));
  const connected = await until(() => host.evaluate(() => window.webmix.inputs.some(i => i.type === 'wireless' && i.status === 'live' && i.cam)));
  ok('studio gets the phone and its camera state', connected);
  const id = await host.evaluate(() => window.webmix.inputs.find(i => i.type === 'wireless').id);
  ok('card offers camera control', await until(() => host.isVisible(`.card[data-id="${id}"] [data-card=camctl]`), 5000));

  // ---- บนมือถือ: แสงแบบปรับเอง
  await ph.tap('[data-pc=exp]'); await ph.waitForSelector('.pc-panel [data-seg=exposureMode]');
  await ph.tap('.pc-panel [data-seg=exposureMode] [data-v=manual]'); await ph.waitForTimeout(300);
  ok('MANUAL starts from the current ISO/shutter', await ph.evaluate(() => window.__applied.some(a => a.exposureMode === 'manual' && a.iso === 200 && a.exposureTime === 200)));
  await ph.evaluate(() => { const r = document.querySelector('.pc-panel [data-k=iso]'); r.value = 800; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await ph.waitForTimeout(250);
  await ph.tap('.pc-panel [data-seg=shutterQuick] [data-v="200"]'); await ph.waitForTimeout(250);
  const exp = await ph.textContent('[data-pc=exp] b');
  ok('ISO 800 at 1/50 applied and shown on the rail', /ISO 800 1\/50/.test(exp), exp);
  // WB
  await ph.tap('[data-pc=wb]'); await ph.tap('.pc-panel [data-seg=whiteBalanceMode] [data-v=manual]'); await ph.waitForTimeout(200);
  await ph.tap('.pc-panel [data-seg=wbPreset] [data-v="3200"]'); await ph.waitForTimeout(250);
  ok('white balance preset 3200K', (await ph.textContent('[data-pc=wb] b')) === '3200K');
  // ตัวช่วยดูภาพ
  await ph.tap('[data-pc=assist]');
  for (const k of ['peaking', 'grid']) await ph.tap(`.pc-panel [data-tog=${k}]`);
  await ph.tap('.pc-panel [data-seg=guide] [data-v="2.39"]');
  await ph.waitForTimeout(600);
  const as = await ph.evaluate(() => { const c = document.querySelector('.pc-assist'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] > 200 && d[i + 1] < 80) red++; return { visible: !c.hidden, red, grid: document.querySelectorAll('.pc-guides .g-v').length, masks: document.querySelectorAll('.pc-guides .g-mask').length, hist: !document.querySelector('.pc-hist').hidden }; });
  ok('focus peaking marks edges, grid and 2.39 frame drawn, histogram on', as.visible && as.red > 50 && as.grid === 2 && as.masks === 2 && as.hist, JSON.stringify(as));
  await ph.tap('.pc-panel .pc-close');
  // แตะเพื่อโฟกัส
  await ph.tap('.pc-stage', { position: { x: 60, y: 40 }, force: true }).catch(async () => { const r = await ph.evaluate(() => { const b = document.querySelector('#caller-video').getBoundingClientRect(); return [b.x + b.width * 0.3, b.y + b.height * 0.5]; }); await ph.touchscreen.tap(r[0], r[1]); });
  await ph.waitForTimeout(300);
  ok('tap on the picture focuses there', await ph.evaluate(() => window.__applied.some(a => a.pointsOfInterest && a.focusMode === 'single-shot')));

  // ---- วงแหวนซูม / โฟกัสแบบนุ่ม
  await ph.tap('[data-pc=zoom]'); await ph.waitForSelector('.pc-panel .pc-ring[data-ring=zoom]');
  const ringDrag = async (sel, dx) => {
    const bb = await ph.locator(sel).boundingBox(), y = bb.y + bb.height / 2, x0 = bb.x + bb.width * 0.8;
    await ph.evaluate(() => { window.__applied = []; });
    const cdp = await pctx.newCDPSession(ph);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 15; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / 15, y }] }); await ph.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.waitForTimeout(900);
  };
  await ringDrag('.pc-ring[data-ring=zoom] .pc-ring-band', -220);
  const zs = await ph.evaluate(() => window.__applied.filter(a => 'zoom' in a).map(a => a.zoom));
  ok('dragging the zoom ring zooms in smoothly (many small steps, only increasing)', zs.length >= 5 && zs.every((z, i) => !i || z >= zs[i - 1] - 1e-9) && zs[zs.length - 1] > 1.3, JSON.stringify(zs.map(z => +z.toFixed(2))));
  ok('rail shows the new zoom', parseFloat(await ph.textContent('[data-pc=zoom] b')) > 1.3, await ph.textContent('[data-pc=zoom] b'));
  await ph.tap('.pc-panel [data-seg=glide] [data-v="600"]');
  await ph.evaluate(() => { window.__applied = []; });
  await ph.tap('.pc-panel [data-seg=zoomQuick] [data-v="5"]'); await ph.waitForTimeout(1100);
  const gz = await ph.evaluate(() => window.__applied.filter(a => 'zoom' in a).map(a => a.zoom));
  ok('5× button glides there (in-between values, ends at 5)', gz.length >= 4 && Math.abs(gz[gz.length - 1] - 5) < 1e-6 && gz.some(z => z > 1.4 && z < 4.9), JSON.stringify(gz.map(z => +z.toFixed(2))));
  // จีบนิ้วบนภาพ (สองนิ้วกางออก) = ซูมเข้า
  await ph.evaluate(() => { window.__applied = []; });
  {
    const vb = await ph.locator('#caller-video').boundingBox(), cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
    await ph.evaluate(([cx, cy]) => {
      const v = document.querySelector('#caller-video');
      const ev = (type, id, x) => v.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true }));
      ev('pointerdown', 11, cx - 40); ev('pointerdown', 12, cx + 40);
      for (let i = 1; i <= 10; i++) { ev('pointermove', 11, cx - 40 - i * 4); ev('pointermove', 12, cx + 40 + i * 4); }
      ev('pointerup', 11, cx - 80); ev('pointerup', 12, cx + 80);
    }, [cx, cy]);
    await ph.waitForTimeout(500);
  }
  const pz = await ph.evaluate(() => window.__applied.filter(a => 'zoom' in a).map(a => a.zoom));
  ok('pinch out on the picture zooms in', pz.length && pz[pz.length - 1] > 5.5 && !(await ph.evaluate(() => window.__applied.some(a => a.pointsOfInterest))), JSON.stringify(pz.map(z => +z.toFixed(2))));
  // วงแหวนโฟกัสตอน AF → เปลี่ยนเป็น MF แล้วดึงโฟกัส
  await ph.tap('[data-pc=focus]'); await ph.waitForSelector('.pc-panel .pc-ring[data-ring=focusDistance]');
  await ringDrag('.pc-ring[data-ring=focusDistance] .pc-ring-band', -150);
  const fs1 = await ph.evaluate(() => window.__applied.filter(a => 'focusDistance' in a));
  ok('focus ring in AF switches to MF and pulls focus smoothly', fs1.length >= 5 && fs1[0].focusMode === 'manual' && fs1[fs1.length - 1].focusDistance > 1.2, JSON.stringify(fs1.map(a => +a.focusDistance.toFixed(2))));
  ok('rail shows MF and the panel follows', (await ph.textContent('[data-pc=focus] b')) === 'MF' && await ph.isVisible('.pc-panel [data-seg=focusMode] [data-v=manual].on'));
  await ph.screenshot({ path: process.env.WORK + '/procam-focus-ring.png' });
  await ph.tap('.pc-panel .pc-close');

  // ---- สตูดิโอควบคุมจากระยะไกล
  const card = host.locator(`.card[data-id="${id}"]`); await card.hover(); await card.locator('[data-card=camctl]').click();
  await host.waitForSelector('.cam-ctl [data-ck=iso]');
  ok('studio dialog shows the phone values (manual ISO 800, 3200K)', /800/.test(await host.textContent('[data-cv=iso]')) && /3200K/.test(await host.textContent('[data-cv=colorTemperature]')));
  await host.evaluate(() => { const r = document.querySelector('.cam-ctl [data-ck=zoom]'); r.value = 3; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('studio zoom 3× reaches the phone', await until(() => ph.evaluate(() => window.__applied.some(a => a.zoom === 3)), 5000) && await until(async () => (await ph.textContent('[data-pc=zoom] b')) === '3.0×', 3000));
  ok('studio dialog follows the phone back', await until(async () => /3\.0×/.test(await host.textContent('[data-cv=zoom]')), 5000));
  await host.click('.cam-ctl [data-cs=fps] [data-v="25"]');
  ok('studio sets 25 fps on the phone', await until(async () => /25/.test(await ph.textContent('[data-pc=fps] b')), 5000));
  await host.fill('.cam-ctl .cam-msg', 'ซูมเข้าหน้าผู้พูด'); await host.click('.cam-ctl .cam-msg-send');
  ok('message shows on the phone', await until(async () => /ผู้กำกับ: ซูมเข้าหน้าผู้พูด/.test(await ph.textContent('#guest-bubble')) && await ph.isVisible('#guest-bubble'), 4000));
  ok('phone shows its studio name and tally pill', /MOBILE|กล้อง/i.test(await ph.textContent('.caller-title')) && /STANDBY|PREVIEW|ON AIR/.test(await ph.textContent('#cam-tally')), await ph.textContent('.caller-title'));
  await host.click('.cam-ctl .cam-rec');
  ok('studio starts recording on the phone', await until(() => ph.isVisible('.pc-rec'), 4000) && await until(() => host.evaluate(i => !!window.webmix.inputs.find(x => x.id === i).cam.rec, id), 4000));
  ok('card shows the phone is recording', /● REC/.test(await host.textContent(`.card[data-id="${id}"] .card-sub`)));
  await ph.waitForTimeout(2500);
  const dl = ph.waitForEvent('download', { timeout: 10000 });
  await host.click('.cam-ctl .cam-rec');
  const d = await dl;
  ok('stopping saves a file on the phone', /^WebMix-Cam-\d{8}-\d{6}\.(webm|mp4)$/.test(d.suggestedFilename()), d.suggestedFilename());
  await host.click('.cam-ctl .cam-lock');
  ok('studio locks AE/AWB/AF', await until(() => ph.evaluate(() => window.__applied.some(a => a.exposureMode === 'manual' && a.whiteBalanceMode === 'manual' && a.focusMode === 'manual')), 4000) && await until(async () => (await ph.textContent('[data-pc=lock] b')) === 'ON', 3000));
  ok('studio shows the live picture', await until(() => host.evaluate(() => document.querySelector('.cc-video video').videoWidth > 0), 4000));
  { const vb = await host.locator('.cc-video video').boundingBox(); await host.mouse.click(vb.x + vb.width * 0.3, vb.y + vb.height * 0.6); }
  ok('tapping the studio picture focuses the phone there', await until(() => ph.evaluate(() => window.__applied.some(a => a.pointsOfInterest && Math.abs(a.pointsOfInterest[0].x - 0.3) < 0.05)), 4000));
  await host.click('.cc-tabs [data-tab=color]');
  await host.evaluate(() => { const r = document.querySelector('.cc-color [data-cc=s]'); r.value = 0.5; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('colour tab adjusts the source', await host.evaluate(i => window.webmix.inputs.find(x => x.id === i).color?.s === 0.5, id));
  await host.click('.cc-color .cc-reset'); await host.click('.cc-tabs [data-tab=cam]');
  await host.screenshot({ path: process.env.WORK + '/procam-studio.png' });
  await host.click('.modal-foot .btn-primary');
  await ph.tap('[data-pc=exp]'); await ph.waitForTimeout(300);
  await ph.screenshot({ path: process.env.WORK + '/procam-phone.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
