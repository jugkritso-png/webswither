/* ฉากเสมือน (Virtual Set)
   กล้องฉากเขียว → คีย์ (ใช้ตัวคีย์ GPU เดียวกับ Overlay) → วางบนฉาก (วาดในแอป หรือรูปของเราเอง) → กล้องเสมือนครอปซูม
   ฉากข่าวมีโต๊ะผู้ประกาศอยู่หน้าคน และจอทีวีหลังคนที่แสดงแหล่งภาพอื่นได้ · เปลี่ยนมุมกล้อง กว้าง/กลาง/ใกล้ แบบเคลื่อนนุ่ม */
(function (WM) {
  'use strict';
  const { $, clamp, esc, icon, mediaStore, toast } = WM;

  // ctx = สิ่งที่ใช้จากสตูดิโอ (app.js): addInput, cardSub, dialog, disposeInput, drawSource, keyedCanvas, pickFiles, refreshSourceSelects, renderInputs, resetAfterRemoval, H, W, byId, frameNo, inputs, show
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน ctx.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createVirtualSet = function (ctx) {
    const { addInput, cardSub, dialog, disposeInput, drawSource, keyedCanvas, pickFiles, refreshSourceSelects, renderInputs, resetAfterRemoval } = ctx;
    const VSETS = { news: 'ห้องข่าว (โต๊ะ + จอ)', talk: 'ทอล์กโชว์', stage: 'เวที / คอนเสิร์ต', image: 'รูปของฉันเอง' };
    const VSHOTS = [{ n: 'กว้าง', k: 'W', z: 1, x: 0.5, y: 0.5 }, { n: 'กลาง', k: 'M', z: 1.5, x: 0.45, y: 0.42 }, { n: 'ใกล้', k: 'C', z: 2.2, x: 0.4, y: 0.36 }];
    const VSET_TALENT = { news: [0.4, 0.6, 0.8], talk: [0.5, 0.56, 0.86], stage: [0.5, 0.56, 0.9], image: [0.5, 0.56, 0.86] };
    const WALL = { x: 0.56, y: 0.12, w: 0.38, h: 0.42 };
    function sanitizeVset(v, setDefault = 'news') {
      v = v || {};
      const set = VSETS[v.set] ? v.set : setDefault, t = VSET_TALENT[set];
      return { cam: String(v.cam || ''), set, wall: String(v.wall || ''), key: v.key === 'blue' ? 'blue' : 'green', tol: clamp(+v.tol || 60, 10, 150),
        tx: clamp(+(v.tx ?? t[0]), 0, 1), ty: clamp(+(v.ty ?? t[1]), 0, 1), ts: clamp(+(v.ts ?? t[2]), 0.2, 2), move: clamp(+v.move || 1200, 0, 5000), shot: clamp(+v.shot || 0, 0, VSHOTS.length - 1), hasImg: !!v.hasImg };
    }
    const vsBgCache = new Map();
    function drawVsetBack(g, set, w, h) {
      const lin = (x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
      const rad = (x, y, r, stops) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
      if (set === 'news') {
        g.fillStyle = lin(0, 0, 0, h, [[0, '#0d2350'], [0.7, '#071228'], [1, '#040a17']]); g.fillRect(0, 0, w, h);
        for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(96,165,250,${0.05 + (i % 3) * 0.03})`; g.fillRect(i * w / 9 + w * 0.01, h * 0.06, w / 9 - w * 0.02, h * 0.62); }
        g.fillStyle = 'rgba(56,189,248,.55)'; g.fillRect(0, h * 0.66, w, h * 0.006);
        g.fillStyle = lin(0, h * 0.68, 0, h, [[0, '#0b1630'], [1, '#02050c']]); g.fillRect(0, h * 0.68, w, h * 0.32);
        g.fillStyle = rad(w * 0.3, h * 0.35, w * 0.45, [[0, 'rgba(147,197,253,.18)'], [1, 'rgba(147,197,253,0)']]); g.fillRect(0, 0, w, h);
      } else if (set === 'talk') {
        g.fillStyle = lin(0, 0, w, 0, [[0, '#2a1a10'], [0.5, '#4a2e1b'], [1, '#2a1a10']]); g.fillRect(0, 0, w, h * 0.72);
        for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? 'rgba(0,0,0,.18)' : 'rgba(255,220,180,.06)'; g.fillRect(i * w / 24, 0, w / 48, h * 0.72); }
        for (const [x, c] of [[0.12, '#7c3aed'], [0.76, '#0ea5e9']]) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(w * x, h * 0.16, w * 0.12, h * 0.3); g.fillStyle = c; g.globalAlpha = 0.35; g.fillRect(w * x + 6, h * 0.16 + 6, w * 0.12 - 12, h * 0.3 - 12); g.globalAlpha = 1; }
        g.fillStyle = lin(0, h * 0.72, 0, h, [[0, '#3b2516'], [1, '#140b06']]); g.fillRect(0, h * 0.72, w, h * 0.28);
        for (const x of [0.25, 0.75]) { g.fillStyle = rad(w * x, 0, h * 0.9, [[0, 'rgba(255,214,150,.22)'], [1, 'rgba(255,214,150,0)']]); g.fillRect(0, 0, w, h); }
      } else {
        g.fillStyle = '#05050d'; g.fillRect(0, 0, w, h);
        const cols = 16, rows = 7, cw = w / cols, ch = h * 0.6 / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { g.fillStyle = `hsla(${200 + c * 8 + r * 6},90%,${30 + ((c * 7 + r * 3) % 5) * 6}%,.85)`; g.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4); }
        g.fillStyle = lin(0, h * 0.6, 0, h, [[0, '#14142a'], [1, '#020205']]); g.fillRect(0, h * 0.6, w, h * 0.4);
        for (const x of [0.2, 0.5, 0.8]) { g.fillStyle = rad(w * x, -h * 0.1, h * 1.1, [[0, 'rgba(255,255,255,.22)'], [0.6, 'rgba(255,255,255,.05)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, w, h); }
      }
    }
    function drawVsetDesk(g, set, w, h) {
      if (set !== 'news') return;
      g.save();
      const top = h * 0.74;
      g.beginPath(); g.moveTo(w * 0.1, top); g.quadraticCurveTo(w * 0.4, top - h * 0.03, w * 0.7, top); g.lineTo(w * 0.76, h); g.lineTo(w * 0.04, h); g.closePath();
      const gr = g.createLinearGradient(0, top, 0, h); gr.addColorStop(0, '#1e3a8a'); gr.addColorStop(0.12, '#0f1f4d'); gr.addColorStop(1, '#050b1c');
      g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(219,234,254,.85)'; g.fillRect(w * 0.1, top - 2, w * 0.6, Math.max(2, h * 0.008));
      g.fillStyle = 'rgba(56,189,248,.9)'; g.fillRect(w * 0.1, top + h * 0.11, w * 0.62, Math.max(2, h * 0.006));
      g.restore();
    }
    function vsetBg(inp, w, h) {
      const v = inp.vset, key = `${inp.id}|${v.set}|${w}x${h}|${v.set === 'image' && inp.vsImg ? inp.vsImgStamp : ''}`;
      const c = vsBgCache.get(inp.id);
      if (c && c.key === key) return c.canvas;
      const canvas = c?.canvas || document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d');
      if (v.set === 'image') { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); if (inp.vsImg) { const s = Math.max(w / inp.vsImg.width, h / inp.vsImg.height); g.drawImage(inp.vsImg, (w - inp.vsImg.width * s) / 2, (h - inp.vsImg.height * s) / 2, inp.vsImg.width * s, inp.vsImg.height * s); } }
      else drawVsetBack(g, v.set, w, h);
      vsBgCache.set(inp.id, { key, canvas });
      return canvas;
    }
    // ฉากทั้งฉาก (ก่อนกล้องเสมือน) — วาดครั้งเดียวต่อเฟรม ใช้ร่วมกันทั้ง Program / Preview / การ์ด
    function vsetStage(inp) {
      const w = Math.min(ctx.W, 1920), h = Math.round(w * ctx.H / ctx.W);
      const st = inp._vs || (inp._vs = { c: document.createElement('canvas'), frame: -1 });
      if (st.frame === ctx.frameNo && st.c.width === w) return st.c;
      if (st.c.width !== w || st.c.height !== h) { st.c.width = w; st.c.height = h; }
      const g = st.c.getContext('2d'), v = inp.vset;
      g.drawImage(vsetBg(inp, w, h), 0, 0);
      if (v.set === 'news') {
        const wall = ctx.byId(v.wall), r = { x: WALL.x * w, y: WALL.y * h, w: WALL.w * w, h: WALL.h * h };
        g.save(); g.shadowColor = 'rgba(56,189,248,.8)'; g.shadowBlur = 18; g.fillStyle = '#020617'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.restore();
        if (wall && wall !== inp && wall.type !== 'vset') { g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.translate(r.x, r.y); drawSource(g, wall, r.w, r.h); g.restore(); }
        else { const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h); gr.addColorStop(0, '#1d4ed8'); gr.addColorStop(1, '#0e7490'); g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h); }
      }
      const cam = ctx.byId(v.cam);
      if (cam && cam !== inp && cam.type !== 'vset' && cam.status === 'live') {
        const kc = keyedCanvas(cam, { scale: 1, key: v.key, tolerance: v.tol }), tw = w * v.ts, th = tw * kc.height / kc.width;
        g.drawImage(kc, v.tx * w - tw / 2, v.ty * h - th / 2, tw, th);
      }
      drawVsetDesk(g, v.set, w, h);
      st.frame = ctx.frameNo;
      return st.c;
    }
    // กล้องเสมือน: ไล่จากมุมเดิมไปมุมใหม่แบบ ease-in-out
    function vsetCamera(inp) {
      const m = inp.vcam || (inp.vcam = { from: shotTarget(inp.vset, inp.vset.shot), to: shotTarget(inp.vset, inp.vset.shot), at: 0 });
      const p = inp.vset.move ? clamp((performance.now() - m.at) / inp.vset.move, 0, 1) : 1, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const lz = Math.log(m.from.z) + (Math.log(m.to.z) - Math.log(m.from.z)) * e;
      return { z: Math.exp(lz), x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e };
    }
    // มุมกลาง/ใกล้ เล็งไปที่ช่วงบนของคน (ตามตำแหน่งที่วางไว้) ไม่ใช่กลางฉาก
    const shotTarget = (v, i) => i === 0 ? VSHOTS[0] : { ...VSHOTS[i], x: v.tx, y: clamp(v.ty - v.ts * (i === 2 ? 0.2 : 0.12), 0, 1) };
    function vsetShot(inp, i) {
      const now = performance.now(), cur = vsetCamera(inp);
      inp.vset.shot = i;
      inp.vcam = { from: cur, to: shotTarget(inp.vset, i), at: now };
      const card = $(`#inputs-grid .card[data-id="${inp.id}"]`);
      if (card) { card.querySelectorAll('[data-card^="vs"]').forEach(b => b.classList.toggle('is-on', b.dataset.card === 'vs' + i)); const s = $('.card-sub', card); if (s) s.textContent = cardSub(inp); }
    }
    function drawVset(ctx, inp, w, h) {
      const st = vsetStage(inp), c = vsetCamera(inp), sw = st.width / c.z, sh = st.height / c.z;
      const sx = clamp(c.x * st.width - sw / 2, 0, st.width - sw), sy = clamp(c.y * st.height - sh / 2, 0, st.height - sh);
      ctx.drawImage(st, sx, sy, sw, sh, 0, 0, w, h);
    }
    function addVsetInput(v) {
      const n = ctx.inputs.filter(i => i.type === 'vset').length + 1;
      return addInput({ type: 'vset', name: `VIRTUAL SET ${n}`, status: 'live', vset: sanitizeVset(v) });
    }
    async function setVsetImage(inp, file, store) {
      try {
        const b = await createImageBitmap(file);
        if (inp.removed) { b.close(); return; }
        if (inp.vsImg) inp.vsImg.close();
        inp.vsImg = b; inp.vsImgStamp = Date.now(); inp.vset.hasImg = true;
        if (store) mediaStore.put(inp.id + '-bg', file);
      } catch (e) { toast('เปิดรูปฉากไม่ได้', 'error'); }
    }
    async function openVsetDialog(inp) {
      const cams = ctx.inputs.filter(i => !['vset', 'delay', 'mixsrc', 'transparent', 'black', 'color', 'bars'].includes(i.type));
      const isNew = !inp;
      const v = sanitizeVset(inp ? inp.vset : { cam: (cams.find(i => ['camera', 'wireless', 'guest', 'srt', 'screen', 'web', 'url'].includes(i.type)) || cams[0] || {}).id });
      const keep = inp ? { ...inp.vset } : null;
      const opt = (list, cur, none) => (none ? `<option value="">${none}</option>` : '') + list.map(i => `<option value="${i.id}" ${i.id === cur ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
      const sl = (name, label, min, max, step, val, fmt) => `<label class="field"><span>${label} <b class="mono" data-vv="${name}">${fmt(val)}</b></span><input name="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
      let tmp = inp;
      if (isNew) tmp = addVsetInput(v);
      const r = await dialog({
        title: isNew ? 'เพิ่มฉากเสมือน (Virtual Set)' : `ฉากเสมือน — ${inp.name}`,
        body: `
          <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(tmp.name)}"></label>
          <div class="grid-2">
            <label class="field"><span>กล้อง (ฉากเขียว / ฟ้า)</span><select name="cam" class="select">${opt(cams, v.cam, '— ไม่มี —')}</select></label>
            <label class="field"><span>ฉาก</span><select name="set" class="select">${Object.entries(VSETS).map(([k, l]) => `<option value="${k}" ${k === v.set ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
          <div class="vs-img-row"><button type="button" class="btn btn-sm" data-vs="img">${icon('image')}เลือกรูปฉาก…</button> <small class="note">${tmp.vsImg ? 'มีรูปฉากแล้ว' : 'ยังไม่มีรูป — แนะนำ 1920×1080'}</small></div>
          <label class="field vs-wall"><span>จอหลังผู้ประกาศแสดง</span><select name="wall" class="select">${opt(ctx.inputs.filter(i => i.type !== 'vset'), v.wall, 'กราฟิกฉาก')}</select></label>
          <div class="grid-2">
            <label class="field"><span>สีฉากหลังกล้อง</span><select name="key" class="select"><option value="green" ${v.key === 'green' ? 'selected' : ''}>เขียว</option><option value="blue" ${v.key === 'blue' ? 'selected' : ''}>ฟ้า</option></select></label>
            ${sl('tol', 'ความแรงคีย์', 10, 150, 1, v.tol, x => Math.round(x))}
          </div>
          <div class="grid-3">${sl('tx', 'ตำแหน่งคน ซ้าย-ขวา', 0, 1, 0.01, v.tx, x => Math.round(x * 100) + '%')}${sl('ty', 'สูง-ต่ำ', 0, 1, 0.01, v.ty, x => Math.round(x * 100) + '%')}${sl('ts', 'ขนาด', 0.2, 2, 0.01, v.ts, x => Math.round(x * 100) + '%')}</div>
          <label class="field"><span>ความเร็วเปลี่ยนมุมกล้อง</span><select name="move" class="select">${[[0, 'ตัดทันที'], [700, 'เร็ว'], [1200, 'ปานกลาง'], [2500, 'ช้า']].map(([ms, l]) => `<option value="${ms}" ${ms === v.move ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <canvas class="vs-prev" width="384" height="216"></canvas>
          <p class="note">ปรับแล้วเห็นผลทันทีในภาพตัวอย่าง · บนการ์ดมีปุ่ม W / M / C เปลี่ยนมุมกล้องเสมือน (กว้าง / กลาง / ใกล้) แบบเคลื่อนนุ่ม</p>`,
        wide: true,
        actions: [{ label: 'ยกเลิก' }, { label: isNew ? 'เพิ่ม' : 'บันทึก', primary: true, value: 'ok' }],
        onOpen(modal) {
          const fm = $('form', modal), cv = $('.vs-prev', modal), g = cv.getContext('2d');
          const sync = () => {
            const nv = sanitizeVset({ ...tmp.vset, cam: fm.cam.value, set: fm.set.value, wall: fm.wall.value, key: fm.key.value, tol: fm.tol.value, tx: fm.tx.value, ty: fm.ty.value, ts: fm.ts.value, move: fm.move.value, hasImg: tmp.vset.hasImg });
            tmp.vset = nv;
            for (const k of ['tol', 'tx', 'ty', 'ts']) { const b = $(`[data-vv="${k}"]`, modal); if (b) b.textContent = k === 'tol' ? Math.round(nv[k]) : Math.round(nv[k] * 100) + '%'; }
            $('.vs-img-row', modal).hidden = nv.set !== 'image';
            $('.vs-wall', modal).hidden = nv.set !== 'news';
          };
          fm.addEventListener('input', sync); fm.addEventListener('change', e => {
            // เปลี่ยนฉาก → วางคนตามตำแหน่งที่เหมาะกับฉากนั้น
            if (e.target.name === 'set') { const t = VSET_TALENT[fm.set.value]; fm.tx.value = t[0]; fm.ty.value = t[1]; fm.ts.value = t[2]; }
            sync();
          });
          $('[data-vs="img"]', modal).addEventListener('click', () => pickFiles('image/*', files => setVsetImage(tmp, files[0], true).then(() => { $('.vs-img-row small', modal).textContent = 'มีรูปฉากแล้ว'; })));
          const loop = () => { if (!modal.isConnected) return; g.clearRect(0, 0, 384, 216); drawVset(g, tmp, 384, 216); requestAnimationFrame(loop); };
          sync(); loop();
        }
      });
      if (!r || r.value !== 'ok') {
        if (isNew) { disposeInput(tmp, true); resetAfterRemoval(tmp.id); renderInputs(); refreshSourceSelects(); }
        else inp.vset = keep;
        return null;
      }
      tmp.name = r.form.name.value.trim().slice(0, 40) || tmp.name;
      renderInputs(); refreshSourceSelects(); ctx.show.autosave();
      return tmp;
    }

    return { VSETS, VSHOTS, drawVset, openVsetDialog, sanitizeVset, setVsetImage, vsBgCache, vsetShot };
  };
})(window.WebMix = window.WebMix || {});
