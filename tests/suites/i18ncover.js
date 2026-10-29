// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// คำแปลครบทุกข้อความ: ดึงข้อความไทยทุกก้อนจากโค้ด (สตริง / template / HTML) แล้วแปลด้วยพจนานุกรมจริงในหน้าเว็บ
// ก้อนไหนยังเหลือภาษาไทย = ลืมเพิ่มคำแปลใน assets/js/i18n-en.js → ไม่ผ่าน (ไม่ต้องเปิดหน้าต่างนั้นจริงก็จับได้)
// ${...} ใน template แทนด้วยตัวเลข · ข้อความที่ตั้งใจให้เป็นไทยเสมอ (เช่นตัวอย่างภาษา) ใส่ไว้ใน KEEP_THAI
const { chromium } = require('playwright');
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);

const TH = /[฀-๿]/;
const HOLE = '\u0002';
const KEEP_THAI = new Set(['ไทย', 'ภาษาไทย']);
const SKIP_JS = new Set(['i18n.js', 'i18n-en.js', 'gate-worklet.js', 'lufs-worklet.js']);
const files = ['index.html', 'cg-studio.html', 'assets/app.js',
  ...fs.readdirSync(path.join(ROOT, 'assets/js')).filter(f => f.endsWith('.js') && !SKIP_JS.has(f)).map(f => 'assets/js/' + f)];

const found = new Map();
const add = (s, file) => {
  s = s.replace(/\s+/g, ' ').trim();
  if (!TH.test(s) || KEEP_THAI.has(s) || /void main\(/.test(s)) return; // โค้ด shader มีคอมเมนต์ไทย
  if (!found.has(s)) found.set(s, new Set());
  found.get(s).add(file);
};
// ข้อความนอกแท็ก + ค่าในแอตทริบิวต์ที่ตัวแปลแปลให้
const fromHtmlish = (text, file) => {
  text = text.replace(/<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, '');
  for (const m of text.matchAll(/(?:title|placeholder|aria-label|alt|label)="([^"]*)"/g)) add(m[1], file);
  for (const seg of text.replace(/<[^>]*>/g, '\u0001').split('\u0001')) add(seg, file);
};
for (const file of files) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (file.endsWith('.html')) {
    // ป้ายที่ผู้ใช้ตั้งเอง/ไม่ต้องแปลมี translate="no" — ตัดทิ้งทั้งก้อน
    fromHtmlish(src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<(\w+)[^>]*translate="no"[^>]*>[\s\S]*?<\/\1>/g, ''), file);
    continue;
  }
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  walk.full(ast, n => {
    if (n.type === 'Literal' && typeof n.value === 'string') fromHtmlish(n.value, file);
    if (n.type === 'TemplateLiteral') fromHtmlish(n.quasis.map(q => q.value.cooked).join(HOLE), file);
  });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage();
  await p.goto('http://localhost:8765/index.html?lang=en');
  await p.waitForFunction(() => window.WebMix && window.WebMix.i18n && window.WebMix.i18n.lang === 'en');
  const list = [...found.keys()];
  const missing = await p.evaluate(({ list, HOLE, keep }) => {
    // คำแปลที่อ้างถึงปุ่ม "ภาษาไทย" (ตั้งใจคงเป็นไทย) ไม่นับ
    const strip = x => keep.reduce((a, k) => a.split(k).join(''), x);
    const { t } = window.WebMix.i18n, TH = /[฀-๿]/;
    return list.filter(s => TH.test(strip(t(s.split(HOLE).join('12')))));
  }, { list, HOLE, keep: [...KEEP_THAI].sort((a, b) => b.length - a.length) });
  ok(`every Thai string in the code has an English translation (${list.length} checked)`, missing.length === 0,
    missing.length ? `\n  ${missing.length} missing — add to assets/js/i18n-en.js:\n${missing.slice(0, 200).map(s => `    ${JSON.stringify(s.split(HOLE).join('{}'))}  (${[...found.get(s)].join(', ')})`).join('\n')}` : '');
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
