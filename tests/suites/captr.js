// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// คำบรรยายแปลภาษา (design 69): Translator API จำลอง — ต้องดาวน์โหลดภาษา → พร้อม · ต้นฉบับ+คำแปลบนจอ · คำแปลอย่างเดียว ·
// .srt คำแปล · เบราว์เซอร์ที่ไม่มีตัวแปล = แสดงต้นฉบับอย่างเดียว
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };
const fakeSR = () => {
  window.__sr = [];
  class FakeSR { constructor() { window.__sr.push(this); } start(t) { this.track = t || null; } stop() { setTimeout(() => this.onend && this.onend(), 10); } abort() { this.stop(); } }
  window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
  window.__say = (text, final) => { const r = window.__sr[window.__sr.length - 1]; const res = [{ transcript: text }]; res.isFinal = final; r.onresult({ resultIndex: 0, results: [res] }); };
};
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx.addInitScript(fakeSR);
  await ctx.addInitScript(() => {
    const DICT = { 'สวัสดีครับ ยินดีต้อนรับ': 'Hello, welcome.', 'ปีนี้เราตั้งเป้าลดการใช้พลังงาน': 'This year we aim to cut energy use.' };
    window.__trState = 'downloadable'; window.__trCreated = 0;
    window.Translator = {
      async availability(o) { window.__trPair = o.sourceLanguage + '>' + o.targetLanguage; return window.__trState; },
      async create(o) {
        window.__trCreated++;
        if (window.__trState !== 'available') { const m = new EventTarget(); o.monitor && o.monitor(m); m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.5 })); await new Promise(r => setTimeout(r, 300)); window.__trState = 'available'; }
        return { translate: async t => { await new Promise(r => setTimeout(r, 50)); return DICT[t] || `[en] ${t}`; } };
      }
    };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);

  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("คำบรรยายสด")');
  await p.waitForSelector('.modal select[name=tr]');
  ok('translation off by default', await p.inputValue('.modal select[name=tr]') === '' && /ไม่แปล/.test(await p.textContent('.cp-tr')));
  await p.selectOption('.modal select[name=tr]', 'en');
  ok('needs a one-time language download', await until(() => p.evaluate(() => /ดาวน์โหลดภาษา English/.test(document.querySelector('.cp-tr').textContent))), await p.textContent('.cp-tr'));
  ok('checks the th → en pair', await p.evaluate(() => window.__trPair === 'th>en'));
  await p.click('[data-cap=dl]');
  ok('download finishes, ready on this device', await until(() => p.evaluate(() => /ในเครื่องนี้/.test(document.querySelector('.cp-tr').textContent) && /พร้อมใช้/.test(document.querySelector('.cp-tr').textContent))), await p.textContent('.cp-tr'));
  ok('display mode defaults to original + translation', await p.getAttribute('.modal input[name=show]:checked', 'value') === 'both');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const inpState = () => p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'captions'); return { cap: i.cap, log: i.capRun?.log || [], tr: i.capRun?.trLines || [] }; });
  ok('saved with tr=en', (await inpState()).cap.tr === 'en', JSON.stringify((await inpState()).cap));

  await p.evaluate(() => { const w = window.webmix; const i = w.inputs.find(x => x.type === 'captions'); w.state.previewId = i.id; w.cut(); });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.__say('สวัสดีครับ ยินดีต้อนรับ', true));
  ok('final sentence translated', await until(async () => (await inpState()).tr.includes('Hello, welcome.')), JSON.stringify(await inpState()));
  ok('log keeps the translation alongside', (await inpState()).log[0]?.tr === 'Hello, welcome.');
  // บนจอมีสองแถว: ต้นฉบับตัวเล็กสีเทา + คำแปลตัวขาว
  const rows = () => p.evaluate(() => {
    const c = document.getElementById('pgm-canvas'), g = c.getContext('2d');
    const y0 = Math.round(c.height * 0.6), d = g.getImageData(0, y0, c.width, Math.round(c.height * 0.36)).data, W = c.width;
    let white = 0, grey = 0;
    for (let i = 0; i < d.length; i += 4) { const [r, gg, bb] = [d[i], d[i + 1], d[i + 2]]; if (r > 235 && gg > 235 && bb > 235) white++; else if (r > 170 && r < 225 && Math.abs(r - bb) < 30 && gg > 170) grey++; }
    return { white, grey };
  });
  await p.waitForTimeout(500);
  const both = await rows();
  ok('original + translation drawn (grey + white rows)', both.white > 200 && both.grey > 80, JSON.stringify(both));
  await p.screenshot({ path: S + '/captr-both.png' });
  await p.evaluate(() => { window.webmix.inputs.find(x => x.type === 'captions').cap.show = 'tr'; });
  await p.waitForTimeout(500);
  const trOnly = await rows();
  ok('translation-only drops the original row', trOnly.white > 200 && trOnly.grey < both.grey / 3, JSON.stringify(trOnly));

  // .srt คำแปล
  await p.evaluate(() => window.__say('ปีนี้เราตั้งเป้าลดการใช้พลังงาน', true));
  await until(async () => (await inpState()).tr.length === 2);
  await p.evaluate(() => document.querySelector('.card:has(.mini[data-card=cap]) [data-card=rename]').click());
  await p.waitForSelector('.cp-modal');
  ok('dialog lists translations under each line', /This year we aim/.test(await p.textContent('.cp-log')));
  ok('translated .srt offered', await p.isVisible('.cap-srt-tr'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.cap-srt-tr')]);
  const srt = fs.readFileSync(await dl.path(), 'utf8');
  ok('translated .srt contains English lines', /Hello, welcome\./.test(srt) && /This year we aim/.test(srt) && !/สวัสดี/.test(srt) && /-en-/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await p.screenshot({ path: S + '/captr-dialog.png' });
  await p.click('.modal-foot .btn:has-text("ยกเลิก")');

  // เบราว์เซอร์ที่ไม่มีตัวแปล
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx2.addInitScript(fakeSR);
  await ctx2.addInitScript(() => { try { delete window.Translator; } catch (e) {} window.Translator = undefined; });
  const q = await ctx2.newPage(); q.on('pageerror', e => errs.push('q ' + e.message));
  await q.goto('http://localhost:8765/index.html'); await q.waitForTimeout(600);
  await q.click('[data-action=add-menu]'); await q.click('.menu button:has-text("คำบรรยายสด")');
  await q.waitForSelector('.modal select[name=tr]');
  await q.selectOption('.modal select[name=tr]', 'en');
  ok('no built-in translator: says original only', await until(() => q.evaluate(() => /ไม่มีตัวแปลภาษาในตัว/.test(document.querySelector('.cp-tr').textContent))), await q.textContent('.cp-tr'));
  await q.click('.modal-foot .btn-primary'); await q.waitForTimeout(300);
  await q.evaluate(() => { const w = window.webmix; const i = w.inputs.find(x => x.type === 'captions'); i.cap.show = 'tr'; w.state.previewId = i.id; w.cut(); });
  await q.waitForTimeout(600);
  await q.evaluate(() => window.__say('สวัสดีครับ', true)); await q.waitForTimeout(600);
  const white = await q.evaluate(() => { const c = document.getElementById('pgm-canvas'), d = c.getContext('2d').getImageData(0, Math.round(c.height * 0.7), c.width, Math.round(c.height * 0.26)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++; return n; });
  ok('falls back to showing the original text', white > 200, String(white));

  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
