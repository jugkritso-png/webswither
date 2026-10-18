/* WebMix — กราฟิกข้อมูล: นาฬิกานับถอยหลัง/จับเวลา, ป้ายคะแนน, ตัววิ่งข่าว และการอ่านข้อมูลจาก Google Sheets / CSV
   ทุกแบบวาดบนพื้นโปร่งใส จึงใช้เป็น Overlay ได้ทันที */
(function (WM) {
  'use strict';
  const { pad2, fitFont, FONT, MONO } = WM;

  /* ------------------------------------------------------------- timer */
  const TIMER_MODES = { down: 'นับถอยหลัง', up: 'จับเวลา (นับขึ้น)', clock: 'นับถอยหลังถึงเวลา (เช่น 19:00)' };
  const TIMER_STYLES = { center: 'ตัวเลขใหญ่กลางจอ', corner: 'กล่องมุมขวาบน', bar: 'แถบล่าง' };

  function timerElapsed(t, now = Date.now()) {
    return (t.base || 0) + (t.running && t.since ? now - t.since : 0);
  }
  // คืนจำนวนมิลลิวินาทีที่จะแสดง และสถานะหมดเวลา
  function timerValue(t, now = Date.now()) {
    if (t.mode === 'up') return { ms: timerElapsed(t, now), done: false };
    if (t.mode === 'clock') {
      const m = /^(\d{1,2}):(\d{2})$/.exec(t.target || '');
      if (!m) return { ms: 0, done: true };
      const target = new Date(now);
      target.setHours(+m[1], +m[2], 0, 0);
      // เลยเวลามาไม่ถึง 10 นาที = ถึงเวลาแล้ว (แสดง 00:00) · เลยไปนานกว่านั้น = นับไปถึงเวลานี้ของวันพรุ่งนี้
      if (now - target.getTime() > 10 * 60 * 1000) target.setDate(target.getDate() + 1);
      const left = target.getTime() - now;
      return { ms: Math.max(0, left), done: left <= 0 };
    }
    const left = (t.duration || 0) * 1000 - timerElapsed(t, now);
    return { ms: Math.max(0, left), done: left <= 0 };
  }
  function fmtClock(ms, roundUp) {
    const total = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }
  const timerText = (t, now) => { const v = timerValue(t, now); return { text: fmtClock(v.ms, t.mode !== 'up'), done: v.done }; };

  function drawTimer(ctx, w, h, inp, now = Date.now()) {
    const t = inp.timer || {};
    const { text, done } = timerText(t, now);
    const s = h / 720, color = t.color || '#f5a524';
    // หมดเวลา: กะพริบสีแดง
    const flash = done && t.mode !== 'up' && Math.floor(now / 500) % 2 === 0;
    const numColor = done && t.mode !== 'up' ? (flash ? '#ef4444' : '#fff') : '#fff';
    ctx.save();
    ctx.textBaseline = 'middle';
    if (t.style === 'corner') {
      ctx.font = `700 ${46 * s}px ${MONO}`;
      const tw = ctx.measureText(text).width + 44 * s;
      ctx.font = `600 ${16 * s}px ${FONT}`;
      const lw = t.label ? ctx.measureText(t.label).width + 28 * s : 0;
      const bw = Math.max(tw, lw), bh = (t.label ? 96 : 70) * s, x = w - w * 0.03 - bw, y = h * 0.05;
      ctx.fillStyle = 'rgba(10,13,20,.86)'; ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = color; ctx.fillRect(x, y, bw, 5 * s);
      ctx.textAlign = 'center';
      if (t.label) { ctx.fillStyle = '#c9cfdb'; ctx.fillText(t.label, x + bw / 2, y + 24 * s); }
      ctx.fillStyle = numColor; ctx.font = `700 ${46 * s}px ${MONO}`;
      ctx.fillText(text, x + bw / 2, y + bh - 34 * s);
    } else if (t.style === 'bar') {
      const bh = 64 * s, y = h - h * 0.06 - bh;
      ctx.font = `700 ${38 * s}px ${MONO}`;
      const tw = ctx.measureText(text).width + 48 * s;
      ctx.font = `700 ${24 * s}px ${FONT}`;
      const lw = t.label ? ctx.measureText(t.label).width + 40 * s : 0;
      const x = (w - tw - lw) / 2;
      if (lw) { ctx.fillStyle = color; ctx.fillRect(x, y, lw, bh); ctx.fillStyle = color === '#e5e7eb' ? '#0b0d12' : '#fff'; ctx.textAlign = 'center'; ctx.fillText(t.label, x + lw / 2, y + bh / 2); }
      ctx.fillStyle = 'rgba(10,13,20,.9)'; ctx.fillRect(x + lw, y, tw, bh);
      ctx.fillStyle = numColor; ctx.font = `700 ${38 * s}px ${MONO}`; ctx.textAlign = 'center';
      ctx.fillText(text, x + lw + tw / 2, y + bh / 2 + 2 * s);
    } else {
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 24 * s;
      if (t.label) { ctx.fillStyle = color; fitFont(ctx, t.label, 700, 40 * s, FONT, w * 0.8); ctx.fillText(t.label, w / 2, h * 0.32); }
      ctx.fillStyle = numColor; ctx.font = `700 ${190 * s}px ${MONO}`;
      ctx.fillText(text, w / 2, h * 0.52);
    }
    ctx.restore();
  }

  /* -------------------------------------------------------- scoreboard */
  function drawScore(ctx, w, h, inp, clockText) {
    const sc = inp.score || {};
    const s = h / 720, x = w * 0.03, y = h * 0.05, rh = 40 * s;
    const nameW = 170 * s, scoreW = 58 * s;
    ctx.save();
    ctx.textBaseline = 'middle';
    const row = (i, name, score, color) => {
      const ry = y + i * rh;
      ctx.fillStyle = color || '#3b82f6'; ctx.fillRect(x, ry, 8 * s, rh - 2 * s);
      ctx.fillStyle = 'rgba(10,13,20,.88)'; ctx.fillRect(x + 8 * s, ry, nameW, rh - 2 * s);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      fitFont(ctx, name || '', 700, 22 * s, FONT, nameW - 24 * s);
      ctx.fillText(name || '', x + 20 * s, ry + rh / 2);
      ctx.fillStyle = '#f5f7fb'; ctx.fillRect(x + 8 * s + nameW, ry, scoreW, rh - 2 * s);
      ctx.fillStyle = '#0b0d12'; ctx.textAlign = 'center'; ctx.font = `800 ${24 * s}px ${MONO}`;
      ctx.fillText(String(score ?? 0), x + 8 * s + nameW + scoreW / 2, ry + rh / 2 + 1 * s);
    };
    row(0, sc.teamA, sc.scoreA, sc.colorA);
    row(1, sc.teamB, sc.scoreB, sc.colorB);
    const extra = [sc.period, clockText].filter(Boolean).join('  ');
    if (extra) {
      const ey = y + 2 * rh, ew = 8 * s + nameW + scoreW;
      ctx.fillStyle = 'rgba(245,165,36,.95)'; ctx.fillRect(x, ey, ew, 30 * s);
      ctx.fillStyle = '#0b0d12'; ctx.textAlign = 'center';
      fitFont(ctx, extra, 700, 18 * s, MONO, ew - 16 * s);
      ctx.fillText(extra, x + ew / 2, ey + 15 * s + 1 * s);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ ticker */
  // แถบตัววิ่งด้านล่าง: TICKER_BAR = สัดส่วนความสูงของแถบ (วาดลงพื้นที่แถบอย่างเดียว ไม่ต้องวาดทั้งจอทุกเฟรม)
  const TICKER_BAR = { y: 0.86, h: 0.075 };
  function tickerLine(inp) {
    const items = (inp.ticker?.items || []).map(x => String(x).trim()).filter(Boolean);
    return items.length ? items.join('   •   ') + '   •   ' : '';
  }
  // วาดเฉพาะแถบ ขนาด w × bh (มุมซ้ายบนของแถบ = 0,0)
  function drawTickerBar(ctx, w, bh, inp, now = Date.now()) {
    const tk = inp.ticker || {};
    const s = bh / (720 * TICKER_BAR.h);
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${22 * s}px ${FONT}`;
    const label = tk.label || '';
    const lw = label ? ctx.measureText(label).width + 40 * s : 0;
    ctx.fillStyle = 'rgba(10,13,20,.92)'; ctx.fillRect(lw, 0, w - lw, bh);
    const line = tickerLine(inp);
    if (line) {
      ctx.font = `600 ${24 * s}px ${FONT}`;
      const tw = ctx.measureText(line).width;
      const speed = (tk.speed || 90) * s; // พิกเซล/วินาที (เทียบที่ 720p)
      const off = (now / 1000 * speed) % tw;
      ctx.beginPath(); ctx.rect(lw, 0, w - lw, bh); ctx.clip();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      for (let x = lw - off; x < w; x += tw) ctx.fillText(line, x, bh / 2 + 1 * s);
    }
    if (label) {
      ctx.restore(); ctx.save(); ctx.textBaseline = 'middle';
      ctx.fillStyle = tk.color || '#ef4444'; ctx.fillRect(0, 0, lw, bh);
      ctx.fillStyle = tk.color === '#e5e7eb' ? '#0b0d12' : '#fff'; ctx.textAlign = 'center';
      ctx.font = `800 ${22 * s}px ${FONT}`; ctx.fillText(label, lw / 2, bh / 2 + 1 * s);
    }
    ctx.restore();
  }
  function drawTicker(ctx, w, h, inp, now) {
    const y = Math.round(h * TICKER_BAR.y), bh = Math.round(h * TICKER_BAR.h);
    ctx.save(); ctx.translate(0, y); drawTickerBar(ctx, w, bh, inp, now); ctx.restore();
  }

  /* ------------------------------------------------- Google Sheets / CSV */
  // ลิงก์แชร์ Google Sheets (…/spreadsheets/d/<id>/edit#gid=…) → ลิงก์ CSV ที่ดึงจากเบราว์เซอร์ได้
  // ชีตต้องแชร์แบบ “ทุกคนที่มีลิงก์ดูได้” หรือ “เผยแพร่ทางเว็บ” · ลิงก์ CSV อื่น ๆ ใช้ได้ตรง ๆ
  function sheetCsvUrl(url) {
    url = String(url || '').trim();
    const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/.exec(url);
    if (m && !/\/pub\?|output=csv|tqx=out:csv|format=csv/.test(url)) {
      const gid = (/[#&?]gid=(\d+)/.exec(url) || [])[1] || '0';
      return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
    }
    return url;
  }
  // ตัวอ่าน CSV (รองรับเครื่องหมายคำพูด, จุลภาค/ขึ้นบรรทัดในช่อง, "" แทน ")
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(x => x.trim())).filter(r => r.some(Boolean));
  }

  Object.assign(WM, { TIMER_MODES, TIMER_STYLES, timerElapsed, timerValue, timerText, fmtClock, drawTimer, drawScore,
    TICKER_BAR, tickerLine, drawTickerBar, drawTicker, sheetCsvUrl, parseCsv });
})(window.WebMix);
