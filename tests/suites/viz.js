// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Audio Visualizer: เสียง sine 440 Hz → แท่งที่สูงสุดอยู่ตรงช่วง 440 Hz · วาดได้ทั้ง 4 แบบ ทั้ง CPU/GPU
// ปิดเสียงแล้วแท่งยุบ · พื้นโปร่งใสซ้อนบนภาพอื่นได้ · จำค่าไว้กับโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(`${S}/loud.webm`);
  await p.waitForTimeout(1200);
  const vid = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'media').id);
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("Audio Visualizer")');
  await p.waitForSelector('.modal select[name=source]');
  ok('dialog lists the video channel as a sound source', (await p.$$eval('.modal select[name=source] option', o => o.map(x => x.value))).includes(vid));
  await p.selectOption('.modal select[name=source]', vid);
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const viz = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'visualizer').id);
  ok('card says what it listens to', /VISUALIZER · แท่งความถี่ · loud/.test(await p.textContent(`.card[data-id="${viz}"] .card-sub`)), await p.textContent(`.card[data-id="${viz}"] .card-sub`));
  await p.evaluate(id => { window.webmix.state.programId = id; }, viz);
  await p.waitForTimeout(1000);
  const bands = await p.evaluate(id => Array.from(window.webmix.inputs.find(i => i.id === id).vizState.bands), viz);
  const top = bands.indexOf(Math.max(...bands));
  ok('strongest bar is at 440 Hz', top >= 17 && top <= 21 && bands[top] > 0.5, JSON.stringify({ top, max: bands[top].toFixed(2) }));
  // พิกเซลสีของแท่ง (#3b82f6) บน Program
  const colored = (region = [0, 0, 1, 1]) => p.evaluate(rg => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = 160; g.height = 90; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 160, 90); const d = x.getImageData(Math.round(rg[0] * 160), Math.round(rg[1] * 90), Math.round(rg[2] * 160), Math.round(rg[3] * 90)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i + 2] > d[i] + 60) n++; return n / (d.length / 4); }, region);
  // แถบความถี่ 440 Hz อยู่ราว 8% + 19.5/48 ของ 84% ความกว้าง ≈ 0.42
  const near = await colored([0.40, 0.2, 0.04, 0.7]), far = await colored([0.85, 0.2, 0.04, 0.7]);
  ok('the 440 Hz bar is drawn taller than the high-frequency bars', near > far * 3 && near > 0.05, JSON.stringify({ near, far }));
  const styles = {};
  for (const st of ['wave', 'circle', 'mirror', 'bars']) {
    await p.evaluate(([id, st]) => { window.webmix.inputs.find(i => i.id === id).viz.style = st; }, [viz, st]);
    await p.waitForTimeout(300);
    styles[st] = await colored();
  }
  ok('all four styles draw', Object.values(styles).every(v => v > 0.004), JSON.stringify(styles));
  await p.evaluate(() => window.webmix.setRenderer('gpu')); await p.waitForTimeout(500);
  ok('GPU renderer draws it too', await colored([0.40, 0.2, 0.04, 0.7]) > 0.05);
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  // ปิดเสียงช่อง → แท่งยุบ
  await p.evaluate(id => { const c = window.webmix.audio.channels.find(x => x.inputId === id); c.muted = true; window.webmix.audio.applyGain(c); }, vid);
  await p.waitForTimeout(2500);
  const quiet = await p.evaluate(id => Math.max(...window.webmix.inputs.find(i => i.id === id).vizState.bands), viz);
  ok('muting the channel drops the bars', quiet < 0.1, String(quiet));
  await p.evaluate(id => { const c = window.webmix.audio.channels.find(x => x.inputId === id); c.muted = false; window.webmix.audio.applyGain(c); }, vid);
  // พื้นโปร่งใสซ้อนบนภาพเขียว
  const fc2 = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc2).setFiles(`${S}/green.png`);
  await p.waitForTimeout(800);
  await p.evaluate(id => { const w = window.webmix; w.inputs.find(i => i.id === id).viz.bg = 'none'; w.state.programId = w.inputs.find(i => i.type === 'image').id; w.toggleInputOverlay(id, 0); }, viz);
  await p.waitForTimeout(1200);
  const mix = await p.evaluate(() => { const c = document.querySelector('#pgm-canvas'); const g = document.createElement('canvas'); g.width = 160; g.height = 90; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 160, 90); const d = x.getImageData(0, 0, 160, 90).data; let gr = 0, bl = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > 200 && d[i] < 80 && d[i + 2] < 80) gr++; if (d[i + 2] > 150 && d[i + 2] > d[i] + 60) bl++; } return { green: gr / 14400, blue: bl / 14400 }; });
  ok('transparent visualizer overlays the picture underneath', mix.green > 0.5 && mix.blue > 0.01, JSON.stringify(mix));
  // จำค่า
  await p.evaluate(id => { const v = window.webmix.inputs.find(i => i.id === id).viz; v.style = 'circle'; v.color = '#ef4444'; window.webmix.show.autosave(true); }, viz);
  await p.reload(); await p.waitForTimeout(1000);
  const back = await p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); return i && i.viz; }, viz);
  ok('settings survive a reload', back && back.style === 'circle' && back.color === '#ef4444' && back.source === vid && back.bg === 'none', JSON.stringify(back));
  await p.screenshot({ path: S + '/viz.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
