// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Instant Replay: เก็บภาพย้อนหลังตลอดเวลา · กด I ได้คลิป N วินาทีล่าสุดใน Preview · ขึ้นจอแล้วเล่น จบแล้วกลับภาพเดิม · จำค่าไว้กับโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  // Program = Color Bars
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'bars').id; });
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Instant Replay")'); await p.waitForTimeout(300);
  const rp = () => p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'replay'); return i && { id: i.id, status: i.status, recs: i.rb ? i.rb.recs.length : -1, len: i.replay.len, speed: i.replay.speed, src: i.replay.source, paused: i.el.paused, rate: i.el.playbackRate, dur: i.el.duration, clipStart: i.clipStart, clipLen: i.clipLen, err: i.rbError || '' }; });
  let r = await rp();
  ok('tile adds a REPLAY source that starts buffering', r && r.recs === 1 && r.status !== 'live' && !r.err, JSON.stringify(r));
  ok('card has capture and speed buttons', await p.isVisible(`.card[data-id="${r.id}"] [data-card=rcap]`) && /½×/.test(await p.textContent(`.card[data-id="${r.id}"] [data-card=rspd]`)));

  // แก้ไข: ความยาว 5 วินาที
  const card = p.locator(`.card[data-id="${r.id}"]`); await card.hover(); await card.locator('[data-card=rename]').click();
  await p.selectOption('.modal select[name=len]', '5'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  r = await rp();
  ok('length can be changed (buffer restarts)', r.len === 5 && r.recs === 1, JSON.stringify(r));
  await p.waitForTimeout(7500);
  r = await rp();
  ok('two staggered recorders keep N–2N seconds', r.recs === 2, JSON.stringify(r));

  // กด I
  await p.keyboard.press('i');
  await p.waitForFunction(() => window.webmix.inputs.find(x => x.type === 'replay').status === 'live', null, { timeout: 8000 }).catch(() => {});
  r = await rp();
  ok('I captures the last 5 s into Preview', r.status === 'live' && await p.evaluate(id => window.webmix.state.previewId === id, r.id) && r.clipLen > 4 && r.clipLen <= 5.01 && r.clipStart > 0, JSON.stringify(r));
  ok('captured clip is seekable (has a duration)', isFinite(r.dur) && r.dur > 5, JSON.stringify(r));
  ok('clip waits paused at its start', r.paused);

  // ความเร็ว: ½× → ¼× → 1×
  await p.click(`.card[data-id="${r.id}"] [data-card=rspd]`); await p.click(`.card[data-id="${r.id}"] [data-card=rspd]`);
  r = await rp();
  ok('speed button cycles to 1×', r.speed === 1 && r.rate === 1);

  // AUTO → เล่น → จบแล้วกลับ Color Bars
  const bars = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'bars').id);
  await p.click('[data-action=auto]'); await p.waitForTimeout(1500);
  r = await rp();
  ok('AUTO puts the replay on air and plays it', await p.evaluate(id => window.webmix.state.programId === id, r.id) && !r.paused, JSON.stringify(r));
  const px = await p.evaluate(() => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; g.getContext('2d').drawImage(c, 0, 0); return Array.from(g.getContext('2d').getImageData(Math.round(c.width * 0.07), Math.round(c.height * 0.3), 1, 1).data.slice(0, 3)); });
  ok('replay shows the recorded Program picture (colour bars)', Math.min(...px) > 120, JSON.stringify(px));
  await p.waitForFunction(b => window.webmix.state.programId === b, bars, { timeout: 12000 }).catch(() => {});
  ok('when the clip ends it goes back to the previous source', await p.evaluate(b => window.webmix.state.programId === b, bars));
  r = await rp();
  ok('a new capture works after playing', await (async () => { await p.keyboard.press('i'); await p.waitForTimeout(1500); const x = await rp(); return x.paused && Math.abs(x.clipLen - 5) < 0.05; })());

  // กล้องเป็นแหล่งรีเพลย์
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("กล้อง")'); await p.waitForSelector('.modal-foot .btn-primary'); await p.click('.modal-foot .btn-primary');
  await p.waitForFunction(() => window.webmix.inputs.some(i => i.type === 'camera' && i.status === 'live'), null, { timeout: 8000 }).catch(() => {});
  await card.hover(); await card.locator('[data-card=rename]').click();
  const camId = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'camera').id);
  await p.selectOption('.modal select[name=source]', camId); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  r = await rp();
  ok('a camera can be the replay source', r.src === camId && r.recs === 1, JSON.stringify(r));

  // จำค่าไว้กับโชว์
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(1200);
  r = await rp();
  ok('replay source and settings survive a reload', r && r.len === 5 && r.speed === 1 && r.recs === 1, JSON.stringify(r));

  // ลบแล้วหยุดบัฟเฟอร์
  await p.evaluate(() => { window._rp = window.webmix.inputs.find(x => x.type === 'replay'); });
  const c2 = p.locator(`.card[data-id="${r.id}"]`); await c2.hover(); await c2.locator('[data-card=remove]').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(11000);
  ok('removing it stops the buffer', await p.evaluate(() => window._rp.rb === null && window._rp.removed));
  await p.screenshot({ path: S + '/replay.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
