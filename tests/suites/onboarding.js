// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
// ใช้งานง่าย: ตั้งค่าครั้งแรก 3 ขั้น · ปุ่มทดสอบปลายทาง · ระดับคุณภาพ + วัดความเร็วเน็ต
const { listenRtmp, probe } = require('../lib');
const { chromium, devices } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const GW = 'ws://127.0.0.1:8089/?token=abc';
async function setup(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  // วัดความเร็วเน็ต: ตอบเร็ว ๆ แทน speed.cloudflare.com (เครื่องทดสอบไม่ออกอินเทอร์เน็ต)
  await ctx.route('https://speed.cloudflare.com/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' }));
}
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];

  // เปิดปกติ (ทดสอบอัตโนมัติ) → ไม่เด้งหน้าตั้งค่าครั้งแรก
  const c0 = await b.newContext(); await setup(c0);
  const p0 = await c0.newPage(); p0.on('pageerror', e => errs.push(e.message));
  await p0.goto('http://localhost:8765/index.html'); await p0.waitForTimeout(1200);
  ok('no welcome dialog for automation / returning users', (await p0.locator('.modal.ob').count()) === 0);
  await c0.close();

  // ผู้ใช้ใหม่: 3 ขั้น
  const ctx = await b.newContext(); await setup(ctx);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html#onboard'); await p.waitForSelector('.modal.ob', { timeout: 5000 });
  ok('welcome: step 1 of 3 (camera)', /ยินดีต้อนรับ/.test(await p.textContent('.modal.ob')) && (await p.locator('.ob-steps li.now').textContent()).includes('กล้อง'));
  await p.screenshot({ path: S + '/ob-1.png' });
  await p.click('.modal-foot button:has-text("ข้าม")');
  await p.waitForSelector('.ob-plats');
  ok('step 2: platform tiles + key help', (await p.locator('.ob-plat').count()) === 4 && /YouTube Studio/.test(await p.textContent('.ob-help')));
  await p.click('.ob-plat:has-text("Facebook")');
  ok('help text follows the platform', /facebook\.com\/live\/producer/.test(await p.textContent('.ob-help')));
  await p.click('.ob-plat:has-text("อื่น ๆ")');
  ok('custom platform shows the server field', await p.isVisible('.ob-server'));
  if (await p.locator('.modal input[name=gateway]').count()) await p.fill('.modal input[name=gateway]', GW);
  else await p.evaluate(g => { window.webmix.settings.gateway = g; }, GW);

  // ทดสอบปลายทางที่ไม่มีใครรับ → แจ้งว่าไม่ผ่าน
  await p.fill('.modal input[name=server]', 'rtmp://127.0.0.1:1969/live');
  await p.fill('.modal input[name=key]', 'nobody');
  await p.click('.ob-test-btn');
  await p.waitForSelector('.ob-test .dest-test-out.err, .ob-test .dest-test-out.ok', { timeout: 30000 });
  ok('test to a dead server fails clearly', await p.locator('.ob-test .dest-test-out.err').count() === 1, await p.textContent('.ob-test .dest-test-out'));

  // ทดสอบปลายทางที่รับได้ → ผ่าน และไม่ค้างสถานะไลฟ์ / ไม่เด้งสรุป
  const rx = listenRtmp(1971, 'ob', `${S}/ob.flv`);
  await p.waitForTimeout(500);
  await p.fill('.modal input[name=server]', 'rtmp://127.0.0.1:1971/live');
  await p.fill('.modal input[name=key]', 'ob');
  await p.click('.ob-test-btn');
  await p.waitForFunction(() => document.querySelector('.ob-test .dest-test-out')?.textContent.startsWith('✓') || document.querySelector('.ob-test .dest-test-out.err'), null, { timeout: 30000 }).catch(() => {});
  const testOut = await p.textContent('.ob-test .dest-test-out');
  ok('test to a working server passes', testOut.startsWith('✓'), testOut);
  await p.waitForTimeout(1500);
  ok('test stops by itself, no live state left', await p.evaluate(() => !window.webmix.streamer.ws && !window.webmix.streamer.active && !window.webmix.streamer.testing));
  ok('test shows no summary / stop toast', (await p.locator('.sum-grid').count()) === 0 && !(await p.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /หยุดสตรีม|การสตรีมหยุด/.test(t.textContent)))));
  rx.kill('SIGINT'); await p.waitForTimeout(800);
  ok('receiver got the test video', /h264/.test(probe(`${S}/ob.flv`)), probe(`${S}/ob.flv`));
  await p.screenshot({ path: S + '/ob-2.png' });
  await p.click('.modal-foot button:has-text("ถัดไป")');

  // ขั้นที่ 3: คุณภาพ + วัดความเร็วเน็ต
  await p.waitForSelector('.q-picker');
  ok('step 3: three quality levels, "standard" preselected', (await p.locator('.q-opt').count()) === 3 && await p.isChecked('input[name=quality][value=std]'));
  await p.click('.q-speed-btn');
  await p.waitForFunction(() => /แนะนำ|วัดความเร็วไม่ได้/.test(document.querySelector('.q-speed-out').textContent), null, { timeout: 15000 });
  ok('speed test recommends a level', /แนะนำ/.test(await p.textContent('.q-speed-out')), await p.textContent('.q-speed-out'));
  await p.click('.q-opt:has-text("ประหยัดเน็ต")');
  await p.screenshot({ path: S + '/ob-3.png' });
  await p.click('.modal-foot button:has-text("เสร็จสิ้น")');
  await p.waitForTimeout(400);
  const st = await p.evaluate(() => { const s = window.webmix.settings; return { res: s.resolution, fps: s.fps, kbps: s.videoKbps, d: s.destinations.map(d => `${d.platform}|${d.server}|${d.key}|${d.enabled}`) }; });
  ok('wizard saved destination + quality', st.kbps === 2500 && st.res === '720p' && st.d[0] === 'custom|rtmp://127.0.0.1:1971/live|ob|true' && st.d.length === 1, JSON.stringify(st));
  ok('wizard does not open again', await (async () => { await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1200); return (await p.locator('.modal.ob').count()) === 0; })());

  // หน้าตั้งค่า: ระดับคุณภาพแทนตัวเลข · ตัวเลขอยู่ใน "ขั้นสูง" · ปุ่มทดสอบในแต่ละปลายทาง
  await p.click('[data-action=settings]');
  ok('settings: quality level shown, numbers tucked in advanced', await p.isChecked('.modal input[name=quality][value=eco]') && !(await p.isVisible('.modal select[name=resolution]')));
  await p.click('.modal .q-opt:has-text("คมชัดสูง")');
  await p.evaluate(() => { document.querySelector('.modal details.adv').open = true; });
  ok('picking a level fills the advanced fields', (await p.inputValue('.modal select[name=resolution]')) === '1080p' && (await p.inputValue('.modal input[name=videoKbps]')) === '6000');
  await p.fill('.modal input[name=videoKbps]', '5200');
  ok('custom numbers clear the level', !(await p.isChecked('.modal input[name=quality][value=high]')));
  await p.click('.modal .q-opt:has-text("คมชัดสูง")');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(400);
  ok('settings saved the level', await p.evaluate(() => window.webmix.settings.resolution === '1080p' && window.webmix.settings.videoKbps === 6000));
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]');
  ok('each destination has a test button', (await p.locator('.dest-row .dest-test-btn').count()) === (await p.locator('.dest-row').count()));
  await p.keyboard.press('Escape');

  // มือถือ: เมนูเพิ่มเติม → เริ่มต้นใช้งาน (แผ่นเลื่อนขึ้นจากล่าง)
  const mctx = await b.newContext({ ...devices['iPhone 13'] }); await setup(mctx);
  const m = await mctx.newPage(); m.on('pageerror', e => errs.push('mobile ' + e.message));
  await m.goto('http://localhost:8765/index.html'); await m.waitForTimeout(1000);
  await m.tap('#m-tabs [data-mmore]'); await m.waitForTimeout(150);
  await m.tap('.menu button:has-text("เริ่มต้นใช้งาน")'); await m.waitForTimeout(300);
  ok('phone: wizard opens from the more menu as a sheet', (await m.locator('.modal.ob.m-sheet').count()) === 1);
  await m.tap('.modal-foot button:has-text("ข้าม")'); await m.waitForTimeout(300);
  ok('phone: step 2 fits the screen', await m.evaluate(() => { const md = document.querySelector('.modal.ob'); return md && md.scrollWidth <= md.clientWidth + 1; }));
  await m.screenshot({ path: S + '/ob-phone.png' });

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
