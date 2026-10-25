/* WebMix — วาดแหล่งภาพที่สร้างเอง (Bars, Slate, นาฬิกา, NO SIGNAL, ป้ายชื่อ, Title) ด้วย Canvas 2D */
(function (WM) {
  'use strict';
  const { pad2, easeOut, FONT, MONO } = WM;

  function fillBlack(ctx, w, h) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }

  function drawFit(ctx, src, sw, sh, w, h) {
    if (!sw || !sh) return;
    const s = Math.min(w / sw, h / sh);
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function fitFont(ctx, text, weight, size, family, maxWidth) {
    ctx.font = `${weight} ${size}px ${family}`;
    const m = ctx.measureText(text).width;
    if (m > maxWidth) ctx.font = `${weight} ${Math.floor(size * maxWidth / m)}px ${family}`;
  }

  function drawBars(ctx, w, h) {
    const top = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    const mid = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
    const bw = w / 7, h1 = Math.round(h * 0.67), h2 = Math.round(h * 0.08);
    top.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, h1); });
    mid.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * bw), h1, Math.ceil(bw) + 1, h2); });
    const bottom = [['#00214c', 1.25], ['#ffffff', 1.25], ['#32006a', 1.25], ['#131313', 1.25],
      ['#090909', 1 / 3], ['#131313', 1 / 3], ['#1d1d1d', 1 / 3], ['#131313', 1]];
    let x = 0;
    for (const [c, u] of bottom) {
      ctx.fillStyle = c;
      ctx.fillRect(Math.floor(x), h1 + h2, Math.ceil(u * bw) + 1, h - h1 - h2);
      x += u * bw;
    }
  }

  function drawSlate(ctx, w, h, inp) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b1220'); g.addColorStop(1, '#1b1030');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const s = h / 720;
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 2 * s;
    ctx.strokeRect(w * 0.05, h * 0.07, w * 0.9, h * 0.86);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5a524';
    ctx.font = `800 ${20 * s}px ${FONT}`;
    ctx.fillText('W E B M I X   P R O', w / 2, h * 0.37);
    ctx.fillStyle = '#fff';
    fitFont(ctx, inp.text || ' ', 700, 58 * s, FONT, w * 0.84);
    ctx.fillText(inp.text || '', w / 2, h * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = `500 ${20 * s}px ${MONO}`;
    ctx.fillText(new Date().toLocaleTimeString('th-TH', { hour12: false }), w / 2, h * 0.63);
  }

  function drawClock(ctx, w, h, inp) {
    ctx.fillStyle = '#07080b'; ctx.fillRect(0, 0, w, h);
    const s = h / 720, now = new Date();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8b94a7';
    fitFont(ctx, inp.text || '', 600, 28 * s, FONT, w * 0.8);
    ctx.fillText(inp.text || '', w / 2, h * 0.3);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${150 * s}px ${MONO}`;
    ctx.fillText(`${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`, w / 2, h * 0.5);
    ctx.fillStyle = '#f5a524';
    ctx.font = `500 ${26 * s}px ${FONT}`;
    ctx.fillText(now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), w / 2, h * 0.69);
  }

  const RELINK_HINT = {
    camera: 'กดปุ่ม 🔗 บนการ์ดเพื่อเชื่อมต่อกล้องอีกครั้ง',
    screen: 'กดปุ่ม 🔗 บนการ์ดเพื่อแชร์หน้าจออีกครั้ง',
    media: 'กดปุ่ม 🔗 บนการ์ดเพื่อเลือกไฟล์วิดีโอ',
    image: 'กดปุ่ม 🔗 บนการ์ดเพื่อเลือกไฟล์รูป',
    slides: 'กดปุ่ม 🔗 บนการ์ดเพื่อเลือกไฟล์ PDF',
    wireless: 'รอมือถือเชื่อมต่อกลับมา',
    guest: 'รอแขกเปิดลิงก์เชิญ — กดปุ่ม 🔗 บนการ์ดเพื่อดูลิงก์'
  };

  function drawNoSignal(ctx, w, h, inp) {
    ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, w, h);
    const s = h / 720;
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 18 * s;
    for (let x = -h; x < w; x += 60 * s) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const srtWaiting = inp.type === 'srt' && inp.srtState !== 'live';
    ctx.fillStyle = srtWaiting && inp.srtState !== 'error' ? '#f5a524' : '#f87171';
    ctx.font = `800 ${44 * s}px ${FONT}`;
    ctx.fillText(srtWaiting ? (inp.srtState === 'waiting' ? 'WAITING FOR SRT' : inp.srtState === 'connecting' ? 'CONNECTING SRT…' : 'NO SIGNAL') : 'NO SIGNAL', w / 2, h * 0.46);
    ctx.fillStyle = '#8b94a7';
    fitFont(ctx, inp.name, 500, 22 * s, FONT, w * 0.8);
    ctx.fillText(inp.name, w / 2, h * 0.56);
    const relink = RELINK_HINT[inp.type];
    if (relink && inp.missing) {
      ctx.fillStyle = '#f5a524';
      fitFont(ctx, relink, 500, 18 * s, FONT, w * 0.85);
      ctx.fillText(relink, w / 2, h * 0.65);
    }
    if (inp.type === 'srt') {
      const c = inp.srt;
      const hint = c.mode === 'listener' ? `UDP ${c.port} · ${c.latency} ms` : c.mode === 'rtmp' ? `RTMP · พอร์ต ${c.port} · รอผู้ส่ง` : String(c.url || '').replace(/\?.*$/, '');
      ctx.fillStyle = '#5d6578';
      fitFont(ctx, hint, 500, 18 * s, MONO, w * 0.8);
      ctx.fillText(hint, w / 2, h * 0.64);
    }
  }

  function drawTitle(ctx, w, h, a, t) {
    if (!t.headline && !t.subtitle) return;
    const s = h / 720, e = easeOut(a);
    const x = w * 0.06, y = h * 0.735;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `800 ${30 * s}px ${FONT}`;
    const hw = t.headline ? ctx.measureText(t.headline).width + 40 * s : 0;
    ctx.font = `500 ${23 * s}px ${FONT}`;
    const sw = t.subtitle ? ctx.measureText(t.subtitle).width + 40 * s : 0;
    const maxW = w * 0.82;
    const boxW = Math.min(maxW, Math.max(hw, sw));
    ctx.globalAlpha = Math.min(1, a * 1.6);
    ctx.beginPath();
    ctx.rect(x, y - 4 * s, (boxW + 10 * s) * e, 110 * s);
    ctx.clip();
    ctx.fillStyle = t.color;
    ctx.fillRect(x, y, 7 * s, (t.subtitle ? 96 : 52) * s);
    if (t.headline) {
      ctx.fillStyle = t.color;
      ctx.fillRect(x + 7 * s, y, Math.min(hw, maxW), 52 * s);
      ctx.fillStyle = t.color === '#e5e7eb' ? '#0b0d12' : '#fff';
      fitFont(ctx, t.headline, 800, 30 * s, FONT, maxW - 40 * s);
      ctx.fillText(t.headline, x + 27 * s, y + 27 * s);
    }
    if (t.subtitle) {
      const sy = y + (t.headline ? 52 : 0) * s;
      ctx.fillStyle = 'rgba(10,13,20,.9)';
      ctx.fillRect(x + 7 * s, sy, Math.min(sw, maxW), 44 * s);
      ctx.fillStyle = '#e7eaf0';
      fitFont(ctx, t.subtitle, 500, 23 * s, FONT, maxW - 40 * s);
      ctx.fillText(t.subtitle, x + 27 * s, sy + 23 * s);
    }
    ctx.restore();
  }

  const TITLE_STYLES = { lower: 'ข่าว', plain: 'เรียบ', minimal: 'มินิมอล', pill: 'กล่องมน', sport: 'กีฬา', gradient: 'ไล่สี', top: 'แถบด้านบน', live: 'ป้าย LIVE', center: 'กลางจอ' };
  const LOWER_STYLES = ['plain', 'minimal', 'pill', 'sport', 'gradient'];
  const rrect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

  // ป้ายชื่อล่างแบบอื่น ๆ: ขนาด (t.size) · ตำแหน่ง ซ้าย / กลาง / ขวา (t.pos) · a = ความคืบหน้าภาพเคลื่อนไหวตอนเข้า (0–1)
  function drawLowerStyled(ctx, w, h, t, a) {
    const s = h / 720 * (t.size || 1), e = easeOut(a);
    const head = t.headline || '', sub = t.subtitle || '', col = t.color || '#ef4444';
    ctx.font = `800 ${30 * s}px ${FONT}`;
    const hw = head ? ctx.measureText(head).width + 40 * s : 0;
    ctx.font = `500 ${22 * s}px ${FONT}`;
    const sw = sub ? ctx.measureText(sub).width + 40 * s : 0;
    const boxW = Math.min(w * 0.86, Math.max(hw, sw)), hh = head ? 52 * s : 0, sh = sub ? 42 * s : 0;
    const x = t.pos === 'center' ? (w - boxW) / 2 : t.pos === 'right' ? w * 0.94 - boxW : w * 0.06;
    const y = h * 0.9 - hh - sh;
    ctx.globalAlpha = Math.min(1, a * 1.6);
    ctx.save();
    ctx.beginPath();
    const cw = (boxW + 30 * s) * e;
    ctx.rect(t.pos === 'right' ? x + boxW + 15 * s - cw : t.pos === 'center' ? x + (boxW - cw) / 2 : x - 15 * s, y - 15 * s, cw + 15 * s, hh + sh + 30 * s);
    ctx.clip();
    const light = col === '#e5e7eb' || col === '#ffffff';
    const textIn = (str, weight, size, fill, bx, by, bw) => { ctx.fillStyle = fill; fitFont(ctx, str, weight, size, FONT, bw - 40 * s); ctx.fillText(str, bx + 20 * s, by); };
    if (t.style === 'plain') {
      if (head) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, Math.min(hw, boxW), hh); textIn(head, 800, 30 * s, '#0b0d12', x, y + hh / 2 + 1, boxW); }
      if (sub) { ctx.fillStyle = col; ctx.fillRect(x, y + hh, Math.min(sw, boxW), sh); textIn(sub, 500, 22 * s, light ? '#0b0d12' : '#ffffff', x, y + hh + sh / 2 + 1, boxW); }
    } else if (t.style === 'minimal') {
      ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 12 * s;
      if (head) { textIn(head, 800, 32 * s, '#ffffff', x - 20 * s, y + hh / 2, boxW + 40 * s); }
      ctx.shadowBlur = 0;
      ctx.fillStyle = col; ctx.fillRect(x, y + hh - 2 * s, Math.min(Math.max(hw, sw) - 40 * s, boxW), 4 * s);
      ctx.shadowBlur = 12 * s;
      if (sub) textIn(sub, 500, 22 * s, '#e7eaf0', x - 20 * s, y + hh + sh / 2 + 2 * s, boxW + 40 * s);
    } else if (t.style === 'pill') {
      ctx.fillStyle = 'rgba(10,13,20,.82)';
      rrect(ctx, x, y, boxW, hh + sh, Math.min(28 * s, (hh + sh) / 2)); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 20 * s, y + (hh || sh) / 2 + (hh ? 0 : 0), 6 * s, 0, Math.PI * 2); ctx.fill();
      if (head) textIn(head, 800, 28 * s, '#ffffff', x + 14 * s, y + hh / 2 + 1, boxW - 14 * s);
      if (sub) textIn(sub, 500, 21 * s, light ? '#e7eaf0' : col, x + 14 * s, y + hh + sh / 2 - (hh ? 4 * s : 0), boxW - 14 * s);
    } else if (t.style === 'sport') {
      ctx.save();
      ctx.translate(x, y); ctx.transform(1, 0, -0.18, 1, 0, 0);
      if (head) { ctx.fillStyle = col; ctx.fillRect(0, 0, Math.min(hw, boxW), hh); }
      if (sub) { ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, hh, Math.min(sw, boxW), sh); }
      ctx.restore();
      if (head) textIn(head.toUpperCase(), 800, 30 * s, light ? '#0b0d12' : '#ffffff', x, y + hh / 2 + 1, boxW);
      if (sub) textIn(sub, 600, 21 * s, '#e7eaf0', x - 8 * s, y + hh + sh / 2 + 1, boxW);
    } else {
      // ไล่สี: สีที่เลือก → ชมพูม่วง
      const g = ctx.createLinearGradient(x, 0, x + boxW, 0);
      g.addColorStop(0, col); g.addColorStop(1, '#db2777');
      if (head) { ctx.fillStyle = g; rrect(ctx, x, y, Math.min(hw, boxW), hh, 6 * s); ctx.fill(); textIn(head, 800, 30 * s, '#ffffff', x, y + hh / 2 + 1, boxW); }
      if (sub) { ctx.fillStyle = 'rgba(10,13,20,.85)'; ctx.fillRect(x + 6 * s, y + hh, Math.min(sw, boxW) - 6 * s, sh); textIn(sub, 500, 22 * s, '#e7eaf0', x, y + hh + sh / 2 + 1, boxW); }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ความคืบหน้าภาพเคลื่อนไหวตอนป้ายขึ้นจอ (t.anim) — inp.shownAt ตั้งเมื่อเปิด Overlay
  const titleAnim = inp => { const t = inp.title || {}; return t.anim && inp.shownAt ? Math.min(1, (performance.now() - inp.shownAt) / 450) : 1; };
  function drawTitleInput(ctx, inp, w, h) {
    const t = inp.title || {};
    const s = h / 720;
    if (LOWER_STYLES.includes(t.style)) { ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; drawLowerStyled(ctx, w, h, t, titleAnim(inp)); ctx.restore(); return; }
    const dark = t.color === '#e5e7eb' ? '#0b0d12' : '#fff';
    ctx.save();
    ctx.textBaseline = 'middle';
    if (t.style === 'top') {
      const bh = (t.subtitle ? 92 : 58) * s;
      ctx.fillStyle = 'rgba(10,13,20,.88)'; ctx.fillRect(0, 0, w, bh);
      ctx.fillStyle = t.color || '#ef4444'; ctx.fillRect(0, bh - 5 * s, w, 5 * s);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff'; fitFont(ctx, t.headline || '', 800, 30 * s, FONT, w * 0.9);
      ctx.fillText(t.headline || '', w * 0.04, (t.subtitle ? 32 : 28) * s);
      if (t.subtitle) { ctx.fillStyle = '#c9cfdb'; fitFont(ctx, t.subtitle, 500, 21 * s, FONT, w * 0.9); ctx.fillText(t.subtitle, w * 0.04, 66 * s); }
    } else if (t.style === 'live') {
      ctx.textAlign = 'left';
      ctx.font = `800 ${24 * s}px ${FONT}`;
      const badge = 'LIVE', bw = ctx.measureText(badge).width + 34 * s;
      ctx.font = `600 ${20 * s}px ${FONT}`;
      const text = [t.headline, t.subtitle].filter(Boolean).join(' · ');
      const tw = text ? Math.min(w * 0.5, ctx.measureText(text).width + 28 * s) : 0;
      const x = w - w * 0.03 - bw - tw, y = h * 0.05;
      ctx.fillStyle = t.color || '#ef4444'; ctx.fillRect(x, y, bw, 44 * s);
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x + 15 * s, y + 22 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.font = `800 ${24 * s}px ${FONT}`; ctx.fillText(badge, x + 27 * s, y + 23 * s);
      if (text) {
        ctx.fillStyle = 'rgba(10,13,20,.85)'; ctx.fillRect(x + bw, y, tw, 44 * s);
        ctx.fillStyle = '#fff'; fitFont(ctx, text, 600, 20 * s, FONT, tw - 28 * s); ctx.fillText(text, x + bw + 14 * s, y + 23 * s);
      }
    } else if (t.style === 'center') {
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 18 * s;
      ctx.fillStyle = '#fff'; fitFont(ctx, t.headline || '', 800, 72 * s, FONT, w * 0.86);
      ctx.fillText(t.headline || '', w / 2, h * (t.subtitle ? 0.45 : 0.5));
      if (t.subtitle) { ctx.fillStyle = t.color || '#f5a524'; fitFont(ctx, t.subtitle, 600, 32 * s, FONT, w * 0.8); ctx.fillText(t.subtitle, w / 2, h * 0.57); }
    } else {
      // ข่าว (ค่าเดิม): ขนาดและตำแหน่งปรับได้
      const sz = t.size || 1;
      ctx.save();
      if (sz !== 1 || (t.pos && t.pos !== 'left')) {
        ctx.font = `800 ${30 * s * sz}px ${FONT}`;
        const bw = Math.min(w * 0.82, Math.max(t.headline ? ctx.measureText(t.headline).width : 0, t.subtitle ? ctx.measureText(t.subtitle).width * 0.8 : 0) + 50 * s) * sz;
        const x0 = w * 0.06, x1 = t.pos === 'center' ? (w - bw) / 2 : t.pos === 'right' ? w * 0.94 - bw : x0, y0 = h * 0.735;
        ctx.translate(x1, y0); ctx.scale(sz, sz); ctx.translate(-x0, -y0 - (sz - 1) * 0);
      }
      drawTitle(ctx, w, h, titleAnim(inp), { headline: t.headline || '', subtitle: t.subtitle || '', color: t.color || '#ef4444' });
      ctx.restore();
    }
    ctx.restore();
  }

  Object.assign(WM, { fillBlack, drawFit, fitFont, drawBars, drawSlate, drawClock, RELINK_HINT, drawNoSignal, drawTitle, TITLE_STYLES, drawTitleInput, titleAnim });
})(window.WebMix);
