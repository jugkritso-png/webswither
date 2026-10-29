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
  const WB_PRESETS = [['ร่มเงา', 7500, 'shade'], ['ครึ้ม', 6500, 'cloud'], ['แดด', 5600, 'sun'], ['ฟลูออเรสเซนต์', 4000, 'tube'], ['หลอดไส้', 3200, 'bulb']];
  const GUIDES = { none: 'ไม่มี', '2.39': '2.39:1', '1.85': '1.85:1', '4:3': '4:3', '1:1': '1:1', '9:16': '9:16 (TikTok)' };
  // exposureTime ของ MediaStream มีหน่วย 100 ไมโครวินาที
  const shutterLabel = t => t > 0 ? (t >= 10000 ? `${(t / 10000).toFixed(1)}s` : `1/${Math.round(10000 / t)}`) : '—';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const range = r => r && typeof r === 'object' && typeof r.max === 'number' && r.max > r.min ? r : null;

  function initProCam(ctx) {
    const { root, video } = ctx;
    root.classList.add('procam');
    const prefs = Object.assign({ zebra: false, zebraAt: 95, peaking: false, falsecolor: false, hist: true, grid: false, guide: 'none', level: false, meter: true, glide: 1500 }, store.get('procam', {}));
    const savePrefs = () => store.set('procam', prefs);
    let tool = null, lenses = [], battery = null, stats = {}, stateTimer = null;
    const rec = { recorder: null, since: 0, name: '', parts: null, writable: null, handle: null, bytes: 0 };

    // ไอคอนเส้น (stroke = สีตัวอักษร) สำหรับปุ่มของหน้ากล้อง
    const SVG = (d, extra = '') => `<svg class="pc-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
    const IC = {
      frame: SVG('<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/>'),
      af: SVG('<rect x="3" y="6" width="14" height="12" rx="3"/><circle cx="10" cy="12" r="2.6"/><path d="M19.5 15l1.7-6 1.7 6M20 13.2h2.4"/>'),
      torch: SVG('<path d="M8 3h8l-1.5 5h-5zM9.5 8h5v12a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 9.5 20z"/><path d="M12 12v3"/>'),
      lens: SVG('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="10.6" cy="10.6" r="1" fill="currentColor"/>'),
      flip: SVG('<rect x="3" y="6" width="18" height="13" rx="3"/><circle cx="12" cy="12.5" r="3"/><path d="M8 3h8M14 1.5L16 3l-2 1.5"/>'),
      cam: SVG('<rect x="2.5" y="6" width="14" height="12" rx="2.5"/><path d="M16.5 10.5l5-3v9l-5-3z"/>'),
      mic: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
      micOff: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/>'),
      gear: SVG('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1L5.3 5.3"/>'),
      power: SVG('<path d="M12 3v8M7 6.3a7.5 7.5 0 1 0 10 0"/>'),
      lock: SVG('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
      unlock: SVG('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>'),
      phone: SVG('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 5h3"/>'),
      sun: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
      cloud: SVG('<path d="M7 18.5h10.5a4 4 0 0 0 .3-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18.5z"/>'),
      bulb: SVG('<path d="M9 17.5h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
      tube: SVG('<rect x="3" y="9" width="18" height="6" rx="2"/><path d="M6 5.5l1 1.5M12 4.5V6.5M18 5.5l-1 1.5M6 18.5l1-1.5M12 19.5v-2M18 18.5l-1-1.5"/>'),
      shade: SVG('<path d="M3 19.5V11l7-6 7 6v8.5zM14 19.5l7-7M17 19.5l4-4M20 19.5l1-1"/>')
    };
    root.insertAdjacentHTML('beforeend', `
      <div class="pc-stage">
        <canvas class="pc-assist"></canvas>
        <div class="pc-guides"></div>
        <div class="pc-focus" hidden></div>
      </div>
      <div class="pc-top" role="toolbar" aria-label="ค่ากล้อง">
        <button type="button" class="pc-cell" data-pc="zoom"><small>LENS</small><b>1.0×</b></button>
        <button type="button" class="pc-cell" data-pc="fps"><small>FPS</small><b>30</b></button>
        <button type="button" class="pc-cell" data-pc="shutter"><small>SHUTTER</small><b>—</b></button>
        <button type="button" class="pc-cell" data-pc="ev"><small>EV</small><b>0.0</b></button>
        <div class="pc-tc"><span>00:00:00:00</span><i class="pc-rec" hidden>● REC</i></div>
        <button type="button" class="pc-cell" data-pc="iso"><small>ISO</small><b>—</b></button>
        <button type="button" class="pc-cell" data-pc="wb"><small>WB</small><b>—</b></button>
        <button type="button" class="pc-cell" data-pc="focus"><small>FOCUS</small><b>AF</b></button>
        <button type="button" class="pc-cell pc-auto" data-pc="auto" title="ทุกอย่างอัตโนมัติ (แสง / สี / โฟกัส)"><b>AUTO</b></button>
        <button type="button" class="pc-cell pc-lockbtn" data-pc="lock" title="ล็อกแสง / สี / โฟกัส" aria-label="ล็อกแสง / สี / โฟกัส">${IC.unlock}</button>
      </div>
      <div class="pc-panel" hidden></div>
      <div class="pc-cards">
        <div class="pc-card pc-card-hist"><small>HISTOGRAM</small><canvas class="pc-hist" width="128" height="56"></canvas></div>
        <div class="pc-card pc-card-status"><span class="pc-phone">${IC.phone}</span><div class="pc-st"><small class="pc-st-title">WebMix Camera</small><b class="pc-st-state">STANDBY</b><div class="pc-batt"><i></i></div><div class="pc-info"></div></div></div>
        <div class="pc-card pc-card-audio"><small>ไมค์ของเครื่อง</small><div class="pc-meter"><i></i><b></b></div><div class="pc-meter-scale"><span>-60</span><span>-40</span><span>-20</span><span>-12</span><span>-6</span><span>0</span></div></div>
      </div>
      <div class="pc-level" hidden><i></i><span></span></div>
      <div class="pc-ctrl">
        <button type="button" data-pc="assist" title="ตัวช่วยดูภาพ" aria-label="ตัวช่วยดูภาพ">${IC.frame}</button>
        <button type="button" data-pc="af" title="โฟกัสอัตโนมัติกลางภาพ" aria-label="โฟกัสอัตโนมัติกลางภาพ">${IC.af}</button>
        <button type="button" data-pc="torch" title="ไฟฉาย" aria-label="ไฟฉาย">${IC.torch}</button>
        <button type="button" data-pc="rec" class="pc-recbtn" title="บันทึกในเครื่อง" aria-label="บันทึกในเครื่อง"><i></i></button>
        <button type="button" data-pc="lens" class="pc-lensbtn" title="เลนส์" aria-label="เลนส์">${IC.lens}<b>1</b></button>
        <button type="button" data-pc="peak" class="pc-txtbtn" title="Focus peaking — ขอบที่ชัดเป็นสีแดง">PEAK</button>
        <button type="button" data-caller="flip" title="สลับกล้องหน้า/หลัง" aria-label="สลับกล้องหน้า/หลัง">${IC.flip}</button>
      </div>
      <nav class="pc-nav">
        <button type="button" data-pc="cam" class="on">${IC.cam}<span>Camera</span></button>
        <button type="button" data-caller="mic" class="pc-navmic">${IC.mic}<span>Mic</span></button>
        <button type="button" data-pc="settings">${IC.gear}<span>Settings</span></button>
        <button type="button" data-caller="end">${IC.power}<span>Leave</span></button>
      </nav>`);
    const stage = $('.pc-stage', root), assist = $('.pc-assist', root), guides = $('.pc-guides', root), focusBox = $('.pc-focus', root);
    const info = $('.pc-info', root), histC = $('.pc-hist', root), meter = $('.pc-meter', root), level = $('.pc-level', root);
    const recEl = $('.pc-rec', root), topBar = $('.pc-top', root), ctrlBar = $('.pc-ctrl', root), nav = $('.pc-nav', root), panel = $('.pc-panel', root);
    const histCard = $('.pc-card-hist', root), audioCard = $('.pc-card-audio', root), tcEl = $('.pc-tc span', root);

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
      // ภาพอยู่ในกรอบของ <video> (หน้ากล้องโปรเว้นที่ให้แถบควบคุม) — object-fit: contain ภายในกรอบนั้น
      const rr = root.getBoundingClientRect(), vb = video.getBoundingClientRect();
      const W = vb.width || root.clientWidth, H = vb.height || root.clientHeight, vw = video.videoWidth || 16, vh = video.videoHeight || 9;
      const k = Math.min(W / vw, H / vh);
      rect = { w: vw * k, h: vh * k, x: vb.left - rr.left + (W - vw * k) / 2, y: vb.top - rr.top + (H - vh * k) / 2 };
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
      const any = prefs.zebra || prefs.peaking || prefs.falsecolor || prefs.hist;
      assist.hidden = !(prefs.zebra || prefs.peaking || prefs.falsecolor);
      histC.hidden = histCard.hidden = !prefs.hist;
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
      meter.hidden = audioCard.hidden = !prefs.meter;
      if (!prefs.meter || !an) return;
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      an.getFloatTimeDomainData(abuf);
      let pk = 0;
      for (let i = 0; i < abuf.length; i++) pk = Math.max(pk, Math.abs(abuf[i]));
      const db = pk > 0 ? 20 * Math.log10(pk) : -90, now = performance.now();
      if (db > peakDb || now - peakAt > 1500) { peakDb = db; peakAt = now; }
      const pct = v => clamp((v + 60) / 60, 0, 1) * 100;
      $('i', meter).style.width = pct(db) + '%';
      $('i', meter).style.background = db > -3 ? '#ef4444' : db > -12 ? '#f5a524' : '#22c55e';
      $('b', meter).style.left = pct(peakDb) + '%';
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
    // ป้าย ● REC ข้างไทม์โค้ด (ไทม์โค้ดเป็นเวลาที่บันทึกอยู่แล้ว)
    setInterval(() => { recEl.hidden = !rec.recorder; }, 500);

    /* ---------- แผงปรับค่า: ไม้บรรทัดสเกล (ลากให้สเกลเลื่อนตามนิ้ว) + ปุ่มค่าสำเร็จรูปด้านข้าง ----------
       จอแนวนอน: แผงตั้งชิดขวาของภาพ ไม้บรรทัดแนวตั้ง (ค่ามากอยู่บน) · จอแนวตั้ง: แผงอยู่ล่าง ไม้บรรทัดแนวนอน (ค่ามากอยู่ขวา) */
    const seg = (name, items, cur, cls = '') => `<div class="pc-seg ${cls}" data-seg="${name}">${items.map(([v, l, t]) => `<button type="button" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}"${t ? ` title="${t}" aria-label="${t}"` : ''}>${l}</button>`).join('')}</div>`;
    const unsupported = what => `<p class="pc-note">กล้องหรือเบราว์เซอร์นี้ไม่ให้ปรับ${what} — Android + Chrome รองรับมากที่สุด (iPhone ยังปรับเองได้น้อย)</p>`;
    const RULER = {
      zoom: { name: 'ซูม', log: true, fmt: v => (+v).toFixed(1) + '×', marks: [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50], lab: v => v + '×' },
      focusDistance: { name: 'ระยะโฟกัส', log: true, fmt: v => (+v).toFixed(2) + ' m', marks: [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 7, 10, 20], lab: v => v + ' m' },
      iso: { name: 'ISO', log: true, fmt: v => String(Math.round(v)), marks: [25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800], lab: v => String(v) },
      // exposureTime หน่วย 100 µs — ชัตเตอร์เร็ว (ตัวเลขน้อย) อยู่บน
      exposureTime: { name: 'ชัตเตอร์', log: true, invert: true, fmt: shutterLabel, marks: [1, 2, 5, 10, 20, 40, 83, 100, 167, 200, 333, 667, 1000, 2000, 5000, 10000], lab: shutterLabel },
      colorTemperature: { name: 'อุณหภูมิสี', fmt: v => Math.round(v) + 'K', every: 500, lab: v => v + 'K' },
      exposureCompensation: { name: 'EV', fmt: v => (v > 0 ? '+' : '') + (+v).toFixed(1), every: 0.5, lab: v => (v > 0 ? '+' : '') + v }
    };
    const fmtVal = Object.fromEntries(Object.entries(RULER).map(([k, R]) => [k, R.fmt]));
    const toU = (k, v, r) => { const R = RULER[k]; const u = R.log && r.min > 0 ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min); return R.invert ? 1 - u : u; };
    const fromU = (k, u, r) => { const R = RULER[k]; u = clamp(u, 0, 1); if (R.invert) u = 1 - u; return R.log && r.min > 0 ? r.min * Math.pow(r.max / r.min, u) : r.min + u * (r.max - r.min); };
    const near = (a, b) => a != null && Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.02);
    const ruler = key => `<div class="pc-ruler" data-ruler="${key}" role="slider" tabindex="0" aria-label="${RULER[key].name}"><canvas></canvas><b class="pc-ruler-val" data-val="${key}"></b></div>`;
    const body = (main, side, note) => `<div class="pc-body"><div class="pc-main">${main}</div><div class="pc-side">${side}</div></div>${note ? `<p class="pc-note">${note}</p>` : ''}`;
    const TITLES = { zoom: 'LENS · ZOOM', fps: 'SETTINGS', shutter: 'SHUTTER', ev: 'EV', iso: 'ISO', wb: 'WHITE BALANCE', focus: 'FOCUS', assist: 'ASSIST', lens: 'LENS' };
    function panelHtml(t) {
      const c = caps(), s = sets(), autoExp = s.exposureMode !== 'manual';
      const canAuto = k => Array.isArray(c[k]) && c[k].includes('continuous');
      const pick = (list, val) => (list.find(([v]) => near(val, +v)) || [''])[0];
      if (t === 'shutter') {
        const r = range(c.exposureTime);
        if (!r) return unsupported('ชัตเตอร์');
        const q = [[20, '1/500'], [40, '1/250'], [83, '1/120'], [100, '1/100'], [167, '1/60'], [200, '1/50']].filter(([v]) => v >= r.min && v <= r.max);
        return body(ruler('exposureTime'), (canAuto('exposureMode') ? seg('exposureMode', [['continuous', 'AUTO']], autoExp ? 'continuous' : '', 'pc-col') : '') + seg('shutterQuick', q, autoExp ? '' : pick(q, s.exposureTime), 'pc-col'),
          'ไฟบ้าน 50 Hz: 1/50 หรือ 1/100 ภาพไม่กะพริบ');
      }
      if (t === 'iso') {
        const r = range(c.iso);
        if (!r) return unsupported('ISO');
        const q = [100, 200, 400, 800, 1600, 3200].filter(v => v >= r.min && v <= r.max).map(v => [v, v]);
        return body(ruler('iso'), (canAuto('exposureMode') ? seg('exposureMode', [['continuous', 'AUTO']], autoExp ? 'continuous' : '', 'pc-col') : '') + seg('isoQuick', q, autoExp ? '' : pick(q, s.iso), 'pc-col'));
      }
      if (t === 'ev') {
        const r = range(c.exposureCompensation);
        if (!r) return unsupported('EV');
        const q = [1, 0.5, 0, -0.5, -1].filter(v => v >= r.min && v <= r.max).map(v => [v, (v > 0 ? '+' : '') + v]);
        return body(ruler('exposureCompensation'), seg('evQuick', q, pick(q, s.exposureCompensation ?? 0), 'pc-col'), autoExp ? '' : 'EV ใช้ได้ตอนแสง AUTO — ตอนนี้ตั้ง ISO / ชัตเตอร์เองอยู่');
      }
      if (t === 'wb') {
        const r = range(c.colorTemperature), manual = s.whiteBalanceMode === 'manual';
        if (!r && !canAuto('whiteBalanceMode')) return unsupported('สมดุลแสงขาว');
        const q = WB_PRESETS.filter(([, k]) => !r || (k >= r.min && k <= r.max)).map(([l, k, ic]) => [k, `${IC[ic]}<small>${k}K</small>`, `${l} ${k}K`]);
        return body(r ? ruler('colorTemperature') : '', seg('whiteBalanceMode', [['continuous', 'AUTO']], manual ? '' : 'continuous', 'pc-col') + (r ? seg('wbPreset', q, manual ? pick(q, s.colorTemperature) : '', 'pc-col pc-icons') : ''));
      }
      if (t === 'focus') {
        const r = range(c.focusDistance), manual = s.focusMode === 'manual';
        if (!r && !(Array.isArray(c.focusMode) && c.focusMode.length)) return unsupported('โฟกัส') + '<p class="pc-note">ยังแตะที่ภาพเพื่อโฟกัสได้ถ้ากล้องรองรับ</p>';
        const q = r ? [[r.max, '∞'], [Math.min(r.max, 3), '3 m'], [Math.min(r.max, 1), '1 m'], [r.min, 'ใกล้สุด']].filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i) : [];
        return body(r ? ruler('focusDistance') : '', seg('focusMode', [['continuous', 'AF']], manual ? '' : 'continuous', 'pc-col') + seg('focusQuick', q, manual ? pick(q, s.focusDistance) : '', 'pc-col'),
          'ลากสเกลเพื่อดึงโฟกัสแบบนุ่ม (ตอน AF จะเปลี่ยนเป็น MF ให้เอง) · แตะที่ภาพเพื่อโฟกัสตรงจุดนั้น · เปิด PEAK จะเห็นขอบที่ชัดเป็นสีแดง');
      }
      if (t === 'zoom') {
        const r = range(c.zoom);
        if (!r) return unsupported('ซูม');
        const q = [10, 5, 3, 2, 1].filter(v => v >= r.min && v <= r.max).map(v => [v, v + '×']);
        return body(ruler('zoom'), seg('zoomQuick', q, pick(q, s.zoom), 'pc-col'), 'ลากสเกลหรือจีบนิ้วบนภาพเพื่อซูมแบบนุ่ม · ปุ่มด้านข้างค่อย ๆ ซูมไปตามความเร็วที่ตั้งไว้ (Settings)');
      }
      if (t === 'lens') {
        if (lenses.length < 2) return '<p class="pc-note">ไม่พบเลนส์อื่นในเครื่องนี้ (หรือเบราว์เซอร์ไม่ให้เลือก)</p>';
        return seg('lens', lenses.map((l, i) => [l.id, l.label || `เลนส์ ${i + 1}`]), s.deviceId || '', 'pc-col');
      }
      if (t === 'fps') {
        const fr = range(c.frameRate), max = fr ? fr.max : 60;
        return `<div class="pc-label">เฟรมเรต</div>${seg('fps', FPS_LIST.filter(f => f <= max + 0.5).map(f => [f, f]), ctx.getFps())}
          <div class="pc-label">ความละเอียดที่ส่งเข้าสตูดิโอ</div>${seg('quality', ctx.qualities().map(q => [q, q]), ctx.getQuality())}
          <div class="pc-label">ความเร็วซูม / ดึงโฟกัสเมื่อกดปุ่ม</div>${seg('glide', [[0, 'ทันที'], [600, 'เร็ว'], [1500, 'ปานกลาง'], [3000, 'ช้า']], prefs.glide)}
          <p class="pc-note">ตอนนี้ ${s.width || '?'}×${s.height || '?'} @ ${Math.round(s.frameRate || 0)} fps · ใช้ 25 / 50 fps ให้ตรงไฟบ้าน 50 Hz</p>`;
      }
      if (t === 'assist') {
        const tog = (k, l) => `<button type="button" data-tog="${k}" class="${prefs[k] ? 'on' : ''}">${l}</button>`;
        return `<div class="pc-toggles">${tog('zebra', 'Zebra')}${tog('peaking', 'Focus peaking')}${tog('falsecolor', 'False color')}${tog('hist', 'Histogram')}${tog('grid', 'ตาราง 3×3')}${tog('level', 'ระดับน้ำ')}${tog('meter', 'มิเตอร์เสียง')}</div>
          ${prefs.zebra ? `<label class="pc-slider"><span>Zebra เริ่มที่ <b data-val="zebraAt">${prefs.zebraAt}%</b></span><input type="range" data-pref="zebraAt" min="70" max="100" step="1" value="${prefs.zebraAt}"></label>` : ''}
          <div class="pc-label">กรอบสัดส่วน</div>${seg('guide', Object.entries(GUIDES), prefs.guide)}`;
      }
      return '';
    }
    const RULER_TOOLS = ['zoom', 'shutter', 'iso', 'ev', 'wb', 'focus'];
    const fillPanel = () => {
      panel.innerHTML = `<div class="pc-panel-head"><b>${TITLES[tool] || ''}</b><button type="button" class="pc-close" aria-label="ปิด">✕</button></div>${panelHtml(tool)}`;
      panel.classList.toggle('is-ruler', RULER_TOOLS.includes(tool) && !!$('.pc-ruler', panel));
      paintRulers();
    };
    function openPanel(t) {
      if (tool === t) { closePanel(); return; }
      tool = t;
      panel.hidden = false;
      fillPanel();
      paint();
    }
    function closePanel() { tool = null; panel.hidden = true; paint(); }
    // วาดแผงใหม่ (เช่นเปลี่ยน AUTO → ตั้งเอง) — ยกเว้นตอนกำลังลากสเกล / แถบเลื่อนอยู่
    const refreshPanel = () => { const a = document.activeElement; if (tool && !ringBusy() && !(a && a.type === 'range' && panel.contains(a))) fillPanel(); };

    const onBarClick = e => {
      const b = e.target.closest('[data-pc]');
      if (!b) return;
      const t = b.dataset.pc;
      if (t === 'rec') { rec.recorder ? recStop() : recStart(); return; }
      if (t === 'torch') { apply({ torch: !sets().torch }); return; }
      if (t === 'lock') { setLock(!locked); return; }
      if (t === 'auto') { setAuto(); return; }
      if (t === 'af') { focusAt(0.5, 0.5); return; }
      if (t === 'peak') { prefs.peaking = !prefs.peaking; savePrefs(); paint(); ctx.brief(prefs.peaking ? 'Focus peaking เปิด — ขอบที่ชัดเป็นสีแดง' : 'Focus peaking ปิด'); return; }
      if (t === 'cam') { closePanel(); return; }
      if (t === 'settings') { openPanel('fps'); return; }
      if (t === 'lens' && lenses.length === 2) { const s = sets(), next = lenses.find(l => l.id !== s.deviceId) || lenses[0]; ctx.setLens(next.id).then(afterTrackChange); return; }
      openPanel(t);
    };
    for (const bar of [topBar, ctrlBar, nav]) bar.addEventListener('click', onBarClick);
    async function setAuto() {
      const c = caps(), patch = {};
      for (const k of ['exposureMode', 'whiteBalanceMode', 'focusMode']) if (Array.isArray(c[k]) && c[k].includes('continuous')) patch[k] = 'continuous';
      locked = false;
      await apply(patch, true);
      refreshPanel();
      ctx.brief('แสง / สี / โฟกัส อัตโนมัติ');
    }
    panel.addEventListener('click', async e => {
      if (e.target.closest('.pc-close')) { closePanel(); return; }
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
      const name = b.closest('.pc-seg').dataset.seg, v = b.dataset.v, s = sets();
      if (name === 'exposureMode' || name === 'whiteBalanceMode' || name === 'focusMode') {
        const patch = { [name]: v };
        // เข้าโหมดปรับเองโดยเริ่มจากค่าที่กล้องใช้อยู่ ภาพจะไม่กระโดด
        if (v === 'manual' && name === 'exposureMode') Object.assign(patch, { iso: s.iso, exposureTime: s.exposureTime });
        if (v === 'manual' && name === 'whiteBalanceMode' && s.colorTemperature) patch.colorTemperature = s.colorTemperature;
        if (v === 'manual' && name === 'focusMode' && s.focusDistance != null) patch.focusDistance = s.focusDistance;
        for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
        await apply(patch);
      } else if (name === 'shutterQuick') await apply({ exposureTime: +v, ...(s.iso ? { iso: s.iso } : {}) });
      else if (name === 'isoQuick') await apply({ iso: +v, ...(s.exposureTime ? { exposureTime: s.exposureTime } : {}) });
      else if (name === 'evQuick') { glide('exposureCompensation', +v); return; }
      else if (name === 'wbPreset') { glide('colorTemperature', +v); return; }
      else if (name === 'zoomQuick') { glide('zoom', +v); return; }
      else if (name === 'focusQuick') { glide('focusDistance', +v); return; }
      else if (name === 'glide') { prefs.glide = +v; savePrefs(); }
      else if (name === 'lens') { await ctx.setLens(v); afterTrackChange(); }
      else if (name === 'fps') { await ctx.setFps(+v); afterTrackChange(); }
      else if (name === 'quality') { await ctx.setQuality(v); afterTrackChange(); }
      else if (name === 'guide') { prefs.guide = v; savePrefs(); paintGuides(); }
      refreshPanel();
    });
    panel.addEventListener('input', e => {
      const pk = e.target.dataset.pref;
      if (pk) { prefs[pk] = +e.target.value; savePrefs(); const l = $(`[data-val="${pk}"]`, panel); if (l) l.textContent = prefs[pk] + '%'; }
    });
    panel.addEventListener('change', e => { if (e.target.dataset.pref) e.target.blur(); });

    /* ---------- ส่งค่าให้กล้องแบบนุ่ม ----------
       ส่งทีละครั้ง (รอครั้งก่อนเสร็จ แล้วส่งค่าล่าสุด) — ลากเร็วแค่ไหนกล้องก็ไม่ค้างคิว
       glide = ค่อย ๆ เปลี่ยนไปยังค่าเป้าหมาย (ease in-out) เหมือนซูมไฟฟ้า / ดึงโฟกัสของกล้องวิดีโอ */
    const MODE_OF = { iso: 'exposureMode', exposureTime: 'exposureMode', colorTemperature: 'whiteBalanceMode', focusDistance: 'focusMode' };
    const drv = {};
    const cur = k => { const d = drv[k]; return d && d.target != null ? d.target : sets()[k]; };
    function drive(k, v) {
      const r = range(caps()[k]);
      if (!r) return;
      v = clamp(v, r.min, r.max);
      const d = drv[k] || (drv[k] = { busy: false, target: null });
      d.target = v;
      paintRuler(k, v);
      if (d.busy) return;
      const send = async () => {
        const t = track();
        if (!t) return;
        d.busy = true;
        const val = d.target, adv = { [k]: val }, mk = MODE_OF[k], s = sets(), c = caps();
        // ลากสเกลตอนอัตโนมัติ = เปลี่ยนเป็นตั้งเอง โดยคงค่าคู่กัน (ISO ↔ ชัตเตอร์) ไว้ ภาพไม่กระโดด
        if (mk && s[mk] !== 'manual' && Array.isArray(c[mk]) && c[mk].includes('manual')) {
          adv[mk] = 'manual';
          if (k === 'iso' && s.exposureTime) adv.exposureTime = s.exposureTime;
          if (k === 'exposureTime' && s.iso) adv.iso = s.iso;
        }
        try { await t.applyConstraints({ advanced: [adv] }); } catch (e) {}
        d.busy = false;
        if (d.target !== val) send();
        else { d.target = null; paint(); sendStateSoon(); }
      };
      send();
    }
    function glide(k, to) {
      const r = range(caps()[k]);
      if (!r) return;
      const d = drv[k] || (drv[k] = { busy: false, target: null });
      cancelAnimationFrame(d.anim);
      const from = +(cur(k) ?? to), ms = prefs.glide || 0;
      if (!ms || Math.abs(to - from) < 1e-6) { drive(k, to); setTimeout(refreshPanel, 250); return; }
      const ua = toU(k, from, r), ub = toU(k, to, r), t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        drive(k, p >= 1 ? to : fromU(k, ua + (ub - ua) * e, r));
        if (p < 1) d.anim = requestAnimationFrame(step); else { d.anim = 0; setTimeout(refreshPanel, 250); }
      };
      d.anim = requestAnimationFrame(step);
    }
    // ไม้บรรทัด: วาดสเกลบน canvas ตามค่าปัจจุบัน (เส้นฟ้ากลาง = ค่าที่ใช้อยู่)
    const rulerSpan = el => { const vert = el.clientHeight > el.clientWidth; return { vert, ppu: (vert ? el.clientHeight : el.clientWidth) * 2.2 || 600 }; };
    function paintRuler(k, v) {
      const el = $(`.pc-ruler[data-ruler="${k}"]`, panel), r = range(caps()[k]), R = RULER[k];
      if (!el || !r || !R || v == null) return;
      $('.pc-ruler-val', el).textContent = R.fmt(v);
      el.setAttribute('aria-valuenow', String(+(+v).toFixed(3)));
      const cv = $('canvas', el), W = el.clientWidth, H = el.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d'), { vert, ppu } = rulerSpan(el), L = vert ? H : W, mid = L / 2, cross = vert ? W : H, u0 = clamp(toU(k, v, r), 0, 1);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const at = u => vert ? mid - (u - u0) * ppu : mid + (u - u0) * ppu;
      const tick = (p, len, color, w = 1) => {
        g.strokeStyle = color; g.lineWidth = w; g.beginPath();
        if (vert) { g.moveTo(W - 8 - len, p); g.lineTo(W - 8, p); } else { g.moveTo(p, H - 6 - len); g.lineTo(p, H - 6); }
        g.stroke();
      };
      for (let i = 0; i <= 100; i++) { const p = at(i / 100); if (p >= -2 && p <= L + 2) tick(p, i % 5 ? Math.min(14, cross * 0.12) : Math.min(22, cross * 0.2), 'rgba(255,255,255,.42)'); }
      const marks = R.marks ? R.marks.filter(m => m >= r.min - 1e-9 && m <= r.max + 1e-9) : (() => { const out = []; for (let m = Math.ceil(r.min / R.every) * R.every; m <= r.max + 1e-9; m += R.every) out.push(+m.toFixed(3)); return out; })();
      g.font = `500 ${vert ? 12 : 11}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      g.fillStyle = 'rgba(255,255,255,.72)';
      let last = -1e9;
      for (const m of marks) {
        const p = at(toU(k, m, r));
        if (p < -30 || p > L + 30 || Math.abs(p - last) < (vert ? 26 : 52)) continue;
        last = p;
        tick(p, Math.min(30, cross * 0.3), 'rgba(255,255,255,.9)', 1.5);
        if (vert) { g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(R.lab(m), W - 14 - Math.min(30, cross * 0.3), p); }
        else { g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(R.lab(m), p, 3); }
      }
      g.strokeStyle = '#4f9dff'; g.lineWidth = 2; g.beginPath();
      if (vert) { g.moveTo(W * 0.42, mid); g.lineTo(W - 2, mid); } else { g.moveTo(mid, H * 0.45); g.lineTo(mid, H); }
      g.stroke();
    }
    const paintRulers = () => panel.querySelectorAll('.pc-ruler').forEach(el => { const k = el.dataset.ruler, v = cur(k); if (v != null) paintRuler(k, +v); });
    addEventListener('resize', () => setTimeout(paintRulers, 60));
    let ringDrag = null;
    const ringBusy = () => !!ringDrag || Object.values(drv).some(d => d.busy || d.coast || d.anim);
    panel.addEventListener('pointerdown', e => {
      const el = e.target.closest('.pc-ruler');
      if (!el) return;
      const k = el.dataset.ruler, r = range(caps()[k]);
      if (!r) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      const d = drv[k] || (drv[k] = { busy: false, target: null });
      cancelAnimationFrame(d.anim); cancelAnimationFrame(d.coast); d.anim = 0; d.coast = 0;
      ringDrag = { k, r, el, pid: e.pointerId, u: toU(k, +cur(k), r), x: e.clientX, y: e.clientY, t: performance.now(), vel: 0, ...rulerSpan(el) };
      el.classList.add('turning');
    });
    panel.addEventListener('pointermove', e => {
      const g = ringDrag;
      if (!g || e.pointerId !== g.pid) return;
      const now = performance.now();
      // สเกลเลื่อนตามนิ้ว: แนวตั้ง ลากลง = ค่ามากขึ้นเลื่อนเข้ามา · แนวนอน ลากซ้าย = ค่ามากขึ้น
      const du = g.vert ? (e.clientY - g.y) / g.ppu : -(e.clientX - g.x) / g.ppu;
      g.u = clamp(g.u + du, 0, 1);
      g.vel = 0.7 * g.vel + 0.3 * (du / Math.max(1, now - g.t));
      g.x = e.clientX; g.y = e.clientY; g.t = now;
      drive(g.k, fromU(g.k, g.u, g.r));
    });
    const ringUp = e => {
      const g = ringDrag;
      if (!g || e.pointerId !== g.pid) return;
      ringDrag = null;
      g.el.classList.remove('turning');
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
    // ล้อเมาส์ / ปุ่มลูกศร (ละเอียดทีละ 1% · Shift = 5%)
    panel.addEventListener('wheel', e => {
      const el = e.target.closest('.pc-ruler');
      if (!el) return;
      e.preventDefault();
      const k = el.dataset.ruler, r = range(caps()[k]);
      if (r) drive(k, fromU(k, toU(k, +cur(k), r) - (e.deltaY || -e.deltaX) / 2000, r));
    }, { passive: false });
    panel.addEventListener('keydown', e => {
      const el = e.target.closest('.pc-ruler');
      if (!el || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      e.preventDefault();
      const k = el.dataset.ruler, r = range(caps()[k]), dir = /Right|Up/.test(e.key) ? 1 : -1;
      if (r) drive(k, fromU(k, toU(k, +cur(k), r) + dir * (e.shiftKey ? 0.05 : 0.01), r));
    });
    // จีบนิ้วบนภาพ = ซูมแบบนุ่ม
    const touches = new Map();
    let pinch = null, pinchEndAt = 0;
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
    root.addEventListener('pointerup', endTouch);
    root.addEventListener('pointercancel', endTouch);

    /* ---------- แถบค่าด้านบน / ปุ่ม / การ์ดสถานะ ---------- */
    const p2 = n => String(n).padStart(2, '0');
    setInterval(() => {
      // ไทม์โค้ด: ตอนบันทึก = เวลาที่บันทึก (สีแดง) · ไม่บันทึก = เวลาของวัน
      const f = ctx.getFps() || 30;
      let ms, recOn = !!rec.recorder;
      if (recOn) ms = Date.now() - rec.since; else { const d = new Date(); ms = ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds(); }
      const s = Math.floor(ms / 1000);
      tcEl.textContent = `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}:${p2(Math.floor((ms % 1000) / 1000 * f))}`;
      tcEl.parentElement.classList.toggle('is-rec', recOn);
    }, 40);
    function paint() {
      const c = caps(), s = sets(), manualExp = s.exposureMode === 'manual';
      const set = (t, v, on) => root.querySelectorAll(`[data-pc="${t}"]`).forEach(b => { const bb = $('b', b); if (bb && v != null) bb.textContent = v; b.classList.toggle('on', !!on); b.classList.toggle('active', tool === t || (t === 'settings' && tool === 'fps')); });
      const show = (t, ok) => root.querySelectorAll(`[data-pc="${t}"]`).forEach(b => { b.hidden = !ok; });
      set('zoom', s.zoom ? (+s.zoom).toFixed(1) + '×' : '1.0×', s.zoom > 1.01);
      set('fps', String(ctx.getFps()));
      set('shutter', s.exposureTime ? shutterLabel(s.exposureTime) : 'AUTO', manualExp);
      set('iso', s.iso ? String(Math.round(s.iso)) : 'AUTO', manualExp);
      set('ev', has(c, 'exposureCompensation') ? fmtVal.exposureCompensation(+(s.exposureCompensation || 0)) : '—', !!s.exposureCompensation);
      set('wb', s.colorTemperature ? Math.round(s.colorTemperature) + 'K' : 'AUTO', s.whiteBalanceMode === 'manual');
      set('focus', s.focusMode === 'manual' ? (s.focusDistance != null ? fmtVal.focusDistance(s.focusDistance) : 'MF') : 'AF', s.focusMode === 'manual');
      // ค่าที่กล้องเลือกเอง (อัตโนมัติ) มีตัว A เล็ก ๆ กำกับ
      for (const [t, auto] of [['shutter', !manualExp], ['iso', !manualExp], ['wb', s.whiteBalanceMode !== 'manual'], ['focus', s.focusMode !== 'manual']]) root.querySelectorAll(`.pc-top [data-pc="${t}"]`).forEach(b => b.classList.toggle('is-auto', auto));
      show('shutter', has(c, 'exposureTime') || has(c, 'exposureMode')); show('iso', has(c, 'iso') || has(c, 'exposureMode')); show('ev', has(c, 'exposureCompensation'));
      const allAuto = !locked && !manualExp && s.whiteBalanceMode !== 'manual' && s.focusMode !== 'manual';
      set('auto', 'AUTO', allAuto);
      set('lock', null, locked);
      const lb = $('.pc-lockbtn', root);
      if (lb && lb.dataset.state !== String(locked)) { lb.dataset.state = String(locked); lb.innerHTML = locked ? IC.lock : IC.unlock; }
      const li = lenses.findIndex(l => l.id === s.deviceId);
      set('lens', li >= 0 ? String(li + 1) : '1', lenses.length > 1);
      set('assist', null, prefs.zebra || prefs.falsecolor || prefs.grid || prefs.guide !== 'none' || prefs.level);
      set('peak', null, prefs.peaking);
      set('torch', null, s.torch);
      show('torch', has(c, 'torch'));
      set('rec', null, !!rec.recorder);
      set('cam', null, !tool);
      set('settings', null, false);
      // สถานะ: ชื่อในสตูดิโอ · ON AIR / PREVIEW / STANDBY · การเชื่อมต่อ · คุณภาพการส่ง · แบตเตอรี่
      const tally = $('#cam-tally'), status = $('#caller-status'), title = $('.caller-title');
      $('.pc-st-title', root).textContent = title ? title.textContent : '';
      const st = $('.pc-st-state', root);
      st.textContent = `${tally ? tally.textContent : ''}${status ? ' · ' + status.textContent : ''}`;
      st.className = 'pc-st-state' + (tally && tally.classList.contains('is-pgm') ? ' is-pgm' : tally && tally.classList.contains('is-pvw') ? ' is-pvw' : '');
      const bits = [`${s.width || '?'}×${s.height || '?'}`, `${Math.round(stats.fps || s.frameRate || 0)} fps`];
      if (stats.kbps) bits.push(`${(stats.kbps / 1000).toFixed(1)} Mb/s`);
      if (stats.rtt != null) bits.push(`ดีเลย์ ${Math.round(stats.rtt)} ms`);
      if (stats.limit && stats.limit !== 'none') bits.push(stats.limit === 'bandwidth' ? 'เน็ตไม่พอ' : stats.limit === 'cpu' ? 'เครื่องร้อน/ช้า' : stats.limit);
      if (battery) bits.push(`🔋 ${Math.round(battery.level * 100)}%${battery.charging ? '⚡' : ''}`);
      info.textContent = bits.join(' · ');
      info.classList.toggle('warn', !!(stats.limit && stats.limit !== 'none') || !!(battery && battery.level < 0.15 && !battery.charging));
      const bi = $('.pc-batt i', root);
      $('.pc-batt', root).hidden = !battery;
      if (battery) { bi.style.width = Math.round(battery.level * 100) + '%'; bi.classList.toggle('low', battery.level < 0.15 && !battery.charging); }
      const mic = $('#caller-mic'), nm = $('.pc-navmic', root), off = !!(mic && mic.classList.contains('is-off'));
      if (nm && nm.dataset.off !== String(off)) { nm.dataset.off = String(off); nm.classList.toggle('is-off', off); nm.innerHTML = `${off ? IC.micOff : IC.mic}<span>Mic</span>`; }
    }
    // สถานะการเชื่อมต่อ / tally / ไมค์ เปลี่ยนจาก caller.js → อัปเดตการ์ดทันที
    try { const mo = new MutationObserver(() => paint()); for (const el of [$('#caller-status'), $('#cam-tally'), $('.caller-title'), $('#caller-mic')]) if (el) mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] }); } catch (e) {}
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
        tilt: tilt != null ? +tilt.toFixed(1) : null
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
        else if (msg.cmd === 'lens' && lenses.some(l => l.id === v)) { await ctx.setLens(v); afterTrackChange(); }
        else if (msg.cmd === 'lock') await setLock(!!v);
        else if (msg.cmd === 'poi' && v && typeof v === 'object') focusAt(+v.x, +v.y);
        else if (msg.cmd === 'flip' && ctx.flip) { await ctx.flip(); afterTrackChange(); }
        else if (msg.cmd === 'state') sendStateSoon();
        else if (msg.cmd === 'msg' && typeof v === 'string') ctx.teamMsg(v);
        refreshPanel();
      }
    }

    async function loadLenses() {
      try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        lenses = list.map(d => ({ id: d.deviceId, label: (d.label || '').replace(/\s*\(.*\)\s*$/, '').slice(0, 40) }));
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
    return { onStudioMsg, sendState: sendStateSoon, afterTrackChange, startMeter, state, apply, panelOpen: () => tool };
  }

  Object.assign(WM, { initProCam });
})(window.WebMix);
