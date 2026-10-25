// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ตอนมีปัญหา (เดสก์ท็อป): ขออนุญาตกล้อง · แถบเน็ตหลุด + “ไม่ได้ส่งออก” · การ์ดแจ้งเตือนมุมขวาบน (เสียงแตก) · หน้าว่าง
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // จำลองเบราว์เซอร์ที่บล็อกกล้อง จนกว่าจะ “อนุญาต” (window.__allow = true)
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md), en = md.enumerateDevices.bind(md);
    md.getUserMedia = c => window.__allow ? gum(c) : Promise.reject(new DOMException('denied', 'NotAllowedError'));
    md.enumerateDevices = async () => { const l = await en(); return window.__allow ? l : l.map(d => ({ kind: d.kind, deviceId: '', label: '', groupId: '' })); };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);

  await p.click('[data-action=add-menu]'); await p.click('.add-tile:has-text("กล้อง /")');
  await p.waitForSelector('.perm-modal', { timeout: 5000 }).catch(() => {});
  ok('blocked camera shows the permission guide', await p.isVisible('.perm-modal'));
  ok('guide has 3 steps', (await p.$$('.perm-steps li')).length === 3);
  ok('guide has “try again” and “use another source”', await p.isVisible('.perm-modal .btn-primary:has-text("ลองอีกครั้ง")') && await p.isVisible('.perm-modal .btn:has-text("ใช้แหล่งภาพอื่น")'));
  await p.evaluate(() => { window.__allow = true; });
  await p.click('.perm-modal .btn-primary');
  await p.waitForTimeout(800);
  ok('try again after allowing opens the camera dialog', await p.isVisible('.modal-title:has-text("เพิ่มกล้อง")'));
  await p.keyboard.press('Escape');

  // เน็ตหลุดระหว่างไลฟ์
  ok('no banner normally', !(await p.isVisible('#net-banner')) && !(await p.isVisible('#pgm-offair')));
  await p.evaluate(() => { const s = window.webmix.streamer; s.reconnecting = true; s.attempt = 2; window.webmix.renderAlerts(); });
  ok('reconnect banner shows the attempt', await p.isVisible('#net-banner') && (await p.textContent('#net-banner')).includes('ครั้งที่ 2'));
  ok('Program shows “not sending”', await p.isVisible('#pgm-offair'));
  ok('no duplicate reconnect card next to the banner', !(await p.textContent('#m-alerts')).includes('เชื่อมต่อใหม่ (ครั้งที่'));
  await p.evaluate(() => { const s = window.webmix.streamer; s.reconnecting = false; s.attempt = 0; window.webmix.renderAlerts(); });
  ok('banner hides after reconnect', !(await p.isVisible('#net-banner')) && !(await p.isVisible('#pgm-offair')));

  // เสียงแตก → การ์ดเตือนพร้อมปุ่ม “ลด 4 dB”
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/clip.webm');
  await p.waitForFunction(() => window.webmix.audio.channels.some(c => c.inputId), null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => { const c = window.webmix.audio.channels.find(c => c.inputId); const n = Date.now(); c.clips = [n, n, n, n]; window.webmix.renderAlerts(); });
  ok('clipping alert appears', (await p.textContent('#m-alerts')).includes('CLIP'));
  ok('desktop alert cards stack top-right', await p.evaluate(() => { const r = document.querySelector('#m-alerts').getBoundingClientRect(); return r.right > 1400 && r.top < 170 && r.width < 420; }));
  const db0 = await p.evaluate(() => window.webmix.audio.channels.find(c => c.inputId).db);
  await p.click('#m-alerts .m-alert:has-text("CLIP") [data-alert-act]');
  const db1 = await p.evaluate(() => window.webmix.audio.channels.find(c => c.inputId).db);
  ok('“reduce 4 dB” lowers the channel', Math.abs(db0 - 4 - db1) < 0.01, `${db0} → ${db1}`);
  await p.evaluate(() => { const c = window.webmix.audio.channels.find(c => c.inputId); const n = Date.now(); c.clips = [n, n, n]; window.webmix.renderAlerts(); });
  await p.click('#m-alerts .m-alert:has-text("CLIP") .m-alert-x');
  ok('close (✕) hides the alert', !(await p.textContent('#m-alerts')).includes('CLIP'), await p.textContent('#m-alerts'));

  // หน้าว่าง
  await p.evaluate(() => { const w = window.webmix; w.inputs.splice(0, w.inputs.length); w.renderInputs(); });
  ok('empty state with 4 shortcuts', await p.isVisible('.empty-state') && (await p.$$('.es-tiles button')).length === 4);
  await p.click('.empty-state [data-empty=menu]');
  ok('“add source” in the empty state opens the add menu', await p.isVisible('.add-tile'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
