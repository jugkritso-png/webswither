// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// หน้าต่างคอมเมนต์ไลฟ์: กรองคำถาม/แพลตฟอร์ม · หยุดเลื่อน · แสดงขึ้นจอ · พิมพ์เอง · กรองคำหยาบ · บัญชีที่เชื่อม
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  await p.evaluate(() => { const w = window.webmix; w.chatAdd({ id: 'a', platform: 'youtube', name: 'มายด์', text: 'สวัสดีค่ะ' }); w.chatAdd({ id: 'b', platform: 'twitch', name: 'ken', text: 'ราคาเท่าไหร่ครับ?' }); w.chatAdd({ id: 'c', platform: 'youtube', name: 'x', text: 'what the fuck' }); });
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("คอมเมนต์ผู้ชม")'); await p.waitForSelector('.ct-modal');
  ok('all comments listed', (await p.$$('.ct-item')).length === 3);
  ok('profanity masked', (await p.textContent('.ct-list')).includes('what the ***') && !(await p.textContent('.ct-list')).includes('fuck'));
  await p.click('.ct-f[data-f=q]'); await p.waitForTimeout(250);
  ok('question filter', (await p.$$('.ct-item')).length === 1 && (await p.textContent('.ct-list')).includes('เท่าไหร่'));
  await p.click('.ct-f[data-f=youtube]'); await p.waitForTimeout(250);
  ok('platform filter', (await p.$$('.ct-item')).length === 2);
  await p.click('.ct-f[data-f=all]'); await p.waitForTimeout(250);
  await p.click('[data-ct=pause]');
  await p.evaluate(() => window.webmix.chatAdd({ id: 'd', platform: 'youtube', name: 'nok', text: 'แชร์แล้ว' }));
  await p.waitForTimeout(300);
  ok('paused list does not move', (await p.$$('.ct-item')).length === 3 && (await p.textContent('[data-ct=pause]')).includes('ใหม่ 1'));
  await p.click('[data-ct=pause]'); await p.waitForTimeout(250);
  ok('resume shows new comments', (await p.$$('.ct-item')).length === 4);
  await p.click('.ct-item:has-text("ราคาเท่าไหร่") [data-show]'); await p.waitForTimeout(400);
  ok('“show” puts the comment on screen', await p.evaluate(() => window.webmix.chatFeed.shown?.id === 'b'));
  ok('marked as on screen', await p.isVisible('.ct-item.is-on .ct-on'));
  ok('COMMENTS goes on an overlay', await p.evaluate(() => { const w = window.webmix; const id = w.inputs.find(i => i.type === 'chat').id; return w.ovl.some(c => c.on && c.inputId === id); }));
  await p.fill('.ct-modal [name=ctName]', 'ป้าแดง'); await p.fill('.ct-modal [name=ctText]', 'จาก Facebook ค่ะ'); await p.press('.ct-modal [name=ctText]', 'Enter'); await p.waitForTimeout(300);
  ok('typed comment added', (await p.textContent('.ct-list')).includes('จาก Facebook ค่ะ') && await p.isVisible('.ct-modal'));
  ok('accounts box lists YouTube / Twitch / Facebook', /YouTube[\s\S]*Twitch[\s\S]*Facebook/.test(await p.textContent('.ct-conns')));
  await p.click('.ct-modal .modal-foot .btn:has-text("ซ่อนคอมเมนต์จากจอ")'); await p.waitForTimeout(500);
  ok('hide button hides without closing', !(await p.evaluate(() => window.webmix.chatFeed.shown)) && await p.isVisible('.ct-modal'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
