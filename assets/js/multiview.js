/* WebMix — Multiview: จอรวมสำหรับจอที่สอง (Preview/Program + ทุก Input พร้อม tally และมิเตอร์เสียง) */
(function (WM) {
  'use strict';
  const { toast, fitFont, FONT, MONO } = WM;

  /* ------------------------------------------------------------ multiview */
  // จอรวมสำหรับผู้ควบคุม/ทีมงาน: Preview + Program ด้านบน, ทุก Input ด้านล่างพร้อม tally และมิเตอร์เสียง
  // วาดเฉพาะตอนเปิดหน้าต่าง Multiview ที่ 15 fps แล้วส่งภาพไปหน้าต่างนั้น (ลากไปจอที่สองแล้วดับเบิลคลิกเต็มจอ)
  const createMultiview = ctx => ({
    canvas: null, ctx: null, win: null, track: null, timer: null,
    W: 1920, H: 1080,
    open() {
      if (this.win && !this.win.closed) { this.win.focus(); return; }
      if (WM.desktop && WM.desktop.mobile) { toast('แอป Android เปิดหน้าต่าง Multiview แยกไม่ได้', 'warn'); return; }
      const win = window.open('about:blank', 'webmix-multiview', 'width=1280,height=720');
      if (!win) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต Pop-up สำหรับเว็บนี้ก่อน', 'warn'); return; }
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.W; this.canvas.height = this.H;
        this.ctx = this.canvas.getContext('2d');
      }
      this.draw();
      win.document.open();
      win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>WebMix — Multiview</title>
        <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block}
        p{position:fixed;left:0;right:0;bottom:12px;margin:0;text-align:center;font:12px system-ui;color:#666;transition:opacity 1s}</style></head>
        <body><video autoplay muted playsinline></video><p>ดับเบิลคลิกเพื่อเต็มจอ</p>
        <script>document.addEventListener('dblclick',()=>{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()});setTimeout(()=>document.querySelector('p').style.opacity=0,3000)<\/script></body></html>`);
      win.document.close();
      this.track = this.canvas.captureStream(15).getVideoTracks()[0];
      const v = win.document.querySelector('video');
      v.srcObject = new MediaStream([this.track]);
      v.play().catch(() => {});
      this.win = win;
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (!this.win || this.win.closed) { this.close(); return; }
        this.draw();
      }, 1000 / 15);
    },
    close() {
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
        g.strokeStyle = color; g.lineWidth = isPgm || ov >= 0 || isPvw ? 5 : 2;
        g.strokeRect(tx + g.lineWidth / 2, ty + g.lineWidth / 2, tw - g.lineWidth, th - g.lineWidth);
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
