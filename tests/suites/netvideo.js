// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// NDI / OMT — Gateway Rust (GATEWAY_BIN) ใช้ไลบรารีจำลองที่ส่ง-รับในโปรเซสเดียว:
//   ปลายทาง ndi:// / omt:// ส่ง Program ออก → ค้นหาเจอในหน้าต่างเลือก → รับกลับเข้ามาเป็นแหล่งภาพ (H.264 + AAC) → นับผู้รับ → จำไว้หลังเปิดหน้าใหม่
// Gateway Node: บอกชัดว่าต้องใช้แอปเดสก์ท็อป
const { chromium } = require('playwright');
const S = process.env.WORK;
const RUST = !!process.env.GATEWAY_BIN;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);

  // ปลายทาง NDI + OMT ในหน้าตั้งค่า
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]');
  await p.fill('.modal input[name=gateway]', 'ws://127.0.0.1:8089/?token=abc');
  const row = n => p.locator('.dest-row').nth(n);
  await row(0).locator('[data-f=platform]').selectOption('ndi');
  ok('NDI destination: name field, no stream key / test buttons', await row(0).locator('[data-f=server]').inputValue() === 'WebMix Program'
    && !(await row(0).locator('[data-f=key]').isVisible()) && !(await row(0).locator('.dest-test-btn').isVisible()) && (await row(0).locator('.dest-net-note').textContent()).includes('NDI Tools'));
  await p.click('.dest-add'); await row(1).locator('[data-f=platform]').selectOption('omt');
  await row(1).locator('[data-f=server]').fill('WebMix OMT');
  ok('OMT row hides the NDI Tools hint', !(await row(1).locator('.dest-ndi-only').isVisible()));
  await p.screenshot({ path: S + '/netvideo-settings.png' });
  await p.click('.modal-foot .btn-primary');
  await p.click('[data-action=stream]'); await p.waitForSelector('.dest-live-row');
  const rowText = async n => (await p.locator('.dest-live-row').nth(n).textContent()).replace(/\s+/g, ' ').trim();
  ok('live panel labels the LAN outputs', (await rowText(0)).includes('NDI WebMix Program') && (await rowText(1)).includes('OMT WebMix OMT'), `${await rowText(0)} | ${await rowText(1)}`);
  await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]'); await p.waitForTimeout(7000);
  const t0 = await rowText(0);

  if (!RUST) {
    ok('server gateway explains NDI needs the desktop app', /แอปเดสก์ท็อป/.test(t0), t0);
    const list = await p.evaluate(() => new Promise(res => {
      const ws = new WebSocket('ws://127.0.0.1:8089/srt-in?token=abc');
      ws.onopen = () => ws.send(JSON.stringify({ type: 'sources', proto: 'ndi' }));
      ws.onmessage = e => { res(JSON.parse(e.data)); ws.close(); };
      setTimeout(() => res(null), 5000);
    }));
    await p.keyboard.press('Escape');
    await p.click('[data-action=settings]'); await p.click('[data-mtab=netvideo]');
    const errOk = await p.waitForFunction(() => [...document.querySelectorAll('.nv-col .net-err')].filter(e => /แอปเดสก์ท็อป/.test(e.textContent)).length === 2, null, { timeout: 12000 }).then(() => true, () => false);
    ok('settings NDI / OMT tab explains both need the desktop app', errOk, await p.textContent('.nv-grid'));
    await p.keyboard.press('Escape');
    ok('source search answers with the same explanation', list && /แอปเดสก์ท็อป/.test(list.error || ''), JSON.stringify(list));
    ok('no page errors', errs.length === 0, JSON.stringify(errs));
    console.log(results.join('\n')); await b.close(); return;
  }

  ok('NDI output is live (no receivers yet)', /LIVE|ออนแอร์|ส่งอยู่|live/i.test(t0) || t0.includes('ยังไม่มีเครื่องรับ'), t0);
  ok('NDI output shows its LAN name and receiver count', t0.includes('“WebMix Program”') && t0.includes('ยังไม่มีเครื่องรับ'), t0);
  await p.keyboard.press('Escape');

  // หน้าตั้งค่า → NDI / OMT: ค้นหาทั้งสองแบบพร้อมกัน · เพิ่มเป็นแหล่งภาพได้จากรายการ
  await p.click('[data-action=settings]'); await p.click('[data-mtab=netvideo]');
  const scanned = await p.waitForFunction(() => document.querySelectorAll('.nv-col .nv-src').length >= 2, null, { timeout: 12000 }).then(() => true, () => false);
  const cols = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.nv-col')].map(c => [c.dataset.proto, { st: c.querySelector('.nv-st').textContent, list: c.querySelector('.nv-list').textContent.replace(/\s+/g, ' ') }])));
  ok('settings tab finds NDI and OMT sources side by side', scanned && /WebMix Program/.test(cols.ndi.list) && /WebMix OMT/.test(cols.omt.list) && /พบ/.test(cols.ndi.st) && /พบ/.test(cols.omt.st), JSON.stringify(cols));
  await p.screenshot({ path: S + '/netvideo-scan.png' });
  await p.locator('.nv-col[data-proto=omt] .nv-src', { hasText: 'WebMix OMT' }).locator('[data-nv-add]').click();
  ok('“add” turns the OMT source into an input', await p.waitForFunction(() => window.webmix.inputs.some(i => i.type === 'srt' && i.srt.mode === 'omt' && i.srt.source === 'MOCKHOST (WebMix OMT)'), null, { timeout: 3000 }).then(() => true, () => false));
  ok('source is then marked as in use', /ใช้อยู่/.test(await p.textContent('.nv-col[data-proto=omt] .nv-list')));
  await p.keyboard.press('Escape');

  // รับกลับเข้ามา: เมนูเพิ่มแหล่งภาพ → NDI / OMT → เลือกจากรายการ
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("NDI")');
  await p.click('.modal .net-proto button[data-value=ndi]');
  await p.waitForSelector('.modal .net-src', { timeout: 8000 }).catch(() => {});
  const found = await p.locator('.modal .net-src').evaluateAll(l => l.map(x => x.dataset.src));
  ok('add dialog has NDI / SRT / RTMP / RTSP tabs', (await p.$$('.modal .net-tabs [data-net-tab]')).length === 4);
  ok('NDI search lists our own Program output', found.some(t => t.includes('MOCKHOST (WebMix Program)')), JSON.stringify(found));
  await p.locator('.modal .net-src', { hasText: 'WebMix Program' }).click();
  ok('picking a source fills the name', (await p.inputValue('.modal input[name=source]')) === 'MOCKHOST (WebMix Program)');
  await p.screenshot({ path: S + '/netvideo-pick.png' });
  await p.click('.modal-foot .btn-primary');
  // แท็บ: เปิดหน้าต่าง NDI แล้วสลับไป SRT / กลับมา
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("NDI")'); await p.waitForSelector('.modal .net-tabs');
  await p.click('.modal [data-net-tab=srt]'); await p.waitForTimeout(400);
  ok('tab switches to the SRT dialog', await p.isVisible('.modal-title:has-text("SRT")') && await p.isVisible('.modal [data-net-tab=srt].is-on'));
  await p.keyboard.press('Escape');
  const net = mode => p.evaluate(m => window.webmix.inputs.filter(i => i.type === 'srt' && i.srt.mode === m).map(i => ({ id: i.id, name: i.name, state: i.srtState, msg: i.srtMessage || '', info: i.srtInfo, source: i.srt.source })), mode);
  const waitLive = async (mode, ms = 25000) => { for (let t = 0; t < ms; t += 500) { const l = await net(mode); if (l[0] && l[0].state === 'live' && l[0].info) return l[0]; await p.waitForTimeout(500); } return (await net(mode))[0]; };
  const ndiIn = await waitLive('ndi');
  ok('NDI source becomes a live input named after the source', ndiIn && ndiIn.state === 'live' && ndiIn.name === 'WebMix Program', JSON.stringify(ndiIn));
  ok('input reports the NDI frame size (Program 1280×720)', ndiIn && ndiIn.info && ndiIn.info.codec === 'ndi' && ndiIn.info.width === 1280 && ndiIn.info.height === 720, JSON.stringify(ndiIn && ndiIn.info));
  const probe = id => p.evaluate(id => new Promise(res => {
    const i = window.webmix.inputs.find(x => x.id === id);
    const u = new URL(window.webmix.settings.gateway); u.pathname = '/srt-in/data'; u.searchParams.set('id', i.srtSession);
    const v = document.createElement('video');
    const pl = window.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: u.toString() }, { enableWorker: false, enableStashBuffer: false });
    pl.attachMediaElement(v);
    pl.on(window.mpegts.Events.MEDIA_INFO, mi => { res({ video: mi.videoCodec, audio: mi.audioCodec, w: mi.width, h: mi.height }); setTimeout(() => { try { pl.destroy(); } catch (e) {} }, 50); });
    pl.on(window.mpegts.Events.ERROR, () => {});
    pl.load();
    setTimeout(() => res(null), 15000);
  }), id);
  const mi = ndiIn ? await probe(ndiIn.id) : null;
  ok('NDI input arrives as H.264 + AAC for the browser', mi && /avc1/.test(mi.video) && /mp4a/.test(mi.audio) && mi.w === 1280, JSON.stringify(mi));
  await p.click('[data-action=stream]'); await p.waitForSelector('.dest-live-row'); await p.waitForTimeout(2500);
  const t1 = await rowText(0);
  ok('sender counts the receiver', t1.includes('ผู้รับ 1 เครื่อง'), t1);
  await p.keyboard.press('Escape');

  // OMT เช่นเดียวกัน
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("NDI")');
  await p.click('.modal .net-proto button[data-value=omt]');
  await p.waitForSelector('.modal .net-src', { timeout: 8000 }).catch(() => {});
  const foundOmt = await p.locator('.modal .net-src').allTextContents();
  ok('OMT search lists the OMT output', foundOmt.some(t => t.includes('WebMix OMT')), JSON.stringify(foundOmt));
  await p.locator('.modal .net-src', { hasText: 'WebMix OMT' }).click();
  await p.click('.modal-foot .btn-primary');
  const omtIn = await waitLive('omt');
  ok('OMT source becomes a live input', omtIn && omtIn.state === 'live' && omtIn.info && omtIn.info.codec === 'omt', JSON.stringify(omtIn));
  ok('card label shows NDI / OMT', await p.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.textContent).join('|')).then(t => /NDI/.test(t) && /OMT/.test(t)));

  // แก้แหล่งของการ์ด: หน้าต่างเปิดพร้อมชื่อเดิม
  await p.evaluate(id => { const c = document.querySelector(`[data-id="${id}"] [data-card=rename]`); if (c) c.click(); }, ndiIn.id);
  await p.waitForTimeout(600);
  if (await p.locator('.modal input[name=source]').count()) {
    ok('edit dialog shows the current source', (await p.inputValue('.modal input[name=source]')) === 'MOCKHOST (WebMix Program)');
    await p.keyboard.press('Escape');
  } else ok('edit dialog shows the current source', false, 'no edit button found');

  // เปิดหน้าใหม่: แหล่งภาพ NDI กลับมาและต่อเองอีกครั้ง (ต้นทางยังส่งอยู่จาก Gateway เดิม? — ไม่ เพราะไลฟ์หยุดเมื่อปิดหน้า)
  const saved = await p.evaluate(() => window.webmix.show.serialize().inputs.filter(i => i.type === 'srt').map(i => `${i.srt.mode}:${i.srt.source}`));
  ok('NDI / OMT inputs saved with the show', saved.includes('ndi:MOCKHOST (WebMix Program)') && saved.includes('omt:MOCKHOST (WebMix OMT)'), JSON.stringify(saved));

  // หยุดส่ง NDI → แหล่งภาพที่รับอยู่รู้ว่าสัญญาณหาย
  await p.click('[data-action=stream]'); await p.waitForSelector('.dest-live-row');
  await p.locator('.dest-live-row').nth(0).locator('button:has-text("หยุด")').click().catch(() => {});
  await p.waitForTimeout(6000);
  const gone = (await net('ndi'))[0];
  ok('stopping the sender puts the input in "waiting"', gone && gone.state === 'waiting' && /ไม่มีสัญญาณ/.test(gone.msg), JSON.stringify(gone));
  await p.keyboard.press('Escape');

  await p.evaluate(() => window.webmix.show.autosave(true));
  await p.reload(); await p.waitForTimeout(2500);
  const back = await p.evaluate(() => window.webmix.inputs.filter(i => i.type === 'srt').map(i => ({ mode: i.srt.mode, source: i.srt.source, state: i.srtState })));
  ok('after reload both inputs are back and reconnecting', back.length === 3 && back.every(x => x.source && ['connecting', 'waiting', 'live'].includes(x.state)), JSON.stringify(back));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
