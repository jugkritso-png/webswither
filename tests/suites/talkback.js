// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ทอล์กแบ็ก (อินเตอร์คอมทีมงาน): รีโมตกดค้างพูด → อีกเครื่องได้ยิน (วัดระดับเสียงจริง) + เห็นชื่อคนพูด · ปล่อย = เงียบ ·
// เครื่องหลักกดค้างปุ่ม TALK → ทุกรีโมตได้ยิน · เสียงทอล์กแบ็กไม่เข้า Program
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({},o||{},{host:'127.0.0.1',port:9900,path:'/',secure:false});return id?new P(id,o):new P(o);};window.Peer.prototype=P.prototype;})();`;
const qrLib = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route('**/qrcode.min.js', r => r.fulfill({ contentType: 'application/javascript', body: qrLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.grantPermissions(['microphone']);
}
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
// ระดับเสียงสูงสุด (RMS) ของเสียงทอล์กแบ็กที่รีโมตได้รับ ในช่วง ms
const heard = (pg, ms = 2500) => pg.evaluate(ms => new Promise(res => {
  const s = window.WebMix.remoteTalk.el.srcObject;
  if (!s) return res(-1);
  const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(s); const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(2048); let max = 0;
  const t = setInterval(() => { an.getFloatTimeDomainData(buf); let x = 0; for (const v of buf) x += v * v; max = Math.max(max, Math.sqrt(x / buf.length)); }, 40);
  setTimeout(() => { clearInterval(t); ctx.close(); res(max); }, ms);
}), ms);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const errs = [];
  const hctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await setup(hctx);
  const host = await hctx.newPage(); host.on('pageerror', e => errs.push('host ' + e.message));
  await host.goto('http://localhost:8765/index.html'); await host.evaluate(() => localStorage.clear()); await host.reload();
  await until(() => host.evaluate(() => window.webmix.wireless.status === 'ready'));
  ok('TALK button hidden while no team is connected', await host.locator('#btn-talk').isHidden());
  await host.click('[data-action=remote]'); await host.waitForSelector('#remote-link');
  const pin = (await host.textContent('#remote-pin')).replace(/\D/g, '');
  const link = await host.inputValue('#remote-link');
  await host.click('.modal-foot .btn-primary');
  const join = async name => {
    const c = await b.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true }); await setup(c);
    const pg = await c.newPage(); pg.on('pageerror', e => errs.push(name + ' ' + e.message));
    await pg.goto(link); await pg.waitForSelector('.rmt-pair:not([hidden])');
    await pg.fill('.rmt-pair [name=name]', name); await pg.fill('.rmt-pair [name=pin]', pin); await pg.click('.rmt-pair-go');
    return pg;
  };
  const A = await join('เอ'), B = await join('บี');
  ok('both remotes get the talk bar and an audio line to the main machine', await until(async () => await A.isVisible('.rmt-ptt') && await B.isVisible('.rmt-ptt') && await host.evaluate(() => window.webmix.remote.talks.size) === 2 && await B.evaluate(() => !!window.WebMix.remoteTalk.el.srcObject)));
  ok('TALK button appears on the main machine', await host.locator('#btn-talk').isVisible());
  // Program เงียบ (ปิดทุกช่อง) เพื่อตรวจว่าเสียงทอล์กแบ็กไม่เข้า
  await host.evaluate(() => { const a = window.webmix.audio; a.ensure(); for (const c of a.channels) { c.muted = true; a.applyGain(c); } });
  const quiet = await heard(B, 1500);
  ok('silence before anyone talks', quiet >= 0 && quiet < 0.003, quiet.toFixed(4));

  // A กดค้างพูด
  const box = await A.locator('.rmt-ptt').boundingBox();
  await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await A.mouse.down();
  ok('pressing shows the talk button active', await until(() => A.evaluate(() => document.querySelector('.rmt-ptt').classList.contains('is-on')), 3000));
  ok('main machine knows who is talking', await until(() => host.evaluate(() => window.webmix.remote.talking.has('เอ')), 5000) && await until(async () => (await host.textContent('#btn-talk .talk-who')).includes('เอ'), 3000));
  ok('the other remote shows the speaker', await until(async () => (await B.textContent('.rmt-talking')).includes('เอ'), 4000));
  const lvl = await heard(B, 3000);
  ok('the other remote hears the voice', lvl > 0.01, lvl.toFixed(4));
  const pgm = await host.evaluate(() => new Promise(res => { const a = window.webmix.audio; const buf = new Float32Array(a.analyser.fftSize); let m = 0; const t = setInterval(() => { a.analyser.getFloatTimeDomainData(buf); for (const v of buf) m = Math.max(m, Math.abs(v)); }, 40); setTimeout(() => { clearInterval(t); res(m); }, 1500); }));
  ok('talkback does not reach Program', pgm < 0.001, pgm.toFixed(5));
  await A.mouse.up();
  ok('releasing clears the speaker', await until(async () => !(await host.evaluate(() => window.webmix.remote.talking.size)) && await B.locator('.rmt-talking').isHidden(), 4000));
  await new Promise(r => setTimeout(r, 800));
  const after = await heard(B, 1500);
  ok('…and the line goes quiet', after < 0.003, after.toFixed(4));

  // เครื่องหลักกดค้าง TALK
  const tb = await host.locator('#btn-talk').boundingBox();
  await host.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await host.mouse.down();
  ok('main machine TALK: remotes see "เครื่องหลัก"', await until(async () => (await A.textContent('.rmt-talking')).includes('เครื่องหลัก') && (await B.textContent('.rmt-talking')).includes('เครื่องหลัก'), 5000));
  const lh = await heard(A, 3000);
  ok('remotes hear the main machine', lh > 0.01, lh.toFixed(4));
  await host.screenshot({ path: S + '/talkback-host.png', clip: { x: 700, y: 0, width: 740, height: 70 } });
  await host.mouse.up();
  await B.screenshot({ path: S + '/talkback-remote.png' });
  // ปิดฟัง
  await B.click('.rmt-listen');
  ok('listen toggle mutes the team audio on that device', await B.evaluate(() => window.WebMix.remoteTalk.el.muted));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
