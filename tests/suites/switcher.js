// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({host:'127.0.0.1',port:9900,path:'/',secure:false},o||{});return id?new P(id,o):new P(o);};})();`;
const qrLib = fs.readFileSync(require.resolve('qrcodejs/qrcode.min.js'), 'utf8');
const results = []; const ok = (name, cond, extra='') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route('**/qrcode.min.js', r => r.fulfill({ contentType: 'application/javascript', body: qrLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
const px = (page, sel, x, y) => page.evaluate(([sel, x, y]) => { const c = document.querySelector(sel); return Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data); }, [sel, x, y]);
(async () => {
  const rx = listenRtmp(1935, 'test', S + '/out.flv');
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'], acceptDownloads: true });
  await setup(ctx);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500);
  const st = () => p.evaluate(() => { const w = window.webmix; const n = id => w.inputs.find(i => i.id === id)?.name; return { pgm: n(w.state.programId), pvw: n(w.state.previewId), n: w.inputs.length, ch: w.audio.channels.length }; });
  let s = await st(); ok('boot inputs', s.n === 4 && s.pgm === 'SLATE' && s.pvw === 'COLOR BARS', JSON.stringify(s));
  await p.screenshot({ path: S + '/d1.png' });

  await p.click('[data-action=cut]'); s = await st(); ok('CUT button', s.pgm === 'COLOR BARS' && s.pvw === 'SLATE');
  await p.keyboard.press('Enter'); await p.waitForTimeout(1300); s = await st(); ok('AUTO (Enter)', s.pgm === 'SLATE', JSON.stringify(s));
  ok('T-bar parked at top after AUTO', (await p.getAttribute('#tbar', 'aria-valuenow')) === '100');
  // drag T-bar from top to bottom => completes transition
  const tb = await p.locator('#tbar').boundingBox();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + 12); await p.mouse.down();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 5 });
  ok('T-bar mid transition', await p.evaluate(() => window.webmix.tr.progress > 0.3 && window.webmix.tr.progress < 0.7));
  await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height - 2, { steps: 5 }); await p.mouse.up();
  s = await st(); ok('T-bar completes', s.pgm === 'COLOR BARS', JSON.stringify(s));
  await p.click('#seg-transition [data-value=wipe]'); await p.click('#seg-duration [data-value="500"]');
  ok('transition settings', await p.evaluate(() => window.webmix.settings.transition === 'wipe' && window.webmix.settings.duration === 500));
  await p.keyboard.press('Space'); s = await st(); ok('CUT (Space)', s.pgm === 'SLATE');
  await p.keyboard.press('Digit3'); s = await st(); ok('key 3 -> preview', s.pvw === 'CLOCK');
  await p.keyboard.press('Shift+Digit4'); s = await st(); ok('shift+4 -> program', s.pgm === 'BLACK');
  await p.keyboard.press('Shift+Digit2'); 

  // FTB
  await p.keyboard.press('f'); await p.waitForTimeout(700);
  const black = await px(p, '#pgm-canvas', 640, 300); ok('FTB black', black[0] < 5 && black[1] < 5 && black[2] < 5, JSON.stringify(black));
  await p.click('#btn-ftb'); await p.waitForTimeout(700);
  const back = await px(p, '#pgm-canvas', 100, 100); ok('FTB off', back.some(v => v > 5), JSON.stringify(back));

  // Title
  await p.click('.tab[data-tab=title]'); await p.fill('#title-headline', 'ข่าวด่วน TEST');
  await p.keyboard.press('Escape'); await p.click('#pgm-canvas', { position: { x: 5, y: 5 } }); 
  await p.click('[data-action=title]'); await p.waitForTimeout(700);
  const tpx = await px(p, '#pgm-canvas', 1280 * 0.06 + 3, 720 * 0.735 + 20); ok('TITLE on air (red bar)', tpx[0] > 200 && tpx[1] < 90, JSON.stringify(tpx));
  ok('title tab live dot', await p.evaluate(() => document.querySelector('.tab[data-tab=title]').classList.contains('is-live')));
  await p.keyboard.press('t'); await p.waitForTimeout(700);
  ok('TITLE off', !(await p.evaluate(() => window.webmix.overlays.title.on)));

  // Add menu: generator + camera + mic
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Color Bars")');
  s = await st(); ok('add Color Bars', s.n === 5);
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("กล้อง")');
  await p.waitForSelector('.modal select[name=cam]'); await p.click('.modal-foot .btn-primary');
  await p.waitForTimeout(400); 
  // choose mic in camera dialog next time; here no audio
  s = await st(); ok('add camera', s.n === 6, JSON.stringify(s));
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("กล้อง")');
  await p.waitForSelector('.modal select[name=mic]'); await p.selectOption('.modal select[name=mic]', { index: 1 });
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(600);
  s = await st(); ok('camera with audio -> channel', s.n === 7 && s.ch === 1, JSON.stringify(s));
  await p.click('[data-action=add-audio]'); await p.click('.menu button:has-text("ไมโครโฟน")'); await p.waitForSelector('.modal select[name=mic]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(600);
  s = await st(); ok('add mic', s.ch === 2, JSON.stringify(s));
  // video file + image via filechooser
  let fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/clip.webm');
  await p.waitForTimeout(800); s = await st(); ok('add video file + audio channel', s.n === 8 && s.ch === 3, JSON.stringify(s));
  fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(S + '/logo.png');
  await p.waitForTimeout(500); s = await st(); ok('add image', s.n === 9, JSON.stringify(s));
  // meters moving
  await p.waitForTimeout(800);
  const lv = await p.evaluate(() => window.webmix.audio.channels.map(c => Math.round(c.level)));
  ok('audio meters show signal', lv.some(v => v > -50), JSON.stringify(lv));
  // media controls
  const vcard = p.locator('.card', { hasText: 'clip' });
  await vcard.hover(); await vcard.locator('[data-card=play]').click(); await p.waitForTimeout(200);
  ok('video pause', await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'media').el.paused));
  await vcard.locator('[data-card=play]').click(); await vcard.locator('[data-card=loop]').click();
  ok('video play + loop toggle', await p.evaluate(() => { const v = window.webmix.inputs.find(i => i.type === 'media').el; return !v.paused && !v.loop; }));
  // AFV + mute
  const strips = p.locator('.strip:not(.master)');
  await strips.nth(2).locator('.afv').click();
  ok('AFV on for video (not on program) -> muted gain', await p.evaluate(() => { const c = window.webmix.audio.channels[2]; return c.afv; }));
  await p.waitForTimeout(3000);
  const afvLv = await p.evaluate(() => Math.round(window.webmix.audio.channels[2].level));
  ok('AFV silences off-air source', afvLv < -60, String(afvLv));
  await strips.nth(1).locator('.mute').click(); await p.waitForTimeout(3000);
  ok('mute silences mic', await p.evaluate(() => window.webmix.audio.channels[1].level < -60));
  // fader dblclick reset & drag
  const fd = await strips.nth(0).locator('.vfader').boundingBox();
  await p.mouse.click(fd.x + fd.width / 2, fd.y + fd.height - 11);
  ok('fader to -inf', await p.evaluate(() => window.webmix.audio.channels[0].db === -Infinity), await strips.nth(0).locator('.strip-db').textContent());
  await strips.nth(0).locator('.vfader').dblclick();
  ok('fader dblclick 0 dB', (await strips.nth(0).locator('.strip-db').textContent()).includes('0.0'));
  // monitor
  await p.click('#btn-monitor'); ok('monitor on', await p.evaluate(() => window.webmix.audio.monitorOn));
  await p.click('#btn-monitor');

  // PIP + KEY
  await p.click('.tab[data-tab=pip]'); await p.selectOption('#pip-source', { label: '9. logo' }); await p.click('#seg-pip-pos [data-value=tl]');
  await p.click('#btn-pip'); await p.waitForTimeout(200);
  const pipPx = await px(p, '#pgm-canvas', Math.round(1280 * 0.03 + 1280 * 0.16), Math.round(1280 * 0.03 + 720 * 0.16)); ok('PIP drawn top-left', !(pipPx[0] === 0 && pipPx[1] === 0 && pipPx[2] === 0), JSON.stringify(pipPx));
  await p.keyboard.press('p');
  await p.click('.tab[data-tab=key]'); await p.click('#btn-key'); await p.waitForTimeout(300);
  ok('KEY on', await p.evaluate(() => window.webmix.overlays.key.on && window.webmix.overlays.key.ready));
  await p.keyboard.press('k');

  // rename + remove
  const card5 = p.locator('.card').nth(4); await card5.hover(); await card5.locator('[data-card=rename]').click();
  await p.fill('.modal input[name=name]', 'BARS 2'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok('rename', (await p.locator('.card').nth(4).locator('.card-name').textContent()) === 'BARS 2');
  await card5.hover(); await card5.locator('[data-card=remove]').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(300);
  s = await st(); ok('remove input', s.n === 8, JSON.stringify(s));
  // remove program input
  const pgmIdx = await p.evaluate(() => window.webmix.inputs.findIndex(i => i.id === window.webmix.state.programId));
  const pc = p.locator('.card').nth(pgmIdx); await pc.hover(); await pc.locator('[data-card=remove]').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(300);
  s = await st(); ok('remove program input falls back', s.n === 7 && !!s.pgm && s.pgm !== s.pvw, JSON.stringify(s));
  // double click card -> cut
  const c2 = p.locator('.card').nth(1); await c2.click(); await c2.click(); s = await st();
  ok('double tap card -> program', s.pgm === (await c2.locator('.card-name').textContent()), JSON.stringify(s));

  // record
  await p.click('#btn-rec'); await p.waitForTimeout(2500);
  ok('REC on air lamp', (await p.textContent('#tally-lamp')).includes('ON AIR'));
  ok('status rec size', /KB|MB/.test(await p.textContent('#st-rec')), await p.textContent('#st-rec'));
  let dl = p.waitForEvent('download'); await p.click('#btn-rec'); let d = await dl; await d.saveAs(S + '/rec.webm');
  ok('REC download', d.suggestedFilename().endsWith('.webm'), d.suggestedFilename());
  // snapshot
  dl = p.waitForEvent('download'); await p.click('[data-action=snapshot]'); d = await dl; ok('snapshot', d.suggestedFilename().endsWith('.png'));

  // settings + stream
  await p.click('[data-action=stream]'); await p.click('.dest-start-all'); await p.waitForTimeout(300);
  ok('stream without config opens settings', await p.isVisible('.modal [data-mpane=stream].is-active'));
  await p.fill('.modal input[name=gateway]', 'ws://127.0.0.1:8089/?token=abc');
  await p.selectOption('.dest-row >> nth=0 >> [data-f=platform]', 'custom');
  await p.fill('.dest-row >> nth=0 >> [data-f=server]', 'rtmp://127.0.0.1:1935/live');
  await p.fill('.dest-row >> nth=0 >> [data-f=key]', 'test');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  await p.locator('.modal-backdrop').first().waitFor({ state: 'detached' }).catch(() => {});
  if (await p.locator('.modal-backdrop').count()) await p.keyboard.press('Escape');
  await p.click('[data-action=stream]'); await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]'); await p.keyboard.press('Escape'); await p.waitForTimeout(7000);
  ok('stream live', (await p.textContent('#btn-stream')).includes('ON AIR'), await p.textContent('#st-stream'));
  await p.click('[data-action=stream]'); await p.click('.dest-stop-all'); await p.locator('.modal-foot .btn-danger').last().click(); await p.keyboard.press('Escape'); await p.waitForTimeout(800);
  ok('stream stopped', (await p.textContent('#btn-stream')).includes('STREAM'));
  ok('lamp off', (await p.textContent('#tally-lamp')).includes('OFF AIR'));
  ok('stream key not persisted', await p.evaluate(() => JSON.parse(localStorage.getItem('webmix:settings')).destinations.every(d => d.key === '')));

  // settings resolution
  await p.click('[data-action=settings]'); await p.evaluate(() => { const d = document.querySelector('.modal details.adv'); if (d) d.open = true; }); await p.selectOption('.modal select[name=resolution]', '1080p'); await p.click('.modal-foot .btn-primary');
  ok('1080p applied', await p.evaluate(() => document.querySelector('#pgm-canvas').width === 1920), await p.textContent('#st-output'));

  // help + word
  await p.click('[data-action=help]'); await p.waitForSelector('.modal .hp-kb');
  dl = p.waitForEvent('download'); await p.click('.modal-foot .btn:has-text("Word")'); d = await dl; ok('manual download', d.suggestedFilename().endsWith('.doc'));
  // wireless
  await p.click('[data-action=wireless]'); await p.waitForSelector('.modal'); await p.waitForTimeout(800);
  ok('wireless QR', await p.evaluate(() => !!document.querySelector('#qr-target canvas, #qr-target img') && document.querySelector('#qr-target').offsetHeight > 150), await p.inputValue('#wireless-link').catch(() => 'no link'));
  await p.keyboard.press('Escape');
  // output window
  const pop = p.waitForEvent('popup'); await p.click('[data-action=output-window]'); const w = await pop; await w.waitForTimeout(800);
  ok('output window video', await w.evaluate(() => { const v = document.querySelector('video'); return !!v.srcObject && v.videoWidth > 0; }));
  await w.close();
  // fullscreen
  await p.click('[data-action=fullscreen]'); await p.waitForTimeout(300);
  ok('fullscreen', await p.evaluate(() => !!document.fullscreenElement || document.querySelector('#pgm-monitor').classList.contains('is-fullscreen')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.screenshot({ path: S + '/d2.png' });
  ok('status engine', /fps/.test(await p.textContent('#st-engine')), await p.textContent('#st-engine'));
  const got = probe(S + '/out.flv');
  ok('RTMP receiver got H.264 + AAC', /h264/.test(got) && /aac/.test(got), got);
  rx.kill('SIGKILL');
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
