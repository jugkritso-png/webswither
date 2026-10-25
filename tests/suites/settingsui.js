// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ตั้งค่า (แบบใหม่): เมนูหมวดด้านซ้าย 6 หมวด · พื้นฐาน / ขั้นสูง · ทั่วไป / เสียง / ระบบ มีผลทันที
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  await p.click('[data-action=settings]'); await p.waitForSelector('.set-modal');
  ok('seven categories', (await p.$$('.set-tabs [data-mtab]')).length === 7);
  ok('categories on the left', await p.evaluate(() => { const t = document.querySelector('.set-tabs').getBoundingClientRect(), pane = document.querySelector('.modal-pane.is-active').getBoundingClientRect(); return t.right <= pane.left + 1 && t.height > 200; }));
  await p.click('.set-level [data-lv=adv]');
  ok('advanced opens the folded options', await p.evaluate(() => [...document.querySelectorAll('.set-modal details.adv')].every(d => d.open)));
  await p.click('[data-mtab=general]');
  await p.click('[data-x-seg=cardSize][data-v=l]');
  ok('card size from settings', await p.evaluate(() => document.documentElement.dataset.cards === 'l'));
  await p.click('.set-sw:has([data-x=keepAwake])');
  ok('keep-awake toggle saved', await p.evaluate(() => window.webmix.settings.keepAwake === false));
  await p.click('[data-mtab=audio]');
  await p.click('[data-x-seg=lufs][data-v="-23"]');
  ok('LUFS target from settings', await p.evaluate(() => window.webmix.lufs.target === -23) && (await p.textContent('#lufs')).includes('-23'));
  await p.click('.set-sw:has([data-x=limiter])');
  ok('limiter toggle', await p.evaluate(() => window.webmix.audio.masterStrip.limiter === false));
  await p.click('[data-mtab=system]');
  ok('system pane shows version and renderer', /เวอร์ชัน/.test(await p.textContent('[data-mpane=system]')) && /CPU|GPU/.test(await p.textContent('[data-mpane=system]')));
  await p.click('[data-mtab=control]');
  ok('MIDI pane still there', await p.isVisible('[data-mpane=control].is-active'));
  await p.click('.modal-foot .btn-primary');
  await p.click('[data-action=settings]'); await p.waitForSelector('.set-modal');
  ok('level remembered', await p.evaluate(() => document.querySelector('[data-lv=adv]').classList.contains('is-active')));
  await p.keyboard.press('Escape');
  // คู่มือและคีย์ลัด
  await p.click('[data-action=help]'); await p.waitForSelector('.hp-modal');
  ok('help: table of contents + key groups', (await p.$$('.hp-toc button')).length > 5 && (await p.$$('.hp-card')).length === 3 && (await p.$$('.hp-kb kbd')).length > 10);
  await p.fill('.hp-search input', 'รีเพลย์'); await p.waitForTimeout(200);
  const vis = await p.evaluate(() => [...document.querySelectorAll('.hp-k, .hp-sec li')].filter(x => !x.hidden).map(x => x.textContent));
  ok('help search filters', vis.length > 0 && vis.every(t => /รีเพลย์|Replay/i.test(t)), JSON.stringify(vis.slice(0, 3)));
  await p.keyboard.press('Escape');
  // หน้าต่าง Program Output: แถบควบคุมลอย
  const [win] = await Promise.all([p.waitForEvent('popup'), p.evaluate(() => window.webmix.openOutputWindow())]);
  await win.waitForTimeout(800);
  ok('output window control bar', await win.isVisible('#bar') && /OFF AIR/.test(await win.textContent('#st')) && await win.isVisible('#pick'));
  await win.waitForTimeout(3300);
  ok('bar hides itself after 3 s', await win.evaluate(() => document.body.classList.contains('idle')));
  await win.mouse.move(200, 200); await win.waitForTimeout(200);
  ok('mouse move brings it back', await win.evaluate(() => !document.body.classList.contains('idle')));
  await win.close();
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
