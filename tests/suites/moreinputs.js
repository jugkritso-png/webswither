// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แหล่งภาพ: สีพื้น (Colour โปร่งได้) · ภาพ Program / Preview · วิดีโอจากลิงก์ (URL / HLS) · ภาพหน่วงเวลา (Video Delay)
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  const px = (sel, x, y) => p.evaluate(([sel, x, y]) => { const c = document.querySelector(sel); return Array.from(c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3)); }, [sel, x, y]);
  const pgm = (x, y) => px('#pgm-canvas', x, y), pvw = (x, y) => px('#pvw-canvas', x, y);
  const near = (a, b2, t = 40) => a.every((v, i) => Math.abs(v - b2[i]) <= t);
  const menu = async label => { await p.click('[data-action=add-menu]'); await p.click(`.menu button:has-text("${label}")`); };
  const of = t => p.evaluate(t => { const i = window.webmix.inputs.find(x => x.type === t); return i && { id: i.id, name: i.name, status: i.status }; }, t);
  const setPgm = id => p.evaluate(id => { window.webmix.state.programId = id; }, id);
  const bars = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'bars').id);

  // ---- สีพื้น: ดำโปร่ง 50% บน Overlay ทำให้ภาพด้านล่างมืดลงครึ่งหนึ่ง
  await menu('สีพื้น (Colour)'); await p.waitForSelector('.modal .col-prev');
  await p.click('.modal [data-cp="0"]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(400);
  const col = await of('color');
  ok('colour source added (preset: black 50%)', !!col && await p.evaluate(id => { const f = window.webmix.inputs.find(i => i.id === id).fill; return f.alpha === 0.5 && f.a === '#000000'; }, col.id));
  await setPgm(bars); await p.waitForTimeout(300);
  const white = await pgm(0.05, 0.3);
  const cc = p.locator(`#inputs-grid .card[data-id="${col.id}"]`); await cc.hover(); await cc.locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(800);
  const dim = await pgm(0.05, 0.3);
  ok('50% black over the picture halves its brightness', dim[0] > white[0] * 0.35 && dim[0] < white[0] * 0.65, JSON.stringify({ white, dim }));
  await cc.locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(500);
  await p.evaluate(id => { window.webmix.inputs.find(i => i.id === id).fill = { a: '#ff0000', b: '#0000ff', grad: 'h', alpha: 1 }; }, col.id);
  await setPgm(col.id); await p.waitForTimeout(300);
  const L = await pgm(0.02, 0.5), R = await pgm(0.98, 0.5);
  ok('gradient left → right (red to blue)', L[0] > 200 && L[2] < 60 && R[2] > 200 && R[0] < 60, JSON.stringify({ L, R }));

  // ---- ภาพ Program เป็นแหล่งภาพ
  await setPgm(bars); await p.waitForTimeout(200);
  await menu('ภาพ Program'); await p.waitForTimeout(300);
  const mix = await of('mixsrc');
  await p.evaluate(id => window.webmix.setPreview(id), mix.id); await p.waitForTimeout(500);
  const a1 = await pgm(0.3, 0.3), a2 = await pvw(0.3, 0.3);
  ok('Program output as a source shows the Program picture', mix && near(a1, a2, 20), JSON.stringify({ pgm: a1, pvw: a2 }));

  // ---- วิดีโอจากลิงก์
  await menu('วิดีโอ / ไลฟ์จากลิงก์ (URL)');
  await p.fill('.modal [name=url]', 'http://localhost:8765/tests/.work/clip.webm'); await p.fill('.modal [name=name]', 'CLIP URL');
  await p.click('.modal-foot .btn-primary');
  const urlOk = await (async () => { for (let i = 0; i < 20; i++) { const u = await of('url'); if (u && u.status === 'live') return u; await p.waitForTimeout(250); } return of('url'); })();
  ok('URL video plays as a source', urlOk && urlOk.status === 'live', JSON.stringify(urlOk));
  await setPgm(urlOk.id); await p.waitForTimeout(500);
  const v = await pgm(0.5, 0.5);
  ok('URL video reaches Program (canvas not blocked by CORS)', v.some(x => x > 30) && !errs.some(e => /tainted|insecure/i.test(e)), JSON.stringify(v));
  await menu('วิดีโอ / ไลฟ์จากลิงก์ (URL)');
  await p.fill('.modal [name=url]', 'http://localhost:8765/tests/.work/none/live.m3u8'); await p.fill('.modal [name=name]', 'HLS');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1500);
  ok('.m3u8 links use the HLS player', await p.evaluate(() => !!window.Hls && !!window.webmix.inputs.find(i => i.name === 'HLS').hls));

  // ---- ภาพหน่วงเวลา: เปลี่ยนสีต้นทาง → ภาพหน่วงยังเป็นสีเดิมช่วงหนึ่ง แล้วค่อยเปลี่ยน
  await p.evaluate(id => { window.webmix.inputs.find(i => i.id === id).fill = { a: '#0000ff', b: '#0000ff', grad: 'none', alpha: 1 }; }, col.id);
  await menu('ภาพหน่วงเวลา (Video Delay)'); await p.waitForSelector('.modal [name=src]');
  await p.selectOption('.modal [name=src]', col.id);
  await p.evaluate(() => { const r = document.querySelector('.modal [name=ms]'); r.value = 800; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1300);
  const dl = await of('delay');
  ok('delay source fills its buffer and goes live', dl && dl.status === 'live', JSON.stringify(dl));
  await setPgm(dl.id); await p.waitForTimeout(200);
  ok('delayed picture shows the source (blue)', near(await pgm(0.5, 0.5), [0, 0, 255]), JSON.stringify(await pgm(0.5, 0.5)));
  await p.evaluate(id => { window.webmix.inputs.find(i => i.id === id).fill = { a: '#ff0000', b: '#ff0000', grad: 'none', alpha: 1 }; }, col.id);
  await p.waitForTimeout(400);
  ok('0.4 s after the change the delay still shows the old picture', near(await pgm(0.5, 0.5), [0, 0, 255]), JSON.stringify(await pgm(0.5, 0.5)));
  await p.waitForTimeout(800);
  ok('…and after 0.8 s it shows the new one', near(await pgm(0.5, 0.5), [255, 0, 0]), JSON.stringify(await pgm(0.5, 0.5)));

  // ---- บันทึกโชว์
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(2500);
  const back = await p.evaluate(() => ['color', 'mixsrc', 'url', 'delay'].map(t => { const i = window.webmix.inputs.find(x => x.type === t); return i ? `${t}:${i.status}` : `${t}:missing`; }));
  ok('all four come back after reload (and go live)', back.every(x => /:live$/.test(x)), JSON.stringify(back));
  ok('delay keeps its source and time', await p.evaluate(() => { const d = window.webmix.inputs.find(i => i.type === 'delay'); return d.delay.ms === 800 && window.webmix.inputs.some(i => i.id === d.delay.src); }));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
