// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Noise Gate ต่อช่องเสียง: ระดับสูงกว่าเสียง → ปิดเสียง (ลด ≥30 dB) · ต่ำกว่า → ผ่านตามปกติ · ไฟสถานะ · รีเซ็ต · บันทึกกับโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  // clip.webm: เสียง sine ราว −18 dBFS ต่อเนื่อง
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/clip.webm');
  await p.waitForTimeout(1200);
  const level = () => p.evaluate(() => new Promise(r => { const c = window.webmix.audio.channels[0]; const v = []; const id = setInterval(() => { v.push(c.level); if (v.length >= 8) { clearInterval(id); v.sort((a, b) => a - b); r(+v[4].toFixed(1)); } }, 120); }));
  const base = await level();
  ok('channel has signal before the gate', base > -35, `${base} dB`);
  await p.locator('.strip:not(.master) .chip-btn.fx').click(); await p.waitForSelector('.modal [data-fx=gate]');
  const setRange = (key, v) => p.evaluate(([k, val]) => { const el = document.querySelector(`.modal [data-fx=${k}]`); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, [key, v]);
  await setRange('gateDb', -10);
  await p.click('.modal [data-fx=gate]'); await p.waitForTimeout(900);
  const shut = await level();
  ok('gate above the signal mutes the channel', shut < base - 30, `${base} → ${shut} dB`);
  ok('gate light is off while closed', await p.locator('.modal .gate-led.open').count() === 0);
  await setRange('gateDb', -60); await p.waitForTimeout(600);
  const open = await level();
  ok('gate below the signal lets it through', Math.abs(open - base) < 3, `${base} → ${open} dB`);
  ok('gate light is green while open', await p.locator('.modal .gate-led.open').count() === 1);
  ok('dialog shows the gate level', (await p.textContent('.modal')).includes('-60 dB'));
  ok('FX chip lit while the gate is on', await p.locator('.strip:not(.master) .chip-btn.fx.is-on').count() === 1);
  ok('gate saved with the show', await p.evaluate(() => { const fx = Object.values(window.webmix.show.serialize().audio.inputs)[0].fx; return fx.gate === true && fx.gateDb === -60; }));
  await p.screenshot({ path: S + '/gate.png' });
  await p.click('.modal-foot .btn:has-text("รีเซ็ต")'); await p.waitForTimeout(600);
  const after = await p.evaluate(() => { const c = window.webmix.audio.channels[0]; return { gate: c.fx.gate, on: !!c.gateOn, db: c.fx.gateDb }; });
  ok('reset turns the gate off', !after.gate && !after.on && after.db === -50, JSON.stringify(after));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
