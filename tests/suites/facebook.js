// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// คอมเมนต์ Facebook (design 67): เข้าสู่ระบบ (SDK จำลอง) → เลือกเพจ → ดึงคอมเมนต์ไลฟ์ (Graph API จำลอง) → เข้าแชท · โทเคนไม่ถูกบันทึก
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const SDK = `window.FB = { init(o) { window.__fbInit = o; }, login(cb, o) { window.__fbScope = o.scope; setTimeout(() => cb({ authResponse: { accessToken: 'USERTOK' } }), 100); }, logout(cb) { cb && cb(); } }; window.fbAsyncInit && window.fbAsyncInit();`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx.route(/connect\.facebook\.net/, r => r.fulfill({ contentType: 'application/javascript', body: SDK }));
  const calls = []; let n = 0;
  await ctx.route(/graph\.facebook\.com/, r => {
    const u = new URL(r.request().url()); calls.push(u.pathname + ' ' + u.searchParams.get('access_token'));
    const json = o => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    const path = u.pathname.replace(/^\/v[\d.]+\//, '');
    if (path === 'me') return json({ id: 'u1', name: 'สมชาย ใจดี' });
    if (path === 'me/accounts') return json({ data: [{ id: 'p1', name: 'เพจรายการ', access_token: 'PAGETOK1', tasks: ['MANAGE', 'MODERATE'], followers_count: 12400 }, { id: 'p2', name: 'เพจองค์กร', access_token: 'PAGETOK2', tasks: ['MODERATE'] }] });
    if (path === 'p1/live_videos') return json({ data: [{ id: 'v111111', live_views: 128 }] });
    if (path === 'p2/live_videos') return json({ data: [] });
    if (path === 'v111111/comments') {
      n++;
      const data = [{ id: 'c1', from: { name: 'ป้าแดง' }, message: 'เสียงชัดมากวันนี้', created_time: new Date().toISOString() }];
      if (n > 1) data.unshift({ id: 'c2', from: { name: 'สมศรี' }, message: 'ขอเพลงเปิดอีกรอบได้ไหมคะ', created_time: new Date().toISOString() });
      return json({ data });
    }
    if (path === 'v111111') return json({ id: 'v111111', live_views: 128 });
    if (path === '999999/comments') return json({ error: { code: 190, message: 'expired' } });
    return r.fulfill({ status: 404, body: '{}' });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);

  // เปิดจากหน้าต่างคอมเมนต์ → แถว Facebook
  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("คอมเมนต์ผู้ชม")'); await p.waitForSelector('.ct-modal');
  ok('accounts box offers to connect Facebook', /Facebook/.test(await p.textContent('.ct-conns')) && await p.isVisible('.ct-conns [data-ct=fb]'));
  await p.click('.ct-conns [data-ct=fb]'); await p.waitForSelector('.fb-modal');
  ok('step 1 active, not signed in', /ยังไม่ได้เข้าสู่ระบบ/.test(await p.textContent('.fb-acct')) && (await p.textContent('.fb-steps li.is-on')).includes('เข้าสู่ระบบ'));
  ok('read-only, pages-only note', /อ่านอย่างเดียว/.test(await p.textContent('.fb-note')) && /เพจเท่านั้น/.test(await p.textContent('.fb-note')));
  await p.click('[data-fb=login]'); await p.waitForTimeout(200);
  ok('asks for an App ID first', await p.isVisible('.fb-err') && /App ID/.test(await p.textContent('.fb-err')));
  await p.fill('.fb-modal [name=appid]', '1234567890123456');
  await p.click('[data-fb=login]');
  ok('signed in, pages listed with live badge', await until(() => p.evaluate(() => document.querySelectorAll('.fb-page').length === 2)) && /สมชาย/.test(await p.textContent('.fb-acct')) && /กำลังไลฟ์/.test(await p.textContent('.fb-page.is-on')), await p.textContent('.fb-plist'));
  ok('SDK initialised with the App ID and read scopes', await p.evaluate(() => window.__fbInit?.appId === '1234567890123456' && /pages_read_engagement/.test(window.__fbScope) && !/publish|manage_posts/.test(window.__fbScope)));
  ok('step 2 active', (await p.textContent('.fb-steps li.is-on')).includes('เลือกเพจ'));
  await p.click('[data-fb=go]');
  ok('comments arrive in the panel', await until(() => p.evaluate(() => /ป้าแดง/.test(document.querySelector('.fb-list').textContent))));
  ok('poll status says connected', await until(() => p.evaluate(() => /ทุก 3 วินาที/.test(document.querySelector('.fb-poll').textContent))));
  ok('new comments keep coming', await until(() => p.evaluate(() => /สมศรี/.test(document.querySelector('.fb-list').textContent)), 9000));
  ok('live viewer count read with the comments', await until(() => p.evaluate(() => window.webmix.chatFeed.viewers.facebook?.n === 128)), JSON.stringify(await p.evaluate(() => window.webmix.chatFeed.viewers)));
  ok('uses the page token for the live video', calls.some(c => /v111111\/comments PAGETOK1/.test(c)));
  ok('comments land in the chat feed as facebook, no duplicates', await p.evaluate(() => { const l = window.webmix.chatFeed.list.filter(m => m.platform === 'facebook'); return l.length === 2 && l[0].name === 'ป้าแดง'; }));
  await p.screenshot({ path: S + '/facebook.png' });
  ok('no token stored', await p.evaluate(() => !/TOK/.test(JSON.stringify(localStorage))) && await p.evaluate(() => localStorage.getItem('webmix:fb-appid') !== null || /1234567890123456/.test(JSON.stringify(localStorage))));

  // ลิงก์วิดีโอที่หมดอายุ → แจ้งให้เชื่อมใหม่
  await p.click('.fb-mode [data-mode=link]');
  await p.fill('.fb-modal [name=fbvideo]', 'https://www.facebook.com/page/videos/999999');
  await p.click('[data-fb=go]');
  ok('expired login explained', await until(() => p.evaluate(() => /หมดอายุ/.test(document.querySelector('.fb-err').textContent))), await p.textContent('.fb-err'));
  await p.click('.fb-modal .modal-foot .btn:has-text("ตัดการเชื่อม")'); await p.waitForTimeout(300);
  ok('disconnect returns to step 1', /ยังไม่ได้เข้าสู่ระบบ/.test(await p.textContent('.fb-acct')) && await p.evaluate(() => window.webmix.chatFeed.status.facebook[0] === 'off'));
  await p.click('.fb-modal .modal-foot .btn-primary');

  // วางโทเคนของเพจเอง (แอปเดสก์ท็อป)
  await p.evaluate(() => { window.webmix.openFacebookDialog(); }); await p.waitForSelector('.fb-modal');
  if (!(await p.isVisible('.fb-modal [name=ptoken]'))) await p.click('.fb-adv summary');
  await p.fill('.fb-modal [name=ptoken]', 'PASTEDTOK'); await p.click('[data-fb=token]');
  ok('pasted token signs in without the Facebook window', await until(() => p.evaluate(() => document.querySelectorAll('.fb-page').length === 2)) && calls.some(c => / PASTEDTOK$/.test(c)));
  ok('pasted token not kept in the field or storage', (await p.inputValue('.fb-modal [name=ptoken]')) === '' && await p.evaluate(() => !/TOK/.test(JSON.stringify(localStorage))));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
