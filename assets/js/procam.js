/* WebMix — กล้องมือถือแบบมืออาชีพ (แนว Blackmagic Camera) สำหรับหน้า ?call=
   - ปรับเอง: ISO / ชัตเตอร์ / EV, White balance (K), โฟกัส (แตะเพื่อโฟกัส / ปรับเอง), ซูม, เลนส์, ไฟฉาย, ล็อก AE/AWB/AF, เฟรมเรต
     (แสดงเฉพาะที่กล้อง+เบราว์เซอร์รองรับ — Android Chrome ส่วนใหญ่ได้ครบ, iPhone ได้บางส่วน)
   - ตัวช่วยดูภาพ: Zebra, Focus peaking, False color, Histogram, เส้นตาราง/กรอบสัดส่วน, ระดับน้ำ, มิเตอร์เสียง
   - บันทึกในเครื่อง (ไฟล์สำรองคุณภาพสูง) · แถบสถานะ ความละเอียด/เฟรม/บิตเรต/ดีเลย์/แบตเตอรี่
   - สตูดิโอควบคุมกล้องจากระยะไกลได้ (เหมือน Camera Control ของ ATEM) ผ่านช่องข้อมูลเดิม */
(function (WM) {
  'use strict';
  const { store } = WM;
  const $ = (s, el = document) => el.querySelector(s);

  const FPS_LIST = [24, 25, 30, 50, 60];
  const WB_PRESETS = [['แดด', 5600], ['ครึ้ม', 6500], ['หลอดไส้', 3200], ['ฟลูออเรสเซนต์', 4000]];
  const GUIDES = { none: 'ไม่มี', '2.39': '2.39:1', '1.85': '1.85:1', '4:3': '4:3', '1:1': '1:1', '9:16': '9:16 (TikTok)' };
  // exposureTime ของ MediaStream มีหน่วย 100 ไมโครวินาที
  const shutterLabel = t => t > 0 ? (t >= 10000 ? `${(t / 10000).toFixed(1)}s` : `1/${Math.round(10000 / t)}`) : '—';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const range = r => r && typeof r === 'object' && typeof r.max === 'number' && r.max > r.min ? r : null;

  function initProCam(ctx) {
    const { root, video } = ctx;
    root.classList.add('procam');
    const prefs = Object.assign({ zebra: false, zebraAt: 95, peaking: false, falsecolor: false, hist: true, grid: false, guide: 'none', level: false, meter: true, glide: 1500, safe: false, wave: false, ret: false, autoq: true, shots: [null, null, null, null] }, store.get('procam', {}));
    if (!Array.isArray(prefs.shots) || prefs.shots.length !== 4) prefs.shots = [null, null, null, null];
    const savePrefs = () => store.set('procam', prefs);
    let tool = null, lenses = [], battery = null, stats = {}, stateTimer = null;
    const rec = { recorder: null, since: 0, name: '', parts: null, writable: null, handle: null, bytes: 0 };

    root.insertAdjacentHTML('beforeend', `
      <div class="pc-stage">
        <canvas class="pc-assist"></canvas>
        <div class="pc-guides"></div>
        <div class="pc-focus" hidden></div>
      </div>
      <div class="pc-info"></div>
      <canvas class="pc-hist" width="128" height="56" hidden></canvas>
      <canvas class="pc-wave" width="128" height="56" hidden></canvas>
      <video class="pc-ret" autoplay muted playsinline hidden></video>
      <div class="pc-net" hidden><span></span><button type="button" data-net="restore" hidden>คืนคุณภาพ</button></div>
      <div class="pc-touchlock" hidden><span class="pc-tl-pill"><i></i>🔒 ล็อกจออยู่ — กดค้าง 1 วินาทีเพื่อปลดล็อก</span></div>
      <div class="pc-meter" hidden><i></i><b></b></div>
      <div class="pc-level" hidden><i></i><span></span></div>
      <div class="pc-rec" hidden>● REC <span>00:00</span></div>
      <div class="pc-rail">
        <button type="button" data-pc="exp"><small>EXP</small><b>AUTO</b></button>
        <button type="button" data-pc="wb"><small>WB</small><b>AUTO</b></button>
        <button type="button" data-pc="focus"><small>FOCUS</small><b>AF</b></button>
        <button type="button" data-pc="zoom"><small>ZOOM</small><b>1.0×</b></button>
        <button type="button" data-pc="lens"><small>LENS</small><b>—</b></button>
        <button type="button" data-pc="fps"><small>FPS</small><b>30</b></button>
        <button type="button" data-pc="assist"><small>ASSIST</small><b>—</b></button>
        <button type="button" data-pc="shot"><small>SHOT</small><b>—</b></button>
        <button type="button" data-pc="ret"><small>PGM</small><b>OFF</b></button>
        <button type="button" data-pc="lock"><small>LOCK</small><b>OFF</b></button>
        <button type="button" data-pc="torch"><small>TORCH</small><b>OFF</b></button>
        <button type="button" data-pc="rec" class="pc-recbtn"><small>REC</small><b>●</b></button>
      </div>
      <div class="pc-panel" hidden></div>`);
    const stage = $('.pc-stage', root), assist = $('.pc-assist', root), guides = $('.pc-guides', root), focusBox = $('.pc-focus', root);
    const info = $('.pc-info', root), histC = $('.pc-hist', root), meter = $('.pc-meter', root), level = $('.pc-level', root);
    const recEl = $('.pc-rec', root), rail = $('.pc-rail', root), panel = $('.pc-panel', root);
    const waveC = $('.pc-wave', root), retV = $('.pc-ret', root), netEl = $('.pc-net', root), touchLock = $('.pc-touchlock', root);

    /* ---------- กล้อง ---------- */
    const track = () => { const s = ctx.getStream(); return s ? s.getVideoTracks()[0] : null; };
    const caps = () => { const t = track(); try { return (t && t.getCapabilities && t.getCapabilities()) || {}; } catch (e) { return {}; } };
    const sets = () => { const t = track(); try { return (t && t.getSettings()) || {}; } catch (e) { return {}; } };
    const has = (c, k) => k === 'torch' ? !!c.torch : Array.isArray(c[k]) ? c[k].length > 0 : !!range(c[k]);
    let locked = false;
    async function apply(patch, quiet) {
      const t = track();
      if (!t) return false;
      const c = caps(), adv = {};
      for (const [k, v] of Object.entries(patch)) if (k in c || k === 'pointsOfInterest') adv[k] = v;
      if (('iso' in adv || 'exposureTime' in adv) && !('exposureMode' in adv)) adv.exposureMode = 'manual';
      if ('colorTemperature' in adv && !('whiteBalanceMode' in adv)) adv.whiteBalanceMode = 'manual';
      if ('focusDistance' in adv && !('focusMode' in adv)) adv.focusMode = 'manual';
      if (!Object.keys(adv).length) { if (!quiet) ctx.brief('กล้องนี้ปรับค่านี้ไม่ได้'); return false; }
      try { await t.applyConstraints({ advanced: [adv] }); }
      catch (e) { if (!quiet) ctx.brief('กล้องไม่รับค่านี้: ' + (e.message || e.name)); return false; }
      paint();
      sendStateSoon();
      return true;
    }
    async function setLock(on) {
      const s = sets(), c = caps();
      locked = on;
      const patch = on
        ? { exposureMode: 'manual', iso: s.iso, exposureTime: s.exposureTime, whiteBalanceMode: 'manual', colorTemperature: s.colorTemperature, focusMode: 'manual', focusDistance: s.focusDistance }
        : { exposureMode: 'continuous', whiteBalanceMode: 'continuous', focusMode: 'continuous' };
      for (const k of Object.keys(patch)) if (patch[k] === undefined || !(k in c)) delete patch[k];
      await apply(patch, true);
      ctx.brief(on ? 'ล็อกแสง / สี / โฟกัสไว้ที่ค่าปัจจุบัน' : 'ปลดล็อก — กลับเป็นอัตโนมัติ');
    }

    /* ---------- ตำแหน่งภาพบนจอ (object-fit: contain) ---------- */
    let rect = { x: 0, y: 0, w: 1, h: 1 };
    function layout() {
      const W = root.clientWidth, H = root.clientHeight, vw = video.videoWidth || 16, vh = video.videoHeight || 9;
      const k = Math.min(W / vw, H / vh);
      rect = { w: vw * k, h: vh * k, x: (W - vw * k) / 2, y: (H - vh * k) / 2 };
      Object.assign(stage.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
      paintGuides();
    }
    addEventListener('resize', layout);
    video.addEventListener('loadedmetadata', layout);
    video.addEventListener('resize', layout);

    /* ---------- ตัวช่วยดูภาพ ---------- */
    const SW = 480, SH = 270;
    const work = document.createElement('canvas');
    work.width = SW; work.height = SH;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    assist.width = SW; assist.height = SH;
    const actx = assist.getContext('2d');
    const out = actx.createImageData(SW, SH);
    const Y = new Uint8ClampedArray(SW * SH);
    const hctx = histC.getContext('2d');
    // False color แบบกล้องภาพยนตร์: ดำจัด=ม่วง, มืด=น้ำเงิน, โทนผิว=เขียว/ชมพู, ใกล้ขาว=เหลือง, ขาวจัด=แดง
    const fcColor = y => y < 10 ? [128, 0, 160] : y < 30 ? [0, 80, 255] : y < 105 ? null : y < 125 ? [0, 200, 70] : y < 150 ? null : y < 175 ? [255, 120, 180] : y < 235 ? null : y < 250 ? [255, 230, 0] : [255, 30, 30];
    let phase = 0;
    function analyse() {
      const any = prefs.zebra || prefs.peaking || prefs.falsecolor || prefs.hist || prefs.wave;
      waveC.hidden = !prefs.wave;
      assist.hidden = !(prefs.zebra || prefs.peaking || prefs.falsecolor);
      histC.hidden = !prefs.hist;
      if (!any || !video.videoWidth || document.hidden) return;
      wctx.drawImage(video, 0, 0, SW, SH);
      const d = wctx.getImageData(0, 0, SW, SH).data, o = out.data, hist = new Uint32Array(64);
      for (let i = 0, j = 0; i < Y.length; i++, j += 4) { const y = (54 * d[j] + 183 * d[j + 1] + 19 * d[j + 2]) >> 8; Y[i] = y; hist[y >> 2]++; }
      if (!assist.hidden) {
        const zebraAt = Math.round(prefs.zebraAt / 100 * 255);
        phase = (phase + 1) % 8;
        for (let y = 0, i = 0; y < SH; y++) {
          for (let x = 0; x < SW; x++, i++) {
            const p = i * 4, v = Y[i];
            let r = 0, g = 0, b = 0, a = 0;
            if (prefs.falsecolor) { const c = fcColor(v); if (c) { [r, g, b] = c; a = 200; } else { r = g = b = v; a = 200; } }
            if (prefs.peaking && x > 0 && y > 0 && x < SW - 1 && y < SH - 1) {
              const gx = Y[i + 1] - Y[i - 1], gy = Y[i + SW] - Y[i - SW];
              if (gx * gx + gy * gy > 2600) { r = 255; g = 40; b = 40; a = 255; }
            }
            if (prefs.zebra && v >= zebraAt && ((x + y + phase) & 7) < 4) { r = g = b = 255; a = 220; }
            o[p] = r; o[p + 1] = g; o[p + 2] = b; o[p + 3] = a;
          }
        }
        actx.putImageData(out, 0, 0);
      }
      if (prefs.wave) drawWave();
      if (prefs.hist) {
        const max = Math.max(1, ...hist);
        hctx.clearRect(0, 0, 128, 56);
        hctx.fillStyle = 'rgba(0,0,0,.45)'; hctx.fillRect(0, 0, 128, 56);
        hctx.fillStyle = 'rgba(255,255,255,.85)';
        for (let i = 0; i < 64; i++) { const hgt = Math.sqrt(hist[i] / max) * 52; hctx.fillRect(i * 2, 56 - hgt, 2, hgt); }
        // ส่วนที่ขาวจัด/ดำจัด (clip) เป็นสีแดง
        hctx.fillStyle = '#ef4444';
        if (hist[63] / Y.length > 0.01) hctx.fillRect(126, 0, 2, 56);
        if (hist[0] / Y.length > 0.01) hctx.fillRect(0, 0, 2, 56);
      }
    }
    setInterval(analyse, 110);
    // Waveform (ความสว่างตามแนวนอนของภาพ) แบบเครื่องวัดในห้องควบคุม: 0–100% · เส้นอ้างอิง 0 / 50 / 100
    const wctx2 = waveC.getContext('2d'), wimg = wctx2.createImageData(128, 56), wacc = new Uint16Array(128 * 56);
    function drawWave() {
      wacc.fill(0);
      for (let y = 0; y < SH; y += 2) for (let x = 0; x < SW; x += 2) { const v = Y[y * SW + x]; wacc[(55 - ((v * 55 / 255) | 0)) * 128 + ((x * 128 / SW) | 0)]++; }
      const o = wimg.data, gain = 255 / Math.max(4, SH / 2 / 56 * 6);
      for (let i = 0; i < wacc.length; i++) { const a = Math.min(255, wacc[i] * gain), p = i * 4; o[p] = 90; o[p + 1] = 255; o[p + 2] = 120; o[p + 3] = a; }
      wctx2.fillStyle = 'rgba(0,0,0,.55)'; wctx2.fillRect(0, 0, 128, 56);
      const tmp = wctx2.__tmp || (wctx2.__tmp = Object.assign(document.createElement('canvas'), { width: 128, height: 56 }));
      tmp.getContext('2d').putImageData(wimg, 0, 0);
      wctx2.drawImage(tmp, 0, 0);
      wctx2.fillStyle = 'rgba(255,255,255,.35)';
      for (const lv of [0, 50, 100]) wctx2.fillRect(0, 55 - Math.round(lv / 100 * 55), 128, 1);
      wctx2.fillStyle = 'rgba(239,68,68,.8)'; wctx2.fillRect(0, 0, 128, 1);
    }

    function paintGuides() {
      const parts = [];
      if (prefs.grid) parts.push('<i class="g-v" style="left:33.33%"></i><i class="g-v" style="left:66.66%"></i><i class="g-h" style="top:33.33%"></i><i class="g-h" style="top:66.66%"></i><i class="g-c"></i>');
      const g = prefs.guide;
      if (g !== 'none') {
        const [a, b] = g === '2.39' ? [2.39, 1] : g === '1.85' ? [1.85, 1] : g.split(':').map(Number);
        const target = a / b, frame = rect.w / rect.h;
        if (target > frame) { const h = frame / target * 100, m = (100 - h) / 2; parts.push(`<i class="g-mask" style="left:0;right:0;top:0;height:${m}%"></i><i class="g-mask" style="left:0;right:0;bottom:0;height:${m}%"></i>`); }
        else { const w = target / frame * 100, m = (100 - w) / 2; parts.push(`<i class="g-mask" style="top:0;bottom:0;left:0;width:${m}%"></i><i class="g-mask" style="top:0;bottom:0;right:0;width:${m}%"></i>`); }
      }
      // พื้นที่ปลอดภัยแบบงานทีวี: Action safe 90% · Title safe 80%
      if (prefs.safe) parts.push('<i class="g-safe g-action" style="left:5%;top:5%;right:5%;bottom:5%"><small>ACTION 90%</small></i><i class="g-safe g-title" style="left:10%;top:10%;right:10%;bottom:10%"><small>TITLE 80%</small></i>');
      guides.innerHTML = parts.join('');
    }

    // ระดับน้ำ (เอียงกล้อง) จากเซนเซอร์ของเครื่อง
    let tilt = null;
    function onOrient(e) {
      const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      const roll = ang === 90 ? -e.beta : ang === -90 || ang === 270 ? e.beta : e.gamma;
      if (typeof roll !== 'number') return;
      tilt = roll;
      const ok = Math.abs(roll) < 1;
      $('i', level).style.transform = `rotate(${(-roll).toFixed(1)}deg)`;
      level.classList.toggle('ok', ok);
      $('span', level).textContent = `${roll > 0 ? '+' : ''}${roll.toFixed(1)}°`;
    }
    async function setLevel(on) {
      prefs.level = on;
      if (on && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') { prefs.level = false; ctx.brief('ไม่ได้รับอนุญาตให้ใช้เซนเซอร์เอียง'); } } catch (e) {}
      }
      if (prefs.level) addEventListener('deviceorientation', onOrient); else removeEventListener('deviceorientation', onOrient);
      level.hidden = !prefs.level;
      savePrefs();
    }

    // มิเตอร์เสียงของไมค์ที่ส่งเข้าสตูดิโอ
    let ac = null, an = null, abuf = null, peakDb = -90, peakAt = 0;
    function startMeter() {
      const s = ctx.getStream(), at = s && s.getAudioTracks()[0];
      if (!at || an) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaStreamSource(new MediaStream([at]));
        an = ac.createAnalyser(); an.fftSize = 1024; abuf = new Float32Array(1024);
        src.connect(an);
      } catch (e) { an = null; }
    }
    function tickMeter() {
      meter.hidden = !prefs.meter;
      if (!prefs.meter || !an) return;
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      an.getFloatTimeDomainData(abuf);
      let pk = 0;
      for (let i = 0; i < abuf.length; i++) pk = Math.max(pk, Math.abs(abuf[i]));
      const db = pk > 0 ? 20 * Math.log10(pk) : -90, now = performance.now();
      if (db > peakDb || now - peakAt > 1500) { peakDb = db; peakAt = now; }
      const pct = v => clamp((v + 60) / 60, 0, 1) * 100;
      $('i', meter).style.height = pct(db) + '%';
      $('i', meter).style.background = db > -3 ? '#ef4444' : db > -12 ? '#f5a524' : '#22c55e';
      $('b', meter).style.bottom = pct(peakDb) + '%';
    }
    setInterval(tickMeter, 60);

    /* ---------- แตะเพื่อโฟกัส/วัดแสง ---------- */
    root.addEventListener('click', e => {
      if (e.target !== video && e.target !== assist && !e.target.closest('.pc-stage')) return;
      if (tool) { closePanel(); return; }
      if (pinch || performance.now() - pinchEndAt < 400) return;
      focusAt((e.clientX - rect.x) / rect.w, (e.clientY - rect.y) / rect.h);
    });
    // แตะเพื่อโฟกัส/วัดแสง (จากจอมือถือ หรือสตูดิโอสั่งมา)
    function focusAt(x, y) {
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
      Object.assign(focusBox.style, { left: x * 100 + '%', top: y * 100 + '%' });
      focusBox.hidden = false;
      focusBox.classList.remove('pulse'); void focusBox.offsetWidth; focusBox.classList.add('pulse');
      setTimeout(() => { focusBox.hidden = true; }, 1600);
      const c = caps(), patch = { pointsOfInterest: [{ x, y }] };
      if (Array.isArray(c.focusMode) && c.focusMode.includes('single-shot')) patch.focusMode = 'single-shot';
      else if (Array.isArray(c.focusMode) && c.focusMode.includes('continuous')) patch.focusMode = 'continuous';
      // วัดแสงตรงจุดที่แตะเฉพาะตอนแสงอัตโนมัติ — ตั้งแสงเองไว้แล้ว (หรือล็อก) จะไม่ถูกเปลี่ยนกลับเป็นอัตโนมัติ
      if (Array.isArray(c.exposureMode) && c.exposureMode.includes('continuous') && !locked && sets().exposureMode !== 'manual') patch.exposureMode = 'continuous';
      apply(patch, true);
    }

    /* ---------- บันทึกในเครื่อง ---------- */
    const pickMime = () => ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    async function recStart() {
      if (rec.recorder || !window.MediaRecorder) { if (!window.MediaRecorder) ctx.brief('เบราว์เซอร์นี้บันทึกวิดีโอไม่ได้'); return; }
      const s = ctx.getStream();
      if (!s) return;
      const mime = pickMime(), st = sets();
      const kbps = (st.height || 1080) >= 2160 ? 40000 : (st.height || 1080) >= 1080 ? 16000 : 8000;
      const r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: kbps * 1000, audioBitsPerSecond: 192000 });
      const d = new Date(), p2 = n => String(n).padStart(2, '0');
      rec.name = `WebMix-Cam-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${(r.mimeType || mime).includes('mp4') ? 'mp4' : 'webm'}`;
      rec.parts = []; rec.bytes = 0; rec.writable = null; rec.chain = Promise.resolve();
      // เขียนลงพื้นที่ของเบราว์เซอร์บนดิสก์ (ไม่กิน RAM ของมือถือ) — ไม่ได้ค่อยเก็บในหน่วยความจำ
      try {
        const dir = await navigator.storage.getDirectory();
        rec.handle = await dir.getFileHandle(rec.name, { create: true });
        rec.writable = await rec.handle.createWritable();
      } catch (e) { rec.writable = null; }
      r.ondataavailable = e => {
        if (!e.data.size) return;
        rec.bytes += e.data.size;
        if (rec.writable) rec.chain = rec.chain.then(() => rec.writable.write(e.data)).catch(() => {});
        else rec.parts.push(e.data);
      };
      r.onstop = async () => {
        await rec.chain;
        let file;
        if (rec.writable) { try { await rec.writable.close(); file = await rec.handle.getFile(); } catch (e) {} }
        if (!file) file = new Blob(rec.parts, { type: r.mimeType || 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = rec.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        ctx.brief(`บันทึก ${rec.name} แล้ว (${(rec.bytes / 1048576).toFixed(0)} MB) — อยู่ในโฟลเดอร์ดาวน์โหลด`);
        rec.recorder = null; rec.since = 0;
        paint(); sendStateSoon();
      };
      r.start(1000);
      rec.recorder = r; rec.since = Date.now();
      paint(); sendStateSoon();
    }
    function recStop() { if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop(); }
    setInterval(() => {
      recEl.hidden = !rec.recorder;
      if (rec.recorder) { const s = Math.floor((Date.now() - rec.since) / 1000); $('span', recEl).textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
    }, 500);

    /* ---------- แผงควบคุม ---------- */
    const seg = (name, items, cur) => `<div class="pc-seg" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const slider = (key, label, r, val, fmt) => `<label class="pc-slider"><span>${label} <b data-val="${key}">${fmt(val)}</b></span>
      <input type="range" data-k="${key}" min="${r.min}" max="${r.max}" step="${r.step || (r.max - r.min) / 200}" value="${val ?? r.min}"></label>`;
    // วงแหวนแบบเลนส์: ลากซ้าย-ขวาให้ขีดสเกลเลื่อนตามนิ้ว (ปล่อยแล้วหมุนต่อด้วยแรงเฉื่อย) · ซูมใช้สเกลลอการิทึม (2× → 4× ระยะลากเท่ากับ 1× → 2×)
    const ring = (key, label, r, val, fmt) => `<div class="pc-ring" data-ring="${key}">
      <div class="pc-ring-head"><span>${label}</span><b data-val="${key}">${fmt(val ?? r.min)}</b></div>
      <div class="pc-ring-band" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="${r.min}" aria-valuemax="${r.max}" aria-valuenow="${val ?? r.min}"><i class="pc-ring-ticks"></i><i class="pc-ring-mark"></i></div>
      <div class="pc-ring-bar"><i></i></div></div>`;
    const unsupported = what => `<p class="pc-note">กล้องหรือเบราว์เซอร์นี้ไม่ให้ปรับ${what} — Android + Chrome รองรับมากที่สุด (iPhone ยังปรับเองได้น้อย)</p>`;
    function panelHtml(t) {
      const c = caps(), s = sets();
      if (t === 'exp') {
        const manual = s.exposureMode === 'manual';
        const iso = range(c.iso), sh = range(c.exposureTime), ev = range(c.exposureCompensation);
        if (!iso && !sh && !ev) return unsupported('แสง');
        return `${Array.isArray(c.exposureMode) && c.exposureMode.length > 1 ? seg('exposureMode', [['continuous', 'AUTO'], ['manual', 'MANUAL']], manual ? 'manual' : 'continuous') : ''}
          ${manual && iso ? slider('iso', 'ISO', iso, s.iso, v => Math.round(v)) : ''}
          ${manual && sh ? slider('exposureTime', 'ชัตเตอร์', sh, s.exposureTime, shutterLabel) + seg('shutterQuick', [[200, '1/50'], [167, '1/60'], [100, '1/100'], [83, '1/120'], [40, '1/250']].filter(([v]) => v >= sh.min && v <= sh.max), '') : ''}
          ${!manual && ev ? slider('exposureCompensation', 'EV', ev, s.exposureCompensation ?? 0, v => (v > 0 ? '+' : '') + (+v).toFixed(1)) : ''}
          <p class="pc-note">ไฟบ้านไทย 50 Hz: ใช้ชัตเตอร์ 1/50 หรือ 1/100 ภาพจะไม่กะพริบ</p>`;
      }
      if (t === 'wb') {
        const ct = range(c.colorTemperature);
        if (!ct && !(Array.isArray(c.whiteBalanceMode) && c.whiteBalanceMode.length > 1)) return unsupported('สมดุลแสงขาว');
        const manual = s.whiteBalanceMode === 'manual';
        return `${seg('whiteBalanceMode', [['continuous', 'AUTO'], ['manual', 'MANUAL']], manual ? 'manual' : 'continuous')}
          ${ct ? slider('colorTemperature', 'อุณหภูมิสี', ct, s.colorTemperature || 5600, v => Math.round(v) + 'K') : ''}
          ${ct ? seg('wbPreset', WB_PRESETS.filter(([, k]) => k >= ct.min && k <= ct.max).map(([l, k]) => [k, `${l} ${k}K`]), '') : ''}`;
      }
      if (t === 'focus') {
        const fd = range(c.focusDistance);
        if (!fd && !(Array.isArray(c.focusMode) && c.focusMode.length)) return unsupported('โฟกัส') + '<p class="pc-note">ยังแตะที่ภาพเพื่อโฟกัสได้ถ้ากล้องรองรับ</p>';
        const manual = s.focusMode === 'manual';
        return `${seg('focusMode', [['continuous', 'AF'], ['manual', 'MF']], manual ? 'manual' : 'continuous')}
          ${fd ? ring('focusDistance', 'ระยะโฟกัส', fd, s.focusDistance ?? fd.min, fmtVal.focusDistance) : ''}
          ${fd ? seg('focusQuick', [[fd.min, 'ใกล้สุด'], [Math.min(fd.max, 1), '1 m'], [Math.min(fd.max, 3), '3 m'], [fd.max, '∞']].filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i), '') : ''}
          <p class="pc-note">หมุนวงแหวน (ลากซ้าย-ขวา) เพื่อดึงโฟกัสแบบนุ่ม — แตะวงแหวนตอน AF จะเปลี่ยนเป็น MF ให้เอง · แตะที่ภาพเพื่อโฟกัสตรงจุดนั้น · เปิด Focus peaking (ASSIST) จะเห็นขอบที่ชัดเป็นสีแดง</p>`;
      }
      if (t === 'zoom') {
        const z = range(c.zoom);
        if (!z) return unsupported('ซูม');
        return `${ring('zoom', 'ซูม', z, s.zoom ?? z.min, fmtVal.zoom)}
          ${seg('zoomQuick', [1, 2, 3, 5, 10].filter(v => v >= z.min && v <= z.max).map(v => [v, v + '×']), s.zoom)}
          <p class="pc-note">หมุนวงแหวนหรือจีบนิ้วบนภาพเพื่อซูมแบบนุ่ม · ปุ่ม 1× 2× 3× ค่อย ๆ ซูมไปตามความเร็วที่เลือก</p>`;
      }
      if (t === 'lens') {
        if (lenses.length < 2) return '<p class="pc-note">ไม่พบเลนส์อื่นในเครื่องนี้ (หรือเบราว์เซอร์ไม่ให้เลือก)</p>';
        return seg('lens', lenses.map((l, i) => [l.id, l.label || `เลนส์ ${i + 1}`]), s.deviceId || '');
      }
      if (t === 'fps') {
        const fr = range(c.frameRate), max = fr ? fr.max : 60;
        return `<div class="pc-label">เฟรมเรต</div>${seg('fps', FPS_LIST.filter(f => f <= max + 0.5).map(f => [f, f]), ctx.getFps())}
          <div class="pc-label">ความละเอียดที่ส่งเข้าสตูดิโอ</div>${seg('quality', ctx.qualities().map(q => [q, q]), ctx.getQuality())}
          <div class="pc-label">ความเร็วซูม / ดึงโฟกัสเมื่อกดปุ่ม</div>${seg('glide', [[0, 'ทันที'], [600, 'เร็ว'], [1500, 'ปานกลาง'], [3000, 'ช้า']], prefs.glide)}
          <p class="pc-note">ตอนนี้ ${s.width || '?'}×${s.height || '?'} @ ${Math.round(s.frameRate || 0)} fps · ใช้ 25 / 50 fps ให้ตรงไฟบ้าน 50 Hz</p>`;
      }
      if (t === 'shot') {
        const sum = sh => sh ? [sh.zoom ? (+sh.zoom).toFixed(1) + '×' : '', sh.focusMode === 'manual' && sh.focusDistance != null ? (+sh.focusDistance).toFixed(2) + ' m' : 'AF', sh.exposureMode === 'manual' ? 'M' : 'A'].filter(Boolean).join(' · ') : 'ว่าง';
        return `<div class="pc-shots">${prefs.shots.map((sh, i) => `<button type="button" data-shot="${i}" class="${sh ? 'has' : ''} ${lastShot === i ? 'on' : ''}"><b>${i + 1}</b><small>${sum(sh)}</small></button>`).join('')}</div>
          <div class="pc-toggles"><button type="button" data-shotsave class="${shotSave ? 'on' : ''}">${shotSave ? 'แตะช่องเพื่อบันทึก…' : 'บันทึกช็อตปัจจุบัน'}</button></div>
          <p class="pc-note">ช็อตจำซูม · โฟกัส · แสง · สมดุลสีขาว — แตะช่องเพื่อเรียกกลับ (ซูม/โฟกัสค่อย ๆ เลื่อนไป) · สตูดิโอสั่งเรียกช็อตได้จากหน้าควบคุมกล้อง</p>`;
      }
      if (t === 'assist') {
        const tog = (k, l) => `<button type="button" data-tog="${k}" class="${prefs[k] ? 'on' : ''}">${l}</button>`;
        return `<div class="pc-toggles">${tog('zebra', 'Zebra')}${tog('peaking', 'Focus peaking')}${tog('falsecolor', 'False color')}${tog('hist', 'Histogram')}${tog('grid', 'ตาราง 3×3')}${tog('safe', 'Safe area')}${tog('wave', 'Waveform')}${tog('level', 'ระดับน้ำ')}${tog('meter', 'มิเตอร์เสียง')}</div>
          ${prefs.zebra ? `<label class="pc-slider"><span>Zebra เริ่มที่ <b data-val="zebraAt">${prefs.zebraAt}%</b></span><input type="range" data-pref="zebraAt" min="70" max="100" step="1" value="${prefs.zebraAt}"></label>` : ''}
          <div class="pc-label">กรอบสัดส่วน</div>${seg('guide', Object.entries(GUIDES), prefs.guide)}`;
      }
      return '';
    }
    function openPanel(t) {
      if (tool === t) { closePanel(); return; }
      closeDial();
      tool = t;
      panel.innerHTML = `<div class="pc-panel-head"><b>${$(`[data-pc="${t}"] small`, rail).textContent}</b><button type="button" class="pc-close">✕</button></div>${panelHtml(t)}`;
      panel.hidden = false;
      paintRings();
      paint();
    }
    function closePanel() { tool = null; panel.hidden = true; closeDial(); paint(); }
    // วาดแผงใหม่ (เช่นเปลี่ยน AUTO → MANUAL แล้วต้องมีแถบเลื่อน) — ยกเว้นตอนกำลังลากแถบเลื่อนอยู่
    const refreshPanel = () => { const a = document.activeElement; if (tool && !ringBusy() && !(a && a.type === 'range' && panel.contains(a))) panel.innerHTML = `<div class="pc-panel-head"><b>${$(`[data-pc="${tool}"] small`, rail).textContent}</b><button type="button" class="pc-close">✕</button></div>${panelHtml(tool)}`; paintRings(); };

    /* ---------- ช็อตที่จำไว้ (Shot presets) ---------- */
    let lastShot = null, shotSave = false;
    const SHOT_KEYS = ['zoom', 'focusMode', 'focusDistance', 'exposureMode', 'iso', 'exposureTime', 'exposureCompensation', 'whiteBalanceMode', 'colorTemperature'];
    function saveShot(i) {
      const s = sets(), c = caps(), sh = {};
      for (const k of SHOT_KEYS) if (s[k] != null && k in c) sh[k] = s[k];
      prefs.shots[i] = sh; savePrefs();
      lastShot = i; shotSave = false;
      ctx.brief(`บันทึกช็อต ${i + 1} แล้ว`);
      paint(); sendStateSoon();
    }
    async function recallShot(i) {
      const sh = prefs.shots[i];
      if (!sh) { ctx.brief(`ช็อต ${i + 1} ยังว่าง`); return; }
      const patch = {};
      for (const k of ['exposureMode', 'iso', 'exposureTime', 'exposureCompensation', 'whiteBalanceMode', 'colorTemperature', 'focusMode']) if (sh[k] != null) patch[k] = sh[k];
      if (patch.exposureMode !== 'manual') { delete patch.iso; delete patch.exposureTime; }
      if (patch.whiteBalanceMode !== 'manual') delete patch.colorTemperature;
      if (Object.keys(patch).length) await apply(patch, true);
      if (sh.zoom != null) glide('zoom', +sh.zoom);
      if (sh.focusMode === 'manual' && sh.focusDistance != null) glide('focusDistance', +sh.focusDistance);
      lastShot = i;
      paint(); sendStateSoon();
    }

    /* ---------- ล็อกจอ: กันนิ้วโดนระหว่างถ่าย (กดค้าง 1 วินาทีเพื่อปลด) ---------- */
    let tlTimer = null;
    function setTouchLock(on) {
      touchLock.hidden = !on;
      root.classList.toggle('touch-locked', on);
      $('[data-caller="lock"]', root)?.classList.toggle('is-on', on);
      if (on) { closePanel(); ctx.brief('ล็อกจอแล้ว — กดค้าง 1 วินาทีเพื่อปลดล็อก'); }
    }
    const tlCancel = () => { clearTimeout(tlTimer); tlTimer = null; touchLock.classList.remove('holding'); };
    touchLock.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); tlCancel(); touchLock.classList.add('holding'); tlTimer = setTimeout(() => { tlCancel(); setTouchLock(false); }, 1000); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) touchLock.addEventListener(ev, tlCancel);
    touchLock.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }, true);
    root.addEventListener('click', e => { if (e.target.closest('[data-caller="lock"]')) setTouchLock(true); });

    /* ---------- ภาพ Program จากสตูดิโอ (return feed) ---------- */
    function setReturn(on) {
      prefs.ret = !!on; savePrefs();
      ctx.send({ type: 'cam-return', on: prefs.ret });
      if (!prefs.ret) showReturn(null);
      paint();
    }
    function showReturn(stream) {
      retV.srcObject = stream || null;
      retV.hidden = !stream;
      if (stream) retV.play().catch(() => {});
    }
    retV.addEventListener('click', () => retV.classList.toggle('big'));

    /* ---------- เน็ตอ่อน: เตือน + ลดความละเอียดเองไม่ให้ภาพค้าง ---------- */
    let badPolls = 0, autoFrom = null, autoAt = 0;
    function checkNet() {
      const bad = stats.limit === 'bandwidth' || (stats.rtt != null && stats.rtt > 500);
      badPolls = bad ? badPolls + 1 : 0;
      const qs = ctx.qualities(), qi = qs.indexOf(ctx.getQuality());
      if (prefs.autoq && badPolls >= 3 && qi > 0 && Date.now() - autoAt > 30000) {
        if (autoFrom == null) autoFrom = ctx.getQuality();
        autoAt = Date.now(); badPolls = 0;
        const to = qs[qi - 1];
        ctx.setQuality(to).then(afterTrackChange);
        ctx.brief(`เน็ตส่งไม่ทัน — ลดเป็น ${to} อัตโนมัติ`);
      }
      netEl.hidden = !(bad || autoFrom);
      $('span', netEl).textContent = bad ? ['เน็ตอ่อน', stats.rtt != null && `ดีเลย์ ${Math.round(stats.rtt)} ms`, stats.kbps && `${(stats.kbps / 1000).toFixed(1)} Mb/s`].filter(Boolean).join(' · ') : `ลดความละเอียดเป็น ${ctx.getQuality()} ชั่วคราว (เน็ตกลับมาดีแล้ว)`;
      netEl.classList.toggle('bad', bad);
      $('[data-net="restore"]', netEl).hidden = !autoFrom || bad;
    }
    netEl.addEventListener('click', e => {
      if (!e.target.closest('[data-net="restore"]') || !autoFrom) return;
      const q = autoFrom; autoFrom = null; autoAt = Date.now();
      ctx.setQuality(q).then(afterTrackChange);
      netEl.hidden = true;
    });

    rail.addEventListener('click', e => {
      const b = e.target.closest('[data-pc]');
      if (!b) return;
      const t = b.dataset.pc;
      if (t === 'ret') { setReturn(!prefs.ret); return; }
      if (t === 'zoom' || (t === 'focus' && range(caps().focusDistance))) { openDial(t); return; }
      if (t === 'rec') { rec.recorder ? recStop() : recStart(); return; }
      if (t === 'torch') { apply({ torch: !sets().torch }); return; }
      if (t === 'lock') { setLock(!locked); return; }
      openPanel(t);
    });
    panel.addEventListener('click', async e => {
      if (e.target.closest('.pc-close')) { closePanel(); return; }
      const sb = e.target.closest('[data-shot]');
      if (sb) { const i = +sb.dataset.shot; if (shotSave) saveShot(i); else await recallShot(i); refreshPanel(); return; }
      if (e.target.closest('[data-shotsave]')) { shotSave = !shotSave; refreshPanel(); return; }
      const tog = e.target.closest('[data-tog]');
      if (tog) {
        const k = tog.dataset.tog;
        if (k === 'level') await setLevel(!prefs.level); else { prefs[k] = !prefs[k]; savePrefs(); }
        if (k === 'meter' && prefs.meter) startMeter();
        paintGuides(); refreshPanel(); paint();
        return;
      }
      const b = e.target.closest('.pc-seg button');
      if (!b) return;
      const name = b.closest('.pc-seg').dataset.seg, v = b.dataset.v;
      if (name === 'exposureMode' || name === 'whiteBalanceMode' || name === 'focusMode') {
        const s = sets(), patch = { [name]: v };
        // เข้าโหมดปรับเองโดยเริ่มจากค่าที่กล้องใช้อยู่ ภาพจะไม่กระโดด
        if (v === 'manual' && name === 'exposureMode') Object.assign(patch, { iso: s.iso, exposureTime: s.exposureTime });
        if (v === 'manual' && name === 'whiteBalanceMode' && s.colorTemperature) patch.colorTemperature = s.colorTemperature;
        if (v === 'manual' && name === 'focusMode' && s.focusDistance != null) patch.focusDistance = s.focusDistance;
        for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
        await apply(patch);
      } else if (name === 'shutterQuick') await apply({ exposureTime: +v });
      else if (name === 'wbPreset') await apply({ colorTemperature: +v });
      else if (name === 'zoomQuick') { glide('zoom', +v); return; }
      else if (name === 'focusQuick') { glide('focusDistance', +v); return; }
      else if (name === 'glide') { prefs.glide = +v; savePrefs(); }
      else if (name === 'lens') { const l = lenses.find(x => x.id === v); await ctx.setLens(v, l && l.side); afterTrackChange(); }
      else if (name === 'fps') { await ctx.setFps(+v); afterTrackChange(); }
      else if (name === 'quality') { await ctx.setQuality(v); afterTrackChange(); }
      else if (name === 'guide') { prefs.guide = v; savePrefs(); paintGuides(); }
      refreshPanel();
    });
    let dragTimer = null;
    panel.addEventListener('input', e => {
      const k = e.target.dataset.k, pk = e.target.dataset.pref;
      if (pk) { prefs[pk] = +e.target.value; savePrefs(); const l = $(`[data-val="${pk}"]`, panel); if (l) l.textContent = prefs[pk] + '%'; return; }
      if (!k) return;
      const v = +e.target.value, l = $(`[data-val="${k}"]`, panel);
      if (l) l.textContent = k === 'exposureTime' ? shutterLabel(v) : k === 'colorTemperature' ? Math.round(v) + 'K' : k === 'zoom' ? v.toFixed(1) + '×' : k === 'focusDistance' ? v.toFixed(2) + ' m' : k === 'exposureCompensation' ? (v > 0 ? '+' : '') + v.toFixed(1) : Math.round(v);
      clearTimeout(dragTimer);
      dragTimer = setTimeout(() => apply({ [k]: v }, true), 40);
    });
    panel.addEventListener('change', e => { if (e.target.dataset.k) e.target.blur(); });

    /* ---------- วงแหวนโฟกัส / ซูมแบบนุ่ม ----------
       ส่งค่าให้กล้องทีละครั้ง (รอครั้งก่อนเสร็จ แล้วส่งค่าล่าสุด) — ลากเร็วแค่ไหนกล้องก็ไม่ค้างคิว
       glide = ค่อย ๆ เปลี่ยนไปยังค่าเป้าหมาย (ease in-out) เหมือนซูมไฟฟ้า / ดึงโฟกัสของกล้องวิดีโอ */
    const fmtVal = { zoom: v => (+v).toFixed(1) + '×', focusDistance: v => (+v).toFixed(2) + ' m' };
    const drv = {};
    const cur = k => { const d = drv[k]; return d && d.target != null ? d.target : sets()[k]; };
    function drive(k, v) {
      const r = range(caps()[k]);
      if (!r) return;
      v = clamp(v, r.min, r.max);
      const d = drv[k] || (drv[k] = { busy: false, target: null });
      d.target = v;
      paintRing(k, v);
      if (dialOpen && (k === 'zoom' || k === 'focusDistance')) paintDial();
      if (d.busy) return;
      const send = async () => {
        const t = track();
        if (!t) return;
        d.busy = true;
        const val = d.target, adv = { [k]: val };
        if (k === 'focusDistance' && sets().focusMode !== 'manual') adv.focusMode = 'manual';
        try { await t.applyConstraints({ advanced: [adv] }); } catch (e) {}
        d.busy = false;
        if (d.target !== val) send();
        else { d.target = null; paint(); sendStateSoon(); if (dialOpen && !d.anim && !dialDrag && !servo.raf) paintDialChips(); }
      };
      send();
    }
    function glide(k, to) {
      const r = range(caps()[k]);
      if (!r) return;
      const d = drv[k] || (drv[k] = { busy: false, target: null });
      cancelAnimationFrame(d.anim);
      const from = +(cur(k) ?? to), ms = prefs.glide || 0;
      if (!ms || Math.abs(to - from) < 1e-6) { drive(k, to); return; }
      const lg = k === 'zoom' && from > 0 && to > 0, a = lg ? Math.log(from) : from, b = lg ? Math.log(to) : to, t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, x = a + (b - a) * e;
        drive(k, lg ? Math.exp(x) : x);
        if (p < 1) d.anim = requestAnimationFrame(step); else d.anim = 0;
      };
      d.anim = requestAnimationFrame(step);
    }
    // ตำแหน่ง 0–1 บนวงแหวน (ซูม = ลอการิทึม)
    const toU = (k, v, r) => k === 'zoom' && r.min > 0 ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min);
    const fromU = (k, u, r) => { u = clamp(u, 0, 1); return k === 'zoom' && r.min > 0 ? r.min * Math.pow(r.max / r.min, u) : r.min + u * (r.max - r.min); };
    function paintRing(k, v) {
      const el = $(`.pc-ring[data-ring="${k}"]`, panel), r = range(caps()[k]);
      if (!el || !r) return;
      const u = clamp(toU(k, v, r), 0, 1);
      // ทั้งช่วงเท่ากับวงแหวนยาว 3 เท่าของแถบ — ขีดสเกลเลื่อนตามค่า
      $('.pc-ring-ticks', el).style.backgroundPositionX = `${(-u * (el.clientWidth || 300) * 3).toFixed(1)}px`;
      $('.pc-ring-bar i', el).style.width = `${(u * 100).toFixed(1)}%`;
      $(`[data-val="${k}"]`, el).textContent = fmtVal[k](v);
      $('.pc-ring-band', el).setAttribute('aria-valuenow', (+v).toFixed(2));
    }
    const paintRings = () => panel.querySelectorAll('.pc-ring').forEach(el => { const k = el.dataset.ring, v = cur(k); if (v != null) paintRing(k, +v); });
    let ringDrag = null;
    const ringBusy = () => !!ringDrag || Object.values(drv).some(d => d.busy || d.coast);
    panel.addEventListener('pointerdown', e => {
      const band = e.target.closest('.pc-ring-band');
      if (!band) return;
      const k = band.closest('.pc-ring').dataset.ring, r = range(caps()[k]);
      if (!r) return;
      e.preventDefault();
      try { band.setPointerCapture(e.pointerId); } catch (x) {}
      const d = drv[k] || (drv[k] = { busy: false, target: null });
      cancelAnimationFrame(d.anim); cancelAnimationFrame(d.coast); d.coast = 0;
      ringDrag = { k, r, band, pid: e.pointerId, u: toU(k, +cur(k), r), x: e.clientX, t: performance.now(), vel: 0 };
      band.classList.add('turning');
    });
    panel.addEventListener('pointermove', e => {
      const g = ringDrag;
      if (!g || e.pointerId !== g.pid) return;
      const now = performance.now(), dx = e.clientX - g.x, span = g.band.clientWidth * 3 || 900;
      // ลากนิ้วไปทางซ้าย = ค่าเพิ่ม (สเกลเลื่อนตามนิ้ว เหมือนหมุนวงแหวนเลนส์)
      const du = -dx / span;
      g.u = clamp(g.u + du, 0, 1);
      g.vel = 0.7 * g.vel + 0.3 * (du / Math.max(1, now - g.t));
      g.x = e.clientX; g.t = now;
      drive(g.k, fromU(g.k, g.u, g.r));
    });
    const ringUp = e => {
      const g = ringDrag;
      if (!g || e.pointerId !== g.pid) return;
      ringDrag = null;
      g.band.classList.remove('turning');
      const d = drv[g.k];
      let vel = performance.now() - g.t < 80 ? g.vel : 0, last = performance.now(), u = g.u;
      // แรงเฉื่อย: หมุนต่ออีกนิดแล้วค่อย ๆ หยุด
      const coast = now => {
        const dt = now - last; last = now;
        vel *= Math.pow(0.992, dt);
        u = clamp(u + vel * dt, 0, 1);
        drive(g.k, fromU(g.k, u, g.r));
        if (Math.abs(vel) > 0.00002 && u > 0 && u < 1) d.coast = requestAnimationFrame(coast); else { d.coast = 0; setTimeout(refreshPanel, 300); }
      };
      if (Math.abs(vel) > 0.00005) d.coast = requestAnimationFrame(coast); else setTimeout(refreshPanel, 300);
    };
    panel.addEventListener('pointerup', ringUp);
    panel.addEventListener('pointercancel', ringUp);
    // ล้อเมาส์ / ปุ่มลูกศรบนวงแหวน (ละเอียดทีละ 1% · Shift = 5%)
    panel.addEventListener('wheel', e => {
      const band = e.target.closest('.pc-ring-band');
      if (!band) return;
      e.preventDefault();
      const k = band.closest('.pc-ring').dataset.ring, r = range(caps()[k]);
      if (r) drive(k, fromU(k, toU(k, +cur(k), r) + (e.deltaY || e.deltaX) / 2000, r));
    }, { passive: false });
    panel.addEventListener('keydown', e => {
      const band = e.target.closest('.pc-ring-band');
      if (!band || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      e.preventDefault();
      const k = band.closest('.pc-ring').dataset.ring, r = range(caps()[k]), dir = /Right|Up/.test(e.key) ? 1 : -1;
      if (r) drive(k, fromU(k, toU(k, +cur(k), r) + dir * (e.shiftKey ? 0.05 : 0.01), r));
    });
    // จีบนิ้วบนภาพ = ซูมแบบนุ่ม
    const touches = new Map();
    let pinch = null;
    const onPicture = e => e.target === video || e.target === assist || !!e.target.closest('.pc-stage');
    root.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || !onPicture(e)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      const z = range(caps().zoom);
      if (touches.size === 2 && z) {
        const [a, b] = [...touches.values()];
        pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: +(cur('zoom') || z.min) };
      }
    });
    root.addEventListener('pointermove', e => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (!pinch || touches.size !== 2) return;
      const [a, b] = [...touches.values()];
      drive('zoom', pinch.z0 * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d0));
    });
    const endTouch = e => { touches.delete(e.pointerId); if (touches.size < 2 && pinch) { pinch = null; pinchEndAt = performance.now(); setTimeout(refreshPanel, 300); } };
    let pinchEndAt = 0;
    root.addEventListener('pointerup', endTouch);
    root.addEventListener('pointercancel', endTouch);

    /* ---------- วงล้อเลนส์ครึ่งวงกลมด้านข้าง (แบบ jog wheel ของ Final Cut บน iPad) ----------
       ชั้นนอก = ซูมแบบ servo ต่อเนื่องเหมือนคันซูมเลนส์ broadcast: ดันขึ้น (T) / ลง (W) — ยิ่งดันมากยิ่งซูมเร็ว ·
                 เร่งและหยุดแบบนุ่ม (ไม่กระตุก) · ปล่อยนิ้วแล้วคันดีดกลับ ซูมค่อย ๆ หยุด
       ชั้นใน = วงแหวนโฟกัส: หมุนตามโค้ง ขีดสเกลหมุนตามนิ้ว (หมุนขึ้น = โฟกัสไกลขึ้น) · หมุน 1 รอบ = ทั้งช่วง */
    const DIAL_TURN = Math.PI * 2, SERVO_MAX = 1.15; // มุมดันสุด (เรเดียน, ~66°)
    const FOCUS_MARKS = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10, 20];
    const dial = document.createElement('div');
    dial.className = 'pc-dial';
    dial.hidden = true;
    dial.innerHTML = `<canvas></canvas>
      <div class="pc-dial-val"><small>ZOOM</small><b data-dv="zoom"></b><small>FOCUS</small><b data-dv="focus"></b></div>
      <div class="pc-dial-chips"></div><button type="button" class="pc-dial-close" aria-label="ปิด">✕</button>`;
    root.appendChild(dial);
    const dialCv = $('canvas', dial);
    let dialOpen = false, dialDrag = null, dialR = 160;
    const servo = { disp: 0, target: 0, speed: 0, raf: 0, last: 0, u: 0 };
        function openDial(t) {
      if (tool === t || (dialOpen && (t === 'zoom' || t === 'focus'))) { closePanel(); return; }
      panel.hidden = true;
      tool = t; dialOpen = true;
      dial.hidden = false;
      paintDialChips();
      layoutDial();
      paintDial();
      paint();
    }
    function closeDial() { dial.hidden = true; dialOpen = false; servo.target = 0; }
    function layoutDial() {
      dialR = Math.round(Math.max(120, Math.min(200, (root.clientHeight - 150) / 2, root.clientWidth * 0.48)));
      dial.style.setProperty('--r', dialR + 'px');
      const dpr = window.devicePixelRatio || 1;
      if (dialCv.width !== Math.round(dialR * dpr)) { dialCv.width = Math.round(dialR * dpr); dialCv.height = Math.round(2 * dialR * dpr); }
    }
    addEventListener('resize', () => { if (dialOpen) { layoutDial(); paintDial(); } });
    function paintDialChips() {
      const c = caps(), s = sets(), box = $('.pc-dial-chips', dial), z = range(c.zoom), f = range(c.focusDistance);
      const chip = (attr, v, l, on) => `<button type="button" ${attr}="${v}" class="${on ? 'on' : ''}">${l}</button>`;
      let html = '';
      if (z) html += [1, 2, 3, 5, 10].filter(v => v >= z.min && v <= z.max).map(v => chip('data-dz', v, v + '×', Math.abs((s.zoom || 1) - v) < 0.05)).join('');
      if (lenses.length > 1) html += '<i></i>' + lenses.map(l => chip('data-dlens', l.id, l.short, l.id === s.deviceId)).join('');
      if (f || (Array.isArray(c.focusMode) && c.focusMode.length)) {
        html += '<i></i>' + chip('data-daf', 1, 'AF', s.focusMode !== 'manual');
        if (f) html += [[f.max, '∞'], [Math.min(f.max, 3), '3m'], [Math.min(f.max, 1), '1m'], [f.min, 'ใกล้']].filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i).map(([v, l]) => chip('data-dfd', v, l, false)).join('');
      }
      box.innerHTML = html;
    }
    function paintDial() {
      if (!dialOpen) return;
      const c = caps(), z = range(c.zoom), f = range(c.focusDistance), s = sets();
      const zv = +(cur('zoom') ?? (z ? z.min : 1)), fv = +(cur('focusDistance') ?? (f ? f.min : 0));
      $('[data-dv="zoom"]', dial).textContent = z ? fmtVal.zoom(zv) : '—';
      $('[data-dv="focus"]', dial).textContent = !f ? (s.focusMode === 'manual' ? 'MF' : 'AF') : (s.focusMode !== 'manual' && !(drv.focusDistance && drv.focusDistance.target != null) ? 'AF' : fmtVal.focusDistance(fv));
      const dpr = window.devicePixelRatio || 1, Rpx = dialCv.width / dpr, g = dialCv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, Rpx, Rpx * 2);
      const cx = Rpx, cy = Rpx, ro = Rpx - 2, rm = Rpx * 0.74, ri = Rpx * 0.44;
      const band = (r1, r2, c1, c2) => {
        const grad = g.createRadialGradient(cx, cy, r2, cx, cy, r1);
        grad.addColorStop(0, c1); grad.addColorStop(1, c2);
        g.fillStyle = grad;
        g.beginPath(); g.arc(cx, cy, r1, Math.PI / 2, Math.PI * 1.5); g.arc(cx, cy, r2, Math.PI * 1.5, Math.PI / 2, true); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.stroke();
      };
      // ชั้นนอก: ซูม servo
      band(ro, rm + 2, 'rgba(30,33,42,.94)', 'rgba(12,14,19,.97)');
      if (z) {
        // ร่องกันลื่นของวงแหวน (ขยับตามความเร็วซูม ให้เห็นว่ากำลังหมุน)
        servo.phase = (servo.phase || 0) + servo.speed * 40;
        for (let i = 0; i < 46; i++) {
          const a = Math.PI / 2 + 0.06 + ((i / 46 + servo.phase) % 1 + 1) % 1 * (Math.PI - 0.12);
          g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(cx + Math.cos(a) * (ro - 4), cy + Math.sin(a) * (ro - 4)); g.lineTo(cx + Math.cos(a) * (rm + 6), cy + Math.sin(a) * (rm + 6)); g.stroke();
        }
        // ตำแหน่งซูมในทั้งช่วง: แถบโค้งขอบนอก จาก W (ล่าง) ขึ้นไป T (บน)
        const uz = clamp(toU('zoom', zv, z), 0, 1);
        g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, ro - 1.5, Math.PI / 2, Math.PI * 1.5); g.stroke();
        g.strokeStyle = '#38bdf8';
        g.beginPath(); g.arc(cx, cy, ro - 1.5, Math.PI / 2, Math.PI / 2 + uz * Math.PI); g.stroke();
        const lab = (t, a) => { g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `800 ${Math.round(Rpx * 0.085)}px ui-monospace, Menlo, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, cx + Math.cos(a) * (ro + rm) / 2, cy + Math.sin(a) * (ro + rm) / 2); };
        lab('T', Math.PI + SERVO_MAX + 0.22); lab('W', Math.PI - SERVO_MAX - 0.22);
        // คันซูม: ปุ่มกลมตามมุมที่ดัน + ลูกศรบอกทิศ/ความแรง
        const ka = Math.PI + servo.disp, kr = (ro + rm) / 2;
        g.fillStyle = 'rgba(56,189,248,.18)';
        g.beginPath(); g.arc(cx, cy, ro - 3, Math.PI, ka, servo.disp < 0); g.arc(cx, cy, rm + 4, ka, Math.PI, servo.disp >= 0); g.closePath(); g.fill();
        g.fillStyle = Math.abs(servo.disp) > 0.02 ? '#38bdf8' : 'rgba(255,255,255,.85)';
        g.beginPath(); g.arc(cx + Math.cos(ka) * kr, cy + Math.sin(ka) * kr, (ro - rm) * 0.34, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#0b0d12'; g.font = `900 ${Math.round(Rpx * 0.07)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(servo.disp > 0.02 ? '▲' : servo.disp < -0.02 ? '▼' : '◆', cx + Math.cos(ka) * kr, cy + Math.sin(ka) * kr + 1);
      }
      // ชั้นใน: วงแหวนโฟกัส
      band(rm - 2, ri, 'rgba(40,44,55,.94)', 'rgba(20,22,29,.97)');
      if (f) {
        const u0 = clamp(toU('focusDistance', fv, f), 0, 1), ang = u => Math.PI - (u - u0) * DIAL_TURN;
        const vis = a => a > Math.PI / 2 + 0.05 && a < Math.PI * 1.5 - 0.05;
        for (let i = 0; i <= 120; i++) {
          const a = ang(i / 120);
          if (!vis(a)) continue;
          const major = i % 10 === 0, len = major ? 0.18 : 0.09;
          g.strokeStyle = `rgba(255,255,255,${major ? 0.7 : 0.33})`; g.lineWidth = major ? 1.6 : 1;
          g.beginPath(); g.moveTo(cx + Math.cos(a) * (rm - 5), cy + Math.sin(a) * (rm - 5)); g.lineTo(cx + Math.cos(a) * (rm - 5 - (rm - ri) * len * 2.2), cy + Math.sin(a) * (rm - 5 - (rm - ri) * len * 2.2)); g.stroke();
        }
        g.font = `600 ${Math.round(Rpx * 0.072)}px ui-monospace, Menlo, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
        let lastA = -9;
        for (const m of FOCUS_MARKS) {
          if (m < f.min - 1e-9 || m > f.max + 1e-9) continue;
          const a = ang(toU('focusDistance', m, f));
          // ป้ายตัวเลขห่างกันอย่างน้อย ~16° ไม่ให้ทับกัน
          if (!vis(a) || Math.abs(a - lastA) < 0.28) continue;
          lastA = a;
          g.fillStyle = 'rgba(255,255,255,.85)';
          g.fillText(m >= 10 ? '∞' : m + 'm', cx + Math.cos(a) * (ri + (rm - ri) * 0.32), cy + Math.sin(a) * (ri + (rm - ri) * 0.32));
        }
      } else {
        g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `600 ${Math.round(Rpx * 0.07)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('AF', cx - (rm + ri) / 2, cy);
      }
      // ตัวชี้ (9 นาฬิกา)
      g.strokeStyle = '#f5a524'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx - rm + 2, cy); g.lineTo(cx - ri - 2, cy); g.stroke();
      g.fillStyle = '#f5a524'; g.beginPath(); g.moveTo(cx - ro - 2, cy - 7); g.lineTo(cx - ro + 8, cy); g.lineTo(cx - ro - 2, cy + 7); g.fill();
      g.lineCap = 'butt';
    }
    // วงล้อ servo: ความเร็วตามมุมที่ดัน (โค้งยกกำลังสอง — ดันนิดเดียว = ช้ามาก ละเอียดตอนออกอากาศ) · ทั้งช่วงใช้ ~3 วินาทีเมื่อดันสุด
    function servoLoop(now) {
      const z = range(caps().zoom);
      if (!z) { servo.raf = 0; return; }
      const dt = Math.min(50, now - (servo.last || now)); servo.last = now;
      const x = clamp(servo.target / SERVO_MAX, -1, 1), want = Math.sign(x) * x * x / 3000;
      // เร่ง/ผ่อนแบบนุ่ม (time constant ~140 ms) เหมือนมอเตอร์ซูมของเลนส์
      servo.speed += (want - servo.speed) * Math.min(1, dt / 140);
      // คันดีดกลับตรงกลางเมื่อปล่อยนิ้ว
      servo.disp += (servo.target - servo.disp) * Math.min(1, dt / 70);
      if (Math.abs(servo.speed) > 1e-7) {
        servo.u = clamp(servo.u + servo.speed * dt, 0, 1);
        drive('zoom', fromU('zoom', servo.u, z));
        if (servo.u <= 0 || servo.u >= 1) servo.speed = 0;
      }
      paintDial();
      if (Math.abs(servo.speed) > 1e-7 || Math.abs(servo.disp) > 0.002 || servo.target) servo.raf = requestAnimationFrame(servoLoop);
      else { servo.raf = 0; servo.disp = 0; paintDial(); paintDialChips(); }
    }
    const geo = e => { const b = dialCv.getBoundingClientRect(), dx = e.clientX - b.right, dy = e.clientY - (b.top + b.height / 2); return { a: Math.atan2(dy, dx), r: Math.hypot(dx, dy) / (b.width || 1) }; };
    dial.addEventListener('pointerdown', e => {
      if (e.target.closest('.pc-dial-chips button, .pc-dial-close') || !dialOpen) return;
      const { a, r } = geo(e), c = caps();
      const ring = r > 0.74 ? 'zoom' : r > 0.36 ? 'focusDistance' : null;
      if (!ring || !range(c[ring])) return;
      e.preventDefault();
      try { dial.setPointerCapture(e.pointerId); } catch (x) {}
      const d = drv[ring] || (drv[ring] = { busy: false, target: null });
      cancelAnimationFrame(d.anim); cancelAnimationFrame(d.coast); d.anim = 0; d.coast = 0;
      dialDrag = { ring, pid: e.pointerId, a0: a, a, t: performance.now(), vel: 0, u: toU(ring, +cur(ring), range(c[ring])) };
      if (ring === 'zoom') { servo.u = dialDrag.u; servo.last = 0; }
      dial.classList.add('turning');
      navigator.vibrate && navigator.vibrate(5);
    });
    dial.addEventListener('pointermove', e => {
      const g = dialDrag;
      if (!g || e.pointerId !== g.pid) return;
      const { a } = geo(e), now = performance.now();
      if (g.ring === 'zoom') {
        // มุมที่ดันจาก 9 นาฬิกา: ขึ้น (T) = บวก · จำกัดที่ ±66°
        let disp = a - Math.PI; if (disp < -Math.PI) disp += 2 * Math.PI;
        if (a < 0) disp = a + Math.PI;
        servo.target = clamp(disp, -SERVO_MAX, SERVO_MAX);
        if (!servo.raf) servo.raf = requestAnimationFrame(servoLoop);
        return;
      }
      const f = range(caps().focusDistance);
      let da = a - g.a;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      g.a = a;
      const du = da / DIAL_TURN, before = g.u;
      g.u = clamp(g.u + du, 0, 1);
      g.vel = 0.7 * g.vel + 0.3 * (du / Math.max(1, now - g.t));
      g.t = now;
      if (navigator.vibrate && FOCUS_MARKS.some(m => m >= f.min && m <= f.max && (toU('focusDistance', m, f) - before) * (toU('focusDistance', m, f) - g.u) < 0)) navigator.vibrate(8);
      drive('focusDistance', fromU('focusDistance', g.u, f));
    });
    const dialUp = e => {
      const g = dialDrag;
      if (!g || e.pointerId !== g.pid) return;
      dialDrag = null;
      dial.classList.remove('turning');
      if (g.ring === 'zoom') { servo.target = 0; if (!servo.raf) servo.raf = requestAnimationFrame(servoLoop); return; }
      const f = range(caps().focusDistance), d = drv.focusDistance;
      let vel = performance.now() - g.t < 80 ? g.vel : 0, last = performance.now(), u = g.u;
      const coast = now => {
        const dt = now - last; last = now;
        vel *= Math.pow(0.993, dt);
        u = clamp(u + vel * dt, 0, 1);
        drive('focusDistance', fromU('focusDistance', u, f));
        if (Math.abs(vel) > 0.00002 && u > 0 && u < 1) d.coast = requestAnimationFrame(coast); else { d.coast = 0; setTimeout(paintDialChips, 200); }
      };
      if (Math.abs(vel) > 0.00004) d.coast = requestAnimationFrame(coast); else setTimeout(paintDialChips, 200);
    };
    dial.addEventListener('pointerup', dialUp);
    dial.addEventListener('pointercancel', dialUp);
    // ล้อเมาส์: ซูม (Shift = โฟกัส)
    dial.addEventListener('wheel', e => {
      if (!dialOpen) return;
      const k = e.shiftKey ? 'focusDistance' : 'zoom', r = range(caps()[k]);
      if (!r) return;
      e.preventDefault();
      drive(k, fromU(k, toU(k, +cur(k), r) - (e.deltaY || 0) / 1500, r));
    }, { passive: false });
    dial.addEventListener('click', async e => {
      if (e.target.closest('.pc-dial-close')) { closePanel(); return; }
      const b = e.target.closest('.pc-dial-chips button');
      if (!b) return;
      if (b.dataset.dz) glide('zoom', +b.dataset.dz);
      else if (b.dataset.dfd) glide('focusDistance', +b.dataset.dfd);
      else if (b.dataset.daf) await apply({ focusMode: 'continuous' }, true);
      else if (b.dataset.dlens) { const l = lenses.find(x => x.id === b.dataset.dlens); if (l) { await ctx.setLens(l.id, l.side); afterTrackChange(); } }
      setTimeout(() => { if (dialOpen) { paintDialChips(); paintDial(); } }, 260);
    });

    /* ---------- แถบสถานะ / ค่าบนปุ่ม ---------- */
    function paint() {
      const c = caps(), s = sets();
      const set = (t, v, on) => { const b = $(`[data-pc="${t}"]`, rail); if (!b) return; $('b', b).textContent = v; b.classList.toggle('on', !!on); b.classList.toggle('active', tool === t); };
      set('exp', s.exposureMode === 'manual' ? `${s.iso ? 'ISO ' + Math.round(s.iso) : ''} ${shutterLabel(s.exposureTime)}`.trim() : has(c, 'exposureCompensation') && s.exposureCompensation ? `AUTO ${s.exposureCompensation > 0 ? '+' : ''}${(+s.exposureCompensation).toFixed(1)}` : 'AUTO', s.exposureMode === 'manual');
      set('wb', s.whiteBalanceMode === 'manual' && s.colorTemperature ? Math.round(s.colorTemperature) + 'K' : 'AUTO', s.whiteBalanceMode === 'manual');
      set('focus', s.focusMode === 'manual' ? 'MF' : 'AF', s.focusMode === 'manual');
      set('zoom', s.zoom ? (+s.zoom).toFixed(1) + '×' : '1.0×', s.zoom > 1.01);
      const li = lenses.findIndex(l => l.id === s.deviceId);
      set('lens', li >= 0 ? `${li + 1}/${lenses.length}` : lenses.length ? '—' : '1');
      set('fps', `${ctx.getQuality()} ${ctx.getFps()}`);
      set('assist', [prefs.zebra && 'Z', prefs.peaking && 'P', prefs.falsecolor && 'FC', prefs.grid && '#', prefs.safe && 'S', prefs.wave && 'W', prefs.guide !== 'none' && prefs.guide].filter(Boolean).join(' ') || '—', prefs.zebra || prefs.peaking || prefs.falsecolor);
      set('lock', locked ? 'ON' : 'OFF', locked);
      set('torch', s.torch ? 'ON' : 'OFF', s.torch);
      const tb = $('[data-pc="torch"]', rail);
      if (tb) tb.hidden = !has(c, 'torch');
      set('rec', rec.recorder ? '■' : '●', !!rec.recorder);
      set('shot', lastShot != null ? String(lastShot + 1) : prefs.shots.some(Boolean) ? '—' : '—', lastShot != null);
      set('ret', prefs.ret ? 'ON' : 'OFF', prefs.ret);
      const bits = [`${s.width || '?'}×${s.height || '?'}`, `${Math.round(stats.fps || s.frameRate || 0)} fps`];
      if (stats.kbps) bits.push(`${(stats.kbps / 1000).toFixed(1)} Mb/s`);
      if (stats.rtt != null) bits.push(`ดีเลย์ ${Math.round(stats.rtt)} ms`);
      if (stats.limit && stats.limit !== 'none') bits.push(stats.limit === 'bandwidth' ? 'เน็ตไม่พอ' : stats.limit === 'cpu' ? 'เครื่องร้อน/ช้า' : stats.limit);
      if (battery) bits.push(`🔋 ${Math.round(battery.level * 100)}%${battery.charging ? '⚡' : ''}`);
      info.textContent = bits.join(' · ');
      info.classList.toggle('warn', !!(stats.limit && stats.limit !== 'none') || !!(battery && battery.level < 0.15 && !battery.charging));
    }
    if (navigator.getBattery) navigator.getBattery().then(b => { battery = b; b.addEventListener('levelchange', paint); b.addEventListener('chargingchange', paint); paint(); }).catch(() => {});

    // คุณภาพการส่ง (WebRTC): บิตเรต เฟรมเรต ดีเลย์ และสาเหตุที่ลดคุณภาพ
    let lastBytes = 0, lastAt = 0;
    async function pollStats() {
      const pc = ctx.getPeerConnection();
      if (!pc) { stats = {}; paint(); return; }
      try {
        const rep = await pc.getStats();
        let next = {};
        rep.forEach(r => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            const now = r.timestamp;
            if (lastAt && now > lastAt) next.kbps = (r.bytesSent - lastBytes) * 8 / (now - lastAt);
            lastBytes = r.bytesSent; lastAt = now;
            next.fps = r.framesPerSecond; next.limit = r.qualityLimitationReason;
          }
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated && r.currentRoundTripTime != null) next.rtt = r.currentRoundTripTime * 1000;
        });
        stats = next;
      } catch (e) {}
      checkNet();
      paint();
      sendStateSoon();
    }
    setInterval(pollStats, 2000);

    /* ---------- สตูดิโอควบคุมจากระยะไกล ---------- */
    function state() {
      const c = caps(), s = sets(), pick = k => range(c[k]) ? { min: c[k].min, max: c[k].max, step: c[k].step || 0 } : null;
      return {
        type: 'cam-state',
        caps: { iso: pick('iso'), exposureTime: pick('exposureTime'), exposureCompensation: pick('exposureCompensation'), colorTemperature: pick('colorTemperature'), focusDistance: pick('focusDistance'), zoom: pick('zoom'),
          torch: has(c, 'torch'), exposureMode: c.exposureMode || [], whiteBalanceMode: c.whiteBalanceMode || [], focusMode: c.focusMode || [], maxFps: range(c.frameRate) ? c.frameRate.max : 30 },
        set: { exposureMode: s.exposureMode, iso: s.iso, exposureTime: s.exposureTime, exposureCompensation: s.exposureCompensation, whiteBalanceMode: s.whiteBalanceMode, colorTemperature: s.colorTemperature,
          focusMode: s.focusMode, focusDistance: s.focusDistance, zoom: s.zoom, torch: !!s.torch, width: s.width, height: s.height, fps: ctx.getFps(), quality: ctx.getQuality(), lens: s.deviceId || '' },
        lenses: lenses.map((l, i) => ({ id: l.id, label: l.label || `เลนส์ ${i + 1}` })), qualities: ctx.qualities(), locked,
        rec: rec.recorder ? { since: rec.since, bytes: rec.bytes } : null,
        battery: battery ? { level: battery.level, charging: battery.charging } : null,
        stats: { kbps: Math.round(stats.kbps || 0), fps: Math.round(stats.fps || 0), rtt: stats.rtt != null ? Math.round(stats.rtt) : null, limit: stats.limit || '' },
        tilt: tilt != null ? +tilt.toFixed(1) : null,
        shots: prefs.shots.map(Boolean), shot: lastShot, ret: !!prefs.ret
      };
    }
    function sendStateSoon() {
      clearTimeout(stateTimer);
      stateTimer = setTimeout(() => ctx.send(state()), 150);
    }
    async function onStudioMsg(msg) {
      if (msg.type === 'cam-set' && msg.set && typeof msg.set === 'object') {
        const allowed = ['exposureMode', 'iso', 'exposureTime', 'exposureCompensation', 'whiteBalanceMode', 'colorTemperature', 'focusMode', 'focusDistance', 'zoom', 'torch'];
        const patch = {};
        for (const k of allowed) if (k in msg.set) patch[k] = msg.set[k];
        // ซูม / ระยะโฟกัสจากแถบเลื่อนของสตูดิโอ: ส่งค่าล่าสุดทีละครั้งแบบเดียวกับวงแหวน ภาพไม่กระตุก
        for (const k of ['zoom', 'focusDistance']) if (typeof patch[k] === 'number' && !(k === 'focusDistance' && patch.focusMode && patch.focusMode !== 'manual')) { drive(k, patch[k]); delete patch[k]; }
        if (Object.keys(patch).length) await apply(patch, true);
        refreshPanel();
      } else if (msg.type === 'cam-cmd') {
        const v = msg.value;
        if (msg.cmd === 'rec') { if (v) recStart(); else recStop(); }
        else if (msg.cmd === 'fps' && FPS_LIST.includes(+v)) { await ctx.setFps(+v); afterTrackChange(); }
        else if (msg.cmd === 'quality' && ctx.qualities().includes(v)) { await ctx.setQuality(v); afterTrackChange(); }
        else if (msg.cmd === 'lens' && lenses.some(l => l.id === v)) { await ctx.setLens(v, lenses.find(l => l.id === v).side); afterTrackChange(); }
        else if (msg.cmd === 'lock') await setLock(!!v);
        else if (msg.cmd === 'shot' && v && typeof v === 'object' && v.slot >= 0 && v.slot < 4) { if (v.save) saveShot(v.slot | 0); else await recallShot(v.slot | 0); }
        else if (msg.cmd === 'poi' && v && typeof v === 'object') focusAt(+v.x, +v.y);
        else if (msg.cmd === 'flip' && ctx.flip) { await ctx.flip(); afterTrackChange(); }
        else if (msg.cmd === 'state') sendStateSoon();
        else if (msg.cmd === 'msg' && typeof v === 'string') ctx.teamMsg(v);
        refreshPanel();
      }
    }

    // ตั้งชื่อเลนส์ให้อ่านง่าย: กล้องหลัง/หน้า + ชนิด (Ultra Wide / Wide / Tele) จากชื่อที่เบราว์เซอร์ให้มา
    // (iPhone ให้ชื่อชัด · Android มักเป็น "camera2 2, facing back" จึงใช้เลขลำดับแทน)
    function nameLenses(list) {
      const count = { user: 0, environment: 0 };
      return list.map(d => {
        const raw = (d.label || '').toLowerCase();
        const side = /front|user|selfie|face ?time|หน้า/.test(raw) ? 'user' : 'environment';
        const kind = /ultra ?wide|ultrawide/.test(raw) ? 'Ultra Wide' : /tele/.test(raw) ? 'Tele' : /triple|dual/.test(raw) ? 'Auto' : /wide/.test(raw) ? 'Wide' : '';
        const n = ++count[side], sideTh = side === 'user' ? 'กล้องหน้า' : 'กล้องหลัง';
        return { id: d.deviceId, side, label: kind ? `${sideTh} · ${kind}` : `${sideTh} ${n}`, short: kind ? (side === 'user' ? 'F · ' : '') + (kind === 'Ultra Wide' ? '0.5×' : kind === 'Tele' ? 'Tele' : kind) : `${sideTh} ${n}` };
      });
    }
    try { navigator.mediaDevices.addEventListener('devicechange', () => loadLenses()); } catch (e) {}
    async function loadLenses() {
      try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        lenses = nameLenses(list);
      } catch (e) { lenses = []; }
      paint();
    }
    function afterTrackChange() { locked = false; layout(); paint(); sendStateSoon(); }

    // เริ่ม
    level.hidden = true;
    if (prefs.level) setLevel(true);
    paintGuides();
    loadLenses();
    startMeter();
    layout();
    paint();
    // ต่อสตูดิโอใหม่: ขอภาพ Program กลับอีกครั้งถ้าเปิดไว้
    const onConnected = () => { sendStateSoon(); if (prefs.ret) ctx.send({ type: 'cam-return', on: true }); };
    return { onStudioMsg, sendState: sendStateSoon, onConnected, showReturn, afterTrackChange, startMeter, state, apply, panelOpen: () => tool, setTouchLock };
  }

  Object.assign(WM, { initProCam });
})(window.WebMix);
