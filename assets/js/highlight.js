/* คลิปไฮไลต์ 9:16: บัฟเฟอร์ภาพ Program + เสียงมาสเตอร์ย้อนหลัง — เครื่องบันทึกตัวเดียว ทุก 60 วินาทีปิดเป็นไฟล์ (ช่วงก่อนหน้า)
 แล้วเริ่มช่วงใหม่ทันที → มีภาพย้อนหลัง 60–120 วินาทีเสมอ โดยเข้ารหัสทีละตัว (ไม่ซ้อน 2 ตัวให้เครื่องหนัก)
 กดตัด = เก็บช่วงท้ายไว้ทันที (ไม่เข้ารหัสใหม่) · ทำคลิป = เล่นช่วงนั้น (ข้ามรอยต่อ 2 ไฟล์ได้) วาดลงแคนวาสแนวตั้งแล้วบันทึกเป็นไฟล์
 กรอบภาพ: ครอปกลาง (เลื่อนซ้าย/ขวาได้) หรือภาพเต็มบนพื้นเบลอ · ไฟล์ลงโฟลเดอร์ REC ถ้าเลือกไว้ ไม่อย่างนั้นดาวน์โหลด */
(function (WM) {
  'use strict';
  const { $, $$, esc, icon, fmtBytes, stamp, store, toast, downloadBlob, FONT, fitFont } = WM;

  // studio = สิ่งที่ต้องใช้จากสตูดิโอ (app.js)
  //   output        ภาพ Program + เสียงมาสเตอร์ (MediaStream) · audio  ระบบเสียง (AudioContext)
  //   streamer, rec สถานะไลฟ์ / บันทึก · pgmCanvas  แคนวาส Program (ภาพตัวอย่าง)
  //   height()      ความสูงของ Program ตอนนี้ · recFolder()  โฟลเดอร์ REC ที่เลือกไว้ (หรือ null)
  //   seekableClip, dialog, confirmDialog
  WM.createHighlights = function (studio) {
    const { output, audio, streamer, rec, pgmCanvas, seekableClip, dialog, confirmDialog } = studio;
    const HL_LENS = [15, 30, 60];
    // span = ความยาวต่อช่วง (ชุดทดสอบตั้งให้สั้นลงได้)
    const hl = { on: false, span: 60000, cur: null, prev: null, timer: null, mime: '', list: [], busy: null, cfg: { len: 30, frame: 'blur', x: 0.5, title: '' } };
    try { Object.assign(hl.cfg, store.get('hl-cfg', {})); } catch (e) {}
    const hlSupported = () => !!window.MediaRecorder && !(window.WebMix.wcrec && window.WebMix.wcrec.preferred());
    function hlSegment() {
      if (!hl.on) return;
      const old = hl.cur;
      try {
        const r = new MediaRecorder(output.get(), { ...(hl.mime ? { mimeType: hl.mime } : {}), videoBitsPerSecond: 4000000, audioBitsPerSecond: 128000 });
        const seg = { r, chunks: [], t0: performance.now(), type: r.mimeType || hl.mime || 'video/webm' };
        r.ondataavailable = e => { if (e.data.size) seg.chunks.push(e.data); };
        r.start(500);
        hl.cur = seg;
      } catch (e) { console.warn('highlight buffer', e); }
      if (old) {
        // ปิดช่วงเดิมเป็นไฟล์ที่เลื่อนตำแหน่งได้ — แทนที่ช่วงก่อนหน้าเมื่อพร้อม
        // (ยังไม่ซ่อมไฟล์ตรงนี้ — ซ่อมเฉพาะตอนกดตัด ไม่ให้เธรดหลักสะดุดทุกนาทีระหว่างไลฟ์)
        old.r.onstop = () => {
          const blob = new Blob(old.chunks, { type: old.type });
          old.chunks = [];
          if (hl.on) hl.prev = { blob, t0: old.t0, t1: performance.now(), type: old.type };
        };
        try { old.r.requestData(); old.r.stop(); } catch (e) {}
      }
    }
    function hlStart() {
      if (hl.on) return true;
      if (!hlSupported()) return false;
      hl.on = true;
      hl.mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      hlSegment();
      hl.timer = setInterval(hlSegment, hl.span);
      return true;
    }
    function hlStop() {
      hl.on = false;
      clearInterval(hl.timer); hl.timer = null;
      if (hl.cur) { try { hl.cur.r.stop(); } catch (e) {} hl.cur.chunks = []; }
      hl.cur = hl.prev = null;
      output.reset();
    }
    // วินาทีที่มีในบัฟเฟอร์ตอนนี้
    const hlBuffered = () => !hl.cur ? 0 : (performance.now() - (hl.prev ? hl.prev.t0 : hl.cur.t0)) / 1000;
    // ตัวจับเวลาใน Worker: วาดต่อได้แม้สลับไปแท็บอื่น (setInterval ในหน้าถูกหน่วงเหลือวินาทีละครั้ง)
    function workerTimer(ms, fn) {
      try {
        const w = new Worker(URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: 'text/javascript' })));
        w.onmessage = fn;
        return () => w.terminate();
      } catch (e) { const id = setInterval(fn, ms); return () => clearInterval(id); }
    }
    function hlDrawFrame(ctx, v, cw, ch, cfg) {
      const vw = v.videoWidth || v.width || 16, vh = v.videoHeight || v.height || 9;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
      if (cfg.frame === 'crop') {
        // เต็มจอแนวตั้ง: ตัดด้านข้างออก เลือกตำแหน่งได้ (0 = ซ้ายสุด · 1 = ขวาสุด)
        const s = Math.max(cw / vw, ch / vh), dw = vw * s, dh = vh * s;
        ctx.drawImage(v, (cw - dw) * cfg.x, (ch - dh) / 2, dw, dh);
      } else {
        // ภาพเต็มตรงกลาง + ภาพเดียวกันขยายเบลอเป็นพื้นหลัง
        const s = Math.max(cw / vw, ch / vh), bw = vw * s, bh = vh * s;
        ctx.save(); ctx.filter = 'blur(28px) brightness(0.55)'; ctx.drawImage(v, (cw - bw) / 2, (ch - bh) / 2, bw, bh); ctx.restore();
        const f = cw / vw, fh = vh * f;
        ctx.drawImage(v, 0, (ch - fh) / 2, cw, fh);
      }
      if (cfg.title) {
        const size = Math.round(cw * 0.065);
        ctx.save(); ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        fitFont(ctx, cfg.title, 800, size, FONT, cw * 0.88);
        ctx.lineWidth = Math.max(4, size * 0.16); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineJoin = 'round';
        ctx.strokeText(cfg.title, cw / 2, ch * 0.13); ctx.fillStyle = '#fff'; ctx.fillText(cfg.title, cw / 2, ch * 0.13);
        ctx.restore();
      }
    }
    // ขั้นที่ 1 (เร็ว ไม่เข้ารหัสใหม่): เก็บไฟล์ของช่วงปัจจุบัน (+ ช่วงก่อนหน้าถ้าต้องย้อนไกลกว่า)
    async function hlGrab(len) {
      const cur = hl.cur;
      if (!cur) throw new Error('ยังไม่ได้เปิดบัฟเฟอร์ไฮไลต์');
      try { cur.r.requestData(); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      const curSec = (performance.now() - cur.t0) / 1000, prevSec = hl.prev ? (hl.prev.t1 - hl.prev.t0) / 1000 : 0;
      const have = curSec + prevSec;
      if (!cur.chunks.length || have < 3) throw new Error('ภาพย้อนหลังยังไม่พอ — รอสักครู่แล้วลองใหม่');
      const want = Math.min(len, have);
      const segs = [];
      // ช่วงก่อนหน้าใส่ไว้ด้วยเมื่อช่วงปัจจุบันอาจไม่พอ — แบ่งความยาวจริงตอนทำคลิป (เวลาในไฟล์ ไม่ใช่เวลานาฬิกา)
      if (hl.prev && want > curSec - 3) segs.push(await seekableClip(hl.prev.blob, hl.prev.type));
      segs.push(await seekableClip(new Blob(cur.chunks, { type: cur.type }), cur.type));
      return { segs, have, len: want };
    }
    const hlLoad = blob => new Promise((res, rej) => {
      const v = document.createElement('video');
      v.playsInline = true; v.preload = 'auto';
      v.onloadedmetadata = () => res(v); v.onerror = () => rej(new Error('เปิดภาพย้อนหลังไม่ได้'));
      v.src = URL.createObjectURL(blob);
    });
    // ขั้นที่ 2 (ใช้เครื่องหนัก): เล่นช่วงนั้นต่อกัน วาดลงกรอบแนวตั้ง แล้วเข้ารหัสเป็นไฟล์
    async function hlRender(raw, cfg, onProgress) {
      const vids = [];
      for (const blob of raw.segs) vids.push(await hlLoad(blob));
      const first = vids[vids.length - 1];
      const big = (first.videoHeight || studio.height()) >= 900, cw = big ? 1080 : 720, ch = big ? 1920 : 1280;
      const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      // เสียงของคลิป: ผ่าน Web Audio ไปลงไฟล์เท่านั้น ไม่ดังออกลำโพง
      const ac = audio.ensure(), dest = ac.createMediaStreamDestination();
      const nodes = vids.map(v => { const n = ac.createMediaElementSource(v); n.connect(dest); return n; });
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      const out = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: big ? 8000000 : 5000000, audioBitsPerSecond: 160000 });
      const parts = [];
      out.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
      const durOf = v => isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const seek = (v, t) => new Promise(res => { v.onseeked = res; v.currentTime = t; setTimeout(res, 2000); });
      // แบ่งความยาวจากท้าย: ไฟล์ล่าสุดก่อน ที่เหลือเอาจากไฟล์ก่อนหน้า
      const starts = [], takes = [];
      let remain = raw.len;
      for (let i = vids.length - 1; i >= 0; i--) { const d = durOf(vids[i]); const t = Math.max(0, Math.min(remain, d)); takes[i] = t; starts[i] = Math.max(0, d - t); remain -= t; }
      const order = vids.map((v, i) => i).filter(i => takes[i] > 0.05);
      const total = order.reduce((a, i) => a + takes[i], 0) || raw.len;
      // เลื่อนทุกไฟล์ไปจุดเริ่มไว้ก่อน
      for (const i of order) await seek(vids[i], starts[i]);
      let k = 0, done0 = 0, cur = vids[order[0]];
      hlDrawFrame(ctx, cur, cw, ch, cfg);
      const stopTimer = workerTimer(1000 / 30, () => { hlDrawFrame(ctx, cur, cw, ch, cfg); onProgress?.(Math.min(1, (done0 + cur.currentTime - starts[order[k]]) / total)); });
      const finished = new Promise(res => { out.onstop = res; });
      out.start(1000);
      await cur.play().catch(() => {});
      for (; k < order.length; k++) {
        const i = order[k], v = vids[i], next = k + 1 < order.length ? vids[order[k + 1]] : null;
        // ใกล้จบไฟล์นี้: เริ่มเล่นไฟล์ถัดไปแบบปิดเสียงไว้ก่อน แล้วสลับเมื่อภาพเดินแล้ว — ภาพไม่ค้างตรงรอยต่อ
        await new Promise(res => {
          const t = setInterval(() => { if (v.ended || v.paused || v.currentTime >= starts[i] + takes[i] - (next ? 0.25 : 0.05)) { clearInterval(t); res(); } }, 20);
        });
        if (next) {
          next.muted = true;
          await next.play().catch(() => {});
          const s0 = starts[order[k + 1]];
          await new Promise(res => { const t0 = performance.now(), t = setInterval(() => { if (next.currentTime > s0 + 0.02 || v.ended || performance.now() - t0 > 1500) { clearInterval(t); res(); } }, 10); });
          await new Promise(res => { const t = setInterval(() => { if (v.ended || v.paused || v.currentTime >= starts[i] + takes[i] - 0.03) { clearInterval(t); res(); } }, 10); });
          next.muted = false; v.pause();
          done0 += takes[i];
          cur = next;
        }
      }
      stopTimer();
      out.stop();
      await finished;
      // ปิดทุกอย่างที่ใช้ทำคลิป (แทร็กแคนวาส ตัวถอดรหัสวิดีโอ) — ไม่ให้ค้างกินเครื่องระหว่างไลฟ์ต่อ
      stream.getTracks().forEach(t => t.stop());
      vids.forEach((v, i) => { v.pause(); nodes[i].disconnect(); URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); });
      const type = out.mimeType || mime || 'video/webm';
      const blob = new Blob(parts, { type });
      return { blob: type.includes('webm') ? await seekableClip(blob, type) : blob, len: total, ext: type.includes('mp4') ? 'mp4' : 'webm', w: cw, h: ch };
    }
    async function hlSave(item) {
      const recFolder = studio.recFolder();
      if (recFolder) {
        try {
          const fh = await recFolder.getFileHandle(item.name, { create: true });
          const w = await fh.createWritable(); await w.write(item.blob); await w.close();
          toast(`บันทึก “${item.name}” ลงโฟลเดอร์ ${recFolder.name} แล้ว`, 'success', 5000);
          return;
        } catch (e) { console.warn('highlight folder', e); }
      }
      downloadBlob(item.blob, item.name);
      toast(`ดาวน์โหลด “${item.name}” แล้ว`, 'success', 4000);
    }
    const hlLive = () => !!(streamer.ws || streamer.reconnecting || rec.active);
    // แปลงคลิปที่รออยู่ทีละคลิป · ระหว่างไลฟ์/บันทึกรอจนจบ (ไม่ให้ภาพไลฟ์สะดุด) เว้นแต่กด “แปลงตอนนี้”
    async function hlProcess(force) {
      if (hl.busy) return;
      const item = hl.list.find(it => it.state === 'wait' && (force === it || !hlLive()));
      if (!item) return;
      hl.busy = { p: 0, item };
      item.state = 'work';
      try {
        const r = await hlRender(item.raw, item.cfg, p => { hl.busy.p = p; });
        Object.assign(item, r, { state: 'done', raw: null, name: `WebMix-Highlight-${item.stamp}.${r.ext}`, url: URL.createObjectURL(r.blob) });
        await hlSave(item);
      } catch (e) { item.state = 'error'; item.error = e.message; toast(`ทำคลิปไม่สำเร็จ: ${e.message}`, 'error', 6000); }
      finally { hl.busy = null; hl.onChange?.(); }
      hlProcess();
    }
    setInterval(() => hlProcess(), 2000);
    async function hlCut(cfg) {
      const raw = await hlGrab(cfg.len);
      const item = { state: 'wait', raw, cfg: { ...cfg }, len: raw.len, at: Date.now(), stamp: stamp(), title: cfg.title };
      hl.list.unshift(item);
      for (let i = hl.list.length - 1; hl.list.length > 10 && i >= 0; i--) if (hl.list[i].state !== 'work') { const [old] = hl.list.splice(i, 1); if (old.url) URL.revokeObjectURL(old.url); }
      if (hlLive()) toast(`เก็บช่วง ${raw.len.toFixed(0)} วินาทีแล้ว — จะทำเป็นคลิป 9:16 ให้หลังจบไลฟ์ (ไลฟ์ไม่สะดุด) · กด “แปลงตอนนี้” ในหน้าต่างไฮไลต์ถ้าต้องการทันที`, 'success', 6000);
      hl.onChange?.();
      hlProcess();
      return item;
    }
    async function openHighlightDialog() {
      const recFolder = studio.recFolder();
      if (!hlSupported()) { toast('เครื่องนี้ทำคลิปไฮไลต์ไม่ได้ (ต้องใช้ Chrome / Edge หรือแอป Windows / macOS / Android)', 'warn', 6000); return; }
      hlStart();
      const c = hl.cfg;
      const when = it => new Date(it.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const listHtml = () => hl.list.map((it, i) => `<div class="hl-item" data-state="${it.state}">${it.url ? `<video src="${it.url}" muted playsinline preload="metadata"></video>` : '<span class="hl-thumb"></span>'}<div><b>${esc(it.title || 'ไฮไลต์')}</b><small>${it.len.toFixed(0)} วิ · ${when(it)} · ${it.state === 'done' ? `${it.w}×${it.h} · ${fmtBytes(it.blob.size)}` : it.state === 'work' ? 'กำลังทำคลิป…' : it.state === 'error' ? `ไม่สำเร็จ: ${esc(it.error || '')}` : hlLive() ? 'รอจบไลฟ์แล้วทำให้' : 'รอคิว'}</small></div>${it.state === 'done' ? `<button type="button" class="btn btn-sm" data-hl-save="${i}">${icon('download')} บันทึกอีกครั้ง</button>` : it.state === 'wait' ? `<button type="button" class="btn btn-sm" data-hl-now="${i}">แปลงตอนนี้</button>` : ''}</div>`).join('');
      const r = await dialog({
        title: 'คลิปไฮไลต์ 9:16',
        body: `
          <div class="hl-grid">
            <canvas class="hl-preview" width="216" height="384"></canvas>
            <div class="hl-side">
              <p class="note hl-buf"></p>
              <div class="field"><span>ความยาว (วินาทีล่าสุด)</span><div class="seg hl-len">${HL_LENS.map(n => `<button type="button" data-len="${n}" class="${n === c.len ? 'is-active' : ''}">${n} วิ</button>`).join('')}</div></div>
              <label class="field"><span>กรอบภาพ</span><select name="frame" class="select"><option value="blur" ${c.frame === 'blur' ? 'selected' : ''}>ภาพเต็มบนพื้นเบลอ</option><option value="crop" ${c.frame === 'crop' ? 'selected' : ''}>ครอปเต็มจอแนวตั้ง</option></select></label>
              <label class="field hl-x" ${c.frame === 'crop' ? '' : 'hidden'}><span>ตำแหน่งครอป (ซ้าย ↔ ขวา)</span><input type="range" name="x" min="0" max="1" step="0.01" value="${c.x}"></label>
              <label class="field"><span>ข้อความบนคลิป (ไม่บังคับ)</span><input name="title" class="input" maxlength="60" value="${esc(c.title)}" placeholder="เช่น ประตูชัย นาทีที่ 89"></label>
              <button type="button" class="btn btn-primary hl-cut">${icon('scissors')} ตัดคลิป</button>
              <div class="hl-progress" hidden><div class="hl-bar"><i></i></div><small></small></div>
            </div>
          </div>
          <div class="hl-list">${listHtml()}</div>
          <p class="note">บัฟเฟอร์ทำงานต่อหลังปิดหน้าต่างนี้ — เกิดช็อตเด็ดกด H หรือปุ่มกรรไกรแล้วกด “ตัดคลิป” · ไฟล์ลง${recFolder ? `โฟลเดอร์ ${esc(recFolder.name)}` : 'โฟลเดอร์ดาวน์โหลด'} · บัฟเฟอร์ใช้หน่วยความจำราว 60 MB</p>`,
        actions: [{ label: 'ปิดบัฟเฟอร์', value: 'off' }, { label: 'ปิด', primary: true }],
        onOpen(modal) {
          const pv = $('.hl-preview', modal), pctx = pv.getContext('2d');
          modal.addEventListener('input', () => {
            c.frame = $('[name=frame]', modal).value; c.x = +$('[name=x]', modal).value; c.title = $('[name=title]', modal).value.trim();
            $('.hl-x', modal).hidden = c.frame !== 'crop';
            store.set('hl-cfg', c);
          });
          modal.addEventListener('click', async e => {
            const len = e.target.closest('[data-len]');
            if (len) { c.len = +len.dataset.len; $$('.hl-len button', modal).forEach(x => x.classList.toggle('is-active', x === len)); store.set('hl-cfg', c); return; }
            const sv = e.target.closest('[data-hl-save]');
            if (sv) { hlSave(hl.list[+sv.dataset.hlSave]); return; }
            const now = e.target.closest('[data-hl-now]');
            if (now) {
              const it = hl.list[+now.dataset.hlNow];
              if (hlLive() && !(await confirmDialog('แปลงคลิปตอนนี้?', 'กำลังไลฟ์ / บันทึกอยู่ — การทำคลิปใช้เครื่องหนัก ภาพที่ออกอากาศอาจกระตุกระหว่างนี้ (ราวเท่าความยาวคลิป)', 'แปลงตอนนี้'))) return;
              hlProcess(it); return;
            }
            if (e.target.closest('.hl-cut')) {
              try { await hlCut({ ...c }); } catch (err) { toast(`ตัดคลิปไม่สำเร็จ: ${err.message}`, 'error', 6000); }
            }
          });
          let sig = '';
          hl.onChange = () => { if (modal.isConnected) { $('.hl-list', modal).innerHTML = listHtml(); sig = ''; } };
          // ภาพตัวอย่างกรอบ 9:16 จาก Program ปัจจุบัน · เวลาที่มีในบัฟเฟอร์ · ความคืบหน้า
          const tick = setInterval(() => {
            if (!modal.isConnected) { clearInterval(tick); return; }
            hlDrawFrame(pctx, pgmCanvas, pv.width, pv.height, c);
            const sec = Math.floor(hlBuffered());
            $('.hl-buf', modal).textContent = sec < c.len ? `กำลังเก็บภาพย้อนหลัง — มีแล้ว ${sec} วินาที (ตัดตอนนี้ได้คลิปยาว ${sec} วินาที)` : `พร้อมตัด — มีภาพย้อนหลัง ${Math.min(sec, 120)} วินาที`;
            const busy = hl.busy, pr = $('.hl-progress', modal);
            pr.hidden = !busy;
            $('.hl-cut', modal).disabled = sec < 3;
            const ns = hl.list.map(it => it.state).join() + hlLive();
            if (ns !== sig) { sig = ns; $('.hl-list', modal).innerHTML = listHtml(); }
            if (busy) { $('.hl-bar i', modal).style.width = `${Math.round(busy.p * 100)}%`; $('small', pr).textContent = `กำลังทำคลิป ${Math.round(busy.p * 100)}% — ใช้เวลาเท่าความยาวคลิป ไลฟ์ไม่สะดุด`; }
          }, 500);
        }
      });
      if (r?.value === 'off') { hlStop(); toast('ปิดบัฟเฟอร์ไฮไลต์แล้ว', 'info'); }
    }

    return { hl, openHighlightDialog };
  };
})(window.WebMix = window.WebMix || {});
