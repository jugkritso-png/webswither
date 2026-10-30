/* WebMix — หน้ากล้องมือถือ (?call=) และหน้าแขกรับเชิญ (?call=&guest=) */
(function (WM) {
  'use strict';
  const { $, $$, uid, store, icon, keepScreenOn, peerOptionsFromSig, unb64url } = WM;

  function initCaller(targetId) {
    $('#studio').hidden = true;
    const root = $('#caller');
    root.hidden = false;
    // แขกรับเชิญทางไกล (?guest=<slot>): ส่งกล้อง+ไมค์ และรับภาพรายการพร้อมเสียง (ไม่มีเสียงตัวเองย้อนกลับ)
    const params = new URLSearchParams(location.search);
    const guestSlot = (params.get('guest') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
    let guestName = (params.get('n') || '').slice(0, 40);
    const showName = (params.get('s') || '').slice(0, 60);
    // แขก: อุปกรณ์ที่เลือกในหน้าเข้าร่วม + ภาพตัวอย่าง (ใช้ต่อเป็นภาพที่ส่ง ไม่เปิดกล้องซ้ำ)
    let preStream = null, micId = '';
    document.title = guestSlot ? 'WebMix — แขกรับเชิญ' : 'WebMix Camera';
    const returnVideo = $('#guest-return');

    const video = $('#caller-video');
    const statusEl = $('#caller-status');
    const msgEl = $('#caller-msg');
    let facing = guestSlot ? 'user' : 'environment', stream = null, peer = null, call = null, conn = null;
    let retryTimer = null, stopped = false, micOn = true, camOn = true;

    const setStatus = (text, kind = '') => { statusEl.textContent = text; statusEl.className = `chip ${kind}`; };
    const showMsg = text => { msgEl.textContent = text; msgEl.hidden = !text; };
    let lastTally = 'off';
    const setTally = t => {
      // ขึ้น ON AIR = สั่นเตือนช่างกล้อง (กล้องจริงมีไฟแดงที่ช่องมอง)
      if (t === 'pgm' && lastTally !== 'pgm' && !guestSlot) { try { navigator.vibrate && navigator.vibrate([90, 60, 90]); } catch (e) {} }
      lastTally = t;
      root.classList.toggle('tally-pgm', t === 'pgm');
      root.classList.toggle('tally-pvw', t === 'pvw');
      $('#caller-tally').textContent = t === 'pgm' ? 'ON AIR' : 'PREVIEW';
      const ct = $('#cam-tally');
      if (ct) { ct.textContent = t === 'pgm' ? 'ON AIR' : t === 'pvw' ? 'PREVIEW' : 'STANDBY'; ct.className = 'cam-tally' + (t === 'pgm' ? ' is-pgm' : t === 'pvw' ? ' is-pvw' : ''); }
      const gs = $('#gt-state');
      if (gs) { gs.textContent = t === 'pgm' ? 'ออกอากาศอยู่' : t === 'pvw' ? 'ทีมงานกำลังดูภาพคุณ' : 'รอทีมงาน'; gs.className = 'gt-state' + (t === 'pgm' ? ' is-pgm' : t === 'pvw' ? ' is-pvw' : ''); }
    };

    // คุณภาพที่ส่งเข้าสตูดิโอ — กดปุ่ม HD/FHD/4K บนจอเพื่อสลับ (กล้องที่ไม่รองรับจะได้ค่าสูงสุดที่ทำได้)
    const QUALITIES = [
      { label: 'HD', w: 1280, h: 720, bitrate: 2500000 },
      { label: 'FHD', w: 1920, h: 1080, bitrate: 6000000 },
      { label: '4K', w: 3840, h: 2160, bitrate: 16000000 }
    ];
    // แขกรับเชิญใช้ HD (คุยผ่านเน็ตบ้าน/มือถือได้ลื่น) — กล้องมือถือของทีมงานเลือกได้ถึง 4K
    let quality = guestSlot ? QUALITIES[0] : QUALITIES[Math.min(2, Math.max(0, +store.get('caller-quality', 1)))] || QUALITIES[1];
    // กล้องมือถือของทีมงาน: เลือกเลนส์ (deviceId) และเฟรมเรตได้จากแผงกล้องโปร
    let lensId = null, fps = guestSlot ? 30 : [24, 25, 30, 50, 60].includes(+store.get('caller-fps', 30)) ? +store.get('caller-fps', 30) : 30;
    // ซูมนุ่ม (ดิจิทัล): เลนส์มือถือที่สั่งผ่านเบราว์เซอร์ซูมได้ทีละขั้น (มัก 0.1× ≈ กระโดด 10%) และหน่วง ภาพจึงกระตุก
    // จึงเปิดกล้องละเอียดกว่าที่ส่งเล็กน้อย แล้วครอปขยายเองทุกเฟรม — ภาพที่ส่ง/บันทึก/แสดงคือภาพที่ครอปแล้ว
    // ทำในเธรดแยก (Worker + MediaStreamTrackProcessor/Generator) ไม่แย่งเวลากับหน้าจอ · เบราว์เซอร์ที่ไม่มี ใช้ canvas บนเธรดหลักแทน
    // ปิดได้ในหน้า FPS (กลับไปใช้ซูมของเลนส์) · แขกรับเชิญไม่ใช้
    const smooth = { on: !guestSlot && store.get('caller-smoothzoom', true) !== false, z: 1, max: 8, vel: 0, out: null, outStream: null, size: null, mode: '' };
    // เผื่อความละเอียดไว้ซูม ~1.3× โดยภาพไม่เสีย แต่ไม่เปิด 4K (มือถือหลายรุ่นได้เฟรมเรตต่ำและหน่วงที่ 4K)
    const capSize = () => smooth.on ? (quality.label === 'HD' ? { w: 1920, h: 1080 } : quality.label === '4K' ? { w: 3840, h: 2160 } : { w: 2560, h: 1440 }) : { w: quality.w, h: quality.h };
    const sendStream = () => smooth.outStream || stream;
    const outDims = (vw, vh) => { const land = vw >= vh, k = Math.min(1, (land ? quality.w : quality.h) / vw); return { W: Math.round(vw * k / 2) * 2, H: Math.round(vh * k / 2) * 2 }; };
    const trace = (z, t) => { if (window.__zoomTrace) { window.__zoomTrace.push(+z.toFixed(4)); (window.__zoomTimes || (window.__zoomTimes = [])).push(t); } };
    // งานในเธรดแยก: อ่านเฟรมจากกล้อง → ครอป/ย่อบน OffscreenCanvas → ส่งเป็นแทร็กใหม่ · เวลาของเฟรม = เวลาที่กล้องถ่าย (frame.timestamp)
    // ซูม 1× และขนาดเท่ากัน: ส่งเฟรมจากกล้องต่อไปเลย ไม่ต้องวาด · (ห้ามเขียนคอมเมนต์ภาษาไทยในสตริงโค้ดของ worker — ชุดตรวจคำแปลจะนับเป็นข้อความ)
    const WORKER_SRC = `
      let reader = null, writer = null, cv = null, g = null, outW = 1920, outH = 1080, max = 8, z = 1, zd = 1, vel = 0, last = 0, gen = 0, delay = 0;
      const clamp = v => Math.min(max, Math.max(1, v));
      onmessage = e => {
        const m = e.data;
        if (m.type === 'out') writer = m.writable.getWriter();
        else if (m.type === 'src') { if (reader) reader.cancel().catch(() => {}); reader = m.readable.getReader(); run(reader, ++gen); }
        else if (m.type === 'cfg') { outW = m.w; outH = m.h; max = m.max; delay = m.delay || 0; }
        else if (m.type === 'z') { vel = 0; z = clamp(m.z); }
        else if (m.type === 'vel') vel = m.v;
      };
      async function run(r, id) {
        for (;;) {
          let res;
          try { res = await r.read(); } catch (err) { return; }
          if (res.done || id !== gen) { if (res.value) res.value.close(); return; }
          const f = res.value, vw = f.displayWidth, vh = f.displayHeight, ts = f.timestamp / 1000, t0 = performance.now();
          if (delay) while (performance.now() - t0 < delay) {}
          const dt = last ? Math.max(0, Math.min(200, ts - last)) : 0; last = ts;
          if (vel) { z = clamp(Math.exp(Math.log(z) + vel * Math.min(dt, 100))); if (z >= max || z <= 1) vel = 0; zd = z; }
          else { const lz = Math.log(zd), k = 1 - Math.exp(-dt / 70); zd = Math.abs(Math.log(z) - lz) < 1e-3 ? z : Math.exp(lz + (Math.log(z) - lz) * k); }
          const land = vw >= vh, kk = Math.min(1, (land ? outW : outH) / vw), W = Math.round(vw * kk / 2) * 2, H = Math.round(vh * kk / 2) * 2;
          if (!cv || cv.width !== W || cv.height !== H) { cv = new OffscreenCanvas(W, H); g = cv.getContext('2d', { alpha: false }); g.imageSmoothingQuality = 'high'; }
          let out;
          if (zd < 1.0005 && vw === W && vh === H) out = f;
          else {
            const sw = vw / zd, sh = vh / zd;
            g.drawImage(f, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
            out = new VideoFrame(cv, { timestamp: f.timestamp });
            f.close();
          }
          try { if (writer) await writer.write(out); else out.close(); } catch (err) { try { out.close(); } catch (e2) {} }
          postMessage({ z, zd, t: ts, w: W, h: H, ms: performance.now() - t0, dt });
        }
      }`;
    // เฝ้าดูว่าเครื่องประมวลผลซูมนุ่มทันไหม (มือถือรุ่นกลาง/GPU ช้า) — ไม่ทันต่อเนื่อง 4 วินาที = สลับไปใช้ซูมของเลนส์ให้เอง
    const pipe = { n: 0, ms: 0, gap: 0, since: 0, slow: 0, started: 0, fps: 0, avg: 0 };
    function watchPipe(ms, dt) {
      const now = performance.now();
      if (!pipe.started) pipe.started = now;
      if (!pipe.since) pipe.since = now;
      pipe.n++; pipe.ms += ms; pipe.gap += dt || 0;
      if (now - pipe.since < 1000) return;
      pipe.fps = pipe.n * 1000 / (now - pipe.since); pipe.avg = pipe.ms / pipe.n;
      const interval = pipe.gap / pipe.n;
      pipe.n = 0; pipe.ms = 0; pipe.gap = 0; pipe.since = now;
      root.dataset.pipe = `${pipe.avg.toFixed(1)}ms ${pipe.fps.toFixed(1)}fps`;
      if (document.hidden || now - pipe.started < 3000) return;
      // ไม่ทัน = ประมวลผลยุ่งเกือบตลอดช่วงเฟรม (จาก timestamp จริง) และส่งออกได้น้อยกว่าที่กล้องให้มา (เฟรมถูกทิ้ง) ต่อเนื่อง 5 วินาที
      // (กล้องที่ให้เฟรมช้าเองตอนแสงน้อย ช่วงเฟรมยาวแต่เครื่องว่าง — ไม่นับว่าเครื่องช้า)
      const cam = Math.min(fps, stream?.getVideoTracks()[0]?.getSettings?.().frameRate || fps);
      const slow = interval > 0 && pipe.avg > interval * 0.85 && pipe.fps < cam * 0.8;
      pipe.slow = slow ? pipe.slow + 1 : 0;
      if (pipe.slow >= 5 && smooth.on) {
        store.set('caller-smoothzoom', false);
        store.set('caller-smooth-auto-off', true);
        showMsgBrief('เครื่องนี้ประมวลผลซูมนุ่มไม่ทัน — สลับเป็นซูมของเลนส์ให้แล้ว (เปลี่ยนได้ที่ปุ่ม FPS)', 4000);
        setTimeout(() => location.reload(), 1500);
        smooth.on = false;
      }
    }
    function startSmooth() {
      if (!smooth.on || smooth.out || !stream) return;
      const cam = stream.getVideoTracks()[0];
      if (!cam) return;
      if (window.MediaStreamTrackProcessor && window.MediaStreamTrackGenerator && window.OffscreenCanvas && window.VideoFrame && window.Worker) {
        try {
          const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
          const gen = new MediaStreamTrackGenerator({ kind: 'video' });
          w.postMessage({ type: 'cfg', w: quality.w, h: quality.h, max: smooth.max, delay: +store.get('test-pipe-delay', 0) || 0 });
          w.postMessage({ type: 'out', writable: gen.writable }, [gen.writable]);
          const src = t => { const p = new MediaStreamTrackProcessor({ track: t }); w.postMessage({ type: 'src', readable: p.readable }, [p.readable]); };
          src(cam);
          w.onmessage = e => {
            const m = e.data;
            // ค่าซูมจริงอยู่ที่ worker (คำนวณตามเวลาเฟรม) — ระหว่างซูม servo ให้ฝั่งหน้าจอตามค่านั้น
            if (smooth.vel || smooth.syncZ) { smooth.z = m.z; if (!smooth.vel) smooth.syncZ = false; }
            smooth.size = { width: m.w, height: m.h };
            trace(m.zd, m.t);
            watchPipe(m.ms, m.dt);
          };
          Object.assign(smooth, {
            mode: 'worker', out: gen, worker: w,
            setZ: v => w.postMessage({ type: 'z', z: v }), setVel: v => w.postMessage({ type: 'vel', v }),
            source: t => src(t), cfg: () => w.postMessage({ type: 'cfg', w: quality.w, h: quality.h, max: smooth.max, delay: +store.get('test-pipe-delay', 0) || 0 })
          });
          smooth.outStream = new MediaStream([gen, ...stream.getAudioTracks()]);
          root.dataset.zoomPipe = 'worker';
          return;
        } catch (e) { smooth.out = null; }
      }
      // สำรอง: canvas บนเธรดหลัก
      const srcV = document.createElement('video');
      srcV.muted = true; srcV.playsInline = true; srcV.autoplay = true;
      srcV.srcObject = new MediaStream([cam]);
      const cv = document.createElement('canvas');
      cv.width = quality.w; cv.height = quality.h;
      const g = cv.getContext('2d', { alpha: false, desynchronized: true });
      let at = 0, zd = 1;
      const draw = () => {
        const vw = srcV.videoWidth, vh = srcV.videoHeight;
        if (vw && vh) {
          const { W, H } = outDims(vw, vh);
          if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
          smooth.size = { width: W, height: H };
          const now = performance.now(), dt = at ? Math.min(200, now - at) : 1000; at = now;
          if (smooth.vel) { smooth.z = Math.min(smooth.max, Math.max(1, Math.exp(Math.log(smooth.z) + smooth.vel * Math.min(dt, 100)))); if (smooth.z >= smooth.max || smooth.z <= 1) smooth.vel = 0; zd = smooth.z; }
          else { const lz = Math.log(zd), k = 1 - Math.exp(-dt / 70); zd = Math.abs(Math.log(smooth.z) - lz) < 1e-3 ? smooth.z : Math.exp(lz + (Math.log(smooth.z) - lz) * k); }
          const sw = vw / zd, sh = vh / zd;
          g.imageSmoothingQuality = 'high';
          g.drawImage(srcV, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
          trace(zd, now);
        }
        next();
      };
      const next = () => { if (stopped) return; if (srcV.requestVideoFrameCallback) srcV.requestVideoFrameCallback(draw); else requestAnimationFrame(draw); };
      srcV.play().catch(() => {});
      next();
      Object.assign(smooth, {
        mode: 'canvas', out: cv.captureStream(fps).getVideoTracks()[0],
        setZ: () => {}, setVel: () => {},
        source: t => { srcV.srcObject = new MediaStream([t]); srcV.play().catch(() => {}); }, cfg: () => {}
      });
      smooth.outStream = new MediaStream([smooth.out, ...stream.getAudioTracks()]);
      root.dataset.zoomPipe = 'canvas';
    }
    // เปิดกล้องให้ได้ทุกเครื่อง: ลองค่าที่ต้องการก่อน แล้วค่อย ๆ ผ่อนเงื่อนไข (เลนส์ที่เลือก → ด้านหน้า/หลัง → กล้องตัวไหนก็ได้)
    // และถ้าไมค์ใช้ไม่ได้ (ไม่มี / ถูกแอปอื่นจับอยู่) ยังส่งภาพได้
    const camAudio = () => guestSlot ? { echoCancellation: true, noiseSuppression: true, ...(micId ? { deviceId: { exact: micId } } : {}) }
      // กล้องทีมงาน: ไม่ตัดเสียงรอบข้าง (เสียงบรรยากาศ/ดนตรีไม่ถูกบีบ) · แขก: ตัดเสียงสะท้อน
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    async function getCamera(withAudio) {
      const cs = capSize(), size = { width: { ideal: cs.w }, height: { ideal: cs.h }, frameRate: { ideal: fps } };
      // เฟรมเรตคงที่แบบงานถ่ายทอดสด: ห้ามกล้องลดเหลือ ~15 fps ตอนแสงน้อย (Android หลายรุ่นทำเอง ภาพดูหน่วง) — ภาพมืดลงแทน
      const fixed = { ...size, frameRate: { ideal: fps, min: Math.min(24, fps) } };
      const tries = [
        ...(lensId ? [{ deviceId: { exact: lensId }, ...fixed }, { deviceId: { exact: lensId }, ...size }] : []),
        { facingMode: facing, ...fixed },
        { facingMode: facing, ...size },
        { facingMode: { ideal: facing } },
        true
      ];
      let last = null;
      for (const audio of withAudio ? [camAudio(), true, false] : [false]) {
        for (const v of tries) {
          try {
            const st = await navigator.mediaDevices.getUserMedia({ video: v, audio });
            if (lensId && !(v && v.deviceId)) lensId = null;
            if (withAudio && !audio) setTimeout(() => showMsgBrief('ใช้ไมค์ไม่ได้ — ส่งเฉพาะภาพ (ตรวจสิทธิ์ไมค์ หรือปิดแอปอื่นที่ใช้ไมค์อยู่)'), 1500);
            return st;
          } catch (e) {
            last = e;
            // ไม่ได้รับอนุญาต = ลองแบบอื่นก็ไม่ได้
            if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
          }
        }
      }
      throw last || new Error('เปิดกล้องไม่ได้');
    }
    const qualityBtn = $('#caller-quality');
    const paintQuality = () => {
      const s = stream?.getVideoTracks()[0]?.getSettings();
      qualityBtn.textContent = quality.label;
      qualityBtn.title = s?.width ? `ส่งภาพ ${s.width}×${s.height}` : 'คุณภาพภาพ';
    };
    // WebRTC จำกัดบิตเรตต่ำเป็นค่าเริ่มต้น ต้องตั้งเพดานเองเพื่อให้ภาพ 1080p/4K คมจริง
    async function applyBitrate() {
      const sender = call?.peerConnection?.getSenders().find(x => x.track && x.track.kind === 'video');
      if (!sender) return;
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = quality.bitrate;
        params.degradationPreference = 'maintain-resolution';
        await sender.setParameters(params);
      } catch (e) {}
    }
    async function cycleQuality() {
      const i = (QUALITIES.indexOf(quality) + 1) % QUALITIES.length;
      quality = QUALITIES[i];
      store.set('caller-quality', i);
      const track = stream?.getVideoTracks()[0];
      if (track) {
        try { const cs = capSize(); await track.applyConstraints({ width: { ideal: cs.w }, height: { ideal: cs.h }, frameRate: { ideal: fps } }); }
        catch (e) {}
      }
      await applyBitrate();
      paintQuality();
      if (smooth.cfg) smooth.cfg();
      const s = smooth.size || track?.getSettings();
      if (s?.width) showMsgBrief(`ส่งภาพ ${s.width}×${s.height}${s.height < quality.h ? ' (กล้องรองรับสูงสุดเท่านี้)' : ''}`);
    }
    let briefTimer = null;
    const showMsgBrief = (text, ms = 2500) => { showMsg(text); clearTimeout(briefTimer); briefTimer = setTimeout(() => showMsg(''), ms); };
    let pro = null;
    // ข้อความจากทีมงาน (แขก): ค้างไว้ 12 วินาที
    let bubbleTimer = null;
    const teamMsg = text => { const el = $('#guest-bubble'); el.innerHTML = ''; const b = document.createElement('b'); b.textContent = guestSlot ? 'ทีมงาน: ' : 'ผู้กำกับ: '; el.append(b, text.slice(0, 160)); el.hidden = false; clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => { el.hidden = true; }, 12000); };
    // คุณภาพสัญญาณ (แขก): บิตเรตที่ส่งออกจริง + สถานะการเชื่อมต่อ
    let lastOut = null;
    async function paintNet() {
      const pc = call?.peerConnection, el = $('#gt-net');
      if (!pc || !el) return;
      try {
        const rep = await pc.getStats();
        let bytes = 0, rtt = null;
        rep.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') bytes += r.bytesSent || 0; if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime; });
        const now = performance.now();
        if (lastOut) {
          const mbps = (bytes - lastOut.bytes) * 8 / ((now - lastOut.t) * 1000);
          const good = mbps > 0.6 && (rtt == null || rtt < 0.3);
          el.textContent = `${good ? 'สัญญาณดี' : mbps > 0.2 ? 'สัญญาณพอใช้' : 'สัญญาณอ่อน'} · ${mbps.toFixed(1)} Mbps`;
          el.className = 'gt-net ' + (good ? 'ok' : 'warn');
        }
        lastOut = { bytes, t: now };
      } catch (e) {}
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('ต้องใช้ HTTPS', 'bad');
        showMsg('เบราว์เซอร์อนุญาตให้ใช้กล้องเฉพาะหน้าเว็บที่เปิดผ่าน HTTPS เท่านั้น');
        return;
      }
      try {
        stream = preStream || await getCamera(true);
        preStream = null;
      } catch (e) {
        setStatus('เปิดกล้องไม่ได้', 'bad');
        showMsg('ไม่ได้รับอนุญาตให้ใช้กล้อง/ไมค์: ' + e.message);
        return;
      }
      startSmooth();
      if (store.get('caller-smooth-auto-off', false)) { store.set('caller-smooth-auto-off', false); setTimeout(() => showMsgBrief('เครื่องนี้ประมวลผลซูมนุ่มไม่ทัน — ใช้ซูมของเลนส์แทน (เปลี่ยนได้ที่ปุ่ม FPS)', 5000), 1200); }
      video.srcObject = sendStream();
      paintQuality();
      keepScreenOn(true);
      if (!guestSlot && WM.initProCam) pro = WM.initProCam({
        root, video, brief: showMsgBrief,
        getStream: () => stream,
        getOutStream: () => sendStream(),
        // ซูมดิจิทัลแบบนุ่ม (null = ใช้ซูมของเลนส์)
        digitalZoom: smooth.on ? {
          get: () => smooth.z,
          set: v => { smooth.vel = 0; smooth.z = Math.min(smooth.max, Math.max(1, +v || 1)); smooth.setZ && smooth.setZ(smooth.z); },
          setVel: v => { if (smooth.vel && !v) smooth.syncZ = true; smooth.vel = +v || 0; if (smooth.setVel) smooth.setVel(smooth.vel); },
          max: () => smooth.max, outSize: () => smooth.size
        } : null,
        smoothZoom: () => smooth.on,
        pipeStats: () => smooth.on && pipe.avg ? { ms: pipe.avg, fps: pipe.fps } : null,
        setSmoothZoom(on) { store.set('caller-smoothzoom', !!on); location.reload(); },
        getPeerConnection: () => call?.peerConnection || null,
        send: msg => { if (conn && conn.open) { try { conn.send(msg); } catch (e) {} } },
        qualities: () => QUALITIES.map(q => q.label),
        getQuality: () => quality.label,
        getFps: () => fps,
        async setQuality(label) { const i = QUALITIES.findIndex(q => q.label === label); if (i < 0 || QUALITIES[i] === quality) return; quality = QUALITIES[(i + QUALITIES.length - 1) % QUALITIES.length]; await cycleQuality(); },
        async setFps(v) { fps = v; store.set('caller-fps', v); const t = stream?.getVideoTracks()[0]; try { await t.applyConstraints({ frameRate: { ideal: v } }); } catch (e) { await reopenVideo(); } },
        // เลือกเลนส์ (หน้า/หลัง/มุมกว้าง/เทเล) — จำด้านของเลนส์ไว้ ปุ่มสลับกล้องจึงสลับถูกด้าน
        async setLens(id, side) { lensId = id; if (side) facing = side; await reopenVideo(); },
        teamMsg: text => teamMsg(text),
        flip: () => flip()
      });
      if (typeof Peer === 'undefined') {
        setStatus('ออฟไลน์', 'bad');
        showMsg('โหลดระบบเชื่อมต่อ (PeerJS) ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
        return;
      }
      let sig = null;
      try { const raw = new URLSearchParams(location.search).get('sig'); if (raw) sig = JSON.parse(unb64url(raw)); } catch (e) {}
      // ใช้ ID เดิมของเครื่องนี้ทุกครั้ง — สตูดิโอที่โหลดโชว์กลับมาจะจับคู่กล้องนี้เข้ากับ Input เดิมได้
      let myId = store.raw('webmix-cam-id');
      if (!myId) { myId = 'webmix-cam-' + uid().slice(0, 8); store.setRaw('webmix-cam-id', myId); }
      // แขกใช้ ID ตามลิงก์เชิญ สตูดิโอจึงรู้ว่าเป็นแขกคนไหน แม้เปิดจากเครื่องใหม่
      if (guestSlot) myId = 'webmix-g-' + guestSlot;
      const connect = id => {
        peer = id ? new Peer(id, peerOptionsFromSig(sig)) : new Peer(peerOptionsFromSig(sig));
        peer.on('open', () => { placeCall(); openData(); });
        // สตูดิโอโทรกลับมาเพื่อส่งภาพ Program ให้ช่างกล้องดู (ขอจากปุ่ม PGM)
        peer.on('call', c => {
          if (guestSlot || !c.metadata || !c.metadata.ret || c.peer !== targetId) { try { c.close(); } catch (e) {} return; }
          c.answer();
          c.on('stream', s => pro && pro.showReturn(s));
          c.on('close', () => pro && pro.showReturn(null));
        });
        peer.on('error', err => {
          if (stopped) return;
          // ID ถูกใช้อยู่ (เช่นเปิดซ้อนสองแท็บ) — ใช้ ID ชั่วคราวแทน
          if (err.type === 'unavailable-id' && guestSlot) { stop('ลิงก์นี้เปิดอยู่ในอีกหน้าต่างหรืออีกเครื่องแล้ว — ปิดหน้านั้นก่อนแล้วรีเฟรช'); }
          else if (err.type === 'unavailable-id' && id) { peer.destroy(); connect(null); }
          else if (err.type === 'peer-unavailable') scheduleRetry('รอสตูดิโอออนไลน์…');
          else setStatus('ผิดพลาด: ' + err.type, 'bad');
        });
        peer.on('disconnected', () => { if (!stopped && !peer.destroyed) peer.reconnect(); });
      };
      connect(myId);
    }

    function placeCall() {
      if (stopped) return;
      clearTimeout(retryTimer);
      setStatus('กำลังเชื่อมต่อสตูดิโอ…');
      const c = peer.call(targetId, sendStream(), guestSlot ? { metadata: { guest: guestSlot } } : undefined);
      call = c;
      // แขก: ภาพและเสียงรายการที่สตูดิโอส่งกลับมา
      if (guestSlot) c.on('stream', remote => { returnVideo.srcObject = remote; returnVideo.hidden = false; returnVideo.play().catch(() => {}); });
      c.peerConnection?.addEventListener('connectionstatechange', () => {
        const st = c.peerConnection.connectionState;
        if (st === 'connected') { setStatus('เชื่อมต่อแล้ว', 'ok'); showMsg(''); applyBitrate(); }
        else if (st === 'failed') c.close();
      });
      c.on('close', () => { if (call === c) scheduleRetry('ขาดการเชื่อมต่อ กำลังลองใหม่…'); });
    }

    function openData() {
      if (stopped || !peer || peer.destroyed) return;
      const d = peer.connect(targetId, { reliable: true });
      conn = d;
      d.on('open', () => { if (pro) pro.onConnected(); if (guestSlot) { try { d.send({ type: 'guest-info', name: guestName }); } catch (e) {} } });
      d.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (pro && (msg.type === 'cam-set' || msg.type === 'cam-cmd')) pro.onStudioMsg(msg);
        if (msg.type === 'tally') setTally(msg.tally);
        if (!guestSlot && msg.type === 'hello' && msg.name) $('.caller-title').textContent = `${String(msg.name).slice(0, 32)}${msg.show ? ' · สตูดิโอ ' + String(msg.show).slice(0, 40) : ''}`;
        // เลขกล้อง = ลำดับการ์ดในสตูดิโอ (ตรงกับปุ่มลัด 1–9 ของผู้กำกับ)
        if (!guestSlot && msg.type === 'hello') { const n = $('#cam-num'); if (n) { n.hidden = !(msg.num > 0); n.textContent = `CAM ${msg.num | 0}`; } }
        if (guestSlot && msg.type === 'msg' && typeof msg.text === 'string') teamMsg(msg.text);
        if (guestSlot && msg.type === 'view') root.classList.toggle('view-self', msg.v === 'self');
        if (msg.type === 'removed') stop(guestSlot ? 'สตูดิโอจบการเชื่อมต่อแล้ว ขอบคุณที่ร่วมรายการ' : 'สตูดิโอนำกล้องนี้ออกจากรายการแล้ว');
      });
      d.on('close', () => { if (conn === d && !stopped) setTimeout(openData, 3000); });
    }

    function scheduleRetry(text) {
      if (stopped) return;
      setStatus(text);
      setTally('off');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (peer && peer.open) { placeCall(); if (!conn || !conn.open) openData(); }
      }, 3000);
    }

    function stop(message) {
      stopped = true;
      clearTimeout(retryTimer);
      try { call && call.close(); } catch (e) {}
      try { peer && peer.destroy(); } catch (e) {}
      stream && stream.getTracks().forEach(t => t.stop());
      if (smooth.out) smooth.out.stop();
      if (smooth.worker) smooth.worker.terminate();
      video.srcObject = null;
      returnVideo.srcObject = null;
      returnVideo.hidden = true;
      keepScreenOn(false);
      setTally('off');
      setStatus('หยุดส่งภาพแล้ว', 'bad');
      showMsg(message || 'หยุดส่งภาพแล้ว — รีเฟรชหน้านี้เพื่อเชื่อมต่อใหม่');
    }

    // สลับกล้องโดยเปลี่ยนแทร็กในสายเดิม ช่อง Input ที่สตูดิโอจึงไม่เพิ่มขึ้น
    async function flip() {
      if (!stream || stopped) return;
      const prev = facing;
      facing = facing === 'user' ? 'environment' : 'user';
      lensId = null;
      await reopenVideo(prev);
    }
    // เปิดกล้องใหม่ตามตัวเลือกปัจจุบัน (ด้าน / เลนส์ / เฟรมเรต) แล้วสลับแทร็กในสายเดิม
    async function reopenVideo(prevFacing) {
      if (!stream || stopped) return;
      const prev = prevFacing || facing;
      const oldTrack = stream.getVideoTracks()[0];
      const sender = call?.peerConnection?.getSenders().find(s => s.track && s.track.kind === 'video');
      // มือถือหลายรุ่นเปิดกล้องสองตัวพร้อมกันไม่ได้ ต้องปิดตัวเดิมก่อน
      if (oldTrack) { oldTrack.stop(); stream.removeTrack(oldTrack); }
      let track;
      try { track = (await getCamera(false)).getVideoTracks()[0]; }
      catch (e) {
        facing = prev;
        lensId = null;
        try { track = (await getCamera(false)).getVideoTracks()[0]; }
        catch (e2) { setStatus('สลับกล้องไม่ได้', 'bad'); return; }
      }
      stream.addTrack(track);
      // ซูมนุ่ม: เปลี่ยนแค่ภาพต้นทาง — แทร็กที่ส่ง/บันทึกเป็นแทร็กเดิม สตูดิโอไม่สะดุด
      if (smooth.source) smooth.source(track);
      else { video.srcObject = stream; if (sender) await sender.replaceTrack(track); }
      paintQuality();
      if (pro) pro.afterTrackChange();
    }

    // แขก: ปิดกล้องชั่วคราว (สตูดิโอเห็นจอดำ เสียงยังส่งอยู่)
    function toggleCam() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      camOn = !camOn;
      track.enabled = camOn;
      root.classList.toggle('cam-off', !camOn);
      $('#caller-cam').classList.toggle('is-off', !camOn);
      if (guestSlot) $('#caller-cam').dataset.label = camOn ? 'ปิดกล้อง' : 'เปิดกล้อง';
    }

    function toggleMic() {
      const track = stream?.getAudioTracks()[0];
      if (!track) return;
      micOn = !micOn;
      track.enabled = micOn;
      const btn = $('#caller-mic');
      btn.classList.toggle('is-off', !micOn);
      btn.innerHTML = icon(micOn ? 'mic' : 'mic-off');
    }

    root.addEventListener('click', e => {
      const b = e.target.closest('[data-caller]');
      if (!b) return;
      if (b.dataset.caller === 'flip') flip();
      else if (b.dataset.caller === 'mic') toggleMic();
      else if (b.dataset.caller === 'quality') cycleQuality();
      else if (b.dataset.caller === 'cam') toggleCam();
      else if (b.dataset.caller === 'end') stop();
    });

    if (guestSlot) {
      // หน้าเข้าร่วม (design 33): ภาพตัวอย่าง · ชื่อ · เลือกกล้อง/ไมค์ · ระดับเสียง · ทดสอบลำโพง
      // การกด “เข้าร่วม” คือการอนุญาตให้เบราว์เซอร์เล่นเสียงรายการ
      root.classList.add('guest-mode');
      $('.caller-title').textContent = guestName ? `แขกรับเชิญ · ${guestName}` : 'แขกรับเชิญ';
      $('#caller-quality').hidden = true;
      $('#caller-cam').hidden = false;
      for (const [k, l] of [['mic', 'ไมค์'], ['flip', 'สลับกล้อง'], ['cam', 'ปิดกล้อง'], ['end', 'ออกจากรายการ']]) $(`[data-caller=${k}]`, root).dataset.label = l;
      $('#guest-join-name').textContent = guestName;
      $('#gj-show').textContent = showName || 'รายการสด';
      $('#gt-show').textContent = showName || 'รายการสด';
      const nameIn = $('#gj-name'), chip = $('#gj-name-chip');
      nameIn.value = guestName; chip.textContent = guestName || 'ชื่อของคุณ';
      nameIn.addEventListener('input', () => { chip.textContent = nameIn.value.trim() || 'ชื่อของคุณ'; });
      $('#guest-join').hidden = false;
      setStatus('ยังไม่ได้เข้าร่วม');
      const camSel = $('#gj-cam'), micSel = $('#gj-mic'), pv = $('#gj-preview'), bar = $('#gj-meter');
      let meterAc = null, raf = 0;
      const stopMeter = () => { cancelAnimationFrame(raf); meterAc?.close().catch(() => {}); meterAc = null; };
      const openPreview = async () => {
        stopMeter();
        preStream?.getTracks().forEach(t => t.stop());
        preStream = null;
        lensId = camSel.value || null; micId = micSel.value || '';
        try { preStream = await getCamera(true); }
        catch (e) { $('#gj-off').textContent = 'เปิดกล้อง/ไมค์ไม่ได้: ' + e.message; $('#gj-off').hidden = false; return; }
        pv.srcObject = preStream; pv.play().catch(() => {}); $('#gj-off').hidden = true;
        const vt = preStream.getVideoTracks()[0], at = preStream.getAudioTracks()[0];
        $('#gj-cam-label').textContent = vt ? vt.label || 'กล้อง' : 'ไม่มีกล้อง';
        $('#gj-mic-label').textContent = at ? at.label || 'ไมค์' : 'ไม่มีไมค์';
        if (at) {
          meterAc = new AudioContext(); meterAc.resume().catch(() => {});
          const an = meterAc.createAnalyser(); an.fftSize = 512; meterAc.createMediaStreamSource(preStream).connect(an);
          const buf = new Float32Array(512);
          const tick = () => { an.getFloatTimeDomainData(buf); let pk = 0; for (const x of buf) pk = Math.max(pk, Math.abs(x)); bar.style.width = `${Math.max(0, Math.min(100, (20 * Math.log10(pk || 1e-6) + 60) / 60 * 100))}%`; raf = requestAnimationFrame(tick); };
          tick();
        }
      };
      const fillDevices = async () => {
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const opt = (list, cur, none) => list.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === cur ? 'selected' : ''}>${(d.label || none + ' ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
          camSel.innerHTML = opt(devs.filter(d => d.kind === 'videoinput'), preStream?.getVideoTracks()[0]?.getSettings().deviceId, 'กล้อง');
          micSel.innerHTML = opt(devs.filter(d => d.kind === 'audioinput'), preStream?.getAudioTracks()[0]?.getSettings().deviceId, 'ไมค์');
        } catch (e) {}
      };
      if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) openPreview().then(fillDevices);
      camSel.addEventListener('change', openPreview);
      micSel.addEventListener('change', openPreview);
      $('#gj-speaker').addEventListener('click', () => {
        const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 660; g.gain.setValueAtTime(0.2, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.8);
        o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.8); setTimeout(() => ac.close(), 1200);
      });
      $('#guest-join-btn').addEventListener('click', () => {
        guestName = nameIn.value.trim().slice(0, 40) || guestName;
        $('.caller-title').textContent = guestName ? `แขกรับเชิญ · ${guestName}` : 'แขกรับเชิญ';
        $('#guest-self-name').textContent = guestName;
        stopMeter();
        $('#guest-join').hidden = true;
        for (const id of ['guest-top', 'guest-cap', 'guest-self-name', 'guest-hear']) $('#' + id).hidden = false;
        returnVideo.play().catch(() => {});
        setInterval(paintNet, 2000);
        start();
      }, { once: true });
    } else {
      start();
    }
  }

  Object.assign(WM, { initCaller });
})(window.WebMix);
