// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แหล่งภาพใหม่: สไลด์โชว์รูป (Photos) · ลำดับภาพ PNG โปร่งใส (Image Sequence) · เว็บไซต์ (Web Browser — จับภาพแท็บ)
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const ff = args => spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
(async () => {
  // ไฟล์ทดสอบ: รูป 3 สี (ชื่อเรียงเลขแบบที่ต้องเรียงเป็นตัวเลข 2 < 10) + ลำดับภาพ PNG พื้นโปร่งใส กล่องแดงเลื่อนไปทางขวา
  const pdir = path.join(S, 'photos'), qdir = path.join(S, 'seq');
  fs.mkdirSync(pdir, { recursive: true }); fs.mkdirSync(qdir, { recursive: true });
  for (const [n, c] of [['2', 'red'], ['10', 'blue'], ['3', 'green']]) ff(['-f', 'lavfi', '-i', `color=c=${c}:s=640x360`, '-frames:v', '1', path.join(pdir, `pic_${n}.jpg`)]);
  ff(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=320x180:r=12,format=rgba', '-f', 'lavfi', '-i', 'color=c=red:s=60x60:r=12,format=rgba',
    '-filter_complex', "[0][1]overlay=x='t*240':y=60:format=auto,format=rgba", '-frames:v', '12', path.join(qdir, 'frame_%03d.png')]);
  const photos = ['pic_2.jpg', 'pic_3.jpg', 'pic_10.jpg'].map(f => path.join(pdir, f));
  const seq = fs.readdirSync(qdir).filter(f => f.endsWith('.png')).map(f => path.join(qdir, f));

  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // จับภาพแท็บ: แทนด้วยแคนวาสสีเหลือง (เบราว์เซอร์ทดสอบเลือกแท็บเองไม่ได้) · ไม่เปิดแท็บจริง
  await ctx.addInitScript(() => {
    window.__opened = [];
    window.open = u => { window.__opened.push(u); return null; };
    navigator.mediaDevices.getDisplayMedia = async c => {
      window.__dm = c;
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
      const g = cv.getContext('2d'); setInterval(() => { g.fillStyle = '#ffd400'; g.fillRect(0, 0, 640, 360); }, 50); g.fillStyle = '#ffd400'; g.fillRect(0, 0, 640, 360);
      return cv.captureStream(30);
    };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); }); await p.reload(); await p.waitForTimeout(800);
  const px = (x, y) => p.evaluate(([x, y]) => { const c = document.querySelector('#pgm-canvas'); return Array.from(c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3)); }, [x, y]);
  const near = (a, b2, t = 50) => a.every((v, i) => Math.abs(v - b2[i]) <= t);
  const addFrom = async (label, files) => {
    await p.click('[data-action=add-menu]');
    const fc = p.waitForEvent('filechooser');
    await p.click(`.menu button:has-text("${label}")`);
    await (await fc).setFiles(files);
    await p.waitForTimeout(1200);
  };
  const inp = type => p.evaluate(t => { const i = window.webmix.inputs.find(x => x.type === t); return i && { id: i.id, name: i.name, status: i.status, count: i.st?.count, index: i.st?.index, url: i.url, missing: i.missing }; }, type);

  // ---- สไลด์โชว์รูป
  await addFrom('สไลด์โชว์รูป (Photos)', photos);
  const ph = await inp('photos');
  ok('photo slideshow added with 3 photos', ph && ph.count === 3 && ph.status === 'live', JSON.stringify(ph));
  await p.evaluate(id => { const w = window.webmix, i = w.inputs.find(x => x.id === id); w.state.programId = id; i.st.sec = 1; i.st.fade = 300; i.st.since = performance.now(); }, ph.id);
  await p.waitForTimeout(400);
  ok('photos sorted by number: pic_2 (red) first', near(await px(0.5, 0.5), [255, 0, 0]), JSON.stringify(await px(0.5, 0.5)));
  await p.waitForTimeout(1300);
  ok('advances on its own after the set time: pic_3 (green), then pic_10 is last', near(await px(0.5, 0.5), [0, 128, 0], 60), JSON.stringify(await px(0.5, 0.5)));
  const pc = p.locator(`#inputs-grid .card[data-id="${ph.id}"]`); await pc.hover();
  await pc.locator('[data-card=qplay]').click();
  await pc.locator('[data-card=qnext]').click(); await p.waitForTimeout(500);
  ok('pause + › shows the next photo (blue)', near(await px(0.5, 0.5), [0, 0, 255]), JSON.stringify(await px(0.5, 0.5)));
  await pc.locator('[data-card=qnext]').click(); await p.waitForTimeout(500);
  ok('loops back to the first photo', near(await px(0.5, 0.5), [255, 0, 0]), JSON.stringify(await px(0.5, 0.5)));
  // ระหว่างจางผ่าน: สีผสมระหว่างสองรูป
  await p.evaluate(id => { window.webmix.inputs.find(x => x.id === id).st.fade = 2000; }, ph.id);
  await pc.locator('[data-card=qnext]').click(); await p.waitForTimeout(900);
  const mid = await px(0.5, 0.5);
  ok('crossfades between photos', mid[0] > 40 && mid[1] > 30 && mid[0] < 230, JSON.stringify(mid));

  // ---- ลำดับภาพ PNG โปร่งใส บน Overlay
  await addFrom('ลำดับภาพ (Image Sequence)', seq);
  const sq = await inp('imgseq');
  ok('image sequence added with 12 frames, named from the files', sq && sq.count === 12 && sq.status === 'live' && /^FRAME/.test(sq.name), JSON.stringify(sq));
  await p.evaluate(() => { const w = window.webmix; w.state.programId = w.inputs.find(i => i.type === 'bars').id; });
  await p.waitForTimeout(300);
  const corner = await px(0.95, 0.9);
  const sc = p.locator(`#inputs-grid .card[data-id="${sq.id}"]`); await sc.hover();
  await sc.locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(800);
  ok('transparent PNG sequence on Overlay 1 keeps the picture underneath', near(await px(0.95, 0.9), corner, 12), JSON.stringify({ corner, now: await px(0.95, 0.9) }));
  const i1 = (await inp('imgseq')).index; await p.waitForTimeout(170); const i2 = (await inp('imgseq')).index;
  await p.screenshot({ path: process.env.WORK + '/stills-seq.png' });
  ok('sequence plays (frame index advances)', i1 !== i2, `${i1} → ${i2}`);
  ok('red box from the frames is drawn', await p.evaluate(() => { const c = document.querySelector('#pgm-canvas'), d = c.getContext('2d').getImageData(0, Math.floor(c.height * 0.33), c.width, Math.floor(c.height * 0.33)).data; let r = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) r++; return r > 200; }));
  await sc.locator('[data-card-ovl="0"]').click(); await p.waitForTimeout(500);

  // ---- เว็บไซต์
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("เว็บไซต์ (Web Browser)")');
  await p.fill('.modal [name=url]', 'example.com/live'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1000);
  const wb = await inp('web');
  ok('web source opens the site and captures a browser tab', wb && wb.status === 'live' && wb.url === 'https://example.com/live' && wb.name === 'EXAMPLE.COM' && await p.evaluate(() => window.__opened[0] === 'https://example.com/live' && window.__dm.video.displaySurface === 'browser'), JSON.stringify(wb));
  await p.evaluate(id => { window.webmix.state.programId = id; }, wb.id); await p.waitForTimeout(500);
  ok('web page picture reaches Program', near(await px(0.5, 0.5), [255, 212, 0]), JSON.stringify(await px(0.5, 0.5)));

  // ---- บันทึกโชว์
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(2500);
  const r1 = await inp('photos'), r2 = await inp('imgseq'), r3 = await inp('web');
  ok('after reload: photos and sequence come back with their files', r1 && r1.count === 3 && r1.status === 'live' && r2 && r2.count === 12 && r2.status === 'live', JSON.stringify({ r1, r2 }));
  ok('after reload: web source keeps its URL and offers 🔗 to reconnect', r3 && r3.missing && r3.url === 'https://example.com/live' && await p.isVisible(`#inputs-grid .card[data-id="${r3.id}"] [data-card=relink]`), JSON.stringify(r3));
  await p.locator(`#inputs-grid .card[data-id="${r3.id}"]`).hover();
  await p.click(`#inputs-grid .card[data-id="${r3.id}"] [data-card=relink]`); await p.waitForTimeout(800);
  ok('🔗 reopens the site and reconnects', (await inp('web')).status === 'live');

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
