// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ฉากเสมือน (Virtual Set: คีย์กล้องฉากเขียว + ฉาก + โต๊ะ + จอ + มุมกล้องเสมือน) · แอนิเมชัน Lottie (.json, พื้นโปร่งใส)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  // Lottie: สี่เหลี่ยมแดง 100×100 เลื่อนจากซ้ายไปขวาใน 1 วินาที (30 เฟรม) บนพื้นโปร่งใส 400×200
  const ks = p => ({ o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, p });
  const lot = { v: '5.7.4', fr: 30, ip: 0, op: 30, w: 400, h: 200, nm: 'box', ddd: 0, assets: [], layers: [{ ddd: 0, ind: 1, ty: 4, nm: 'red', sr: 1, ip: 0, op: 30, st: 0, bm: 0, ao: 0,
    ks: ks({ a: 1, k: [{ t: 0, s: [60, 100, 0], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } }, { t: 29, s: [340, 100, 0] }] }),
    shapes: [{ ty: 'gr', it: [{ ty: 'rc', d: 1, s: { a: 0, k: [100, 100] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }] }] };
  fs.writeFileSync(path.join(S, 'box.json'), JSON.stringify(lot));
  fs.writeFileSync(path.join(S, 'bad.json'), '{"hello": 1}');

  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  const px = (x, y) => p.evaluate(([x, y]) => { const c = document.querySelector('#pgm-canvas'); return Array.from(c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3)); }, [x, y]);
  const count = (pred) => p.evaluate(src => { const f = new Function('r', 'g', 'b', 'return ' + src); const c = document.querySelector('#pgm-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (f(d[i], d[i + 1], d[i + 2])) n++; return n; }, pred);
  const setPgm = id => p.evaluate(id => { window.webmix.state.programId = id; }, id);

  // "กล้อง" = รูปพื้นเขียวมีสี่เหลี่ยมแดงตรงกลาง (เหมือนคนยืนหน้าฉากเขียว)
  await p.click('[data-action=add-menu]');
  const fc = p.waitForEvent('filechooser'); await p.click('.menu button:has-text("ภาพนิ่ง / โลโก้")'); await (await fc).setFiles(path.join(S, 'green.png'));
  await p.waitForTimeout(800);
  const cam = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'image').id);

  // ---- ฉากเสมือน
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ฉากเสมือน (Virtual Set)")');
  await p.waitForSelector('.modal .vs-prev');
  await p.selectOption('.modal [name=cam]', cam);
  await p.waitForTimeout(300);
  const prevOk = await p.evaluate(() => { const c = document.querySelector('.modal .vs-prev'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n > 1000; });
  ok('dialog shows a live preview of the set', prevOk);
  await p.screenshot({ path: process.env.WORK + '/vset-dialog.png' });
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(400);
  const vs = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'vset')?.id);
  ok('virtual set added (news set, camera chosen)', !!vs && await p.evaluate(id => { const v = window.webmix.inputs.find(i => i.id === id).vset; return v.set === 'news' && !!v.cam; }, vs));
  await setPgm(vs); await p.waitForTimeout(500);
  ok('green screen is keyed out (no green left)', await count('g > 150 && r < 80 && b < 80') < 20, String(await count('g > 150 && r < 80 && b < 80')));
  ok('the person (red) stands in the set', await count('r > 180 && g < 60 && b < 60') > 300, String(await count('r > 180 && g < 60 && b < 60')));
  ok('studio wall (blue tones) behind', (await px(0.05, 0.3))[2] > (await px(0.05, 0.3))[0] + 20, JSON.stringify(await px(0.05, 0.3)));
  const deskTop = await px(0.4, 0.9);
  ok('news desk in front at the bottom', deskTop[2] > 20 && deskTop[2] > deskTop[0], JSON.stringify(deskTop));
  // มุมกล้องใกล้ → สีแดง (คน) ใหญ่ขึ้นในภาพ
  const redWide = await count('r > 180 && g < 60 && b < 60');
  const card = p.locator(`#inputs-grid .card[data-id="${vs}"]`); await card.hover();
  ok('card has W / M / C virtual camera buttons', await card.locator('[data-card=vs0]').isVisible() && await card.locator('[data-card=vs2]').isVisible());
  await card.locator('[data-card=vs1]').click(); await p.waitForTimeout(500);
  const redMid = await count('r > 180 && g < 60 && b < 60');
  await p.waitForTimeout(1200);
  const redClose = await count('r > 180 && g < 60 && b < 60');
  ok('medium shot zooms in on the person smoothly (grows during the move, then bigger still)', redMid > redWide * 1.1 && redClose > redMid, JSON.stringify({ redWide, redMid, redClose }));
  await card.locator('[data-card=vs2]').click(); await p.waitForTimeout(1500);
  ok('close shot keeps the person in frame', await count('r > 180 && g < 60 && b < 60') > redClose, String(await count('r > 180 && g < 60 && b < 60')));
  // จอหลังผู้ประกาศแสดง Color Bars
  await p.evaluate(id => { const w = window.webmix, v = w.inputs.find(i => i.id === id); v.vset.wall = w.inputs.find(i => i.type === 'bars').id; v.vset.shot = 0; v.vcam = null; }, vs);
  await p.waitForTimeout(300);
  await p.screenshot({ path: process.env.WORK + '/vset-pgm.png' });
  ok('the wall screen shows another source (colour bars)', await count('r > 150 && g > 150 && b < 60') > 100, String(await count('r > 150 && g > 150 && b < 60')));

  // ---- Lottie
  await p.click('[data-action=add-menu]');
  const fc2 = p.waitForEvent('filechooser'); await p.click('.menu button:has-text("แอนิเมชัน Lottie (.json)")'); await (await fc2).setFiles(path.join(S, 'box.json'));
  await p.waitForTimeout(1500);
  const lt = await p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'lottie'); return i && { id: i.id, status: i.status, frames: i.lot.frames, name: i.name }; });
  ok('Lottie file loads (30 frames)', lt && lt.status === 'live' && Math.round(lt.frames) === 30 && lt.name === 'BOX', JSON.stringify(lt));
  await setPgm(await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'bars').id)); await p.waitForTimeout(200);
  const lc = p.locator(`#inputs-grid .card[data-id="${lt.id}"]`); await lc.hover(); await lc.locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(700);
  ok('on an Overlay the background stays visible (transparent)', (await px(0.5, 0.05)).some(v => v > 100), JSON.stringify(await px(0.5, 0.05)));
  // ตำแหน่งกล่องแดงเปลี่ยนตามเวลา (แอนิเมชันเล่นอยู่)
  const redX = () => p.evaluate(() => { const c = document.querySelector('#pgm-canvas'), y = Math.floor(c.height / 2), d = c.getContext('2d').getImageData(0, y, c.width, 1).data; let s = 0, n = 0; for (let x = 0; x < c.width; x++) { const i = x * 4; if (d[i] > 200 && d[i + 1] < 50 && d[i + 2] < 50) { s += x; n++; } } return n ? s / n / c.width : -1; });
  await lc.locator('[data-card=lrestart]').click();
  await p.waitForTimeout(150); const x1 = await redX(); await p.waitForTimeout(450); const x2 = await redX();
  ok('animation plays (the red box moves right)', x1 >= 0 && x2 > x1 + 0.1, JSON.stringify({ x1, x2 }));
  await lc.locator('[data-card=lplay]').click(); const x3 = await redX(); await p.waitForTimeout(400);
  ok('pause holds the frame', Math.abs((await redX()) - x3) < 0.02);
  // ไฟล์ที่ไม่ใช่ Lottie
  await p.click('[data-action=add-menu]');
  const fc3 = p.waitForEvent('filechooser'); await p.click('.menu button:has-text("แอนิเมชัน Lottie (.json)")'); await (await fc3).setFiles(path.join(S, 'bad.json'));
  await p.waitForTimeout(800);
  ok('a non-Lottie JSON is rejected with a message', await p.evaluate(() => window.webmix.inputs.filter(i => i.type === 'lottie').length === 1) && /Lottie/.test(await p.textContent('.toast:last-child').catch(() => '')));

  // ---- บันทึกโชว์
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(2500);
  const back = await p.evaluate(() => ({ vs: window.webmix.inputs.find(i => i.type === 'vset')?.vset, lt: window.webmix.inputs.find(i => i.type === 'lottie')?.status }));
  ok('both come back after reload', back.vs && back.vs.cam && back.lt === 'live', JSON.stringify(back));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
