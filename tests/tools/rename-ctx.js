#!/usr/bin/env node
// เปลี่ยนชื่อพารามิเตอร์ของ factory ในโมดูล (WM.createX = function (ctx) {...}) จาก ctx เป็น studio
// ctx.ชื่อ ที่ชื่อนั้นเป็นของที่ app.js ส่งให้ (คีย์ใน WM.createX({...})) → studio.ชื่อ เสมอ แม้อยู่ในฟังก์ชันที่มี ctx
// ของแคนวาส (ซึ่งเป็นบั๊ก: ctx ของแคนวาสบังพารามิเตอร์) · ctx อื่น ๆ (ctx.fillRect ฯลฯ) ไม่ถูกแตะ
//   node tests/tools/rename-ctx.js assets/js/widgets.js [...]
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');
const FROM = 'ctx', TO = 'studio';
const path = require('path');
const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'assets/app.js'), 'utf8');
// คีย์ของ object ที่ app.js ส่งให้ factory แต่ละตัว
function passedKeys(factoryName) {
  const ast = acorn.parse(APP, { ecmaVersion: 2023 });
  let keys = null;
  walk.simple(ast, { CallExpression(n) {
    const c = n.callee;
    if (c.type === 'MemberExpression' && c.property.name === factoryName && n.arguments[0] && n.arguments[0].type === 'ObjectExpression') keys = new Set(n.arguments[0].properties.map(q => q.key.name));
  } });
  return keys;
}

function declares(node, name) {
  const s = new Set();
  const pat = p => { if (!p) return; if (p.type === 'Identifier') s.add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(q => pat(q.value || q.argument)); else if (p.type === 'ArrayPattern') p.elements.forEach(pat); else if (p.type === 'AssignmentPattern') pat(p.left); else if (p.type === 'RestElement') pat(p.argument); };
  if (/Function/.test(node.type)) node.params.forEach(pat);
  if (node.type === 'CatchClause') pat(node.param);
  if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') { const d = node.init || node.left; if (d && d.type === 'VariableDeclaration') d.declarations.forEach(x => pat(x.id)); }
  const list = node.type === 'BlockStatement' ? node.body : /Function/.test(node.type) && node.body.type === 'BlockStatement' ? node.body.body : null;
  if (list) for (const st of list) {
    if (st.type === 'VariableDeclaration') st.declarations.forEach(x => pat(x.id));
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') s.add(st.id.name);
  }
  return s.has(name);
}

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2023 });
  let factory = null;
  walk.simple(ast, { AssignmentExpression(n) { if (n.left.type === 'MemberExpression' && n.left.object.name === 'WM' && /^create/.test(n.left.property.name) && n.right.type === 'FunctionExpression') factory = n.right; } });
  if (!factory || factory.params.length !== 1 || factory.params[0].name !== FROM) { console.log(`${file}: ข้าม (ไม่มี factory(ctx))`); continue; }
  if (src.includes(TO)) throw new Error(`${file}: มีชื่อ ${TO} อยู่แล้ว`);
  let fname = '';
  walk.simple(ast, { AssignmentExpression(n) { if (n.right === factory) fname = n.left.property.name; } });
  const keys = passedKeys(fname);
  if (!keys) throw new Error(`${file}: ไม่พบ ${fname}({...}) ใน app.js`);
  const edits = [factory.params[0]];
  let shadowed = 0;
  const fixed = [];
  walk.fullAncestor(factory.body, (n, anc) => {
    if (n.type !== 'Identifier' || n.name !== FROM) return;
    const p = anc[anc.length - 2];
    if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
    if (p && p.type === 'Property' && p.key === n && !p.computed && !p.shorthand) return;
    // ctx.ชื่อ ที่ app.js ส่งให้ → ของ factory เสมอ (แม้มี ctx อื่นบังอยู่ — นั่นคือบั๊กที่แก้)
    if (p && p.type === 'MemberExpression' && p.object === n && !p.computed && keys.has(p.property.name)) {
      const hidden = anc.slice(0, -1).some(a => a !== factory.body && declares(a, FROM)) || declares(factory.body, FROM);
      if (hidden) fixed.push(`${p.property.name}`);
      edits.push(n); return;
    }
    // ชื่อนี้ถูกประกาศใหม่ในขอบเขตย่อยระหว่าง factory กับจุดนี้ → เป็นตัวอื่น (ของแคนวาส)
    for (let i = anc.length - 2; i >= 0; i--) if (anc[i] !== factory.body && declares(anc[i], FROM)) { shadowed++; return; }
    if (declares(factory.body, FROM)) { shadowed++; return; }
    edits.push(n);
  });
  let out = src;
  for (const n of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, n.start) + TO + out.slice(n.end);
  out = out.replace(/\/\/ ctx = สิ่งที่/g, `// ${TO} = สิ่งที่`).replace(/อ่านผ่าน ctx\.ชื่อ/g, `อ่านผ่าน ${TO}.ชื่อ`);
  fs.writeFileSync(file, out);
  console.log(`${file}: ${edits.length - 1} จุด → ${TO} · ctx ของแคนวาสคงเดิม ${shadowed} จุด${fixed.length ? ` · แก้ที่ถูกบัง: ${fixed.join(', ')}` : ''}`);
}
