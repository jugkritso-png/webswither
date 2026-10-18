// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Multiview: หน้าต่างแยก, Preview/Program, ทุก Input พร้อม tally/มิเตอร์, หยุดวาดเมื่อปิดหน้าต่าง
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/loud.webm');
  await p.waitForTimeout(800);
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs[1].id; w.setPreview(w.inputs[2].id); w.toggleInputOverlay(w.inputs[4].id, 2); });

  const popup = p.waitForEvent('popup'); await p.click('[data-action=multiview]'); const win = await popup;
  await win.waitForTimeout(1500);
  const v = await win.evaluate(() => { const v = document.querySelector('video'); return { w: v.videoWidth, h: v.videoHeight, playing: !v.paused }; });
  ok('multiview window shows a 1920×1080 feed', v.w === 1920 && v.h === 1080 && v.playing, JSON.stringify(v));
  await win.screenshot({ path: S + '/multiview.png' });

  const px = (x, y) => p.evaluate(([x, y]) => Array.from(window.webmix.multiview.ctx.getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);
  const near = (a, c, t = 40) => a.every((v, i) => Math.abs(v - c[i]) <= t);
  ok('preview framed in green', near(await px(5, 300), [34, 197, 94]), JSON.stringify(await px(5, 300)));
  ok('program framed in red', near(await px(965, 300), [239, 68, 68]), JSON.stringify(await px(965, 300)));
  const L = await p.evaluate(() => window.webmix.multiview.layout(window.webmix.inputs.length));
  const tile = i => [Math.round((i % L.cols) * L.tw + 5), Math.round(L.gridTop + Math.floor(i / L.cols) * L.th + L.th / 3)];
  ok('program input tile has a red tally border', near(await px(...tile(1)), [239, 68, 68]), JSON.stringify(await px(...tile(1))));
  ok('preview input tile has a green tally border', near(await px(...tile(2)), [34, 197, 94]), JSON.stringify(await px(...tile(2))));
  ok('overlay input counts as on air (red)', near(await px(...tile(4)), [239, 68, 68]));
  ok('idle input tile has a plain border', !near(await px(...tile(3)), [239, 68, 68]) && !near(await px(...tile(3)), [34, 197, 94]));
  // มิเตอร์เสียงของวิดีโอที่มีเสียง (แถบขวาของการ์ด)
  await p.click('body'); await p.waitForTimeout(1500);
  const meterLit = await p.evaluate(L => {
    const g = window.webmix.multiview.ctx, i = 4, tx = (i % L.cols) * L.tw + 3, ty = L.gridTop + Math.floor(i / L.cols) * L.th + 3, tw = L.tw - 6, th = L.th - 6;
    const lh = Math.max(22, th * 0.15), mh = th - lh - 20;
    const d = g.getImageData(tx + tw - 14, ty + 8 + mh * 0.9, 1, 1).data; return d[1] > 120 || d[0] > 200;
  }, L);
  ok('audio meter moves for an input with sound', meterLit);
  // แสดงได้ถึง 24 Input
  for (let i = 0; i < 18; i++) { await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Black")'); }
  await p.waitForTimeout(300);
  const L2 = await p.evaluate(() => window.webmix.multiview.layout(window.webmix.inputs.length));
  ok('grid adapts to many inputs (23 tiles fit)', L2.gridTop + Math.ceil(23 / L2.cols) * L2.th <= 1080, JSON.stringify({ cols: L2.cols, n: 23 }));
  // ปิดหน้าต่าง → หยุดวาด
  await win.close(); await p.waitForTimeout(500);
  ok('closing the window stops multiview rendering', await p.evaluate(() => window.webmix.multiview.timer === null && window.webmix.multiview.track === null));
  // เปิดด้วยคีย์ลัด M
  const popup2 = p.waitForEvent('popup'); await p.keyboard.press('m'); const win2 = await popup2;
  ok('M opens multiview', !!win2); await win2.close();
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
