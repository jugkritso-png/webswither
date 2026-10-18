// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ระบบวาดภาพด้วย GPU (WebGL): ภาพต้องตรงกับแบบ CPU (Canvas 2D) ทุกฉาก และสลับกลับ CPU เองเมื่อ GPU ล่ม
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);

  const info = await p.evaluate(() => ({ has: !!window.webmix.gpu, sw: window.webmix.gpu && window.webmix.gpu.software, name: window.webmix.gpu && window.webmix.gpu.rendererName, active: window.webmix.renderer.active }));
  ok('WebGL compositor available', info.has, info.name);
  ok('auto mode avoids software GPU', info.sw ? info.active === 'cpu' : info.active === 'gpu', JSON.stringify(info));
  ok('status bar names the renderer', /CPU|GPU/.test(await p.textContent('#st-engine')), await p.textContent('#st-engine'));

  // ตัวอย่างพิกเซลเป็นตาราง 24×14 จุด บนจอที่เลือก
  const sample = sel => p.evaluate(sel => {
    const c = document.querySelector(sel), g = c.getContext('2d'), out = [];
    for (let j = 0; j < 14; j++) for (let i = 0; i < 24; i++) out.push(Array.from(g.getImageData(Math.floor((i + 0.5) * c.width / 24), Math.floor((j + 0.5) * c.height / 14), 1, 1).data.slice(0, 3)));
    return out;
  }, sel);
  const diff = (a, c) => { let bad = 0, max = 0; a.forEach((px, i) => { const d = Math.max(...px.map((v, k) => Math.abs(v - c[i][k]))); max = Math.max(max, d); if (d > 28) bad++; }); return { bad, max }; };
  async function compare(name, setup, sel = '#pgm-canvas') {
    await p.evaluate(setup);
    await p.evaluate(() => window.webmix.setRenderer('cpu')); await p.waitForTimeout(350);
    const cpu = await sample(sel);
    await p.evaluate(() => window.webmix.setRenderer('gpu')); await p.waitForTimeout(350);
    const gpu = await sample(sel);
    const d = diff(cpu, gpu);
    // ขอบภาพ/ตัวอักษรอาจต่างกันเล็กน้อยจากการปรับขนาดภาพ — ยอมได้ไม่เกิน 4% ของจุด
    ok(`GPU = CPU: ${name}`, d.bad <= Math.ceil(cpu.length * 0.04), `${d.bad}/${cpu.length} points differ`);
    return d;
  }

  // ไฟล์ทดสอบ: logo, ฉากเขียว, วิดีโอ (หยุดไว้ที่เฟรมเดียว)
  for (const [label, file] of [['ภาพนิ่ง', 'logo.png'], ['ภาพนิ่ง', 'green.png'], ['ไฟล์วิดีโอ', 'clip.webm']]) {
    const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click(`.menu button:has-text("${label}")`); await (await fc).setFiles(`${S}/${file}`);
    await p.waitForTimeout(600);
  }
  await p.evaluate(async () => { const v = window.webmix.inputs.find(i => i.type === 'media').el; v.pause(); v.currentTime = 1; await new Promise(r => { v.onseeked = r; setTimeout(r, 2000); }); });
  const ids = await p.evaluate(() => { const w = window.webmix, f = t => w.inputs.filter(i => i.type === t).map(i => i.id); return { bars: f('bars')[0], black: f('black')[0], logo: f('image')[0], green: f('image')[1], clip: f('media')[0] }; });
  await p.evaluate(ids => { window.webmix.ids = ids; }, ids);

  await compare('color bars', () => { const w = window.webmix; w.state.programId = w.ids.bars; });
  await compare('video frame (letterbox fit)', () => { const w = window.webmix; w.state.programId = w.ids.clip; });
  await compare('image (fit)', () => { const w = window.webmix; w.state.programId = w.ids.logo; });
  await compare('MIX transition 50%', () => { const w = window.webmix; w.settings.transition = 'mix'; w.state.programId = w.ids.bars; w.state.previewId = w.ids.clip; w.tr.progress = 0.5; });
  await compare('WIPE transition 40%', () => { const w = window.webmix; w.settings.transition = 'wipe'; w.tr.progress = 0.4; });
  await compare('DIP transition 30%', () => { const w = window.webmix; w.settings.transition = 'dip'; w.tr.progress = 0.3; });
  await compare('preview monitor', () => { const w = window.webmix; w.tr.progress = 0; w.settings.transition = 'mix'; w.state.previewId = w.ids.logo; }, '#pvw-canvas');
  await compare('overlay: corner + crop + border + opacity', () => {
    const w = window.webmix, logo = w.inputs.find(i => i.id === w.ids.logo);
    logo.layout = { x: 0.8, y: 0.25, scale: 0.35, crop: { l: 0.1, r: 0, t: 0.05, b: 0 }, opacity: 0.7, key: 'none', tolerance: 60, border: true };
    w.state.programId = w.ids.clip; w.state.previewId = w.ids.bars;
    w.toggleInputOverlay(w.ids.logo, 0); w.ovl[0].anim = 1;
  });
  await compare('overlay: per-input chroma key', () => {
    const w = window.webmix, g = w.inputs.find(i => i.id === w.ids.green);
    g.layout = { x: 0.5, y: 0.5, scale: 1, crop: { l: 0, r: 0, t: 0, b: 0 }, opacity: 1, key: 'green', tolerance: 60, border: false };
    w.toggleInputOverlay(w.ids.green, 7); w.ovl[7].anim = 1;
  });
  await compare('overlay: slide transition mid-way', () => { const w = window.webmix; w.ovl[7].on = false; w.ovl[7].anim = 0; w.ovl[0].effect = 'slide-left'; w.ovl[0].duration = 100000; w.ovl[0].on = false; w.ovl[0].anim = 0.5; });
  await compare('classic PIP + TITLE + KEY + FTB', () => {
    const w = window.webmix;
    w.ovl[0].anim = 0; w.ovl[0].duration = 500;
    w.overlays.pip.sourceId = w.ids.logo; w.overlays.pip.on = true;
    w.overlays.title.on = true; w.overlays.title.anim = 1;
    w.overlays.key.sourceId = w.ids.green; w.overlays.key.on = true;
    w.ftb.level = 0.4; w.ftb.target = 0.4;
  });
  await p.evaluate(() => { const w = window.webmix; w.overlays.pip.on = w.overlays.key.on = w.overlays.title.on = false; w.overlays.title.anim = 0; w.ftb.level = w.ftb.target = 0; });

  // output (captureStream) and snapshot still come from the same Program canvas
  await p.evaluate(() => window.webmix.setRenderer('gpu'));
  const cap = await p.evaluate(async () => { const s = document.querySelector('#pgm-canvas').captureStream(30); const v = document.createElement('video'); v.muted = true; v.srcObject = s; await v.play(); await new Promise(r => setTimeout(r, 500)); return { w: v.videoWidth, h: v.videoHeight }; });
  ok('Program output stream works in GPU mode', cap.w === 1280 && cap.h === 720, JSON.stringify(cap));

  // render time at 4K with 4 keyed overlays (informational: headless uses a software GPU)
  await p.evaluate(() => { const w = window.webmix; w.settings.resolution = '2160p'; });
  // ใช้หน้าตั้งค่าเพื่อเปลี่ยนความละเอียดจริง
  await p.click('[data-action=settings]'); await p.waitForSelector('.modal [name=resolution]'); await p.selectOption('.modal [name=resolution]', '2160p'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(500);
  await p.evaluate(() => { const w = window.webmix; for (const k of [1, 2, 3, 4]) { w.toggleInputOverlay(w.ids.green, k); w.ovl[k].anim = 1; } });
  const times = {};
  for (const mode of ['cpu', 'gpu']) {
    await p.evaluate(m => window.webmix.setRenderer(m), mode); await p.waitForTimeout(2500);
    times[mode] = await p.evaluate(() => document.querySelector('#st-engine').textContent);
  }
  ok('4K with 4 keyed overlays renders in both modes', /GPU/.test(times.gpu) && /CPU/.test(times.cpu), JSON.stringify(times));
  await p.evaluate(() => { const w = window.webmix; for (const k of [1, 2, 3, 4]) w.ovl[k].on = false; });

  // GPU dies (driver reset) → falls back to CPU without a black frame
  await p.evaluate(() => window.webmix.setRenderer('gpu')); await p.waitForTimeout(300);
  await p.evaluate(() => window.webmix.gpu.canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext());
  await p.waitForTimeout(800);
  ok('context loss → automatic CPU fallback', await p.evaluate(() => window.webmix.renderer.active) === 'cpu' && /สลับไปใช้ CPU/.test(await p.textContent('#toasts')));
  const px = await p.evaluate(() => Array.from(document.querySelector('#pgm-canvas').getContext('2d').getImageData(10, 10, 1, 1).data));
  ok('picture keeps rendering after fallback', px[3] === 255);
  ok('settings offer the renderer choice', await (async () => { await p.click('[data-action=settings]'); await p.waitForSelector('.modal [name=renderer]'); const n = (await p.$$('.modal [name=renderer] option')).length; await p.keyboard.press('Escape'); return n === 3; })());
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
