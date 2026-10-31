// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// สร้างไลฟ์บน YouTube / Facebook จากในแอป (API จำลอง): เข้าสู่ระบบ → ตั้งชื่อ / เวลา / ความเป็นส่วนตัว → ได้ Server + Stream key ในปลายทาง
// ไม่ทับปลายทางที่มีคีย์แล้ว · ข้อความผิดพลาดเป็นภาษาคน · โทเคนไม่ถูกบันทึกลงเครื่อง
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GIS = `window.google = { accounts: { oauth2: { initTokenClient(o) { window.__gis = o; return { requestAccessToken() { setTimeout(() => o.callback({ access_token: 'YTTOK', expires_in: 3600 }), 50); } }; } } } };`;
const FBSDK = `window.FB = { init(o) {}, login(cb, o) { window.__fbScope = o.scope; setTimeout(() => cb({ authResponse: { accessToken: 'USERTOK' } }), 50); }, logout(cb) { cb && cb(); } }; window.fbAsyncInit && window.fbAsyncInit();`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx.route(/accounts\.google\.com\/gsi\/client/, r => r.fulfill({ contentType: 'application/javascript', body: GIS }));
  await ctx.route(/connect\.facebook\.net/, r => r.fulfill({ contentType: 'application/javascript', body: FBSDK }));
  const yt = []; let ytFail = '';
  const json = (r, o, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(o) });
  await ctx.route(/googleapis\.com\/youtube\/v3\//, r => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    yt.push({ path: u.pathname.replace(/.*\/v3\//, ''), auth: req.headers().authorization, body: req.postDataJSON?.() || null, q: Object.fromEntries(u.searchParams) });
    if (ytFail) return json(r, { error: { message: 'no', errors: [{ reason: ytFail }] } }, 403);
    if (u.pathname.endsWith('/liveBroadcasts')) return json(r, { id: 'BRD123' });
    if (u.pathname.endsWith('/liveStreams')) return json(r, { id: 'STR9', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', streamName: 'abcd-efgh-ijkl-mnop' } } });
    if (u.pathname.endsWith('/bind')) return json(r, { id: 'BRD123' });
    return json(r, {}, 404);
  });
  const fbPosts = [];
  await ctx.route(/graph\.facebook\.com/, r => {
    const req = r.request(), u = new URL(req.url()), path = u.pathname.replace(/^\/v[\d.]+\//, '');
    if (path === 'me') return json(r, { id: 'u1', name: 'สมชาย' });
    if (path === 'me/accounts') return json(r, { data: [{ id: 'p1', name: 'เพจรายการ', access_token: 'PAGETOK1', tasks: ['MANAGE'] }] });
    if (path === 'p1/live_videos' && req.method() === 'POST') { fbPosts.push(Object.fromEntries(new URLSearchParams(req.postData()))); return json(r, { id: 'v900', secure_stream_url: 'rtmps://live-api-s.facebook.com:443/rtmp/FB-1-KEY?s_bl=1&a=x' }); }
    if (path === 'p1/live_videos') return json(r, { data: [] });
    return json(r, {}, 404);
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); localStorage.setItem('webmix:settings', JSON.stringify({ rememberKey: true, destinations: [
    { id: 'tw', platform: 'twitch', server: 'rtmp://live.twitch.tv/app', key: 'live_old', enabled: true },
    { id: 'yt0', platform: 'youtube', server: 'rtmp://a.rtmp.youtube.com/live2', key: '', enabled: false }] })); });
  await p.reload(); await p.waitForTimeout(800);
  const open = async () => { await p.click('[data-action=stream]'); await p.click('[data-lv=schedule]'); await p.waitForSelector('.sch-plat'); };
  await open();
  ok('live panel opens “create a live” with YouTube / Facebook', await p.locator('.sch-plat button').count() === 2);
  ok('create button disabled until signed in', await p.isDisabled('.sch-go'));
  await p.click('[data-sch=ytlogin]');
  ok('asks for a proper OAuth Client ID', /Client ID/.test(await p.textContent('.sch-err')));
  await p.fill('[name=ytclient]', '1234-abc.apps.googleusercontent.com'); await p.click('[data-sch=ytlogin]'); await sleep(400);
  ok('Google sign-in with the user’s client id and the YouTube scope', await p.evaluate(() => window.__gis?.client_id === '1234-abc.apps.googleusercontent.com' && /auth\/youtube$/.test(window.__gis.scope)));
  ok('signed in → create enabled', /เข้าสู่ระบบ Google แล้ว/.test(await p.textContent('.sch-auth')) && !(await p.isDisabled('.sch-go')));

  // ตั้งเวลา + ไม่เป็นสาธารณะ
  await p.fill('[name=title]', 'ถ่ายทอดสดงานบวช'); await p.fill('[name=desc]', 'รายละเอียดงาน');
  await p.selectOption('[name=when]', 'at');
  const when = await p.evaluate(() => { const d = new Date(Date.now() + 2 * 3600e3); d.setSeconds(0, 0); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  await p.fill('[name=at]', when); await p.selectOption('[name=privacy]', 'unlisted');
  await p.click('.sch-go'); await sleep(800);
  const brd = yt.find(x => x.path === 'liveBroadcasts');
  ok('creates the broadcast with title, description, time, privacy', brd && brd.body.snippet.title === 'ถ่ายทอดสดงานบวช' && brd.body.snippet.description === 'รายละเอียดงาน' && brd.body.status.privacyStatus === 'unlisted' && Math.abs(Date.parse(brd.body.snippet.scheduledStartTime) - (Date.now() + 2 * 3600e3)) < 120e3 && brd.auth === 'Bearer YTTOK', JSON.stringify(brd && brd.body));
  ok('creates a stream and binds it', yt.some(x => x.path === 'liveStreams' && x.body.cdn.ingestionType === 'rtmp') && yt.some(x => x.path === 'liveBroadcasts/bind' && x.q.id === 'BRD123' && x.q.streamId === 'STR9'));
  const dests = () => p.evaluate(() => window.webmix.settings.destinations.map(d => ({ id: d.id, platform: d.platform, server: d.server, key: d.key, enabled: d.enabled })));
  let ds = await dests();
  ok('stream key goes into the empty YouTube destination, now ticked', ds.find(d => d.id === 'yt0').key === 'abcd-efgh-ijkl-mnop' && ds.find(d => d.id === 'yt0').enabled && ds.length === 2, JSON.stringify(ds));
  ok('Twitch destination untouched', ds.find(d => d.id === 'tw').key === 'live_old');
  ok('viewer link shown', (await p.inputValue('.sch-done input')) === 'https://www.youtube.com/watch?v=BRD123');

  // ครั้งที่สอง: ช่อง YouTube มีคีย์แล้ว → เพิ่มช่องใหม่ (ไม่ทับ)
  await p.fill('[name=title]', 'ไลฟ์ที่สอง'); await p.selectOption('[name=when]', 'now'); await p.click('.sch-go'); await sleep(800);
  ds = await dests();
  ok('a second live adds a new destination instead of overwriting', ds.length === 3 && ds.filter(d => d.platform === 'youtube').length === 2, JSON.stringify(ds));

  // ช่องยังไม่เปิดใช้ไลฟ์ → ข้อความภาษาคน
  ytFail = 'liveStreamingNotEnabled';
  await p.click('.sch-go'); await sleep(600);
  ok('“live streaming not enabled” explained', /YouTube Studio/.test(await p.textContent('.sch-err')), await p.textContent('.sch-err'));
  ytFail = '';

  // Facebook: ขอสิทธิ์ publish_video · เลือกเพจ · คีย์แยกจาก server
  await p.click('[data-plat=facebook]');
  await p.fill('[name=fbapp]', '1234567890'); await p.click('[data-sch=fblogin]'); await sleep(600);
  ok('Facebook sign-in asks for publish_video', await p.evaluate(() => /publish_video/.test(window.__fbScope)));
  ok('page list after sign-in', await p.locator('[name=page] option').count() === 1);
  await p.fill('[name=title]', 'ไลฟ์ขายของ');
  await p.selectOption('[name=when]', 'at');
  const soon = await p.evaluate(() => { const d = new Date(Date.now() + 5 * 60e3); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  await p.fill('[name=at]', soon); await p.click('.sch-go'); await sleep(300);
  ok('Facebook schedule must be 10 min – 7 days ahead', /10 นาที/.test(await p.textContent('.sch-err')) && fbPosts.length === 0);
  await p.selectOption('[name=when]', 'now'); await p.click('.sch-go'); await sleep(800);
  ok('creates the page live video with the page token', fbPosts.length === 1 && fbPosts[0].title === 'ไลฟ์ขายของ' && fbPosts[0].status === 'UNPUBLISHED' && fbPosts[0].access_token === 'PAGETOK1', JSON.stringify(fbPosts));
  ds = await dests();
  const fd = ds.find(d => d.platform === 'facebook');
  ok('Facebook server and key split into the destination', fd && fd.server === 'rtmps://live-api-s.facebook.com:443/rtmp' && fd.key === 'FB-1-KEY?s_bl=1&a=x' && fd.enabled, JSON.stringify(fd));

  // ไม่เก็บโทเคนลงเครื่อง
  const ls = await p.evaluate(() => JSON.stringify(localStorage));
  ok('tokens are not saved to the device', !/YTTOK|USERTOK|PAGETOK1/.test(ls));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
