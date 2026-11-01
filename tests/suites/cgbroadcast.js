// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// CG แบบงานข่าว: เทมเพลตทั้ง 6 แบบอยู่ในเขต Title Safe 90% · พื้นไล่สี · ข้อความยาวย่อให้พอดีช่อง (ไม่ล้น ไม่บีบ)
// · ตัวพิมพ์ใหญ่ / ระยะตัวอักษร / กึ่งกลางแนวตั้ง · งานเก่า (ไม่มีค่าใหม่) วาดเหมือนเดิม · แก้ค่าใหม่จากแผง Properties ได้
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/cg-studio.html'); await p.waitForTimeout(800);

  // เขต Title Safe: x 96–1824 · y 54–1026 (ยกเว้นพื้นตัววิ่งที่ตั้งใจให้เต็มขอบ)
  const safe = await p.evaluate(() => WebMixCG.templates.map(t => {
    const els = WebMixCG.createTemplate(t).scenes[0].elements;
    const out = els.filter(e => !(t === 'ticker' && e.type === 'shape' && e.transform.width === 1920))
      .filter(e => e.transform.x < 96 || e.transform.y < 54 || e.transform.x + e.transform.width > 1824 || e.transform.y + e.transform.height > 1026);
    return { t, out: out.map(e => e.name), grad: els.some(e => e.type === 'shape' && e.style.fill2), texts: els.filter(e => e.type === 'text').every(e => e.style.fit === 'shrink' && e.style.vAlign === 'middle') };
  }));
  ok('all 6 templates sit inside title safe 90%', safe.every(x => !x.out.length), JSON.stringify(safe.filter(x => x.out.length)));
  ok('templates use gradient panels', safe.every(x => x.grad));
  ok('template text shrinks to fit and is vertically centred', safe.every(x => x.texts));

  // ค่าใหม่ผ่าน sanitize · งานเก่าได้ค่าเดิม (บีบแนวนอน / ชิดบน / ไม่ไล่สี)
  const san = await p.evaluate(() => {
    const doc = WebMixCG.createTemplate('lower-third'); const el = doc.scenes[0].elements.find(e => e.name === 'ตำแหน่ง');
    const old = WebMixCG.sanitize({ schemaVersion: 2, scenes: [{ id: 's', elements: [{ type: 'text', content: { value: 'x' }, style: {} }, { type: 'shape', style: { fill: '#ff0000' } }] }] }).scenes[0].elements;
    return { up: el.style.uppercase, ls: el.style.letterSpacing, oldFit: old[0].style.fit, oldV: old[0].style.vAlign, oldGrad: old[1].style.fill2 };
  });
  ok('labels are uppercase with letter spacing', san.up === true && san.ls > 0, JSON.stringify(san));
  ok('older documents keep their look (squash, top, flat fill)', san.oldFit === 'squash' && san.oldV === 'top' && san.oldGrad === '');

  // วาดจริง: ข้อความยาวมากในโหมด shrink ยังเห็นครบสองฝั่ง (ย่อลง) · โหมด middle อยู่กลางกล่อง · ไล่สีจริง
  const px = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d');
    const doc = { schemaVersion: 2, scenes: [{ id: 's', elements: [
      { id: 'a', type: 'text', transform: { x: 100, y: 100, width: 600, height: 120 }, style: { color: '#ffffff', fontSize: 80, fontWeight: 800, align: 'left', fit: 'shrink', vAlign: 'middle' }, content: { value: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' } },
      { id: 'b', type: 'shape', transform: { x: 100, y: 400, width: 800, height: 100 }, style: { fill: '#ff0000', fill2: '#0000ff', gradAngle: 0 } }] }] };
    WebMixCG.draw(g, doc, 1920, 1080);
    const col = x => { const d = g.getImageData(x, 100, 1, 120).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++; return n; };
    const rows = []; for (let y = 100; y < 220; y++) { const d = g.getImageData(100, y, 600, 1).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; if (n) rows.push(y); }
    const at = x => Array.from(g.getImageData(x, 450, 1, 1).data.slice(0, 3));
    return { left: col(105), right: col(690), top: rows[0], bottom: rows[rows.length - 1], gl: at(110), gr: at(890) };
  });
  ok('long text shrinks so both ends are visible', px.left > 0 && px.right > 0, JSON.stringify(px));
  ok('middle alignment centres the text in its box', Math.abs((px.top + px.bottom) / 2 - 160) < 12, `${px.top}–${px.bottom}`);
  ok('gradient goes from the start colour to the end colour', px.gl[0] > 200 && px.gl[2] < 60 && px.gr[2] > 200 && px.gr[0] < 60, JSON.stringify([px.gl, px.gr]));

  // หน้า Studio: Safe area มาตรฐาน HD และช่องแก้ค่าใหม่
  ok('safe area guides show title safe 90% and action safe 93%', /TITLE SAFE 90%/.test(await p.textContent('#safe-overlay')) && /ACTION SAFE 93%/.test(await p.textContent('#safe-overlay')));
  await p.click('[data-left-tab=templates]').catch(() => {});
  p.once('dialog', d => d.accept());
  await p.click('.template-list [data-template=lower-third]'); await p.waitForTimeout(300);
  const pick = name => p.evaluate(n => [...document.querySelectorAll('.element-row')].find(r => r.querySelector('.layer-name')?.textContent === n)?.click(), name);
  await pick('ตำแหน่ง'); await p.waitForTimeout(200);
  ok('properties show the new typography fields', await p.isVisible('#letter-spacing') && await p.isChecked('#text-upper') && (await p.inputValue('#text-fit')) === 'shrink' && (await p.inputValue('#text-valign')) === 'middle');
  await p.fill('#letter-spacing', '4'); await p.dispatchEvent('#letter-spacing', 'input');
  await pick('แผ่นชื่อ'); await p.waitForTimeout(150);
  await pick('ตำแหน่ง'); await p.waitForTimeout(150);
  ok('editing letter spacing updates the element (kept after reselecting)', await p.inputValue('#letter-spacing') === '4');
  await pick('แผ่นชื่อ'); await p.waitForTimeout(200);
  ok('shape properties show the gradient', await p.isChecked('#shape-grad') && await p.isVisible('#shape-fill2'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
