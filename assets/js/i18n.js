/* WebMix — เลือกภาษาหน้าจอ ไทย / English
   ข้อความต้นฉบับในโค้ดเป็นภาษาไทย · โหมด English แปลข้อความบนหน้าจอตอนแสดงผล (ไม่ต้องแก้ทุกจุดที่สร้างหน้าจอ):
   - ข้อความในหน้า (text node) และแอตทริบิวต์ title / placeholder / aria-label / alt / label
   - ข้อความที่มีค่าแทรก เช่น `ลบ “${name}” แล้ว` ใช้รูปแบบ "ลบ “{}” แล้ว" → "Deleted “{1}”"
   - ข้อความที่คั่นด้วย " · " แปลทีละส่วน
   - ส่วนที่ผู้ใช้พิมพ์เอง (ชื่อแหล่งภาพ ข้อความแชท ฯลฯ) อยู่ใน [translate="no"] — ไม่แปล
   สลับภาษาได้ทันทีโดยไม่โหลดหน้าใหม่ (ปลอดภัยระหว่างไลฟ์) — กลับเป็นไทยคืนข้อความต้นฉบับที่จำไว้
   คำเฉพาะของวงการ (PGM, PVW, CUT, AUTO, NDI, SRT …) เป็นภาษาอังกฤษในทั้งสองภาษา */
(function (WM) {
  'use strict';
  const KEY = 'webmix:lang';
  const TH = /[฀-๿]/;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'CODE', 'PRE']);

  let lang = 'th';
  try { if (localStorage.getItem(KEY) === 'en') lang = 'en'; } catch (e) {}
  const q = /[?&]lang=(en|th)\b/.exec(location.search);
  if (q) lang = q[1];

  // ---- พจนานุกรม ----
  let exact = null, pats = null;
  const cache = new Map();
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const EDGE = /^[\s—–·•:]+|[\s—–·•:]+$/g;
  function build() {
    exact = new Map(); pats = [];
    const d = WM.I18N_EN || {};
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (!v) continue;
      if (!k.includes('{}')) {
        exact.set(k, v);
        // ข้อความที่ถูกแยกตอนแปลทีละส่วนจะไม่มีเครื่องหมายหัว-ท้าย ("— ยังไม่ได้เลือก…" → "ยังไม่ได้เลือก…")
        const ck = k.replace(EDGE, ''), cv = v.replace(EDGE, '');
        if (ck && ck !== k && !d[ck] && !exact.has(ck)) exact.set(ck, cv);
        continue;
      }
      const raw = k.split('{}');
      const parts = raw.map(x => x.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&'));
      // ช่องที่อยู่ในเครื่องหมายคำพูด/วงเล็บ = ชื่อที่ผู้ใช้ตั้ง (รับอะไรก็ได้) · ช่องอื่นต้องเป็นตัวเลข/อังกฤษ หรือแปลได้
      const quoted = raw.slice(1).map((after, i) => /[“"'(‹«]$/.test(raw[i]) && /^[”"')›»]/.test(after));
      pats.push({ re: new RegExp('^' + parts.join('(.*?)') + '$'), v, n: parts.length - 1, quoted });
    }
    // คำยาวก่อน — รูปแบบที่เจาะจงกว่าชนะ
    pats.sort((a, b) => b.re.source.length - a.re.source.length);
  }
  function one(s) {
    if (exact.has(s)) return exact.get(s);
    for (const p of pats) {
      const m = p.re.exec(s);
      if (!m) continue;
      const caps = [];
      let fits = true;
      for (let i = 1; i <= p.n; i++) {
        const c = m[i] || '';
        const tc = p.quoted[i - 1] ? c : translate(c);
        // เช่น "เลือก {}" ต้องไม่กลืน "เลือก / ย้าย" (ส่วนที่เหลือเป็นไทยที่แปลไม่ได้ = รูปแบบนี้ไม่ใช่)
        if (!p.quoted[i - 1] && TH.test(tc)) { fits = false; break; }
        caps.push(tc);
      }
      if (!fits) continue;
      let out = p.v;
      for (let i = p.n; i >= 1; i--) out = out.split(`{${i}}`).join(caps[i - 1]);
      return out.replace(/ {2,}/g, ' ').trim();
    }
    return null;
  }
  // แปลข้อความหนึ่งก้อน (คงช่องว่างหัว-ท้ายไว้) · ไม่เจอทั้งก้อน → ลองทีละส่วนที่คั่นด้วย " · " / " — " / ": "
  function translate(s) {
    if (lang !== 'en' || !s || !TH.test(s)) return s;
    if (cache.has(s)) return cache.get(s);
    if (!exact) build();
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const core = norm(m[2]);
    let out = one(core);
    if (out == null) {
      for (const sep of [' · ', ' — ', ' – ', ' | ', ' → ']) {
        if (!core.includes(sep)) continue;
        const bits = core.split(sep);
        const tr = bits.map(b => (TH.test(b) ? one(b.trim()) ?? translateLoose(b.trim()) : b));
        if (tr.some(x => x == null)) continue;
        out = tr.join(sep);
        break;
      }
    }
    if (out == null) out = translateLoose(core);
    // สุดท้าย: แปลเฉพาะวงเล็บที่มีภาษาไทย เช่น "ANGLE (…) (เป็นการ์ดจอจำลอง…)"
    if (out == null && /\([^()]*[\u0E00-\u0E7F][^()]*\)/.test(core)) {
      let all = true;
      const r = core.replace(/\(([^()]*[\u0E00-\u0E7F][^()]*)\)/g, (m0, inner) => {
        const tr = one(m0) ?? one(inner.trim());
        if (tr == null) { all = false; return m0; }
        return /^\(.*\)$/.test(tr) ? tr : `(${tr})`;
      });
      if (all && !TH.test(r.replace(/\([^()]*\)/g, ''))) out = r;
    }
    const res = out == null ? s : m[1] + out + m[3];
    if (cache.size > 6000) cache.clear();
    cache.set(s, res);
    return res;
  }
  // ข้อความที่ลงท้าย/ขึ้นต้นด้วยเครื่องหมาย เช่น "ชื่อ:" "กำลังโหลด…" "(ไม่บังคับ)"
  function translateLoose(s) {
    const m = /^([(\[“"'•●▸›‹←→+\-–—*#]*\s*)([\s\S]*?)(\s*[)\]”"':：…!?.,;。]*)$/.exec(s);
    if (!m || (!m[1] && !m[3])) return null;
    const mid = one(m[2]);
    return mid == null ? null : m[1] + mid + m[3];
  }

  // ---- แปลหน้าจอ ----
  const origText = new WeakMap();   // text node → ข้อความไทยต้นฉบับ
  const origAttr = new WeakMap();   // element → { attr: ต้นฉบับ }
  const doneText = new WeakMap();   // text node → ข้อความที่เราเขียนลงไป (กันแปลซ้ำ)
  const skipEl = el => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || e.isContentEditable) return true;
      if (e.getAttribute('translate') === 'no') return true;
    }
    return false;
  };
  function doText(node) {
    const v = node.data;
    if (doneText.get(node) === v || !TH.test(v)) return;
    if (!node.parentElement || skipEl(node.parentElement)) return;
    const out = translate(v);
    origText.set(node, v);
    if (out !== v) { doneText.set(node, out); node.data = out; }
  }
  function doAttrs(el) {
    if (skipEl(el)) return;
    let o = origAttr.get(el);
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || !TH.test(v)) continue;
      if (o && o['$' + a] === v) continue;     // ค่าที่เราเขียนเอง
      const out = translate(v);
      if (out === v) continue;
      if (!o) { o = {}; origAttr.set(el, o); }
      o[a] = v; o['$' + a] = out;
      el.setAttribute(a, out);
    }
  }
  function doTree(root) {
    if (lang !== 'en' || !root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipEl(root)) return; doAttrs(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeType === 1 && (SKIP_TAGS.has(n.tagName) || n.getAttribute('translate') === 'no' || n.isContentEditable) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }
  const mo = new MutationObserver(recs => {
    if (lang !== 'en') return;
    for (const r of recs) {
      if (r.type === 'childList') r.addedNodes.forEach(doTree);
      else if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttrs(r.target);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  // กลับเป็นไทย: คืนข้อความต้นฉบับทุกจุดที่แปลไว้ (ข้อความที่โค้ดเขียนใหม่ภายหลังเป็นไทยอยู่แล้ว)
  function restoreTree(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 3) { const o = origText.get(n); if (o != null && doneText.get(n) === n.data) n.data = o; doneText.delete(n); }
      else if (n.nodeType === 1) { const o = origAttr.get(n); if (o) { for (const a of ATTRS) if (a in o && n.getAttribute(a) === o['$' + a]) n.setAttribute(a, o[a]); origAttr.delete(n); } }
    }
  }
  const listeners = new Set();
  function setLang(v) {
    v = v === 'en' ? 'en' : 'th';
    if (v === lang) return;
    lang = v;
    try { localStorage.setItem(KEY, v); } catch (e) {}
    document.documentElement.lang = v;
    cache.clear();
    if (v === 'en') doTree(document.documentElement); else restoreTree(document.documentElement);
    if (document.title) document.title = t(TITLE);
    listeners.forEach(fn => { try { fn(v); } catch (e) {} });
  }
  const t = s => translate(s);
  const TITLE = document.title;
  document.documentElement.lang = lang;
  if (lang === 'en') {
    document.title = translate(TITLE);
    const first = () => doTree(document.documentElement);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', first, { once: true }); else first();
  }

  WM.i18n = {
    get lang() { return lang; },
    setLang, t,
    onChange: fn => listeners.add(fn),
    // ตรวจความครบ (ชุดทดสอบ): ข้อความไทยที่ยังเหลืออยู่บนหน้าจอ
    leftovers(root = document.body) {
      const out = new Set();
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.nodeType === 1 && (SKIP_TAGS.has(n.tagName) || n.getAttribute('translate') === 'no') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
      });
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeType === 3) { if (TH.test(n.data) && n.parentElement && !skipEl(n.parentElement)) out.add(norm(n.data)); }
        else for (const a of ATTRS) { const v = n.getAttribute(a); if (v && TH.test(v)) out.add('@' + a + ': ' + norm(v)); }
      }
      return [...out];
    }
  };
})(window.WebMix = window.WebMix || {});
