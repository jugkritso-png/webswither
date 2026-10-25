// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ปรับขนาดเลย์เอาต์: ลากเส้นแบ่ง ↕ ขยาย/ย่อจอภาพ · ลาก ↔ ปรับความกว้างคอลัมน์ แหล่งภาพ | ซ้อนภาพ | เสียง ·
// จำค่าหลังเปิดใหม่ · ดับเบิลคลิกคืนค่าเริ่มต้น · ปุ่มลูกศร · จอแคบไม่มีเส้นแบ่ง · การ์ดไม่ถูกบีบ
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const m = () => p.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    return { mon: r('.monitor-panel.pvw .monitor').height, ws: r('.workspace').height, a: r('.inputs-panel').width, b: r('.overlays-panel').width, c: r('.audio-panel').width };
  });
  const dragBy = async (sel, dx, dy) => {
    const bx = await p.locator(sel).boundingBox();
    const x = bx.x + bx.width / 2, y = bx.y + bx.height / 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 }); await p.mouse.move(x + dx, y + dy, { steps: 3 }); await p.mouse.up();
    await p.waitForTimeout(150);
  };
  ok('one ↕ splitter under the monitors and two ↔ splitters between the columns', await p.locator('#split-stage').isVisible() && await p.locator('.split-v').count() === 2 && await p.locator('.split-v').nth(1).isVisible());
  const v0 = await m();
  ok('vertical splitters sit on the column gaps', await p.evaluate(() => { const h = [...document.querySelectorAll('.split-v')].map(x => x.getBoundingClientRect()); const b = document.querySelector('.overlays-panel').getBoundingClientRect(), c = document.querySelector('.audio-panel').getBoundingClientRect(); return Math.abs(h[0].x + 4 - (b.x - 4)) < 6 && Math.abs(h[1].x + 4 - (c.x - 4)) < 6; }));

  // ↕ ลดขนาดจอภาพ แล้วขยาย
  await dragBy('#split-stage', 0, -120);
  let v = await m();
  ok('dragging up shrinks the monitors and gives the panels more room', v.mon < v0.mon - 80 && v.ws > v0.ws + 80, `${v0.mon.toFixed(0)}→${v.mon.toFixed(0)} / ${v0.ws.toFixed(0)}→${v.ws.toFixed(0)}`);
  await dragBy('#split-stage', 0, 200);
  const v1 = await m();
  ok('dragging down enlarges the monitors (up to the full column width)', v1.mon > v.mon + 100 && v1.mon >= v0.mon - 2, `${v.mon.toFixed(0)}→${v1.mon.toFixed(0)}`);
  ok('…but never wider than their column', await p.evaluate(() => { const m = document.querySelector('.monitor-panel.pvw .monitor').getBoundingClientRect(), c = document.querySelector('.monitor-panel.pvw').getBoundingClientRect(); return m.width <= c.width; }));
  ok('the middle switch deck always fits without scrolling', await p.evaluate(() => { const d = document.querySelector('.stage > .deck'); return d.scrollHeight <= d.clientHeight + 1; }));
  ok('source cards still never squeezed', await p.evaluate(() => [...document.querySelectorAll('#inputs-grid .card')].every(c => { const o = c.querySelector('.card-ovl'); return !o || o.getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom + 0.5; })));

  await dragBy('#split-stage', 0, -800);
  ok('shrinking stops where the switch deck still fits (no scrolling)', await p.evaluate(() => { const d = document.querySelector('.stage > .deck'); return d.scrollHeight <= d.clientHeight + 1 && d.querySelector('[data-action=cut]').getBoundingClientRect().height >= 28; }));
  await p.screenshot({ path: S + '/layout-small-monitors.png' });
  await dragBy('#split-stage', 0, 600);
  // ↔ คอลัมน์
  await dragBy('.split-v >> nth=0', -120, 0);
  v = await m();
  ok('first splitter: overlays column wider, sources narrower', v.b > v1.b + 100 && v.a < v1.a - 100 && Math.abs(v.c - v1.c) < 3, `b ${v1.b.toFixed(0)}→${v.b.toFixed(0)} a ${v1.a.toFixed(0)}→${v.a.toFixed(0)}`);
  const v2 = v;
  await dragBy('.split-v >> nth=1', 80, 0);
  v = await m();
  ok('second splitter trades width between overlays and audio', v.b > v2.b + 60 && v.c < v2.c - 60 && Math.abs(v.a - v2.a) < 3, `b ${v2.b.toFixed(0)}→${v.b.toFixed(0)} c ${v2.c.toFixed(0)}→${v.c.toFixed(0)}`);
  await dragBy('.split-v >> nth=1', 2000, 0);
  v = await m();
  ok('columns stop at a sensible minimum width', v.c >= 239 && v.a >= 370, JSON.stringify(v));
  ok('splitters follow the columns', await p.evaluate(() => { const h = document.querySelectorAll('.split-v')[1].getBoundingClientRect(), c = document.querySelector('.audio-panel').getBoundingClientRect(); return Math.abs(h.x + 4 - (c.x - 4)) < 6; }));
  await p.screenshot({ path: S + '/layout-resized.png' });

  // เปิดใหม่ = จำค่า
  const before = await m();
  await p.reload(); await p.waitForTimeout(800);
  const after = await m();
  ok('sizes are remembered after reload', Math.abs(after.mon - before.mon) < 3 && Math.abs(after.b - before.b) < 3 && Math.abs(after.c - before.c) < 3, `${JSON.stringify(before)} ${JSON.stringify(after)}`);

  // ลูกศร
  await p.focus('#split-stage'); const k0 = (await m()).mon; await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
  ok('arrow keys on a focused splitter resize too', (await m()).mon < k0 - 20);

  // ดับเบิลคลิก = ค่าเริ่มต้น
  await p.dblclick('#split-stage'); await p.dblclick('.split-v >> nth=0');
  await p.waitForTimeout(200);
  v = await m();
  ok('double-click restores the default layout', Math.abs(v.mon - v0.mon) < 2 && Math.abs(v.b - v0.b) < 2 && Math.abs(v.c - v0.c) < 2, `${JSON.stringify(v0)} ${JSON.stringify(v)}`);

  // จอแคบ: ไม่มีเส้นแบ่ง ใช้เลย์เอาต์อัตโนมัติ
  await p.setViewportSize({ width: 900, height: 1000 }); await p.waitForTimeout(300);
  ok('no splitters on narrow screens', !(await p.locator('#split-stage').isVisible()) && !(await p.locator('.split-v >> nth=0').isVisible()));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
