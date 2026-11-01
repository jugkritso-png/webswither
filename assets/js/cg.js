/* WebMix CG document model + safe Canvas renderer. */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const MAX_SCENES = 30;
  const MAX_ELEMENTS = 500;
  const MAX_ELEMENTS_PER_SCENE = 100;
  const MAX_IMAGE_DATA = 3_000_000;
  const ALLOWED_FONTS = ['Inter', 'IBM Plex Sans Thai', 'system-ui', 'Arial', 'sans-serif'];
  const MOTIONS = ['cut', 'fade', 'zoom', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'wipe'];
  const LEGACY_TEMPLATES = ['lower-third', 'top-banner', 'live-bug', 'ticker', 'score-card', 'full-screen'];
  const uid = () => `cg-${Math.random().toString(36).slice(2, 10)}`;
  // ข้อความตัวอย่างของแบบใหม่ — ตามภาษาหน้าจอตอนสร้าง (ผู้ใช้แก้เองได้)
  const tr = s => (root.WebMix && root.WebMix.i18n ? root.WebMix.i18n.t(s) : s);
  const sanitizedCache = new WeakMap();
  let assetRevision = 0;
  const clamp = (value, min, max, fallback) => Number.isFinite(+value) ? Math.max(min, Math.min(max, +value)) : fallback;
  const cleanText = (value, max, fallback = '') => String(value ?? fallback).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
  const color = (value, fallback) => /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(String(value || '')) ? String(value) : fallback;
  // สีเดิม + ความโปร่ง (ใช้ไล่สีพื้นเทมเพลต) — สีที่ไม่ใช่ hex คืนค่าเดิม
  const withAlpha = (c, a) => {
    const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(c || '');
    if (!m) return c;
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  };
  const defaults = () => ({
    schemaVersion: SCHEMA_VERSION, id: uid(), name: tr('กราฟิกใหม่'), output: { width: 1920, height: 1080 }, activeSceneId: 'scene-main', playback: { in: 'fade', out: 'fade', durationMs: 500 },
    scenes: [{ id: 'scene-main', name: 'Lower Third', elements: templateElements('lower-third', { headline: tr('ชื่อผู้พูด'), subtitle: tr('หัวข้อ / ตำแหน่ง'), accent: '#ef4444', secondary: '#111827', text: '#ffffff' }) }]
  });
  function makeElement(type, name, x, y, width, height, style = {}, content = {}) {
    return { id: uid(), type, name, visible: true, locked: false, transform: { x, y, width, height, rotation: 0 }, style, content };
  }
  // เทมเพลตแบบงานข่าว / ถ่ายทอดสด: อยู่ในเขต Title Safe 90% (x 96–1824, y 54–1026) · พื้นไล่สีโปร่งเล็กน้อย · แถบสีเน้น
  // ตัวอักษรย่อให้พอดีช่อง (ไม่บีบให้ผิดรูป) และอยู่กึ่งกลางแนวตั้ง · คำกำกับตัวพิมพ์ใหญ่ เว้นระยะตัวอักษร
  function templateElements(template, v = {}) {
    const accent = color(v.accent, '#e11d2e'), secondary = color(v.secondary, '#0f172a'), text = color(v.text, '#ffffff');
    const headline = cleanText(v.headline, 100, tr('ชื่อผู้พูด')), subtitle = cleanText(v.subtitle, 140, tr('หัวข้อ / ตำแหน่ง'));
    const label = cleanText(v.label, 24, 'LIVE'), ticker = cleanText(v.ticker, 240, tr('ข้อความวิ่งสำหรับไลฟ์'));
    const shape = (name, x, y, width, height, fill, radius = 0, extra = {}) => makeElement('shape', name, x, y, width, height, { fill, radius, ...extra });
    const panel = (name, x, y, width, height, radius = 0, angle = 0) => shape(name, x, y, width, height, secondary, radius, { fill2: withAlpha(secondary, 0.78), gradAngle: angle, shadow: true });
    const bar = (name, x, y, width, height, radius = 0) => shape(name, x, y, width, height, accent, radius, { fill2: withAlpha(accent, 0.82), gradAngle: 0 });
    const txt = (name, value, x, y, width, height, size, o = {}) => makeElement('text', name, x, y, width, height, {
      color: o.color || text, fontFamily: 'IBM Plex Sans Thai', fontSize: size, fontWeight: o.weight || 700, align: o.align || 'left', lineHeight: 1.15,
      vAlign: 'middle', fit: 'shrink', letterSpacing: o.spacing || 0, uppercase: !!o.upper, padding: o.pad ?? 0, shadow: !!o.shadow
    }, { value });
    if (template === 'top-banner') return [
      panel('แถบพื้นหลัง', 96, 54, 1728, 120, 6, 0), bar('แถบสีด้านล่าง', 96, 168, 1728, 6),
      bar('ป้ายคำกำกับ', 96, 54, 220, 120, 6), txt('คำกำกับ', label, 96, 54, 220, 120, 34, { weight: 800, align: 'center', upper: true, spacing: 3 }),
      txt('หัวข้อ', headline, 344, 62, 1450, 62, 44, { weight: 800 }), txt('ข้อความรอง', subtitle, 344, 120, 1450, 44, 28, { weight: 500, color: withAlpha(text, 0.86) })];
    if (template === 'live-bug') return [
      bar('พื้นป้าย LIVE', 1640, 54, 184, 60, 8), shape('จุด LIVE', 1662, 75, 18, 18, '#ffffff', 9),
      txt('LIVE', label, 1690, 54, 120, 60, 28, { weight: 800, upper: true, spacing: 4 }),
      panel('พื้นหัวข้อ', 1504, 122, 320, 52, 8, 0), txt('หัวข้อ', headline || subtitle, 1518, 122, 292, 52, 24, { weight: 700, align: 'right' })];
    if (template === 'ticker') return [
      panel('แถบพื้นหลัง', 0, 958, 1920, 68, 0, 0), bar('เส้นบน', 0, 952, 1920, 6),
      bar('ป้ายข่าว', 96, 958, 250, 68), txt('คำกำกับ', label || 'ข่าวด่วน', 96, 958, 250, 68, 30, { weight: 800, align: 'center', upper: true, spacing: 2 }),
      makeElement('ticker', 'ข้อความวิ่ง', 370, 958, 1454, 68, { color: text, fontFamily: 'IBM Plex Sans Thai', fontSize: 32, fontWeight: 600, align: 'left', lineHeight: 1.2, padding: 0, vAlign: 'middle', tickerSpeed: clamp(v.speed, 20, 180, 90) }, { value: ticker })];
    if (template === 'score-card') return [
      panel('กรอบคะแนน', 96, 54, 640, 72, 8, 0),
      txt('ทีม A', cleanText(v.teamA, 24, 'ทีม A'), 106, 54, 210, 72, 30, { weight: 800, upper: true, spacing: 1, align: 'center' }),
      bar('พื้นคะแนน', 326, 62, 160, 56, 6), txt('คะแนน', `${cleanText(v.scoreA, 4, '2')} – ${cleanText(v.scoreB, 4, '1')}`, 326, 62, 160, 56, 38, { weight: 800, align: 'center' }),
      txt('ทีม B', cleanText(v.teamB, 24, 'ทีม B'), 496, 54, 230, 72, 30, { weight: 800, upper: true, spacing: 1, align: 'center' }),
      panel('พื้นเวลา', 96, 126, 220, 44, 8, 0), txt('สถานะ', label, 96, 126, 220, 44, 22, { weight: 700, align: 'center', upper: true, spacing: 2, color: withAlpha(text, 0.9) })];
    if (template === 'full-screen') return [
      panel('พื้นประกาศ', 240, 300, 1440, 480, 14, 90), bar('เส้นเน้นบน', 240, 300, 1440, 10, 0),
      txt('หัวข้อ', headline, 300, 380, 1320, 150, 76, { weight: 800, align: 'center' }),
      shape('เส้นคั่น', 860, 556, 200, 4, accent, 2),
      txt('ข้อความรอง', subtitle, 300, 580, 1320, 120, 40, { weight: 600, align: 'center', color: withAlpha(text, 0.9) })];
    // Lower Third: แผ่นชื่อ (พื้นเข้มไล่สี + แถบสีด้านซ้าย) ซ้อนแถบตำแหน่งสีเน้น
    return [
      panel('แผ่นชื่อ', 96, 812, 820, 100, 0, 0), bar('แถบเน้น', 96, 812, 12, 100),
      txt('ชื่อ', headline, 136, 812, 760, 100, 54, { weight: 800 }),
      bar('แถบตำแหน่ง', 96, 912, 640, 54), txt('ตำแหน่ง', subtitle, 136, 912, 580, 54, 28, { weight: 600, upper: true, spacing: 1.5 })];
  }
  function migrateLegacy(raw) {
    const template = LEGACY_TEMPLATES.includes(raw?.template) ? raw.template : 'lower-third';
    const motion = { slide: 'slide-left', wipe: 'wipe', fade: 'fade', none: 'cut' }[raw?.motion] || 'fade';
    return {
      schemaVersion: SCHEMA_VERSION, id: cleanText(raw?.id, 80, uid()), name: cleanText(raw?.name, 80, 'กราฟิกใหม่'),
      output: { width: 1920, height: 1080 }, activeSceneId: 'scene-main', playback: { in: motion, out: motion === 'cut' ? 'fade' : motion, durationMs: 500 },
      scenes: [{ id: 'scene-main', name: template, elements: templateElements(template, raw || {}) }]
    };
  }
  function sanitizeElement(raw, index) {
    const type = ['text', 'ticker', 'shape', 'image'].includes(raw?.type) ? raw.type : 'text';
    const tr = raw?.transform && typeof raw.transform === 'object' ? raw.transform : {};
    const st = raw?.style && typeof raw.style === 'object' ? raw.style : {};
    const content = raw?.content && typeof raw.content === 'object' ? raw.content : {};
    const result = {
      id: cleanText(raw?.id, 80, uid()), type, name: cleanText(raw?.name, 80, `${type} ${index + 1}`),
      visible: raw?.visible !== false, locked: !!raw?.locked,
      transform: {
        x: clamp(tr.x, -1920, 3840, 100), y: clamp(tr.y, -1080, 2160, 100),
        width: clamp(tr.width, 1, 3840, 400), height: clamp(tr.height, 1, 2160, 100), rotation: clamp(tr.rotation, -360, 360, 0), zIndex: clamp(tr.zIndex, -1000, 1000, index)
      }, style: {}, content: {}
    };
    if (type === 'text' || type === 'ticker') {
      const font = ALLOWED_FONTS.includes(st.fontFamily) ? st.fontFamily : 'IBM Plex Sans Thai';
      result.style = {
        color: color(st.color, '#ffffff'), backgroundColor: st.backgroundColor === 'transparent' ? 'transparent' : color(st.backgroundColor, 'transparent'),
        fontFamily: font, fontSize: clamp(st.fontSize, 8, 240, 48), fontWeight: [400, 500, 600, 700, 800, 900].includes(+st.fontWeight) ? +st.fontWeight : 700,
        align: ['left', 'center', 'right'].includes(st.align) ? st.align : 'left', lineHeight: clamp(st.lineHeight, 0.8, 2.5, 1.2), padding: clamp(st.padding, 0, 80, 0), radius: clamp(st.radius, 0, 80, 0),
        shadow: !!st.shadow, tickerSpeed: clamp(st.tickerSpeed, 20, 300, 80),
        // ระยะห่างตัวอักษร · ตัวพิมพ์ใหญ่ · ย่อให้พอดีช่อง (shrink) หรือบีบแนวนอนแบบเดิม (squash) · จัดแนวตั้ง
        letterSpacing: clamp(st.letterSpacing, -5, 40, 0), uppercase: !!st.uppercase, fit: st.fit === 'shrink' ? 'shrink' : 'squash', vAlign: st.vAlign === 'middle' ? 'middle' : 'top'
      };
      result.content = { mode: 'static', value: cleanText(content.value ?? raw?.text, 1000, 'ข้อความ') };
    } else if (type === 'shape') {
      result.style = { fill: color(st.fill, '#ef4444'), fill2: st.fill2 ? color(st.fill2, '') : '', gradAngle: clamp(st.gradAngle, 0, 360, 0), radius: clamp(st.radius, 0, 300, 0), borderColor: st.borderColor === 'transparent' ? 'transparent' : color(st.borderColor, 'transparent'), borderWidth: clamp(st.borderWidth, 0, 24, 0), shadow: !!st.shadow };
    } else {
      const src = typeof content.src === 'string' && content.src.length <= MAX_IMAGE_DATA && /^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(content.src) ? content.src : '';
      result.style = { fit: st.fit === 'contain' ? 'contain' : 'cover', radius: clamp(st.radius, 0, 300, 0) };
      result.content = { src, alt: cleanText(content.alt, 120, '') };
    }
    return result;
  }
  function sanitize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    if (source.schemaVersion === SCHEMA_VERSION && sanitizedCache.has(source)) return sanitizedCache.get(source);
    const migrated = source.schemaVersion === SCHEMA_VERSION ? source : migrateLegacy(source);
    let remainingElements = MAX_ELEMENTS;
    const scenes = (Array.isArray(migrated.scenes) ? migrated.scenes : []).slice(0, MAX_SCENES).map((scene, sceneIndex) => {
      const safeElements = (Array.isArray(scene?.elements) ? scene.elements : []).slice(0, Math.min(MAX_ELEMENTS_PER_SCENE, remainingElements)).map(sanitizeElement);
      remainingElements -= safeElements.length;
      return { id: cleanText(scene?.id, 80, uid()), name: cleanText(scene?.name, 80, `Scene ${sceneIndex + 1}`), elements: safeElements };
    });
    if (!scenes.length) scenes.push({ id: 'scene-main', name: 'Scene 1', elements: [] });
    const activeSceneId = scenes.some(scene => scene.id === migrated.activeSceneId) ? migrated.activeSceneId : scenes[0].id;
    const playback = migrated.playback && typeof migrated.playback === 'object' ? migrated.playback : {};
    const result = {
      schemaVersion: SCHEMA_VERSION, id: cleanText(migrated.id, 80, uid()), name: cleanText(migrated.name, 80, 'กราฟิกใหม่'),
      output: { width: 1920, height: 1080 }, activeSceneId, scenes,
      playback: { in: MOTIONS.includes(playback.in) ? playback.in : 'fade', out: MOTIONS.includes(playback.out) ? playback.out : 'fade', durationMs: clamp(playback.durationMs, 150, 3000, 500) }
    };
    sanitizedCache.set(source, result);
    return result;
  }
  function createTemplate(template, name) {
    const doc = defaults();
    const selected = LEGACY_TEMPLATES.includes(template) ? template : 'lower-third';
    doc.name = cleanText(name, 80, selected);
    doc.scenes[0].name = selected;
    doc.scenes[0].elements = templateElements(selected, {});
    return sanitize(doc);
  }
  function addScene(doc, name) {
    const next = sanitize(doc), scene = { id: uid(), name: cleanText(name, 80, `Scene ${next.scenes.length + 1}`), elements: [] };
    next.scenes.push(scene); next.activeSceneId = scene.id; return next;
  }
  function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h); ctx.closePath();
  }
  const imageCache = new Map();
  function getImage(src) {
    if (!src) return null;
    let img = imageCache.get(src);
    if (!img) { img = new Image(); img.onload = () => { assetRevision++; root.dispatchEvent(new Event('webmix-cg-image-ready')); }; img.src = src; imageCache.set(src, img); }
    return img.complete && img.naturalWidth ? img : null;
  }
  function draw(ctx, raw, w, h, options = {}) {
    const doc = sanitize(raw), scene = doc.scenes.find(item => item.id === (options.sceneId || doc.activeSceneId)) || doc.scenes[0];
    if (!scene) return;
    const sx = w / 1920, sy = h / 1080;
    ctx.save(); ctx.scale(sx, sy);
    for (const el of [...scene.elements].sort((a, b) => (a.transform.zIndex || 0) - (b.transform.zIndex || 0))) {
      if (!el.visible) continue;
      const t = el.transform, x = t.x, y = t.y, ew = t.width, eh = t.height;
      ctx.save(); ctx.translate(x + ew / 2, y + eh / 2); ctx.rotate(t.rotation * Math.PI / 180); ctx.translate(-ew / 2, -eh / 2);
      if (el.type === 'shape') {
        if (el.style.fill2) {
          // ไล่สีตามมุม (0 = ซ้าย→ขวา · 90 = บน→ล่าง)
          const a = el.style.gradAngle * Math.PI / 180, dx = Math.cos(a) * ew / 2, dy = Math.sin(a) * eh / 2;
          const g = ctx.createLinearGradient(ew / 2 - dx, eh / 2 - dy, ew / 2 + dx, eh / 2 + dy);
          g.addColorStop(0, el.style.fill); g.addColorStop(1, el.style.fill2);
          ctx.fillStyle = g;
        } else ctx.fillStyle = el.style.fill;
        if (el.style.shadow) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 5; }
        roundedRect(ctx, 0, 0, ew, eh, el.style.radius); ctx.fill();
        if (el.style.borderWidth > 0 && el.style.borderColor !== 'transparent') { ctx.strokeStyle = el.style.borderColor; ctx.lineWidth = el.style.borderWidth; ctx.stroke(); }
      } else if (el.type === 'text' || el.type === 'ticker') {
        if (el.style.backgroundColor !== 'transparent') { ctx.fillStyle = el.style.backgroundColor; roundedRect(ctx, 0, 0, ew, eh, el.style.radius); ctx.fill(); }
        const pad = el.style.padding, st = el.style, avail = Math.max(1, ew - pad * 2);
        ctx.beginPath(); ctx.rect(pad, 0, avail, eh); ctx.clip();
        const up = l => st.uppercase ? l.toLocaleUpperCase() : l;
        const lines = el.type === 'ticker' ? [up(el.content.value)] : el.content.value.split('\n').slice(0, 12).map(up);
        let size = st.fontSize;
        const setFont = px => { ctx.font = `${st.fontWeight} ${px}px "${st.fontFamily}"`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${st.letterSpacing * px / st.fontSize}px`; };
        setFont(size);
        // ย่อขนาดให้บรรทัดที่ยาวที่สุดพอดีช่อง (ไม่บีบตัวอักษรให้ผอม) — ไม่ต่ำกว่าครึ่งของขนาดที่ตั้ง
        if (el.type !== 'ticker' && st.fit === 'shrink') {
          const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
          if (widest > avail) { size = Math.max(st.fontSize * 0.5, st.fontSize * avail / widest); setFont(size); }
        }
        ctx.fillStyle = st.color; ctx.textAlign = st.align;
        if (st.shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; }
        const middle = st.vAlign === 'middle', lh = size * st.lineHeight;
        ctx.textBaseline = middle ? 'middle' : 'top';
        const yOf = i => middle ? eh / 2 + (i - (lines.length - 1) / 2) * lh : i * lh;
        const tx = st.align === 'center' ? ew / 2 : st.align === 'right' ? ew - pad : pad;
        const maxW = st.fit === 'shrink' ? undefined : avail;
        if (el.type === 'ticker') {
          const line = lines[0], tw = ctx.measureText(line).width, gap = 90, cycle = tw + gap;
          const offset = cycle > 0 ? (Date.now() / 1000 * st.tickerSpeed) % cycle : 0;
          ctx.textAlign = 'left';
          for (let px = ew - offset; px < ew; px += cycle) ctx.fillText(line, px, yOf(0));
          if (ew - offset + tw < ew) ctx.fillText(line, ew - offset + cycle, yOf(0));
        } else {
          lines.forEach((line, i) => maxW ? ctx.fillText(line, tx, yOf(i), maxW) : ctx.fillText(line, tx, yOf(i)));
        }
      } else if (el.type === 'image') {
        const img = getImage(el.content.src);
        if (img) {
          ctx.save(); roundedRect(ctx, 0, 0, ew, eh, el.style.radius); ctx.clip();
          const ratio = img.naturalWidth / img.naturalHeight, box = ew / eh;
          let dw = ew, dh = eh;
          if ((el.style.fit === 'contain' && ratio > box) || (el.style.fit === 'cover' && ratio < box)) dh = ew / ratio;
          else dw = eh * ratio;
          ctx.drawImage(img, (ew - dw) / 2, (eh - dh) / 2, dw, dh); ctx.restore();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }
  root.WebMixCG = { schemaVersion: SCHEMA_VERSION, templates: LEGACY_TEMPLATES, defaults, sanitize, draw, createTemplate, addScene, migrateLegacy, get assetRevision() { return assetRevision; } };
})(window);
