// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แหล่งสำรอง: ตั้งค่าในหน้าเอาต์พุต · กล้องบน Program หลุดระหว่างบันทึก → ตัดไปแหล่งสำรองหลังเวลาที่ตั้ง · กล้องกลับมา = ปุ่ม “กลับไป…”
// · ตัดกลับเองเมื่อเปิดไว้ · ไม่ได้ไลฟ์/บันทึก = ไม่ตัด · ผู้คุมสลับภาพเองระหว่างนั้น = เลิกดูแล
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("กล้อง /")'); await p.waitForSelector('.modal-foot .btn-primary'); await p.click('.modal-foot .btn-primary');
  await p.waitForFunction(() => window.webmix.inputs.some(i => i.type === 'camera' && i.status === 'live'), null, { timeout: 10000 }).catch(() => {});
  const { cam, bars } = await p.evaluate(() => ({ cam: window.webmix.inputs.find(i => i.type === 'camera').id, bars: window.webmix.inputs.find(i => i.type === 'bars').id }));

  // ตั้งค่า: หลุด → ตัดไป Bars หลัง 1 วินาที
  await p.click('[data-action=settings]'); await p.waitForSelector('.set-modal');
  await p.click('[data-mtab=output]').catch(() => {});
  await p.selectOption('.set-modal [name=failId]', bars); await p.fill('.set-modal [name=failSec]', '1');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const cfg = await p.evaluate(() => window.webmix.settings.failover);
  ok('backup source set in Output settings', cfg.id === bars && cfg.sec === 1 && cfg.back === false, JSON.stringify(cfg));

  const pgm = () => p.evaluate(() => window.webmix.state.programId);
  const drop = () => p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); i.stream.getVideoTracks()[0].dispatchEvent(new Event('ended')); }, cam);
  const back = () => p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); i.status = 'live'; }, cam);
  await p.evaluate(id => { window.webmix.setPreview(id); window.webmix.cut(); }, cam);

  // ไม่ได้ไลฟ์/บันทึก: หลุดแล้วไม่ตัดให้ (แค่แจ้งเตือน)
  await drop(); await sleep(1800);
  ok('not live or recording: the lost camera stays on Program', await pgm() === cam);
  await back(); await sleep(400);

  // ระหว่างบันทึก: หลุด → ยังไม่ตัดก่อน 1 วินาที → ตัดไป Bars
  await p.click('[data-action=record]'); await p.waitForFunction(() => window.webmix.rec.active, null, { timeout: 8000 });
  await drop(); await sleep(400);
  ok('waits the set time before switching', await pgm() === cam);
  await sleep(1300);
  ok('camera lost while recording → Program cut to the backup', await pgm() === bars);
  ok('toast says what happened', /หลุด — ตัดไป/.test(await p.textContent('#toasts')), await p.textContent('#toasts'));
  ok('the lost camera waits on Preview', await p.evaluate(() => window.webmix.state.previewId) === cam);

  // กล้องกลับมา: มีปุ่มกลับไป (ไม่ตัดกลับเอง เพราะไม่ได้ติ๊ก)
  await back(); await sleep(3800);
  ok('camera back: does not cut back by itself', await pgm() === bars);
  const btn = p.locator('#toasts .toast-action', { hasText: 'กลับไป' });
  ok('…offers a “back to camera” button', await btn.count() === 1);
  await btn.click(); await sleep(300);
  ok('button cuts back to the camera', await pgm() === cam);

  // ตัดกลับเองเมื่อเปิดไว้
  await p.evaluate(() => { window.webmix.settings.failover.back = true; });
  await drop(); await sleep(1600);
  ok('lost again → backup', await pgm() === bars);
  await back(); await sleep(1500);
  ok('auto-return waits for 3 s of stable signal', await pgm() === bars);
  await sleep(2200);
  ok('…then cuts back by itself', await pgm() === cam);

  // ผู้คุมสลับภาพเองระหว่างใช้ภาพสำรอง = เลิกดูแล ไม่ตัดกลับทับ
  await drop(); await sleep(1600);
  const clock = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'clock').id);
  await p.evaluate(id => { window.webmix.setPreview(id); window.webmix.cut(); }, clock);
  await back(); await sleep(3800);
  ok('operator took another shot: no cut back over it', await pgm() === clock && !(await p.evaluate(() => window.webmix.failover.from)));

  // แหล่งสำรองเลือกไม่ได้เป็นตัวเอง / ถูกลบ = ไม่ทำอะไร
  await p.evaluate(id => { window.webmix.setPreview(id); window.webmix.cut(); }, cam);
  await p.evaluate(() => { window.webmix.settings.failover.id = 'gone'; });
  await drop(); await sleep(1600);
  ok('backup missing: nothing happens', await pgm() === cam);
  await p.click('[data-action=record]').catch(() => {});
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
