// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Overlay แบบ vMix: 4 ช่อง, ปุ่มใต้การ์ด, ตำแหน่ง/ครอป/คีย์ต่อ Input, เอฟเฟกต์เข้า-ออก, พักบน Preview, Title โปร่งใส, tally/AFV, บันทึกโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  // พิกเซลบนจอ Program / Preview (พิกัดเป็นสัดส่วน 0–1)
  const px = (sel, x, y) => p.evaluate(([sel, x, y]) => { const c = document.querySelector(sel); return Array.from(c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3)); }, [sel, x, y]);
  const pgm = (x, y) => px('#pgm-canvas', x, y), pvw = (x, y) => px('#pvw-canvas', x, y);
  const near = (a, b2, t = 40) => a.every((v, i) => Math.abs(v - b2[i]) <= t);
  const idOf = type => p.evaluate(t => window.webmix.inputs.find(i => i.type === t).id, type);
  const card = id => p.locator(`#inputs-grid .card[data-id="${id}"]`);

  ok('OVERLAY tab and 8 overlay keys', (await p.$$('.key-ovl')).length === 8 && (await p.$$('.ovl-row')).length === 8 && await p.isVisible('.pane[data-pane="overlay"]'));
  ok('8 overlay buttons on each input card', (await p.$$('#inputs-grid .card:first-child [data-card-ovl]')).length === 8);
  // program = slate; put BLACK on program to make pixel checks simple
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'black').id; w.setPreview(w.inputs.find(i => i.type === 'bars').id); });

  // --- Title input (transparent) on Overlay 1 via the card button
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Title กราฟิกข้อความ")');
  await p.waitForSelector('.modal [name=headline]');
  await p.fill('.modal [name=headline]', 'สมชาย ใจดี'); await p.fill('.modal [name=subtitle]', 'ผู้สื่อข่าว');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const title = await idOf('title');
  const titlePx = () => pgm(0.065, 0.76); // แถบสีแดงของป้ายชื่อล่าง
  ok('title not on air yet', near(await titlePx(), [0, 0, 0], 10), JSON.stringify(await titlePx()));
  await card(title).locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(800);
  ok('card button 1 puts the title on Overlay 1', near(await titlePx(), [239, 68, 68]), JSON.stringify(await titlePx()));
  ok('transparent: program still visible around the title', near(await pgm(0.5, 0.3), [0, 0, 0], 10));
  ok('deck key OV1 lit, name only in the tooltip (button stays compact)', await p.evaluate(() => { const k = document.querySelector('.key-ovl[data-ovl="0"]'); return k.classList.contains('is-on') && k.classList.contains('has-src') && /TITLE 1/.test(k.title) && !/TITLE 1/.test(k.textContent) && k.scrollWidth <= k.clientWidth + 1; }));
  ok('card tally OV1 + red card button', await card(title).locator('.card-tally').textContent() === 'OV1' && await card(title).locator('[data-card-ovl="0"]').evaluate(e => e.classList.contains('is-on')));
  ok('OVERLAY tab shows live dot', await p.evaluate(() => document.querySelector('.tab[data-tab="overlay"]').classList.contains('is-live')));
  await p.keyboard.press('q'); await p.waitForTimeout(800);
  ok('Q takes Overlay 1 off (fade out)', near(await titlePx(), [0, 0, 0], 10) && !(await p.evaluate(() => window.webmix.ovl[0].on)));

  // --- image with position preset (top-right corner) on Overlay 2
  let fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(S + '/logo.png');
  await p.waitForTimeout(600);
  const logo = await idOf('image');
  await card(logo).hover(); await card(logo).locator('[data-card=layout]').click();
  await p.waitForSelector('.modal .layout-preview');
  await p.click('.modal [data-preset="1"]'); // มุมขวาบน
  ok('layout sliders follow the preset', await p.inputValue('.modal [name=scale]') === '30' && await p.inputValue('.modal [name=x]') === '82');
  await p.fill('.modal [name=cl]', '10'); await p.dispatchEvent('.modal [name=cl]', 'input');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(200);
  ok('layout saved on the input', await p.evaluate(id => { const l = window.webmix.inputs.find(i => i.id === id).layout; return l && l.scale === 0.3 && l.crop.l === 0.1; }, logo));
  ok('position button marked as set', await card(logo).locator('.ovl-pos').evaluate(e => e.classList.contains('is-set')));
  await p.selectOption('[data-ovl-src="1"]', logo);
  await p.selectOption('[data-ovl-fx="1"]', 'slide-left'); await p.selectOption('[data-ovl-dur="1"]', '1000');
  await p.click('.ovl-take[data-ovl="1"]');
  await p.waitForTimeout(350);
  const mid = await p.evaluate(() => window.webmix.ovl[1].anim);
  ok('slide transition runs over its duration', mid > 0.1 && mid < 0.8, mid.toFixed(2));
  await p.waitForTimeout(1000);
  // logo (testsrc) อยู่ในกรอบมุมขวาบน (x 0.67–0.97, y 0.05–0.35), ครอปซ้าย 10% ของกรอบ
  const inBox = await pgm(0.85, 0.2), outside = await pgm(0.4, 0.6), cropped = await pgm(0.68, 0.2);
  ok('logo drawn in the top-right box', !near(inBox, [0, 0, 0], 10), JSON.stringify(inBox));
  ok('rest of the frame untouched', near(outside, [0, 0, 0], 10));
  ok('left crop applied', near(cropped, [0, 0, 0], 10), JSON.stringify(cropped));

  // --- chroma key per input on Overlay 3
  fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ภาพนิ่ง")'); await (await fc).setFiles(S + '/green.png');
  await p.waitForTimeout(600);
  const green = await p.evaluate(() => window.webmix.inputs.filter(i => i.type === 'image').pop().id);
  await card(green).hover(); await card(green).locator('[data-card=layout]').click(); await p.waitForSelector('.modal .layout-preview');
  await p.click('.modal [data-seg="key"] [data-value="green"]'); await p.click('.modal-foot .btn-primary');
  await card(green).locator('[data-card-ovl="2"]').click(); await p.waitForTimeout(800);
  ok('chroma key removes the green background', near(await pgm(0.15, 0.6), [0, 0, 0], 12), JSON.stringify(await pgm(0.15, 0.6)));
  ok('keyed subject stays visible', near(await pgm(0.5, 0.5), [255, 0, 0], 50), JSON.stringify(await pgm(0.5, 0.5)));
  ok('overlays stack in order (logo OV2 under nothing, still visible)', !near(await pgm(0.85, 0.2), [0, 0, 0], 10));
  await card(green).locator('[data-card-ovl="2"]').click(); await p.waitForTimeout(700);

  // --- Overlay 8 (top layer) from the card + Shift+R
  await card(green).locator('[data-card-ovl="7"]').click(); await p.waitForTimeout(700);
  ok('card button 8 puts input on Overlay 8', await p.evaluate(id => window.webmix.ovl[7].on && window.webmix.ovl[7].inputId === id, green) && await card(green).locator('.card-tally').textContent() === 'OV8');
  ok('Overlay 8 drawn (keyed subject visible)', near(await pgm(0.5, 0.5), [255, 0, 0], 50));
  await p.keyboard.press('Shift+R'); await p.waitForTimeout(700);
  ok('Shift+R takes Overlay 8 off', !(await p.evaluate(() => window.webmix.ovl[7].on)) && near(await pgm(0.5, 0.5), [0, 0, 0], 12), JSON.stringify(await pgm(0.5, 0.5)));
  await p.keyboard.press('Shift+Q'); await p.waitForTimeout(200);
  ok('Shift+Q on an empty Overlay 5 warns', /เลือกแหล่งภาพให้ Overlay 5/.test(await p.textContent('#toasts')));

  // --- PVW staging: shows on Preview only
  await p.click('[data-ovl-pvw="0"]'); await p.waitForTimeout(200);
  ok('PVW shows overlay on Preview', near(await pvw(0.065, 0.76), [239, 68, 68]), JSON.stringify(await pvw(0.065, 0.76)));
  ok('…but not on Program', near(await titlePx(), [0, 0, 0], 10));
  ok('deck key marked staged', await p.evaluate(() => document.querySelector('.key-ovl[data-ovl="0"]').classList.contains('is-staged')));
  await p.click('.key-ovl[data-ovl="0"]'); await p.waitForTimeout(700);
  ok('taking a staged overlay puts it on Program', near(await titlePx(), [239, 68, 68]) && !(await p.evaluate(() => window.webmix.ovl[0].staged)));

  // --- editing the title updates on air
  await card(title).hover(); await card(title).locator('[data-card=rename]').click();
  await p.waitForSelector('.modal [name=style]'); await p.check('.modal [name=style][value=live]'); await p.click('.modal-foot .btn-primary');
  await p.waitForTimeout(200);
  ok('title style change shows immediately (LIVE badge top-right)', !near(await pgm(0.93, 0.08), [0, 0, 0], 20) && near(await titlePx(), [0, 0, 0], 10), JSON.stringify(await pgm(0.93, 0.08)));

  // --- AFV follows overlays
  fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/clip.webm');
  await p.waitForTimeout(800);
  const clip = await idOf('media');
  const afvGain = () => p.evaluate(id => window.webmix.audio.channels.find(c => c.inputId === id).afvGain.gain.value, clip);
  await p.evaluate(id => { const ch = window.webmix.audio.channels.find(c => c.inputId === id); ch.afv = true; window.webmix.audio.applyAfv(); }, clip);
  await p.waitForTimeout(500);
  ok('AFV: video audio muted while off air', (await afvGain()) < 0.05, (await afvGain()).toFixed(2));
  await card(clip).locator('[data-card-ovl="3"]').click(); await p.waitForTimeout(600);
  ok('AFV: audio on when the video is on an overlay', (await afvGain()) > 0.9, (await afvGain()).toFixed(2));
  await p.keyboard.press('r'); await p.waitForTimeout(600);
  ok('R takes Overlay 4 off and AFV mutes again', (await afvGain()) < 0.05);

  // --- show save: assignments, layouts and titles come back, nothing on air
  await p.waitForTimeout(2000);
  await p.reload(); await p.waitForTimeout(2000);
  const st = await p.evaluate(() => ({ ovl: window.webmix.ovl.map(c => ({ id: c.inputId, on: c.on, fx: c.effect, d: c.duration })), logo: window.webmix.inputs.find(i => i.type === 'image').layout, title: window.webmix.inputs.find(i => i.type === 'title').title }));
  ok('8 channels after reload', st.ovl.length === 8);
  ok('overlay assignments + effects restored', st.ovl[7].id === green && st.ovl[0].id === title && st.ovl[1].id === logo && st.ovl[1].fx === 'slide-left' && st.ovl[1].d === 1000, JSON.stringify(st.ovl));
  ok('nothing goes on air by a reload', st.ovl.every(c => !c.on));
  ok('layout restored', st.logo && st.logo.scale === 0.3 && st.logo.crop.l === 0.1);
  ok('title input restored', st.title && st.title.headline === 'สมชาย ใจดี' && st.title.style === 'live');
  ok('selects show restored assignments', await p.inputValue('[data-ovl-src="1"]') === logo);

  // --- removing an input that is on air clears its overlay
  await p.evaluate(() => window.webmix.setChannel(1, true)); await p.waitForTimeout(1200);
  await card(logo).hover(); await card(logo).locator('[data-card=remove]').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(500);
  ok('removed input leaves the overlay channel', await p.evaluate(() => !window.webmix.ovl[1].inputId && !window.webmix.ovl[1].on) && near(await pgm(0.85, 0.2), [0, 0, 0], 10));
  await p.screenshot({ path: S + '/overlay.png' });
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
