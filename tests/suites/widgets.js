// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// วิดเจ็ตข้อมูลสด: สภาพอากาศ (Open-Meteo + ค้นหาเมือง) · คริปโต (CoinGecko) · อัตราแลกเปลี่ยน · JSON จาก API · ข้อมูลล่าสุดค้างไว้เมื่อเน็ตหลุด · บันทึกโชว์
// (ตอบ API จำลองในชุดทดสอบ — ไม่ต้องใช้อินเทอร์เน็ต)
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  let btc = 2500000, apiDown = false;
  const json = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  await ctx.route(/geocoding-api\.open-meteo\.com/, r => json(r, { results: [{ name: 'เชียงใหม่', admin1: 'เชียงใหม่', latitude: 18.79, longitude: 98.98 }] }));
  await ctx.route(/api\.open-meteo\.com\/v1\/forecast/, r => json(r, { current: { temperature_2m: 27.6, weather_code: 61, relative_humidity_2m: 81, wind_speed_10m: 5 }, _q: r.request().url() }));
  await ctx.route(/api\.coingecko\.com/, r => apiDown ? r.fulfill({ status: 503, body: '' }) : json(r, { bitcoin: { thb: btc, thb_24h_change: -1.5 } }));
  await ctx.route(/open\.er-api\.com/, r => json(r, { rates: { THB: 36.4512 } }));
  await ctx.route(/example\.test\/score/, r => json(r, { match: { home: 'ไทย', score: '2-1' } }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  const add = async (fill) => { await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("วิดเจ็ตข้อมูลสด")'); await p.waitForSelector('.modal [name=kind]'); await fill(); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800); };
  const w = name => p.evaluate(n => { const i = window.webmix.inputs.filter(x => x.type === 'widget')[n]; return i && { id: i.id, status: i.status, wd: i.wd, widget: i.widget, sub: document.querySelector(`#inputs-grid .card[data-id="${i.id}"] .card-sub`)?.textContent }; }, name);

  // สภาพอากาศ: ค้นหาเมือง → ใช้พิกัดที่ได้
  await add(async () => { await p.fill('.modal [name=place]', 'เชียงใหม่'); await p.click('.modal [data-wd=geo]'); await p.waitForTimeout(400); });
  const w0 = await w(0);
  ok('weather widget: city search sets coordinates', w0 && Math.abs(w0.widget.lat - 18.79) < 0.01 && w0.widget.place === 'เชียงใหม่', JSON.stringify(w0 && w0.widget));
  ok('weather shows temperature and conditions', w0.status === 'live' && w0.wd.value === '28°C' && /ฝน/.test(w0.wd.sub) && /81%/.test(w0.wd.sub), JSON.stringify(w0.wd));
  ok('card shows the value', /28°C/.test(w0.sub), w0.sub);

  // คริปโต
  await add(async () => { await p.selectOption('.modal [name=kind]', 'crypto'); await p.selectOption('.modal [name=pos]', 'bl'); });
  const w1 = await w(1);
  ok('crypto price in baht with 24h change (down = red arrow)', w1.status === 'live' && /2,500,000 ฿/.test(w1.wd.value) && /▼ 1\.50%/.test(w1.wd.sub) && w1.wd.trend < 0, JSON.stringify(w1.wd));
  // อัตราแลกเปลี่ยน
  await add(async () => { await p.selectOption('.modal [name=kind]', 'fx'); });
  ok('exchange rate USD → THB', /36\.4512 THB/.test((await w(2)).wd.value), (await w(2)).wd.value);
  // JSON จาก API ใดก็ได้
  await add(async () => { await p.selectOption('.modal [name=kind]', 'json'); await p.fill('.modal [name=url]', 'https://example.test/score'); await p.fill('.modal [name=path]', 'match.score'); await p.fill('.modal [name=label]', 'ไทย vs มาเลเซีย'); });
  const w3 = await w(3);
  ok('custom JSON API value by path', w3.wd.value === '2-1' && w3.wd.label === 'ไทย vs มาเลเซีย', JSON.stringify(w3.wd));

  // วาดบน Program มุมซ้ายล่าง (พื้นโปร่งใส — มุมอื่นยังเป็นภาพเดิม)
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'bars').id; });
  await p.evaluate(id => window.webmix.toggleInputOverlay(id, 0), w1.id);
  // รอจนแผงวาดเสร็จ (CI ช้ากว่าเครื่อง)
  await p.waitForFunction(() => { const c = document.querySelector('#pgm-canvas'); const v = Array.from(c.getContext('2d').getImageData(Math.round(c.height * 0.045) + 2, Math.floor(c.height * 0.88), 1, 1).data.slice(0, 3)); return v[0] > 200 && v[2] < 90; }, null, { timeout: 8000 }).catch(() => {});
  // แถบสีส้มด้านซ้ายของแผง (accent) — ไม่ขึ้นกับภาพพื้นหลัง
  const acc = await p.evaluate(() => { const c = document.querySelector('#pgm-canvas'), m = Math.round(c.height * 0.045) + 2, g = (x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)); return { bl: g(m, Math.floor(c.height * 0.88)), tl: g(m, Math.floor(c.height * 0.1)) }; });
  const orange = v => v[0] > 200 && v[1] > 120 && v[1] < 200 && v[2] < 90;
  ok('widget panel drawn bottom-left over the picture', orange(acc.bl) && !orange(acc.tl), JSON.stringify(acc));

  // เน็ตหลุด: ค่าล่าสุดยังอยู่ พร้อมบอกว่าเชื่อมต่อไม่ได้
  apiDown = true; btc = 1;
  await p.evaluate(id => { window.webmix.inputs.find(i => i.id === id).wd.at = 1; }, w1.id); await p.waitForTimeout(1800);
  const w1b = await w(1);
  ok('when the API fails, the last value stays on screen with a warning', /2,500,000/.test(w1b.wd.value) && !!w1b.wd.error && w1b.status === 'live', JSON.stringify(w1b.wd));
  apiDown = false;

  // บันทึกโชว์
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(2500);
  const kinds = await p.evaluate(() => window.webmix.inputs.filter(i => i.type === 'widget').map(i => `${i.widget.kind}:${i.status}`));
  ok('all widgets come back and refresh after reload', kinds.length === 4 && kinds.every(k => /:live$/.test(k)), JSON.stringify(kinds));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
