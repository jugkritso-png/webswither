// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// รีโมตคอนโทรล: QR/ลิงก์มีรหัส · แท็บเล็ตเห็นแหล่งภาพ + PVW/PGM + ภาพย่อ · แตะ = Preview, แตะสองครั้ง = Program · CUT / FTB / ทรานซิชัน ·
// Overlay · เสียง Master (ระดับ + ปิดเสียง) · Macro · รหัสผิดถูกปฏิเสธ · สร้างรหัสใหม่ = ตัดรีโมตเดิม
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({},o||{},{host:'127.0.0.1',port:9900,path:'/',secure:false});return id?new P(id,o):new P(o);};window.Peer.prototype=P.prototype;})();`;
const qrLib = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route('**/qrcode.min.js', r => r.fulfill({ contentType: 'application/javascript', body: qrLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const hctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await setup(hctx);
  const host = await hctx.newPage(); host.on('pageerror', e => errs.push('host ' + e.message));
  await host.goto('http://localhost:8765/index.html'); await host.evaluate(() => localStorage.clear()); await host.reload();
  await until(() => host.evaluate(() => window.webmix.wireless.status === 'ready'));
  // Overlay 1 = แหล่งภาพที่ 3 · Macro หนึ่งอัน
  await host.evaluate(() => { const w = window.webmix; w.ovl[0].inputId = w.inputs[2].id; w.macros.push({ id: 'm1', name: 'จอดำ', key: '', at: '', steps: [{ a: 'ftbOn', v: '' }] }); });

  await host.click('[data-action=remote]'); await host.waitForSelector('#remote-link');
  const link = await host.inputValue('#remote-link');
  ok('remote link carries studio id and key; QR shown', /[?&]remote=webmix-/.test(link) && /[?&]k=[a-z0-9]{12}/.test(link) && !!(await host.$('#remote-qr canvas, #remote-qr img')), link);
  await host.click('.modal-foot .btn-primary');

  const tctx = await b.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true }); await setup(tctx);
  const tab = await tctx.newPage(); tab.on('pageerror', e => errs.push('remote ' + e.message));
  await tab.goto(link);
  const connected = await until(() => tab.evaluate(() => document.getElementById('remote')?.dataset.conn === 'ok' && document.querySelectorAll('.rmt-in').length > 0));
  ok('tablet connects and lists the sources', connected && await tab.locator('.rmt-in').count() === await host.evaluate(() => window.webmix.inputs.length));
  ok('studio UI hidden on the remote', !(await tab.isVisible('#pgm-canvas')) && await tab.isVisible('.rmt-btn.cut'));
  const hs = () => host.evaluate(() => { const w = window.webmix; return { pgm: w.state.programId, pvw: w.state.previewId, ids: w.inputs.map(i => i.id), ftb: w.ftb.target, trans: w.settings.transition, ovl0: w.ovl[0].on, db: w.audio.masterStrip.db, muted: w.audio.masterStrip.muted }; });
  let h = await hs();
  ok('PGM / PVW marked like the studio', await tab.locator(`.rmt-in.pgm[data-v="${h.pgm}"]`).count() === 1 && await tab.locator(`.rmt-in.pvw[data-v="${h.pvw}"]`).count() === 1);
  ok('Preview / Program thumbnails arrive', await until(() => tab.evaluate(() => [...document.querySelectorAll('.rmt-mon img')].every(i => i.src.startsWith('data:image/jpeg')))));

  // แตะ = Preview
  const target = h.ids.find(id => id !== h.pgm && id !== h.pvw);
  await tab.locator(`.rmt-in[data-v="${target}"]`).tap();
  ok('tap sets Preview on the studio', await until(async () => (await hs()).pvw === target, 4000));
  ok('remote follows: new PVW marked', await until(() => tab.locator(`.rmt-in.pvw[data-v="${target}"]`).count().then(n => n === 1), 3000));
  // CUT
  const before = await hs();
  await tab.click('[data-r=cut]');
  ok('CUT swaps Program and Preview', await until(async () => { const x = await hs(); return x.pgm === before.pvw && x.pvw === before.pgm; }, 4000));
  // แตะสองครั้ง = ตัดเข้า Program
  const other = (await hs()).ids.find(id => id !== (before.pvw) && id !== before.pgm);
  await tab.locator(`.rmt-in[data-v="${other}"]`).click(); await tab.locator(`.rmt-in[data-v="${other}"]`).click();
  ok('double tap takes a source straight to Program', await until(async () => (await hs()).pgm === other, 4000));
  // ทรานซิชัน + FTB
  await tab.click('[data-r=trans][data-v=wipe]');
  ok('transition picked from the remote', await until(async () => (await hs()).trans === 'wipe', 3000));
  await tab.click('[data-r=ftb]');
  ok('FTB from the remote, badge shows', await until(async () => (await hs()).ftb === 1, 3000) && await until(() => tab.locator('.rmt-badge.ftb').count().then(n => n === 1), 3000));
  await tab.click('[data-r=ftb]');
  // Overlay
  await tab.locator('[data-r=ovl][data-v="0"]').click();
  ok('overlay 1 toggled on from the remote', await until(async () => (await hs()).ovl0 === true, 3000) && await until(() => tab.locator('.rmt-ov.is-on').count().then(n => n === 1), 3000));
  await tab.locator('[data-r=ovl][data-v="0"]').click();
  // เสียง Master
  await tab.evaluate(() => { const r = document.querySelector('.rmt-ch[data-key=master] input'); r.value = -12; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('Master fader moves the studio level', await until(async () => Math.abs((await hs()).db + 12) < 0.01, 3000));
  await tab.click('.rmt-ch[data-key=master] .rmt-mute');
  ok('mute from the remote', await until(async () => (await hs()).muted === true, 3000));
  // Macro
  ok('macro buttons listed', await tab.locator('.rmt-mac').count() === 1 && (await tab.textContent('.rmt-mac')).includes('จอดำ'));
  await tab.click('.rmt-mac');
  ok('macro runs on the studio', await until(async () => (await hs()).ftb === 1, 4000));
  await tab.screenshot({ path: S + '/remote.png', fullPage: true });

  // รหัสผิด → ปฏิเสธ
  const bad = await tctx.newPage();
  await bad.goto(link.replace(/k=[a-z0-9]+/, 'k=wrongwrongxx'));
  ok('wrong key is refused with a clear message', await until(() => bad.evaluate(() => document.getElementById('remote')?.dataset.conn === 'bad' && /รหัสรีโมต/.test(document.querySelector('.rmt-status').textContent)), 15000));
  ok('studio counts only the real remote', await host.evaluate(() => window.webmix.remote.conns.size) === 1);
  // สร้างรหัสใหม่ → รีโมตเดิมถูกตัด
  await host.click('[data-action=remote]'); await host.waitForSelector('#remote-link');
  await host.click('.modal-foot button:has-text("สร้างรหัสใหม่")');
  await host.waitForSelector('#remote-link');
  const link2 = await host.inputValue('#remote-link');
  ok('new key issued', link2 !== link && /k=[a-z0-9]{12}/.test(link2));
  ok('old remote disconnected after re-key', await until(() => tab.evaluate(() => document.getElementById('remote').dataset.conn === 'bad'), 6000));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
