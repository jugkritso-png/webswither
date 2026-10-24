// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// คำบรรยายสด: จำลอง SpeechRecognition (Chromium ของชุดทดสอบไม่มีบริการแปลงเสียง) — ข้อความขึ้นจอ · ส่วนที่กำลังพูด · เงียบแล้วหาย ·
// เริ่มใหม่เองเมื่อเบราว์เซอร์หยุดฟัง · ฟังจากช่องในมิกเซอร์ · ไม่อนุญาตไมค์ = หยุดพร้อมบอกเหตุผล · ดาวน์โหลด .srt · บันทึกกับโชว์ · Macro
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await ctx.addInitScript(() => {
    window.__sr = [];
    class FakeSR {
      constructor() { this.started = false; window.__sr.push(this); }
      start(track) { this.started = true; this.track = track || null; }
      stop() { this.stopped = true; setTimeout(() => this.onend && this.onend(), 10); }
      abort() { this.stop(); }
    }
    window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
    // ส่งผลการรู้จำเสียงให้ตัวที่ทำงานอยู่ล่าสุด
    window.__say = (text, final) => {
      const r = window.__sr[window.__sr.length - 1];
      const res = [{ transcript: text }]; res.isFinal = final;
      r.onresult({ resultIndex: 0, results: [res] });
    };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);

  await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("คำบรรยายสด")');
  await p.waitForSelector('.modal select[name=lang]');
  ok('dialog defaults to Thai, main mic, 2 lines', await p.inputValue('.modal select[name=lang]') === 'th-TH' && await p.inputValue('.modal select[name=source]') === 'mic' && await p.inputValue('.modal select[name=lines]') === '2');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const st = () => p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'captions'); const r = i.capRun || {}; return { on: !!r.on, lines: r.lines || [], interim: r.interim || '', n: window.__sr.length, lang: window.__sr.length ? window.__sr[window.__sr.length - 1].lang : '', track: !!(window.__sr.length && window.__sr[window.__sr.length - 1].track), err: r.error || '' }; });
  let s = await st();
  ok('saving the new source starts listening (continuous, interim, th-TH)', s.on && s.n === 1 && s.lang === 'th-TH' && await p.evaluate(() => window.__sr[0].continuous && window.__sr[0].interimResults), JSON.stringify(s));
  ok('card shows the play/pause control and "listening"', await p.locator('.card [data-card=cap].is-on').count() === 1 && (await p.locator('.card', { hasText: 'CAPTIONS' }).textContent()).includes('กำลังฟัง'));

  // ขึ้นจอเต็มจอ: ตัดเข้า Program
  await p.evaluate(() => { const w = window.webmix; const i = w.inputs.find(x => x.type === 'captions'); w.state.previewId = i.id; w.cut(); });
  await p.waitForTimeout(1200);
  const whiteBottom = () => p.evaluate(() => {
    const c = document.getElementById('pgm-canvas'), g = c.getContext('2d');
    const d = g.getImageData(0, Math.round(c.height * 0.72), c.width, Math.round(c.height * 0.22)).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++;
    return n;
  });
  ok('nothing on screen before anyone speaks', await whiteBottom() < 20);
  await p.evaluate(() => window.__say('สวัสดีครับ ยินดีต้อนรับ', false)); await p.waitForTimeout(500);
  s = await st();
  const w1 = await whiteBottom();
  ok('interim words show while speaking', s.interim === 'สวัสดีครับ ยินดีต้อนรับ' && w1 > 200, `${s.interim} · ${w1}px`);
  await p.evaluate(() => window.__say('สวัสดีครับ ยินดีต้อนรับสู่รายการ', true)); await p.waitForTimeout(400);
  s = await st();
  ok('final sentence kept, interim cleared', s.lines.length === 1 && s.interim === '' && s.lines[0].includes('สู่รายการ'), JSON.stringify(s.lines));
  await p.screenshot({ path: S + '/captions.png' });
  // ประโยคยาว → ตัดบรรทัด แสดงไม่เกิน 2 บรรทัด
  const shown = await p.evaluate(() => {
    const i = window.webmix.inputs.find(x => x.type === 'captions');
    for (let k = 0; k < 4; k++) window.__say('วันนี้เรามีแขกรับเชิญพิเศษมาพูดคุยเรื่องเทคโนโลยีการถ่ายทอดสดและการผลิตรายการออนไลน์ด้วยอุปกรณ์ราคาประหยัด', true);
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); g.font = '600 36px sans-serif';
    return { n: window.WebMix.chat.wrapLines(g, 'ทดสอบ', 1000, 50).length, lines: i.cap.lines };
  });
  ok('long speech limited to the set number of lines', shown.lines === 2);
  // เงียบเกินเวลา → หาย
  await p.evaluate(() => { window.webmix.inputs.find(x => x.type === 'captions').cap.clearSec = 2; });
  await p.waitForTimeout(2600);
  ok('captions clear after silence', await whiteBottom() < 20);

  // เบราว์เซอร์หยุดฟังเอง → เริ่มใหม่
  await p.evaluate(() => window.__sr[window.__sr.length - 1].onend()); await p.waitForTimeout(600);
  s = await st();
  ok('restarts by itself when the browser stops listening', s.n === 2 && s.on, JSON.stringify(s));

  // ฟังจาก Master ของมิกเซอร์ → ส่ง MediaStreamTrack ให้ตัวรู้จำเสียง
  await p.locator('.card', { hasText: 'CAPTIONS' }).locator('[data-card=rename]').click();
  await p.waitForSelector('.modal select[name=source]');
  await p.selectOption('.modal select[name=source]', 'master'); await p.selectOption('.modal select[name=lang]', 'en-US');
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(600);
  s = await st();
  ok('changing language/source restarts with a mixer track', s.on && s.lang === 'en-US' && s.track && await p.evaluate(() => window.__sr[window.__sr.length - 1].track.kind === 'audio'), JSON.stringify(s));

  // ดาวน์โหลด .srt
  await p.locator('.card', { hasText: 'CAPTIONS' }).locator('[data-card=rename]').click();
  await p.waitForSelector('.modal .cap-srt');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.modal .cap-srt')]);
  const srt = fs.readFileSync(await dl.path(), 'utf8');
  ok('transcript downloads as .srt with timings', /\.srt$/.test(dl.suggestedFilename()) && /^1\n00:00:0\d,\d{3} --> 00:00:\d\d,\d{3}\nสวัสดีครับ/.test(srt) && srt.split('\n\n').length >= 5, srt.slice(0, 80));
  await p.keyboard.press('Escape');

  // หยุดจากการ์ด → ไม่เริ่มใหม่เอง
  await p.click('.card [data-card=cap]'); await p.waitForTimeout(400);
  s = await st();
  ok('pause button stops listening and stays stopped', !s.on && s.n === 3 && await p.evaluate(() => window.__sr[2].stopped), JSON.stringify(s));
  // Macro เปิดได้ · ไม่อนุญาตไมค์ → หยุดพร้อมบอกเหตุผล
  await p.evaluate(async () => { const w = window.webmix; w.macros.push({ id: 'mc', name: 'cap', key: '', at: '', steps: [{ a: 'capOn', v: '' }] }); await w.runMacro(w.macros[0]); });
  await p.waitForTimeout(300);
  ok('macro step starts captions', (await st()).on);
  await p.evaluate(() => window.__sr[window.__sr.length - 1].onerror({ error: 'not-allowed' })); await p.waitForTimeout(400);
  s = await st();
  ok('mic permission denied → stops with a clear reason', !s.on && /ไม่ได้รับอนุญาต/.test(s.err) && (await p.locator('.card', { hasText: 'CAPTIONS' }).textContent()).includes('ไม่ได้รับอนุญาต'), JSON.stringify(s));

  const saved = await p.evaluate(() => window.webmix.show.serialize().inputs.find(i => i.type === 'captions').cap);
  ok('settings saved with the show', saved.lang === 'en-US' && saved.source === 'master' && saved.lines === 2, JSON.stringify(saved));
  await p.evaluate(() => window.webmix.show.autosave(true)); await p.reload(); await p.waitForTimeout(1200);
  ok('restored after reload, not listening until asked', await p.evaluate(() => { const i = window.webmix.inputs.find(x => x.type === 'captions'); return i && i.cap.lang === 'en-US' && !i.capRun && window.__sr.length === 0; }));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
