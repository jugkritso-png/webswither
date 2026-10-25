// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// หน้าต่าง Instant Replay (แบบใหม่): จับคลิปจากหน้าต่าง · คลิปไฮไลต์ · IN / OUT · ปุ่มความเร็ว · เล่นออก Program · หยุดที่ OUT แล้วกลับภาพเดิม
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  const bars = await p.evaluate(() => { const w = window.webmix; return (w.state.programId = w.inputs.find(i => i.type === 'bars').id); });
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Instant Replay")'); await p.waitForTimeout(6000);
  const id = await p.evaluate(() => window.webmix.inputs.find(x => x.type === 'replay').id);
  const card = p.locator(`.card[data-id="${id}"]`); await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('.rp-modal');
  ok('buffer status shown', (await p.textContent('.rp-buf')).includes('บัฟเฟอร์'));
  await p.click('.rp-modal [data-rp=cap]'); await p.waitForTimeout(2500);
  const R = () => p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); return { st: i.status, clips: (i.clips || []).length, a: i.clipStart, l: i.clipLen, dur: i.el.duration, t: i.el.currentTime, speed: i.replay.speed, paused: i.el.paused }; }, id);
  let r = await R();
  ok('capture from the dialog', r.st === 'live' && r.clips === 1, JSON.stringify(r));
  ok('highlight clip listed', (await p.$$('.rp-clip')).length === 1);
  // IN 1 วิ · OUT 2.5 วิ
  await p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); i.el.currentTime = i.clipStart + 1; }, id); await p.waitForTimeout(300);
  await p.click('.rp-modal [data-rp=in]');
  await p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); i.el.currentTime = i.clipStart + 1.5; }, id); await p.waitForTimeout(300);
  await p.click('.rp-modal [data-rp=out]');
  r = await R();
  ok('IN / OUT set the range', Math.abs(r.l - 1.5) < 0.2, JSON.stringify(r));
  await p.click('.rp-modal [data-spd="1"]');
  ok('speed button sets 100%', (await R()).speed === 1);
  await p.click('.rp-modal [data-rp=air]');
  await p.waitForTimeout(1800);
  ok('“play to Program” takes the replay to air', await p.evaluate(id => window.webmix.state.programId === id, id));
  await p.waitForTimeout(3500);
  r = await R();
  ok('stops at OUT and returns to the previous picture', await p.evaluate(b => window.webmix.state.programId === b, bars) && r.t <= r.a + r.l + 0.3, JSON.stringify(r));
  await p.click('.rp-modal .modal-foot .btn-primary');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
