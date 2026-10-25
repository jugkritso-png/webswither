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
  const sanitizedCache = new WeakMap();
  let assetRevision = 0;
  const clamp = (value, min, max, fallback) => Number.isFinite(+value) ? Math.max(min, Math.min(max, +value)) : fallback;
  const cleanText = (value, max, fallback = '') => String(value ?? fallback).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
  const color = (value, fallback) => /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(String(value || '')) ? String(value) : fallback;
  const defaults = () => ({
    schemaVersion: SCHEMA_VERSION, id: uid(), name: 'กราฟิกใหม่', output: { width: 1920, height: 1080 }, activeSceneId: 'scene-main', playback: { in: 'fade', out: 'fade', durationMs: 500 },
    scenes: [{ id: 'scene-main', name: 'Lower Third', elements: templateElements('lower-third', { headline: 'ชื่อผู้พูด', subtitle: 'หัวข้อ / ตำแหน่ง', accent: '#ef4444', secondary: '#111827', text: '#ffffff' }) }]
  });
  function makeElement(type, name, x, y, width, height, style = {}, content = {}) {
    return { id: uid(), type, name, visible: true, locked: false, transform: { x, y, width, height, rotation: 0 }, style, content };
  }
  function templateElements(template, v = {}) {
    const accent = color(v.accent, '#ef4444'), secondary = color(v.secondary, '#111827'), text = color(v.text, '#ffffff');
    const headline = cleanText(v.headline, 100, 'ชื่อผู้พูด'), subtitle = cleanText(v.subtitle, 140, 'หัวข้อ / ตำแหน่ง');
    const label = cleanText(v.label, 24, 'LIVE'), ticker = cleanText(v.ticker, 240, 'ข้อความวิ่งสำหรับไลฟ์');
    const shape = (name, x, y, width, height, fill, radius = 10) => makeElement('shape', name, x, y, width, height, { fill, radius });
    const txt = (name, value, x, y, width, height, size, fill = text, weight = 700, align = 'left') => makeElement('text', name, x, y, width, height, { color: fill, fontFamily: 'IBM Plex Sans Thai', fontSize: size, fontWeight: weight, align, lineHeight: 1.15 }, { value });
    if (template === 'top-banner') return [shape('แถบพื้นหลัง', 0, 0, 1920, 132, secondary, 0), shape('เส้นเน้น', 0, 125, 1920, 7, accent, 0), txt('หัวข้อ', headline, 64, 24, 1300, 58, 42), txt('ข้อความรอง', subtitle, 64, 78, 1200, 42, 26, text, 500), shape('ป้าย', 1640, 28, 210, 58, accent, 24), txt('คำกำกับ', label, 1645, 33, 200, 48, 24, text, 800, 'center')];
    if (template === 'live-bug') return [shape('พื้นป้าย LIVE', 1580, 48, 150, 62, accent, 10), txt('LIVE', label, 1585, 53, 140, 50, 24, text, 800, 'center'), shape('พื้นหัวข้อ', 1740, 48, 150, 62, secondary, 10), txt('หัวข้อ', headline || subtitle, 1745, 53, 140, 50, 19, text, 700, 'center')];
    if (template === 'ticker') return [shape('แถบพื้นหลัง', 0, 950, 1920, 86, secondary, 0), shape('ป้ายข่าว', 34, 960, 235, 66, accent, 8), txt('คำกำกับ', label || 'ข่าวด่วน', 42, 966, 219, 54, 24, text, 800, 'center'), makeElement('ticker', 'ข้อความวิ่ง', 300, 960, 1580, 68, { color: text, fontFamily: 'IBM Plex Sans Thai', fontSize: 26, fontWeight: 600, align: 'left', lineHeight: 1.2, padding: 0, tickerSpeed: clamp(v.speed, 20, 180, 80) }, { value: ticker })];
    if (template === 'score-card') return [shape('กรอบคะแนน', 590, 830, 740, 170, secondary, 16), shape('ป้ายสถานะ', 590, 830, 140, 170, accent, 16), txt('สถานะ', label, 598, 887, 124, 54, 24, text, 800, 'center'), txt('ทีม A', cleanText(v.teamA, 24, 'ทีม A'), 760, 884, 210, 58, 28), txt('คะแนน', `${cleanText(v.scoreA, 4, '2')} : ${cleanText(v.scoreB, 4, '1')}`, 940, 868, 240, 82, 46, text, 800, 'center'), txt('ทีม B', cleanText(v.teamB, 24, 'ทีม B'), 1160, 884, 155, 58, 28, text, 700, 'right')];
    if (template === 'full-screen') return [shape('พื้นประกาศ', 150, 360, 1620, 360, 'rgba(10,13,20,0.9)', 20), shape('เส้นเน้น', 150, 360, 14, 360, accent, 0), txt('หัวข้อ', headline, 240, 415, 1440, 110, 62, text, 800, 'center'), txt('ข้อความรอง', subtitle, 240, 535, 1440, 92, 36, accent, 600, 'center')];
    return [shape('พื้นชื่อ', 64, 828, 760, 176, secondary, 12), shape('แถบสี', 64, 828, 16, 176, accent, 0), txt('ชื่อผู้พูด', headline, 104, 846, 680, 78, 52, text, 800), txt('ตำแหน่ง', subtitle, 104, 922, 680, 55, 29, text, 500)];
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
        shadow: !!st.shadow, tickerSpeed: clamp(st.tickerSpeed, 20, 300, 80)
      };
      result.content = { mode: 'static', value: cleanText(content.value ?? raw?.text, 1000, 'ข้อความ') };
    } else if (type === 'shape') {
      result.style = { fill: color(st.fill, '#ef4444'), radius: clamp(st.radius, 0, 300, 0), borderColor: st.borderColor === 'transparent' ? 'transparent' : color(st.borderColor, 'transparent'), borderWidth: clamp(st.borderWidth, 0, 24, 0), shadow: !!st.shadow };
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
        ctx.fillStyle = el.style.fill;
        if (el.style.shadow) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 5; }
        roundedRect(ctx, 0, 0, ew, eh, el.style.radius); ctx.fill();
        if (el.style.borderWidth > 0 && el.style.borderColor !== 'transparent') { ctx.strokeStyle = el.style.borderColor; ctx.lineWidth = el.style.borderWidth; ctx.stroke(); }
      } else if (el.type === 'text' || el.type === 'ticker') {
        if (el.style.backgroundColor !== 'transparent') { ctx.fillStyle = el.style.backgroundColor; roundedRect(ctx, 0, 0, ew, eh, el.style.radius); ctx.fill(); }
        const pad = el.style.padding, fontSize = el.style.fontSize;
        ctx.beginPath(); ctx.rect(pad, 0, Math.max(0, ew - pad * 2), eh); ctx.clip();
        ctx.fillStyle = el.style.color; ctx.font = `${el.style.fontWeight} ${fontSize}px "${el.style.fontFamily}"`;
        ctx.textAlign = el.style.align; ctx.textBaseline = 'top';
        if (el.style.shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; }
        const tx = el.style.align === 'center' ? ew / 2 : el.style.align === 'right' ? ew - pad : pad;
        if (el.type === 'ticker') {
          const line = el.content.value, tw = ctx.measureText(line).width, gap = 90, cycle = tw + gap;
          const offset = cycle > 0 ? (Date.now() / 1000 * el.style.tickerSpeed) % cycle : 0;
          ctx.textAlign = 'left';
          for (let px = ew - offset; px < ew; px += cycle) ctx.fillText(line, px, 0, Math.max(1, ew));
          if (ew - offset + tw < ew) ctx.fillText(line, ew - offset + cycle, 0, Math.max(1, ew));
        } else {
          el.content.value.split('\n').slice(0, 12).forEach((line, i) => ctx.fillText(line, tx, i * fontSize * el.style.lineHeight, Math.max(1, ew - pad * 2)));
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
