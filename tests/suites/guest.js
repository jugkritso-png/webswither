// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แขกรับเชิญทางไกล (แบบ vMix Call): ลิงก์เชิญ, ภาพ/เสียงไป-กลับ, mix-minus, tally, เชื่อมต่อกลับหลังรีเฟรช, ลบแขก
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({host:'127.0.0.1',port:9900,path:'/',secure:false},o||{});return id?new P(id,o):new P(o);};})();`;
const qrLib = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route('**/qrcode.min.js', r => r.fulfill({ contentType: 'application/javascript', body: qrLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 300)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const hctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await setup(hctx);
  const host = await hctx.newPage(); host.on('pageerror', e => errs.push('host ' + e.message));
  await host.goto('http://localhost:8765/index.html'); await host.evaluate(() => localStorage.clear()); await host.reload();
  await until(() => host.evaluate(() => window.webmix.wireless.status === 'ready'));

  // --- invite
  await host.click('[data-action=add-menu]'); await host.click('.menu button:has-text("แขกรับเชิญทางไกล")');
  await host.waitForSelector('.modal [name=name]'); await host.fill('.modal [name=name]', 'คุณสมศรี'); await host.click('.modal-foot .btn-primary');
  await host.waitForSelector('#guest-link');
  const link = await host.inputValue('#guest-link');
  ok('invite link with guest slot and name', /[?&]call=webmix-/.test(link) && /[?&]guest=[a-z0-9]+/.test(link) && /n=%E0%B8%84/.test(link), link);
  ok('invite shows a QR code', !!(await host.$('.modal #qr-target canvas, .modal #qr-target img')));
  await host.click('.modal-foot .btn-primary');
  const gid = await host.evaluate(() => window.webmix.inputs.find(i => i.type === 'guest').id);
  ok('guest input waits for the guest', await host.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); return i.status !== 'live' && i.missing; }, gid));

  // --- guest joins
  const gctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['camera', 'microphone'] }); await setup(gctx);
  const guest = await gctx.newPage(); guest.on('pageerror', e => errs.push('guest ' + e.message));
  await guest.goto(link);
  ok('guest sees a join screen with their name', await guest.isVisible('#guest-join') && (await guest.textContent('#guest-join-name')) === 'คุณสมศรี');
  await guest.click('#guest-join-btn');
  const joined = await until(() => host.evaluate(id => window.webmix.inputs.find(x => x.id === id).status === 'live', gid), 20000);
  ok('guest video + audio arrive as the input', joined && await host.evaluate(id => window.webmix.audio.channels.some(c => c.inputId === id), gid));
  ok('no duplicate input created', await host.evaluate(() => window.webmix.inputs.filter(i => i.type === 'guest' || i.type === 'wireless').length) === 1);
  const ret = await until(() => guest.evaluate(() => { const v = document.querySelector('#guest-return'); return !v.hidden && v.videoWidth > 0 && v.srcObject && v.srcObject.getAudioTracks().length === 1; }), 15000);
  ok('guest receives program video + audio back', ret, JSON.stringify(await guest.evaluate(() => { const v = document.querySelector('#guest-return'); return { w: v.videoWidth, h: v.videoHeight, a: v.srcObject && v.srcObject.getAudioTracks().length }; })));
  ok('return picture limited to ≤ 720p', (await guest.evaluate(() => document.querySelector('#guest-return').videoHeight)) <= 720);
  ok('guest status connected', /เชื่อมต่อแล้ว/.test(await guest.textContent('#caller-status')));

  // --- mix-minus: what the guest hears never contains their own voice
  // วัดระดับเสียงสูงสุดใน 2.5 วินาที (เสียงไมค์ปลอมของ Chromium เป็นเสียงบี๊บเป็นช่วง ๆ)
  const level = (page, expr) => page.evaluate(async expr => {
    const stream = eval(expr);
    const ac = new AudioContext(); await ac.resume();
    const an = ac.createAnalyser(); an.fftSize = 2048; ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(2048); let peak = 0; const end = performance.now() + 2500;
    while (performance.now() < end) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); await new Promise(r => setTimeout(r, 40)); }
    ac.close(); return peak;
  }, expr);
  await host.click('body'); // ปลดล็อกเสียงของสตูดิโอ
  const mmExpr = `window.webmix.audio.mm.get(${JSON.stringify(gid)}).dest.stream`;
  const masterExpr = `window.webmix.audio.dest.stream`;
  const guestOnly = { master: await level(host, masterExpr), mm: await level(host, mmExpr) };
  ok('guest voice reaches the program mix', guestOnly.master > 0.02, guestOnly.master.toFixed(3));
  ok('…but not the guest’s own return feed (mix-minus)', guestOnly.mm < 0.005, guestOnly.mm.toFixed(4));
  const fc = host.waitForEvent('filechooser'); await host.click('[data-action=add-menu]'); await host.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/loud.webm');
  await host.waitForTimeout(1500);
  const withShow = await level(host, mmExpr);
  ok('guest hears the rest of the show', withShow > 0.05, withShow.toFixed(3));
  const atGuest = await level(guest, `document.querySelector('#guest-return').srcObject`);
  ok('show audio arrives at the guest page', atGuest > 0.02, atGuest.toFixed(3));

  // --- tally on the guest page (program + overlay count as on air)
  await host.evaluate(id => { const w = window.webmix; w.setPreview(id); w.cut(); }, gid);
  ok('tally ON AIR on the guest page', await until(() => guest.evaluate(() => document.querySelector('#caller').classList.contains('tally-pgm')), 5000));
  await host.evaluate(() => window.webmix.cut());
  await until(() => guest.evaluate(() => !document.querySelector('#caller').classList.contains('tally-pgm')), 5000);
  await host.evaluate(id => window.webmix.toggleInputOverlay(id, 0), gid);
  ok('guest on an overlay is ON AIR too', await until(() => guest.evaluate(() => document.querySelector('#caller').classList.contains('tally-pgm')), 5000));
  await host.evaluate(id => window.webmix.toggleInputOverlay(id, 0), gid);

  // --- guest controls
  await guest.click('[data-caller=cam]');
  ok('guest can turn the camera off', await guest.evaluate(() => document.querySelector('#caller').classList.contains('cam-off') && !document.querySelector('#caller-video').srcObject.getVideoTracks()[0].enabled));
  await guest.click('[data-caller=cam]');
  await guest.waitForTimeout(800);
  ok('guest self-view shows their camera', await guest.evaluate(() => { const v = document.querySelector('#caller-video'); return v.videoWidth > 0 && !v.paused; }));
  await guest.screenshot({ path: S + '/guest.png' });

  // --- the same invite link opened twice
  const g2 = await gctx.newPage(); await g2.goto(link); await g2.click('#guest-join-btn');
  ok('second copy of the link is refused', await until(() => g2.evaluate(() => /เปิดอยู่ในอีกหน้าต่าง/.test(document.querySelector('#caller-msg').textContent)), 10000));
  await g2.close();

  // --- studio reload: the guest comes back into the same input
  await host.waitForTimeout(2000);
  await host.reload();
  const back = await until(() => host.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); return i && i.status === 'live'; }, gid), 30000);
  ok('after a studio reload the guest rejoins the same input', back && await host.evaluate(() => window.webmix.inputs.filter(i => i.type === 'guest').length) === 1);
  ok('guest name kept', await host.evaluate(id => window.webmix.inputs.find(x => x.id === id).name, gid) === 'คุณสมศรี');
  ok('return feed restored after reload', await until(() => guest.evaluate(() => document.querySelector('#guest-return').videoWidth > 0), 10000));

  // --- remove the guest
  const card = host.locator(`#inputs-grid .card[data-id="${gid}"]`);
  await card.hover(); await card.locator('[data-card=remove]').click(); await host.click('.modal-foot .btn-danger');
  ok('removed guest sees a goodbye message', await until(() => guest.evaluate(() => /จบการเชื่อมต่อ/.test(document.querySelector('#caller-msg').textContent)), 8000));
  ok('mix-minus bus released', await host.evaluate(id => !window.webmix.audio.mm.has(id), gid));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.stack); process.exit(1); });
