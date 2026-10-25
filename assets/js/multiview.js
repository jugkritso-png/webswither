/* WebMix — Multiview: จอรวมสำหรับจอที่สอง (Preview/Program + ทุก Input พร้อม tally และมิเตอร์เสียง) */
(function (WM) {
  'use strict';
  const { toast, fitFont, FONT, MONO } = WM;

  /* ------------------------------------------------------------ multiview */
  // จอรวมสำหรับผู้ควบคุม/ทีมงาน: Preview + Program ด้านบน, ทุก Input ด้านล่างพร้อม tally และมิเตอร์เสียง
  // วาดเฉพาะตอนเปิดหน้าต่าง Multiview ที่ 15 fps แล้วส่งภาพไปหน้าต่างนั้น (ลากไปจอที่สองแล้วกดปุ่มเต็มจอ)
  // สลับภาพจาก Multiview ได้: แตะแหล่งภาพครั้งแรก = Preview (กรอบเขียว) · แตะแหล่งภาพเดิมอีกครั้ง = ขึ้น Program (กรอบแดง)
  // แตะจอ PREVIEW ใหญ่ = ขึ้น Program · คีย์บอร์ด: 1–9 เลือก Preview, Space = Cut, Enter = Auto
  const createMultiview = ctx => (ctx.meterPct && (ctx_meterPct = ctx.meterPct), {
    canvas: null, ctx: null, win: null, track: null, timer: null, hover: -1, flash: null, inline: null,
    W: 1920, H: 1080,
    ensureCanvas() {
      if (this.canvas) return;
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.W; this.canvas.height = this.H;
      this.ctx = this.canvas.getContext('2d');
    },
    // มือถือ/แอป Android เปิดหน้าต่างแยกไม่ได้ (หรือเบราว์เซอร์บล็อก pop-up) → เปิด Multiview เต็มจอในหน้าเดียวกัน
    open() {
      if (this.inline) return;
      if (this.win && !this.win.closed) { this.win.focus(); return; }
      // จอสัมผัส (มือถือ/แท็บเล็ต): หน้าต่างใหม่กลายเป็นแท็บใหม่ที่บังหน้าหลัก — เปิดเต็มจอในหน้าเดียวกันแทน
      const touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
      if ((WM.desktop && WM.desktop.mobile) || touch) { this.openInline(); return; }
      const win = window.open('about:blank', 'webmix-multiview', 'width=1280,height=720');
      if (!win) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — เปิด Multiview ในหน้านี้แทน (อนุญาต Pop-up เพื่อลากไปจอที่สอง)', 'warn', 6000); this.openInline(); return; }
      this.ensureCanvas();
      this.draw();
      win.document.open();
      win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>WebMix — Multiview</title>
        <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block}
        video{cursor:pointer;touch-action:manipulation}
        p{position:fixed;left:0;right:0;bottom:12px;margin:0;text-align:center;font:13px system-ui;color:#8b94a7;transition:opacity 1s;pointer-events:none}
        button{position:fixed;bottom:10px;right:10px;padding:8px 14px;border-radius:8px;border:1px solid #3a4250;background:rgba(15,18,24,.85);color:#e8ecf1;font:600 13px system-ui;cursor:pointer;opacity:0;transition:opacity .3s}
        body:hover button,button:focus-visible{opacity:1}</style></head>
        <body><video autoplay muted playsinline></video><button type="button">เต็มจอ</button>
        <p>คลิกภาพ = Preview · ดับเบิลคลิก = ตัดเข้า Program · คีย์ 1–9 / Space / Enter · Esc = ปิด</p>
        <script>document.querySelector('button').addEventListener('click',()=>{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()});setTimeout(()=>document.querySelector('p').style.opacity=0,6000)<\/script></body></html>`);
      win.document.close();
      this.track = this.canvas.captureStream(15).getVideoTracks()[0];
      const v = win.document.querySelector('video');
      v.srcObject = new MediaStream([this.track]);
      v.play().catch(() => {});
      this.bindControls(win, v);
      this.win = win;
      this.startTimer(() => {
        if (!this.win || this.win.closed) { this.close(); return; }
        this.draw();
      });
    },
    // ตำแหน่งบนหน้าต่าง → ตำแหน่งบนภาพ 1920×1080 (วิดีโอแสดงแบบ contain จึงอาจมีขอบดำ)
    toCanvas(v, e) {
      const r = v.getBoundingClientRect();
      const k = Math.min(r.width / this.W, r.height / this.H);
      return { x: (e.clientX - r.left - (r.width - this.W * k) / 2) / k, y: (e.clientY - r.top - (r.height - this.H * k) / 2) / k };
    },
    hit(x, y) {
      const L = this.layout(ctx.inputs.length);
      if (y >= L.top && y < L.top + L.mainH) return x < 960 ? 'pvw' : 'pgm';
      if (y < L.gridTop || x < 0 || x >= this.W) return null;
      const i = Math.floor(x / L.tw) + Math.floor((y - L.gridTop) / L.th) * L.cols;
      return i >= 0 && i < ctx.inputs.length ? i : null;
    },
    pick(target) {
      if (target === 'pvw') { if (ctx.state.previewId) ctx.cut(); return; }
      if (typeof target !== 'number') return;
      const inp = ctx.inputs[target];
      if (!inp) return;
      if (inp.id === ctx.state.programId) { this.flash = { i: target, at: performance.now() }; return; }
      if (inp.id === ctx.state.previewId) ctx.cut();
      else ctx.setPreview(inp.id);
      this.draw();
    },
    bindControls(win, v) {
      v.addEventListener('click', e => { const p = this.toCanvas(v, e); this.pick(this.hit(p.x, p.y)); });
      v.addEventListener('pointermove', e => {
        const p = this.toCanvas(v, e), h = this.hit(p.x, p.y);
        this.hover = typeof h === 'number' ? h : -1;
        v.style.cursor = h === null || h === 'pgm' ? 'default' : 'pointer';
      });
      v.addEventListener('pointerleave', () => { this.hover = -1; });
      if (!win) return;
      win.addEventListener('keydown', e => {
        if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
        if (/^[1-9]$/.test(e.key)) { const inp = ctx.inputs[+e.key - 1]; if (inp && inp.id !== ctx.state.programId) ctx.setPreview(inp.id); }
        else if (e.key === ' ') ctx.cut();
        else if (e.key === 'Enter') ctx.auto();
        else if (e.key === 'Escape' && !win.document.fullscreenElement) { win.close(); this.close(); }
        else return;
        e.preventDefault();
        this.draw();
      });
    },
    openInline() {
      this.ensureCanvas();
      this.draw();
      const el = document.createElement('div');
      el.className = 'mv-inline';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Multiview');
      el.innerHTML = '<button type="button" class="btn mv-close">ปิด Multiview</button><p class="mv-hint">แตะแหล่งภาพ = Preview · แตะซ้ำ = ขึ้น Program</p>';
      el.prepend(this.canvas);
      document.body.appendChild(el);
      this.inline = el;
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
      el.querySelector('.mv-close').addEventListener('click', () => this.close());
      document.addEventListener('keydown', onKey);
      this.offKey = () => document.removeEventListener('keydown', onKey);
      // คีย์ลัดอื่น (1–9, Space, Enter) ใช้ของหน้าหลักอยู่แล้ว — ผูกเฉพาะการแตะ
      this.bindControls(null, this.canvas);
      setTimeout(() => el.querySelector('.mv-hint')?.classList.add('is-hidden'), 5000);
      this.startTimer(() => this.draw());
    },
    // จับเวลาด้วย Worker: หน้าหลักถูกบัง/อยู่เบื้องหลัง (หน้าต่าง Multiview ทับ หรือเปิดเป็นแท็บใหม่บนแท็บเล็ต)
    // เบราว์เซอร์จะชะลอ setInterval ของหน้าหลักเหลือ ≤ 1 ครั้ง/วินาที — ภาพ Multiview จะไม่อัปเดตหลังแตะสลับ
    startTimer(fn) {
      this.stopTimer();
      const every = WM.wcrec && WM.wcrec.every;
      const stop = every ? every(fn, 1000 / 15) : (id => () => clearInterval(id))(setInterval(fn, 1000 / 15));
      this.timer = stop;
    },
    stopTimer() {
      if (typeof this.timer === 'function') this.timer();
      this.timer = null;
    },
    close() {
      if (this.inline) { this.inline.remove(); this.inline = null; this.offKey?.(); this.offKey = null; this.canvas = null; this.ctx = null; }
      this.stopTimer();
      if (this.track) this.track.stop();
      this.track = null;
      this.win = null;
    },
    // ตามดีไซน์: แถบบน 54 · Preview/Program ครึ่งจอ · แหล่งภาพเต็มพื้นที่ที่เหลือ (อย่างน้อย 2 แถว × 4 ช่อง)
    layout(n) {
      const top = 60, mainH = 580, gridTop = top + mainH + 6, gridH = this.H - gridTop - 6;
      let cols = 4;
      for (const c of [4, 5, 6, 8, 10]) {
        cols = c;
        const th = (this.W / c) * 9 / 16;
        if (Math.ceil(n / c) * th <= gridH) break;
      }
      const tw = this.W / cols, rows = Math.ceil(n / cols);
      const th = Math.min(gridH / Math.max(2, rows), tw * 9 / 16);
      return { top, mainH, gridTop, cols, tw, th };
    },
    draw() {
      const g = this.ctx, Wm = this.W, Hm = this.H;
      const L = this.layout(ctx.inputs.length);
      const C = { pgm: '#E5484D', pvw: '#2EA36B', pgmTag: '#C8323A', pvwTag: '#18794E', idle: '#1A1F28', mute: '#9AA4B2', amber: '#F0B44C' };
      g.fillStyle = '#000'; g.fillRect(0, 0, Wm, Hm);
      // แถบบน: ชื่อ · ON AIR + เวลาออกอากาศ · REC/บิตเรต/fps · วิธีใช้ · นาฬิกา
      g.fillStyle = '#0B0E13'; rr(g, 6, 6, Wm - 12, 48, 6); g.fill();
      g.textBaseline = 'middle'; g.textAlign = 'left';
      let x = 24; const y = 30;
      g.fillStyle = '#E8ECF1'; g.font = `700 19px ${FONT}`; g.fillText('WebMix · Multiview', x, y); x += g.measureText('WebMix · Multiview').width + 22;
      const live = ctx.streamer.active || ctx.streamer.reconnecting;
      if (live) {
        g.font = `700 16px ${FONT}`; const w = g.measureText('ON AIR').width + 40;
        g.fillStyle = C.pgmTag; rr(g, x, y - 14, w, 28, 5); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 14, y, 4.5, 0, 7); g.fill();
        g.fillText('ON AIR', x + 26, y + 1); x += w + 16;
        g.fillStyle = C.amber; g.font = `600 22px ${MONO}`; const t = ctx.onAirText(); g.fillText(t, x, y + 1); x += g.measureText(t).width + 20;
      }
      const bits = [];
      if (ctx.rec.active) bits.push(`REC ${fmtClock(Date.now() - ctx.rec.start)}`);
      if (live) bits.push(`${(ctx.streamer.kbps / 1000).toFixed(1)} Mbps`);
      bits.push(`${ctx.fps} fps`);
      g.fillStyle = C.mute; g.font = `500 16px ${MONO}`; g.fillText(bits.join(' · '), x, y + 1);
      g.textAlign = 'right'; g.fillStyle = '#E8ECF1'; g.font = `600 24px ${MONO}`;
      const clock = new Date().toLocaleTimeString('th-TH', { hour12: false });
      g.fillText(clock, Wm - 24, y + 1);
      const cw = g.measureText(clock).width;
      g.fillStyle = C.mute; g.font = `500 16px ${FONT}`;
      g.fillText('คลิกภาพ = Preview · ดับเบิลคลิก = ตัดเข้า Program · Esc = ปิด', Wm - 24 - cw - 28, y + 1);
      // Preview / Program
      const halfW = (Wm - 18) / 2;
      const box = (src, bx, label, tagColor, border, name, ch) => {
        g.drawImage(src, bx, L.top, halfW, L.mainH);
        g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(bx + 3, L.top + 3, halfW - 6, L.mainH - 6);
        const bh = 46, by = L.top + L.mainH - bh - 6;
        g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(bx + 6, by, halfW - 12, bh);
        g.font = `700 18px ${FONT}`; g.textAlign = 'left';
        const tw = g.measureText(label).width + 22;
        g.fillStyle = tagColor; rr(g, bx + 20, by + 9, tw, 28, 4); g.fill();
        g.fillStyle = '#fff'; g.fillText(label, bx + 31, by + bh / 2 + 1);
        g.font = `700 19px ${FONT}`; g.fillText(name, bx + 20 + tw + 14, by + bh / 2 + 1);
        if (ch) meter(g, ch, bx + halfW - 120, by + bh / 2 - 4, 90, 8);
      };
      const pvw = ctx.byId(ctx.state.previewId), pgm = ctx.byId(ctx.state.programId);
      box(ctx.pvwCanvas, 6, 'PREVIEW', C.pvwTag, C.pvw, pvw?.name || '—', null);
      box(ctx.pgmCanvas, 12 + halfW, 'PROGRAM', C.pgmTag, C.pgm, pgm?.name || '—', ctx.audio.channels.find(c => c.inputId === pgm?.id));
      // ทุกแหล่งภาพ
      ctx.inputs.forEach((inp, i) => {
        const cx = (i % L.cols) * L.tw, cy = L.gridTop + Math.floor(i / L.cols) * L.th;
        const pad = 3, tw = L.tw - pad * 2, th = L.th - pad * 2, tx = cx + pad, ty = cy + pad;
        g.fillStyle = '#0B0E13'; g.fillRect(tx, ty, tw, th);
        // ภาพเต็มกว้าง 16:9 ตรงกลางช่อง (ช่องเตี้ยกว่า 16:9 → ครอบตัดบน/ล่าง)
        g.save(); g.beginPath(); g.rect(tx, ty, tw, th); g.clip();
        const ih = tw * 9 / 16; g.translate(tx, ty + (th - ih) / 2);
        ctx.drawSource(g, inp, tw, ih);
        g.restore();
        const isPgm = inp.id === ctx.state.programId, ov = ctx.ovl.findIndex(c => c.on && c.inputId === inp.id), isPvw = inp.id === ctx.state.previewId;
        const color = isPgm || ov >= 0 ? C.pgm : isPvw ? C.pvw : C.idle;
        g.strokeStyle = color; g.lineWidth = isPgm || ov >= 0 || isPvw ? 5 : 3;
        g.strokeRect(tx + g.lineWidth / 2, ty + g.lineWidth / 2, tw - g.lineWidth, th - g.lineWidth);
        // เมาส์ชี้อยู่ (ยังไม่ได้เลือก): กรอบประสีขาว บอกว่าแตะได้
        if (i === this.hover && !isPgm && !isPvw) {
          g.save(); g.setLineDash([12, 8]); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3;
          g.strokeRect(tx + 4, ty + 4, tw - 8, th - 8); g.restore();
        }
        // แตะภาพที่ออกอากาศอยู่แล้ว: กะพริบสั้น ๆ ให้รู้ว่าเป็น Program อยู่แล้ว
        if (this.flash && this.flash.i === i && performance.now() - this.flash.at < 500) {
          g.fillStyle = 'rgba(239,68,68,.25)'; g.fillRect(tx, ty, tw, th);
        }
        // เลขช่อง (มุมซ้ายบน)
        g.font = `600 18px ${MONO}`; g.textAlign = 'center';
        const nb = String(i + 1), nw = Math.max(30, g.measureText(nb).width + 14);
        g.fillStyle = 'rgba(0,0,0,.7)'; rr(g, tx + 10, ty + 9, nw, 30, 4); g.fill();
        g.fillStyle = '#fff'; g.fillText(nb, tx + 10 + nw / 2, ty + 25);
        // แถบชื่อ + สถานะ + มิเตอร์
        const lh = Math.min(38, Math.max(26, th * 0.17)), ly = ty + th - lh - 3;
        g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(tx + 3, ly, tw - 6, lh);
        const ch = ctx.audio.channels.find(c => c.inputId === inp.id);
        const tag = isPgm ? 'PGM' : ov >= 0 ? `OV${ov + 1}` : isPvw ? 'PVW' : inp.status !== 'live' ? 'NO SIGNAL' : '';
        let right = tx + tw - 14;
        if (ch) { meter(g, ch, right - 80, ly + lh / 2 - 4, 80, 8); right -= 92; }
        if (tag) {
          g.font = `800 ${Math.round(lh * 0.48)}px ${MONO}`; g.textAlign = 'right';
          g.fillStyle = tag === 'NO SIGNAL' ? '#f87171' : color;
          g.fillText(tag, right, ly + lh / 2 + 1); right -= g.measureText(tag).width + 12;
        }
        g.textAlign = 'left'; g.fillStyle = '#fff';
        fitFont(g, inp.name, 600, lh * 0.5, FONT, Math.max(40, right - tx - 16));
        g.fillText(inp.name, tx + 14, ly + lh / 2 + 1);
      });
    }
  });
  // มิเตอร์แนวนอนตามดีไซน์ (เขียวบนพื้นเทา, เหลือง/แดงเมื่อดัง)
  const meter = (g, ch, x, y, w, h) => {
    const lvl = Math.max(0, Math.min(1, ctx_meterPct(ch.level)));
    g.fillStyle = '#2A313D'; rr(g, x, y, w, h, h / 2); g.fill();
    g.fillStyle = ch.level > -6 ? '#E5484D' : ch.level > -18 ? '#F0B44C' : '#2EA36B';
    if (lvl > 0) { rr(g, x, y, Math.max(h, w * lvl), h, h / 2); g.fill(); }
  };
  let ctx_meterPct = v => Math.max(0, Math.min(1, (v + 60) / 60));
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600, (s % 3600) / 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':'); };

  Object.assign(WM, { createMultiview });
})(window.WebMix);
