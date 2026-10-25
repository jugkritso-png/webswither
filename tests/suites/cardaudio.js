// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แถบเสียงข้างการ์ดแหล่งภาพ: แสดงเฉพาะแหล่งที่มีเสียง · L/R ขยับตามเสียง · ปุ่มปิดเสียงบนการ์ด · ป้าย AFV · CLIP
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/loud.webm');
  await p.waitForFunction(() => window.webmix.audio.channels.some(c => c.inputId), null, { timeout: 10000 }).catch(() => {});
  const id = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'media').id);
  const card = `#inputs-grid .card[data-id="${id}"]`;
  await p.evaluate(() => { const a = window.webmix.audio; a.ensure(); a.ctx.resume(); });
  await p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); i.el.loop = true; i.el.play(); }, id);
  await p.waitForTimeout(1500);
  ok('video card shows the audio meter', await p.isVisible(`${card} .card-vu`));
  ok('video card shows the mute / dB button', await p.isVisible(`${card} .card-mute`));
  const cover = () => p.evaluate(c => [...document.querySelectorAll(c + ' .card-vu b')].map(b => parseFloat(b.style.height)), card);
  const h = await cover();
  ok('L and R bars rise with the sound', h.length === 2 && h.every(x => x < 60), JSON.stringify(h));
  await p.evaluate(id => { const a = window.webmix.audio, c = a.channels.find(c => c.inputId === id);
    const o = a.ctx.createOscillator(), g = a.ctx.createGain(); g.gain.value = 2; o.connect(g); g.connect(c.input); o.start(); o.stop(a.ctx.currentTime + 0.5); }, id);
  await p.waitForTimeout(300);
  ok('signal over 0 dBFS lights CLIP', await p.evaluate(c => document.querySelector(c + ' .card-vu').classList.contains('is-clip'), card));
  // ภาพนิ่งไม่มีเสียง → ไม่มีแถบ
  const fc2 = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc2).setFiles(S + '/logo.png');
  await p.waitForTimeout(600);
  const img = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'image').id);
  ok('silent source (image) has no meter', !(await p.isVisible(`#inputs-grid .card[data-id="${img}"] .card-vu`)) && !(await p.isVisible(`#inputs-grid .card[data-id="${img}"] .card-mute`)));
  // ปุ่มปิดเสียงบนการ์ด = ปุ่ม M ของช่องในมิกเซอร์ และไม่เปลี่ยน Preview
  const pvw = await p.evaluate(() => window.webmix.state.previewId);
  await p.click(`${card} .card-mute`);
  ok('card mute button mutes the channel', await p.evaluate(id => window.webmix.audio.channels.find(c => c.inputId === id).muted, id));
  ok('card shows MUTE', (await p.textContent(`${card} .card-mute`)).includes('MUTE'));
  ok('mixer M button follows', await p.evaluate(() => [...document.querySelectorAll('#mixer .strip .mute')].some(b => b.classList.contains('is-on'))));
  ok('mute click does not change Preview', await p.evaluate(() => window.webmix.state.previewId) === pvw);
  await p.waitForTimeout(3000);
  const hm = await cover();
  ok('muted meter falls', hm.every(x => x > 95), JSON.stringify(hm));
  await p.click(`${card} .card-mute`);
  ok('click again unmutes', await p.evaluate(id => !window.webmix.audio.channels.find(c => c.inputId === id).muted, id));
  // AFV จากมิกเซอร์ → ป้ายบนการ์ด
  await p.click('#mixer .strip .afv');
  ok('AFV badge appears on the card', await p.isVisible(`${card} .card-afv`));
  await p.click('#mixer .strip .afv');
  ok('AFV badge hides when turned off', !(await p.isVisible(`${card} .card-afv`)));
  // ปรับเฟดเดอร์ → ค่า dB บนการ์ด
  await p.evaluate(id => { const c = window.webmix.audio.channels.find(c => c.inputId === id); c.ui.fader.set ? c.ui.fader.set(50) : 0; }, id);
  ok('dB value on the card', /-?\d|∞/.test(await p.textContent(`${card} .card-mute span`)));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
