/* พื้นหลังด้วย AI (MediaPipe Image Segmenter, โมเดล selfie แนวนอน 256×144) ----
   ตัดคนออกจากพื้นหลังทุกเฟรมในเครื่อง แล้ว เบลอพื้นหลัง / ใส่ภาพอื่นแทน / ทำโปร่งใส (ใช้ซ้อนบนสไลด์)
   โหลดตัวประมวลผลและโมเดลครั้งแรกจาก CDN (ต้องต่อเน็ต) — หลังจากนั้นเบราว์เซอร์เก็บไว้ */
(function (WM) {
  'use strict';
  const { $, $$, FONT, clamp, drawFit, esc, toast } = WM;

  // ctx = สิ่งที่ใช้จากสตูดิโอ (app.js): dialog, renderInputs, byId, fps, inputs, settings
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน ctx.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createAiBackground = function (ctx) {
    const { dialog, renderInputs } = ctx;
    const BG_MODES = { none: 'ไม่ใช้', blur: 'เบลอพื้นหลัง', image: 'เปลี่ยนเป็นภาพ / วิดีโออื่น', green: 'สีเขียว (ส่งต่อไปคีย์ในโปรแกรมอื่น)', remove: 'ลบพื้นหลัง (โปร่งใส — ใช้ซ้อนบนสไลด์หรือภาพอื่น)' };
    const BG_QUALITY = { fast: ['เร็ว', 160, 90], bal: ['สมดุล', 256, 144], sharp: ['คมสุด', 384, 216] };
    const BG_TYPES = ['camera', 'wireless', 'guest', 'srt', 'media'];
    const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
    const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite';
    const sanitizeBg = b => ({ mode: BG_MODES[b?.mode] ? b.mode : 'none', imageId: typeof b?.imageId === 'string' ? b.imageId.slice(0, 40) : '',
      feather: clamp(b?.feather ?? 2, 0, 10), sens: clamp(b?.sens ?? 0.25, 0.05, 0.6), quality: BG_QUALITY[b?.quality] ? b.quality : 'bal' });
    let visionLoading = null;
    function loadVision() {
      if (!visionLoading) {
        visionLoading = (async () => {
          const mod = await import(`${MP_BASE}/vision_bundle.mjs`);
          return { mod, fileset: await mod.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`) };
        })();
        visionLoading.catch(() => { visionLoading = null; });
      }
      return visionLoading;
    }
    async function makeSegmenter() {
      const { mod, fileset } = await loadVision();
      const opts = delegate => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
      try { return await mod.ImageSegmenter.createFromOptions(fileset, opts('GPU')); }
      catch (e) { return mod.ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
    }
    const bgActive = inp => inp.bg && inp.bg.mode !== 'none' && BG_TYPES.includes(inp.type);
    const bgFrame = inp => bgActive(inp) && inp.status === 'live' && inp.bgState && inp.bgState.ready ? inp.bgState.out : null;
    function bgStop(inp) {
      const st = inp.bgState;
      if (!st) return;
      inp.bgState = null;
      if (st.seg) { try { st.seg.close(); } catch (e) {} }
    }
    function stepBackgrounds(now) {
      for (const inp of ctx.inputs) {
        if (!bgActive(inp)) { if (inp.bgState && !inp.bgState.loading) bgStop(inp); continue; }
        const v = inp.el;
        if (inp.status !== 'live' || !v || v.readyState < 2 || !v.videoWidth) continue;
        const st = inp.bgState || (inp.bgState = { seg: null, loading: false, ready: false, error: '', last: 0, ts: 0, version: 0 });
        if (!st.seg) {
          if (st.loading || st.error) continue;
          st.loading = true;
          makeSegmenter().then(seg => {
            st.loading = false;
            if (inp.bgState !== st || inp.removed) { seg.close(); return; }
            st.seg = seg;
          }).catch(e => {
            st.loading = false;
            st.error = 'โหลด AI ตัดพื้นหลังไม่สำเร็จ — ต้องต่ออินเทอร์เน็ตครั้งแรก (' + (e.message || e) + ')';
            toast(`${inp.name}: ${st.error}`, 'error', 8000);
          });
          continue;
        }
        // ไม่เกินเฟรมเรตของเอาต์พุต และไม่กินเวลาวาดภาพเกิน ~1/3 (เครื่องช้า = อัปเดตมาสก์ห่างขึ้น แต่ภาพหลักยังลื่น)
        if (now - st.last < Math.max(1000 / Math.min(30, ctx.settings.fps) - 2, (st.cost || 0) * 3)) continue;
        st.last = now;
        const t0 = performance.now();
        try { bgProcess(inp, st, v, now); } catch (e) { console.warn('background', e); }
        st.cost = (st.cost || 0) * 0.8 + (performance.now() - t0) * 0.2;
      }
    }
    function bgProcess(inp, st, v, now) {
      const [, MW, MH] = BG_QUALITY[inp.bg.quality] || BG_QUALITY.bal;
      if (st.small && st.small.width !== MW) st.small = null;
      if (!st.small) {
        st.small = Object.assign(document.createElement('canvas'), { width: MW, height: MH });
        st.sctx = st.small.getContext('2d', { willReadFrequently: false });
        st.mask = Object.assign(document.createElement('canvas'), { width: MW, height: MH });
        st.mctx = st.mask.getContext('2d');
        st.img = st.mctx.createImageData(MW, MH);
        st.out = document.createElement('canvas');
        st.octx = st.out.getContext('2d');
      }
      st.sctx.drawImage(v, 0, 0, MW, MH);
      st.ts = Math.max(st.ts + 1, Math.round(now));
      const res = st.seg.segmentForVideo(st.small, st.ts);
      const masks = res.confidenceMasks || [];
      // โมเดล selfie: มาสก์สุดท้าย = ความมั่นใจว่าเป็นคน
      const m = masks.length ? masks[masks.length - 1].getAsFloat32Array() : null;
      if (m) {
        const d = st.img.data;
        for (let i = 0, j = 3; i < m.length; i++, j += 4) {
          const a = (m[i] - (inp.bg.sens ?? 0.25)) * 2;
          d[j - 3] = d[j - 2] = d[j - 1] = 255;
          d[j] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
        }
        st.mctx.putImageData(st.img, 0, 0);
      }
      res.close && res.close();
      if (!m) return;
      const ow = Math.min(v.videoWidth, 1280), oh = Math.round(ow * v.videoHeight / v.videoWidth);
      const o = st.out, c = st.octx;
      if (o.width !== ow || o.height !== oh) { o.width = ow; o.height = oh; }
      c.save();
      c.clearRect(0, 0, ow, oh);
      c.imageSmoothingEnabled = true;
      c.filter = `blur(${inp.bg.feather ?? 2}px)`;
      c.drawImage(st.mask, 0, 0, ow, oh);
      c.filter = 'none';
      c.globalCompositeOperation = 'source-in';
      c.drawImage(v, 0, 0, ow, oh);
      c.globalCompositeOperation = 'destination-over';
      if (inp.bg.mode === 'blur') {
        c.filter = `blur(${Math.round(ow / 80)}px)`;
        c.drawImage(v, -ow * 0.03, -oh * 0.03, ow * 1.06, oh * 1.06);
        c.filter = 'none';
      } else if (inp.bg.mode === 'green') {
        c.fillStyle = '#00b140'; c.fillRect(0, 0, ow, oh);
      } else if (inp.bg.mode === 'image') {
        const src = ctx.byId(inp.bg.imageId);
        const el = src && src.status === 'live' && src.el;
        const sw = el && (el.videoWidth || el.naturalWidth), sh = el && (el.videoHeight || el.naturalHeight);
        if (sw && sh) {
          // เต็มกรอบแบบครอปขอบ
          const k = Math.max(ow / sw, oh / sh);
          c.drawImage(el, (ow - sw * k) / 2, (oh - sh * k) / 2, sw * k, sh * k);
        } else { c.fillStyle = '#000'; c.fillRect(0, 0, ow, oh); }
      }
      c.restore();
      st.ready = true;
      st.version++;
    }

    // หน้าต่างลบพื้นหลังด้วย AI: ภาพก่อน / หลัง · พื้นหลังใหม่ · ใช้กับกล้องไหน · ขอบ · ความไว · ประสิทธิภาพ
    async function openBgDialog(inp) {
      const before = inp.bg ? { ...inp.bg } : null;
      const cams = ctx.inputs.filter(x => BG_TYPES.includes(x.type));
      const imgs = ctx.inputs.filter(x => x.id !== inp.id && (x.type === 'image' || x.type === 'media'));
      const b0 = sanitizeBg(inp.bg);
      const TILES = [['blur', 'เบลอพื้นหลัง'], ['image', 'ภาพของฉัน'], ['green', 'สีเขียว (ส่งต่อคีย์)'], ['remove', 'โปร่งใส'], ['none', 'ไม่ใช้']];
      const r = await dialog({
        title: 'ลบพื้นหลังด้วย AI',
        wide: true,
        body: `<div class="ab-wrap">
          <div class="ab-left">
            <div class="ab-two"><div><small>ก่อน</small><canvas class="ab-before" width="640" height="360"></canvas></div><div><small>หลัง</small><canvas class="ab-after" width="640" height="360"></canvas></div></div>
            <section class="ab-card"><h3>พื้นหลังใหม่</h3>
              <div class="ab-tiles">${TILES.map(([k, n]) => `<label class="ab-tile"><input type="radio" name="mode" value="${k}" ${k === b0.mode ? 'checked' : ''}><i class="ab-sw ab-${k}"></i><span>${n}</span></label>`).join('')}</div>
              <label class="field ab-img" ${b0.mode === 'image' ? '' : 'hidden'}><span>ภาพพื้นหลัง (แหล่งภาพนิ่งหรือวิดีโอ)</span><select name="imageId" class="select">${imgs.length ? imgs.map(x => `<option value="${x.id}" ${x.id === b0.imageId ? 'selected' : ''}>${esc(x.name)}</option>`).join('') : '<option value="">— เพิ่มภาพนิ่ง/วิดีโอก่อน —</option>'}</select></label>
            </section>
          </div>
          <div class="ab-right">
            <section class="ab-card"><h3>ใช้กับ</h3>
              <label class="field"><span>กล้อง</span><select name="cam" class="select">${cams.map(x => `<option value="${x.id}" ${x.id === inp.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></section>
            <section class="ab-card"><h3>ความละเอียดขอบ</h3>
              <label class="fx-row"><span>ความนุ่มขอบ<b class="mono" data-v="feather">${b0.feather} px</b></span><input class="range" type="range" name="feather" min="0" max="10" step="1" value="${b0.feather}"></label>
              <label class="fx-row"><span>ความไวในการแยกคน<b class="mono" data-v="sens">${Math.round((0.65 - b0.sens) / 0.6 * 100)}%</b></span><input class="range" type="range" name="sensUi" min="0" max="100" step="1" value="${Math.round((0.65 - b0.sens) / 0.6 * 100)}"></label>
              <p class="note">ขอบแข็ง = ตัดคม · ขอบนุ่ม = กลืนกับพื้นหลัง · ความไวสูง = เก็บผม/มือได้มากขึ้น แต่อาจติดพื้นหลังมาด้วย</p></section>
            <section class="ab-card"><h3>ประสิทธิภาพ</h3>
              <div class="cp-seg">${Object.entries(BG_QUALITY).map(([k, [n]]) => `<label><input type="radio" name="quality" value="${k}" ${k === b0.quality ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
              <div class="ab-stat mono"></div>
              <p class="note">ประมวลผลในเครื่อง ไม่ส่งภาพออกไปที่ไหน · ครั้งแรกต้องต่อเน็ตเพื่อโหลดโมเดล</p></section>
          </div>
        </div>`,
        actions: [{ label: 'รีเซ็ต', value: 'reset' }, { label: 'ยกเลิก' }, { label: 'เสร็จ', primary: true, value: 'save' }],
        onOpen(modal, close) {
          modal.classList.add('ab-modal');
          const f = $('form', modal).elements;
          const read = () => sanitizeBg({ mode: f.mode.value, imageId: f.imageId.value, feather: +f.feather.value, sens: 0.65 - (+f.sensUi.value / 100) * 0.6, quality: f.quality.value });
          const apply = () => {
            const b = read();
            $('.ab-img', modal).hidden = b.mode !== 'image';
            $('[data-v=feather]', modal).textContent = `${b.feather} px`;
            $('[data-v=sens]', modal).textContent = `${f.sensUi.value}%`;
            inp.bg = b.mode === 'none' ? null : b;
          };
          modal.addEventListener('input', apply);
          modal.addEventListener('change', e => {
            if (e.target.name === 'cam' && e.target.value !== inp.id) { close(); const o = ctx.byId(e.target.value); if (o) setTimeout(() => openBgDialog(o), 0); }
            else apply();
          });
          const bc = $('.ab-before', modal).getContext('2d'), ac = $('.ab-after', modal).getContext('2d');
          const tick = () => {
            if (!modal.isConnected) return;
            bc.fillStyle = '#000'; bc.fillRect(0, 0, 640, 360);
            if (inp.el && inp.el.videoWidth) drawFit(bc, inp.el, inp.el.videoWidth, inp.el.videoHeight, 640, 360);
            ac.clearRect(0, 0, 640, 360);
            const out = bgFrame(inp);
            if (out) { if (inp.bg?.mode === 'remove') { ac.fillStyle = '#2a313d'; for (let y = 0; y < 360; y += 20) for (let x = (y / 20 % 2) * 20; x < 640; x += 40) ac.fillRect(x, y, 20, 20); } drawFit(ac, out, out.width, out.height, 640, 360); }
            else { ac.fillStyle = '#0b0d12'; ac.fillRect(0, 0, 640, 360); ac.fillStyle = '#9aa4b2'; ac.font = `16px ${FONT}`; ac.textAlign = 'center'; ac.fillText(inp.bg ? (inp.bgState?.error || 'กำลังโหลด AI…') : 'ยังไม่ได้เปิดลบพื้นหลัง', 320, 185); }
            const st = inp.bgState;
            $('.ab-stat', modal).textContent = st && st.ready ? `${(st.cost || 0).toFixed(1)} ms ต่อมาสก์ · ภาพ ${Math.round(ctx.fps)} fps` : '';
            setTimeout(tick, 66);
          };
          tick();
          const rb = [...$$('.modal-foot .btn', modal)].find(b => b.dataset.label === 'รีเซ็ต');
          const rc = rb.cloneNode(true); rb.replaceWith(rc);
          rc.addEventListener('click', () => { const d = sanitizeBg({ mode: f.mode.value }); f.feather.value = d.feather; f.sensUi.value = Math.round((0.65 - d.sens) / 0.6 * 100); $$('[name=quality]', modal).forEach(x => { x.checked = x.value === d.quality; }); apply(); });
        }
      });
      if (r?.value !== 'save') { inp.bg = before; return; }
      renderInputs();
    }

    return { BG_MODES, BG_TYPES, bgFrame, bgStop, openBgDialog, sanitizeBg, stepBackgrounds };
  };
})(window.WebMix = window.WebMix || {});
