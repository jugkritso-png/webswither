// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// คอมเมนต์ผู้ชม: พิมพ์เอง · YouTube (จำลอง API) · Twitch (จำลอง IRC WebSocket) · กดขึ้นจอผ่าน Overlay · ซ่อน · ซ่อนเอง · key ไม่อยู่ในไฟล์โชว์ · ตัดบรรทัดภาษาไทย
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // YouTube Data API จำลอง: key "GOOD" ใช้ได้ · อย่างอื่น = key ผิด
  let polls = 0;
  await ctx.route(/googleapis\.com\/youtube\/v3\//, r => {
    const u = new URL(r.request().url());
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (u.searchParams.get('key') !== 'GOOD') return json(400, { error: { message: 'API key not valid', errors: [{ reason: 'badRequest' }] } });
    if (u.pathname.endsWith('/videos')) return json(200, { items: [{ id: u.searchParams.get('id'), liveStreamingDetails: { activeLiveChatId: 'CHAT1' } }] });
    polls++;
    const item = (id, name, text, extra = {}) => ({ id, snippet: { displayMessage: text, publishedAt: new Date().toISOString(), ...extra }, authorDetails: { displayName: name } });
    const items = polls === 1 ? [item('a1', 'สมชาย', 'สวัสดีครับ ฟังจากเชียงใหม่'), item('a2', 'Jane', 'Hello from London')]
      : polls === 2 ? [item('a3', 'ผู้สนับสนุน', 'ขอบคุณรายการดี ๆ', { superChatDetails: { amountDisplayString: '฿100.00', userComment: 'ขอบคุณรายการดี ๆ' } })] : [];
    return json(200, { items, nextPageToken: 'p' + polls, pollingIntervalMillis: 1000 });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  // Twitch IRC จำลอง
  await p.routeWebSocket('wss://irc-ws.chat.twitch.tv/', ws => {
    ws.onMessage(m => {
      if (String(m).startsWith('JOIN')) {
        ws.send(':tmi.twitch.tv 366 justinfan #chan :End of /NAMES list');
        ws.send('@badges=moderator/1;display-name=TwMod;id=tw1;tmi-sent-ts=1 :twmod!twmod@twmod.tmi.twitch.tv PRIVMSG #chan :ทักทายจาก Twitch');
      }
    });
  });
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);

  await p.click('.tab[data-tab="chat"]');
  ok('comments tab opens with an empty list', await p.locator('[data-pane="chat"].is-active').count() === 1 && (await p.textContent('#chat-list')).includes('คอมเมนต์ใหม่'));
  ok('tab bar stays on one line', await p.evaluate(() => { const t = [...document.querySelectorAll('.tabs .tab')]; return t.every(x => Math.abs(x.getBoundingClientRect().top - t[0].getBoundingClientRect().top) < 2); }));
  await p.fill('#chat-manual [name=who]', 'ป้าแดง'); await p.fill('#chat-manual [name=text]', 'ขอเพลงรักแรกพบหน่อยค่ะ');
  await p.press('#chat-manual [name=text]', 'Enter'); await p.waitForTimeout(400);
  ok('typed comment appears in the list', (await p.locator('.chat-item').first().textContent()).includes('ขอเพลงรักแรกพบ'));

  const pgmCard = () => p.evaluate(() => { const c = document.getElementById('pgm-canvas'); const d = c.getContext('2d').getImageData(Math.round(c.width * 0.05) + 2, Math.round(c.height * 0.83), 1, 1).data; return [...d].slice(0, 3); });
  const before = await pgmCard();
  await p.locator('.chat-item').first().click(); await p.waitForTimeout(900);
  const st = await p.evaluate(() => { const w = window.webmix; const inp = w.inputs.find(i => i.type === 'chat'); return { inp: !!inp, on: !!inp && w.ovl.some(c => c.on && c.inputId === inp.id), shown: w.chatFeed.shown?.name }; });
  ok('click -> COMMENTS source created and put on an overlay', st.inp && st.on && st.shown === 'ป้าแดง', JSON.stringify(st));
  const after = await pgmCard();
  ok('comment card drawn on Program (blue accent stripe)', after[2] > 180 && after[2] > after[0] + 80, `${before} → ${after}`);
  ok('"on screen" bar + list highlight', (await p.textContent('#chat-now')).includes('ป้าแดง') && await p.locator('.chat-item.is-shown').count() === 1 && await p.locator('.tab[data-tab="chat"].is-live').count() === 1);
  await p.screenshot({ path: S + '/chat.png' });
  await p.click('#chat-now [data-chat=hide]'); await p.waitForTimeout(500);
  ok('hide -> card animates out and clears', await p.evaluate(() => window.webmix.chatFeed.shown === null) && await p.locator('.chat-item.is-shown').count() === 0);

  // เชื่อมต่อ YouTube (key ผิด) -> แจ้งข้อผิดพลาดที่อ่านเข้าใจ
  await p.click('[data-chat=connect]'); await p.waitForSelector('.modal [name=yt]');
  await p.fill('.modal [name=yt]', 'https://www.youtube.com/live/AbCdEfGhIjK?si=x'); await p.fill('.modal [name=key]', 'WRONG');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800);
  ok('bad API key -> clear error chip', (await p.textContent('#chat-conn')).includes('API key ไม่ถูกต้อง'), await p.textContent('#chat-conn'));

  // YouTube + Twitch พร้อมกัน
  await p.click('[data-chat=connect]'); await p.waitForSelector('.modal [name=yt]');
  ok('dialog remembers link and key', await p.inputValue('.modal [name=yt]') === 'https://www.youtube.com/live/AbCdEfGhIjK?si=x' && await p.inputValue('.modal [name=key]') === 'WRONG');
  await p.fill('.modal [name=key]', 'GOOD'); await p.fill('.modal [name=tw]', 'https://www.twitch.tv/Chan');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(7000);
  const conn = await p.textContent('#chat-conn');
  ok('both platforms connected', /YouTube: เชื่อมต่อแล้ว/.test(conn) && /Twitch: เชื่อมต่อแล้ว/.test(conn), conn);
  const names = await p.evaluate(() => window.webmix.chatFeed.list.map(m => `${m.platform}:${m.name}`));
  ok('YouTube messages arrive (first page + next poll)', ['youtube:สมชาย', 'youtube:Jane', 'youtube:ผู้สนับสนุน'].every(n => names.includes(n)), JSON.stringify(names));
  ok('Twitch message arrives with display name', names.includes('twitch:TwMod'), JSON.stringify(names));
  ok('Super Chat amount shown in the list', (await p.textContent('#chat-list')).includes('฿100.00'));
  ok('newest comment on top', (await p.locator('.chat-item').first().textContent()).includes('ผู้สนับสนุน') || (await p.locator('.chat-item').first().textContent()).includes('TwMod'));

  // ซ่อนเองตามเวลา
  await p.evaluate(() => { window.webmix.chatFeed.autoHide = 1; });
  await p.locator('.chat-item', { hasText: 'TwMod' }).click(); await p.waitForTimeout(400);
  ok('Twitch comment on screen', await p.evaluate(() => window.webmix.chatFeed.shown?.platform === 'twitch'));
  await p.waitForTimeout(1500);
  ok('auto-hide after the set time', await p.evaluate(() => window.webmix.chatFeed.shown === null));

  // API key ไม่หลุดไปกับไฟล์โชว์
  const showJson = await p.evaluate(() => JSON.stringify(window.webmix.show.serialize()));
  ok('API key is not saved in the show file', !showJson.includes('GOOD') && showJson.includes('"type":"chat"'));
  ok('macro and MIDI can hide the comment', await p.evaluate(async () => {
    const w = window.webmix; w.chatShow(w.chatFeed.list[0]);
    w.macros.push({ id: 'mc', name: 'hide', key: '', at: '', steps: [{ a: 'chatHide', v: '' }] });
    await w.runMacro(w.macros[w.macros.length - 1]); await new Promise(r => setTimeout(r, 400));
    return w.chatFeed.shown === null;
  }));
  // ตัดบรรทัดภาษาไทยไม่ล้นกรอบ
  const wrap = await p.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d'); c.font = '500 30px sans-serif';
    const text = 'ขอบคุณทุกคนที่ติดตามรายการของเรามาตลอดทั้งปีนะครับ วันนี้มีของรางวัลพิเศษแจกให้ผู้ชมที่คอมเมนต์เข้ามาด้วย';
    const lines = window.WebMix.chat.wrapLines(c, text, 400, 3);
    return { n: lines.length, fit: lines.every(l => c.measureText(l).width <= 401), ell: lines[lines.length - 1].endsWith('…') };
  });
  ok('Thai text wraps by word within the card (max 3 lines, ellipsis)', wrap.n === 3 && wrap.fit && wrap.ell, JSON.stringify(wrap));
  // สไตล์การ์ดเปลี่ยนได้และเปิดหน้าใหม่ยังอยู่
  await p.evaluate(() => { window.webmix.inputs.find(i => i.type === 'chat').chat.style = 'center'; window.webmix.show.autosave(true); });
  await p.reload(); await p.waitForTimeout(1200);
  ok('COMMENTS source and style restored', await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'chat')?.chat.style === 'center'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
