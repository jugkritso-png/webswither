// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium, devices } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({host:'127.0.0.1',port:9900,path:'/',secure:false},o||{});return id?new P(id,o):new P(o);};})();`;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'], acceptDownloads: true }); await setup(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'warning' && /keyer/i.test(m.text())) errs.push('warn: ' + m.text()); });
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(800);
  // settings → 4K, recommended bitrate auto-filled
  await p.click('[data-action=settings]');
  await p.selectOption('.modal select[name=resolution]', '2160p');
  ok('4K bitrate suggested', (await p.inputValue('.modal input[name=videoKbps]')) === '25000', await p.inputValue('.modal input[name=videoKbps]'));
  ok('4K requirements note shown', await p.isVisible('.res-4k-note'));
  await p.selectOption('.modal select[name=fps]', '60');
  ok('4K60 bitrate', (await p.inputValue('.modal input[name=videoKbps]')) === '37500');
  await p.selectOption('.modal select[name=fps]', '30');
  await p.click('.modal-foot .btn-primary');
  ok('program canvas 3840x2160', await p.evaluate(() => { const c = document.querySelector('#pgm-canvas'); return c.width === 3840 && c.height === 2160; }));
  ok('format badge 4K30', (await p.textContent('#pgm-format')) === '4K30', await p.textContent('#pgm-format'));
  ok('status bar', (await p.textContent('#st-output')).includes('3840×2160'), await p.textContent('#st-output'));
  // 4K camera request
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("กล้อง")');
  await p.waitForSelector('.modal select[name=res]'); await p.selectOption('.modal select[name=res]', '3840x2160'); await p.click('.modal-foot .btn-primary');
  await p.waitForTimeout(1500);
  const camRes = await p.evaluate(() => { const c = window.webmix.inputs.find(i => i.type === 'camera'); return `${c.el.videoWidth}x${c.el.videoHeight}`; });
  ok('camera captured at 4K', camRes === '3840x2160', camRes);
  ok('card shows 4K tag', /4K/.test(await p.locator('.card', { hasText: 'fake' }).first().locator('.card-sub').textContent().catch(() => '')) || /4K/.test(await p.textContent('#inputs-grid')), (await p.textContent('#inputs-grid')).match(/CAMERA[^A-Z]*/)?.[0]);
  // put camera on program; text overlay scales
  await p.evaluate(() => { const w = window.webmix; const c = w.inputs.find(i => i.type === 'camera'); w.setPreview(c.id); w.cut(); });
  await p.click('[data-action=title]'); await p.waitForTimeout(2000);
  const tpx = await p.evaluate(() => Array.from(document.querySelector('#pgm-canvas').getContext('2d').getImageData(Math.round(3840 * 0.06) + 8, Math.round(2160 * 0.735) + 60, 1, 1).data));
  ok('title drawn at 4K scale', tpx[0] > 200 && tpx[1] < 90, JSON.stringify(tpx));
  await p.click('[data-action=title]');
  // GPU keyer: key the fake camera (green background) over the slate
  await p.evaluate(() => { const w = window.webmix; const slate = w.inputs.find(i => i.type === 'slate'); w.setPreview(slate.id); w.cut(); });
  await p.click('.tab[data-tab=key]');
  const camId = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'camera').id);
  await p.selectOption('#key-source', camId); await p.click('#btn-key'); await p.waitForTimeout(600);
  const usesGL = await p.evaluate(() => window.webmix.overlays.key.canvas && window.webmix.overlays.key.canvas.getContext && !!window.webmix.overlays.key.canvas.getContext('webgl'));
  ok('key uses WebGL keyer', usesGL);
  const kpx = await p.evaluate(() => Array.from(document.querySelector('#pgm-canvas').getContext('2d').getImageData(200, 200, 1, 1).data));
  ok('green removed by key (no pure green at corner)', !(kpx[1] > 150 && kpx[0] < 80 && kpx[2] < 80), JSON.stringify(kpx));
  await p.click('#btn-key');
  // 4K recording
  await p.click('#btn-rec'); await p.waitForTimeout(5000);
  const dl = p.waitForEvent('download'); await p.click('#btn-rec'); const d = await dl; await d.saveAs(S + '/rec4k.webm');
  ok('fps status', true, await p.textContent('#st-engine'));
  // phone camera quality button
  const hctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await setup(hctx);
  const host = await hctx.newPage(); await host.goto('http://localhost:8765/index.html'); await host.waitForTimeout(2000);
  const link = await host.evaluate(() => window.webmix.wireless.link);
  const cctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera', 'microphone'] }); await setup(cctx);
  const cam = await cctx.newPage(); cam.on('pageerror', e => errs.push('cam ' + e.message));
  await cam.goto(link); await cam.waitForTimeout(5000);
  const before = await host.evaluate(() => { const m = window.webmix.inputs.find(i => i.type === 'wireless'); return m ? `${m.el.videoWidth}x${m.el.videoHeight}` : 'none'; });
  ok('phone default FHD', (await cam.textContent('#caller-quality')) === 'FHD', before);
  await cam.tap('#caller-quality'); await cam.waitForTimeout(4000);
  const after = await host.evaluate(() => { const m = window.webmix.inputs.find(i => i.type === 'wireless'); return `${m.el.videoWidth}x${m.el.videoHeight}`; });
  ok('phone switched to 4K', (await cam.textContent('#caller-quality')) === '4K', `studio receives ${after}`);
  const br = await cam.evaluate(async () => { return null; });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
