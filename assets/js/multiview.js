/* WebMix — Multiview: จอรวมสำหรับจอที่สอง (Preview/Program + ทุก Input พร้อม tally และมิเตอร์เสียง) */
(function (WM) {
  'use strict';
  const { toast, fitFont, FONT, MONO } = WM;

  /* ------------------------------------------------------------ multiview */
  // จอรวมสำหรับผู้ควบคุม/ทีมงาน: Preview + Program ด้านบน, ทุก Input ด้านล่างพร้อม tally และมิเตอร์เสียง
  // วาดเฉพาะตอนเปิดหน้าต่าง Multiview ที่ 15 fps แล้วส่งภาพไปหน้าต่างนั้น (ลากไปจอที่สองแล้วกดปุ่มเต็มจอ)
  // สลับภาพจาก Multiview ได้: แตะแหล่งภาพครั้งแรก = Preview (กรอบเขียว) · แตะแหล่งภาพเดิมอีกครั้ง = ขึ้น Program (กรอบแดง)
  // แตะจอ PREVIEW ใหญ่ = ขึ้น Program · คีย์บอร์ด: 1–9 เลือก Preview, Space = Cut, Enter = Auto
  const createMultiview = ctx => ({
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
      const phone = matchMedia('(max-width: 760px), (pointer: coarse) and (orientation: landscape) and (max-height: 500px)').matches;
      if ((WM.desktop && WM.desktop.mobile) || phone) { this.openInline(); return; }
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
        <p>แตะแหล่งภาพ = Preview · แตะซ้ำ = ขึ้น Program · คีย์ 1–9 / Space / Enter</p>
        <script>document.querySelector('button').addEventListener('click',()=>{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()});setTimeout(()=>document.querySelector('p').style.opacity=0,6000)<\/script></body></html>`);
      win.document.close();
      this.track = this.canvas.captureStream(15).getVideoTracks()[0];
      const v = win.document.querySelector('video');
      v.srcObject = new MediaStream([this.track]);
      v.play().catch(() => {});
      this.bindControls(win, v);
      this.win = win;
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (!this.win || this.win.closed) { this.close(); return; }
        this.draw();
      }, 1000 / 15);
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
      clearInterval(this.timer);
      this.timer = setInterval(() => this.draw(), 1000 / 15);
    },
    close() {
      if (this.inline) { this.inline.remove(); this.inline = null; this.offKey?.(); this.offKey = null; this.canvas = null; this.ctx = null; }
      clearInterval(this.timer);
      this.timer = null;
      if (this.track) this.track.stop();
      this.track = null;
      this.win = null;
    },
    layout(n) {
      const top = 44, mainH = 540, gridTop = top + mainH + 8, gridH = this.H - gridTop;
      let cols = 4;
      for (const c of [4, 5, 6, 8, 10]) {
        cols = c;
        const tw = this.W / c, th = tw * 9 / 16;
        if (Math.ceil(n / c) * th <= gridH) break;
      }
      const tw = this.W / cols, th = tw * 9 / 16;
      return { top, mainH, gridTop, cols, tw, th };
    },
    draw() {
      const g = this.ctx, Wm = this.W, Hm = this.H;
      const L = this.layout(ctx.inputs.length);
      g.fillStyle = '#05060a'; g.fillRect(0, 0, Wm, Hm);
      // แถบบน: เวลา, ON AIR, สถานะสตรีม/บันทึก
      g.textBaseline = 'middle';
      g.fillStyle = '#e7eaf0'; g.font = `700 26px ${MONO}`; g.textAlign = 'left';
      g.fillText(new Date().toLocaleTimeString('th-TH', { hour12: false }), 16, 22);
      const live = ctx.streamer.active || ctx.streamer.reconnecting;
      const chips = [[live ? `● STREAM ${ctx.onAirText()}` : 'STREAM OFF', live ? '#ef4444' : '#5d6578'], [ctx.rec.active ? '● REC' : 'REC OFF', ctx.rec.active ? '#ef4444' : '#5d6578'],
        [`${ctx.formatTag(ctx.H, ctx.fps)}`, '#8b94a7']];
      g.textAlign = 'right'; g.font = `700 20px ${MONO}`;
      let x = Wm - 16;
      for (const [text, color] of chips.reverse()) { g.fillStyle = color; g.fillText(text, x, 22); x -= g.measureText(text).width + 28; }
      // Preview / Program
      const box = (src, bx, label, color, name) => {
        g.drawImage(src, bx, L.top, 952, L.mainH - 4);
        g.strokeStyle = color; g.lineWidth = 4; g.strokeRect(bx + 2, L.top + 2, 948, L.mainH - 8);
        g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(bx + 4, L.top + L.mainH - 46, 944, 38);
        g.textAlign = 'left'; g.font = `800 20px ${FONT}`; g.fillStyle = color; g.fillText(label, bx + 16, L.top + L.mainH - 27);
        g.fillStyle = '#fff'; g.font = `600 20px ${FONT}`; g.fillText(name, bx + 140, L.top + L.mainH - 27);
      };
      box(ctx.pvwCanvas, 4, 'PREVIEW', '#22c55e', ctx.byId(ctx.state.previewId)?.name || '—');
      box(ctx.pgmCanvas, 964, 'PROGRAM', '#ef4444', ctx.byId(ctx.state.programId)?.name || '—');
      // ทุก Input
      ctx.inputs.forEach((inp, i) => {
        const cx = (i % L.cols) * L.tw, cy = L.gridTop + Math.floor(i / L.cols) * L.th;
        const pad = 3, tw = L.tw - pad * 2, th = L.th - pad * 2, tx = cx + pad, ty = cy + pad;
        g.save();
        g.translate(tx, ty);
        g.beginPath(); g.rect(0, 0, tw, th); g.clip();
        ctx.drawSource(g, inp, tw, th);
        g.restore();
        const isPgm = inp.id === ctx.state.programId, ov = ctx.ovl.findIndex(c => c.on && c.inputId === inp.id), isPvw = inp.id === ctx.state.previewId;
        const color = isPgm || ov >= 0 ? '#ef4444' : isPvw ? '#22c55e' : '#2f3644';
        g.strokeStyle = color; g.lineWidth = isPgm || ov >= 0 || isPvw ? 6 : 2;
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
        const lh = Math.max(22, th * 0.15);
        g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(tx + 5, ty + th - lh - 5, tw - 10, lh);
        g.textAlign = 'left'; g.fillStyle = '#fff';
        fitFont(g, `${i + 1}  ${inp.name}`, 600, lh * 0.62, FONT, tw - 90);
        g.fillText(`${i + 1}  ${inp.name}`, tx + 12, ty + th - lh / 2 - 5);
        const tag = isPgm ? 'PGM' : ov >= 0 ? `OV${ov + 1}` : isPvw ? 'PVW' : inp.status !== 'live' ? 'NO SIGNAL' : '';
        if (tag) {
          g.font = `800 ${lh * 0.55}px ${MONO}`; g.textAlign = 'right';
          g.fillStyle = tag === 'NO SIGNAL' ? '#f87171' : color;
          g.fillText(tag, tx + tw - 12, ty + th - lh / 2 - 5);
        }
        // มิเตอร์เสียงของ Input นี้ (แถบแนวตั้งขวามือ)
        const ch = ctx.audio.channels.find(c => c.inputId === inp.id);
        if (ch) {
          const mh = th - lh - 20, lvl = ctx.meterPct(ch.level);
          g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(tx + tw - 18, ty + 8, 10, mh);
          g.fillStyle = ch.level > -6 ? '#ef4444' : ch.level > -18 ? '#f5a524' : '#22c55e';
          g.fillRect(tx + tw - 18, ty + 8 + mh * (1 - lvl), 10, mh * lvl);
        }
      });
    }
  });

  Object.assign(WM, { createMultiview });
})(window.WebMix);
