// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Macro: สร้างในแท็บ Macro (Overlay ขึ้น → รอ → ตัดเข้า Color Bars → เริ่มบันทึก) · สั่งด้วยปุ่ม F2 / ปุ่มในแท็บ · กดซ้ำ = หยุด
// เริ่มเองตามเวลา · ปุ่ม MIDI Macro 1–8 · จำไว้กับโชว์ · ลบได้
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(`${S}/logo.png`);
  await p.waitForTimeout(600);
  const ids = await p.evaluate(() => { const w = window.webmix; const img = w.inputs.find(i => i.type === 'image').id; w.ovl[0].inputId = img; w.state.programId = w.inputs.find(i => i.type === 'slate').id; return { img, bars: w.inputs.find(i => i.type === 'bars').id }; });
  await p.click('.tab[data-tab=macro]');
  ok('Macro tab sits next to the other four', (await p.locator('.tabs .tab').count()) === 5 && await p.isVisible('#macro-add'));
  await p.click('#macro-add'); await p.waitForSelector('.modal .mstep');
  await p.fill('.modal input[name=mname]', 'เปิดรายการ'); await p.selectOption('.modal select[name=mkey]', 'F2');
  await p.selectOption('.mstep[data-i="0"] select[data-k=a]', 'ovlOn');
  await p.selectOption('.mstep[data-i="0"] select[data-k=v]', '0');
  await p.click('.mstep-add'); await p.fill('.mstep[data-i="1"] input[data-k=v]', '1.5'); await p.dispatchEvent('.mstep[data-i="1"] input[data-k=v]', 'change');
  await p.click('.mstep-add'); await p.selectOption('.mstep[data-i="2"] select[data-k=a]', 'program'); await p.selectOption('.mstep[data-i="2"] select[data-k=v]', ids.bars);
  await p.click('.mstep-add'); await p.selectOption('.mstep[data-i="3"] select[data-k=a]', 'recStart');
  // ลำดับ: ย้ายขั้นตอนบันทึกขึ้นแล้วลงกลับ
  await p.click('.mstep[data-i="3"] [data-mv="-1"]'); await p.click('.mstep[data-i="2"] [data-mv="1"]');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const m = await p.evaluate(() => window.webmix.macros.map(x => ({ name: x.name, key: x.key, steps: x.steps })));
  ok('macro saved with 4 steps in order', m.length === 1 && m[0].key === 'F2' && m[0].steps.map(s => s.a).join() === 'ovlOn,wait,program,recStart' && m[0].steps[1].v === 1.5, JSON.stringify(m));
  ok('button shows name, steps and hotkey', /เปิดรายการ/.test(await p.textContent('.macro-run')) && /4 ขั้นตอน · F2/.test(await p.textContent('.macro-run')));
  await p.keyboard.press('F2'); await p.waitForTimeout(400);
  const mid = await p.evaluate(b => ({ ovl: window.webmix.ovl[0].on, pgm: window.webmix.state.programId === b, running: !!document.querySelector('.macro-row.is-running') }), ids.bars);
  ok('F2 runs it: overlay up, waiting', mid.ovl && !mid.pgm && mid.running, JSON.stringify(mid));
  await p.waitForTimeout(2000);
  const end = await p.evaluate(b => ({ pgm: window.webmix.state.programId === b, rec: window.webmix.rec.active, running: !!document.querySelector('.macro-row.is-running') }), ids.bars);
  ok('then cuts to Color Bars and starts recording', end.pgm && end.rec && !end.running, JSON.stringify(end));
  const dl = p.waitForEvent('download'); await p.evaluate(() => window.webmix.rec.recorder.stop()); await dl;
  // กดซ้ำระหว่างทำงาน = หยุด
  await p.evaluate(() => { window.webmix.macros[0].steps = [{ a: 'wait', v: 5 }, { a: 'ftbOn', v: '' }]; });
  await p.click('.macro-run'); await p.waitForTimeout(300); await p.click('.macro-run'); await p.waitForTimeout(800);
  ok('pressing it again stops it', await p.evaluate(() => !document.querySelector('.macro-row.is-running') && !window.webmix.ftb.target));
  // เริ่มเองตามเวลา
  await p.evaluate(() => { const d = new Date(); const m = window.webmix.macros[0]; m.steps = [{ a: 'ftbOn', v: '' }]; m.at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; });
  await p.waitForTimeout(1500);
  ok('runs by itself at its start time', await p.evaluate(() => window.webmix.ftb.target === 1));
  await p.evaluate(() => { window.webmix.macros[0].steps = [{ a: 'ftbOff', v: '' }]; window.webmix.runMacro(window.webmix.macros[0]); });
  await p.waitForTimeout(300);
  ok('runs only once per day at that time', await p.evaluate(() => window.webmix.ftb.target === 0));
  await p.click('[data-action=settings]'); await p.click('[data-mtab=control]');
  ok('MIDI can trigger Macro 1–8', (await p.locator('.midi-row[data-midi^=mac]').count()) === 8);
  await p.keyboard.press('Escape');
  // จำไว้กับโชว์
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(1000);
  await p.waitForTimeout(1500);
  ok('reloading in the same minute does not run the timed macro again', await p.evaluate(() => window.webmix.ftb.target === 0 && ![...document.querySelectorAll('.toast')].some(t => /ตามเวลา/.test(t.textContent))));
  const back = await p.evaluate(() => window.webmix.macros.map(x => ({ name: x.name, key: x.key, n: x.steps.length })));
  ok('macros are saved with the show', back.length === 1 && back[0].name === 'เปิดรายการ' && back[0].key === 'F2', JSON.stringify(back));
  await p.click('.tab[data-tab=macro]');
  await p.screenshot({ path: S + '/macro.png' });
  await p.click('.macro-edit'); await p.waitForSelector('.modal .mstep');
  await p.screenshot({ path: S + '/macro-edit.png' });
  await p.click('.modal-foot button:has-text("ลบ Macro")'); await p.waitForTimeout(300);
  ok('delete removes it', await p.evaluate(() => window.webmix.macros.length === 0) && /ยังไม่มี Macro/.test(await p.textContent('#macro-list')));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
