// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// Playlist: เล่นวิดีโอ/รูปต่อกัน, เวลาแสดงรูป, วนซ้ำ, ปุ่มบนการ์ด, แก้ไขรายการ, เสียงช่องเดียว, บันทึกโชว์, GPU
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Playlist")');
  await (await fc).setFiles([S + '/logo.png', S + '/clip.webm', S + '/green.png']);
  await p.waitForTimeout(800);
  const id = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'playlist').id);
  const L = () => p.evaluate(id => { const i = window.webmix.inputs.find(x => x.id === id); return { n: i.list.items.length, index: i.list.index, playing: i.list.playing, loop: i.list.loop, img: !!i.showImg, status: i.status, names: i.list.items.map(x => x.name) }; }, id);
  const card = p.locator(`#inputs-grid .card[data-id="${id}"]`);
  let st = await L();
  ok('playlist created with 3 files in order', st.n === 3 && st.names.join(',') === 'logo.png,clip.webm,green.png' && st.index === 0, JSON.stringify(st));
  ok('starts with the first item (image) live', st.img && st.status === 'live');
  ok('card shows position 1/3', /1\/3/.test(await card.locator('.card-sub').textContent()));
  ok('one mixer channel for the playlist', await p.evaluate(id => window.webmix.audio.channels.filter(c => c.inputId === id).length, id) === 1);
  await p.evaluate(id => { const w = window.webmix; w.inputs.find(i => i.id === id).list.imageSec = 1; w.state.programId = id; w.playlist.go(w.inputs.find(i => i.id === id), 0); }, id);
  // image shown on program
  const center = () => p.evaluate(() => Array.from(document.querySelector('#pgm-canvas').getContext('2d').getImageData(640, 360, 1, 1).data.slice(0, 3)));
  ok('image item drawn on program', (await center()).some(v => v > 30), JSON.stringify(await center()));
  ok('image advances to the video after imageSec', await until(async () => { const s = await L(); return s.index === 1 && !s.img; }, 4000));
  ok('video item plays', await until(() => p.evaluate(id => { const v = window.webmix.inputs.find(i => i.id === id).el; return !v.paused && v.currentTime > 0.3; }, id), 4000));
  ok('video end advances to the next item', await until(async () => (await L()).index === 2, 8000));
  ok('loops back to the first item', await until(async () => (await L()).index === 0, 4000));

  // card controls
  await card.hover(); await card.locator('[data-card=pplay]').click();
  const at = (await L()).index; await p.waitForTimeout(1600);
  ok('pause holds the current item', (await L()).index === at && !(await L()).playing);
  await card.hover(); await card.locator('[data-card=pnext]').click(); await p.waitForTimeout(400);
  ok('› jumps to the next item', (await L()).index === (at + 1) % 3);
  await card.hover(); await card.locator('[data-card=pprev]').click(); await card.locator('[data-card=pprev]').click(); await p.waitForTimeout(400);
  ok('‹ wraps to the end', (await L()).index === (at + 2) % 3, JSON.stringify(await L()));
  await card.hover(); await card.locator('[data-card=ploop]').click();
  await p.evaluate(id => { const w = window.webmix, i = w.inputs.find(x => x.id === id); w.playlist.setPlaying(i, true); w.playlist.go(i, 2, true); }, id);
  ok('loop off: stops after the last item', await until(async () => { const s = await L(); return s.index === 2 && !s.playing; }, 4000), JSON.stringify(await L()));

  // editor: reorder + delete
  await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('.modal .pl-row');
  await p.click('.modal .pl-row[data-i="2"] [data-pl=up]');
  ok('reorder in the editor', (await L()).names.join(',') === 'logo.png,green.png,clip.webm');
  const keyOf = await p.evaluate(id => window.webmix.inputs.find(i => i.id === id).list.items[0].key, id);
  await p.click('.modal .pl-row[data-i="0"] [data-pl=del]');
  ok('delete from the playlist', (await L()).names.join(',') === 'green.png,clip.webm');
  await p.fill('.modal [name=imageSec]', '3'); await p.click('.modal [name=loop]'); await p.click('.modal-foot .btn-primary');
  ok('editor saves image time and loop', await p.evaluate(id => { const l = window.webmix.inputs.find(i => i.id === id).list; return l.imageSec === 3 && l.loop; }, id));
  await p.waitForTimeout(800);
  const stored = await p.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle('webmix-media'); const n = []; for await (const [k] of d.entries()) n.push(k); return n; });
  ok('files kept in browser storage, deleted one removed', stored.length === 2 && !stored.includes(keyOf), JSON.stringify(stored));

  // GPU renderer draws playlist items
  await p.evaluate(id => { const w = window.webmix, i = w.inputs.find(x => x.id === id); w.setRenderer('gpu'); w.playlist.setPlaying(i, false); w.playlist.go(i, 0, true); }, id);
  await p.waitForTimeout(700);
  ok('GPU: image item drawn (green)', (await center())[1] > 150 || (await center())[0] > 150, JSON.stringify(await center()));
  await p.evaluate(() => window.webmix.setRenderer('cpu'));

  // show save
  await p.waitForTimeout(2000);
  await p.reload(); await p.waitForTimeout(2500);
  st = await p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'playlist'); return i && { names: i.list.items.map(x => x.name), imageSec: i.list.imageSec, status: i.status, urls: i.urls.size }; });
  ok('playlist restored after reload with its files', st && st.names.join(',') === 'green.png,clip.webm' && st.imageSec === 3 && st.status === 'live', JSON.stringify(st));
  const stored2 = await p.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle('webmix-media'); let n = 0; for await (const _ of d.entries()) n++; return n; });
  ok('startup clean-up keeps playlist files', stored2 === 2, String(stored2));
  // remove the input → files gone once the undo window (10 s) has passed
  await card.hover(); await card.locator('[data-card=remove]').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(800);
  const kept = await p.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle('webmix-media'); let n = 0; for await (const _ of d.entries()) n++; return n; });
  ok('files kept while undo is possible', kept > 0, String(kept));
  await p.waitForTimeout(11000);
  const stored3 = await p.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle('webmix-media'); let n = 0; for await (const _ of d.entries()) n++; return n; });
  ok('removing the playlist deletes its files', stored3 === 0, String(stored3));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.stack); process.exit(1); });
