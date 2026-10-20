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

  // แท็บล่างของมือถือ: แต่ละแท็บแสดงเฉพาะส่วนของตัวเอง
  const vis = sel => m.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; }, sel);
  ok('phone: switch tab shows program + inputs, hides mixer', await vis('#pgm-canvas') && await vis('#inputs-grid') && !(await vis('#mixer')));
  await m.tap('#m-tabs [data-mview=audio]');
  ok('phone: audio tab shows the mixer only', await vis('#mixer') && !(await vis('#inputs-grid')) && !(await vis('#pgm-canvas')));
  await m.tap('#m-tabs [data-mview=graphics]');
  ok('phone: graphics tab shows overlays + program', await vis('.overlays-panel') && await vis('#pgm-canvas') && !(await vis('#mixer')));
  await m.tap('#m-tabs [data-mmore]'); await m.waitForTimeout(150);
  ok('phone: more menu opens', await vis('.menu'));
  await m.tap('.menu button:has-text("คู่มือ")'); await m.waitForTimeout(200);
  ok('phone: more → help opens a dialog', await vis('.modal')); await m.tap('.modal [data-close]');
  await m.tap('#m-tabs [data-mview=switch]');
  ok('phone: REC and stream buttons stay reachable', await vis('#btn-rec') && await vis('#btn-stream'));
  // หยุดบันทึกบนมือถือ = กดค้าง (แตะเฉยๆ ไม่หยุด)
  await m.tap('#btn-rec'); await m.waitForTimeout(1500);
  ok('phone: recording started', await m.evaluate(() => window.webmix.rec.active));
  await m.tap('#btn-rec'); await m.waitForTimeout(300);
  await m.tap('.hold-btn'); await m.waitForTimeout(300);
  ok('phone: a tap on the hold button does not stop', await m.evaluate(() => window.webmix.rec.active));
  const hb = await m.locator('.hold-btn').boundingBox();
  await m.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await m.mouse.down(); await m.waitForTimeout(1900); await m.mouse.up();
  await m.waitForTimeout(800);
  ok('phone: holding 1.5 s stops recording', !(await m.evaluate(() => window.webmix.rec.active)));

  // ไลฟ์จากมือถือตามแบบ: หน้าเตรียมไลฟ์ (ตรวจความพร้อม) → นับถอยหลัง 3-2-1 → แผงไลฟ์ (สุขภาพ + ปลายทาง) → กดค้างหยุด → สรุป
  await m.waitForTimeout(500);
  await m.evaluate(() => { window.webmix.settings.destinations.forEach(d => { d.key = ''; }); });
  await m.tap('#btn-stream'); await m.waitForTimeout(300);
  ok('phone: pre-flight blocks a destination without a key', await vis('.pf-item.is-error') && (await m.locator('.modal-foot button:has-text("แก้ไขปลายทาง")').count()) === 1);
  await m.tap('.modal-foot button:has-text("ปิด")'); await m.waitForTimeout(200);
  const rx = listenRtmp(1951, 'mk', `${S}/mlive.flv`);
  await m.evaluate(() => { const st = window.webmix.settings; st.gateway = 'ws://127.0.0.1:8089/?token=abc'; st.destinations.splice(0, st.destinations.length, { id: 'mdest', platform: 'custom', server: 'rtmp://127.0.0.1:1951/live', key: 'mk', passphrase: '', latency: 500, enabled: true }); });
  await m.tap('#btn-stream'); await m.waitForTimeout(300);
  ok('phone: pre-flight lists checks and allows start', (await m.locator('.pf-item').count()) >= 4 && !(await vis('.pf-item.is-error')) && await vis('.btn-golive'));
  await m.screenshot({ path: S + '/m-preflight.png' });
  await m.tap('.modal-foot .btn-golive'); await m.waitForTimeout(400);
  ok('phone: 3-2-1 countdown before going live', await vis('.m-countdown') && !(await m.evaluate(() => window.webmix.streamer.ws)));
  let live = false;
  for (let i = 0; i < 40 && !live; i++) { await m.waitForTimeout(500); live = await m.evaluate(() => window.webmix.streamer.dests.get('mdest')?.state === 'live'); }
  ok('phone: live after the countdown', live && !(await vis('.m-countdown')));
  await m.waitForTimeout(3000);
  await m.tap('#btn-stream'); await m.waitForTimeout(1300);
  ok('phone: live sheet shows health + destination card', await vis('.m-live .ml-health') && (await m.locator('.m-live .ml-dest.is-live').count()) === 1 && /fps/.test(await m.textContent('.ml-stats')),
    await m.textContent('.m-live .dest-live'));
  ok('phone: bitrate sparkline drawn', ((await m.getAttribute('.ml-line', 'd')) || '').length > 10);
  await m.screenshot({ path: S + '/m-live.png' });
  await m.tap('.m-live .dest-stop-all'); await m.waitForTimeout(300);
  const sb = await m.locator('.hold-btn').boundingBox();
  await m.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await m.mouse.down(); await m.waitForTimeout(1900); await m.mouse.up();
  await m.waitForTimeout(1200);
  ok('phone: summary after stopping', await vis('.sum-grid') && /จบไลฟ์/.test(await m.textContent('.modal')) && (await m.locator('.sum-dests > div').count()) === 1, await m.evaluate(() => document.querySelector('.modal')?.textContent.slice(0, 200)));
  await m.screenshot({ path: S + '/m-summary.png' });
  await m.tap('.modal-foot .btn-primary'); rx.kill('SIGINT');
  ok('phone: alert container idle when nothing is wrong', await m.evaluate(() => document.querySelector('#m-alerts').hidden));

  // iPad (แนวตั้ง/แนวนอน): พอดีจอ ปุ่มใหญ่พอให้นิ้วกด และเพิ่มลงหน้าจอโฮมได้ (manifest + apple-touch-icon)
  for (const dev of ['iPad Pro 11', 'iPad Pro 11 landscape']) {
    const tctx = await b.newContext({ ...devices[dev] }); await setup(tctx);
    const t = await tctx.newPage(); t.on('pageerror', e => errs.push('ipad ' + e.message));
    await t.goto('http://localhost:8765/index.html'); await t.waitForTimeout(1200);
    const r = await t.evaluate(() => {
      const h = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : -1; };
      return { fit: document.documentElement.scrollWidth === innerWidth, mini: h('.card .mini'), ovl: h('.card-ovl button'), seg: h('#seg-transition button'), cut: h('[data-action=cut]'), tab: h('.tab'),
        kbd: [...document.querySelectorAll('kbd')].some(k => k.getClientRects().length), mtabs: getComputedStyle(document.querySelector('#m-tabs')).display };
    });
    ok(`${dev}: fits the screen, touch-size controls`, r.fit && r.mini >= 36 && r.ovl >= 28 && r.seg >= 40 && r.cut >= 56 && r.tab >= 48 && !r.kbd && r.mtabs === 'none', JSON.stringify(r));
    await t.tap('.card >> nth=1'); await t.tap('[data-action=cut]');
    ok(`${dev}: tap card + CUT switches program`, (await t.evaluate(() => window.webmix.inputs.find(i => i.id === window.webmix.state.programId).name)) === 'COLOR BARS');
    if (dev === 'iPad Pro 11') {
      const man = await t.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const j = await (await fetch(l.href)).json(); const icon = document.querySelector('link[rel=apple-touch-icon]'); const ir = await fetch(icon.href); return { name: j.name, display: j.display, icons: j.icons.length, apple: ir.ok }; });
      ok('home-screen manifest + icon', man.name === 'WebMix Pro' && man.display === 'standalone' && man.icons >= 2 && man.apple, JSON.stringify(man));
    }
    await tctx.close();
  }

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
