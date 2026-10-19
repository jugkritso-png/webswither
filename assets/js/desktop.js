/* WebMix — เชื่อมกับแอปเดสก์ท็อป (Tauri / Rust) เมื่อเปิดหน้าในแอป: Gateway ในเครื่อง, บันทึกลงโฟลเดอร์, ทดสอบตัวเอง
   เปิดในเบราว์เซอร์ทั่วไป WebMix.desktop = null และหน้าทำงานเหมือนเดิมทุกอย่าง */
(function (WM) {
  'use strict';

  const T = window.__TAURI__;
  if (!T || !T.core || typeof T.core.invoke !== 'function') { WM.desktop = null; return; }
  const invoke = T.core.invoke;

  // หน้าเว็บสาธารณะของ WebMix — ลิงก์/QR ที่ส่งให้มือถือและแขกรับเชิญต้องเปิดได้จากเครื่องอื่น
  // (หน้าในแอปเป็นที่อยู่ภายในเครื่อง เช่น tauri://localhost ซึ่งมือถือเปิดไม่ได้)
  const PUBLIC_PAGE = 'https://jugkritso-png.github.io/webswither/';

  async function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
    throw new Error('ข้อมูลไม่ใช่ไฟล์');
  }

  const desktop = {
    info: null,
    error: '',
    publicPage: PUBLIC_PAGE,
    ready: null,
    // แอป Android: ไม่มีหน้าต่างแยก (Output / Multiview) และไม่มีหน้าต่างเลือกโฟลเดอร์ — บันทึกลง Movies/WebMix
    mobile: /Android/i.test(navigator.userAgent),

    pickFolder: () => invoke('pick_folder'),
    // Android: บริการเบื้องหน้า (แจ้งเตือน "กำลังไลฟ์") ให้กล้อง ไมค์ และการสตรีมทำงานต่อตอนปิดจอ/สลับแอป
    setLive: (active, text) => invoke('set_live', { active: !!active, text: String(text || '') }).catch(() => {}),

    // เปิดไฟล์ใหม่ในโฟลเดอร์ แล้วคืนตัวเขียนแบบเดียวกับ FileSystemWritableFileStream
    // write(ข้อมูล) ต่อท้ายไฟล์ · write({ type: 'write', position, data }) เขียนทับตามตำแหน่ง · close()
    async createFile(name, dir) {
      const f = await invoke('rec_open', { name, dir: dir || null });
      const headers = { 'x-rec-id': String(f.id) };
      return {
        path: f.path,
        dir: f.dir,
        async write(chunk) {
          if (chunk && chunk.type === 'write') {
            const data = await toBytes(chunk.data);
            return invoke('rec_patch', data, { headers: { ...headers, 'x-position': String(chunk.position) } });
          }
          return invoke('rec_write', await toBytes(chunk), { headers });
        },
        close: () => invoke('rec_close', { id: f.id })
      };
    }
  };

  desktop.ready = invoke('desktop_info')
    .then(info => { desktop.info = info; return info; })
    .catch(e => { desktop.error = String(e && e.message || e); return null; });

  /* ---- โหมดทดสอบตัวเอง (WEBMIX_SELFTEST=1) — ใช้ใน CI ของทุกระบบปฏิบัติการ ----
     ตรวจว่าหน้า WebMix เปิดได้ เรียก Rust ได้ เชื่อม Gateway ในเครื่องได้ เขียนไฟล์ได้
     และรายงานความสามารถของ webview (WebGL / MediaRecorder / WebRTC) แล้วแอปปิดตัวเอง */
  async function selfTest(info) {
    const checks = [];
    const add = (name, ok, detail = '', required = true) => checks.push({ name, ok: !!ok, detail: String(detail), required });
    const wait = ms => new Promise(r => setTimeout(r, ms));

    for (let i = 0; i < 50 && !window.webmix; i++) await wait(200);
    add('studio', !!window.webmix, window.webmix ? 'หน้า WebMix เริ่มทำงาน' : 'app.js ไม่เริ่มทำงาน');
    add('ipc', !!info, info ? `${info.os}/${info.arch} v${info.version}` : desktop.error);
    if (!info) return { ok: false, checks };

    // Android: ffmpeg มากับแอป ต้องมีเสมอ · เดสก์ท็อป: ผู้ใช้ติดตั้งเอง (ไม่มีก็ใช้ส่วนอื่นได้)
    add('ffmpeg', !!info.ffmpeg, info.ffmpeg ? info.ffmpeg.version : (info.ffmpegError || 'ไม่พบ ffmpeg'), desktop.mobile);
    add('gateway-start', !!info.gateway, info.gateway ? info.gateway.url.replace(/token=[^&]+/, 'token=…') : info.gatewayError);
    if (info.gateway) {
      const ok = await new Promise(resolve => {
        let ws;
        const done = v => { try { ws.close(); } catch (e) {} resolve(v); };
        const t = setTimeout(() => done(false), 5000);
        try {
          ws = new WebSocket(info.gateway.url);
          ws.onopen = () => { clearTimeout(t); done(true); };
          ws.onerror = () => { clearTimeout(t); done(false); };
        } catch (e) { clearTimeout(t); done(false); }
      });
      add('gateway-connect', ok, ok ? 'เชื่อม WebSocket ได้' : 'เชื่อม WebSocket ไม่ได้');
    }

    try {
      const w = await desktop.createFile(`webmix-selftest-${Date.now()}.bin`, info.tempDir);
      await w.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
      await w.write(new Blob([new Uint8Array([9, 10])]));
      await w.write({ type: 'write', position: 2, data: new Uint8Array([0xaa, 0xbb]) });
      const res = await w.close();
      const ok = res && res.bytes === 10;
      await invoke('selftest_cleanup', { path: w.path }).catch(() => {});
      add('native-file', ok, ok ? 'เขียน/เขียนทับ/ปิดไฟล์ได้' : JSON.stringify(res));
    } catch (e) { add('native-file', false, e); }

    // บันทึกลงโฟลเดอร์จริงของแอป (เดสก์ท็อป: วิดีโอ/WebMix · Android: Movies/WebMix)
    try {
      const w = await desktop.createFile(`webmix-selftest-${Date.now()}.webm`);
      await w.write(new Uint8Array(4096));
      const res = await w.close();
      await invoke('selftest_cleanup', { path: w.path }).catch(() => {});
      add('rec-folder', res && res.bytes === 4096, w.dir, false);
    } catch (e) { add('rec-folder', false, e, false); }

    // หน้าต่าง Program Output / Multiview (window.open แล้วหน้าหลักเขียนเนื้อหาเข้าไป) — Android ไม่มีหน้าต่างแยก
    if (!desktop.mobile) try {
      const w = window.open('about:blank', 'webmix-selftest', 'width=320,height=200');
      let ok = false;
      for (let i = 0; i < 25 && w && !ok; i++) {
        try { w.document.body.innerHTML = '<p id="t">ok</p>'; ok = w.document.getElementById('t') !== null; } catch (e) {}
        if (!ok) await wait(200);
      }
      if (w) w.close();
      add('popup-window', ok, ok ? 'เปิดหน้าต่างและเขียนเนื้อหาได้' : 'เปิดหน้าต่าง Output ไม่ได้' + (w ? '' : ' (window.open คืน null)'), false);
    } catch (e) { add('popup-window', false, e, false); }

    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    add('webgl', !!gl, gl ? (gl.getParameter(gl.VERSION) || '') : 'ไม่มี WebGL — ใช้ CPU', false);
    add('captureStream', typeof c.captureStream === 'function', '', false);
    const mr = typeof MediaRecorder === 'function';
    const mrType = mr ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) : '';
    add('mediaRecorder', mr && !!mrType, mrType || (mr ? 'มี MediaRecorder แต่ไม่รองรับ WebM/MP4 (ขาดปลั๊กอิน GStreamer?)' : 'ไม่มี MediaRecorder — บันทึก/สตรีมไม่ได้'), false);
    // อัดวิดีโอจริง 2 วินาทีจากแคนวาส (ทางเดียวกับปุ่ม REC และการสตรีม)
    if (mr && mrType && typeof c.captureStream === 'function') {
      try {
        const src = document.createElement('canvas');
        src.width = 320; src.height = 180;
        const g = src.getContext('2d');
        let n = 0; const tick = setInterval(() => { g.fillStyle = `hsl(${(n++ * 20) % 360} 80% 50%)`; g.fillRect(0, 0, 320, 180); }, 33);
        const useWc = WM.wcrec && WM.wcrec.preferred();
        const r = useWc
          ? WM.wcrec.recorder({ canvas: src, audioNode: null, fps: 30, videoBitsPerSecond: 1000000, audioBitsPerSecond: 128000 })
          : new MediaRecorder(src.captureStream(30), { mimeType: mrType });
        const parts = []; r.ondataavailable = e => { parts.push(e.data); };
        const stopped = new Promise(res => { r.onstop = res; });
        r.start(500); await wait(2000); r.stop(); await stopped; clearInterval(tick);
        // ไฟล์ต้องเปิดเล่นได้จริง (ไม่ใช่แค่มีข้อมูล) — webview ถอดรหัสและเลื่อนหาตำแหน่ง
        const blob = new Blob(parts, { type: r.mimeType });
        const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob);
        const played = await new Promise(res => {
          const t = setTimeout(() => res(false), 8000);
          v.onloadeddata = () => { clearTimeout(t); res(v.videoWidth === 320); };
          v.onerror = () => { clearTimeout(t); res(false); };
        });
        add('record-sample', blob.size > 1000 && played, `${blob.size} bytes ใน 2 วินาที · ${r.mimeType}${useWc ? ' (WebCodecs)' : ''} · ${played ? 'เปิดเล่นได้' : 'เปิดเล่นไม่ได้'}`, false);
      } catch (e) { add('record-sample', false, e, false); }
    }
    add('webrtc', typeof RTCPeerConnection === 'function', '', false);
    add('getUserMedia', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), '', false);
    add('webaudio', typeof (window.AudioContext || window.webkitAudioContext) === 'function', '', false);
    add('encoder', !!info.encoder, (info.encoder || 'ไม่ทราบ') + (info.encoderNote ? ` · ฮาร์ดแวร์ใช้ไม่ได้: ${info.encoderNote}` : ''), false);
    if (info.selftestStream && info.gateway) await streamTest(info, add, wait);

    return { ok: checks.every(c => c.ok || !c.required), ua: navigator.userAgent, checks };
  }

  /* สตรีมจริงผ่าน Gateway ในแอป: ภาพเคลื่อนไหว 720p + เสียง → ffmpeg ของแอป → ปลายทาง RTMP/SRT ที่ CI เปิดรอรับ
     (เส้นทางเดียวกับปุ่มสตรีมในหน้า WebMix) */
  async function streamTest(info, add, wait) {
    const types = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
    // มือถือ: เส้นทางเดียวกับแอป — H.264 จาก WebCodecs (ชิปของเครื่อง) ส่งต่อโดย Gateway ไม่เข้ารหัสซ้ำ
    const vcopy = !!(desktop.mobile && WM.wcrec && await WM.wcrec.avcSupported(1280, 720, 30, 2500000));
    add('webcodecs-h264', vcopy, vcopy ? 'เข้ารหัส H.264 ด้วยชิปของเครื่องได้' : `ไม่รองรับ (VideoEncoder: ${typeof VideoEncoder}) — Gateway เข้ารหัสเอง`, false);
    const useWc = vcopy || (WM.wcrec && WM.wcrec.preferred());
    const type = useWc ? 'webcodecs' : typeof MediaRecorder === 'function' ? types.find(t => MediaRecorder.isTypeSupported(t)) : '';
    if (!type) { add('stream', false, 'ไม่มี MediaRecorder / WebCodecs'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const g = canvas.getContext('2d');
    let n = 0;
    // วาดด้วยตัวจับเวลาใน Worker แบบเดียวกับแอป — ตอนปิดจอ setInterval ของหน้าเว็บถูกลดเหลือวินาทีละครั้ง
    const draw = () => {
      g.fillStyle = `hsl(${(n * 6) % 360} 70% 45%)`; g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#fff'; g.font = 'bold 96px sans-serif'; g.fillText(`WebMix ${n++}`, 80 + (n * 8) % 600, 380);
    };
    const stopDraw = WM.wcrec ? WM.wcrec.every(draw, 33) : (id => () => clearInterval(id))(setInterval(draw, 33));
    const hold = info.selftestHold || 0;
    const stream = useWc ? null : canvas.captureStream(30);
    let actx = null, osc = null;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      osc = actx.createOscillator(); const dst = actx.createMediaStreamDestination();
      osc.connect(dst); osc.start();
      if (stream) dst.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      actx.resume().catch(() => {});
    } catch (e) {}
    const url = `${info.gateway.url}&fps=30&vb=2500&res=720${vcopy ? '&vcopy=1' : ''}`;
    const statuses = [];
    let live = false, error = '', encoder = null, mimeUsed = type;
    await new Promise(resolve => {
      let rec = null;
      const ws = new WebSocket(url);
      const finish = () => {
        if (rec) mimeUsed = rec.mimeType + (rec.droppedFrames ? ` · ทิ้ง ${rec.droppedFrames} เฟรม` : '');
        try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) {}
        try { ws.send(JSON.stringify({ type: 'stop', id: 'selftest' })); } catch (e) {}
        setTimeout(() => { try { ws.close(); } catch (e) {} resolve(); }, 1500);
      };
      const timer = setTimeout(finish, 40000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start', destinations: [{ id: 'selftest', name: 'selftest', url: info.selftestStream }] }));
        rec = useWc
          ? WM.wcrec.recorder({ canvas, audioNode: osc, fps: 30, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000, preferAvc: true, requireAvc: vcopy, constantBitrate: vcopy })
          : new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2500000 });
        rec.ondataavailable = e => { if (e.data.size && ws.readyState === 1) ws.send(e.data); };
        rec.start(1000);
      };
      ws.onmessage = ev => {
        if (typeof ev.data !== 'string') return;
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.encoder) encoder = m.encoder;
        if (m.type === 'error') error = m.message;
        for (const d of m.destinations || []) {
          statuses.push(d.state);
          if (d.state === 'error') error = d.message;
          // LIVE แล้วส่งต่ออีก 8 วินาทีให้ปลายทางได้ไฟล์ที่ตรวจได้ (หรือค้างไว้ตาม selftestHold พร้อมเปิดบริการเบื้องหน้า
          // เหมือนตอนไลฟ์จริง — CI กดปุ่มโฮมและปิดจอระหว่างนี้)
          if (d.state === 'live' && !live) {
            live = true; clearTimeout(timer);
            if (hold && desktop.mobile) desktop.setLive(true, 'ทดสอบไลฟ์เบื้องหลัง');
            setTimeout(finish, hold ? hold * 1000 : 8000);
          }
        }
      };
      ws.onclose = ev => { if (!live && !error) error = `gateway ปิดการเชื่อมต่อ (${ev.code} ${ev.reason || ''})`; };
    });
    stopDraw();
    if (hold && desktop.mobile) desktop.setLive(false, '');
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (actx) actx.close().catch(() => {});
    const speed = encoder ? ` · encoder ${encoder.speed}x ${encoder.fps} fps` : '';
    add('stream', live, live ? `LIVE ผ่าน ${vcopy ? 'H.264 จาก WebCodecs (ไม่เข้ารหัสซ้ำ)' : info.encoder} (${mimeUsed}${useWc ? ' · WebCodecs' : ''})${speed}` : (error || `ไม่ขึ้น LIVE (${statuses.slice(-5).join(',')})`));
  }

  // Linux: MediaRecorder ของ WebKitGTK เขียน MP4 ที่เสีย — แอปใช้ WebCodecs + ตัวเขียน WebM เอง (wcrec.js) แทน
  // WebKitGTK รุ่นเก่าที่ไม่มี WebCodecs ยังบันทึก/สตรีมไม่ได้ → แจ้งผู้ใช้
  desktop.ready.then(info => {
    if (!info || info.os !== 'linux' || info.selftest || (WM.wcrec && WM.wcrec.hasApi())) return;
    setTimeout(() => WM.toast && WM.toast('WebKitGTK ในเครื่องนี้ไม่มี WebCodecs จึงบันทึก/สตรีมไม่ได้ — อัปเดตระบบ (WebKitGTK 2.44 ขึ้นไป) หรือใช้หน้าเว็บ WebMix ใน Chrome', 'warn', 12000), 1500);
  });

  desktop.ready.then(async info => {
    if (!info || !info.selftest) return;
    if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
    let report;
    try { report = await selfTest(info); } catch (e) { report = { ok: false, error: String(e) }; }
    invoke('selftest_report', { report });
  });

  WM.desktop = desktop;
})(window.WebMix = window.WebMix || {});
