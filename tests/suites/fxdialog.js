// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// หน้าต่างเอฟเฟกต์เสียงรายช่อง (แบบใหม่): รายชื่อช่อง · กราฟ EQ จากฟิลเตอร์จริง · Low cut / ความถี่กลาง · Attack / Release ·
// มิเตอร์ลดระดับ · ตั้งเป็นเสียงพูดชัด · คัดลอกไปช่องอื่น · บันทึกกับโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles([S + '/loud.webm', S + '/clip.webm']);
  await p.waitForFunction(() => window.webmix.audio.channels.length >= 2, null, { timeout: 8000 }).catch(() => {});
  await p.locator('.strip:not(.master) .chip-btn.fx').first().click(); await p.waitForSelector('.fx-modal');
  ok('dialog lists every channel', (await p.$$('.fx-modal .fx-ch')).length === 2);
  ok('current channel highlighted', (await p.$$('.fx-modal .fx-ch.is-on')).length === 1);
  const flat = await p.getAttribute('.fx-curve', 'd');
  ok('EQ curve drawn', !!flat && flat.length > 100);
  const set = (k, v) => p.evaluate(([k, v]) => { const el = document.querySelector(`.modal [data-fx=${k}]`); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  await set('lowCut', true); await set('lowCutHz', 150); await set('mid', 6); await set('midHz', 3000); await set('attack', 30); await set('release', 400);
  await p.waitForTimeout(400);
  const n = await p.evaluate(() => { const c = window.webmix.audio.channels[0]; return { hpf: Math.round(c.hpf.frequency.value), mid: Math.round(c.mid.frequency.value), atk: +c.comp.attack.value.toFixed(3), rel: +c.comp.release.value.toFixed(2) }; });
  ok('low cut → highpass at 150 Hz', n.hpf === 150, JSON.stringify(n));
  ok('presence frequency → 3 kHz', n.mid === 3000);
  ok('attack / release applied', n.atk === 0.03 && n.rel === 0.4);
  ok('EQ curve follows the filters', (await p.getAttribute('.fx-curve', 'd')) !== flat);
  ok('values shown', (await p.textContent('.fx-modal')).includes('150 Hz') && (await p.textContent('.fx-modal')).includes('3 kHz'));
  await set('comp', true); await set('threshold', -40); await p.waitForTimeout(600);
  ok('gain-reduction meter moves', parseFloat(await p.textContent('.fx-gr b')) < -1, await p.textContent('.fx-gr b'));
  // ตั้งเป็นเสียงพูดชัด (ไม่ปิดหน้าต่าง)
  await p.click('.modal-foot .btn:has-text("ตั้งเป็นเสียงพูดชัด")'); await p.waitForTimeout(300);
  const v = await p.evaluate(() => window.webmix.audio.channels[0].fx);
  ok('voice preset applied', v.lowCut && v.comp && v.gate && v.midHz === 3200 && v.ratio === 3, JSON.stringify(v));
  ok('dialog stays open and controls update', await p.isVisible('.fx-modal') && await p.isChecked('.modal [data-fx=gate]'));
  // คัดลอกไปช่องอื่น
  await p.click('.modal-foot .btn:has-text("คัดลอกไปช่องอื่น")'); await p.waitForTimeout(300);
  const c2 = await p.evaluate(() => window.webmix.audio.channels[1].fx);
  ok('copy to other channels', c2.lowCut && c2.comp && c2.midHz === 3200 && !c2.duck, JSON.stringify(c2));
  // สลับช่องจากรายการ
  await p.click('.fx-modal .fx-ch >> nth=1'); await p.waitForTimeout(400);
  ok('click a channel opens its settings', (await p.textContent('.fx-modal .modal-title')).includes(await p.evaluate(() => window.webmix.audio.channels[1].name)));
  await p.click('.modal-foot .btn-primary');
  ok('saved with the show', await p.evaluate(() => { const fx = Object.values(window.webmix.show.serialize().audio.inputs)[0].fx; return fx.lowCut === true && fx.midHz === 3200 && fx.attack === 10; }));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
