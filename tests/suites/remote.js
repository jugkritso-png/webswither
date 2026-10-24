// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// รีโมต / ทีมงาน: เครื่องหลักแสดงรหัสจับคู่ 6 หลัก + QR แยกตามตำแหน่ง · รหัสผิดถูกปฏิเสธ · จับคู่แล้วต่อใหม่ไม่ต้องใส่รหัส ·
// สวิตเชอร์ (Multiview + ตัดภาพ) · ควบคุมเสียง · CG (แก้ Title + ขึ้นจอ) · อินเสิร์ต · มอนิเตอร์ (ดูอย่างเดียว) ·
// สิทธิ์ตรวจที่เครื่องหลัก · รายชื่อทีม + ข้อความถึงทีม · เปลี่ยนตำแหน่ง / ถอดเครื่อง · ใส่รหัสผิดหลายครั้ง = ล็อก
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({},o||{},{host:'127.0.0.1',port:9900,path:'/',secure:false});return id?new P(id,o):new P(o);};window.Peer.prototype=P.prototype;})();`;
const qrLib = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route('**/qrcode.min.js', r => r.fulfill({ contentType: 'application/javascript', body: qrLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const hctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await setup(hctx);
  const host = await hctx.newPage(); host.on('pageerror', e => errs.push('host ' + e.message));
  await host.goto('http://localhost:8765/index.html'); await host.evaluate(() => localStorage.clear()); await host.reload();
  await until(() => host.evaluate(() => window.webmix.wireless.status === 'ready'));
  await host.evaluate(() => { const w = window.webmix; w.ovl[0].inputId = w.inputs[2].id; w.macros.push({ id: 'm1', name: 'จอดำ', key: '', at: '', steps: [{ a: 'ftbOn', v: '' }] }); });
  // Title หนึ่งชิ้นให้ CG
  await host.click('[data-action=add-menu]'); await host.click('.menu button:has-text("Title")');
  await host.waitForSelector('.modal input[name=headline]'); await host.click('.modal-foot .btn-primary'); await host.waitForTimeout(300);

  // หน้าต่างทีมงาน: รหัสจับคู่ + ลิงก์ตามตำแหน่ง
  await host.click('[data-action=remote]'); await host.waitForSelector('#remote-link');
  const pin = (await host.textContent('#remote-pin')).replace(/\D/g, '');
  const linkFor = async role => { await host.click(`.rt-roles [data-role=${role}]`); return host.inputValue('#remote-link'); };
  const swLink = await linkFor('switcher');
  ok('pairing code (6 digits) and a QR per role; the link carries no secret', /^\d{6}$/.test(pin) && /[?&]role=switcher/.test(swLink) && !/[?&]k=/.test(swLink) && !swLink.includes(pin) && !!(await host.$('#remote-qr canvas, #remote-qr img')), swLink);
  const links = { sound: await linkFor('sound'), cg: await linkFor('cg'), insert: await linkFor('insert'), monitor: await linkFor('monitor') };
  await host.click('.modal-foot .btn-primary');

  const hs = () => host.evaluate(() => { const w = window.webmix; return { pgm: w.state.programId, pvw: w.state.previewId, ids: w.inputs.map(i => i.id), ftb: w.ftb.target, trans: w.settings.transition, ovl: w.ovl.map(c => c.on), db: w.audio.masterStrip.db, muted: w.audio.masterStrip.muted, team: w.settings.remoteTeam.map(t => t.name + ':' + t.role), online: w.remote.conns.size }; });
  // แต่ละตำแหน่งเป็นคนละเครื่อง (คนละ context — localStorage แยกกัน)
  const device = async () => { const c = await b.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true }); await setup(c); return c; };
  const join = async (link, name, code = pin) => {
    const pg = await (await device()).newPage(); pg.on('pageerror', e => errs.push(name + ' ' + e.message));
    await pg.goto(link); await pg.waitForSelector('.rmt-pair:not([hidden])');
    await pg.fill('.rmt-pair [name=name]', name); await pg.fill('.rmt-pair [name=pin]', code); await pg.click('.rmt-pair-go');
    return pg;
  };
  const conn = pg => pg.evaluate(() => document.getElementById('remote').dataset.conn);

  // สวิตเชอร์: รหัสผิดก่อน
  const sw = await join(swLink, 'สมชาย', pin === '000000' ? '111111' : '000000');
  ok('wrong pairing code is refused and the form comes back with the reason', await until(() => sw.evaluate(() => !document.querySelector('.rmt-pair').hidden && /ไม่ถูกต้อง/.test(document.querySelector('.rmt-pair-msg').textContent))));
  await sw.fill('.rmt-pair [name=pin]', pin); await sw.click('.rmt-pair-go');
  ok('right code pairs the switcher', await until(async () => (await conn(sw)) === 'ok' && (await sw.locator('.rmt-in').count()) > 0));
  ok('switcher sees take bar + multiview, not the mixer', await sw.isVisible('.rmt-btn.cut') && await sw.isVisible('.rmt-inputs') && !(await sw.isVisible('.rmt-audio')) && (await sw.textContent('.rmt-role')).includes('สวิตเชอร์'));
  ok('multiview thumbnails of every source arrive', await until(() => sw.evaluate(() => [...document.querySelectorAll('.rmt-in img')].every(i => i.src.startsWith('data:image/jpeg')))), '');
  let h = await hs();
  const target = h.ids.find(id => id !== h.pgm && id !== h.pvw);
  await sw.locator(`.rmt-in[data-v="${target}"]`).tap();
  ok('tap = Preview', await until(async () => (await hs()).pvw === target, 4000));
  const before = await hs();
  await sw.click('[data-r=cut]');
  ok('CUT from the switcher', await until(async () => { const x = await hs(); return x.pgm === before.pvw && x.pvw === before.pgm; }, 4000));
  const other = (await hs()).ids.find(id => id !== before.pvw && id !== before.pgm);
  await sw.locator(`.rmt-in[data-v="${other}"]`).click(); await sw.locator(`.rmt-in[data-v="${other}"]`).click();
  ok('double tap = take to Program', await until(async () => (await hs()).pgm === other, 4000));
  await sw.click('[data-r=trans][data-v=wipe]');
  ok('transition from the switcher', await until(async () => (await hs()).trans === 'wipe', 3000), JSON.stringify([(await hs()).trans, await sw.locator('[data-r=trans]').allTextContents()]));
  await sw.screenshot({ path: S + '/remote-switcher.png', fullPage: true });

  // ควบคุมเสียง
  const snd = await join(links.sound, 'แอน');
  ok('sound desk pairs and sees only the mixer', await until(async () => (await conn(snd)) === 'ok' && await snd.isVisible('.rmt-audio')) && !(await snd.isVisible('.rmt-btn.cut')) && !(await snd.isVisible('.rmt-inputs')));
  await snd.evaluate(() => { const r = document.querySelector('.rmt-ch[data-key=master] input'); r.value = -12; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('sound desk moves the Master fader', await until(async () => Math.abs((await hs()).db + 12) < 0.01, 3000));
  await snd.click('.rmt-ch[data-key=master] .rmt-mute');
  ok('sound desk mutes', await until(async () => (await hs()).muted === true, 3000));
  await snd.click('.rmt-ch[data-key=master] .rmt-mute');
  // สิทธิ์ตรวจที่เครื่องหลัก: ส่ง CUT จากตำแหน่งเสียง → ไม่มีผล
  const pg0 = (await hs()).pgm;
  await host.evaluate(() => { const r = window.webmix.remote; const m = [...r.conns.values()].find(x => x.role === 'sound'); r.command({ type: 'r-cmd', cmd: 'cut' }, m); r.command({ type: 'r-cmd', cmd: 'ftb' }, m); });
  await host.waitForTimeout(400);
  ok('studio ignores switching commands from the sound desk', (await hs()).pgm === pg0 && !(await hs()).ftb);
  await snd.screenshot({ path: S + '/remote-sound.png', fullPage: true });

  // CG: แก้ Title แล้วขึ้นจอ
  const cg = await join(links.cg, 'บี');
  ok('CG pairs and lists the title with its text', await until(async () => (await conn(cg)) === 'ok' && (await cg.locator('.rmt-g [data-f=hl]').count()) === 1));
  await cg.fill('.rmt-g [data-f=hl]', 'คุณสมศรี ใจดี'); await cg.fill('.rmt-g [data-f=sub]', 'ผู้อำนวยการ');
  await cg.click('.rmt-g [data-r=title]');
  ok('CG edits the title text on the studio', await until(() => host.evaluate(() => { const t = window.webmix.inputs.find(i => i.type === 'title').title; return t.headline === 'คุณสมศรี ใจดี' && t.subtitle === 'ผู้อำนวยการ'; }), 3000));
  await cg.click('.rmt-g [data-r=gfx]');
  ok('CG puts the title on air through a free overlay', await until(() => host.evaluate(() => { const w = window.webmix; const id = w.inputs.find(i => i.type === 'title').id; return w.ovl.some(c => c.on && c.inputId === id); }), 3000)
    && await until(() => cg.locator('.rmt-g.on').count().then(n => n === 1), 3000), JSON.stringify(await host.evaluate(() => window.webmix.ovl.map(c => [c.inputId, c.on]))) + await cg.locator('.rmt-g').first().innerHTML());
  await cg.screenshot({ path: S + '/remote-cg.png', fullPage: true });
  await cg.click('.rmt-g [data-r=gfx]');
  ok('…and takes it off again', await until(() => host.evaluate(() => { const w = window.webmix; const id = w.inputs.find(i => i.type === 'title').id; return !w.ovl.some(c => c.on && c.inputId === id); }), 3000));

  // อินเสิร์ต: ส่งได้เฉพาะคลิป/Playlist/สไลด์/รีเพลย์เข้า Preview
  const ins = await join(links.insert, 'ซี');
  ok('insert operator pairs; sees the inserts panel', await until(async () => (await conn(ins)) === 'ok' && await ins.isVisible('.rmt-ins')) && !(await ins.isVisible('.rmt-btn.cut')));
  const pv0 = (await hs()).pvw;
  await host.evaluate(id => { const r = window.webmix.remote; const m = [...r.conns.values()].find(x => x.role === 'insert'); r.command({ type: 'r-cmd', cmd: 'pvw', id }, m); }, (await hs()).ids.find(id => id !== pv0 && id !== (before.pgm)));
  await host.waitForTimeout(300);
  ok('insert operator cannot preview a camera', (await hs()).pvw === pv0);

  // มอนิเตอร์: ดูอย่างเดียว
  const mon = await join(links.monitor, 'ดี');
  ok('monitor pairs; sees Program, multiview and meters', await until(async () => (await conn(mon)) === 'ok' && await mon.isVisible('.rmt-mon.pgm') && await mon.isVisible('.rmt-inputs') && await mon.isVisible('.rmt-audio')));
  ok('monitor controls are disabled', await mon.evaluate(() => [...document.querySelectorAll('.rmt-in, .rmt-ch input, .rmt-mute')].every(e => e.disabled)) && !(await mon.isVisible('.rmt-btn.cut')));

  // รายชื่อทีม + ข้อความถึงทีม
  ok('studio keeps the team: 5 members online', await until(async () => (await hs()).online === 5) && (await hs()).team.join(',') === 'สมชาย:switcher,แอน:sound,บี:cg,ซี:insert,ดี:monitor', (await hs()).team.join(','));
  ok('each remote sees the team roster', await until(() => snd.evaluate(() => document.querySelectorAll('.rmt-mem.on').length === 5)));
  await sw.click('[data-r=team]'); await sw.click('.rmt-quick [data-v="พร้อม"]');
  ok('a team message reaches the other positions', await until(() => snd.evaluate(() => /สมชาย.*พร้อม/.test(document.querySelector('.rmt-msgs').textContent))));
  ok('…and the studio', await until(() => host.evaluate(() => window.webmix.remote.msgs.some(m => m.from === 'สมชาย' && m.text === 'พร้อม'))));

  // จับคู่แล้ว → รีเฟรชหน้าก็ต่อเองไม่ต้องใส่รหัส
  await mon.reload();
  ok('paired device reconnects after reload without the code', await until(async () => (await conn(mon)) === 'ok') && await mon.locator('.rmt-pair').isHidden());

  // เครื่องหลักเปลี่ยนตำแหน่ง / ถอดเครื่อง
  await host.click('[data-action=remote]'); await host.waitForSelector('#remote-team .rt-mem');
  await host.screenshot({ path: S + '/remote-team.png' });
  ok('team list in the studio shows who is online', await host.locator('#remote-team .rt-mem.on').count() === 5);
  await host.locator('#remote-team .rt-mem', { hasText: 'แอน' }).locator('select').selectOption('monitor');
  ok('studio changes a position; the remote follows', await until(() => snd.evaluate(() => document.getElementById('remote').dataset.role === 'monitor' && document.querySelector('.rmt-in') && document.querySelector('.rmt-ch input').disabled)));
  await host.locator('#remote-team .rt-mem', { hasText: 'สมชาย' }).locator('[data-f=unpair]').click();
  ok('unpaired device drops back to the pairing form', await until(() => sw.evaluate(() => !document.querySelector('.rmt-pair').hidden && /ยกเลิกการจับคู่/.test(document.querySelector('.rmt-pair-msg').textContent))));
  await host.click('.modal-foot .btn-primary');

  // ตากล้อง: ไฟ Tally เต็มจอ
  await host.click('[data-action=remote]'); await host.waitForSelector('#remote-link');
  const camLink = await linkFor('camera'); await host.click('.modal-foot .btn-primary');
  const cam = await join(camLink, 'อี');
  ok('camera operator pairs; sees only the tally panel', await until(async () => (await conn(cam)) === 'ok' && await cam.isVisible('.rmt-tally-box')) && !(await cam.isVisible('.rmt-mons')) && !(await cam.isVisible('.rmt-btn.cut')));
  const tid = await host.evaluate(() => { const w = window.webmix; return w.inputs.find(i => i.id !== w.state.programId && i.id !== w.state.previewId && i.type !== 'title').id; });
  await cam.selectOption('.rmt-tally-pick select', tid);
  const tally = () => cam.evaluate(() => [document.getElementById('remote').dataset.tally || '', document.querySelector('.rmt-tally-state').textContent]);
  ok('standby while the camera is not used', await until(async () => (await tally()).join() === ',STANDBY'), JSON.stringify(await tally()));
  await host.evaluate(id => window.webmix.setPreview(id), tid);
  ok('green PREVIEW when it is in Preview', await until(async () => (await tally()).join() === 'pvw,PREVIEW'), JSON.stringify(await tally()));
  await host.evaluate(() => window.webmix.cut());
  ok('red ON AIR when it is cut to Program', await until(async () => (await tally()).join() === 'pgm,ON AIR'), JSON.stringify(await tally()));
  ok('the camera\'s own picture is shown', await until(() => cam.evaluate(() => (document.querySelector('.rmt-tally-img').src || '').startsWith('data:image/jpeg'))));
  await cam.screenshot({ path: S + '/remote-tally.png' });
  await host.evaluate(() => window.webmix.cut());
  await host.evaluate(id => { const w = window.webmix; w.toggleInputOverlay(id, 3); }, tid);
  ok('also ON AIR while it is on an overlay', await until(async () => (await tally())[0] === 'pgm'));
  await host.evaluate(id => window.webmix.toggleInputOverlay(id, 3), tid);
  ok('camera position cannot switch', await host.evaluate(() => { const r = window.webmix.remote; const m = [...r.conns.values()].find(x => x.role === 'camera'); const before = window.webmix.state.programId; r.command({ type: 'r-cmd', cmd: 'cut' }, m); return window.webmix.state.programId === before; }));

  // เปลี่ยนรหัสจับคู่: เครื่องที่จับคู่ไว้ยังใช้ได้ · ใส่รหัสผิด 5 ครั้ง → ล็อก
  const bad = await (await device()).newPage();
  await bad.goto(links.monitor); await bad.waitForSelector('.rmt-pair:not([hidden])'); await bad.screenshot({ path: S + '/remote-pair.png' }); await bad.fill('.rmt-pair [name=name]', 'x');
  for (let i = 0; i < 6; i++) {
    await bad.fill('.rmt-pair [name=pin]', String(100000 + i) === pin ? '999999' : String(100000 + i)); await bad.click('.rmt-pair-go');
    await until(() => bad.evaluate(() => !document.querySelector('.rmt-pair').hidden), 5000);
  }
  await bad.fill('.rmt-pair [name=pin]', pin); await bad.click('.rmt-pair-go');
  ok('after 5 wrong codes even the right one is locked out for a minute', await until(() => bad.evaluate(() => /รอ 1 นาที/.test(document.querySelector('.rmt-pair-msg').textContent)), 6000));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
