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
  // สลับภาพจาก Multiview: แตะครั้งแรก = Preview (เขียว) · แตะซ้ำ = Program (แดง)
  const at = async ([cx, cy]) => {
    const pt = await win.evaluate(([cx, cy]) => { const v = document.querySelector('video'), r = v.getBoundingClientRect(), k = Math.min(r.width / 1920, r.height / 1080);
      return [r.left + (r.width - 1920 * k) / 2 + cx * k, r.top + (r.height - 1080 * k) / 2 + cy * k]; }, [cx, cy]);
    await win.mouse.click(pt[0], pt[1]); await win.waitForTimeout(250);
  };
  const center = i => [Math.round((i % L.cols) * L.tw + L.tw / 2), Math.round(L.gridTop + Math.floor(i / L.cols) * L.th + L.th / 2)];
  const bus = () => p.evaluate(() => { const w = window.webmix; return { pgm: w.inputs.findIndex(i => i.id === w.state.programId), pvw: w.inputs.findIndex(i => i.id === w.state.previewId) }; });
  await at(center(3));
  let s = await bus();
  ok('multiview: first tap puts the source on Preview', s.pvw === 3 && s.pgm === 1, JSON.stringify(s));
  await p.waitForTimeout(200);
  ok('multiview: tapped tile turns green', near(await px(...tile(3)), [34, 197, 94]), JSON.stringify(await px(...tile(3))));
  await at(center(3));
  s = await bus();
  ok('multiview: second tap on the same source takes it to Program', s.pgm === 3 && s.pvw === 1, JSON.stringify(s));
  await p.waitForTimeout(200);
  ok('multiview: it turns red', near(await px(...tile(3)), [239, 68, 68]), JSON.stringify(await px(...tile(3))));
  await at(center(3));
  s = await bus();
  ok('multiview: tapping the on-air source changes nothing', s.pgm === 3 && s.pvw === 1, JSON.stringify(s));
  await at([480, 300]);
  s = await bus();
  ok('multiview: tapping the big PREVIEW takes it to Program', s.pgm === 1 && s.pvw === 3, JSON.stringify(s));
  await win.keyboard.press('1'); await win.waitForTimeout(150);
  s = await bus();
  ok('multiview: number key picks Preview', s.pvw === 0, JSON.stringify(s));
  await win.keyboard.press(' '); await win.waitForTimeout(150);
  s = await bus();
  ok('multiview: Space cuts', s.pgm === 0, JSON.stringify(s));
  await win.screenshot({ path: S + '/multiview-pick.png' });

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
  // มือถือ: เปิดจากเมนูเพิ่มเติม → Multiview เต็มจอในหน้าเดียวกัน แตะสลับภาพได้
  const { devices } = require('playwright');
  const mctx = await b.newContext({ ...devices['iPhone 13 landscape'] });
  await mctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const m = await mctx.newPage(); m.on('pageerror', e => errs.push('phone ' + e.message));
  await m.goto('http://localhost:8765/index.html'); await m.waitForTimeout(900);
  await m.tap('#m-tabs [data-mmore]'); await m.waitForTimeout(200);
  await m.tap('.menu button:has-text("Multiview")'); await m.waitForTimeout(400);
  ok('phone: Multiview opens full screen inside the app', await m.isVisible('.mv-inline canvas') && (await m.evaluate(() => !window.webmix.multiview.win)));
  const mtap = async i => {
    const pt = await m.evaluate(i => { const mv = window.webmix.multiview, L = mv.layout(window.webmix.inputs.length), c = document.querySelector('.mv-inline canvas').getBoundingClientRect(), k = Math.min(c.width / 1920, c.height / 1080);
      const cx = (i % L.cols) * L.tw + L.tw / 2, cy = L.gridTop + Math.floor(i / L.cols) * L.th + L.th / 2;
      return [c.left + (c.width - 1920 * k) / 2 + cx * k, c.top + (c.height - 1080 * k) / 2 + cy * k]; }, i);
    await m.touchscreen.tap(pt[0], pt[1]); await m.waitForTimeout(250);
  };
  const mbus = () => m.evaluate(() => { const w = window.webmix; return { pgm: w.inputs.findIndex(i => i.id === w.state.programId), pvw: w.inputs.findIndex(i => i.id === w.state.previewId) }; });
  await mtap(2);
  let ms = await mbus();
  ok('phone Multiview: first tap → Preview', ms.pvw === 2, JSON.stringify(ms));
  await mtap(2);
  ms = await mbus();
  ok('phone Multiview: second tap → Program', ms.pgm === 2, JSON.stringify(ms));
  await m.screenshot({ path: S + '/multiview-phone.png' });
  await m.tap('.mv-close'); await m.waitForTimeout(300);
  ok('phone Multiview: closes and stops drawing', (await m.locator('.mv-inline').count()) === 0 && await m.evaluate(() => window.webmix.multiview.timer === null));
  await mctx.close();

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
