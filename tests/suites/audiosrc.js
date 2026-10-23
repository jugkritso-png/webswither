// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แหล่งเสียง: เมนูเพิ่มแหล่งเสียง · ไมค์แยกช่อง 1/2 · เครื่องเล่นเพลง · แผงเสียงเอฟเฟกต์ · สตรีมเสียงจาก URL · Tone · Macro · บันทึกกับโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  const menu = async tile => { await p.click('[data-action=add-audio]'); await p.click(`.menu button:has-text("${tile}")`); };
  const chans = () => p.evaluate(() => window.webmix.audio.channels.map(c => ({ kind: c.kind, name: c.name, key: window.webmix.chanKey(c), muted: c.muted })));
  const level = kind => p.evaluate(k => new Promise(r => { const c = window.webmix.audio.channels.find(x => x.kind === k); const v = []; const id = setInterval(() => { v.push(c.level); if (v.length >= 6) { clearInterval(id); v.sort((a, b) => a - b); r(+v[3].toFixed(1)); } }, 120); }), kind);

  await p.click('[data-action=add-audio]');
  const tiles = await p.locator('.add-sheet .add-tile').count();
  ok('audio menu lists 6 kinds of sound source', tiles === 6, String(tiles));
  await p.keyboard.press('Escape'); await p.mouse.click(5, 5);

  // ไมค์แยกช่อง: 2 ช่องเสียงจากอุปกรณ์เดียว
  await menu('ไมโครโฟน'); await p.waitForSelector('.modal select[name=chan]');
  await p.selectOption('.modal select[name=chan]', 'split'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800);
  let c = await chans();
  const mics = c.filter(x => x.kind === 'mic');
  ok('split interface -> two mic strips CH1 / CH2', mics.length === 2 && /CH1$/.test(mics[0].name) && /CH2$/.test(mics[1].name), JSON.stringify(mics));
  ok('split mics have their own keys', mics.length === 2 && mics[0].key.endsWith('#0') && mics[1].key.endsWith('#1') && mics[0].key !== mics[1].key, JSON.stringify(mics.map(m => m.key)));
  // ลบช่องหนึ่ง อีกช่องยังได้เสียง (อุปกรณ์ไม่ถูกปิด)
  await p.locator('.strip', { hasText: 'CH2' }).locator('.chip-btn.rm').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(300);
  const live = await p.evaluate(() => window.webmix.audio.channels.find(c => c.kind === 'mic').stream.getAudioTracks()[0].readyState);
  ok('removing CH2 keeps the shared device open for CH1', live === 'live', live);

  // เครื่องเล่นเพลง
  let fc = p.waitForEvent('filechooser'); await menu('เครื่องเล่นเพลง'); await (await fc).setFiles([S + '/song1.wav', S + '/song2.wav']);
  await p.waitForTimeout(800);
  const music = p.locator('.strip', { hasText: 'MUSIC' });
  ok('music player strip shows the first track', (await music.locator('.strip-sub').textContent()) === 'song1');
  ok('player does not start by itself', !(await p.evaluate(() => window.webmix.audio.channels.find(c => c.kind === 'player').src.playing())));
  await music.locator('[data-tp=toggle]').click(); await p.waitForTimeout(700);
  const lv = await level('player');
  ok('play -> music reaches the mixer', lv > -35, `${lv} dB`);
  ok('play button lit + time counts down', await music.locator('.tp-play.is-on').count() === 1 && /^-0:0\d$/.test(await music.locator('.strip-time').textContent()), await music.locator('.strip-time').textContent());
  await music.locator('[data-tp=next]').click(); await p.waitForTimeout(500);
  ok('next -> second track playing', (await music.locator('.strip-sub').textContent()) === 'song2' && await p.evaluate(() => window.webmix.audio.channels.find(c => c.kind === 'player').src.playing()));
  // จบเพลงสุดท้าย -> วนกลับเพลงแรก (ค่าเริ่มต้น: วนทั้งรายการ)
  await p.evaluate(() => { const el = window.webmix.audio.channels.find(c => c.kind === 'player').el; el.currentTime = el.duration - 0.2; });
  await p.waitForTimeout(1200);
  ok('end of list loops back to track 1', (await music.locator('.strip-sub').textContent()) === 'song1');
  await music.locator('.strip-sub').click(); await p.waitForSelector('.modal .track');
  ok('playlist dialog lists both tracks, current one marked', await p.locator('.modal .track').count() === 2 && await p.locator('.modal .track.is-cur').count() === 1);
  await p.locator('.modal .track').nth(1).locator('[data-act=up]').click();
  ok('reorder keeps the current track', (await p.locator('.modal .track.is-cur .track-name').textContent()).includes('song1') && (await p.locator('.modal .track').nth(0).textContent()).includes('song2'));
  await p.selectOption('.modal select[name=loop]', 'off');
  await p.click('.modal-foot .btn-primary');
  await music.locator('[data-tp=toggle]').click(); await p.waitForTimeout(200);

  // แผงเสียงเอฟเฟกต์
  await menu('แผงเสียงเอฟเฟกต์'); await p.waitForSelector('.modal .pad-row');
  fc = p.waitForEvent('filechooser'); await p.locator('.modal .pad-row').nth(0).locator('[data-act=file]').click(); await (await fc).setFiles(S + '/clap.wav');
  await p.waitForTimeout(800);
  await p.locator('.modal .pad-row').nth(0).locator('[data-k=name]').fill('ปรบมือ');
  await p.click('.modal-foot .btn-primary');
  ok('pad bar appears under the audio panel', await p.locator('#sfx-bar:not([hidden]) .sfx-pad').count() === 8);
  ok('pad 1 named, others empty', (await p.locator('.sfx-pad').nth(0).textContent()).includes('ปรบมือ') && await p.locator('.sfx-pad.is-empty').count() === 7);
  await p.locator('.sfx-pad').nth(0).click(); await p.waitForTimeout(250);
  const padOn = await p.locator('.sfx-pad.is-on').count();
  const padLv = await level('pad');
  ok('click pad -> sound plays in its own channel', padOn === 1 && padLv > -40, `${padOn} ${padLv} dB`);
  await p.waitForTimeout(900);
  ok('pad goes dark when the sound ends', await p.locator('.sfx-pad.is-on').count() === 0);
  await p.locator('.sfx-pad').nth(0).click(); await p.waitForTimeout(100); await p.locator('.sfx-pad').nth(0).click(); await p.waitForTimeout(150);
  ok('second click stops the pad', await p.locator('.sfx-pad.is-on').count() === 0);

  // สตรีมเสียงจาก URL (ไฟล์บนเซิร์ฟเวอร์เดียวกัน)
  await menu('วิทยุ'); await p.waitForSelector('.modal input[name=url]');
  await p.fill('.modal input[name=url]', 'http://localhost:8765/tests/.work/song2.wav'); await p.fill('.modal input[name=name]', 'NET');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(900);
  const net = await level('url');
  ok('URL stream plays into the mixer', net > -35, `${net} dB`);
  await p.locator('.strip', { hasText: 'NET' }).locator('[data-tp=toggle]').click();

  // Tone: เริ่มแบบปิดเสียง กด M แล้วระดับตรงตามที่ตั้ง
  await menu('สัญญาณทดสอบ'); await p.waitForSelector('.modal select[name=type]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  c = await chans();
  ok('tone added muted (safe on air)', c.find(x => x.kind === 'tone')?.muted === true);
  await p.locator('.strip', { hasText: 'TONE' }).locator('.chip-btn.mute').click(); await p.waitForTimeout(500);
  const tone = await level('tone');
  ok('1 kHz tone meters at -18 dBFS', Math.abs(tone + 18) < 1.5, `${tone} dB`);
  await p.locator('.strip', { hasText: 'TONE' }).locator('.chip-btn.mute').click();

  // Macro / MIDI เรียกเสียงเอฟเฟกต์และเครื่องเล่นเพลงได้
  const acts = await p.evaluate(() => { window.webmix.midi; return true; });
  const fired = await p.evaluate(async () => {
    const w = window.webmix;
    w.macros.push({ id: 'm1', name: 'SFX', key: '', at: '', steps: [{ a: 'sfx', v: '0' }] });
    await w.runMacro(w.macros[0]);
    await new Promise(r => setTimeout(r, 150));
    return w.audio.channels.find(c => c.kind === 'pad').active.size;
  });
  ok('macro step plays a sound pad', acts && fired === 1, String(fired));
  ok('channel pickers list the new sources', await p.evaluate(() => {
    const keys = window.webmix.audio.channels.map(c => window.webmix.chanKey(c));
    return keys.every(Boolean) && new Set(keys).size === keys.length;
  }));
  await p.screenshot({ path: S + '/audiosrc.png' });

  // บันทึกกับโชว์ แล้วเปิดหน้าใหม่
  const saved = await p.evaluate(() => window.webmix.show.serialize().audio.sources.map(s => s.kind + ':' + (s.cfg.items ? s.cfg.items.length : s.cfg.pads ? s.cfg.pads.filter(Boolean).length : s.cfg.url ? 'url' : s.cfg.type)));
  ok('sources saved with the show', JSON.stringify(saved) === JSON.stringify(['player:2', 'pad:1', 'url:url', 'tone:k1']), JSON.stringify(saved));
  await p.evaluate(() => window.webmix.show.autosave(true));
  await p.reload(); await p.waitForTimeout(1500);
  c = await chans();
  ok('after reload: player, pad, URL and tone are back', ['player', 'pad', 'url', 'tone'].every(k => c.some(x => x.kind === k)), JSON.stringify(c.map(x => x.kind)));
  const back = await p.evaluate(() => { const w = window.webmix.audio.channels; const pl = w.find(c => c.kind === 'player'); return { items: pl.list.items.map(i => i.name), loop: pl.list.loop, url: w.find(c => c.kind === 'url').url }; });
  ok('playlist order, loop mode and URL restored', JSON.stringify(back.items) === '["song2","song1"]' && back.loop === 'off' && /song2\.wav$/.test(back.url), JSON.stringify(back));
  ok('pad file restored from browser storage', (await p.locator('.sfx-pad').nth(0).textContent()).includes('ปรบมือ') && await p.locator('.sfx-pad.is-missing').count() === 0);
  await p.locator('.sfx-pad').nth(0).click(); await p.waitForTimeout(200);
  ok('restored pad plays', await p.locator('.sfx-pad.is-on').count() === 1);
  const pl = p.locator('.strip', { hasText: 'MUSIC' });
  await pl.locator('[data-tp=toggle]').click(); await p.waitForTimeout(600);
  ok('restored player plays from storage', await p.evaluate(() => window.webmix.audio.channels.find(c => c.kind === 'player').src.playing()));
  // ลบเครื่องเล่น -> ไฟล์ใน OPFS ถูกลบ
  await pl.locator('.chip-btn.rm').click(); await p.click('.modal-foot .btn-danger'); await p.waitForTimeout(500);
  const left = await p.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('webmix-media'); const n = []; for await (const [k] of d.entries()) n.push(k); return n; });
  ok('removing the player deletes its files', !left.some(k => k.startsWith('aud-')) && left.some(k => k.startsWith('sfx-')), JSON.stringify(left));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
