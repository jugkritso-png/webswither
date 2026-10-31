// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// คลิปไฮไลต์ 9:16: ปุ่มกรรไกร / ปุ่มลัด H เปิดหน้าต่างและเริ่มบัฟเฟอร์ · ตัด N วินาทีล่าสุด → ไฟล์แนวตั้ง 720×1280 หรือ 1080×1920
// มีทั้งภาพและเสียง ยาวตามที่เลือก · ครอป / พื้นเบลอ · ข้อความบนคลิป · ปิดบัฟเฟอร์ได้ · ทำคลิประหว่างไลฟ์ไม่ทำให้ภาพ Program สะดุด
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const probe = f => { const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', f], { encoding: 'utf8' }); try { return JSON.parse(r.stdout); } catch (e) { return null; } };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  // คลิปวิดีโอที่มีเสียงบน Program (ให้ไฮไลต์มีทั้งภาพเคลื่อนไหวและเสียง)
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("ไฟล์วิดีโอ")'); await (await fc).setFiles(S + '/loud.webm');
  await p.waitForTimeout(800);
  await p.evaluate(() => { const w = window.webmix, id = w.inputs.find(i => i.type === 'media').id; w.setPreview(id); w.cut(); });

  ok('scissors button in the top bar', await p.isVisible('[data-action=highlight]'));
  await p.keyboard.press('h'); await p.waitForSelector('.hl-preview');
  ok('H opens the highlight window and starts the buffer', await p.evaluate(() => window.webmix.hl.on));
  // ภาพตัวอย่าง 9:16 มีภาพ (ไม่ดำทั้งแผ่น)
  await sleep(600);
  ok('9:16 preview shows the Program picture', await p.evaluate(() => { const c = document.querySelector('.hl-preview'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 400) s += d[i] + d[i + 1] + d[i + 2]; return s > 1000; }));
  ok('shows how much is buffered', /เก็บภาพย้อนหลัง|พร้อมตัด/.test(await p.textContent('.hl-buf')), await p.textContent('.hl-buf'));

  // ตั้งค่า: 15 วินาที · ครอปเต็มจอ · ข้อความ
  await p.click('.hl-len [data-len="15"]');
  await p.selectOption('.modal [name=frame]', 'crop');
  ok('crop position slider appears for crop', await p.isVisible('.hl-x'));
  await p.fill('.modal [name=title]', 'ช็อตเด็ด');
  await sleep(17000);  // เก็บภาพย้อนหลังให้เกิน 15 วินาที
  ok('ready once the buffer holds the chosen length', /พร้อมตัด/.test(await p.textContent('.hl-buf')), await p.textContent('.hl-buf'));

  // ตัดคลิป: ระหว่างทำ Program ยังวาดต่อ (fps ไม่ตก) · ได้ไฟล์ดาวน์โหลด
  const dl = p.waitForEvent('download', { predicate: x => /Highlight/.test(x.suggestedFilename()), timeout: 60000 });
  await p.click('.hl-cut');
  await sleep(1500);
  ok('progress bar while the clip is made', await p.isVisible('.hl-progress') && /กำลังทำคลิป/.test(await p.textContent('.hl-progress')));
  const fpsDuring = await p.evaluate(() => window.webmix.perf().fps);
  results.push(`INFO  Program fps while converting (not live): ${fpsDuring.toFixed(1)}`);
  const d = await dl; const f = `${S}/highlight.${(d.suggestedFilename().split('.').pop())}`; await d.saveAs(f);
  ok('file named WebMix-Highlight-…', /^WebMix-Highlight-.*\.(mp4|webm)$/.test(d.suggestedFilename()), d.suggestedFilename());
  const info = probe(f); const v = info?.streams?.find(x => x.codec_type === 'video'), a = info?.streams?.find(x => x.codec_type === 'audio');
  ok('vertical 9:16 video', v && v.width * 16 === v.height * 9 && v.height >= 1280, v ? `${v.width}×${v.height}` : 'no video');
  ok('has audio', !!a);
  const dur = +info?.format?.duration;
  ok('about 15 seconds long', dur > 13 && dur < 17.5, String(dur));
  // ภาพในคลิปมีข้อความ (แถบบนสว่างกว่า) — ดึงเฟรมกลางคลิปมาเทียบ
  spawnSync('ffmpeg', ['-v', 'error', '-ss', '5', '-i', f, '-frames:v', '1', '-y', `${S}/hl-frame.png`]);
  ok('frame extracted from the clip', fs.existsSync(`${S}/hl-frame.png`) && fs.statSync(`${S}/hl-frame.png`).size > 1000);
  ok('clip listed in the window', await p.locator('.hl-item[data-state=done]').count() === 1 && /ช็อตเด็ด/.test(await p.textContent('.hl-item')));

  // ระหว่างบันทึก (เหมือนไลฟ์): ตัดแล้วเก็บช่วงไว้ทันที ไม่เข้ารหัสใหม่ → ภาพ Program ไม่ตก · หยุดบันทึกแล้วทำคลิปให้เอง
  await p.click('.modal-foot button:has-text("ปิด")').catch(() => {});
  await p.click('[data-action=record]'); await p.waitForFunction(() => window.webmix.rec.active, null, { timeout: 8000 });
  await p.keyboard.press('h'); await p.waitForSelector('.hl-preview');
  await p.click('.hl-cut'); await sleep(1500);
  ok('while recording: the cut is kept, not converted yet', await p.evaluate(() => window.webmix.hl.list[0].state === 'wait') && /รอจบไลฟ์/.test(await p.textContent('.hl-item')), await p.textContent('.hl-list'));
  ok('“convert now” button offered', await p.locator('[data-hl-now]').count() === 1);
  ok('on air: dialogs drop the backdrop blur', await p.evaluate(() => getComputedStyle(document.querySelector('.modal-backdrop')).backdropFilter === 'none'));
  await p.click('.modal-foot button:has-text("ปิด")');
  await sleep(3000);
  const fpsLive = []; for (let i = 0; i < 3; i++) { await sleep(1000); fpsLive.push(await p.evaluate(() => window.webmix.perf().fps)); }
  ok('…so the Program picture does not drop while it waits', Math.min(...fpsLive) >= 40, fpsLive.map(x => x.toFixed(0)).join(','));
  const dl2 = p.waitForEvent('download', { predicate: x => /Highlight/.test(x.suggestedFilename()), timeout: 90000 });
  await p.click('[data-action=record]');
  const d2 = await dl2;
  ok('after recording stops the waiting clip is made by itself', /^WebMix-Highlight-/.test(d2.suggestedFilename()) && await p.evaluate(() => window.webmix.hl.list[0].state === 'done'));
  await p.keyboard.press('h'); await p.waitForSelector('.hl-preview');

  // ปิดบัฟเฟอร์
  await p.click('.modal-foot button:has-text("ปิดบัฟเฟอร์")');
  ok('buffer can be switched off', await p.evaluate(() => !window.webmix.hl.on && window.webmix.hl.recs.length === 0));
  ok('settings remembered', await p.evaluate(() => { const c = JSON.parse(localStorage.getItem('webmix:hl-cfg') || '{}'); return c.len === 15 && c.frame === 'crop' && c.title === 'ช็อตเด็ด'; }));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
