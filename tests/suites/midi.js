// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ควบคุมด้วย MIDI (จำลองคอนโทรลเลอร์): สอนปุ่ม → CUT/Preview/Overlay ทำงาน · CC เป็น T-Bar/เสียง · จำไว้หลังเปิดหน้าใหม่ · ลบการจับคู่
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // คอนโทรลเลอร์ MIDI ปลอม: window.__midi(bytes) = ส่งข้อความจากอุปกรณ์
  await ctx.addInitScript(() => {
    const input = { id: 'x1', name: 'Fake APC mini', state: 'connected', onmidimessage: null };
    const access = { inputs: new Map([['x1', input]]), outputs: new Map(), onstatechange: null };
    navigator.requestMIDIAccess = async () => access;
    window.__midi = bytes => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(bytes) });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const send = bytes => p.evaluate(b => window.__midi(b), bytes);

  await p.click('[data-action=settings]'); await p.click('[data-mtab=control]');
  ok('settings has a ควบคุม tab with actions', await p.isVisible('[data-mpane=control] .midi-row[data-midi=cut]') && (await p.locator('.midi-row').count()) > 30);
  await p.click('.midi-row[data-midi=cut] .midi-learn'); await p.waitForTimeout(200);
  ok('learn turns MIDI on and lists the device', await p.evaluate(() => window.webmix.settings.midi.on) && /Fake APC mini/.test(await p.textContent('.midi-dev')));
  ok('row shows it is waiting', /กดปุ่ม/.test(await p.textContent('.midi-row[data-midi=cut] .midi-map')));
  await send([0x90, 60, 100]); await p.waitForTimeout(100);
  ok('pressing a pad maps it to CUT', await p.evaluate(() => window.webmix.settings.midi.map.cut === 'note:1:60') && /Note 60/.test(await p.textContent('.midi-row[data-midi=cut] .midi-map')));
  // Preview 3 ← Note 61, Overlay 1 ← CC 20 (ปุ่มแบบ CC), T-Bar ← CC 7, Master ← CC 8 ช่อง 2
  for (const [k, msg] of [['pvw3', [0x90, 61, 127]], ['ovl1', [0xb0, 20, 127]], ['tbar', [0xb0, 7, 10]], ['master', [0xb1, 8, 50]]]) {
    await p.click(`.midi-row[data-midi=${k}] .midi-learn`); await send(msg); await p.waitForTimeout(80);
    if (k === 'ovl1') await send([0xb0, 20, 0]);
  }
  ok('several controls mapped', await p.evaluate(() => JSON.stringify(window.webmix.settings.midi.map)) === JSON.stringify({ cut: 'note:1:60', pvw3: 'note:1:61', ovl1: 'cc:1:20', tbar: 'cc:1:7', master: 'cc:2:8' }));
  // ปุ่มเดิมสอนให้คำสั่งอื่น → ย้ายไปคำสั่งใหม่
  await p.click('.midi-row[data-midi=auto] .midi-learn'); await send([0x90, 61, 127]); await p.waitForTimeout(80);
  ok('re-using a pad moves it to the new action', await p.evaluate(() => { const m = window.webmix.settings.midi.map; return m.auto === 'note:1:61' && !m.pvw3; }));
  await p.click('.midi-row[data-midi=pvw3] .midi-learn'); await send([0x90, 62, 127]); await p.waitForTimeout(80);
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);

  const st = () => p.evaluate(() => ({ pgm: window.webmix.state.programId, pvw: window.webmix.state.previewId, ids: window.webmix.inputs.map(i => i.id) }));
  await send([0x90, 62, 127]); await p.waitForTimeout(100);
  let s = await st();
  ok('Note → Preview 3', s.pvw === s.ids[2], JSON.stringify(s));
  await send([0x90, 60, 127]); await p.waitForTimeout(100);
  s = await st();
  ok('Note → CUT', s.pgm === s.ids[2]);
  await send([0x90, 60, 0]); await p.waitForTimeout(100);
  ok('note-off does nothing', (await st()).pgm === s.ids[2]);
  await p.evaluate(() => { window.webmix.ovl[0].inputId = window.webmix.inputs[1].id; });
  await send([0xb0, 20, 127]); await p.waitForTimeout(100);
  const on1 = await p.evaluate(() => window.webmix.ovl[0].on);
  await send([0xb0, 20, 127]); await p.waitForTimeout(100);
  const still = await p.evaluate(() => window.webmix.ovl[0].on);
  await send([0xb0, 20, 0]); await send([0xb0, 20, 127]); await p.waitForTimeout(100);
  const off1 = await p.evaluate(() => window.webmix.ovl[0].on);
  ok('CC button toggles Overlay 1 once per press', on1 && still && !off1, JSON.stringify({ on1, still, off1 }));
  await send([0xb0, 7, 64]); await p.waitForTimeout(100);
  const half = await p.evaluate(() => +window.webmix.tr.progress.toFixed(2));
  await send([0xb0, 7, 127]); await p.waitForTimeout(150);
  s = await st();
  ok('CC fader drives the T-Bar and completes the transition', half > 0.45 && half < 0.55 && s.pgm !== s.ids[2], JSON.stringify({ half }));
  await send([0xb1, 8, 0]); await p.waitForTimeout(100);
  ok('CC fader drives the master volume', await p.evaluate(() => window.webmix.audio.masterStrip.db === -Infinity) && /−∞/.test(await p.textContent('.strip.master .strip-db')));
  await send([0xb1, 8, 95]);

  await p.reload(); await p.waitForTimeout(900);
  await send([0x90, 61, 127]); await p.waitForTimeout(100);
  ok('mapping and MIDI on survive a reload (AUTO pad works)', await p.evaluate(() => window.webmix.settings.midi.on && window.webmix.tr.auto || window.webmix.tr.progress > 0 || document.querySelector('[data-action=auto]').classList.contains('is-running')));
  await p.click('[data-action=settings]'); await p.click('[data-mtab=control]');
  await p.click('.midi-row[data-midi=cut] .midi-clear');
  ok('✕ removes a mapping', await p.evaluate(() => !window.webmix.settings.midi.map.cut) && /—/.test(await p.textContent('.midi-row[data-midi=cut] .midi-map')));
  await p.screenshot({ path: S + '/midi.png' });
  await p.click('.midi-on'); await p.waitForTimeout(100);
  ok('turning MIDI off ignores the controller', await p.evaluate(() => !window.webmix.settings.midi.on && !window.webmix.midi.access));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
