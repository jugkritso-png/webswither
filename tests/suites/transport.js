// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แถบ transport ใต้จอ Preview / Program: คลิปวิดีโอ = เล่น/หยุด · เริ่มใหม่ · วนซ้ำ · ลากแถบเลื่อนตำแหน่ง · เวลาเล่นไป/ความยาว/ที่เหลือ ·
// เตือนเหลือง ≤15 วิ แดง ≤5 วิ · แหล่งอื่นแสดงชนิด (ไม่มีปุ่ม) · Playlist มีปุ่มก่อน/ถัดไป · ตัดเข้า Program แล้วแถบตามไป
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);

  const pv = '#pvw-transport', pg = '#pgm-transport';
  ok('both monitors have a transport bar; a live source shows its kind only', await p.isVisible(pv) && await p.isVisible(pg) && (await p.locator(`${pg} .tp-btn`).count()) === 0 && /\S/.test(await p.textContent(`${pg} .tp-src`)));

  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/loud.webm');
  await p.waitForTimeout(800);
  const id = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'media').id);
  const vid = () => p.evaluate(id => { const v = window.webmix.inputs.find(i => i.id === id).el; return { t: v.currentTime, d: v.duration, paused: v.paused, loop: v.loop }; }, id);
  await p.evaluate(id => window.webmix.setPreview(id), id);
  await until(async () => (await vid()).d > 0);
  ok('clip in Preview: play, restart, loop, mark in/out, track and times', await until(async () => (await p.locator(`${pv} [data-tp]`).count()) === 6 && await p.isVisible(`${pv} .tp-track`) && /^00:00:20:\d\d$/.test((await p.textContent(`${pv} .tp-dur`)).trim())), await p.textContent(pv));

  // ไฟล์วิดีโอวนซ้ำเป็นค่าเริ่มต้น — ปิดวนซ้ำด้วยปุ่มบนแถบ (เตือนเวลาที่เหลือใช้กับคลิปที่ไม่วน)
  ok('clip loops by default; the loop button shows it', (await vid()).loop && await p.locator(`${pv} [data-tp=loop].is-on`).count() === 1);
  await p.click(`${pv} [data-tp=loop]`);
  ok('loop button turns looping off', await until(async () => !(await vid()).loop && await p.locator(`${pv} [data-tp=loop].is-on`).count() === 0));
  // หยุด / เล่น
  if (!(await vid()).paused) await p.click(`${pv} [data-tp=play]`);
  ok('play button pauses / plays the clip', await until(async () => (await vid()).paused));
  await p.click(`${pv} [data-tp=play]`);
  ok('…and plays again (button shows playing)', await until(async () => !(await vid()).paused && await p.locator(`${pv} [data-tp=play].is-on`).count() === 1));

  // ลากแถบ: กดกลางแถบ = ครึ่งคลิป
  const box = await p.locator(`${pv} .tp-track`).boundingBox();
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2); await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 4 }); await p.mouse.up();
  let v = await vid();
  ok('dragging the track seeks the clip', Math.abs(v.t - 15) < 1.5, JSON.stringify(v));
  ok('elapsed / remaining follow the position', await until(async () => /^00:00:1[456]:\d\d$/.test((await p.textContent(`${pv} .tp-cur`)).trim()) && /^-00:00:0[3-6]:\d\d$/.test((await p.textContent(`${pv} .tp-rem`)).trim())), `${await p.textContent(`${pv} .tp-cur`)} ${await p.textContent(`${pv} .tp-rem`)}`);
  ok('under 5 s left the remaining time turns red', await until(() => p.evaluate(s => document.querySelector(s + ' .tp-rem').dataset.level === 'crit', pv), 4000));

  // เริ่มใหม่ / วนซ้ำ
  await p.click(`${pv} [data-tp=restart]`);
  ok('restart goes back to the start and plays', await until(async () => { const x = await vid(); return x.t < 2 && !x.paused; }));
  await p.click(`${pv} [data-tp=loop]`);
  ok('loop toggles back on; a looping clip shows no countdown warning', await until(async () => (await vid()).loop && await p.locator(`${pv} [data-tp=loop].is-on`).count() === 1 && await p.evaluate(s => !document.querySelector(s + ' .tp-rem').dataset.level, pv)));
  await p.click(`${pv} [data-tp=loop]`);

  // Mark In / Mark Out
  const mark = () => p.evaluate(id => window.webmix.inputs.find(i => i.id === id).mark || null, id);
  const seekTo = t => p.evaluate(([id, t]) => { window.webmix.inputs.find(i => i.id === id).el.currentTime = t; }, [id, t]);
  ok('playhead is a square head with a line', await p.evaluate(s => { const h = document.querySelector(s + ' .tp-head'); const a = getComputedStyle(h, '::before'), b = getComputedStyle(h, '::after'); return a.borderRadius === '0px' && a.width === a.width && parseFloat(b.width) === 2; }, pv));
  await p.evaluate(id => window.webmix.inputs.find(i => i.id === id).el.pause(), id);
  await seekTo(5); await p.waitForTimeout(150); await p.click(`${pv} [data-tp=in]`);
  await seekTo(9); await p.waitForTimeout(150); await p.click(`${pv} [data-tp=out]`);
  let m = await mark();
  ok('I / O buttons set Mark In 5 s and Mark Out 9 s', m && Math.abs(m.in - 5) < 0.1 && Math.abs(m.out - 9) < 0.1, JSON.stringify(m));
  ok('track shows the In–Out range and markers; length shows the marked 4 s', await until(async () => await p.isVisible(`${pv} .tp-range`) && await p.isVisible(`${pv} .tp-in`) && await p.isVisible(`${pv} .tp-out`)
    && /^00:00:0[34]:\d\d$/.test((await p.textContent(`${pv} .tp-dur`)).trim()) && await p.locator(`${pv} [data-tp=in].is-on`).count() === 1), await p.textContent(`${pv} .tp-dur`));
  await p.screenshot({ path: S + '/transport-marks.png', clip: { x: 0, y: 380, width: 720, height: 120 } });
  // ไม่วนซ้ำ: เล่นจาก In แล้วหยุดที่ Out
  await p.click(`${pv} [data-tp=restart]`);
  ok('restart jumps to Mark In', await until(async () => { const x = await vid(); return x.t >= 4.9 && x.t < 6 && !x.paused; }, 3000), JSON.stringify(await vid()));
  ok('without loop the clip stops at Mark Out', await until(async () => { const x = await vid(); return x.paused && Math.abs(x.t - 9) < 0.15; }, 7000), JSON.stringify(await vid()));
  ok('remaining counts to Mark Out', /^-00:00:00:\d\d$/.test((await p.textContent(`${pv} .tp-rem`)).trim()));
  await p.click(`${pv} [data-tp=play]`);
  ok('play at Mark Out starts again from Mark In', await until(async () => { const x = await vid(); return !x.paused && x.t >= 4.9 && x.t < 7; }, 3000));
  // วนซ้ำ: Out → กลับไป In
  await p.click(`${pv} [data-tp=loop]`);
  let lo = 99, hi = 0, wrapped = false, prev = 0;
  for (let k = 0; k < 40; k++) { const x = await vid(); lo = Math.min(lo, x.t); hi = Math.max(hi, x.t); if (x.t + 1 < prev) wrapped = true; prev = x.t; await p.waitForTimeout(150); }
  ok('with loop on the clip cycles between Mark In and Mark Out', wrapped && lo > 4.8 && hi < 9.2, `${lo.toFixed(2)}–${hi.toFixed(2)} wrapped=${wrapped}`);
  await p.click(`${pv} [data-tp=loop]`);
  // คีย์ I / O บนแถบ · ล้าง · บันทึกกับโชว์
  await p.evaluate(id => window.webmix.inputs.find(i => i.id === id).el.pause(), id);
  await seekTo(3); await p.waitForTimeout(100); await p.focus(`${pv} .tp-track`); await p.keyboard.press('i');
  ok('I key on the track moves Mark In (Out kept)', await until(async () => { const x = await mark(); return x && Math.abs(x.in - 3) < 0.1 && Math.abs(x.out - 9) < 0.1; }, 2000), JSON.stringify(await mark()));
  const saved = await p.evaluate(() => window.webmix.show.serialize().inputs.find(i => i.type === 'media').mark);
  ok('marks are saved with the show', saved && Math.abs(saved.in - 3) < 0.1 && Math.abs(saved.out - 9) < 0.1, JSON.stringify(saved));
  await p.click(`${pv} [data-tp=clear]`);
  ok('✕ clears both marks; full length shown again', await until(async () => (await mark()) === null && /^00:00:20:\d\d$/.test((await p.textContent(`${pv} .tp-dur`)).trim()) && !(await p.isVisible(`${pv} .tp-range`))));
  await p.evaluate(id => window.webmix.inputs.find(i => i.id === id).el.play(), id);

  // ตัดเข้า Program: แถบ Program เป็นคลิป เตือนเหลือง ≤15 วิ
  await p.evaluate(() => window.webmix.cut()); await p.waitForTimeout(400);
  ok('after CUT the Program bar controls the clip; Preview shows the other source', await p.locator(`${pg} [data-tp=play]`).count() === 1 && await p.locator(`${pv} [data-tp]`).count() === 0);
  await p.evaluate(id => { const v = window.webmix.inputs.find(i => i.id === id).el; v.currentTime = 7; v.play(); }, id);
  ok('Program warns in amber with 15 s left', await until(() => p.evaluate(s => document.querySelector(s + ' .tp-rem').dataset.level === 'warn', pg), 4000));
  await p.screenshot({ path: S + '/transport.png', clip: { x: 0, y: 40, width: 1440, height: 520 } });
  await p.keyboard.press('Escape');
  // คีย์ลูกศรบนแถบ = ข้าม 5 วิ (ไม่ไปเปลี่ยนสไลด์/ภาพ)
  await p.focus(`${pg} .tp-track`); const t0 = (await vid()).t; await p.keyboard.press('ArrowLeft');
  ok('arrow keys on the focused track jump 5 s', Math.abs((await vid()).t - (t0 - 5)) < 1.2);

  // Playlist: ปุ่มก่อน/ถัดไป + ตำแหน่ง
  const fc2 = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Playlist")');
  await (await fc2).setFiles([S + '/clip.webm', S + '/logo.png']);
  await p.waitForTimeout(800);
  const pl = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'playlist').id);
  await p.evaluate(id => window.webmix.setPreview(id), pl);
  ok('playlist in Preview: previous / next and position 1/2', await until(async () => await p.locator(`${pv} [data-tp=next]`).count() === 1 && (await p.textContent(`${pv} .tp-pos`)).trim() === '1/2'));
  await p.click(`${pv} [data-tp=next]`);
  ok('next goes to item 2', await until(async () => (await p.textContent(`${pv} .tp-pos`)).trim() === '2/2'));

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
