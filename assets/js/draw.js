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

  const TITLE_STYLES = { lower: 'ป้ายชื่อล่าง (Lower third)', top: 'แถบหัวข้อด้านบน', live: 'ป้าย LIVE มุมขวาบน', center: 'ข้อความกลางจอ' };

  function drawTitleInput(ctx, inp, w, h) {
    const t = inp.title || {};
    const s = h / 720;
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
      drawTitle(ctx, w, h, 1, { headline: t.headline || '', subtitle: t.subtitle || '', color: t.color || '#ef4444' });
    }
    ctx.restore();
  }

  Object.assign(WM, { fillBlack, drawFit, fitFont, drawBars, drawSlate, drawClock, RELINK_HINT, drawNoSignal, drawTitle, TITLE_STYLES, drawTitleInput });
})(window.WebMix);
