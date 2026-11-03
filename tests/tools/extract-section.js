#!/usr/bin/env node
// ย้ายส่วนหนึ่งของ assets/app.js ไปเป็นโมดูลใน assets/js/ อย่างปลอดภัย (เครื่องมือสำหรับนักพัฒนา ไม่ได้รันในชุดทดสอบ)
//
//   node tests/tools/extract-section.js <บรรทัดหัวข้อของส่วน> <ไฟล์ใหม่ เช่น widgets> <ชื่อ factory เช่น createWidgets> [--write]
//
// ส่วน = จากบรรทัดหัวข้อ (คอมเมนต์ "/* ---" ระดับบนสุด) ถึงก่อนหัวข้อถัดไป
// กติกา (ให้ผลเหมือนเดิมทุกอย่าง):
//   - ชื่อจาก window.WebMix → โมดูลดึงจาก WebMix เอง
//   - function ของ app.js (hoisted) → ส่งตรงใน ctx
//   - const / let ของ app.js → ส่งเป็น getter (setter ด้วยถ้าส่วนนี้กำหนดค่าใหม่) และโมดูลอ่านผ่าน studio.ชื่อ
//     (ชื่อ studio ไม่ใช่ ctx — ctx ของแคนวาสในฟังก์ชันย่อยจะบังพารามิเตอร์)
//     จึงไม่อ่านก่อนประกาศ (TDZ) และได้ค่าล่าสุดเสมอ
//   - ชื่อที่ส่วนอื่นใช้ → โมดูลคืนค่าออกมา แล้ว app.js รับไว้ด้วยชื่อเดิม
// ไม่ปลอดภัยแล้วหยุด (ไม่เขียนไฟล์): ส่วนอื่นเรียกชื่อที่คืนค่าทันทีตอนโหลดก่อนถึงส่วนนี้ ·
//   ส่วนนี้กำหนดค่าใหม่ให้ let ของตัวเองที่ส่วนอื่นใช้ · ใช้ this / arguments ระดับบนสุด
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const [lineArg, file, factory, write] = process.argv.slice(2);
if (!lineArg || !file || !factory) { console.error('ใช้: extract-section.js <บรรทัด> <ไฟล์> <factory> [--write]'); process.exit(2); }
const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'assets/app.js');
const src = fs.readFileSync(APP, 'utf8');
const lines = src.split('\n');
const ast = acorn.parse(src, { ecmaVersion: 2023, locations: true, ranges: true });
const body = ast.body[0].expression.callee.body.body;

// --- ขอบเขตของส่วน
const startLine = +lineArg;
if (!/^ {2}\/\* (-{3,}|---- )/.test(lines[startLine - 1] || '')) throw new Error(`บรรทัด ${startLine} ไม่ใช่หัวข้อของส่วน`);
let endLine = lines.length;
for (let i = startLine; i < lines.length; i++) if (/^ {2}\/\* (-{3,}|={3,}|---- )/.test(lines[i]) && !/^ {2}\/\* =+ \*\/$/.test(lines[i])) { endLine = i; break; }
const inSec = n => n.loc.start.line >= startLine && n.loc.end.line <= endLine;
const secStmts = body.filter(inSec);
if (body.some(st => !inSec(st) && st.loc.start.line < endLine && st.loc.end.line >= startLine)) throw new Error('มีคำสั่งคร่อมขอบของส่วน');

// --- ชื่อระดับบนสุดของ app.js
const decl = new Map(); // name -> { kind: 'function' | 'const' | 'let' | 'wm', line, inSection }
const wmAlias = new Map(); // ชื่อใน app.js -> ชื่อใน WebMix
const pat = (p, f) => { if (!p) return; if (p.type === 'Identifier') f(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(q => pat(q.value || q.argument, f)); else if (p.type === 'ArrayPattern') p.elements.forEach(q => pat(q, f)); else if (p.type === 'AssignmentPattern') pat(p.left, f); else if (p.type === 'RestElement') pat(p.argument, f); };
for (const st of body) {
  const where = { line: st.loc.start.line, inSection: inSec(st) };
  if (st.type === 'FunctionDeclaration') decl.set(st.id.name, { kind: 'function', ...where });
  else if (st.type === 'ClassDeclaration') decl.set(st.id.name, { kind: 'const', ...where });
  else if (st.type === 'VariableDeclaration') {
    for (const d of st.declarations) {
      const fromWM = d.init && d.init.type === 'MemberExpression' && d.init.object.name === 'window' && d.init.property.name === 'WebMix';
      // ชื่อที่เปลี่ยนตอนดึงจาก WebMix (เช่น chat: chatLib) — โมดูลต้องดึงด้วยชื่อเดิมของ WebMix
      if (fromWM && d.id.type === 'ObjectPattern') for (const q of d.id.properties) if (q.key && q.value && q.value.type === 'Identifier' && q.key.name !== q.value.name) wmAlias.set(q.value.name, q.key.name);
      pat(d.id, n => decl.set(n, { kind: fromWM ? 'wm' : st.kind, ...where }));
    }
  }
}

// --- ทุกจุดที่อ้างถึงชื่อระดับบนสุด: ใคร อยู่ในฟังก์ชันหรือไม่ เป็นการกำหนดค่าหรือไม่
// (ชื่อที่ประกาศซ้ำในขอบเขตย่อยถือว่าเป็นคนละตัว — ตรวจด้วยการไล่ขอบเขตแบบง่าย)
const refs = [];
function scopeNames(node) {
  const s = new Set();
  const add = p => pat(p, n => s.add(n));
  if (/Function/.test(node.type)) { node.params.forEach(add); if (node.type === 'FunctionExpression' && node.id) s.add(node.id.name); }
  if (node.type === 'CatchClause' && node.param) add(node.param);
  const bodyOf = node.type === 'BlockStatement' || node.type === 'Program' ? node.body : /Function/.test(node.type) && node.body.type === 'BlockStatement' ? node.body.body : null;
  if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') { const d = node.init || node.left; if (d && d.type === 'VariableDeclaration') d.declarations.forEach(x => add(x.id)); }
  if (bodyOf) for (const st of bodyOf) {
    if (st.type === 'FunctionDeclaration') s.add(st.id.name);
    if (st.type === 'ClassDeclaration') s.add(st.id.name);
    if (st.type === 'VariableDeclaration') st.declarations.forEach(x => add(x.id));
  }
  // var ภายในฟังก์ชัน (ไม่มีใน repo นี้ — lint ห้าม var)
  return s;
}
const iife = ast.body[0].expression.callee;
const declNodes = new Set();
for (const st of body) {
  if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') declNodes.add(st.id);
  if (st.type === 'VariableDeclaration') for (const d of st.declarations) walk.full(d.id, x => { if (x.type === 'Identifier') declNodes.add(x); });
}
walk.fullAncestor(ast, (n, anc) => {
  if (n.type !== 'Identifier' || !decl.has(n.name)) return;
  const p = anc[anc.length - 2];
  if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
  if (p && (p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key === n && !p.computed && !(p.shorthand && p.value === n)) return;
  if (p && (p.type === 'LabeledStatement' || p.type === 'BreakStatement' || p.type === 'ContinueStatement')) return;
  // เงาของชื่อในขอบเขตย่อย (ใต้ IIFE)
  const i0 = anc.indexOf(iife);
  for (let i = anc.length - 2; i > i0 + 1; i--) if (scopeNames(anc[i]).has(n.name)) return;
  if (declNodes.has(n)) return; // ตัวประกาศระดับบนสุดเอง
  const inFn = anc.slice(i0 + 1, -1).some(a => /Function/.test(a.type));
  const assigned = p && ((p.type === 'AssignmentExpression' && p.left === n) || p.type === 'UpdateExpression');
  refs.push({ name: n.name, node: n, line: n.loc.start.line, inSection: n.loc.start.line >= startLine && n.loc.start.line <= endLine, inFn, assigned, parent: p });
});

const own = new Set([...decl].filter(([, d]) => d.inSection).map(([k]) => k));
const secRefs = refs.filter(r => r.inSection && !own.has(r.name));
const outRefs = refs.filter(r => !r.inSection && own.has(r.name));
const wm = [...new Set(secRefs.filter(r => decl.get(r.name).kind === 'wm').map(r => r.name))].sort();
const fns = [...new Set(secRefs.filter(r => decl.get(r.name).kind === 'function').map(r => r.name))].sort();
const vals = [...new Set(secRefs.filter(r => ['const', 'let'].includes(decl.get(r.name).kind)).map(r => r.name))].sort();
const setters = new Set(secRefs.filter(r => r.assigned).map(r => r.name));
const exported = [...new Set(outRefs.map(r => r.name))].sort();

// --- ตรวจความปลอดภัย
const problems = [];
walk.full({ type: 'Program', body: secStmts }, n => { if (n.type === 'Identifier' && n.name === 'studio') problems.push(`บรรทัด ${n.loc.start.line}: ใช้ชื่อ studio อยู่แล้ว (ชนกับพารามิเตอร์ของโมดูล)`); });
for (const r of outRefs) if (r.line < startLine && !r.inFn) problems.push(`บรรทัด ${r.line}: ใช้ "${r.name}" ทันทีตอนโหลด ก่อนถึงส่วนนี้`);
for (const n of exported) if (decl.get(n).kind === 'let' && refs.some(r => r.name === n && r.assigned)) problems.push(`"${n}" เป็น let ที่ถูกกำหนดค่าใหม่ แต่ส่วนอื่นใช้ด้วย — ต้องแยกเอง`);
for (const n of exported) if (refs.some(r => r.name === n && r.assigned && !r.inSection)) problems.push(`ส่วนอื่นกำหนดค่าใหม่ให้ "${n}"`);
for (const n of setters) if (decl.get(n).kind === 'const') problems.push(`กำหนดค่าให้ const "${n}"`);
walk.fullAncestor({ type: 'Program', body: secStmts }, (n, anc) => {
  if ((n.type === 'ThisExpression' || (n.type === 'Identifier' && n.name === 'arguments')) && !anc.some(a => /^Function/.test(a.type) || a.type === 'ObjectExpression')) problems.push(`บรรทัด ${n.loc.start.line}: ใช้ ${n.type === 'ThisExpression' ? 'this' : 'arguments'} ระดับบนสุด`);
});

console.log(`ส่วน ${startLine}–${endLine} (${endLine - startLine + 1} บรรทัด) → assets/js/${file}.js · ${factory}`);
console.log(`  จาก WebMix: ${wm.map(n => wmAlias.has(n) ? `${wmAlias.get(n)}: ${n}` : n).join(', ') || '-'}`);
console.log(`  ฟังก์ชันจาก app.js: ${fns.join(', ') || '-'}`);
console.log(`  ค่าจาก app.js (ctx.ชื่อ): ${vals.map(v => v + (setters.has(v) ? ' (อ่าน/เขียน)' : '')).join(', ') || '-'}`);
console.log(`  คืนค่าให้ app.js: ${exported.join(', ') || '-'}`);
if (problems.length) { console.log('ไม่ปลอดภัย:\n  ' + [...new Set(problems)].join('\n  ')); process.exit(1); }
if (write !== '--write') process.exit(0);

// --- เขียนโมดูล: แทนชื่อค่าด้วย ctx.ชื่อ (ไล่จากท้ายไฟล์ ตำแหน่งไม่เลื่อน)
const secStart = lines.slice(0, startLine - 1).join('\n').length + 1;
const secEnd = lines.slice(0, endLine).join('\n').length;
let code = src.slice(secStart, secEnd);
const edits = secRefs.filter(r => vals.includes(r.name)).map(r => {
  const shorthand = r.parent && r.parent.type === 'Property' && r.parent.shorthand;
  return { at: r.node.start - secStart, len: r.node.end - r.node.start, text: shorthand ? `${r.name}: studio.${r.name}` : `studio.${r.name}` };
}).sort((a, b) => b.at - a.at);
for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at + e.len);
// หัวข้อของส่วน → หัวไฟล์
const codeLines = code.split('\n');
let h = 0; while (!codeLines[h].includes('*/')) h++;
const header = codeLines.slice(0, h + 1).map(l => l.replace(/^ {2}/, '')).map(l => l.replace(/^\/\* (?:-+ |---- )?/, '/* ').replace(/ ?-{2,} ?\*\/$/, ' */'));
const rest = codeLines.slice(h + 1).map(l => (l.trim() ? '  ' + l : l)).join('\n').replace(/\s+$/, '');
const ctxDoc = [...fns, ...vals].join(', ');
const out = `${header.join('\n')}
(function (WM) {
  'use strict';${wm.length ? `\n  const { ${wm.map(n => wmAlias.has(n) ? `${wmAlias.get(n)}: ${n}` : n).join(', ')} } = WM;` : ''}

  // studio = สิ่งที่ใช้จากสตูดิโอ (app.js): ${ctxDoc || '-'}
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน studio.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.${factory} = function (studio) {${fns.length ? `\n    const { ${fns.join(', ')} } = studio;` : ''}
${rest}

    return { ${exported.join(', ')} };
  };
})(window.WebMix = window.WebMix || {});
`;
fs.writeFileSync(path.join(ROOT, 'assets/js', file + '.js'), out);

// --- app.js: แทนทั้งส่วนด้วยการสร้างโมดูล
const title = lines[startLine - 1].replace(/^ {2}\/\* (?:-+ |---- )?/, '').replace(/ ?-* ?\*\/$/, '').replace(/ -+$/, '').trim();
const ctxProps = [
  ...fns,
  ...vals.map(v => setters.has(v) ? `get ${v}() { return ${v}; }, set ${v}(x) { ${v} = x; }` : `get ${v}() { return ${v}; }`)
];
const wrap = (items, indent) => { const outL = []; let cur = indent; for (const it of items) { if (cur.length + it.length + 2 > 150 && cur.trim()) { outL.push(cur.replace(/ $/, '')); cur = indent; } cur += it + ', '; } outL.push(cur.replace(/, $/, '')); return outL.join('\n'); };
const call = [
  `  /* ---- ${title.split(/\s[:—(]/)[0]} → assets/js/${file}.js ---- */`,
  `  const { ${exported.join(', ')} } = window.WebMix.${factory}({`,
  wrap(ctxProps, '    '),
  '  });'
];
const before = lines.slice(0, startLine - 1), after = lines.slice(endLine);
fs.writeFileSync(APP, [...before, ...call, ...after].join('\n'));
console.log(`เขียน assets/js/${file}.js แล้ว · app.js สั้นลง ${endLine - startLine + 1 - call.length} บรรทัด`);
