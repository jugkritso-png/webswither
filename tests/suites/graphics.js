// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// กราฟิกข้อมูล: นาฬิกานับถอยหลัง/จับเวลา, ป้ายคะแนน, ตัววิ่งข่าว, ข้อมูลจาก Google Sheets/CSV (ทั้งโหมด CPU และ GPU)
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // ชีตจำลอง: ลิงก์ Google Sheets ถูกแปลงเป็น gviz CSV แล้วดึงจากเบราว์เซอร์
  const SHEET = gid => `https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=${gid}`;
  const GID = { title: 77, ticker: 78, score: 79 };
  let csv = { title: 'ชื่อ,ตำแหน่ง\nสมชาย ใจดี,ผู้ประกาศข่าว\n"สมหญิง, รักไทย",นักข่าวภาคสนาม\n', ticker: 'ข่าว\nข่าวที่หนึ่ง\nข่าวที่สอง\n', score: 'A,SA,B,SB,P\nเชียงใหม่,3,ลำพูน,1,ครึ่งหลัง\n' };
  let sheetStatus = 200;
  await ctx.route(/docs\.google\.com\/spreadsheets\/d\/1AbCdEf[^/]*\/gviz\/tq\?tqx=out:csv&gid=(\d+)/, r => {
    const gid = +/gid=(\d+)/.exec(r.request().url())[1], which = Object.keys(GID).find(k => GID[k] === gid);
    const status = which === 'score' ? sheetStatus : 200;
    return r.fulfill({ status, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: status === 200 ? csv[which] : 'not found' });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'black').id; w.dataSources.REFRESH_MS = 600; });
  const px = (x, y, sel = '#pgm-canvas') => p.evaluate(([x, y, sel]) => { const c = document.querySelector(sel); return Array.from(c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3)); }, [x, y, sel]);
  const near = (a, c, t = 45) => a.every((v, i) => Math.abs(v - c[i]) <= t);
  const add = async label => { await p.click('[data-action=add-menu]'); await p.click(`.menu button:has-text("${label}")`); await p.waitForSelector('.modal-foot .btn-primary'); };
  const last = type => p.evaluate(t => window.webmix.inputs.filter(i => i.type === t).pop().id, type);
  const card = id => p.locator(`#inputs-grid .card[data-id="${id}"]`);
  const inp = id => p.evaluate(id => JSON.parse(JSON.stringify(window.webmix.inputs.find(i => i.id === id), (k, v) => k === 'el' ? undefined : v)), id);

  // --- countdown timer
  await add('นาฬิกานับถอยหลัง'); await p.fill('.modal [name=duration]', '00:04'); await p.click('.modal-foot .btn-primary');
  const timer = await last('timer');
  const timerTxt = () => p.evaluate(id => window.WebMix.timerText(window.webmix.inputs.find(i => i.id === id).timer).text, timer);
  ok('timer starts stopped at its duration', await timerTxt() === '00:04', await timerTxt());
  await card(timer).hover(); await card(timer).locator('[data-card=tplay]').click();
  await p.waitForTimeout(2200);
  ok('timer counts down while running', await timerTxt() === '00:02', await timerTxt());
  await card(timer).hover(); await card(timer).locator('[data-card=tplay]').click(); const paused = await timerTxt(); await p.waitForTimeout(1200);
  ok('pause holds the time', await timerTxt() === paused, paused);
  await card(timer).hover(); await card(timer).locator('[data-card=treset]').click();
  ok('reset returns to the full duration', await timerTxt() === '00:04');
  await p.evaluate(id => window.webmix.toggleInputOverlay(id, 0), timer); await p.waitForTimeout(700);
  const litRow = y => p.evaluate(y => { const c = document.querySelector('#pgm-canvas'); const d = c.getContext('2d').getImageData(0, Math.floor(c.height * y), c.width, 1).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 120) n++; return n; }, y);
  ok('timer drawn on program (transparent overlay)', (await litRow(0.52)) > 100 && near(await px(0.1, 0.9), [0, 0, 0], 10), String(await litRow(0.52)));
  await p.evaluate(id => { const t = window.webmix.inputs.find(i => i.id === id).timer; t.duration = 1; window.webmix.timerControl(window.webmix.inputs.find(i => i.id === id), 'toggle'); }, timer);
  await p.waitForTimeout(1600);
  ok('countdown stops at 00:00 and flags done', await p.evaluate(id => { const v = window.WebMix.timerValue(window.webmix.inputs.find(i => i.id === id).timer); return v.done && v.ms === 0; }, timer));
  await p.evaluate(id => window.webmix.toggleInputOverlay(id, 0), timer); await p.waitForTimeout(600);

  // --- scoreboard
  await add('ป้ายคะแนน'); await p.fill('.modal [name=teamA]', 'เชียงราย'); await p.fill('.modal [name=teamB]', 'น่าน'); await p.selectOption('.modal [name=clockMode]', 'up'); await p.click('.modal-foot .btn-primary');
  const score = await last('score');
  await card(score).hover();
  for (const a of ['sa+', 'sa+', 'sb+', 'sa+', 'sa-']) await card(score).locator(`[data-card="${a}"]`).click();
  const sc = (await inp(score)).score;
  ok('card buttons change the score', sc.scoreA === 2 && sc.scoreB === 1, `${sc.scoreA}-${sc.scoreB}`);
  await p.evaluate(id => window.webmix.toggleInputOverlay(id, 1), score); await p.waitForTimeout(700);
  ok('scoreboard drawn top-left (white score cell)', near(await px(0.03 + (8 + 170 + 8) / 1280, 0.05 + 20 / 720), [245, 247, 251], 20), JSON.stringify(await px(0.03 + (8 + 170 + 8) / 1280, 0.05 + 20 / 720)));
  ok('game clock shown under the score (amber bar)', near(await px(0.04, 0.05 + 95 / 720), [245, 165, 36], 30), JSON.stringify(await px(0.04, 0.05 + 95 / 720)));

  // --- ticker
  await add('ตัววิ่งข่าว'); await p.fill('.modal [name=items]', 'ข่าวแรก\nข่าวที่สอง\nข่าวที่สาม'); await p.click('.modal-foot .btn-primary');
  const ticker = await last('ticker');
  await p.evaluate(id => window.webmix.toggleInputOverlay(id, 2), ticker); await p.waitForTimeout(700);
  ok('ticker label in brand colour', near(await px(0.01, 0.86 + 0.0375), [239, 68, 68]), JSON.stringify(await px(0.01, 0.86 + 0.0375)));
  const strip = () => p.evaluate(() => { const c = document.querySelector('#pgm-canvas'), g = c.getContext('2d'); return Array.from(g.getImageData(200, Math.floor(c.height * 0.897), 900, 1).data).join(','); });
  const s1 = await strip(); await p.waitForTimeout(500); const s2 = await strip();
  ok('ticker text scrolls', s1 !== s2);
  ok('area above the ticker untouched', near(await px(0.5, 0.75), [0, 0, 0], 10));
  // same graphics on the GPU renderer
  await p.evaluate(() => window.webmix.setRenderer('gpu')); await p.waitForTimeout(600);
  ok('GPU: ticker label', near(await px(0.01, 0.86 + 0.0375), [239, 68, 68]), JSON.stringify(await px(0.01, 0.86 + 0.0375)));
  const g1 = await strip(); await p.waitForTimeout(500); const g2 = await strip();
  ok('GPU: ticker scrolls (strip-only texture)', g1 !== g2);
  ok('GPU: scoreboard', near(await px(0.03 + (8 + 170 + 8) / 1280, 0.05 + 20 / 720), [245, 247, 251], 20));
  await p.evaluate(() => window.webmix.setRenderer('cpu'));

  // --- Google Sheets data: title rundown
  await add('Title กราฟิกข้อความ'); await p.fill('.modal [name=dataUrl]', SHEET(GID.title)); await p.click('.modal-foot .btn-primary');
  const title = await last('title');
  ok('title takes row 1 from the sheet (header skipped)', await until(async () => (await inp(title)).title.headline === 'สมชาย ใจดี'), JSON.stringify((await inp(title)).title));
  ok('card shows the row position', /1\/2/.test(await card(title).locator('.card-sub').textContent()));
  await card(title).hover(); await card(title).locator('[data-card=dnext]').click();
  const t2 = (await inp(title)).title;
  ok('› moves to the next row (quoted CSV with comma)', t2.headline === 'สมหญิง, รักไทย' && t2.subtitle === 'นักข่าวภาคสนาม', JSON.stringify(t2));
  csv.title = 'ชื่อ,ตำแหน่ง\nสมชาย ใจดี,ผู้ประกาศข่าว\nสมหญิง แก้ไขแล้ว,บรรณาธิการ\n';
  ok('edits in the sheet appear on their own', await until(async () => (await inp(title)).title.headline === 'สมหญิง แก้ไขแล้ว'));
  // ticker + score from the sheet
  await card(ticker).hover(); await card(ticker).locator('[data-card=rename]').click(); await p.fill('.modal [name=dataUrl]', SHEET(GID.ticker)); await p.click('.modal-foot .btn-primary');
  ok('ticker items from column A', await until(async () => JSON.stringify((await inp(ticker)).ticker.items) === JSON.stringify(['ข่าวที่หนึ่ง', 'ข่าวที่สอง'])), JSON.stringify((await inp(ticker)).ticker.items));
  await card(score).hover(); await card(score).locator('[data-card=rename]').click(); await p.fill('.modal [name=dataUrl]', SHEET(GID.score)); await p.click('.modal-foot .btn-primary');
  ok('scoreboard from the first data row', await until(async () => { const s = (await inp(score)).score; return s.teamA === 'เชียงใหม่' && s.scoreA === 3 && s.teamB === 'ลำพูน' && s.scoreB === 1 && s.period === 'ครึ่งหลัง'; }));
  // sheet unreachable
  sheetStatus = 404;
  ok('broken sheet: card shows DATA ERROR + warning', await until(async () => /DATA ERROR/.test(await card(score).locator('.card-sub').textContent())) && /HTTP 404/.test(await p.textContent('#toasts')),
    JSON.stringify({ data: (await inp(score)).data, sub: await card(score).locator('.card-sub').textContent() }));
  sheetStatus = 200;
  ok('recovers when the sheet is back', await until(async () => !/DATA ERROR/.test(await card(score).locator('.card-sub').textContent())));

  // --- show save
  await p.evaluate(id => window.webmix.timerControl(window.webmix.inputs.find(i => i.id === id), 'reset'), timer);
  await p.waitForTimeout(2000);
  await p.reload(); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => window.webmix.inputs.filter(i => ['timer', 'score', 'ticker', 'title'].includes(i.type)).map(i => ({ type: i.type, timer: i.timer, score: i.score, ticker: i.ticker, data: i.data && i.data.url })));
  const T = after.find(x => x.type === 'timer'), S = after.find(x => x.type === 'score'), K = after.find(x => x.type === 'ticker'), L = after.find(x => x.type === 'title');
  ok('timer restored, not running', T && T.timer.duration === 1 && !T.timer.running);
  ok('scoreboard restored (teams, scores, clock mode)', S && S.score.teamA && S.score.clock.mode === 'up' && !S.score.clock.running);
  ok('ticker restored', K && K.ticker.items.length >= 2);
  ok('sheet links restored and fetched again', L && L.data === SHEET(GID.title) && await until(() => p.evaluate(() => window.webmix.inputs.find(i => i.type === 'title').title.headline === 'สมหญิง แก้ไขแล้ว')), 'row 2 was showing when saved');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.stack); process.exit(1); });
