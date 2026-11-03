// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// โมดูลใน assets/js/ ดึงของจากกันผ่าน window.WebMix (const { a, b: c } = WM) — ชื่อที่สะกดผิดหรือไม่มีอยู่จริง
// ได้ undefined เงียบ ๆ (lint จับไม่ได้) จนกว่าจะกดใช้ฟีเจอร์นั้น · ชุดนี้เปิดหน้าแล้วตรวจทุกชื่อว่ามีค่าจริง
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { chromium } = require('playwright');
const { ROOT } = require('../lib');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);

// ชื่อที่แต่ละไฟล์ดึงจาก WebMix: const { ... } = WM / = window.WebMix (ระดับไหนก็ได้ในไฟล์)
function namesFrom(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2023 });
  const out = [];
  walk.full(ast, n => {
    if (n.type !== 'VariableDeclarator' || !n.init || n.id.type !== 'ObjectPattern') return;
    const i = n.init;
    const isWM = (i.type === 'Identifier' && i.name === 'WM') || (i.type === 'MemberExpression' && i.object.name === 'window' && i.property.name === 'WebMix');
    if (!isWM) return;
    for (const p of n.id.properties) if (p.type === 'Property' && p.key.type === 'Identifier') out.push(p.key.name);
  });
  return out;
}

(async () => {
  // หน้าสตูดิโอโหลดไฟล์ไหนบ้าง (ตามลำดับใน index.html)
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="(assets\/[^"]+\.js)"/g)].map(m => m[1]);
  const wanted = new Map();
  for (const f of files) for (const n of namesFrom(path.join(ROOT, f))) { if (!wanted.has(n)) wanted.set(n, new Set()); wanted.get(n).add(f); }
  ok('found the modules and the names they import', files.length > 15 && wanted.size > 40, `${files.length} files, ${wanted.size} names`);

  // โมดูลที่แยกจาก app.js: ของที่ app.js ส่งให้ต้องอ่านผ่าน studio.ชื่อ — ถ้าเขียน ctx.ชื่อ ในฟังก์ชันที่มี ctx ของแคนวาส
  // จะได้ค่าจากแคนวาสแทน (เคยทำให้รีโมตคอนโทรลพัง)
  const appAst = acorn.parse(fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8'), { ecmaVersion: 2023 });
  const passed = new Map();
  walk.simple(appAst, { CallExpression(n) { const c = n.callee; if (c.type === 'MemberExpression' && /^create[A-Z]/.test(c.property.name || '') && n.arguments[0]?.type === 'ObjectExpression') passed.set(c.property.name, new Set(n.arguments[0].properties.map(q => q.key && q.key.name))); } });
  const wrong = [];
  for (const f of files) {
    const fast = acorn.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'), { ecmaVersion: 2023, locations: true });
    walk.simple(fast, { AssignmentExpression(a) {
      if (a.left.type !== 'MemberExpression' || a.left.object.name !== 'WM' || !passed.has(a.left.property.name)) return;
      const keys = passed.get(a.left.property.name);
      walk.simple(a.right, { MemberExpression(m) { if (m.object.type === 'Identifier' && m.object.name === 'ctx' && !m.computed && keys.has(m.property.name)) wrong.push(`${f}:${m.loc.start.line} ctx.${m.property.name}`); } });
    } });
  }
  ok('modules split from app.js read what app.js passes via studio.<name>, never ctx.<name>', passed.size >= 12 && wrong.length === 0, wrong.slice(0, 5).join(' · ') || `${passed.size} modules`);

  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => !!window.webmix, null, { timeout: 15000 });
  const missing = await p.evaluate(names => names.filter(n => window.WebMix[n] === undefined), [...wanted.keys()]);
  ok('every name a module takes from window.WebMix exists', missing.length === 0, missing.map(n => `${n} (${[...wanted.get(n)].join(', ')})`).join(' · '));
  // โมดูลที่แยกจาก app.js สร้างได้และคืนของที่ app.js ใช้
  const made = await p.evaluate(() => ['createPlaylist', 'createHighlights', 'createWidgets', 'createAiBackground', 'createSchedule', 'createWireless', 'createCaptions', 'createComments', 'createVirtualSet', 'createMacros', 'createRemoteControl', 'createNetSources'].filter(f => typeof window.WebMix[f] !== 'function'));
  ok('feature modules split from app.js are loaded', made.length === 0, made.join(', '));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await b.close();
  console.log(results.join('\n'));
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
