// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// เทมเพลตโชว์สำเร็จรูป: เปิดจากหน้าต่างโชว์ / เมนูเพิ่มแหล่งภาพ · เพิ่มแหล่งภาพครบตามแบบ (ไม่ลบของเดิม) · ทุกแหล่งวาดได้ · บันทึกโชว์
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx.route(/api\.open-meteo\.com/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"current":{"temperature_2m":30,"weather_code":0,"relative_humidity_2m":60}}' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  const before = await p.evaluate(() => window.webmix.inputs.length);
  await p.click('[data-action=show]'); await p.click('.modal [data-show=tpl]');
  await p.waitForSelector('.modal .tpl-card');
  ok('template picker opens from the Show dialog with 5 templates', (await p.$$('.modal .tpl-card')).length === 5);
  await p.click('.modal .tpl-card[data-tpl=news]'); await p.waitForTimeout(800);
  const news = await p.evaluate(() => window.webmix.inputs.map(i => i.type));
  ok('news template adds its sources and keeps the existing ones', news.length === before + 7 && ['vset', 'title', 'ticker', 'widget', 'clock', 'slate'].every(t => news.includes(t)), JSON.stringify(news));
  ok('show gets the template name', await p.evaluate(() => window.webmix.show.name) === 'ข่าว / สนทนา', await p.evaluate(() => window.webmix.show.name));
  // ทุกเทมเพลตจากเมนูเพิ่มแหล่งภาพ
  for (const id of ['podcast', 'sales', 'sport', 'ceremony']) {
    await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("เทมเพลตโชว์สำเร็จรูป")');
    await p.waitForSelector('.modal .tpl-card'); await p.click(`.modal .tpl-card[data-tpl=${id}]`); await p.waitForTimeout(500);
  }
  const all = await p.evaluate(() => window.webmix.inputs.map(i => i.type));
  ok('all templates add sources (scene, timer, score, chat, visualizer, colour)', ['scene', 'timer', 'score', 'chat', 'visualizer', 'color'].every(t => all.includes(t)), JSON.stringify(all));
  // ทุกแหล่งวาดบน Program ได้โดยไม่มีข้อผิดพลาด
  const drawn = await p.evaluate(async () => { const w = window.webmix, bad = []; for (const i of w.inputs) { w.state.programId = i.id; await new Promise(r => setTimeout(r, 60)); } return bad; });
  ok('every template source renders on Program', drawn.length === 0 && errs.length === 0, JSON.stringify(errs));
  const tl = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'title').title.headline);
  ok('titles come with placeholder text to edit', tl === 'ชื่อผู้ประกาศ', tl);
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(2000);
  ok('everything is saved with the show', await p.evaluate(n => window.webmix.inputs.length === n, all.length), String(await p.evaluate(() => window.webmix.inputs.length)));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
