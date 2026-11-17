// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// เครื่องช้า: ส่งวิดีโอขึ้น GPU เฉพาะเมื่อมีเฟรมใหม่ · วาดไม่ทัน → ลดงาน Preview / ภาพย่อเอง (ผู้ชมไม่เห็น)
// ยังไม่ทัน → แจ้งว่าแหล่งไหนหนักที่สุดพร้อมวิธีแก้ · เครื่องเบาลง → กลับเป็นปกติเอง
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); });
  await p.reload(); await p.waitForTimeout(800);

  // วิดีโอขึ้น Program · บังคับวาดด้วย GPU (เครื่องทดสอบใช้ GPU แบบซอฟต์แวร์ — โหมดอัตโนมัติจะเลือก CPU)
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(`${S}/clip.webm`);
  await until(() => p.evaluate(() => window.webmix.inputs.some(i => i.status === 'live' && i.el && i.el.videoWidth)), 10000);
  await p.evaluate(() => {
    const w = window.webmix, v = w.inputs.find(i => i.el && i.el.videoWidth);
    v.el.loop = true; v.el.play();
    w.setPreview(v.id); w.cut();
    w.setRenderer('gpu');
    const g = w.gpu, orig = g.upload;
    window.__up = 0;
    g.upload = (...a) => { if (a[2] === v.el.videoWidth) window.__up++; return orig.apply(g, a); };
  });
  const uploadsIn = async ms => { const a = await p.evaluate(() => window.__up); await p.waitForTimeout(ms); return (await p.evaluate(() => window.__up)) - a; };
  const playing = await uploadsIn(1000);
  ok('playing video is uploaded to the GPU as frames arrive', playing >= 10, `${playing} uploads/s`);
  await p.evaluate(() => window.webmix.inputs.find(i => i.el && i.el.videoWidth).el.pause());
  await p.waitForTimeout(300);
  const paused = await uploadsIn(1000);
  ok('paused video is not uploaded again every frame', paused <= 1, `${paused} uploads/s`);
  await p.evaluate(() => { const v = window.webmix.inputs.find(i => i.el && i.el.videoWidth).el; v.currentTime = 1.5; });
  ok('seeking a paused video uploads the new frame', await until(async () => (await uploadsIn(300)) >= 1, 3000));
  await p.evaluate(() => window.webmix.inputs.find(i => i.el && i.el.videoWidth).el.play());

  // จำลองเครื่องช้า: ใช้เวลาวาด 45 ms ต่อเฟรม (เอาต์พุต 30 fps มีแค่ 33 ms)
  await p.evaluate(() => { window.webmix.load.extraMs = 45; });
  ok('overloaded → steps down to level 2 by itself', await until(() => p.evaluate(() => window.webmix.perf().level === 2), 12000), JSON.stringify(await p.evaluate(() => window.webmix.perf())));
  ok('status bar says Preview work is reduced', /ลดงาน Preview/.test(await p.textContent('#st-engine')), await p.textContent('#st-engine'));
  ok('still too slow → tells which source is heaviest', await until(async () => /เครื่องวาดภาพได้ .*หนักที่สุด: “/.test(await p.textContent('#toasts')), 15000), await p.textContent('#toasts'));
  await p.click('#toasts .toast-action:has-text("ดูวิธีแก้")');
  ok('help dialog lists the heavy source and fixes', await until(async () => /เครื่องทำงานไม่ทัน/.test(await p.textContent('body')) && /ms\/เฟรม/.test(await p.textContent('.modal')) && /720p30/.test(await p.textContent('.modal')), 4000));
  await p.keyboard.press('Escape');

  // ยังหนักอยู่ (เครื่องทดสอบวาดด้วย GPU แบบซอฟต์แวร์ใช้เวลาเกือบเต็มเฟรมเอง) → ต้องไม่กลับไปวาดเต็มที่
  await p.evaluate(() => { window.webmix.load.extraMs = 0; });
  await p.waitForTimeout(6000);
  const still = await p.evaluate(() => window.webmix.perf());
  ok('still near the limit → stays reduced', still.renderMs < 1000 / 30 * 0.5 || still.level > 0, JSON.stringify(still));
  // เครื่องเบาลงจริง (วาดด้วย CPU ซึ่งเบากว่าบนเครื่องทดสอบ) → กลับเป็นปกติเอง
  await p.evaluate(() => window.webmix.setRenderer('cpu'));
  ok('load gone → back to normal by itself', await until(() => p.evaluate(() => window.webmix.perf().level === 0), 20000), JSON.stringify(await p.evaluate(() => window.webmix.perf())));
  ok('status bar back to normal', await until(async () => !/ลดงาน/.test(await p.textContent('#st-engine')), 3000), await p.textContent('#st-engine'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
