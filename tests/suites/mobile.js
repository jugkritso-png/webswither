// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium, devices } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({host:'127.0.0.1',port:9900,path:'/',secure:false},o||{});return id?new P(id,o):new P(o);};})();`;
const qrLib = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route('**/qrcode.min.js', r => r.fulfill({ contentType: 'application/javascript', body: qrLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  // studio on a phone
  const mctx = await b.newContext({ ...devices['iPhone 13'] }); await setup(mctx);
  const m = await mctx.newPage(); m.on('pageerror', e => errs.push('mobile ' + e.message));
  await m.goto('http://localhost:8765/index.html'); await m.waitForTimeout(1500);
  const [sw, iw] = await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  ok('phone layout fits the screen', sw === iw, `${sw} / ${iw}`);
  await m.screenshot({ path: S + '/m1.png', fullPage: true });
  await m.tap('.card >> nth=2'); await m.tap('.card >> nth=2'); 
  ok('double tap → program', (await m.evaluate(() => window.webmix.inputs.find(i => i.id === window.webmix.state.programId).name)) === 'CLOCK');
  await m.tap('[data-action=add-menu]'); await m.waitForTimeout(200); await m.screenshot({ path: S + '/m2.png' });
  await m.tap('.menu button:has-text("Slate")'); ok('add input from menu on phone', (await m.evaluate(() => window.webmix.inputs.length)) === 5);

  // studio desktop + phone camera
  const hctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await setup(hctx);
  const host = await hctx.newPage(); host.on('pageerror', e => errs.push('host ' + e.message));
  await host.goto('http://localhost:8765/index.html'); await host.waitForTimeout(2000);
  const link = await host.evaluate(() => window.webmix.wireless.link); ok('wireless link ready', /\?call=webmix-/.test(link), link);
  const cctx = await b.newContext({ ...devices['iPhone 13'], permissions: ['camera', 'microphone'] }); await setup(cctx);
  const cam = await cctx.newPage(); cam.on('pageerror', e => errs.push('cam ' + e.message));
  await cam.goto(link); await cam.waitForTimeout(5000);
  const st = () => host.evaluate(() => { const w = window.webmix; const mob = w.inputs.filter(i => i.type === 'wireless'); return { n: w.inputs.length, mob: mob.map(i => i.name + ':' + i.status + ':' + (i.el.videoWidth)), ch: w.audio.channels.length }; });
  let s0 = await st();
  ok('phone camera connects and streams', (await cam.textContent('#caller-status')).includes('เชื่อมต่อแล้ว') && s0.mob.length === 1 && /:live:\d+/.test(s0.mob[0]) && s0.ch === 1, JSON.stringify(s0));
  // put mobile on program -> tally
  await host.evaluate(() => { const w = window.webmix; const mob = w.inputs.find(i => i.type === 'wireless'); w.setPreview(mob.id); w.cut(); });
  await cam.waitForTimeout(800);
  ok('tally ON AIR on phone', (await cam.evaluate(() => document.querySelector('#caller').className)).includes('tally-pgm'));
  await cam.screenshot({ path: S + '/c1.png' });
  await host.evaluate(() => window.webmix.cut()); await cam.waitForTimeout(800);
  ok('tally PREVIEW on phone', (await cam.evaluate(() => document.querySelector('#caller').className)).includes('tally-pvw'));
  await cam.tap('[data-caller=flip]'); await cam.waitForTimeout(2500); s0 = await st();
  ok('flip camera keeps a single input', s0.n === 5 && s0.mob.length === 1 && /:live:/.test(s0.mob[0]), JSON.stringify(s0));
  await cam.tap('[data-caller=mic]'); ok('mic toggle', await cam.evaluate(() => document.querySelector('#caller-mic').classList.contains('is-off')));
  await host.evaluate(() => { window.webmix.inputs.find(i => i.type === 'wireless').name = 'CAM HOST'; });
  await host.waitForTimeout(2000); // autosave
  await host.reload(); await host.waitForTimeout(9000);
  s0 = await st();
  ok('studio reload keeps link + phone reconnects', (await host.evaluate(() => window.webmix.wireless.link)) === link && s0.mob.length === 1 && /:live:/.test(s0.mob[0]), JSON.stringify(s0));
  ok('phone returns to its saved input (same name, no duplicate)', s0.n === 5 && /^CAM HOST:/.test(s0.mob[0]), JSON.stringify(s0));
  // remove the phone from studio
  const mi = await host.evaluate(() => window.webmix.inputs.findIndex(i => i.type === 'wireless'));
  const card = host.locator('.card').nth(mi); await card.hover(); await card.locator('[data-card=remove]').click(); await host.click('.modal-foot .btn-danger');
  await cam.waitForTimeout(5000);
  s0 = await st();
  ok('removing input disconnects the phone', s0.mob.length === 0 && (await cam.textContent('#caller-msg')).includes('นำกล้องนี้ออก'), JSON.stringify(s0));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
