// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
// บันทึกโชว์: บันทึกอัตโนมัติ → รีเฟรชแล้วกลับมาครบ, บันทึก/เปิดไฟล์โชว์, เชื่อมต่อไฟล์ใหม่, preset ป้ายชื่อ, เริ่มโชว์ใหม่
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:8765' });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const st = () => p.evaluate(() => {
    const w = window.webmix;
    return {
      inputs: w.inputs.map(i => ({ id: i.id, type: i.type, name: i.name, text: i.text, status: i.status, missing: !!i.missing, ready: i.el ? (i.el.readyState ?? (i.el.complete && i.el.naturalWidth ? 4 : 0)) : null })),
      pgm: w.state.programId, pvw: w.state.previewId,
      ch: w.audio.channels.map(c => ({ inputId: c.inputId, kind: c.kind, name: c.name, db: c.db, muted: c.muted, afv: c.afv, fx: c.fx })),
      master: w.audio.masterStrip.db
    };
  });

  // --- build a show
  const fileOf = async (label, file) => { const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click(`.menu button:has-text("${label}")`); await (await fc).setFiles(file); };
  await fileOf('ไฟล์วิดีโอ', S + '/clip.webm');
  await fileOf('ภาพนิ่ง', S + '/logo.png');
  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("กล้อง")');
  await p.waitForSelector('.modal select[name=mic]'); await p.selectOption('.modal select[name=mic]', { index: 1 });
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(1500);
  await p.click('[data-action=add-mic]'); await p.waitForSelector('.modal select[name=mic]'); await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(800);
  // rename the slate, change its text; set buses; tweak audio
  await p.evaluate(() => {
    const w = window.webmix; const slate = w.inputs.find(i => i.type === 'slate');
    slate.name = 'OPENING'; slate.text = 'เริ่มรายการ 19:00';
    const media = w.inputs.find(i => i.type === 'media'); const cam = w.inputs.find(i => i.type === 'camera');
    w.state.programId = cam.id; w.setPreview(media.id);
    w.overlays.pip.sourceId = media.id;
    const chMedia = w.audio.channels.find(c => c.inputId === media.id); chMedia.db = -12; chMedia.afv = true; chMedia.fx = { ...chMedia.fx, low: 4, comp: true }; w.audio.applyGain(chMedia); w.audio.applyFx(chMedia);
    const mic = w.audio.channels.find(c => c.kind === 'mic'); mic.muted = true; w.audio.applyGain(mic);
    w.audio.masterStrip.db = -3;
  });
  // title preset
  await p.fill('#title-headline', 'สมชาย ใจดี'); await p.fill('#title-subtitle', 'ผู้ประกาศข่าว');
  await p.click('#title-presets [data-preset-add]');
  await p.fill('#title-headline', 'ข่าวด่วน'); await p.fill('#title-subtitle', 'รายงานสด'); await p.click('#title-colors [data-color="#3b82f6"]');
  await p.click('#title-presets [data-preset-add]');
  ok('two title presets saved', (await p.$$('#title-presets .preset')).length === 2);
  await p.click('#title-presets [data-preset="0"]');
  ok('preset applies to title fields', await p.inputValue('#title-headline') === 'สมชาย ใจดี' && await p.inputValue('#title-subtitle') === 'ผู้ประกาศข่าว');
  ok('active preset highlighted', await p.evaluate(() => document.querySelector('#title-presets .preset').classList.contains('is-active')));
  await p.waitForTimeout(2500); // autosave + media copy into browser storage
  const before = await st();
  const stored = await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('webmix-media'); const n = []; for await (const [k] of d.entries()) n.push(k); return n; });
  const mediaIds = before.inputs.filter(i => i.type === 'media' || i.type === 'image').map(i => i.id);
  ok('video and image copied into browser storage', mediaIds.every(id => stored.includes(id)), JSON.stringify(stored));
  ok('show autosaved', await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('webmix:show')); return s && s.inputs.length === window.webmix.inputs.length; }));

  // --- reload: everything comes back
  await p.reload(); await p.waitForTimeout(3000);
  const after = await st();
  ok('same inputs in the same order', JSON.stringify(after.inputs.map(i => [i.id, i.type, i.name])) === JSON.stringify(before.inputs.map(i => [i.id, i.type, i.name])), after.inputs.map(i => i.name).join(', '));
  ok('slate text restored', after.inputs.find(i => i.type === 'slate').text === 'เริ่มรายการ 19:00');
  ok('program / preview restored', after.pgm === before.pgm && after.pvw === before.pvw);
  const media = after.inputs.find(i => i.type === 'media'), img = after.inputs.find(i => i.type === 'image'), cam = after.inputs.find(i => i.type === 'camera');
  ok('video file reloaded from browser storage', media.status === 'live' && !media.missing && media.ready >= 2, JSON.stringify(media));
  ok('image reloaded from browser storage', img.status === 'live' && !img.missing, JSON.stringify(img));
  ok('camera reopened automatically', cam.status === 'live' && !cam.missing, JSON.stringify(cam));
  const chm = after.ch.find(c => c.inputId === media.id);
  ok('audio channel settings restored', chm && chm.db === -12 && chm.afv && chm.fx.low === 4 && chm.fx.comp, JSON.stringify(chm));
  ok('camera audio channel back', after.ch.some(c => c.inputId === cam.id));
  const mic = after.ch.find(c => c.kind === 'mic');
  ok('microphone reopened with its settings', mic && mic.muted, JSON.stringify(after.ch.map(c => c.kind)));
  ok('master level restored', after.master === -3);
  ok('PIP source restored', await p.evaluate(id => window.webmix.overlays.pip.sourceId === id, media.id));
  ok('title presets restored', (await p.$$('#title-presets .preset')).length === 2);
  ok('graphics are not put on air by a reload', !(await p.evaluate(() => window.webmix.overlays.title.on || window.webmix.overlays.pip.on)));

  // --- export the show file
  await p.click('[data-action=show]'); await p.waitForSelector('.modal [name=showname]');
  await p.fill('.modal [name=showname]', 'ข่าวค่ำ');
  const dl = p.waitForEvent('download'); await p.click('.modal [data-show=export]'); const d = await dl;
  ok('show file name', d.suggestedFilename() === 'ข่าวค่ำ.webmix.json', d.suggestedFilename());
  await d.saveAs(S + '/show.webmix.json');
  const file = JSON.parse(fs.readFileSync(S + '/show.webmix.json', 'utf8'));
  ok('show file contents', file.app === 'webmix' && file.name === 'ข่าวค่ำ' && file.inputs.length === after.inputs.length && file.graphics.titlePresets.length === 2, `${file.inputs.length} inputs`);
  ok('no stream keys in the show file', file.stream && file.stream.destinations.every(x => !x.key && !x.passphrase));
  await p.click('.modal-foot .btn-primary');

  // --- new show: back to defaults
  await p.click('[data-action=show]'); await p.waitForSelector('.modal [data-show=new]');
  await p.click('.modal [data-show=new]'); await p.waitForFunction(() => document.querySelectorAll('.modal-backdrop').length === 2);
  await Promise.all([p.waitForEvent('load'), p.click('.modal-backdrop >> nth=-1 >> .modal-foot .btn-danger')]); await p.waitForTimeout(1500);
  const fresh = await st();
  ok('new show has the default inputs', fresh.inputs.map(i => i.type).join(',') === 'slate,bars,clock,black', fresh.inputs.map(i => i.type).join(','));
  await p.waitForTimeout(2000);
  ok('unused media removed from browser storage', await p.evaluate(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('webmix-media'); for await (const _ of d.entries()) return false; return true; }));

  // --- open the show file on a "different machine" (media files are not inside the show file)
  await p.click('[data-action=show]'); await p.waitForSelector('.modal [data-show=import]');
  const fc = p.waitForEvent('filechooser'); await p.click('.modal [data-show=import]'); await (await fc).setFiles(S + '/show.webmix.json');
  await p.waitForFunction(() => document.querySelectorAll('.modal-backdrop').length === 2);
  await Promise.all([p.waitForEvent('load'), p.click('.modal-backdrop >> nth=-1 >> .modal-foot .btn-danger')]); await p.waitForTimeout(3000);
  const imp = await st();
  ok('imported show inputs', JSON.stringify(imp.inputs.map(i => i.name)) === JSON.stringify(after.inputs.map(i => i.name)), imp.inputs.map(i => i.name).join(', '));
  const vm = imp.inputs.find(i => i.type === 'media');
  ok('missing video waits for relink', vm.missing && vm.status !== 'live', JSON.stringify(vm));
  ok('relink button shown on its card', !!(await p.$(`#inputs-grid .card[data-id="${vm.id}"] [data-card=relink]`)));
  ok('show name kept', await p.evaluate(() => window.webmix.show.name) === 'ข่าวค่ำ');
  // relink the video
  const fc2 = p.waitForEvent('filechooser'); await p.click(`#inputs-grid .card[data-id="${vm.id}"] [data-card=relink]`); await (await fc2).setFiles(S + '/clip.webm');
  await p.waitForTimeout(1500);
  const rl = (await st()).inputs.find(i => i.id === vm.id);
  ok('relinked video plays', rl.status === 'live' && !rl.missing && rl.ready >= 2, JSON.stringify(rl));
  ok('relink button gone', !(await p.$(`#inputs-grid .card[data-id="${vm.id}"] [data-card=relink]`)));
  ok('relinked audio keeps saved settings', (await st()).ch.find(c => c.inputId === vm.id)?.db === -12);

  // --- a reload in the middle of the show keeps the relinked file
  await p.waitForTimeout(2000); await p.reload(); await p.waitForTimeout(2500);
  const again = (await st()).inputs.find(i => i.id === vm.id);
  ok('relinked file survives another reload', again && again.status === 'live' && !again.missing, JSON.stringify(again));

  // --- bad file
  await p.click('[data-action=show]'); await p.waitForSelector('.modal [data-show=import]');
  fs.writeFileSync(S + '/not-a-show.json', '{"hello":1}');
  const fc3 = p.waitForEvent('filechooser'); await p.click('.modal [data-show=import]'); await (await fc3).setFiles(S + '/not-a-show.json');
  await p.waitForTimeout(500);
  ok('rejects a file that is not a show', /ไม่ใช่ไฟล์โชว์/.test(await p.textContent('#toasts')));

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
