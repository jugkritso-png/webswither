// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ประหยัดเครื่อง: แหล่งภาพที่ไม่ได้ใช้ (ไม่อยู่บน Program / Preview / Overlay) คำนวณช้าลง · พอใช้ก็กลับมาเต็มที่ทันที
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const ks = p => ({ o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, p });
  const lot = { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 200, h: 100, nm: 'p', ddd: 0, assets: [], layers: [{ ddd: 0, ind: 1, ty: 4, nm: 'r', sr: 1, ip: 0, op: 60, st: 0, bm: 0, ao: 0,
    ks: ks({ a: 1, k: [{ t: 0, s: [20, 50, 0], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } }, { t: 59, s: [180, 50, 0] }] }),
    shapes: [{ ty: 'gr', it: [{ ty: 'rc', d: 1, s: { a: 0, k: [30, 30] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }] }] };
  fs.writeFileSync(path.join(S, 'power.json'), JSON.stringify(lot));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  await p.click('[data-action=add-menu]');
  const fc = p.waitForEvent('filechooser'); await p.click('.menu button:has-text("แอนิเมชัน Lottie (.json)")'); await (await fc).setFiles(path.join(S, 'power.json'));
  await p.waitForTimeout(1200);
  // นับจำนวนครั้งที่ Lottie วาดเฟรมใน 1 วินาที
  const rate = () => p.evaluate(async () => { const i = window.webmix.inputs.find(x => x.type === 'lottie'), orig = i.anim.goToAndStop.bind(i.anim); let n = 0; i.anim.goToAndStop = (...a) => { n++; return orig(...a); }; await new Promise(r => setTimeout(r, 1000)); i.anim.goToAndStop = orig; return n; });
  const idle = await rate();
  ok('an unused Lottie draws only a few frames per second (thumbnail)', idle <= 6, `${idle}/s`);
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'lottie').id; });
  const live = await rate();
  ok('on Program it runs at full frame rate', live >= 20, `${live}/s`);
  // ไม่ได้ใช้แล้วเวลาเดินต่อ: กลับมาใช้ภาพอยู่ตรงจังหวะ ไม่เริ่มใหม่
  ok('timing keeps running while idle (no restart when used again)', await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'lottie').lot.frame > 5));
  // ภาพย่อของแหล่งที่วาดหนักแต่ไม่ได้ใช้: ไม่วาดทุก 100 ms
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'bars').id; });
  const thumbs = await p.evaluate(async () => { const i = window.webmix.inputs.find(x => x.type === 'lottie'), c = document.querySelector(`#inputs-grid .card[data-id="${i.id}"] canvas`), g = c.getContext('2d'), orig = g.drawImage.bind(g); let n = 0; g.drawImage = (...a) => { n++; return orig(...a); }; await new Promise(r => setTimeout(r, 1000)); g.drawImage = orig; return n; });
  ok('idle heavy thumbnails update about twice a second', thumbs <= 4, `${thumbs}/s`);
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
