// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Ducking: เพลงลดลงเองเมื่อช่องที่เลือกมีเสียง · กลับมาเมื่อเงียบ · ไฟสถานะ · ไม่นับช่องที่ปิดเสียง · บันทึกกับโชว์ · ปิดแล้วเสียงเต็ม
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  const menu = async tile => { await p.click('[data-action=add-audio]'); await p.click(`.menu button:has-text("${tile}")`); };
  const level = kind => p.evaluate(k => new Promise(r => { const c = window.webmix.audio.channels.find(x => x.kind === k); const v = []; const id = setInterval(() => { v.push(c.level); if (v.length >= 6) { clearInterval(id); v.sort((a, b) => a - b); r(+v[3].toFixed(1)); } }, 120); }), kind);

  // เพลง (วนเพลงเดิม) + Tone เป็นตัวแทนเสียงพูด
  const fc = p.waitForEvent('filechooser'); await menu('เครื่องเล่นเพลง'); await (await fc).setFiles(S + '/song1.wav');
  await p.waitForTimeout(600);
  await p.evaluate(() => { const c = window.webmix.audio.channels.find(x => x.kind === 'player'); c.list.loop = 'one'; c.el.loop = true; c.src.toggle(); });
  await menu('สัญญาณทดสอบ'); await p.waitForSelector('.modal select[name=type]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800);
  const base = await level('player');
  ok('music playing at full level', base > -32, `${base} dB`);

  await p.locator('.strip', { hasText: 'MUSIC' }).locator('.chip-btn.fx').click(); await p.waitForSelector('.modal [data-fx=duckBy]');
  const toneKey = await p.evaluate(() => window.webmix.chanKey(window.webmix.audio.channels.find(c => c.kind === 'tone')));
  const opts = await p.locator('.modal [data-fx=duckBy] option').evaluateAll(o => o.map(x => x.value));
  ok('trigger list: all voices + other channels, not itself', opts[0] === 'voice' && opts.includes(toneKey) && !opts.some(v => v.startsWith('src:') && v === '') && opts.length === 2, JSON.stringify(opts));
  await p.selectOption('.modal [data-fx=duckBy]', toneKey);
  await p.click('.modal [data-fx=duck]'); await p.waitForTimeout(600);
  const quiet = await level('player');
  ok('muted trigger does not duck', Math.abs(quiet - base) < 2, `${base} → ${quiet} dB`);
  ok('duck light off while nothing speaks', await p.locator('.modal .duck-led.on').count() === 0);
  await p.click('.modal-foot .btn-primary');

  // เปิดเสียง Tone (−18 dBFS > −40) -> เพลงลด ~15 dB
  await p.locator('.strip', { hasText: 'TONE' }).locator('.chip-btn.mute').click(); await p.waitForTimeout(800);
  const ducked = await level('player');
  ok('trigger speaks -> music ducks about 15 dB', ducked < base - 11 && ducked > base - 19, `${base} → ${ducked} dB`);
  ok('FX chip shows ducking (purple)', await p.locator('.strip', { hasText: 'MUSIC' }).locator('.chip-btn.fx.is-duck').count() === 1);
  // ระดับลดตามที่ตั้ง
  await p.locator('.strip', { hasText: 'MUSIC' }).locator('.chip-btn.fx').click(); await p.waitForSelector('.modal [data-fx=duckDb]');
  ok('duck light on in the dialog', await p.locator('.modal .duck-led.on').count() === 1);
  await p.evaluate(() => { const el = document.querySelector('.modal [data-fx=duckDb]'); el.value = -30; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(700);
  const deeper = await level('player');
  ok('deeper duck amount applies live', deeper < base - 25, `${base} → ${deeper} dB`);
  await p.click('.modal-foot .btn-primary');

  // เงียบ -> กลับมาเสียงเต็ม (หลังค้าง 0.5 วินาที + ปล่อยช้า)
  await p.locator('.strip', { hasText: 'TONE' }).locator('.chip-btn.mute').click(); await p.waitForTimeout(2200);
  const back = await level('player');
  ok('trigger stops -> music returns', Math.abs(back - base) < 2, `${base} → ${back} dB`);
  ok('FX chip back to normal', await p.locator('.strip', { hasText: 'MUSIC' }).locator('.chip-btn.fx.is-duck').count() === 0);

  // บันทึกกับโชว์
  const saved = await p.evaluate(() => window.webmix.show.serialize().audio.sources.find(s => s.kind === 'player').fx);
  ok('duck settings saved with the show', saved.duck === true && saved.duckDb === -30 && saved.duckBy.startsWith('src:'), JSON.stringify(saved));

  // ปิด Ducking ระหว่างที่ลดอยู่ -> เสียงเต็มทันที
  await p.locator('.strip', { hasText: 'TONE' }).locator('.chip-btn.mute').click(); await p.waitForTimeout(800);
  await p.locator('.strip', { hasText: 'MUSIC' }).locator('.chip-btn.fx').click(); await p.waitForSelector('.modal [data-fx=duck]');
  await p.click('.modal [data-fx=duck]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800);
  const off = await level('player');
  ok('turning ducking off restores full level', Math.abs(off - base) < 2, `${base} → ${off} dB`);

  // ค่าเริ่มต้น "ไมค์และแขก": Tone ไม่ใช่เสียงพูด จึงไม่ทำให้ลด
  await p.evaluate(() => { const c = window.webmix.audio.channels.find(x => x.kind === 'player'); c.fx.duck = true; c.fx.duckBy = 'voice'; window.webmix.audio.applyFx(c); });
  await p.waitForTimeout(700);
  const voice = await level('player');
  ok('"voices" mode ignores non-voice channels', Math.abs(voice - base) < 2, `${base} → ${voice} dB`);
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
