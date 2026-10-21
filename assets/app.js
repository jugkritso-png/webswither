/* ==========================================================================
   WebMix Pro — Live Production Switcher
   ระบบสลับภาพ/เสียงสำหรับไลฟ์สด ทำงานบนเบราว์เซอร์ทั้งหมด
   ========================================================================== */
(() => {
  'use strict';

  const { $, $$, clamp, uid, pad2, esc, icon, fmtDuration, fmtBytes, stamp, easeInOut, easeOut, isIOS, FONT, MONO,
    downloadBlob, store, toast, keepScreenOn, b64url, unb64url, peerOptionsFromSig, initCaller,
    fillBlack, drawFit, fitFont, drawBars, drawSlate, drawClock, RELINK_HINT, drawNoSignal, drawTitle, TITLE_STYLES, drawTitleInput,
    createKeyer, createGpu, idb, canUseOpfs, mediaStore, createMultiview, SHORTCUTS, MANUAL,
    TIMER_MODES, TIMER_STYLES, timerText, drawTimer, drawScore, TICKER_BAR, drawTickerBar, drawTicker, sheetCsvUrl, parseCsv, desktop } = window.WebMix;
  /* ====================================================================== */
  /*  PHONE CAMERA MODE (?call=<studio id>)                                  */
  /* ====================================================================== */
  const callTarget = new URLSearchParams(location.search).get('call');
  if (callTarget) {
    initCaller(callTarget);
    return;
  }


  /* ====================================================================== */
  /*  STUDIO                                                                 */
  /* ====================================================================== */

  /* --------------------------------------------------------------- settings */
  const PLATFORMS = {
    youtube: { label: 'YouTube Live', server: 'rtmp://a.rtmp.youtube.com/live2', maxHeight: 2160 },
    facebook: { label: 'Facebook Live', server: 'rtmps://live-api-s.facebook.com:443/rtmp', maxHeight: 1080 },
    twitch: { label: 'Twitch', server: 'rtmp://live.twitch.tv/app', maxHeight: 1080 },
    srt: { label: 'SRT (vMix / OBS / SRT Server)', server: '' },
    custom: { label: 'RTMP อื่น ๆ (กำหนดเอง)', server: '' }
  };
  const RESOLUTIONS = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160] };
  const RES_LABEL = { '720p': '1280 × 720 (HD 720p)', '1080p': '1920 × 1080 (Full HD 1080p)', '1440p': '2560 × 1440 (QHD 1440p)', '2160p': '3840 × 2160 (4K UHD)' };
  const formatTag = (h, f) => `${h >= 2160 ? '4K' : h + 'p'}${f}`;
  // บิตเรตแนะนำ (kbps) ตามแนวทางของ YouTube Live
  function recommendedKbps(res, f) {
    const base = { '720p': 4500, '1080p': 6000, '1440p': 13000, '2160p': 25000 }[res] || 4500;
    return f > 30 ? Math.round(base * 1.5) : base;
  }
  const MAX_KBPS = 51000;
  const FRAME_RATES = [25, 30, 50, 60];
  const TITLE_COLORS = ['#ef4444', '#f5a524', '#22c55e', '#3b82f6', '#a855f7', '#e5e7eb'];

  const defaults = {
    resolution: '720p', fps: 30, videoKbps: 4500,
    transition: 'mix', duration: 1000,
    gateway: store.raw('webmix-gateway-url') || '',
    destinations: [], rememberKey: false,
    title: { headline: 'BREAKING NEWS', subtitle: 'รายงานสดจากสตูดิโอ WebMix Pro', color: '#ef4444' },
    pip: { position: 'br', size: 0.32 },
    key: { color: 'green', tolerance: 60 },
    srtInputs: [], titlePresets: [],
    renderer: 'auto',
    localGateway: true
  };
  const saved = store.get('settings', {}) || {};
  const firstRun = !Object.keys(saved).length && !store.get('show', null);
  const settings = {
    ...defaults, ...saved,
    title: { ...defaults.title, ...(saved.title || {}) },
    pip: { ...defaults.pip, ...(saved.pip || {}) },
    key: { ...defaults.key, ...(saved.key || {}) }
  };
  if (!RESOLUTIONS[settings.resolution]) settings.resolution = defaults.resolution;
  if (!FRAME_RATES.includes(+settings.fps)) settings.fps = defaults.fps;
  if (!['mix', 'dip', 'wipe'].includes(settings.transition)) settings.transition = 'mix';
  if (![500, 1000, 2000].includes(+settings.duration)) settings.duration = 1000;
  if (!['auto', 'gpu', 'cpu'].includes(settings.renderer)) settings.renderer = 'auto';
  settings.titlePresets = (Array.isArray(settings.titlePresets) ? settings.titlePresets : [])
    .filter(t => t && typeof t === 'object').slice(0, 24)
    .map(t => ({ headline: String(t.headline || '').slice(0, 80), subtitle: String(t.subtitle || '').slice(0, 120), color: TITLE_COLORS.includes(t.color) ? t.color : TITLE_COLORS[0] }));

  // ปลายทางการสตรีม (ส่งพร้อมกันได้หลายช่อง) — ย้ายค่าแบบปลายทางเดียวของเวอร์ชันก่อนมาด้วย
  const MAX_DESTINATIONS = 6;
  const SRT_LATENCIES = [120, 200, 500, 1000, 2000, 4000];
  const newDest = (platform = 'youtube', server, key = '') => ({
    id: uid(), platform, server: server ?? PLATFORMS[platform].server, key, passphrase: '', latency: 500, enabled: true
  });
  if (!Array.isArray(settings.destinations)) settings.destinations = [];
  if (!settings.destinations.length && (saved.server || saved.streamKey)) {
    settings.destinations.push(newDest(PLATFORMS[saved.platform] ? saved.platform : 'custom', saved.server || '', saved.streamKey || ''));
  }
  if (!settings.destinations.length) settings.destinations.push(newDest('youtube'));
  settings.destinations = settings.destinations
    .filter(d => d && typeof d === 'object')
    .slice(0, MAX_DESTINATIONS)
    .map(d => ({
      id: String(d.id || uid()),
      platform: PLATFORMS[d.platform] ? d.platform : 'custom',
      server: String(d.server || ''),
      key: String(d.key || ''),
      passphrase: String(d.passphrase || ''),
      latency: SRT_LATENCIES.includes(+d.latency) ? +d.latency : 500,
      enabled: d.enabled !== false
    }));
  delete settings.platform; delete settings.server; delete settings.streamKey;

  // แอปเดสก์ท็อป: ใช้ Stream Gateway ที่รันอยู่ในแอป (ค่าเริ่มต้น) — ช่อง Gateway ในการตั้งค่ายังเก็บค่าของเซิร์ฟเวอร์ไว้ให้สลับกลับได้
  const usingLocalGateway = () => !!(desktop && settings.localGateway !== false && desktop.info && desktop.info.gateway);
  const gatewayUrl = () => usingLocalGateway() ? desktop.info.gateway.url : settings.gateway.trim();
  // ที่อยู่ของหน้า WebMix สำหรับลิงก์/QR ที่เปิดจากเครื่องอื่น (ในแอปเดสก์ท็อปใช้หน้าเว็บสาธารณะ)
  const pageBase = () => desktop ? desktop.publicPage : location.origin + location.pathname;

  function saveSettings() {
    const copy = JSON.parse(JSON.stringify(settings));
    if (!settings.rememberKey) {
      copy.destinations.forEach(d => { d.key = ''; d.passphrase = ''; });
      (copy.srtInputs || []).forEach(c => { c.passphrase = ''; });
    }
    store.set('settings', copy);
  }

  const RTMP_RE = /^rtmps?:\/\/\S+$/i;
  const SRT_RE = /^srt:\/\/[^\s/?#]+:\d+(\?\S*)?$/i;
  const isSrt = d => d.platform === 'srt';
  // SRT: ส่ง MPEG-TS แบบ caller ไปที่ srt://host:port พร้อม Stream ID, รหัสเข้ารหัส (AES) และค่า latency
  function destUrl(d) {
    const server = d.server.trim().replace(/\/+$/, '');
    if (isSrt(d)) {
      if (!SRT_RE.test(server)) return server;
      const u = new URL(server.replace(/^srt:/i, 'http:'));
      if (d.key.trim()) u.searchParams.set('streamid', d.key.trim());
      if (d.passphrase) { u.searchParams.set('passphrase', d.passphrase); u.searchParams.set('pbkeylen', '16'); }
      u.searchParams.set('latency', String(d.latency * 1000)); // ffmpeg ใช้หน่วยไมโครวินาที
      return 'srt:' + u.toString().slice(5).replace(/\/\?/, '?').replace(/\/$/, '');
    }
    return d.key.trim() ? `${server}/${d.key.trim()}` : server;
  }
  function destMasked(d) {
    const server = d.server.trim().replace(/\/+$/, '');
    if (isSrt(d)) return `${server.replace(/\?.*$/, '')} · ${d.latency} ms${d.key.trim() ? ' · ID ••••' + d.key.trim().slice(-4) : ''}${d.passphrase ? ' · 🔒' : ''}`;
    return server + (d.key.trim() ? '/••••' + d.key.trim().slice(-4) : '');
  }
  const hostOf = d => (/^(?:rtmps?|srt):\/\/([^/:?]+)/i.exec(d.server) || [])[1];
  const baseLabel = d => d.platform === 'custom' ? (hostOf(d) || 'RTMP')
    : isSrt(d) ? `SRT ${hostOf(d) || ''}`.trim() : PLATFORMS[d.platform].label;
  function destLabel(d) {
    if (!d) return '';
    const base = baseLabel(d);
    const same = settings.destinations.filter(x => baseLabel(x) === base);
    return same.length > 1 ? `${base} #${same.indexOf(d) + 1}` : base;
  }
  function destProblem(d) {
    if (isSrt(d)) {
      if (!SRT_RE.test(d.server.trim())) return 'SRT ต้องอยู่ในรูปแบบ srt://host:port';
      if (d.passphrase && (d.passphrase.length < 10 || d.passphrase.length > 64)) return 'รหัสผ่าน SRT ต้องยาว 10–64 ตัวอักษร';
      return '';
    }
    if (!RTMP_RE.test(destUrl(d))) return 'RTMP Server ต้องขึ้นต้นด้วย rtmp:// หรือ rtmps://';
    if (!d.key.trim() && d.platform !== 'custom') return 'ยังไม่ได้ใส่ Stream Key';
    return '';
  }

  /* ------------------------------------------------------------ canvases */
  const pgmCanvas = $('#pgm-canvas');
  const pvwCanvas = $('#pvw-canvas');
  const pgmCtx = pgmCanvas.getContext('2d');
  const pvwCtx = pvwCanvas.getContext('2d');
  const keyCanvas = document.createElement('canvas');
  keyCanvas.width = 640; keyCanvas.height = 360;
  const keyCtx = keyCanvas.getContext('2d', { willReadFrequently: true });
  let W = 1280, H = 720, PW = 1280, PH = 720;

  function applyResolution() {
    [W, H] = RESOLUTIONS[settings.resolution];
    PW = Math.min(W, 1280); PH = Math.round(PW * 9 / 16);
    pgmCanvas.width = W; pgmCanvas.height = H;
    pvwCanvas.width = PW; pvwCanvas.height = PH;
    $('#pgm-format').textContent = formatTag(H, settings.fps);
    output.reset();
    ticker.setRate(settings.fps);
    checkHwAvc();
  }

  // มือถือ (แอป Android): หน้าเว็บเข้ารหัส H.264 ด้วยชิปของเครื่อง (WebCodecs → MediaCodec) แล้วให้ Gateway ในแอป
  // ส่งต่อเลยโดยไม่ถอดรหัส/เข้ารหัสซ้ำ — งานลดลงเกือบครึ่ง เครื่องร้อนน้อยลง ภาพคมขึ้น
  // ปิดได้ด้วย localStorage 'webmix-vcopy' = '0'
  const hwAvc = { key: '', ok: false };
  function checkHwAvc() {
    if (!desktop || !desktop.mobile || !window.WebMix.wcrec) return;
    let off = false;
    try { off = localStorage.getItem('webmix-vcopy') === '0'; } catch (e) {}
    const key = `${W}x${H}@${settings.fps}`;
    hwAvc.key = key; hwAvc.ok = false;
    if (off) return;
    // วัดความเร็วจริงก่อน (บางเครื่องรองรับแต่ช้ากว่าให้ Gateway เข้ารหัส) — รอให้หน้าเริ่มทำงานเสร็จก่อนค่อยวัด
    clearTimeout(hwAvc.timer);
    hwAvc.timer = setTimeout(() => {
      if (hwAvc.key !== key || streamer.active) return;
      window.WebMix.wcrec.avcBenchmark(W, H, settings.fps, settings.videoKbps * 1000)
        .then(r => { if (hwAvc.key === key) { hwAvc.ok = r.ok; hwAvc.fps = r.fps; } }).catch(() => {});
    }, 4000);
  }
  const useVideoCopy = () => usingLocalGateway() && hwAvc.ok && hwAvc.key === `${W}x${H}@${settings.fps}`;

  /* -------------------------------------------------------------- state */
  const inputs = [];
  const state = { programId: null, previewId: null };
  const tr = { progress: 0, auto: false, start: 0, from: 0, base: 0 };
  const ftb = { target: 0, level: 0 };
  const overlays = {
    title: { on: false, anim: 0 },
    pip: { on: false, sourceId: null },
    key: { on: false, sourceId: null, ready: false }
  };
  const byId = id => inputs.find(i => i.id === id) || null;

  const TYPE_META = {
    bars: { icon: 'bars', label: 'BARS' },
    black: { icon: 'square', label: 'BLACK' },
    slate: { icon: 'type', label: 'SLATE' },
    clock: { icon: 'clock', label: 'CLOCK' },
    image: { icon: 'image', label: 'IMAGE' },
    media: { icon: 'film', label: 'VIDEO' },
    camera: { icon: 'video', label: 'CAMERA' },
    screen: { icon: 'monitor', label: 'SCREEN' },
    wireless: { icon: 'phone', label: 'MOBILE' },
    srt: { icon: 'broadcast', label: 'SRT' },
    title: { icon: 'type', label: 'TITLE' },
    guest: { icon: 'headphones', label: 'GUEST' },
    timer: { icon: 'clock', label: 'TIMER' },
    score: { icon: 'grid', label: 'SCORE' },
    ticker: { icon: 'type', label: 'TICKER' },
    playlist: { icon: 'film', label: 'PLAYLIST' }
  };
  // กราฟิกที่วาดบนพื้นโปร่งใส (ซ้อนเป็น Overlay ได้ทันที)
  const GRAPHIC_TYPES = ['title', 'timer', 'score', 'ticker'];
  const clockOf = inp => inp.type === 'timer' ? inp.timer : inp.type === 'score' && inp.score.clock && inp.score.clock.mode !== 'none' ? inp.score.clock : null;
  const scoreClockText = inp => { const c = clockOf(inp); return inp.type === 'score' && c ? timerText(c).text : ''; };
  // วาดกราฟิกลงพื้นที่ w×h (ไม่มีพื้นหลัง)
  function drawGraphic(ctx, inp, w, h) {
    if (inp.type === 'title') drawTitleInput(ctx, inp, w, h);
    else if (inp.type === 'timer') drawTimer(ctx, w, h, inp);
    else if (inp.type === 'score') drawScore(ctx, w, h, inp, scoreClockText(inp));
    else if (inp.type === 'ticker') drawTicker(ctx, w, h, inp);
  }
  const LIVE_TYPES = ['camera', 'screen', 'wireless'];

  /* ------------------------------------------------------------- drawing */







  function drawSource(ctx, inp, w, h) {
    if (!inp) { fillBlack(ctx, w, h); return; }
    ctx.save();
    switch (inp.type) {
      case 'bars': drawBars(ctx, w, h); break;
      case 'black': fillBlack(ctx, w, h); break;
      case 'slate': drawSlate(ctx, w, h, inp); break;
      case 'clock': drawClock(ctx, w, h, inp); break;
      case 'title': case 'timer': case 'score': case 'ticker': fillBlack(ctx, w, h); drawGraphic(ctx, inp, w, h); break;
      case 'image':
        if (inp.status !== 'live') { drawNoSignal(ctx, w, h, inp); break; }
        fillBlack(ctx, w, h);
        drawFit(ctx, inp.el, inp.el.naturalWidth, inp.el.naturalHeight, w, h);
        break;
      case 'playlist':
        if (inp.showImg) { fillBlack(ctx, w, h); drawFit(ctx, inp.showImg, inp.showImg.naturalWidth, inp.showImg.naturalHeight, w, h); break; }
        // falls through — รายการปัจจุบันเป็นวิดีโอ
      default: {
        const v = inp.el;
        if (inp.status === 'live' && v && v.readyState >= 2 && v.videoWidth) {
          fillBlack(ctx, w, h);
          drawFit(ctx, v, v.videoWidth, v.videoHeight, w, h);
        } else {
          drawNoSignal(ctx, w, h, inp);
        }
      }
    }
    ctx.restore();
  }

  function drawProgramBase(ctx, w, h) {
    const A = byId(state.programId), B = byId(state.previewId);
    const p = tr.auto ? easeInOut(tr.progress) : tr.progress;
    if (p <= 0 || !B || A === B) { drawSource(ctx, A, w, h); return; }
    if (settings.transition === 'dip') {
      if (p < 0.5) { drawSource(ctx, A, w, h); ctx.fillStyle = `rgba(0,0,0,${p * 2})`; }
      else { drawSource(ctx, B, w, h); ctx.fillStyle = `rgba(0,0,0,${(1 - p) * 2})`; }
      ctx.fillRect(0, 0, w, h);
    } else if (settings.transition === 'wipe') {
      drawSource(ctx, A, w, h);
      const x = w * p;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, x, h); ctx.clip();
      drawSource(ctx, B, w, h);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillRect(x - w / 640, 0, w / 320, h);
    } else {
      // วาดภาพ B (รวมพื้นดำ/ขอบดำของมัน) แยกก่อน แล้วผสมทั้งภาพทีเดียว — ถ้าวาดตรงด้วย globalAlpha
      // พื้นดำของ B จะถูกผสมด้วย ทำให้ภาพกลางทรานซิชันมืดลงผิดปกติ
      if (mixCanvas.width !== w || mixCanvas.height !== h) { mixCanvas.width = w; mixCanvas.height = h; }
      drawSource(mixCtx, B, w, h);
      drawSource(ctx, A, w, h);
      ctx.globalAlpha = p;
      ctx.drawImage(mixCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
  }
  const mixCanvas = document.createElement('canvas');
  const mixCtx = mixCanvas.getContext('2d');

  // คีย์ฉากเขียวด้วย GPU (WebGL) ที่ความละเอียดสูงสุด 1080p จึงคมพอสำหรับงาน 4K และไม่กิน CPU
  const keyer = createKeyer();
  const keySrc = document.createElement('canvas');
  const keySrcCtx = keySrc.getContext('2d');
  const keyOut = document.createElement('canvas');
  const keyOutCtx = keyOut.getContext('2d');

  function updateKeyFrame() {
    overlays.key.ready = false;
    if (!overlays.key.on) return;
    const src = byId(overlays.key.sourceId);
    if (!src) return;
    if (keyer) {
      const kw = Math.min(W, 1920), kh = Math.round(kw * 9 / 16);
      if (keySrc.width !== kw) { keySrc.width = kw; keySrc.height = kh; }
      drawSource(keySrcCtx, src, kw, kh);
      if (keyer.run(keySrc, settings.key)) {
        // คัดลอกออกมา เพราะ Overlay ที่เปิดคีย์ใช้ตัวคีย์ WebGL ตัวเดียวกันในเฟรมเดียวกัน
        if (keyOut.width !== kw || keyOut.height !== kh) { keyOut.width = kw; keyOut.height = kh; }
        keyOutCtx.clearRect(0, 0, kw, kh);
        keyOutCtx.drawImage(keyer.canvas, 0, 0);
        overlays.key.canvas = keyOut;
        overlays.key.ready = true;
        return;
      }
    }
    drawSource(keyCtx, src, 640, 360);
    const img = keyCtx.getImageData(0, 0, 640, 360);
    const d = img.data;
    const hard = settings.key.tolerance, soft = hard * 0.5;
    const blue = settings.key.color === 'blue';
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const keyCh = blue ? b : g;
      const other = blue ? Math.max(r, g) : Math.max(r, b);
      const diff = keyCh - other;
      if (diff <= 0) continue;
      if (diff > hard) d[i + 3] = 0;
      else if (diff > soft) d[i + 3] = 255 * (hard - diff) / (hard - soft);
      // ลดเงาสีเขียว/ฟ้าที่ติดขอบวัตถุ (spill suppression)
      if (blue) d[i + 2] = other; else d[i + 1] = other;
    }
    keyCtx.putImageData(img, 0, 0);
    overlays.key.canvas = keyCanvas;
    overlays.key.ready = true;
  }

  function pipRect(w, h) {
    const s = +settings.pip.size, pw = w * s, ph = h * s, m = w * 0.03;
    const pos = settings.pip.position;
    return { x: pos[1] === 'l' ? m : w - pw - m, y: pos[0] === 't' ? m : h - ph - m, w: pw, h: ph };
  }


  function drawOverlays(ctx, w, h) {
    if (overlays.key.on && overlays.key.ready) ctx.drawImage(overlays.key.canvas, 0, 0, w, h);
    if (overlays.pip.on) {
      const src = byId(overlays.pip.sourceId);
      if (src) {
        const r = pipRect(w, h), s = h / 720;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24 * s;
        ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.restore();
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.translate(r.x, r.y);
        drawSource(ctx, src, r.w, r.h);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3 * s;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    if (overlays.title.anim > 0) drawTitle(ctx, w, h, overlays.title.anim, settings.title);
  }


  /* ------------------------------------------------------- overlay channels (แบบ vMix)
     Overlay 1–8 วางแหล่งภาพใดก็ได้ซ้อนบน Program โดยไม่กระทบการตัดภาพหลัก (8 อยู่บนสุด)
     แต่ละแหล่งภาพมี "ตำแหน่ง" ของตัวเอง: ตำแหน่ง ขนาด ครอป ความทึบ คีย์ฉากเขียว/ฟ้า และขอบ
     แต่ละช่องเลือกเอฟเฟกต์เข้า-ออกได้ (Cut, Fade, Zoom, Slide, Wipe) และพักไว้ดูบน Preview ก่อนได้ */
  const OVL_EFFECTS = { cut: 'Cut', fade: 'Fade', zoom: 'Zoom', 'slide-left': 'Slide ←', 'slide-right': 'Slide →', 'slide-up': 'Slide ↑', 'slide-down': 'Slide ↓', wipe: 'Wipe' };
  const OVL_DURATIONS = [250, 500, 1000, 2000];
  // คีย์ลัด: Q W E R = Overlay 1–4, Shift + Q W E R = Overlay 5–8
  const OVL_COUNT = 8;
  const OVL_KEYS = ['q', 'w', 'e', 'r'];
  const ovlKeyLabel = i => (i >= 4 ? '⇧' : '') + OVL_KEYS[i % 4].toUpperCase();
  const ovl = Array.from({ length: OVL_COUNT }, (_, i) => i).map(i => ({ n: i + 1, inputId: null, on: false, staged: false, anim: 0, effect: 'fade', duration: 500 }));
  const onOverlay = id => !!id && ovl.some(c => c.on && c.inputId === id);
  const isOnAir = id => !!id && (id === state.programId || onOverlay(id));

  const DEFAULT_LAYOUT = { x: 0.5, y: 0.5, scale: 1, crop: { l: 0, r: 0, t: 0, b: 0 }, opacity: 1, key: 'none', tolerance: 60, border: false };
  const layoutOf = inp => inp.layout || DEFAULT_LAYOUT;
  function sanitizeLayout(l) {
    if (!l || typeof l !== 'object') return null;
    const n = (v, a, b, d) => Number.isFinite(+v) ? clamp(+v, a, b) : d;
    const c = l.crop || {};
    return {
      x: n(l.x, -0.5, 1.5, 0.5), y: n(l.y, -0.5, 1.5, 0.5), scale: n(l.scale, 0.05, 1, 1),
      crop: { l: n(c.l, 0, 0.45, 0), r: n(c.r, 0, 0.45, 0), t: n(c.t, 0, 0.45, 0), b: n(c.b, 0, 0.45, 0) },
      opacity: n(l.opacity, 0, 1, 1), key: ['none', 'green', 'blue'].includes(l.key) ? l.key : 'none',
      tolerance: n(l.tolerance, 10, 150, 60), border: !!l.border
    };
  }
  const isDefaultLayout = l => JSON.stringify(l) === JSON.stringify(DEFAULT_LAYOUT);

  // กรอบของ Input ในเฟรม (ก่อนครอป) และส่วนที่มองเห็นหลังครอป
  function layoutRects(L, w, h) {
    const bw = w * L.scale, bh = h * L.scale;
    const box = { x: L.x * w - bw / 2, y: L.y * h - bh / 2, w: bw, h: bh };
    const vis = { x: box.x + bw * L.crop.l, y: box.y + bh * L.crop.t, w: bw * (1 - L.crop.l - L.crop.r), h: bh * (1 - L.crop.t - L.crop.b) };
    return { box, vis };
  }

  // วาดแหล่งภาพแบบพื้นหลังโปร่งใส (รูป PNG, วิดีโอที่มี alpha, Title) — ไม่มีสัญญาณก็ไม่วาดอะไรทับ Program
  function drawSourceT(ctx, inp, w, h) {
    switch (inp.type) {
      case 'title': case 'timer': case 'score': case 'ticker': drawGraphic(ctx, inp, w, h); return;
      case 'image': if (inp.status === 'live') drawFit(ctx, inp.el, inp.el.naturalWidth, inp.el.naturalHeight, w, h); return;
      case 'bars': case 'black': case 'slate': case 'clock': drawSource(ctx, inp, w, h); return;
      case 'playlist':
        if (inp.showImg) { drawFit(ctx, inp.showImg, inp.showImg.naturalWidth, inp.showImg.naturalHeight, w, h); return; }
        // falls through
      default: {
        const v = inp.el;
        if (inp.status === 'live' && v && v.readyState >= 2 && v.videoWidth) drawFit(ctx, v, v.videoWidth, v.videoHeight, w, h);
      }
    }
  }

  // คีย์ฉากเขียว/ฟ้าของ Input นั้น (คำนวณครั้งเดียวต่อเฟรม ใช้ได้ทั้ง Program และ Preview)
  const keyWork = document.createElement('canvas');
  const keyWorkCtx = keyWork.getContext('2d', { willReadFrequently: !keyer });
  function keyedCanvas(inp, L) {
    const kw = Math.max(64, Math.round(Math.min(W * L.scale, keyer ? 1920 : 640))), kh = Math.round(kw * 9 / 16);
    const cache = inp._key || (inp._key = { canvas: document.createElement('canvas'), frame: -1 });
    if (cache.frame === frameNo && cache.canvas.width === kw) return cache.canvas;
    if (keyWork.width !== kw || keyWork.height !== kh) { keyWork.width = kw; keyWork.height = kh; }
    keyWorkCtx.clearRect(0, 0, kw, kh);
    drawSourceT(keyWorkCtx, inp, kw, kh);
    const out = cache.canvas;
    if (out.width !== kw || out.height !== kh) { out.width = kw; out.height = kh; }
    const octx = out.getContext('2d');
    octx.clearRect(0, 0, kw, kh);
    if (keyer && keyer.run(keyWork, { tolerance: L.tolerance, color: L.key })) {
      octx.drawImage(keyer.canvas, 0, 0);
    } else {
      const img = keyWorkCtx.getImageData(0, 0, kw, kh), d = img.data;
      const hard = L.tolerance, soft = hard * 0.5, blue = L.key === 'blue';
      for (let i = 0; i < d.length; i += 4) {
        const k = blue ? d[i + 2] : d[i + 1], o = blue ? Math.max(d[i], d[i + 1]) : Math.max(d[i], d[i + 2]), diff = k - o;
        if (diff <= 0) continue;
        d[i + 3] = diff > hard ? 0 : diff > soft ? Math.min(d[i + 3], 255 * (hard - diff) / (hard - soft)) : d[i + 3];
        if (blue) d[i + 2] = o; else d[i + 1] = o;
      }
      octx.putImageData(img, 0, 0);
    }
    cache.frame = frameNo;
    return out;
  }

  // วาด Input ตามตำแหน่ง/ครอป/คีย์ของมัน
  function drawLayout(ctx, inp, L, w, h) {
    const { box, vis } = layoutRects(L, w, h);
    if (vis.w <= 0 || vis.h <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(vis.x, vis.y, vis.w, vis.h); ctx.clip();
    if (L.key !== 'none') ctx.drawImage(keyedCanvas(inp, L), box.x, box.y, box.w, box.h);
    else { ctx.translate(box.x, box.y); drawSourceT(ctx, inp, box.w, box.h); }
    ctx.restore();
    if (L.border && L.scale < 1) {
      ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = Math.max(1, 3 * h / 720);
      ctx.strokeRect(vis.x, vis.y, vis.w, vis.h);
    }
  }

  function drawOverlayChannel(ctx, c, w, h, a) {
    const inp = byId(c.inputId);
    if (!inp || a <= 0) return;
    const L = layoutOf(inp), e = c.effect === 'cut' ? 1 : easeInOut(a);
    const { vis } = layoutRects(L, w, h);
    ctx.save();
    let alpha = L.opacity;
    switch (c.effect) {
      case 'fade': alpha *= e; break;
      case 'zoom': {
        const cx = vis.x + vis.w / 2, cy = vis.y + vis.h / 2, k = 0.5 + 0.5 * e;
        ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
        alpha *= e;
        break;
      }
      case 'slide-left': ctx.translate((1 - e) * (w - vis.x), 0); break;
      case 'slide-right': ctx.translate(-(1 - e) * (vis.x + vis.w), 0); break;
      case 'slide-up': ctx.translate(0, (1 - e) * (h - vis.y)); break;
      case 'slide-down': ctx.translate(0, -(1 - e) * (vis.y + vis.h)); break;
      case 'wipe': ctx.beginPath(); ctx.rect(vis.x, vis.y, vis.w * e, vis.h); ctx.clip(); break;
    }
    ctx.globalAlpha = alpha;
    drawLayout(ctx, inp, L, w, h);
    ctx.restore();
  }

  function stepOverlays(dt) {
    for (const c of ovl) {
      const target = c.on && byId(c.inputId) ? 1 : 0;
      if (c.anim === target) continue;
      if (c.effect === 'cut') { c.anim = target; continue; }
      const step = dt / c.duration;
      c.anim = target > c.anim ? Math.min(1, c.anim + step) : Math.max(0, c.anim - step);
    }
  }

  function drawOverlayChannels(ctx, w, h, preview) {
    for (const c of ovl) {
      if (c.anim > 0) drawOverlayChannel(ctx, c, w, h, c.anim);
      else if (preview && c.staged && byId(c.inputId)) drawOverlayChannel(ctx, c, w, h, 1);
    }
  }



  /* ------------------------------------------------------- GPU compositor (WebGL)
     วาด Program/Preview ด้วยการ์ดจอ: วิดีโอส่งเป็น texture ตรง ๆ, คีย์ฉากเขียว/ครอป/ความทึบทำใน shader ครั้งเดียว
     จึงลื่นกว่า Canvas 2D มากที่ 4K และเมื่อซ้อน Overlay หลายชั้น — ภาพที่ได้คัดลอกไปที่ canvas เดิม
     (บันทึก/สตรีม/หน้าต่าง Output/ภาพนิ่งทำงานเหมือนเดิม) ถ้าเครื่องไม่มี WebGL หรือ GPU ล่ม ใช้ Canvas 2D แทนอัตโนมัติ */
  const gpu = createGpu();

  // ใช้ GPU หรือ Canvas 2D: auto = GPU ถ้ามีการ์ดจอจริง (ไม่ใช่ GPU จำลองด้วยซอฟต์แวร์)
  const renderer = {
    active: 'cpu',
    resolve() {
      const want = settings.renderer;
      this.active = !gpu || !gpu.ok || want === 'cpu' ? 'cpu' : want === 'gpu' ? 'gpu' : gpu.software ? 'cpu' : 'gpu';
      return this.active;
    },
    label() { return this.active === 'gpu' ? 'GPU' : 'CPU'; }
  };

  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
  };
  const fitRect = (sw, sh, box) => {
    const k = Math.min(box.w / sw, box.h / sh), w = sw * k, h = sh * k;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  };

  // แหล่งภาพที่วาดด้วย 2D (Bars, Slate, นาฬิกา, Title, NO SIGNAL) วาดใหม่เฉพาะเมื่อเนื้อหาเปลี่ยน แล้วส่งขึ้น GPU
  const genCanvases = new Map();
  function genTexture(key, stamp, w, h, draw) {
    const e = gpu.entry(key);
    if (e.stamp === stamp && e.w === w && e.h === h) return e;
    let c = genCanvases.get(key);
    if (!c) { c = document.createElement('canvas'); genCanvases.set(key, c); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
    gpu.upload(e, c, w, h);
    e.stamp = stamp;
    return e;
  }

  // texture ของ Input: คืน { e, full } (full = ภาพเต็มเฟรม 16:9) หรือ null ถ้าไม่มีอะไรให้วาด
  function inputTexture(inp, transparent) {
    const sec = Math.floor(Date.now() / 1000);
    const GW = Math.min(W, 1920), GH = Math.round(GW * 9 / 16);
    const noSignal = () => transparent ? null
      : { e: genTexture('ns:' + inp.id, `${inp.name}|${inp.srtState}|${inp.missing}|${inp.status}`, GW, GH, (c, w, h) => drawNoSignal(c, w, h, inp)), full: true };
    switch (inp.type) {
      case 'black': return transparent ? { solid: [0, 0, 0, 1] } : { solid: [0, 0, 0, 1] };
      case 'bars': return { e: genTexture('g:' + inp.id, 'bars', GW, GH, drawBars), full: true };
      case 'slate': case 'clock':
        return { e: genTexture('g:' + inp.id, `${inp.text}|${sec}`, GW, GH, (c, w, h) => drawSource(c, inp, w, h)), full: true };
      case 'title':
        return { e: genTexture('g:' + inp.id, JSON.stringify(inp.title), W, H, (c, w, h) => drawTitleInput(c, inp, w, h)), full: true, under: transparent ? null : [0, 0, 0, 1] };
      case 'timer': {
        // วาดใหม่เมื่อตัวเลขเปลี่ยน (ทุกวินาที) หรือช่วงกะพริบตอนหมดเวลา
        const tt = timerText(inp.timer), stamp = `${tt.text}|${tt.done ? Math.floor(Date.now() / 500) % 2 : ''}|${JSON.stringify(inp.timer)}`;
        return { e: genTexture('g:' + inp.id, stamp, W, H, (c, w, h) => drawTimer(c, w, h, inp)), full: true, under: transparent ? null : [0, 0, 0, 1] };
      }
      case 'score':
        return { e: genTexture('g:' + inp.id, `${scoreClockText(inp)}|${JSON.stringify(inp.score)}`, W, H, (c, w, h) => drawScore(c, w, h, inp, scoreClockText(inp))), full: true, under: transparent ? null : [0, 0, 0, 1] };
      case 'ticker': {
        // ตัววิ่งเลื่อนทุกเฟรม: วาดและส่งขึ้น GPU เฉพาะแถบ ไม่ใช่ทั้งจอ
        const bh = Math.round(H * TICKER_BAR.h);
        return { e: genTexture('g:' + inp.id, frameNo, W, bh, (c, w, h) => drawTickerBar(c, w, h, inp)), region: TICKER_BAR, under: transparent ? null : [0, 0, 0, 1] };
      }
      case 'image': {
        if (inp.status !== 'live' || !inp.el.naturalWidth) return noSignal();
        const e = gpu.entry('i:' + inp.id);
        if (e.stamp !== inp.el.src) { gpu.upload(e, inp.el, inp.el.naturalWidth, inp.el.naturalHeight); e.stamp = inp.el.src; }
        return { e };
      }
      case 'playlist':
        if (inp.showImg) {
          if (!inp.showImg.naturalWidth) return noSignal();
          const e = gpu.entry('pi:' + inp.id);
          if (e.stamp !== inp.showImg.src) { gpu.upload(e, inp.showImg, inp.showImg.naturalWidth, inp.showImg.naturalHeight); e.stamp = inp.showImg.src; }
          return { e };
        }
        // falls through
      default: {
        const v = inp.el;
        if (!(inp.status === 'live' && v && v.readyState >= 2 && v.videoWidth)) return noSignal();
        const e = gpu.entry('v:' + inp.id);
        if (e.frame !== frameNo) { if (!gpu.upload(e, v, v.videoWidth, v.videoHeight)) return noSignal(); e.frame = frameNo; }
        return { e };
      }
    }
  }

  // วาด Input ให้พอดีกรอบ box โดยแสดงเฉพาะส่วนที่อยู่ใน clip
  function glDrawInput(inp, box, clip, alpha = 1, opts = {}) {
    if (!inp) return;
    const t = inputTexture(inp, !!opts.transparent);
    if (!t) return;
    const vis = intersect(box, clip);
    if (vis.w <= 0 || vis.h <= 0) return;
    if (t.solid) { gpu.solid(vis, t.solid, alpha); return; }
    if (t.under) gpu.solid(vis, t.under, alpha);
    const f = t.region ? { x: box.x, y: box.y + box.h * t.region.y, w: box.w, h: box.h * t.region.h } : t.full ? box : fitRect(t.e.w, t.e.h, box);
    const r = intersect(f, clip);
    if (r.w <= 0 || r.h <= 0) return;
    gpu.quad(t.e, r, [(r.x - f.x) / f.w, (r.y - f.y) / f.h, (r.x + r.w - f.x) / f.w, (r.y + r.h - f.y) / f.h], alpha, opts.key || null);
  }

  function glProgramBase(w, h) {
    const full = { x: 0, y: 0, w, h };
    const A = byId(state.programId), B = byId(state.previewId);
    const p = tr.auto ? easeInOut(tr.progress) : tr.progress;
    if (p <= 0 || !B || A === B) { glDrawInput(A, full, full); return; }
    if (settings.transition === 'dip') {
      if (p < 0.5) { glDrawInput(A, full, full); gpu.solid(full, [0, 0, 0, 1], p * 2); }
      else { glDrawInput(B, full, full); gpu.solid(full, [0, 0, 0, 1], (1 - p) * 2); }
    } else if (settings.transition === 'wipe') {
      glDrawInput(A, full, full);
      glDrawInput(B, full, { x: 0, y: 0, w: w * p, h });
      gpu.solid({ x: w * p - w / 640, y: 0, w: w / 320, h }, [1, 1, 1, 0.9]);
    } else {
      glDrawInput(A, full, full);
      glDrawInput(B, full, full, p);
    }
  }

  // Overlay ตามตำแหน่ง/ครอป/คีย์ของ Input พร้อมเอฟเฟกต์เข้า-ออก (เหมือน drawOverlayChannel)
  function glOverlayChannel(c, w, h, a) {
    const inp = byId(c.inputId);
    if (!inp || a <= 0) return;
    const L = layoutOf(inp), e = c.effect === 'cut' ? 1 : easeInOut(a);
    let { box, vis } = layoutRects(L, w, h);
    let alpha = L.opacity;
    const move = (dx, dy) => { box = { ...box, x: box.x + dx, y: box.y + dy }; vis = { ...vis, x: vis.x + dx, y: vis.y + dy }; };
    switch (c.effect) {
      case 'fade': alpha *= e; break;
      case 'zoom': {
        const cx = vis.x + vis.w / 2, cy = vis.y + vis.h / 2, k = 0.5 + 0.5 * e;
        const sc = r => ({ x: cx + (r.x - cx) * k, y: cy + (r.y - cy) * k, w: r.w * k, h: r.h * k });
        box = sc(box); vis = sc(vis); alpha *= e;
        break;
      }
      case 'slide-left': move((1 - e) * (w - vis.x), 0); break;
      case 'slide-right': move(-(1 - e) * (vis.x + vis.w), 0); break;
      case 'slide-up': move(0, (1 - e) * (h - vis.y)); break;
      case 'slide-down': move(0, -(1 - e) * (vis.y + vis.h)); break;
      case 'wipe': vis = { ...vis, w: vis.w * e }; break;
    }
    glDrawInput(inp, box, vis, alpha, { transparent: true, key: L.key !== 'none' ? { color: L.key, tolerance: L.tolerance } : null });
    if (L.border && L.scale < 1) {
      const t = Math.max(1, 3 * h / 720), col = [1, 1, 1, 0.92];
      gpu.solid({ x: vis.x - t / 2, y: vis.y - t / 2, w: vis.w + t, h: t }, col, alpha);
      gpu.solid({ x: vis.x - t / 2, y: vis.y + vis.h - t / 2, w: vis.w + t, h: t }, col, alpha);
      gpu.solid({ x: vis.x - t / 2, y: vis.y, w: t, h: vis.h }, col, alpha);
      gpu.solid({ x: vis.x + vis.w - t / 2, y: vis.y, w: t, h: vis.h }, col, alpha);
    }
  }

  // TITLE / PIP / KEY แบบเดิม
  function glClassicOverlays(w, h) {
    const full = { x: 0, y: 0, w, h };
    if (overlays.key.on) {
      const src = byId(overlays.key.sourceId);
      if (src) glDrawInput(src, full, full, 1, { key: settings.key });
    }
    if (overlays.pip.on) {
      const src = byId(overlays.pip.sourceId);
      if (src) {
        const r = pipRect(w, h), s = h / 720, b = 3 * s;
        gpu.solid({ x: r.x - 6 * s, y: r.y + 2 * s, w: r.w + 12 * s, h: r.h + 12 * s }, [0, 0, 0, 0.35]);
        gpu.solid(r, [0, 0, 0, 1]);
        glDrawInput(src, r, r);
        const col = [1, 1, 1, 0.9];
        gpu.solid({ x: r.x - b / 2, y: r.y - b / 2, w: r.w + b, h: b }, col);
        gpu.solid({ x: r.x - b / 2, y: r.y + r.h - b / 2, w: r.w + b, h: b }, col);
        gpu.solid({ x: r.x - b / 2, y: r.y, w: b, h: r.h }, col);
        gpu.solid({ x: r.x + r.w - b / 2, y: r.y, w: b, h: r.h }, col);
      }
    }
    if (overlays.title.anim > 0) {
      const e = genTexture('title:main', `${overlays.title.anim.toFixed(3)}|${JSON.stringify(settings.title)}`, W, H, (c, cw, ch) => drawTitle(c, cw, ch, overlays.title.anim, settings.title));
      gpu.quad(e, full, [0, 0, 1, 1]);
    }
  }

  function gpuFrame() {
    gpu.ensureSize(W, H);
    // Preview ก่อน (พื้นที่เล็ก) แล้วคัดลอกออก จากนั้นวาด Program เต็มขนาด
    gpu.begin(PW, PH);
    const pfull = { x: 0, y: 0, w: PW, h: PH };
    glDrawInput(byId(state.previewId), pfull, pfull);
    for (const c of ovl) {
      if (c.anim > 0) glOverlayChannel(c, PW, PH, c.anim);
      else if (c.staged && byId(c.inputId)) glOverlayChannel(c, PW, PH, 1);
    }
    glClassicOverlays(PW, PH);
    pvwCtx.drawImage(gpu.canvas, 0, 0, PW, PH, 0, 0, PW, PH);

    gpu.begin(W, H);
    glProgramBase(W, H);
    for (const c of ovl) if (c.anim > 0) glOverlayChannel(c, W, H, c.anim);
    glClassicOverlays(W, H);
    if (ftb.level > 0) gpu.solid({ x: 0, y: 0, w: W, h: H }, [0, 0, 0, 1], ftb.level);
    pgmCtx.drawImage(gpu.canvas, 0, 0);
  }

  /* ----------------------------------------------------------- render loop */
  const thumbs = new Map();
  let lastFrame = 0, lastThumbs = 0, frameCount = 0, fps = 0, fpsSince = performance.now(), renderMs = 0, frameNo = 0;

  function frame(now) {
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
    lastFrame = now;
    const t0 = performance.now();
    frameNo++;

    stepTransition(now);
    stepOverlays(dt);
    if (ftb.level !== ftb.target) {
      const step = dt / settings.duration;
      ftb.level = ftb.target > ftb.level ? Math.min(ftb.target, ftb.level + step) : Math.max(ftb.target, ftb.level - step);
    }
    const tTarget = overlays.title.on ? 1 : 0;
    if (overlays.title.anim !== tTarget) {
      const step = dt / 450;
      overlays.title.anim = tTarget > overlays.title.anim ? Math.min(1, overlays.title.anim + step) : Math.max(0, overlays.title.anim - step);
    }

    let drawn = false;
    if (renderer.active === 'gpu') {
      if (gpu.ok) {
        try { gpuFrame(); drawn = true; } catch (e) { console.warn('GPU render failed', e); }
      }
      if (!drawn) {
        // GPU ล่ม (เช่นไดรเวอร์รีเซ็ต) — สลับไปวาดด้วย CPU ทันทีโดยภาพไม่ดับ
        renderer.active = 'cpu';
        toast('ระบบวาดภาพด้วย GPU หยุดทำงาน — สลับไปใช้ CPU แล้ว', 'warn', 6000);
        updateStatus();
      }
    }
    if (!drawn) {
      updateKeyFrame();
      drawProgramBase(pgmCtx, W, H);
      drawOverlayChannels(pgmCtx, W, H, false);
      drawOverlays(pgmCtx, W, H);
      if (ftb.level > 0) { pgmCtx.fillStyle = `rgba(0,0,0,${ftb.level})`; pgmCtx.fillRect(0, 0, W, H); }

      drawSource(pvwCtx, byId(state.previewId), PW, PH);
      drawOverlayChannels(pvwCtx, PW, PH, true);
      drawOverlays(pvwCtx, PW, PH);
    }

    if (now - lastThumbs > 100) {
      lastThumbs = now;
      for (const inp of inputs) {
        const ctx = thumbs.get(inp.id);
        if (ctx) drawSource(ctx, inp, ctx.canvas.width, ctx.canvas.height);
      }
    }
    audio.tick(now);

    renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
    frameCount++;
    if (now - fpsSince >= 1000) { fps = frameCount * 1000 / (now - fpsSince); frameCount = 0; fpsSince = now; }
  }

  // แสดงผลด้วย requestAnimationFrame ตอนหน้าเปิดอยู่ และใช้ Worker จับเวลาแทนตอนสลับแท็บ
  // (เบราว์เซอร์หยุด rAF ในแท็บที่ซ่อน ภาพที่บันทึก/สตรีมจะค้างถ้าไม่ทำแบบนี้)
  const ticker = {
    worker: null,
    init() {
      try {
        const src = 'let id;onmessage=e=>{clearInterval(id);id=setInterval(()=>postMessage(0),e.data)}';
        this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        this.worker.onmessage = () => { if (document.hidden) frame(performance.now()); };
      } catch (e) { this.worker = null; }
    },
    setRate(f) { if (this.worker) this.worker.postMessage(1000 / f); }
  };
  function rafLoop(now) {
    if (!document.hidden && now - lastFrame >= 1000 / 61) frame(now);
    requestAnimationFrame(rafLoop);
  }

  /* ----------------------------------------------------------- switching */
  const tbar = { set() {} };

  function setPreview(id) {
    if (!byId(id)) return;
    state.previewId = id;
    updateTally();
  }

  function swapBuses() {
    const p = state.programId;
    state.programId = state.previewId;
    state.previewId = p;
  }

  function cut() {
    if (!byId(state.previewId)) return;
    tr.auto = false;
    tr.progress = 0;
    swapBuses();
    tbar.set(tr.base);
    $('[data-action="auto"]').classList.remove('is-running');
    updateTally();
  }

  function autoTransition() {
    if (tr.auto || !byId(state.previewId) || state.previewId === state.programId) return;
    tr.auto = true;
    tr.start = performance.now();
    tr.from = tr.progress;
    $('[data-action="auto"]').classList.add('is-running');
    audio.applyAfv();
  }

  function stepTransition(now) {
    if (!tr.auto) return;
    const p = tr.from + (now - tr.start) / settings.duration;
    if (p >= 1) completeTransition();
    else { tr.progress = p; tbar.set(tr.base === 0 ? p * 100 : 100 - p * 100); }
  }

  function completeTransition() {
    swapBuses();
    tr.auto = false;
    tr.progress = 0;
    tr.base = tr.base === 0 ? 100 : 0;
    tbar.set(tr.base);
    $('[data-action="auto"]').classList.remove('is-running');
    updateTally();
  }

  function onTbar(v) {
    if (tr.auto) { tr.auto = false; $('[data-action="auto"]').classList.remove('is-running'); }
    const was = tr.progress;
    tr.progress = clamp(tr.base === 0 ? v / 100 : (100 - v) / 100, 0, 1);
    if (tr.progress >= 0.999) completeTransition();
    else if ((was > 0) !== (tr.progress > 0)) audio.applyAfv();
  }

  function toggleFtb() {
    ftb.target = ftb.target ? 0 : 1;
    $('#btn-ftb').classList.toggle('is-on', !!ftb.target);
  }

  function setOverlay(name, on) {
    const o = overlays[name];
    if (on && name !== 'title' && !byId(o.sourceId)) {
      toast(name === 'pip' ? 'เลือกแหล่งภาพสำหรับ PIP ก่อน' : 'เลือกแหล่งภาพสำหรับ KEY ก่อน', 'warn');
      return;
    }
    o.on = on;
    $(`#btn-${name}`).classList.toggle('is-on', on);
    $(`#btn-${name}`).firstChild.textContent = `${on ? 'CLEAR' : 'TAKE'} ${name.toUpperCase()}`;
    $(`.tab[data-tab="${name}"]`).classList.toggle('is-live', on);
  }

  function updateTally() {
    const pgm = byId(state.programId), pvw = byId(state.previewId);
    $('#pgm-name').textContent = pgm ? pgm.name : '—';
    $('#pvw-name').textContent = pvw ? pvw.name : '—';
    for (const card of $$('#inputs-grid .card')) {
      const id = card.dataset.id;
      const isPgm = id === state.programId, isPvw = id === state.previewId && !isPgm;
      const ovIdx = ovl.findIndex(c => c.on && c.inputId === id);
      card.classList.toggle('is-pgm', isPgm);
      card.classList.toggle('is-pvw', isPvw);
      card.classList.toggle('is-ovl', !isPgm && ovIdx >= 0);
      card.querySelector('.card-tally').textContent = isPgm ? 'PGM' : ovIdx >= 0 ? `OV${ovIdx + 1}` : isPvw ? 'PVW' : '';
      card.querySelectorAll('[data-card-ovl]').forEach(b => {
        const c = ovl[+b.dataset.cardOvl];
        b.classList.toggle('is-on', c.on && c.inputId === id);
        b.classList.toggle('is-staged', !c.on && c.staged && c.inputId === id);
      });
    }
    audio.applyAfv();
    wireless.sendTally();
  }

  /* -------------------------------------------------------------- inputs */
  const pool = $('#media-pool');

  function addInput(props) {
    const inp = { id: uid(), status: 'live', text: '', ...props };
    inputs.push(inp);
    if (!byId(state.programId)) state.programId = inp.id;
    else if (!byId(state.previewId)) state.previewId = inp.id;
    renderInputs();
    refreshSourceSelects();
    return inp;
  }

  function createVideo(stream) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true;
    v.srcObject = stream;
    pool.appendChild(v);
    v.play().catch(() => {});
    return v;
  }

  function watchTracks(inp) {
    for (const t of inp.stream.getVideoTracks()) {
      t.addEventListener('ended', () => {
        if (inp.stream && inp.stream.getVideoTracks().includes(t)) setInputStatus(inp, 'nosignal');
      });
    }
  }

  function addStreamInput(stream, props) {
    const inp = addInput({ ...props, el: createVideo(stream), stream });
    watchTracks(inp);
    audio.addStream(inp, stream);
    return inp;
  }

  function setInputStatus(inp, status) {
    if (inp.status === status) return;
    inp.status = status;
    const card = $(`#inputs-grid .card[data-id="${inp.id}"]`);
    if (card) {
      card.classList.toggle('no-signal', status !== 'live');
      card.querySelector('.card-sub').textContent = cardSub(inp);
    }
  }

  function addGenerator(type) {
    const defs = {
      bars: { name: 'COLOR BARS' },
      black: { name: 'BLACK' },
      slate: { name: 'SLATE', text: 'กลับมาพบกันในอีกสักครู่' },
      clock: { name: 'CLOCK', text: 'WEBMIX PRO STUDIO' }
    };
    return addInput({ type, ...defs[type] });
  }

  // ขนาดการ์ดแหล่งภาพ (เล็ก/กลาง/ใหญ่) — จำไว้ในเครื่องนี้
  const THUMB_SIZE = { s: [256, 144], m: [384, 216], l: [512, 288] };
  const cardSize = () => { const v = store.get('cardSize', 'm'); return THUMB_SIZE[v] ? v : 'm'; };
  function setCardSize(v) {
    if (!THUMB_SIZE[v]) return;
    store.set('cardSize', v);
    document.documentElement.dataset.cards = v;
    $$('#seg-cardsize button').forEach(b => b.classList.toggle('is-active', b.dataset.size === v));
    renderInputs();
  }

  function renderInputs() {
    queueMicrotask(renderQuickGfx);
    const grid = $('#inputs-grid');
    grid.innerHTML = '';
    thumbs.clear();
    $('#input-count').textContent = inputs.length;
    if (!inputs.length) {
      grid.innerHTML = '<div class="empty-state">ยังไม่มีแหล่งภาพ — กด “เพิ่มแหล่งภาพ” เพื่อเพิ่มกล้อง ไฟล์วิดีโอ หรือแหล่งภาพอื่น</div>';
    }
    // ขนาดการ์ด: ภาพตัวอย่างละเอียดขึ้นตามขนาด (ไม่เบลอเมื่อการ์ดใหญ่)
    const [tw, th] = THUMB_SIZE[cardSize()];
    // จอสัมผัส: ปุ่มแก้ไข/ลบ อยู่แถวชื่อใต้ภาพ — แตะตรงภาพได้ทั้งภาพโดยไม่โดนปุ่ม
    const touch = matchMedia('(hover: none)').matches;
    const editBtns = `<button class="mini" data-card="rename" title="แก้ไขชื่อ / ข้อความ">${icon('edit')}</button><button class="mini danger" data-card="remove" title="ลบแหล่งภาพ">${icon('x')}</button>`;
    inputs.forEach((inp, i) => {
      const meta = TYPE_META[inp.type];
      const isMedia = inp.type === 'media' && !inp.missing;
      const canRelink = ['camera', 'screen', 'media', 'image'].includes(inp.type) && (inp.missing || inp.status !== 'live');
      const card = document.createElement('div');
      card.className = 'card' + (inp.status !== 'live' ? ' no-signal' : '');
      card.dataset.id = inp.id;
      card.innerHTML = `
        <div class="card-thumb">
          <canvas width="${tw}" height="${th}"></canvas>
          <span class="card-num">${i + 1}</span>
          <span class="card-tally"></span>
          ${inp.status !== 'live' ? `<span class="card-nosig">${icon('link')}${inp.type === 'wireless' || inp.type === 'guest' ? 'รอเชื่อมต่อ' : 'ไม่มีสัญญาณ'}</span>` : ''}
          <div class="card-actions">
            ${inp.type === 'playlist' && inp.list.items.length ? `
              <button class="mini txt" data-card="pprev" title="รายการก่อนหน้า">‹</button>
              <button class="mini ${inp.list.playing ? 'is-on' : ''}" data-card="pplay" title="เล่น / หยุดชั่วคราว">${icon(inp.list.playing ? 'pause' : 'play')}</button>
              <button class="mini txt" data-card="pnext" title="รายการถัดไป">›</button>
              <button class="mini ${inp.list.loop ? 'is-on' : ''}" data-card="ploop" title="เล่นวนซ้ำทั้งรายการ">${icon('repeat')}</button>` : ''}
            ${isMedia ? `
              <button class="mini" data-card="play" title="เล่น / หยุดชั่วคราว">${icon(inp.el.paused ? 'play' : 'pause')}</button>
              <button class="mini" data-card="restart" title="เล่นใหม่ตั้งแต่ต้น">${icon('restart')}</button>
              <button class="mini ${inp.el.loop ? 'is-on' : ''}" data-card="loop" title="เล่นวนซ้ำ">${icon('repeat')}</button>` : ''}
            ${canRelink ? `<button class="mini warn" data-card="relink" title="เชื่อมต่อแหล่งภาพนี้ใหม่">${icon('link')}</button>` : ''}
            ${inp.type === 'guest' ? `<button class="mini ${inp.status === 'live' ? '' : 'warn'}" data-card="invite" title="ลิงก์เชิญแขก">${icon('link')}</button>` : ''}
            ${inp.type === 'score' ? `
              <button class="mini txt" data-card="sa+" title="${esc(inp.score.teamA)} +1">A+</button><button class="mini txt" data-card="sa-" title="${esc(inp.score.teamA)} −1">A−</button>
              <button class="mini txt" data-card="sb+" title="${esc(inp.score.teamB)} +1">B+</button><button class="mini txt" data-card="sb-" title="${esc(inp.score.teamB)} −1">B−</button>` : ''}
            ${clockOf(inp) ? `
              <button class="mini ${clockOf(inp).running ? 'is-on' : ''}" data-card="tplay" title="เริ่ม / หยุดเวลา">${icon(clockOf(inp).running ? 'pause' : 'play')}</button>
              <button class="mini" data-card="treset" title="รีเซ็ตเวลา">${icon('restart')}</button>` : ''}
            ${inp.type === 'title' && inp.data && inp.data.rows && inp.data.rows.length > 1 ? `
              <button class="mini txt" data-card="dprev" title="แถวก่อนหน้า">‹</button><button class="mini txt" data-card="dnext" title="แถวถัดไป">›</button>` : ''}
            ${touch ? '' : editBtns}
          </div>
        </div>
        <div class="card-foot">${icon(meta.icon)}<span class="card-name">${esc(inp.name)}</span><span class="card-sub">${esc(cardSub(inp))}</span>${touch ? `<span class="foot-actions">${editBtns}</span>` : ''}</div>
        <div class="card-ovl">${ovl.map((c, k) => `<button type="button" data-card-ovl="${k}" title="ซ้อนเข้า Overlay ${c.n}">${c.n}</button>`).join('')}<button type="button" class="ovl-pos ${inp.layout ? 'is-set' : ''}" data-card="layout" title="ตำแหน่ง / ขนาด / ครอป / คีย์ฉาก">⧉</button></div>`;
      grid.appendChild(card);
      const ctx = card.querySelector('canvas').getContext('2d');
      thumbs.set(inp.id, ctx);
      drawSource(ctx, inp, tw, th);
    });
    updateTally();
  }

  let lastTap = { id: null, time: 0 };
  function onGridClick(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    const inp = byId(card.dataset.id);
    if (!inp) return;
    audio.ensure();
    const ovlBtn = e.target.closest('[data-card-ovl]');
    if (ovlBtn) { toggleInputOverlay(inp.id, +ovlBtn.dataset.cardOvl); return; }
    const actionBtn = e.target.closest('[data-card]');
    if (actionBtn) {
      const act = actionBtn.dataset.card;
      if (act === 'remove') removeInput(inp.id);
      else if (act === 'rename') renameInput(inp);
      else if (act === 'relink') relinkInput(inp);
      else if (act === 'layout') openLayoutDialog(inp);
      else if (act === 'invite') showGuestInvite(inp);
      else if (act === 'tplay' || act === 'treset') { timerControl(inp, act === 'tplay' ? 'toggle' : 'reset'); }
      else if (/^s[ab][+-]$/.test(act)) { const k = act[1] === 'a' ? 'scoreA' : 'scoreB'; inp.score[k] = Math.max(0, (+inp.score[k] || 0) + (act[2] === '+' ? 1 : -1)); }
      else if (act === 'dprev' || act === 'dnext') dataSources.step(inp, act === 'dnext' ? 1 : -1);
      else if (act === 'pprev' || act === 'pnext') playlist.go(inp, inp.list.index + (act === 'pnext' ? 1 : -1), true);
      else if (act === 'pplay') playlist.setPlaying(inp, !inp.list.playing);
      else if (act === 'ploop') { inp.list.loop = !inp.list.loop; renderInputs(); }
      else if (act === 'play') { inp.el.paused ? inp.el.play().catch(() => {}) : inp.el.pause(); }
      else if (act === 'restart') { inp.el.currentTime = 0; inp.el.play().catch(() => {}); }
      else if (act === 'loop') { inp.el.loop = !inp.el.loop; actionBtn.classList.toggle('is-on', inp.el.loop); }
      return;
    }
    // แตะสองครั้ง = ตัดเข้า Program (ตรวจจับเองเพราะ iOS ไม่ส่ง dblclick)
    const now = Date.now();
    const isDouble = lastTap.id === inp.id && now - lastTap.time < 350;
    lastTap = isDouble ? { id: null, time: 0 } : { id: inp.id, time: now };
    if (isDouble) {
      if (inp.id !== state.programId) { state.previewId = inp.id; cut(); }
    } else if (inp.id !== state.programId) {
      setPreview(inp.id);
    }
  }

  function updateMediaButtons(inp) {
    const btn = $(`#inputs-grid .card[data-id="${inp.id}"] [data-card="play"]`);
    if (btn) btn.innerHTML = icon(inp.el.paused ? 'play' : 'pause');
  }

  async function removeInput(id) {
    const inp = byId(id);
    if (!inp) return;
    const onAir = id === state.programId;
    const ok = await confirmDialog(`ลบ “${inp.name}”`,
      onAir ? 'แหล่งภาพนี้กำลังออกอากาศอยู่ใน Program — ภาพจะถูกเปลี่ยนเป็นแหล่งอื่นทันที' : 'ต้องการลบแหล่งภาพนี้ออกจากรายการหรือไม่',
      'ลบแหล่งภาพ');
    if (!ok || !byId(id)) return;
    // จำไว้ก่อนลบ เพื่อ "เลิกทำ" ได้ภายใน 10 วินาที (ไฟล์/ลิงก์มือถือยังไม่ถูกลบจริงจนหมดเวลา)
    const snap = show.serialize(true);
    const raw = snap.inputs.find(x => x.id === id);
    const was = { at: inputs.indexOf(inp), chan: snap.audio.inputs[id], pvw: state.previewId === id || onAir, ovl: ovl.map((c, i) => c.inputId === id ? i : -1).filter(i => i >= 0),
      pip: overlays.pip.sourceId === id, key: overlays.key.sourceId === id, data: inp.data ? { ...inp.data } : null };
    // มือถือ/แขก: ตัดการเชื่อมต่อทันที (ผู้ใช้ตั้งใจให้หลุด) — เลิกทำแล้วการ์ดกลับมารอให้เชื่อมต่อใหม่
    const hangUp = inp.type === 'wireless' || inp.type === 'guest';
    disposeInput(inp, hangUp);
    if (inp.type === 'srt') saveSrtInputs();
    resetAfterRemoval(id);
    renderInputs();
    refreshSourceSelects();
    let undone = false;
    const forgetLater = hangUp ? 0 : setTimeout(() => { if (!undone) forgetInput(inp); }, UNDO_MS + 1000);
    toast(`ลบ “${inp.name}” แล้ว`, 'info', UNDO_MS, { label: 'เลิกทำ', run: () => {
      if (undone || !raw) return;
      undone = true;
      clearTimeout(forgetLater);
      undoRemoveInput(raw, was);
    } });
  }
  const UNDO_MS = 10000;
  // ลบข้อมูลที่เก็บไว้ถาวร หลังหมดเวลาเลิกทำ
  function forgetInput(inp) {
    if (inp.peerId && inp.type === 'wireless') wireless.release(inp.peerId);
    if (inp.type === 'media' || inp.type === 'image') mediaStore.del(inp.id);
    if (inp.type === 'playlist') for (const it of inp.list.items) mediaStore.del(it.key);
  }
  function undoRemoveInput(raw, was) {
    if (byId(raw.id)) return;
    if (was.chan) audio.pending.set(raw.id, was.chan);
    try { show.restoreInput(raw, { id: raw.id, name: raw.name }); } catch (e) { toast('นำกลับมาไม่ได้: ' + e.message, 'error'); return; }
    const made = byId(raw.id);
    if (!made) return;
    inputs.splice(inputs.indexOf(made), 1);
    inputs.splice(Math.min(was.at, inputs.length), 0, made);
    if (raw.layout) made.layout = sanitizeLayout(raw.layout);
    if (was.data) made.data = { ...was.data };
    for (const i of was.ovl) if (!ovl[i].inputId) ovl[i].inputId = made.id;
    if (was.pip) overlays.pip.sourceId = made.id;
    if (was.key) overlays.key.sourceId = made.id;
    if (was.pvw && state.programId !== made.id) state.previewId = made.id;
    if (made.type === 'srt') saveSrtInputs();
    renderInputs();
    refreshSourceSelects();
    refreshOverlaySelects();
    renderMixer();
    updateOverlayUI();
    toast(`นำ “${made.name}” กลับมาแล้ว`, 'success', 2500);
  }

  // ปล่อยทรัพยากรของ Input (กล้อง, ไฟล์, การเชื่อมต่อ) แล้วนำออกจากรายการ
  function disposeInput(inp, forget) {
    inp.stream && inp.stream.getTracks().forEach(t => t.stop());
    if (inp.el && inp.el.tagName === 'VIDEO') {
      inp.el.pause();
      inp.el.srcObject = null;
      inp.el.removeAttribute('src');
      inp.el.load();
      inp.el.remove();
    }
    if (inp.url) URL.revokeObjectURL(inp.url);
    if (inp.el && inp.el.tagName === 'IMG') { inp.el.onload = inp.el.onerror = null; inp.el.removeAttribute('src'); }
    if (inp.peerId && forget) wireless.release(inp.peerId);
    if (inp.type === 'guest') {
      if (inp.returnVideo) inp.returnVideo.stop();
      if (inp.call) { try { inp.call.close(); } catch (e) {} }
      audio.dropMixMinus(inp.id);
    }
    if (inp.type === 'srt') closeSrtInput(inp);
    if (forget && (inp.type === 'media' || inp.type === 'image')) mediaStore.del(inp.id);
    if (inp.type === 'playlist') playlist.dispose(inp, forget);
    inp.removed = true;
    if (gpu) gpu.drop(inp.id);
    audio.removeForInput(inp.id);
    if (inputs.includes(inp)) inputs.splice(inputs.indexOf(inp), 1);
  }

  function resetAfterRemoval(id) {
    tr.auto = false; tr.progress = 0; tbar.set(tr.base);
    $('[data-action="auto"]').classList.remove('is-running');
    if (state.programId === id) {
      state.programId = (inputs.find(i => i.type === 'black') || inputs.find(i => i.id !== state.previewId) || inputs[0] || {}).id || null;
    }
    if (state.previewId === id || state.previewId === state.programId) {
      state.previewId = (inputs.find(i => i.id !== state.programId) || {}).id || null;
    }
    for (const c of ovl) if (c.inputId === id) Object.assign(c, { inputId: null, on: false, staged: false, anim: 0 });
    for (const name of ['pip', 'key']) {
      if (overlays[name].sourceId === id) {
        overlays[name].sourceId = null;
        if (overlays[name].on) setOverlay(name, false);
      }
    }
  }

  async function renameInput(inp) {
    if (inp.type === 'playlist') return playlist.edit(inp);
    if (inp.type === 'title') return openTitleDialog(inp);
    if (inp.type === 'timer') return openTimerDialog(inp);
    if (inp.type === 'score') return openScoreDialog(inp);
    if (inp.type === 'ticker') return openTickerDialog(inp);
    const hasText = inp.type === 'slate' || inp.type === 'clock';
    const result = await dialog({
      title: 'แก้ไขแหล่งภาพ',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        ${hasText ? `<label class="field"><span>${inp.type === 'slate' ? 'ข้อความบนจอ' : 'หัวข้อเหนือนาฬิกา'}</span><input name="text" class="input" maxlength="80" value="${esc(inp.text)}"></label>` : ''}`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }]
    });
    if (result?.value !== 'save') return;
    const name = result.form.name.value.trim();
    if (name) inp.name = name;
    if (hasText) inp.text = result.form.text.value.trim();
    if (inp.type === 'srt') saveSrtInputs();
    const ch = audio.channels.find(c => c.inputId === inp.id);
    if (ch) { ch.name = inp.name; renderMixer(); }
    renderInputs();
    refreshSourceSelects();
  }

  /* ------------------------------------------------------ adding sources */
  function needMedia() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast('ต้องเปิดหน้านี้ผ่าน HTTPS (หรือ localhost) จึงจะใช้กล้อง/ไมค์ได้', 'error', 6000);
      return false;
    }
    return true;
  }

  async function listDevices(kind) {
    let list = await navigator.mediaDevices.enumerateDevices();
    if (!list.some(d => d.kind === kind && d.label)) {
      // ต้องขออนุญาตก่อน เบราว์เซอร์จึงจะบอกชื่ออุปกรณ์
      try {
        const tmp = await navigator.mediaDevices.getUserMedia(kind === 'videoinput' ? { video: true } : { audio: true });
        tmp.getTracks().forEach(t => t.stop());
      } catch (e) {
        throw new Error('ไม่ได้รับอนุญาตให้ใช้อุปกรณ์ (' + e.message + ')');
      }
      list = await navigator.mediaDevices.enumerateDevices();
    }
    return list;
  }

  // หาอุปกรณ์จากชื่อ เมื่อรหัสอุปกรณ์เดิมใช้ไม่ได้แล้ว (รหัสเปลี่ยนได้ เช่นหลังล้างข้อมูลเว็บไซต์หรือย้ายพอร์ต USB)
  async function deviceByLabel(kind, label) {
    if (!label) return '';
    try { return ((await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === kind && d.label === label) || {}).deviceId || ''; } catch (e) { return ''; }
  }

  // เปิดกล้องตามค่าที่จำไว้ (ใช้ตอนเปิดโชว์กลับมาและตอนเชื่อมต่อใหม่)
  async function startCamera(cam) {
    const open = () => navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: cam.deviceId }, width: { ideal: cam.w }, height: { ideal: cam.h }, frameRate: { ideal: 30 } },
      audio: cam.micId ? { deviceId: { exact: cam.micId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
    });
    try { return await open(); } catch (e) {
      if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e;
      const video = await deviceByLabel('videoinput', cam.label);
      if (!video) throw e;
      cam.deviceId = video;
      if (cam.micId) cam.micId = await deviceByLabel('audioinput', cam.micLabel);
      return open();
    }
  }

  async function openMicById(micId, label, clean) {
    const open = id => navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id }, echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean } });
    try { return { stream: await open(micId), micId }; } catch (e) {
      if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e;
      const id = await deviceByLabel('audioinput', label);
      if (!id) throw e;
      return { stream: await open(id), micId: id };
    }
  }

  // ต่อสัญญาณภาพเข้ากับ Input ที่มีอยู่แล้ว (เช่น Input ที่โหลดจากโชว์และรอเชื่อมต่อ)
  function attachStream(inp, stream) {
    if (inp.stream && inp.stream !== stream) inp.stream.getTracks().forEach(t => t.stop());
    inp.stream = stream;
    inp.el.srcObject = stream;
    inp.el.play().catch(() => {});
    inp.missing = false;
    watchTracks(inp);
    audio.replaceStream(inp, stream);
    inp.status = 'nosignal';
    setInputStatus(inp, 'live');
    renderInputs();
  }

  async function openCameraDialog(target) {
    if (!needMedia()) return;
    let devices;
    try { devices = await listDevices('videoinput'); } catch (e) { toast(e.message, 'error'); return; }
    const cams = devices.filter(d => d.kind === 'videoinput');
    const mics = devices.filter(d => d.kind === 'audioinput');
    if (!cams.length) { toast('ไม่พบกล้องในเครื่องนี้', 'error'); return; }
    const result = await dialog({
      title: target ? `เชื่อมต่อกล้อง “${target.name}”` : 'เพิ่มกล้อง',
      body: `
        <label class="field"><span>กล้อง / แคปเจอร์การ์ด</span><select name="cam" class="select">
          ${cams.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Camera ' + (i + 1))}</option>`).join('')}
        </select></label>
        <label class="field"><span>ความละเอียด</span><select name="res" class="select">
          <option value="3840x2160">3840 × 2160 (4K UHD)</option>
          <option value="2560x1440">2560 × 1440 (QHD)</option>
          <option value="1920x1080" selected>1920 × 1080 (Full HD)</option>
          <option value="1280x720">1280 × 720 (HD)</option>
          <option value="640x480">640 × 480</option>
        </select></label>
        <label class="field"><span>เสียงของแหล่งภาพนี้</span><select name="mic" class="select">
          <option value="">ไม่ใช้เสียง</option>
          ${mics.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Microphone ' + (i + 1))}</option>`).join('')}
        </select></label>`,
      actions: [{ label: 'ยกเลิก' }, { label: target ? 'เชื่อมต่อ' : 'เพิ่มกล้อง', primary: true, value: 'add' }]
    });
    if (result?.value !== 'add') return;
    const f = result.form;
    const [rw, rh] = f.res.value.split('x').map(Number);
    const camLabel = f.cam.options[f.cam.selectedIndex].text;
    const cam = { deviceId: f.cam.value, micId: f.mic.value, w: rw, h: rh, label: camLabel, micLabel: f.mic.value ? f.mic.options[f.mic.selectedIndex].text : '' };
    try {
      const stream = await startCamera(cam);
      if (target) { if (target.removed) { stream.getTracks().forEach(t => t.stop()); return; } target.cam = cam; attachStream(target, stream); }
      else addStreamInput(stream, { type: 'camera', name: camLabel.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').slice(0, 32), cam });
      const got = stream.getVideoTracks()[0].getSettings();
      if (got.width && got.height < rh) toast(`เพิ่มกล้องแล้ว — ได้ภาพ ${got.width}×${got.height} เพราะกล้องรองรับสูงสุดเท่านี้`, 'warn', 6000);
      else toast(`เพิ่มกล้อง “${camLabel}” แล้ว (${got.width || rw}×${got.height || rh})`, 'success');
    } catch (e) {
      toast('เปิดกล้องไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  async function addScreen(target) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast('อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับการแชร์หน้าจอ (ใช้ได้บนคอมพิวเตอร์)', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } }, audio: true });
      if (target) { if (!target.removed) attachStream(target, stream); return; }
      const n = inputs.filter(i => i.type === 'screen').length + 1;
      addStreamInput(stream, { type: 'screen', name: `SCREEN ${n}` });
    } catch (e) {
      if (e.name !== 'NotAllowedError') toast('แชร์หน้าจอไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  function pickFiles(accept, handler) {
    const el = document.createElement('input');
    el.type = 'file'; el.accept = accept; el.multiple = true;
    // iOS Safari บางรุ่นไม่เปิดตัวเลือกไฟล์ถ้า input ไม่ได้อยู่ในหน้า
    pool.appendChild(el);
    el.onchange = () => { if (el.files.length) handler(Array.from(el.files)); el.remove(); };
    el.click();
  }

  const baseName = name => name.replace(/\.[^.]+$/, '').slice(0, 32);

  function createMediaInput(props) {
    const v = document.createElement('video');
    v.loop = props.loop !== false; v.playsInline = true; v.preload = 'auto';
    pool.appendChild(v);
    const inp = addInput({ type: 'media', ...props, el: v });
    v.addEventListener('play', () => updateMediaButtons(inp));
    v.addEventListener('pause', () => updateMediaButtons(inp));
    v.addEventListener('error', () => {
      if (!v.getAttribute('src')) return;
      setInputStatus(inp, 'nosignal');
      toast(`เปิดไฟล์ “${inp.fileName || inp.name}” ไม่ได้ (ฟอร์แมตไม่รองรับ)`, 'error');
    });
    audio.addElement(inp, v);
    return inp;
  }

  function createImageInput(props) {
    return addInput({ type: 'image', ...props, el: new Image() });
  }

  // ใส่ไฟล์ให้ Input วิดีโอ/รูป — store = เก็บสำเนาไว้ในเครื่อง (เปิดหน้าใหม่แล้ว Input ยังอยู่ครบ)
  function setInputFile(inp, file, store, isNew) {
    if (inp.url) URL.revokeObjectURL(inp.url);
    inp.url = URL.createObjectURL(file);
    if (file.name && file.name !== inp.id) inp.fileName = file.name;
    inp.missing = false;
    if (inp.type === 'image') {
      inp.el.onload = () => { setInputStatus(inp, 'live'); renderInputs(); };
      inp.el.onerror = () => {
        toast(`เปิดรูป “${inp.fileName || inp.name}” ไม่ได้`, 'error');
        if (isNew) { disposeInput(inp, true); resetAfterRemoval(inp.id); renderInputs(); refreshSourceSelects(); }
        else setInputStatus(inp, 'nosignal');
      };
      inp.el.src = inp.url;
    } else {
      inp.el.src = inp.url;
      inp.status = 'live';
      inp.el.play().catch(() => {});
    }
    if (store) mediaStore.put(inp.id, file).then(ok => {
      if (!ok && !inp.removed) toast(`พื้นที่ในเบราว์เซอร์ไม่พอเก็บ “${inp.fileName || inp.name}” — เปิดหน้าใหม่แล้วต้องเลือกไฟล์นี้อีกครั้ง`, 'warn', 7000);
    });
  }

  function addVideoFiles(files) {
    audio.ensure();
    for (const file of files) setInputFile(createMediaInput({ name: baseName(file.name) }), file, true, true);
  }

  function addImageFiles(files) {
    for (const file of files) setInputFile(createImageInput({ name: baseName(file.name), status: 'nosignal' }), file, true, true);
  }

  // เชื่อมต่อ Input ที่ขาดสัญญาณ/ยังไม่มีไฟล์ (หลังเปิดโชว์กลับมา หรือกล้องหลุด)
  async function relinkInput(inp) {
    if (inp.type === 'camera') {
      if (inp.cam && needMedia()) {
        try { const stream = await startCamera(inp.cam); if (!inp.removed) attachStream(inp, stream); toast(`เชื่อมต่อ “${inp.name}” แล้ว`, 'success'); return; } catch (e) {}
      }
      return openCameraDialog(inp);
    }
    if (inp.type === 'screen') return addScreen(inp);
    if (inp.type === 'media' || inp.type === 'image') {
      const el = document.createElement('input');
      el.type = 'file'; el.accept = inp.type === 'media' ? 'video/*,audio/*' : 'image/*';
      pool.appendChild(el);
      el.onchange = () => {
        const file = el.files[0];
        el.remove();
        if (!file || inp.removed) return;
        audio.ensure();
        setInputFile(inp, file, true, false);
        renderInputs();
      };
      el.click();
    }
  }

  async function openMicDialog() {
    if (!needMedia()) return;
    let devices;
    try { devices = await listDevices('audioinput'); } catch (e) { toast(e.message, 'error'); return; }
    const mics = devices.filter(d => d.kind === 'audioinput');
    if (!mics.length) { toast('ไม่พบไมโครโฟนในเครื่องนี้', 'error'); return; }
    const result = await dialog({
      title: 'เพิ่มไมโครโฟน',
      body: `
        <label class="field"><span>ไมโครโฟน / ออดิโออินเทอร์เฟซ</span><select name="mic" class="select">
          ${mics.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Microphone ' + (i + 1))}</option>`).join('')}
        </select></label>
        <label class="check"><input type="checkbox" name="clean"> ลดเสียงสะท้อนและเสียงรบกวน (เหมาะกับไมค์โน้ตบุ๊ก/มือถือ)</label>
        <p class="note">ไมค์มืออาชีพหรือมิกเซอร์ภายนอก แนะนำให้ปิดตัวเลือกนี้เพื่อคุณภาพเสียงที่ดีที่สุด</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'เพิ่มไมค์', primary: true, value: 'add' }]
    });
    if (result?.value !== 'add') return;
    const f = result.form, clean = f.clean.checked;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: f.mic.value }, echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean }
      });
      const label = f.mic.options[f.mic.selectedIndex].text.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
      audio.addMic(stream, label.slice(0, 24), { micId: f.mic.value, micLabel: f.mic.options[f.mic.selectedIndex].text, clean });
      toast(`เพิ่ม “${label}” แล้ว`, 'success');
    } catch (e) {
      toast('เปิดไมค์ไม่สำเร็จ: ' + e.message, 'error');
    }
  }


  /* ------------------------------------------------------ overlay controls */
  function playIfMedia(inp) {
    if (inp && inp.type === 'media' && inp.el.paused) inp.el.play().catch(() => {});
  }
  function setChannel(i, on) {
    const c = ovl[i];
    if (on && !byId(c.inputId)) { toast(`เลือกแหล่งภาพให้ Overlay ${c.n} ก่อน (แท็บ ซ้อนภาพ หรือปุ่ม ${c.n} ใต้การ์ดแหล่งภาพ)`, 'warn'); return; }
    c.on = on;
    if (on) { c.staged = false; playIfMedia(byId(c.inputId)); }
    updateOverlayUI();
  }
  // ปุ่ม 1–8 ใต้การ์ด: ซ้อน Input นี้เข้า Overlay นั้น (กดซ้ำเพื่อเอาออก) — ถ้าช่องนั้นมี Input อื่นอยู่ จะแทนที่ทันที
  function toggleInputOverlay(id, i) {
    const c = ovl[i];
    if (c.on && c.inputId === id) c.on = false;
    else {
      if (c.inputId !== id) c.anim = 0;
      c.inputId = id;
      c.on = true;
      c.staged = false;
      playIfMedia(byId(id));
    }
    updateOverlayUI();
  }
  function setStaged(i) {
    const c = ovl[i];
    if (!byId(c.inputId)) { toast(`เลือกแหล่งภาพให้ Overlay ${c.n} ก่อน`, 'warn'); return; }
    c.staged = !c.staged;
    updateOverlayUI();
  }

  function renderOverlayControls() {
    $('#ovl-keys').innerHTML = ovl.map((c, i) => `<button class="key key-ovl" data-ovl="${i}" title="Overlay ${c.n} — เปิด/ปิดบน Program (${ovlKeyLabel(i)})"><b>${c.n}</b><span></span><kbd>${ovlKeyLabel(i)}</kbd></button>`).join('');
    $('#ovl-rows').innerHTML = ovl.map((c, i) => `
      <div class="ovl-row" data-row="${i}">
        <button type="button" class="ovl-take" data-ovl="${i}" title="Overlay ${c.n} — เปิด/ปิดบน Program (${ovlKeyLabel(i)})">${c.n}</button>
        <select class="select ovl-src" data-ovl-src="${i}" aria-label="แหล่งภาพของ Overlay ${c.n}"></select>
        <select class="select ovl-fx" data-ovl-fx="${i}" aria-label="เอฟเฟกต์ของ Overlay ${c.n}">${Object.entries(OVL_EFFECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select class="select ovl-dur" data-ovl-dur="${i}" aria-label="ระยะเวลาของ Overlay ${c.n}">${OVL_DURATIONS.map(d => `<option value="${d}">${d / 1000}s</option>`).join('')}</select>
        <button type="button" class="ovl-pvw" data-ovl-pvw="${i}" title="แสดง Overlay ${c.n} บน Preview เพื่อตรวจก่อนขึ้นจอ">PVW</button>
      </div>`).join('');
    refreshOverlaySelects();
  }

  function refreshOverlaySelects() {
    ovl.forEach((c, i) => {
      if (c.inputId && !byId(c.inputId)) Object.assign(c, { inputId: null, on: false, staged: false, anim: 0 });
      const sel = $(`[data-ovl-src="${i}"]`);
      if (!sel) return;
      sel.innerHTML = '<option value="">— ไม่มี —</option>' + inputs.map((inp, n) => `<option value="${inp.id}">${n + 1}. ${esc(inp.name)}</option>`).join('');
      sel.value = c.inputId || '';
      $(`[data-ovl-fx="${i}"]`).value = c.effect;
      $(`[data-ovl-dur="${i}"]`).value = String(c.duration);
    });
    updateOverlayUI();
  }

  // มือถือ (แท็บกราฟิก): การ์ดกราฟิก แตะครั้งเดียว = ขึ้นจอ / แตะอีกครั้ง = เอาออก (ใช้ช่อง Overlay ที่ว่างให้เอง)
  const GFX_LABEL = { title: 'ป้ายชื่อ', timer: 'นับเวลา', score: 'ป้ายคะแนน', ticker: 'ตัววิ่ง', image: 'ภาพ / โลโก้', playlist: 'Playlist' };
  function renderQuickGfx() {
    const box = $('#m-gfx');
    if (!box) return;
    const bound = new Set(ovl.map(c => c.inputId).filter(Boolean));
    const list = inputs.filter(i => GRAPHIC_TYPES.includes(i.type) || i.type === 'image' || bound.has(i.id));
    const onAir = id => ovl.some(c => c.on && c.inputId === id);
    const sig = list.map(i => `${i.id}:${i.name}:${onAir(i.id)}`).join('|');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    const any = ovl.some(c => c.on);
    box.innerHTML = `
      <div class="m-gfx-head"><b>กราฟิกบนจอ</b><span>แตะเพื่อขึ้นจอ · แตะอีกครั้งเพื่อเอาออก</span>
        ${any ? '<button type="button" class="btn btn-sm" data-gfx-clear>เอาออกทั้งหมด</button>' : ''}</div>
      <div class="m-gfx-grid">${list.map(i => `
        <button type="button" class="gfx-card ${onAir(i.id) ? 'is-on' : ''}" data-gfx="${esc(i.id)}" aria-pressed="${onAir(i.id)}">
          ${icon(TYPE_META[i.type]?.icon || 'type')}<b>${esc(i.name)}</b><small>${onAir(i.id) ? 'ออกอากาศ' : esc(GFX_LABEL[i.type] || TYPE_META[i.type]?.label || '')}</small></button>`).join('')}
        <button type="button" class="gfx-card gfx-add" data-gfx-add="title">${icon('plus')}<b>ป้ายชื่อใหม่</b></button>
        <button type="button" class="gfx-card gfx-add" data-gfx-add="timer">${icon('plus')}<b>นับถอยหลัง</b></button>
        <button type="button" class="gfx-card gfx-add" data-gfx-add="score">${icon('plus')}<b>ป้ายคะแนน</b></button>
        <button type="button" class="gfx-card gfx-add" data-gfx-add="image">${icon('plus')}<b>โลโก้</b></button>
      </div>`;
  }
  function quickGfxTap(e) {
    if (e.target.closest('[data-gfx-clear]')) { ovl.forEach((c, i) => { if (c.on) setChannel(i, false); }); return; }
    const add = e.target.closest('[data-gfx-add]');
    if (add) {
      ({ title: addTitleInput, timer: addTimerInput, score: addScoreInput, image: () => pickFiles('image/*', addImageFiles) })[add.dataset.gfxAdd]();
      return;
    }
    const card = e.target.closest('[data-gfx]');
    if (!card) return;
    const id = card.dataset.gfx;
    const live = ovl.map((c, i) => c.on && c.inputId === id ? i : -1).filter(i => i >= 0);
    if (live.length) { live.forEach(i => setChannel(i, false)); return; }
    // ช่องที่ผูกกับกราฟิกนี้อยู่แล้ว → ช่องว่าง → ช่องที่ไม่ได้ขึ้นจอ
    let i = ovl.findIndex(c => c.inputId === id);
    if (i < 0) i = ovl.findIndex(c => !c.inputId);
    if (i < 0) i = ovl.findIndex(c => !c.on);
    if (i < 0) { toast('ช่อง Overlay เต็มทั้ง 8 ช่อง — เอากราฟิกอื่นออกก่อน', 'warn'); return; }
    toggleInputOverlay(id, i);
  }

  function updateOverlayUI() {
    ovl.forEach((c, i) => {
      const inp = byId(c.inputId);
      const key = $(`.key-ovl[data-ovl="${i}"]`);
      if (key) {
        key.classList.toggle('is-on', c.on);
        key.classList.toggle('is-staged', c.staged && !c.on);
        key.querySelector('span').textContent = inp ? inp.name : '—';
      }
      const take = $(`.ovl-take[data-ovl="${i}"]`);
      if (take) take.classList.toggle('is-on', c.on);
      const pvw = $(`[data-ovl-pvw="${i}"]`);
      if (pvw) pvw.classList.toggle('is-on', c.staged);
      const sel = $(`[data-ovl-src="${i}"]`);
      if (sel && sel.value !== (c.inputId || '')) sel.value = c.inputId || '';
    });
    $('.tab[data-tab="overlay"]').classList.toggle('is-live', ovl.some(c => c.on));
    renderQuickGfx();
    updateTally();
  }

  function initOverlayControls() {
    renderOverlayControls();
    const onClick = e => {
      const take = e.target.closest('[data-ovl]'), pvw = e.target.closest('[data-ovl-pvw]');
      if (take) { audio.ensure(); setChannel(+take.dataset.ovl, !ovl[+take.dataset.ovl].on); }
      else if (pvw) setStaged(+pvw.dataset.ovlPvw);
    };
    $('#ovl-keys').addEventListener('click', onClick);
    $('#ovl-rows').addEventListener('click', onClick);
    $('#ovl-rows').addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.ovlSrc != null) {
        const c = ovl[+t.dataset.ovlSrc];
        if (c.inputId !== (t.value || null)) c.anim = 0;
        c.inputId = t.value || null;
        if (!c.inputId) { c.on = false; c.staged = false; }
        else if (c.on) playIfMedia(byId(c.inputId));
        updateOverlayUI();
      } else if (t.dataset.ovlFx != null) ovl[+t.dataset.ovlFx].effect = OVL_EFFECTS[t.value] ? t.value : 'fade';
      else if (t.dataset.ovlDur != null) ovl[+t.dataset.ovlDur].duration = OVL_DURATIONS.includes(+t.value) ? +t.value : 500;
    });
  }

  // ตำแหน่งของ Input (ใช้ตอนเป็น Overlay): ตำแหน่ง ขนาด ครอป ความทึบ คีย์ฉาก ขอบ
  const LAYOUT_PRESETS = [
    ['เต็มจอ', { x: 0.5, y: 0.5, scale: 1 }], ['มุมขวาบน', { x: 0.82, y: 0.2, scale: 0.3 }], ['มุมขวาล่าง', { x: 0.82, y: 0.8, scale: 0.3 }],
    ['มุมซ้ายบน', { x: 0.18, y: 0.2, scale: 0.3 }], ['มุมซ้ายล่าง', { x: 0.18, y: 0.8, scale: 0.3 }],
    ['ครึ่งซ้าย', { x: 0.25, y: 0.5, scale: 0.5 }], ['ครึ่งขวา', { x: 0.75, y: 0.5, scale: 0.5 }], ['กลางจอ', { x: 0.5, y: 0.5, scale: 0.6 }]
  ];
  async function openLayoutDialog(inp) {
    const L = sanitizeLayout(inp.layout || DEFAULT_LAYOUT);
    inp.layout = L;
    const pct = v => Math.round(v * 100);
    const slider = (name, label, min, max, val) => `<label>${label} <b data-val="${name}">${val}</b><input type="range" class="range" name="${name}" min="${min}" max="${max}" value="${val}"></label>`;
    const result = await dialog({
      title: `ตำแหน่ง — ${inp.name}`,
      body: `
        <canvas class="layout-preview" width="480" height="270"></canvas>
        <div class="layout-presets">${LAYOUT_PRESETS.map(([label], i) => `<button type="button" data-preset="${i}">${label}</button>`).join('')}</div>
        <div class="layout-grid">
          ${slider('x', 'แนวนอน (X) %', -20, 120, pct(L.x))}${slider('y', 'แนวตั้ง (Y) %', -20, 120, pct(L.y))}
          ${slider('scale', 'ขนาด %', 5, 100, pct(L.scale))}${slider('opacity', 'ความทึบ %', 0, 100, pct(L.opacity))}
          ${slider('cl', 'ครอปซ้าย %', 0, 45, pct(L.crop.l))}${slider('cr', 'ครอปขวา %', 0, 45, pct(L.crop.r))}
          ${slider('ct', 'ครอปบน %', 0, 45, pct(L.crop.t))}${slider('cb', 'ครอปล่าง %', 0, 45, pct(L.crop.b))}
        </div>
        <div class="field"><span>คีย์ฉาก (Chroma key)</span>
          <div class="seg" data-seg="key"><button type="button" data-value="none">ไม่ใช้</button><button type="button" data-value="green">GREEN</button><button type="button" data-value="blue">BLUE</button></div>
        </div>
        <div class="layout-grid">${slider('tol', 'ความไว (Tolerance)', 10, 150, L.tolerance)}
          <label class="check"><input type="checkbox" name="border" ${L.border ? 'checked' : ''}> ขอบสีขาว (เมื่อย่อภาพ)</label></div>
        <p class="note">ค่านี้ใช้เมื่อแหล่งภาพนี้ขึ้นเป็น Overlay — เห็นผลทันทีบน Program/Preview (กด PVW ในแท็บ ซ้อนภาพ เพื่อดูก่อนขึ้นจอ)</p>`,
      actions: [{ label: 'รีเซ็ต', value: 'reset' }, { label: 'เสร็จ', primary: true, value: 'ok' }],
      onOpen(modal) {
        const f = $('form', modal).elements;
        const paintSeg = () => $$('[data-seg="key"] button', modal).forEach(b => b.classList.toggle('is-active', b.dataset.value === L.key));
        const sync = () => {
          for (const [name, v] of Object.entries({ x: pct(L.x), y: pct(L.y), scale: pct(L.scale), opacity: pct(L.opacity), cl: pct(L.crop.l), cr: pct(L.crop.r), ct: pct(L.crop.t), cb: pct(L.crop.b), tol: L.tolerance })) {
            f[name].value = v;
            $(`[data-val="${name}"]`, modal).textContent = v;
          }
          paintSeg();
        };
        sync();
        modal.addEventListener('input', e => {
          const t = e.target, v = +t.value;
          const map = { x: () => { L.x = v / 100; }, y: () => { L.y = v / 100; }, scale: () => { L.scale = v / 100; }, opacity: () => { L.opacity = v / 100; },
            cl: () => { L.crop.l = v / 100; }, cr: () => { L.crop.r = v / 100; }, ct: () => { L.crop.t = v / 100; }, cb: () => { L.crop.b = v / 100; }, tol: () => { L.tolerance = v; } };
          if (map[t.name]) { map[t.name](); $(`[data-val="${t.name}"]`, modal).textContent = t.value; }
          if (t.name === 'border') L.border = t.checked;
        });
        modal.addEventListener('click', e => {
          const p = e.target.closest('[data-preset]'), k = e.target.closest('[data-seg="key"] button');
          if (p) { Object.assign(L, LAYOUT_PRESETS[+p.dataset.preset][1]); sync(); }
          if (k) { L.key = k.dataset.value; paintSeg(); }
        });
        // ภาพตัวอย่าง: Program ปัจจุบันจาง ๆ เป็นพื้นหลัง แล้ววาด Input นี้ตามตำแหน่ง
        const cv = $('.layout-preview', modal), ctx = cv.getContext('2d');
        const draw = () => {
          if (!document.body.contains(cv)) return;
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.globalAlpha = 0.35; ctx.drawImage(pgmCanvas, 0, 0, cv.width, cv.height); ctx.globalAlpha = 1;
          ctx.save(); ctx.globalAlpha = L.opacity; drawLayout(ctx, inp, L, cv.width, cv.height); ctx.restore();
          requestAnimationFrame(draw);
        };
        draw();
      }
    });
    if (result?.value === 'reset' || isDefaultLayout(inp.layout)) inp.layout = null;
    renderInputs();
  }

  // Title Input
  function addTitleInput() {
    const n = inputs.filter(i => i.type === 'title').length + 1;
    const inp = addInput({ type: 'title', name: `TITLE ${n}`, title: { headline: 'ชื่อ นามสกุล', subtitle: 'ตำแหน่ง / หน่วยงาน', color: TITLE_COLORS[0], style: 'lower' } });
    openTitleDialog(inp);
    return inp;
  }
  async function openTitleDialog(inp) {
    const t = inp.title || (inp.title = { headline: '', subtitle: '', color: TITLE_COLORS[0], style: 'lower' });
    const result = await dialog({
      title: 'แก้ไข Title',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        <label class="field"><span>รูปแบบ</span><select name="style" class="select">${Object.entries(TITLE_STYLES).map(([k, v]) => `<option value="${k}" ${k === t.style ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>ข้อความหลัก</span><input name="headline" class="input" maxlength="80" value="${esc(t.headline)}"></label>
        <label class="field"><span>ข้อความรอง</span><input name="subtitle" class="input" maxlength="120" value="${esc(t.subtitle)}"></label>
        <label class="field"><span>สี</span><select name="color" class="select">${TITLE_COLORS.map(c => `<option value="${c}" ${c === t.color ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        ${dataFields(inp, 'คอลัมน์ A = ข้อความหลัก, B = ข้อความรอง · แต่ละแถว = ป้ายหนึ่งชุด (กด ‹ › บนการ์ดเพื่อเปลี่ยนแถว)')}
        <p class="note">พื้นหลังโปร่งใส — กดปุ่ม 1–8 ใต้การ์ดเพื่อซ้อนบน Program (แก้ข้อความแล้วบนจอเปลี่ยนทันที)</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }]
    });
    if (result?.value !== 'save') return;
    const f = result.form;
    inp.name = f.name.value.trim() || inp.name;
    inp.title = { headline: f.headline.value.trim(), subtitle: f.subtitle.value.trim(), color: TITLE_COLORS.includes(f.color.value) ? f.color.value : TITLE_COLORS[0], style: TITLE_STYLES[f.style.value] ? f.style.value : 'lower' };
    readDataFields(inp, f);
    renderInputs();
    refreshSourceSelects();
  }

  /* ---------------------------------------------------- playlist */
  // เล่นวิดีโอ/รูปต่อกันอัตโนมัติ: วิดีโอจบแล้วไปรายการถัดไป, รูปแสดงตามเวลาที่ตั้ง · ไฟล์เก็บในเบราว์เซอร์เหมือน Input วิดีโอ/รูป
  // ใช้ <video> ตัวเดียวต่อ Playlist เสียงจึงอยู่ในช่องมิกเซอร์เดียวตลอด
  const playlist = {
    create(props = {}) {
      const v = document.createElement('video');
      v.playsInline = true; v.preload = 'auto';
      pool.appendChild(v);
      const inp = addInput({ type: 'playlist', status: 'nosignal', ...props, el: v,
        list: { items: [], index: 0, loop: true, imageSec: 5, playing: true, ...(props.list || {}) }, urls: new Map() });
      v.addEventListener('ended', () => this.next(inp));
      v.addEventListener('error', () => { if (v.getAttribute('src')) { toast(`${inp.name}: เล่นไฟล์ “${this.current(inp)?.name || ''}” ไม่ได้ — ข้ามไปรายการถัดไป`, 'warn'); this.next(inp); } });
      v.addEventListener('playing', () => setInputStatus(inp, 'live'));
      audio.addElement(inp, v);
      return inp;
    },
    current: inp => inp.list.items[inp.list.index] || null,
    async url(inp, item) {
      if (inp.urls.has(item.key)) return inp.urls.get(item.key);
      const file = await mediaStore.get(item.key);
      if (!file) return null;
      const u = URL.createObjectURL(file);
      inp.urls.set(item.key, u);
      return u;
    },
    // แสดงรายการที่ index (manual = ผู้ใช้กดเอง: เล่นต่อแม้ปิดวนซ้ำ)
    async go(inp, index, manual) {
      const L = inp.list, n = L.items.length;
      clearTimeout(inp.imgTimer);
      if (!n) { inp.showImg = null; inp.el.removeAttribute('src'); inp.el.load(); setInputStatus(inp, 'nosignal'); renderInputs(); return; }
      if (index >= n) { if (!L.loop && !manual) { this.setPlaying(inp, false); return; } index = 0; }
      if (index < 0) index = n - 1;
      L.index = index;
      const item = L.items[index], token = (inp.goToken = (inp.goToken || 0) + 1);
      const src = await this.url(inp, item);
      if (inp.removed || token !== inp.goToken) return;
      if (!src) {
        // ไฟล์ไม่อยู่ในเครื่องนี้ (เช่นเปิดไฟล์โชว์บนเครื่องอื่น) — ข้าม
        if (!item.missingWarned) { item.missingWarned = true; toast(`${inp.name}: ไม่พบไฟล์ “${item.name}” ในเครื่องนี้ — ข้ามไป (เพิ่มไฟล์ใหม่ในหน้าแก้ไข Playlist)`, 'warn', 6000); }
        if (L.items.every(x => x.missingWarned)) { setInputStatus(inp, 'nosignal'); return; }
        return this.go(inp, index + 1, manual);
      }
      if (item.kind === 'image') {
        inp.el.pause();
        const img = new Image();
        img.onload = () => { if (token !== inp.goToken) return; inp.showImg = img; setInputStatus(inp, 'live'); this.armImage(inp); };
        img.src = src;
      } else {
        inp.showImg = null;
        inp.el.src = src;
        inp.el.currentTime = 0;
        if (L.playing) inp.el.play().catch(() => {});
      }
      const sub = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
      if (sub) sub.textContent = cardSub(inp);
    },
    armImage(inp) {
      clearTimeout(inp.imgTimer);
      if (inp.list.playing && inp.showImg) inp.imgTimer = setTimeout(() => this.next(inp), inp.list.imageSec * 1000);
    },
    next(inp) { if (!inp.removed) this.go(inp, inp.list.index + 1, false); },
    setPlaying(inp, on) {
      inp.list.playing = on;
      if (inp.showImg) { if (on) this.armImage(inp); else clearTimeout(inp.imgTimer); }
      else if (inp.el.getAttribute('src')) { if (on) inp.el.play().catch(() => {}); else inp.el.pause(); }
      renderInputs();
    },
    async addFiles(inp, files) {
      for (const file of files) {
        const kind = /^image\//.test(file.type) ? 'image' : /^(video|audio)\//.test(file.type) || /\.(mp4|webm|mov|mkv|m4v|mp3|wav|m4a)$/i.test(file.name) ? 'video' : null;
        if (!kind) { toast(`ข้ามไฟล์ “${file.name}” (ไม่ใช่วิดีโอหรือรูป)`, 'warn'); continue; }
        const item = { key: `${inp.id}-${uid()}`, name: file.name, kind };
        inp.urls.set(item.key, URL.createObjectURL(file));
        inp.list.items.push(item);
        mediaStore.put(item.key, file).then(ok => { if (!ok && !inp.removed) toast(`พื้นที่ในเบราว์เซอร์ไม่พอเก็บ “${file.name}” — เปิดหน้าใหม่แล้วต้องเพิ่มไฟล์นี้อีกครั้ง`, 'warn', 7000); });
      }
      if (inp.list.items.length && inp.status !== 'live') this.go(inp, inp.list.index);
      renderInputs();
    },
    remove(inp, i) {
      const [item] = inp.list.items.splice(i, 1);
      if (!item) return;
      mediaStore.del(item.key);
      const u = inp.urls.get(item.key);
      if (u) { URL.revokeObjectURL(u); inp.urls.delete(item.key); }
      if (i < inp.list.index) inp.list.index--;
      else if (i === inp.list.index) this.go(inp, Math.min(inp.list.index, inp.list.items.length - 1), true);
    },
    move(inp, i, d) {
      const it = inp.list.items, j = i + d;
      if (j < 0 || j >= it.length) return;
      [it[i], it[j]] = [it[j], it[i]];
      if (inp.list.index === i) inp.list.index = j; else if (inp.list.index === j) inp.list.index = i;
    },
    dispose(inp, forget) {
      clearTimeout(inp.imgTimer);
      for (const u of inp.urls.values()) URL.revokeObjectURL(u);
      if (forget) for (const it of inp.list.items) mediaStore.del(it.key);
    },
    keys: () => inputs.filter(i => i.type === 'playlist').flatMap(i => i.list.items.map(x => x.key)),
    async edit(inp) {
      const L = inp.list;
      const rows = () => L.items.length ? L.items.map((it, i) => `
        <div class="pl-row ${i === L.index ? 'is-current' : ''}" data-i="${i}">
          <span class="pl-num">${i + 1}</span>${icon(it.kind === 'image' ? 'image' : 'film')}<span class="pl-name">${esc(it.name)}</span>
          <button type="button" class="mini" data-pl="up" title="เลื่อนขึ้น">▲</button><button type="button" class="mini" data-pl="down" title="เลื่อนลง">▼</button>
          <button type="button" class="mini" data-pl="play" title="เล่นรายการนี้">${icon('play')}</button><button type="button" class="mini danger" data-pl="del" title="ลบออกจากรายการ">${icon('x')}</button>
        </div>`).join('') : '<p class="note">ยังไม่มีไฟล์ — กด “เพิ่มไฟล์”</p>';
      const result = await dialog({
        title: `Playlist — ${inp.name}`,
        body: `
          <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
          <div class="pl-list">${rows()}</div>
          <button type="button" class="btn" data-pl="add">${icon('plus')}เพิ่มไฟล์ (วิดีโอ / รูป)</button>
          <div class="field-row">
            <label class="field"><span>แสดงรูปนาน (วินาที)</span><input name="imageSec" class="input mono" type="number" min="1" max="600" value="${L.imageSec}"></label>
            <label class="check" style="align-self:end"><input type="checkbox" name="loop" ${L.loop ? 'checked' : ''}> เล่นวนซ้ำทั้งรายการ</label>
          </div>
          <p class="note">วิดีโอเล่นจนจบแล้วไปรายการถัดไปเอง · ปุ่ม ‹ ⏯ › บนการ์ดใช้ควบคุมระหว่างไลฟ์ · ไฟล์เก็บไว้ในเบราว์เซอร์นี้</p>`,
        actions: [{ label: 'เสร็จ', primary: true, value: 'save' }],
        onOpen(modal) {
          const list = $('.pl-list', modal);
          const redraw = () => { list.innerHTML = rows(); };
          modal.addEventListener('click', e => {
            const b = e.target.closest('[data-pl]');
            if (!b) return;
            const act = b.dataset.pl, i = +(b.closest('[data-i]')?.dataset.i ?? -1);
            if (act === 'add') {
              pickFiles('video/*,image/*,audio/*', files => playlist.addFiles(inp, files).then(redraw));
              return;
            }
            if (act === 'up' || act === 'down') playlist.move(inp, i, act === 'up' ? -1 : 1);
            else if (act === 'del') playlist.remove(inp, i);
            else if (act === 'play') { L.playing = true; playlist.go(inp, i, true); }
            redraw();
            renderInputs();
          });
        }
      });
      if (result?.value === 'save') {
        const f = result.form;
        inp.name = f.name.value.trim() || inp.name;
        L.imageSec = clamp(Math.round(+f.imageSec.value || 5), 1, 600);
        L.loop = f.loop.checked;
      }
      renderInputs();
      refreshSourceSelects();
    }
  };
  function addPlaylist() {
    audio.ensure();
    const n = inputs.filter(i => i.type === 'playlist').length + 1;
    const inp = playlist.create({ name: `PLAYLIST ${n}` });
    pickFiles('video/*,image/*,audio/*', files => playlist.addFiles(inp, files));
    return inp;
  }

  /* ---------------------------------------------------- data graphics */
  const timerControl = (inp, act) => {
    const t = clockOf(inp);
    if (!t) return;
    const now = Date.now();
    if (act === 'toggle') {
      if (t.running) { t.base = (t.base || 0) + now - t.since; t.running = false; }
      else { t.running = true; t.since = now; }
    } else if (act === 'reset') { t.base = 0; t.since = now; }
    renderInputs();
  };
  const durText = sec => `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
  const parseDur = (v, d) => { const m = /^(?:(\d+):)?(\d{1,3})(?::(\d{1,2}))?$/.exec(String(v).trim()); if (!m) return d; return m[3] != null ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] : (+m[1] || 0) * 60 + +m[2]; };
  const colorSelect = (name, cur) => `<select name="${name}" class="select">${TITLE_COLORS.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
  const pickColor = (v, d) => TITLE_COLORS.includes(v) ? v : d;

  function addTimerInput() {
    const n = inputs.filter(i => i.type === 'timer').length + 1;
    const inp = addInput({ type: 'timer', name: `TIMER ${n}`, timer: { mode: 'down', duration: 300, target: '19:00', label: 'เริ่มรายการใน', style: 'center', color: '#f5a524', base: 0, running: false, since: 0 } });
    openTimerDialog(inp);
  }
  async function openTimerDialog(inp) {
    const t = inp.timer;
    const result = await dialog({
      title: 'นาฬิกานับถอยหลัง / จับเวลา',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        <label class="field"><span>โหมด</span><select name="mode" class="select">${Object.entries(TIMER_MODES).map(([k, v]) => `<option value="${k}" ${k === t.mode ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div class="field-row">
          <label class="field"><span>ระยะเวลา (นาที:วินาที)</span><input name="duration" class="input mono" value="${durText(t.duration)}"></label>
          <label class="field"><span>ถึงเวลา (โหมดถึงเวลา)</span><input name="target" class="input mono" type="time" value="${esc(t.target)}"></label>
        </div>
        <label class="field"><span>ข้อความประกอบ</span><input name="label" class="input" maxlength="60" value="${esc(t.label)}"></label>
        <div class="field-row">
          <label class="field"><span>รูปแบบ</span><select name="style" class="select">${Object.entries(TIMER_STYLES).map(([k, v]) => `<option value="${k}" ${k === t.style ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>สี</span>${colorSelect('color', t.color)}</label>
        </div>
        <p class="note">ปุ่ม ▶/⏸ และ ⟲ บนการ์ดใช้เริ่ม หยุด และรีเซ็ต · โหมด “ถึงเวลา” เดินเองตามนาฬิกาเครื่อง · หมดเวลาแล้วตัวเลขกะพริบแดง</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }]
    });
    if (result?.value !== 'save') return;
    const f = result.form;
    inp.name = f.name.value.trim() || inp.name;
    Object.assign(t, { mode: TIMER_MODES[f.mode.value] ? f.mode.value : 'down', duration: clamp(parseDur(f.duration.value, t.duration), 1, 86400),
      target: /^\d{1,2}:\d{2}$/.test(f.target.value) ? f.target.value : t.target, label: f.label.value.trim().slice(0, 60),
      style: TIMER_STYLES[f.style.value] ? f.style.value : 'center', color: pickColor(f.color.value, t.color) });
    renderInputs();
    refreshSourceSelects();
  }

  function addScoreInput() {
    const n = inputs.filter(i => i.type === 'score').length + 1;
    const inp = addInput({ type: 'score', name: n > 1 ? `SCORE ${n}` : 'SCORE', score: { teamA: 'ทีม A', teamB: 'ทีม B', scoreA: 0, scoreB: 0, colorA: '#ef4444', colorB: '#3b82f6', period: 'ครึ่งแรก',
      clock: { mode: 'none', duration: 2700, base: 0, running: false, since: 0 } } });
    openScoreDialog(inp);
  }
  async function openScoreDialog(inp) {
    const sc = inp.score;
    const result = await dialog({
      title: 'ป้ายคะแนน',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        <div class="field-row">
          <label class="field"><span>ทีม A</span><input name="teamA" class="input" maxlength="24" value="${esc(sc.teamA)}"></label>
          <label class="field"><span>คะแนน</span><input name="scoreA" class="input mono" type="number" min="0" value="${+sc.scoreA || 0}"></label>
          <label class="field"><span>สี</span>${colorSelect('colorA', sc.colorA)}</label>
        </div>
        <div class="field-row">
          <label class="field"><span>ทีม B</span><input name="teamB" class="input" maxlength="24" value="${esc(sc.teamB)}"></label>
          <label class="field"><span>คะแนน</span><input name="scoreB" class="input mono" type="number" min="0" value="${+sc.scoreB || 0}"></label>
          <label class="field"><span>สี</span>${colorSelect('colorB', sc.colorB)}</label>
        </div>
        <div class="field-row">
          <label class="field"><span>ช่วงเวลา (เช่น ครึ่งแรก, Q2)</span><input name="period" class="input" maxlength="20" value="${esc(sc.period)}"></label>
          <label class="field"><span>นาฬิกาการแข่งขัน</span><select name="clockMode" class="select">
            <option value="none" ${sc.clock.mode === 'none' ? 'selected' : ''}>ไม่แสดง</option>
            <option value="up" ${sc.clock.mode === 'up' ? 'selected' : ''}>นับขึ้น</option>
            <option value="down" ${sc.clock.mode === 'down' ? 'selected' : ''}>นับถอยหลัง</option></select></label>
          <label class="field"><span>เวลา (นาที:วินาที)</span><input name="clockDur" class="input mono" value="${durText(sc.clock.duration)}"></label>
        </div>
        ${dataFields(inp, 'แถวข้อมูลแรก: A = ทีม A, B = คะแนน A, C = ทีม B, D = คะแนน B, E = ช่วงเวลา')}
        <p class="note">ปุ่ม A+ A− B+ B− บนการ์ดเปลี่ยนคะแนนทันทีระหว่างไลฟ์ · ▶/⏸ ⟲ ควบคุมนาฬิกาการแข่งขัน</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }]
    });
    if (result?.value !== 'save') return;
    const f = result.form;
    inp.name = f.name.value.trim() || inp.name;
    Object.assign(sc, { teamA: f.teamA.value.trim().slice(0, 24), teamB: f.teamB.value.trim().slice(0, 24), scoreA: Math.max(0, +f.scoreA.value || 0), scoreB: Math.max(0, +f.scoreB.value || 0),
      colorA: pickColor(f.colorA.value, sc.colorA), colorB: pickColor(f.colorB.value, sc.colorB), period: f.period.value.trim().slice(0, 20) });
    sc.clock.mode = ['none', 'up', 'down'].includes(f.clockMode.value) ? f.clockMode.value : 'none';
    sc.clock.duration = clamp(parseDur(f.clockDur.value, sc.clock.duration), 1, 86400);
    readDataFields(inp, f);
    renderInputs();
    refreshSourceSelects();
  }

  function addTickerInput() {
    const n = inputs.filter(i => i.type === 'ticker').length + 1;
    const inp = addInput({ type: 'ticker', name: n > 1 ? `TICKER ${n}` : 'TICKER', ticker: { label: 'ข่าวด่วน', items: ['พิมพ์ข้อความข่าวบรรทัดละหนึ่งเรื่อง', 'ตัววิ่งจะเลื่อนต่อกันไปเรื่อย ๆ'], speed: 90, color: '#ef4444' } });
    openTickerDialog(inp);
  }
  async function openTickerDialog(inp) {
    const tk = inp.ticker;
    const result = await dialog({
      title: 'ตัววิ่งข่าว (Ticker)',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        <div class="field-row">
          <label class="field"><span>ป้ายหัว (เว้นว่างได้)</span><input name="label" class="input" maxlength="24" value="${esc(tk.label)}"></label>
          <label class="field"><span>ความเร็ว</span><select name="speed" class="select">${[[60, 'ช้า'], [90, 'ปกติ'], [130, 'เร็ว'], [180, 'เร็วมาก']].map(([v, l]) => `<option value="${v}" ${+tk.speed === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>สี</span>${colorSelect('color', tk.color)}</label>
        </div>
        <label class="field"><span>ข้อความ (บรรทัดละหนึ่งเรื่อง)</span><textarea name="items" class="input" rows="5">${esc(tk.items.join('\n'))}</textarea></label>
        ${dataFields(inp, 'คอลัมน์ A ของทุกแถว = ข้อความที่วิ่ง (แทนข้อความด้านบน)')}`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }]
    });
    if (result?.value !== 'save') return;
    const f = result.form;
    inp.name = f.name.value.trim() || inp.name;
    Object.assign(tk, { label: f.label.value.trim().slice(0, 24), speed: [60, 90, 130, 180].includes(+f.speed.value) ? +f.speed.value : 90, color: pickColor(f.color.value, tk.color),
      items: f.items.value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 100) });
    readDataFields(inp, f);
    renderInputs();
    refreshSourceSelects();
  }

  // ข้อมูลจาก Google Sheets / CSV: ดึงใหม่ทุก 10 วินาที แก้ในชีตแล้วบนจอเปลี่ยนเอง
  function dataFields(inp, hint) {
    const d = inp.data || {};
    return `
        <label class="field"><span>ข้อมูลจาก Google Sheets / CSV (ไม่บังคับ)</span><input name="dataUrl" class="input mono" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(d.url || '')}"></label>
        <label class="check"><input type="checkbox" name="dataHeader" ${d.header !== false ? 'checked' : ''}> แถวแรกเป็นหัวตาราง (ไม่นำมาแสดง)</label>
        <p class="note">${hint} · ชีตต้องแชร์แบบ “ทุกคนที่มีลิงก์ดูได้” · ดึงข้อมูลใหม่ทุก 10 วินาที${d.error ? ` · <b class="warn">ล่าสุด: ${esc(d.error)}</b>` : ''}</p>`;
  }
  function readDataFields(inp, f) {
    const url = f.dataUrl.value.trim();
    if (!url) { inp.data = null; return; }
    if (!/^https?:\/\//i.test(url)) { toast('ลิงก์ข้อมูลต้องขึ้นต้นด้วย https://', 'warn'); return; }
    const prev = inp.data || {};
    inp.data = { url, header: f.dataHeader.checked, row: prev.url === url ? prev.row || 0 : 0, rows: prev.url === url ? prev.rows || [] : [], error: '', fetchedAt: 0 };
    dataSources.refresh(inp);
  }
  const dataSources = {
    REFRESH_MS: 10000,
    async refresh(inp) {
      const d = inp.data;
      if (!d || d.loading) return;
      d.loading = true;
      d.fetchedAt = Date.now();
      try {
        const res = await fetch(sheetCsvUrl(d.url), { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('ได้หน้าเว็บแทน CSV — ตรวจว่าแชร์ชีตแบบทุกคนดูได้');
        let rows = parseCsv(text);
        if (d.header && rows.length) rows = rows.slice(1);
        if (inp.data !== d || inp.removed) return;
        d.rows = rows;
        if (d.error) { d.error = ''; renderInputs(); }
        this.apply(inp);
      } catch (e) {
        const msg = e.message === 'Failed to fetch' ? 'ดึงข้อมูลไม่ได้ (ตรวจลิงก์และการแชร์ชีต)' : e.message;
        if (d.error !== msg) { d.error = msg; toast(`${inp.name}: ${msg}`, 'warn', 6000); renderInputs(); }
      } finally { d.loading = false; }
    },
    apply(inp) {
      const d = inp.data, rows = d.rows || [];
      if (inp.type === 'ticker') inp.ticker.items = rows.map(r => r[0]).filter(Boolean).slice(0, 100);
      else if (inp.type === 'score' && rows[0]) {
        const r = rows[0], num = v => Math.max(0, parseInt(v, 10) || 0);
        Object.assign(inp.score, { teamA: r[0] ?? inp.score.teamA, scoreA: r[1] != null ? num(r[1]) : inp.score.scoreA, teamB: r[2] ?? inp.score.teamB,
          scoreB: r[3] != null ? num(r[3]) : inp.score.scoreB, period: r[4] ?? inp.score.period });
      } else if (inp.type === 'title' && rows.length) {
        d.row = clamp(d.row || 0, 0, rows.length - 1);
        const r = rows[d.row];
        inp.title.headline = r[0] || '';
        inp.title.subtitle = r[1] || '';
        const card = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
        if (card) card.textContent = cardSub(inp);
        if (!$(`#inputs-grid .card[data-id="${inp.id}"] [data-card="dnext"]`) && rows.length > 1) renderInputs();
      }
    },
    step(inp, delta) {
      const d = inp.data;
      if (!d || !d.rows || !d.rows.length) return;
      d.row = (d.row + delta + d.rows.length) % d.rows.length;
      this.apply(inp);
    },
    tick() {
      const now = Date.now();
      for (const inp of inputs) if (inp.data && inp.data.url && now - (inp.data.fetchedAt || 0) >= this.REFRESH_MS) this.refresh(inp);
    }
  };
  setInterval(() => dataSources.tick(), 1000);

  /* ------------------------------------------------------- source selects */
  function refreshSourceSelects() {
    for (const name of ['pip', 'key']) {
      const sel = $(`#${name}-source`);
      const o = overlays[name];
      if (!byId(o.sourceId)) {
        // ค่าเริ่มต้น: PIP ใช้ Input ที่สองที่ไม่ใช่ Program, KEY ใช้กล้อง/ไฟล์ล่าสุด
        const pick = name === 'pip'
          ? inputs.find(i => i.id !== state.programId && i.type !== 'black')
          : [...inputs].reverse().find(i => !['bars', 'black', 'clock', 'slate'].includes(i.type));
        o.sourceId = pick ? pick.id : null;
      }
      sel.innerHTML = inputs.length
        ? inputs.map((i, n) => `<option value="${i.id}" ${i.id === o.sourceId ? 'selected' : ''}>${n + 1}. ${esc(i.name)}</option>`).join('')
        : '<option value="">— ไม่มีแหล่งภาพ —</option>';
    }
    refreshOverlaySelects();
  }

  /* ------------------------------------------------------------- audio */
  const dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);
  // ตำแหน่งเฟดเดอร์ 0..1 → dB (75% = 0 dB, บนสุด = +10 dB, ล่างสุด = −∞)
  const posToDb = p => p <= 0.015 ? -Infinity : p < 0.75 ? -60 + (p / 0.75) * 60 : (p - 0.75) / 0.25 * 10;
  const dbToPos = db => db === -Infinity || db <= -60 ? 0 : db < 0 ? (db + 60) / 60 * 0.75 : 0.75 + db / 10 * 0.25;
  const fmtDb = db => db === -Infinity || db <= -59.9 ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
  const meterPct = db => clamp((db + 60) / 60, 0, 1);

  const audio = {
    ctx: null, master: null, monitor: null, dest: null, analyser: null, buf: null,
    channels: [],
    pending: new Map(),   // ค่าของช่องเสียงจากโชว์ที่บันทึกไว้ รอใช้เมื่อแหล่งเสียงเชื่อมต่อ
    mm: new Map(),        // mix-minus ของแขกแต่ละคน: inputId → { bus, dest }
    masterStrip: { name: 'MASTER', db: 0, muted: false, limiter: store.get('limiter', true), level: -90, peak: -90, peakAt: 0, ui: null },
    monitorOn: false,

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = ctx.createGain();
        // ลิมิตเตอร์ที่ Master กันเสียงแตก (clipping) ในไฟล์บันทึกและสตรีม
        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -3;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.002;
        this.limiter.release.value = 0.12;
        this.post = ctx.createGain();
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.dest = ctx.createMediaStreamDestination();
        this.monitor = ctx.createGain();
        this.monitor.gain.value = 0;
        this.limiter.connect(this.post);
        this.post.connect(this.analyser);
        this.post.connect(this.dest);
        this.post.connect(this.monitor);
        this.monitor.connect(ctx.destination);
        this.setLimiter(this.masterStrip.limiter);
        this.buf = new Float32Array(1024);
        this.applyMaster();
        ctx.onstatechange = updateStatus;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },

    setLimiter(on) {
      this.masterStrip.limiter = on;
      store.set('limiter', on);
      if (!this.ctx) return;
      try { this.master.disconnect(); } catch (e) {}
      this.master.connect(on ? this.limiter : this.post);
    },

    // สายสัญญาณต่อช่อง: แหล่งเสียง → ดีเลย์ → EQ ต่ำ/กลาง/สูง → (คอมเพรสเซอร์) → เฟดเดอร์ → AFV → Master
    addChannel(node, opts) {
      const ctx = this.ctx;
      const delay = ctx.createDelay(1.0);
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 120;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1;
      const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 8000;
      const comp = ctx.createDynamicsCompressor();
      comp.knee.value = 6; comp.attack.value = 0.005; comp.release.value = 0.15;
      const fader = ctx.createGain(), afv = ctx.createGain(), analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      node.connect(delay);
      delay.connect(low); low.connect(mid); mid.connect(high); high.connect(fader);
      comp.connect(fader);
      fader.connect(afv);
      afv.connect(analyser);
      afv.connect(this.master);
      const ch = {
        id: uid(), node, input: delay, delay, low, mid, high, comp, fader, afvGain: afv, analyser,
        db: 0, muted: false, afv: false, level: -90, peak: -90, peakAt: 0,
        fx: { delayMs: 0, low: 0, mid: 0, high: 0, comp: false, threshold: -18, ratio: 4 },
        ...opts
      };
      const saved = ch.restore || (ch.inputId && this.pending.get(ch.inputId));
      if (saved) {
        this.pending.delete(ch.inputId);
        delete ch.restore;
        ch.db = typeof saved.db === 'number' ? clamp(saved.db, -60, 10) : -Infinity;
        ch.muted = !!saved.muted;
        ch.afv = !!saved.afv;
        if (saved.fx && typeof saved.fx === 'object') {
          const f = saved.fx;
          ch.fx = { delayMs: clamp(+f.delayMs || 0, 0, 1000), low: clamp(+f.low || 0, -15, 15), mid: clamp(+f.mid || 0, -15, 15), high: clamp(+f.high || 0, -15, 15),
            comp: !!f.comp, threshold: clamp(+f.threshold || -18, -60, 0), ratio: clamp(+f.ratio || 4, 1, 20) };
        }
      }
      this.channels.push(ch);
      for (const [id, m] of this.mm) if (ch.inputId !== id) afv.connect(m.bus);
      this.applyGain(ch);
      this.applyAfv();
      this.applyFx(ch);
      renderMixer();
      return ch;
    },
    applyFx(ch) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, f = ch.fx;
      ch.delay.delayTime.setTargetAtTime(f.delayMs / 1000, t, 0.01);
      ch.low.gain.setTargetAtTime(f.low, t, 0.01);
      ch.mid.gain.setTargetAtTime(f.mid, t, 0.01);
      ch.high.gain.setTargetAtTime(f.high, t, 0.01);
      ch.comp.threshold.setTargetAtTime(f.threshold, t, 0.01);
      ch.comp.ratio.setTargetAtTime(f.ratio, t, 0.01);
      if (ch.compOn !== f.comp) {
        ch.compOn = f.comp;
        try { ch.high.disconnect(); } catch (e) {}
        ch.high.connect(f.comp ? ch.comp : ch.fader);
      }
    },
    addStream(inp, stream) {
      if (!stream.getAudioTracks().length || !this.ensure()) return;
      this.addChannel(this.ctx.createMediaStreamSource(stream), { name: inp.name, inputId: inp.id, kind: 'input' });
    },
    replaceStream(inp, stream) {
      const ch = this.channels.find(c => c.inputId === inp.id);
      if (!ch) return this.addStream(inp, stream);
      if (!stream.getAudioTracks().length) return;
      try { ch.node.disconnect(); } catch (e) {}
      ch.node = this.ctx.createMediaStreamSource(stream);
      ch.node.connect(ch.input);
    },
    addElement(inp, el) {
      if (!this.ensure()) return;
      try {
        // เสียงจากไฟล์วิดีโอผ่านมิกเซอร์เท่านั้น (ไม่ดังออกลำโพงตรง) จึงปรับ/ปิดเสียงได้จริง
        this.addChannel(this.ctx.createMediaElementSource(el), { name: inp.name, inputId: inp.id, kind: 'input' });
      } catch (e) { console.warn('audio element', e); }
    },
    addMic(stream, name, extra = {}) {
      if (!this.ensure()) return;
      this.addChannel(this.ctx.createMediaStreamSource(stream), { name, kind: 'mic', stream, ...extra });
    },
    remove(ch) {
      try { ch.node.disconnect(); ch.afvGain.disconnect(); } catch (e) {}
      if (ch.stream) ch.stream.getTracks().forEach(t => t.stop());
      this.channels.splice(this.channels.indexOf(ch), 1);
      renderMixer();
    },
    // เสียงที่ส่งกลับให้แขก: ทุกช่องในรายการ ยกเว้นเสียงของแขกคนนั้นเอง (กันเสียงสะท้อน/ดีเลย์ตัวเอง)
    mixMinus(inputId) {
      if (!this.ensure()) return null;
      let m = this.mm.get(inputId);
      if (!m) {
        const bus = this.ctx.createGain(), dest = this.ctx.createMediaStreamDestination();
        bus.connect(dest);
        m = { bus, dest };
        this.mm.set(inputId, m);
        for (const ch of this.channels) if (ch.inputId !== inputId) ch.afvGain.connect(bus);
        this.applyMaster();
      }
      return m.dest.stream;
    },
    dropMixMinus(inputId) {
      const m = this.mm.get(inputId);
      if (!m) return;
      for (const ch of this.channels) { try { ch.afvGain.disconnect(m.bus); } catch (e) {} }
      try { m.bus.disconnect(); } catch (e) {}
      this.mm.delete(inputId);
    },
    removeForInput(id) {
      this.channels.filter(c => c.inputId === id).forEach(c => this.remove(c));
    },
    applyGain(ch) {
      if (!this.ctx) return;
      ch.fader.gain.setTargetAtTime(ch.muted ? 0 : dbToGain(ch.db), this.ctx.currentTime, 0.015);
    },
    applyMaster() {
      if (!this.ctx) return;
      const m = this.masterStrip;
      this.master.gain.setTargetAtTime(m.muted ? 0 : dbToGain(m.db), this.ctx.currentTime, 0.015);
      for (const x of this.mm.values()) x.bus.gain.setTargetAtTime(m.muted ? 0 : dbToGain(m.db), this.ctx.currentTime, 0.015);
    },
    applyAfv() {
      if (!this.ctx) return;
      for (const ch of this.channels) {
        const on = !ch.afv || ch.inputId === state.programId || onOverlay(ch.inputId) || ((tr.progress > 0 || tr.auto) && ch.inputId === state.previewId);
        ch.afvGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.06);
      }
    },
    setMonitor(on) {
      this.monitorOn = on;
      if (on) this.ensure();
      if (this.ctx) this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
      $('#btn-monitor').classList.toggle('is-active', on);
    },
    measure(analyser, obj, now) {
      analyser.getFloatTimeDomainData(this.buf);
      let peak = 0;
      for (let i = 0; i < this.buf.length; i++) { const a = Math.abs(this.buf[i]); if (a > peak) peak = a; }
      const db = peak > 0 ? 20 * Math.log10(peak) : -90;
      const dt = obj.lastAt ? (now - obj.lastAt) / 1000 : 0;
      obj.lastAt = now;
      obj.level = db > obj.level ? db : Math.max(db, obj.level - 26 * dt);
      if (db >= obj.peak || now - obj.peakAt > 1500) { obj.peak = db; obj.peakAt = now; }
      if (obj.ui && obj.ui.hbar) {
        obj.ui.hbar.style.width = `${meterPct(obj.level) * 100}%`;
        obj.ui.hbar.classList.toggle('is-hot', obj.level > -6);
        obj.ui.hpeak.style.left = `${meterPct(obj.peak) * 100}%`;
        obj.ui.hpeak.style.opacity = obj.peak > -59 ? '1' : '0';
        obj.ui.hpeak.style.background = obj.peak > -1 ? '#ef4444' : '#fff';
      } else if (obj.ui) {
        obj.ui.cover.style.height = `${(1 - meterPct(obj.level)) * 100}%`;
        obj.ui.peak.style.bottom = `${meterPct(obj.peak) * 100}%`;
        obj.ui.peak.style.opacity = obj.peak > -59 ? (obj.peak > -1 ? '1' : '.75') : '0';
        obj.ui.peak.style.background = obj.peak > -1 ? '#ef4444' : '#fff';
      }
    },
    tick(now) {
      if (!this.ctx || document.hidden) return;
      for (const ch of this.channels) this.measure(ch.analyser, ch, now);
      this.measure(this.analyser, this.masterStrip, now);
      // ไฟ LIM / COMP สว่างเมื่อกำลังลดระดับเสียงอยู่
      const lim = this.masterStrip.ui?.lim;
      if (lim) lim.classList.toggle('is-active', this.masterStrip.limiter && this.limiter.reduction < -0.5);
      for (const ch of this.channels) if (ch.ui?.fxBtn) ch.ui.fxBtn.classList.toggle('is-active', ch.fx.comp && ch.comp.reduction < -1);
    }
  };

  function renderMixer() {
    const mixer = $('#mixer');
    mixer.innerHTML = '';
    mixer.appendChild(buildStrip(audio.masterStrip, true));
    for (const ch of audio.channels) mixer.appendChild(buildStrip(ch, false));
    if (!audio.channels.length) {
      const hint = document.createElement('div');
      hint.className = 'mixer-empty';
      hint.textContent = 'ยังไม่มีช่องเสียง — กด “เพิ่มไมค์” หรือเพิ่มกล้อง/ไฟล์วิดีโอที่มีเสียง';
      mixer.appendChild(hint);
    }
  }

  function buildStrip(ch, isMaster) {
    if (phoneLayout()) return buildPhoneStrip(ch, isMaster);
    const el = document.createElement('div');
    el.className = 'strip' + (isMaster ? ' master' : '');
    el.innerHTML = `
      <div class="strip-name" title="${esc(ch.name)}">${esc(ch.name)}</div>
      <div class="strip-body">
        <div class="meter"><div class="meter-cover"></div><div class="meter-peak"></div></div>
        <div class="vfader"></div>
      </div>
      <div class="strip-db">${fmtDb(ch.db)} dB</div>
      <div class="strip-btns">
        <button class="chip-btn mute ${ch.muted ? 'is-on' : ''}" title="ปิดเสียง">M</button>
        ${isMaster ? `<button class="chip-btn lim ${ch.limiter ? 'is-on' : ''}" title="ลิมิตเตอร์ — กันเสียงแตกในไฟล์บันทึกและสตรีม (ไฟแดง = กำลังลดระดับเสียง)">LIM</button>` : ''}
        ${!isMaster && ch.inputId ? `<button class="chip-btn afv ${ch.afv ? 'is-on' : ''}" title="Audio Follow Video — เปิดเสียงเฉพาะตอนภาพนี้อยู่ใน Program">AFV</button>` : ''}
        ${!isMaster ? `<button class="chip-btn fx ${fxActive(ch) ? 'is-on' : ''}" title="ดีเลย์ / EQ / คอมเพรสเซอร์">FX</button>` : ''}
        ${!isMaster && ch.kind === 'mic' ? '<button class="chip-btn rm" title="ลบช่องเสียงนี้">✕</button>' : ''}
      </div>`;
    ch.ui = { cover: el.querySelector('.meter-cover'), peak: el.querySelector('.meter-peak'), lim: el.querySelector('.lim'), fxBtn: el.querySelector('.fx') };
    const dbEl = el.querySelector('.strip-db');
    makeFader(el.querySelector('.vfader'), {
      value: dbToPos(ch.db) * 100,
      defaultValue: 75,
      label: `${ch.name} volume`,
      onInput: v => {
        ch.db = posToDb(v / 100);
        dbEl.textContent = `${fmtDb(ch.db)} dB`;
        isMaster ? audio.applyMaster() : audio.applyGain(ch);
      }
    });
    bindStripButtons(el, ch, isMaster);
    return el;
  }

  // มือถือ: ช่องเสียงเป็นแถวแนวนอน — แถบเลื่อนยาวเต็มจอ ปุ่มปิดเสียงใหญ่ ไฟระดับเสียงอยู่หลังแถบเลื่อน
  function phoneLayout() { return matchMedia('(max-width: 760px), (pointer: coarse) and (orientation: landscape) and (max-height: 500px)').matches; }
  function buildPhoneStrip(ch, isMaster) {
    const el = document.createElement('div');
    el.className = 'strip hstrip' + (isMaster ? ' master' : '');
    el.innerHTML = `
      <div class="hs-head"><b class="strip-name" title="${esc(ch.name)}">${esc(ch.name)}</b><span class="strip-db mono">${fmtDb(ch.db)} dB</span>
        <span class="hs-btns">
          ${isMaster ? `<button class="chip-btn lim ${ch.limiter ? 'is-on' : ''}" title="ลิมิตเตอร์ — กันเสียงแตก">LIM</button>` : ''}
          ${!isMaster && ch.inputId ? `<button class="chip-btn afv ${ch.afv ? 'is-on' : ''}" title="เปิดเสียงเฉพาะตอนภาพนี้อยู่ใน Program">AFV</button>` : ''}
          ${!isMaster ? `<button class="chip-btn fx ${fxActive(ch) ? 'is-on' : ''}" title="ดีเลย์ / EQ / คอมเพรสเซอร์">FX</button>` : ''}
          ${!isMaster && ch.kind === 'mic' ? '<button class="chip-btn rm" title="ลบช่องเสียงนี้">✕</button>' : ''}
        </span></div>
      <div class="hs-row">
        <button class="chip-btn mute hs-mute ${ch.muted ? 'is-on' : ''}" title="ปิดเสียง">${icon('mic')}<span>ปิดเสียง</span></button>
        <div class="hs-fader"><div class="hs-meter"><div class="hs-level"></div><div class="hs-peak"></div></div>
          <input type="range" class="hs-range" min="0" max="100" step="0.5" value="${(dbToPos(ch.db) * 100).toFixed(1)}" aria-label="ระดับเสียง ${esc(ch.name)}"></div>
      </div>`;
    ch.ui = { hbar: el.querySelector('.hs-level'), hpeak: el.querySelector('.hs-peak'), lim: el.querySelector('.lim'), fxBtn: el.querySelector('.fx') };
    const dbEl = el.querySelector('.strip-db');
    el.querySelector('.hs-range').addEventListener('input', e => {
      ch.db = posToDb(+e.target.value / 100);
      dbEl.textContent = `${fmtDb(ch.db)} dB`;
      isMaster ? audio.applyMaster() : audio.applyGain(ch);
    });
    // แตะสองครั้งที่แถบเลื่อน = กลับไป 0 dB
    el.querySelector('.hs-range').addEventListener('dblclick', e => {
      e.target.value = 75;
      e.target.dispatchEvent(new Event('input'));
    });
    bindStripButtons(el, ch, isMaster);
    return el;
  }

  function bindStripButtons(el, ch, isMaster) {
    el.querySelector('.mute').addEventListener('click', e => {
      audio.ensure();
      ch.muted = !ch.muted;
      e.currentTarget.classList.toggle('is-on', ch.muted);
      isMaster ? audio.applyMaster() : audio.applyGain(ch);
    });
    el.querySelector('.lim')?.addEventListener('click', e => {
      audio.ensure();
      audio.setLimiter(!audio.masterStrip.limiter);
      e.currentTarget.classList.toggle('is-on', audio.masterStrip.limiter);
      toast(audio.masterStrip.limiter ? 'เปิดลิมิตเตอร์ที่ Master' : 'ปิดลิมิตเตอร์ — ระวังเสียงแตกเมื่อระดับเกิน 0 dB', audio.masterStrip.limiter ? 'success' : 'warn');
    });
    el.querySelector('.fx')?.addEventListener('click', () => openChannelFx(ch));
    el.querySelector('.afv')?.addEventListener('click', e => {
      ch.afv = !ch.afv;
      e.currentTarget.classList.toggle('is-on', ch.afv);
      audio.applyAfv();
    });
    el.querySelector('.rm')?.addEventListener('click', async () => {
      if (await confirmDialog(`ลบช่องเสียง “${ch.name}”`, 'ไมค์นี้จะถูกปิดและนำออกจากมิกเซอร์', 'ลบ')) audio.remove(ch);
    });
  }

  const fxActive = ch => ch.fx && (ch.fx.delayMs || ch.fx.low || ch.fx.mid || ch.fx.high || ch.fx.comp);

  // หน้าต่างปรับเสียงต่อช่อง — เปลี่ยนค่าแล้วได้ยินผลทันที
  function openChannelFx(ch) {
    const f = ch.fx;
    const row = (key, label, min, max, step, unit) => `
      <label class="field fx-row"><span>${label}: <b class="mono" data-val="${key}">${f[key] > 0 && unit === 'dB' ? '+' : ''}${f[key]} ${unit}</b></span>
        <input class="range" type="range" data-fx="${key}" min="${min}" max="${max}" step="${step}" value="${f[key]}"></label>`;
    dialog({
      title: `ปรับเสียง — ${ch.name}`,
      body: `
        <div class="help"><h3>ดีเลย์ (ให้เสียงตรงกับภาพ)</h3></div>
        ${row('delayMs', 'หน่วงเสียง', 0, 500, 10, 'ms')}
        <div class="help"><h3>EQ</h3></div>
        ${row('low', 'เสียงต่ำ (120 Hz)', -12, 12, 0.5, 'dB')}
        ${row('mid', 'เสียงกลาง (1 kHz)', -12, 12, 0.5, 'dB')}
        ${row('high', 'เสียงสูง (8 kHz)', -12, 12, 0.5, 'dB')}
        <div class="help"><h3>คอมเพรสเซอร์ (เกลี่ยระดับเสียงพูดให้สม่ำเสมอ)</h3></div>
        <label class="check"><input type="checkbox" data-fx="comp" ${f.comp ? 'checked' : ''}> เปิดคอมเพรสเซอร์</label>
        ${row('threshold', 'Threshold', -50, 0, 1, 'dB')}
        ${row('ratio', 'Ratio', 1, 20, 0.5, ': 1')}`,
      actions: [{ label: 'รีเซ็ต', value: 'reset' }, { label: 'เสร็จสิ้น', primary: true }],
      onOpen(modal) {
        modal.addEventListener('input', e => {
          const key = e.target.dataset.fx;
          if (!key) return;
          f[key] = e.target.type === 'checkbox' ? e.target.checked : +e.target.value;
          const label = $(`[data-val="${key}"]`, modal);
          if (label) label.textContent = `${f[key] > 0 && /low|mid|high|threshold/.test(key) ? '+' : ''}${f[key]} ${key === 'delayMs' ? 'ms' : key === 'ratio' ? ': 1' : 'dB'}`;
          audio.applyFx(ch);
          ch.ui?.fxBtn?.classList.toggle('is-on', !!fxActive(ch));
        });
      }
    }).then(r => {
      if (r?.value !== 'reset') return;
      Object.assign(f, { delayMs: 0, low: 0, mid: 0, high: 0, comp: false, threshold: -18, ratio: 4 });
      audio.applyFx(ch);
      ch.ui?.fxBtn?.classList.toggle('is-on', false);
      toast(`รีเซ็ตการปรับเสียงของ “${ch.name}” แล้ว`);
    });
  }

  /* ----------------------------------------------------------- fader UI */
  function makeFader(el, { min = 0, max = 100, value = 0, defaultValue = null, onInput, label = '' }) {
    el.innerHTML = '<div class="vf-scale"></div><div class="vf-track"><div class="vf-fill"></div></div><div class="vf-thumb"></div>';
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-valuemin', min);
    el.setAttribute('aria-valuemax', max);
    if (label) el.setAttribute('aria-label', label);
    const thumb = el.querySelector('.vf-thumb'), fill = el.querySelector('.vf-fill');
    let current = value;
    const paint = () => {
      const p = (current - min) / (max - min);
      thumb.style.bottom = `calc(10px + (100% - 20px) * ${p})`;
      fill.style.height = `${p * 100}%`;
      el.setAttribute('aria-valuenow', Math.round(current));
    };
    const set = (v, emit) => {
      v = clamp(v, min, max);
      if (v === current && !emit) return;
      current = v;
      paint();
      if (emit) onInput(v);
    };
    const fromEvent = e => {
      const r = el.getBoundingClientRect();
      const p = 1 - (e.clientY - r.top - 10) / (r.height - 20);
      return min + clamp(p, 0, 1) * (max - min);
    };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      set(fromEvent(e), true);
      const move = ev => set(fromEvent(ev), true);
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('keydown', e => {
      const step = (max - min) / (e.shiftKey ? 10 : 50);
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(current + step, true); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(current - step, true); e.preventDefault(); e.stopPropagation(); }
    });
    if (defaultValue != null) el.addEventListener('dblclick', () => set(defaultValue, true));
    paint();
    return { set: v => set(v, false) };
  }

  /* ----------------------------------------------------------- wireless */
  const wireless = {
    peer: null, status: 'offline', link: '', conns: new Map(), blocked: new Set(), sig: null, peerId: '',

    // ถ้าตั้ง Stream Gateway ไว้ ใช้ PeerJS + TURN ของ Gateway (มือถือเน็ต 4G/5G เชื่อมต่อได้)
    // ไม่เช่นนั้นใช้เซิร์ฟเวอร์ PeerJS สาธารณะ
    async fetchSig() {
      if (gatewayProblem()) return null;
      try {
        const u = new URL(gatewayUrl());
        u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
        u.pathname = '/ice';
        const res = await fetch(u.toString(), { cache: 'no-store' });
        if (!res.ok) return null;
        const j = await res.json();
        const sig = {};
        if (j.peer) Object.assign(sig, { h: j.peer.host, p: j.peer.port, s: j.peer.secure ? 1 : 0, pa: j.peer.path });
        if (j.turn) Object.assign(sig, { th: j.turn.host, tp: j.turn.port, u: j.turn.username, c: j.turn.credential });
        return Object.keys(sig).length ? sig : null;
      } catch (e) { return null; }
    },
    async init() {
      let id = store.raw('webmix-host-id');
      if (!id) { id = 'webmix-' + uid().slice(0, 6); store.setRaw('webmix-host-id', id); }
      if (desktop) await desktop.ready;
      this.sig = await this.fetchSig();
      this.create(id, 0);
    },
    async restart() {
      if (this.peer && !this.peer.destroyed) this.peer.destroy();
      this.conns.clear();
      await this.init();
    },
    // ต่ออายุรหัส TURN ในลิงก์/QR (ไม่ต้องเปลี่ยน ID ของสตูดิโอ)
    async refreshLink() {
      if (!this.sig) return;
      const fresh = await this.fetchSig();
      if (fresh && fresh.h === this.sig.h && fresh.p === this.sig.p) { this.sig = fresh; this.buildLink(); }
    },
    buildLink() {
      const base = `${pageBase()}?call=${encodeURIComponent(this.peerId)}`;
      this.link = this.sig ? `${base}&sig=${b64url(JSON.stringify(this.sig))}` : base;
    },
    create(id, attempt) {
      if (typeof Peer === 'undefined') { this.status = 'unavailable'; updateStatus(); return; }
      const peer = new Peer(id, peerOptionsFromSig(this.sig));
      this.peer = peer;
      this.status = 'connecting';
      peer.on('open', openId => {
        this.status = 'ready';
        this.peerId = openId;
        this.buildLink();
        updateStatus();
      });
      peer.on('disconnected', () => {
        this.status = 'connecting';
        updateStatus();
        setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
      });
      peer.on('error', err => {
        if (err.type === 'unavailable-id') {
          // หลังรีเฟรช เซิร์ฟเวอร์อาจยังจอง ID เดิมไว้สักครู่ — ลองใหม่ก่อน ถ้ายังไม่ได้ (เช่นเปิดซ้อน 2 แท็บ) ใช้ ID ชั่วคราว
          peer.destroy();
          if (attempt < 3) setTimeout(() => this.create(id, attempt + 1), 2000);
          else this.create('webmix-' + uid().slice(0, 6), 99);
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          this.status = 'offline';
        }
        updateStatus();
      });
      peer.on('call', call => this.onCall(call));
      peer.on('connection', conn => this.onData(conn));
    },
    onCall(call) {
      if (this.blocked.has(call.peer)) { call.close(); return; }
      if (call.metadata && call.metadata.guest) { this.onGuestCall(call, String(call.metadata.guest)); return; }
      call.answer();
      call.on('stream', remote => {
        let inp = inputs.find(i => i.peerId === call.peer);
        if (inp && inp.stream === remote) return;
        if (inp) {
          inp.stream = remote;
          inp.missing = false;
          inp.el.srcObject = remote;
          inp.el.play().catch(() => {});
          setInputStatus(inp, 'live');
          audio.replaceStream(inp, remote);
        } else {
          const n = inputs.filter(i => i.type === 'wireless').length + 1;
          inp = addStreamInput(remote, { type: 'wireless', name: `MOBILE ${n}`, peerId: call.peer });
          toast(`${inp.name} เชื่อมต่อแล้ว`, 'success');
        }
        inp.call = call;
        updateStatus();
        this.sendTally();
      });
      const lost = () => {
        const inp = inputs.find(i => i.peerId === call.peer);
        if (inp && inp.call === call) { setInputStatus(inp, 'nosignal'); updateStatus(); }
      };
      call.on('close', lost);
      call.peerConnection?.addEventListener('connectionstatechange', () => {
        const st = call.peerConnection.connectionState;
        if (st === 'failed' || st === 'closed') lost();
      });
    },
    // แขกรับเชิญ: รับภาพ/เสียงของแขก และส่งภาพรายการ + เสียง mix-minus กลับไป
    onGuestCall(call, slot) {
      const inp = inputs.find(i => i.type === 'guest' && i.guest === slot);
      if (!inp || call.peer !== guestPeerId(slot)) { call.answer(); setTimeout(() => call.close(), 300); return; }
      if (inp.call && inp.call !== call) { try { inp.call.close(); } catch (e) {} }
      inp.call = call;
      call.answer(guestReturnStream(inp));
      call.on('stream', remote => {
        if (inp.removed || inp.call !== call || inp.stream === remote) return;
        const first = !inp.joinedOnce;
        inp.joinedOnce = true;
        attachStream(inp, remote);
        tuneGuestReturn(call);
        if (first) toast(`${inp.name} เข้าร่วมแล้ว`, 'success');
        updateStatus();
        this.sendTally();
      });
      const lost = () => { if (inp.call === call && !inp.removed) { setInputStatus(inp, 'nosignal'); updateStatus(); } };
      call.on('close', lost);
      call.peerConnection?.addEventListener('connectionstatechange', () => {
        const st = call.peerConnection.connectionState;
        if (st === 'failed' || st === 'closed') lost();
      });
    },
    onData(conn) {
      if (this.blocked.has(conn.peer)) {
        conn.on('open', () => { conn.send({ type: 'removed' }); setTimeout(() => conn.close(), 500); });
        return;
      }
      this.conns.set(conn.peer, conn);
      conn.on('open', () => this.sendTallyTo(conn));
      conn.on('close', () => { if (this.conns.get(conn.peer) === conn) this.conns.delete(conn.peer); });
    },
    sendTallyTo(conn) {
      if (!conn.open) return;
      const inp = inputs.find(i => i.peerId === conn.peer);
      const tally = !inp ? 'off' : isOnAir(inp.id) ? 'pgm' : inp.id === state.previewId ? 'pvw' : 'off';
      try { conn.send({ type: 'tally', tally }); } catch (e) {}
    },
    sendTally() { for (const conn of this.conns.values()) this.sendTallyTo(conn); },
    release(peerId) {
      this.blocked.add(peerId);
      const conn = this.conns.get(peerId);
      if (conn && conn.open) { try { conn.send({ type: 'removed' }); } catch (e) {} }
      const inp = inputs.find(i => i.peerId === peerId);
      if (inp && inp.call) inp.call.close();
    },
    connectedCount() { return inputs.filter(i => i.type === 'wireless' && i.status === 'live').length; },
    guestLink(inp) {
      const q = new URLSearchParams({ call: this.peerId, guest: inp.guest, n: inp.name });
      if (this.sig) q.set('sig', b64url(JSON.stringify(this.sig)));
      return `${pageBase()}?${q}`;
    }
  };

  /* ------------------------------------------------------ SRT input */
  // รับสัญญาณ SRT (จาก OBS / vMix / encoder / กล้อง) ผ่าน Stream Gateway แล้วเล่นด้วย mpegts.js
  const SRT_IN_STATES = { waiting: 'WAITING', connecting: 'CONNECTING', error: 'NO SIGNAL', offline: 'OFFLINE' };
  let mpegtsLoading = null;
  function loadMpegts() {
    if (window.mpegts) return Promise.resolve(window.mpegts);
    if (!mpegtsLoading) {
      mpegtsLoading = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'assets/vendor/mpegts-1.7.3.min.js';
        el.onload = () => resolve(window.mpegts);
        el.onerror = () => { mpegtsLoading = null; reject(new Error('โหลดตัวเล่น SRT ไม่สำเร็จ')); };
        document.head.appendChild(el);
      });
    }
    return mpegtsLoading;
  }

  function gatewayEndpoint(path, extra = {}) {
    const u = new URL(gatewayUrl());
    u.pathname = path;
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return u.toString();
  }

  function saveSrtInputs() {
    settings.srtInputs = inputs.filter(i => i.type === 'srt').map(i => ({ ...i.srt, name: i.name }));
    saveSettings();
  }

  // ที่อยู่สำหรับใส่ใน OBS / vMix (โหมด listener: ผู้ส่งเป็นฝ่ายเชื่อมต่อเข้ามาที่ Gateway)
  function srtSenderUrl(cfg) {
    let host = '';
    try { host = new URL(gatewayUrl()).hostname; } catch (e) {}
    let url = `srt://${host}:${cfg.port}?mode=caller&latency=${cfg.latency * 1000}`;
    if (cfg.passphrase) url += `&passphrase=${cfg.passphrase}&pbkeylen=16`;
    return url;
  }

  async function openSrtInputDialog() {
    const gwErr = gatewayProblem();
    if (gwErr) { toast(`${gwErr} — การรับสัญญาณ SRT ต้องใช้ Stream Gateway`, 'warn'); openSettings('stream'); return; }
    const used = inputs.filter(i => i.type === 'srt' && i.srt.mode === 'listener').map(i => i.srt.port);
    const port = [9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009].find(p => !used.includes(p)) || 9000;
    const n = inputs.filter(i => i.type === 'srt').length + 1;
    const result = await dialog({
      title: 'เพิ่มสัญญาณ SRT',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="32" value="SRT ${n}"></label>
        <div class="field"><span>วิธีรับสัญญาณ</span>
          <div class="seg srt-mode"><button type="button" data-value="listener" class="is-active">รอรับ (ผู้ส่งเชื่อมต่อเข้ามา)</button><button type="button" data-value="caller">ดึงจาก SRT Server</button></div>
        </div>
        <div class="srt-listener">
          <label class="field"><span>พอร์ต UDP บน Gateway</span><input name="port" class="input mono" type="number" min="1" max="65535" value="${port}"></label>
          <p class="note">ให้ OBS / vMix / encoder ส่ง SRT แบบ <b>caller</b> มาที่เซิร์ฟเวอร์ Gateway พอร์ตนี้ (ค่าเริ่มต้นรองรับพอร์ต 9000–9009 และต้องเปิดพอร์ต UDP ในไฟร์วอลล์ของเซิร์ฟเวอร์)</p>
        </div>
        <div class="srt-caller" hidden>
          <label class="field"><span>SRT URL ของต้นทาง (ต้นทางต้องเป็นโหมด listener)</span><input name="url" class="input mono" placeholder="srt://encoder.example.com:9000"></label>
          <label class="field"><span>Stream ID (ถ้ามี)</span><input name="streamid" class="input mono" placeholder="เช่น #!::r=live/cam1,m=request"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>รหัสผ่านเข้ารหัส (ถ้ามี, 10–64 ตัว)</span><input name="passphrase" class="input mono" type="password" autocomplete="off"></label>
          <label class="field"><span>Latency</span><select name="latency" class="select">
            ${SRT_LATENCIES.map(ms => `<option value="${ms}" ${ms === 500 ? 'selected' : ''}>${ms} ms</option>`).join('')}
          </select></label>
        </div>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'เพิ่มแหล่งภาพ', primary: true, value: 'add' }],
      onOpen(modal) {
        let mode = 'listener';
        const seg = $('.srt-mode', modal);
        seg.addEventListener('click', e => {
          const b = e.target.closest('button');
          if (!b) return;
          mode = b.dataset.value;
          $$('button', seg).forEach(x => x.classList.toggle('is-active', x === b));
          $('.srt-listener', modal).hidden = mode !== 'listener';
          $('.srt-caller', modal).hidden = mode !== 'caller';
          modal.dataset.mode = mode;
        });
        modal.dataset.mode = mode;
      }
    });
    if (result?.value !== 'add') return;
    const f = result.form;
    const mode = f.url.closest('.modal').dataset.mode || 'listener';
    const cfg = {
      mode,
      port: +f.port.value || 9000,
      url: f.url.value.trim(),
      streamid: f.streamid.value.trim(),
      passphrase: f.passphrase.value,
      latency: +f.latency.value || 500
    };
    if (cfg.passphrase && (cfg.passphrase.length < 10 || cfg.passphrase.length > 64)) { toast('รหัสผ่าน SRT ต้องยาว 10–64 ตัวอักษร', 'warn'); return; }
    if (mode === 'caller' && !SRT_RE.test(cfg.url)) { toast('SRT URL ต้องอยู่ในรูปแบบ srt://host:port', 'warn'); return; }
    if (mode === 'listener' && inputs.some(i => i.type === 'srt' && i.srt.mode === 'listener' && i.srt.port === cfg.port)) {
      toast(`พอร์ต ${cfg.port} ถูกใช้โดยแหล่งภาพอื่นแล้ว`, 'warn'); return;
    }
    const inp = createSrtInput(cfg, f.name.value.trim() || 'SRT');
    saveSrtInputs();
    if (mode === 'listener') showSrtSenderInfo(inp);
  }

  function createSrtInput(cfg, name, extra = {}) {
    const v = document.createElement('video');
    v.playsInline = true; v.autoplay = true; v.muted = false;
    v.disableRemotePlayback = true;
    pool.appendChild(v);
    const inp = addInput({ type: 'srt', name, el: v, status: 'nosignal', srt: cfg, srtState: 'connecting', ...extra });
    v.addEventListener('playing', () => setInputStatus(inp, 'live'));
    audio.addElement(inp, v);
    connectSrtInput(inp);
    return inp;
  }

  function connectSrtInput(inp) {
    if (inp.removed) return;
    clearTimeout(inp.srtRetry);
    if (gatewayProblem()) { inp.srtState = 'offline'; inp.srtMessage = 'ยังไม่ได้ตั้งค่า Stream Gateway'; return; }
    const ws = new WebSocket(gatewayEndpoint('/srt-in'));
    inp.srtCtl = ws;
    inp.srtState = 'connecting';
    ws.onopen = () => {
      const c = inp.srt;
      ws.send(JSON.stringify({ type: 'open', mode: c.mode, port: c.port, url: c.url, streamid: c.streamid, passphrase: c.passphrase, latency: c.latency }));
    };
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'opened') {
        inp.srtSession = msg.id;
      } else if (msg.type === 'status') {
        const prev = inp.srtState;
        inp.srtState = msg.state;
        inp.srtMessage = msg.message || '';
        inp.srtInfo = msg.info || null;
        if (msg.state === 'live') {
          startSrtPlayer(inp);
          if (prev !== 'live') toast(`${inp.name}: รับสัญญาณ SRT แล้ว${msg.info ? ` (${msg.info.width}×${msg.info.height}${msg.transcode ? `, แปลง ${msg.info.codec.toUpperCase()} → H.264` : ''})` : ''}`, 'success', 3500);
        } else {
          stopSrtPlayer(inp);
          setInputStatus(inp, 'nosignal');
        }
      } else if (msg.type === 'error') {
        inp.srtFatal = true;
        inp.srtState = 'error';
        inp.srtMessage = msg.message;
        toast(`${inp.name}: ${msg.message}`, 'error', 7000);
      }
    };
    ws.onclose = () => {
      if (inp.srtCtl !== ws) return;
      stopSrtPlayer(inp);
      setInputStatus(inp, 'nosignal');
      if (inp.removed) return;
      if (inp.srtFatal) { inp.srtFatal = false; inp.srtState = 'error'; return; }
      // Gateway ปิด/รีสตาร์ท — ลองเชื่อมต่อใหม่เรื่อย ๆ
      inp.srtState = 'offline';
      inp.srtRetry = setTimeout(() => connectSrtInput(inp), 5000);
    };
  }

  async function startSrtPlayer(inp) {
    if (inp.player || inp.playerStarting || !inp.srtSession) return;
    inp.playerStarting = true;
    let mpegts;
    try { mpegts = await loadMpegts(); }
    catch (e) { toast(e.message, 'error'); inp.playerStarting = false; return; }
    inp.playerStarting = false;
    if (inp.removed || inp.srtState !== 'live' || inp.player) return;
    // iPhone (iOS 17.1+) มี ManagedMediaSource แทน MediaSource
    if (!window.MediaSource && window.ManagedMediaSource) window.MediaSource = window.ManagedMediaSource;
    // Gateway ส่งภาพเป็น H.264 + AAC เสมอ — Chromium บางรุ่น (ไม่มี codec เชิงพาณิชย์) ถอดรหัสไม่ได้
    if (window.MediaSource && !window.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"')) {
      if (!inp.codecWarned) {
        inp.codecWarned = true;
        toast('เบราว์เซอร์นี้ถอดรหัสวิดีโอ H.264 ไม่ได้ จึงแสดงสัญญาณ SRT ไม่ได้ — ใช้ Chrome, Edge, Safari หรือ Firefox', 'error', 9000);
      }
      return;
    }
    if (!mpegts.isSupported()) { toast('เบราว์เซอร์นี้เล่นสัญญาณ SRT ไม่ได้ (ต้องรองรับ Media Source Extensions)', 'error'); return; }
    if (mpegts.LoggingControl) mpegts.LoggingControl.enableAll = false;
    const player = mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url: gatewayEndpoint('/srt-in/data', { id: inp.srtSession }) },
      { enableWorker: false, enableStashBuffer: false, lazyLoad: false, autoCleanupSourceBuffer: true,
        liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 1.2, liveBufferLatencyMinRemain: 0.2 }
    );
    inp.player = player;
    player.attachMediaElement(inp.el);
    player.on(mpegts.Events.ERROR, () => {
      if (inp.player !== player) return;
      stopSrtPlayer(inp);
      setTimeout(() => { if (inp.srtState === 'live') startSrtPlayer(inp); }, 1500);
    });
    player.load();
    inp.el.play().catch(() => { inp.el.muted = true; inp.el.play().catch(() => {}); });
  }

  function stopSrtPlayer(inp) {
    const player = inp.player;
    inp.player = null;
    if (!player) return;
    try { player.pause(); player.unload(); player.detachMediaElement(); player.destroy(); } catch (e) {}
  }

  function closeSrtInput(inp) {
    inp.removed = true;
    clearTimeout(inp.srtRetry);
    stopSrtPlayer(inp);
    if (inp.srtCtl) { const ws = inp.srtCtl; inp.srtCtl = null; ws.close(1000, 'removed'); }
  }

  function showSrtSenderInfo(inp) {
    const c = inp.srt;
    let host = '';
    try { host = new URL(gatewayUrl()).hostname; } catch (e) {}
    const url = srtSenderUrl(c);
    dialog({
      title: `ตั้งค่าผู้ส่งสำหรับ “${inp.name}”`,
      body: `
        <p class="modal-text">ใส่ค่าด้านล่างในโปรแกรม/อุปกรณ์ที่จะส่งภาพเข้ามา แล้วกดเริ่มส่ง ภาพจะขึ้นในแหล่งภาพนี้อัตโนมัติ</p>
        <label class="field"><span>OBS → ตั้งค่า → สตรีม → บริการ “กำหนดเอง” → เซิร์ฟเวอร์</span>
          <div class="link-row"><input class="input" readonly value="${esc(url)}"><button type="button" class="btn btn-icon srt-copy" title="คัดลอก">${icon('copy')}</button></div></label>
        <div class="kbd-grid">
          <div class="kbd-row"><span>Host / Address</span><kbd>${esc(host)}</kbd></div>
          <div class="kbd-row"><span>Port (UDP)</span><kbd>${c.port}</kbd></div>
          <div class="kbd-row"><span>Mode</span><kbd>Caller</kbd></div>
          <div class="kbd-row"><span>Latency</span><kbd>${c.latency} ms</kbd></div>
          <div class="kbd-row"><span>Passphrase</span><kbd>${c.passphrase ? 'ตามที่ตั้งไว้ (AES-128)' : 'ไม่มี'}</kbd></div>
          <div class="kbd-row"><span>Codec ที่แนะนำ</span><kbd>H.264 + AAC</kbd></div>
        </div>
        <p class="note">ต้องเปิดพอร์ต <b>UDP ${c.port}</b> ในไฟร์วอลล์ของเซิร์ฟเวอร์ Gateway · ถ้าส่งเป็น H.265/HEVC ระบบจะแปลงเป็น H.264 ให้อัตโนมัติ (ใช้ CPU ของเซิร์ฟเวอร์มากขึ้น)${c.passphrase && /[&#?\s]/.test(c.passphrase) ? ' · รหัสผ่านนี้มีอักขระ & # ? หรือช่องว่าง ซึ่ง OBS อ่านจาก URL ไม่ได้ — ควรเปลี่ยนรหัสผ่าน' : ''}</p>`,
      actions: [{ label: 'ปิด', primary: true }],
      onOpen(modal) {
        $('.srt-copy', modal).addEventListener('click', () => {
          (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
            .then(() => toast('คัดลอกแล้ว', 'success'))
            .catch(() => toast('คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง', 'warn'));
        });
      }
    });
  }

  /* ---------------------------------------------------- remote guests (vMix Call) */
  const guestPeerId = slot => 'webmix-g-' + slot;
  // ภาพรายการที่ส่งกลับให้แขก: จับภาพ Program แยกต่อแขก (ไม่ผูกกับการบันทึก/สตรีม) + เสียง mix-minus
  function guestReturnStream(inp) {
    if (!inp.returnVideo || inp.returnVideo.readyState === 'ended') inp.returnVideo = pgmCanvas.captureStream(Math.min(30, settings.fps)).getVideoTracks()[0];
    const tracks = [inp.returnVideo];
    const mm = audio.mixMinus(inp.id);
    if (mm) tracks.push(...mm.getAudioTracks());
    return new MediaStream(tracks.filter(Boolean));
  }
  // ภาพส่งกลับไม่ต้องคมเท่ารายการจริง: ย่อเหลือ ~720p และจำกัดบิตเรต แขกที่เน็ตช้าก็ดูได้ลื่น
  async function tuneGuestReturn(call) {
    const sender = call.peerConnection?.getSenders().find(x => x.track && x.track.kind === 'video');
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 1500000;
      params.encodings[0].maxFramerate = 30;
      params.encodings[0].scaleResolutionDownBy = Math.max(1, H / 720);
      await sender.setParameters(params);
    } catch (e) {}
  }

  async function addGuest() {
    if (wireless.status !== 'ready') { toast('ระบบเชื่อมต่อยังไม่พร้อม — รอสักครู่แล้วลองใหม่ (ดูสถานะ WIRELESS ด้านล่าง)', 'warn'); return; }
    const n = inputs.filter(i => i.type === 'guest').length + 1;
    const result = await dialog({
      title: 'เชิญแขกรับเชิญทางไกล',
      body: `
        <label class="field"><span>ชื่อแขก (แสดงบนการ์ดและหน้าของแขก)</span><input name="name" class="input" maxlength="32" value="GUEST ${n}"></label>
        <p class="note">แขกเปิดลิงก์จากมือถือหรือคอมพิวเตอร์ (ไม่ต้องติดตั้งแอป) ส่งกล้อง+ไมค์เข้ามาเป็นแหล่งภาพและเห็น/ได้ยินรายการจากสตูดิโอ
          โดยไม่ได้ยินเสียงตัวเองย้อนกลับ (mix-minus) · แต่ละลิงก์ใช้ได้กับแขกคนเดียว</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'สร้างลิงก์เชิญ', primary: true, value: 'add' }]
    });
    if (result?.value !== 'add') return;
    const slot = uid() + uid().slice(0, 4);
    const inp = addInput({ type: 'guest', name: result.form.name.value.trim().slice(0, 32) || `GUEST ${n}`, guest: slot, peerId: guestPeerId(slot),
      el: createVideo(null), status: 'nosignal', missing: true });
    audio.mixMinus(inp.id);
    showGuestInvite(inp);
  }

  async function showGuestInvite(inp) {
    await wireless.refreshLink();
    const link = wireless.guestLink(inp);
    await dialog({
      title: `ลิงก์เชิญ — ${inp.name}`,
      body: `
        <p class="modal-text">ส่งลิงก์นี้ให้แขก (LINE / อีเมล) หรือให้สแกน QR Code — แขกกด “เข้าร่วม” แล้วอนุญาตกล้อง/ไมค์</p>
        <div class="qr-box" id="qr-target"></div>
        <div class="link-row"><input class="input" id="guest-link" readonly value="${esc(link)}"><button type="button" class="btn btn-icon" id="copy-link" title="คัดลอกลิงก์">${icon('copy')}</button></div>
        <p class="note">สถานะ: <b>${inp.status === 'live' ? 'เชื่อมต่ออยู่' : 'ยังไม่ได้เข้าร่วม'}</b> · แนะนำให้แขกใส่หูฟัง · ${wireless.sig && wireless.sig.u
          ? 'เชื่อมต่อผ่าน TURN ของ Stream Gateway — แขกที่ใช้ 4G/5G หรือ Wi-Fi บริษัทเข้าร่วมได้ (ลิงก์ใช้ได้ 7 วัน)'
          : 'ยังไม่ได้ตั้ง Stream Gateway — แขกบางเครือข่าย (4G/5G, Wi-Fi บริษัท) อาจเชื่อมต่อไม่ได้'}</p>`,
      actions: [{ label: 'ปิด', primary: true }],
      onOpen(modal) {
        const target = $('#qr-target', modal);
        if (target && typeof QRCode !== 'undefined') new QRCode(target, { text: link, width: 196, height: 196, correctLevel: QRCode.CorrectLevel.L });
        else if (target) target.remove();
        $('#copy-link', modal).addEventListener('click', () => {
          const field = $('#guest-link', modal);
          (navigator.clipboard ? navigator.clipboard.writeText(field.value) : Promise.reject())
            .then(() => toast('คัดลอกลิงก์แล้ว', 'success'))
            .catch(() => { field.select(); document.execCommand('copy'); toast('คัดลอกลิงก์แล้ว', 'success'); });
        });
      }
    });
  }

  async function showWirelessDialog() {
    await wireless.refreshLink();
    const insecure = location.protocol === 'file:' || !window.isSecureContext || (location.protocol !== 'https:' && !/^(localhost|127\.)/.test(location.hostname));
    const ready = wireless.status === 'ready';
    await dialog({
      title: 'เชื่อมต่อกล้องมือถือ',
      body: `
        <p class="modal-text">ใช้มือถือหรือแท็บเล็ตสแกน QR Code แล้วกดอนุญาตให้ใช้กล้อง ภาพและเสียงจะเข้ามาเป็นแหล่งภาพใหม่อัตโนมัติ (เชื่อมต่อได้หลายเครื่อง)</p>
        ${insecure ? '<p class="note warn">หน้านี้ไม่ได้เปิดผ่าน HTTPS มือถือจะไม่อนุญาตให้ใช้กล้อง — เปิดผ่าน GitHub Pages หรือเว็บเซิร์ฟเวอร์ HTTPS</p>' : ''}
        ${ready ? `
          <div class="qr-box" id="qr-target"></div>
          <div class="link-row"><input class="input" id="wireless-link" readonly value="${esc(wireless.link)}"><button type="button" class="btn btn-icon" id="copy-link" title="คัดลอกลิงก์">${icon('copy')}</button></div>
          <p class="note">มือถือจะเห็นไฟ Tally สีแดงเมื่อภาพของตัวเองออกอากาศ · ${wireless.sig && wireless.sig.u
            ? 'เชื่อมต่อผ่าน Stream Gateway พร้อม TURN — มือถือที่ใช้ 4G/5G ส่งภาพได้ (ลิงก์นี้ใช้ได้ 7 วัน เปิดหน้าต่างนี้ใหม่เพื่อต่ออายุ)'
            : 'ใช้เซิร์ฟเวอร์สาธารณะ — มือถือที่ใช้ 4G/5G หรือ Wi-Fi บางเครือข่ายอาจเชื่อมต่อไม่ได้ ตั้งค่า Stream Gateway เพื่อเปิดใช้ TURN'}</p>`
        : `<p class="note warn">${wireless.status === 'unavailable' ? 'โหลดระบบเชื่อมต่อ (PeerJS) ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า' : 'กำลังเชื่อมต่อเซิร์ฟเวอร์ — ลองเปิดหน้าต่างนี้อีกครั้งในไม่กี่วินาที'}</p>`}
        <p class="modal-text">เชื่อมต่ออยู่ <b>${wireless.connectedCount()}</b> เครื่อง</p>`,
      actions: [{ label: 'ปิด', primary: true }],
      onOpen(modal) {
        const target = $('#qr-target', modal);
        if (target && typeof QRCode !== 'undefined') {
          new QRCode(target, { text: wireless.link, width: 196, height: 196, correctLevel: QRCode.CorrectLevel.M });
        } else if (target) {
          target.remove();
        }
        $('#copy-link', modal)?.addEventListener('click', () => {
          const field = $('#wireless-link', modal);
          (navigator.clipboard ? navigator.clipboard.writeText(field.value) : Promise.reject())
            .then(() => toast('คัดลอกลิงก์แล้ว', 'success'))
            .catch(() => { field.select(); document.execCommand('copy'); toast('คัดลอกลิงก์แล้ว', 'success'); });
        });
      }
    });
  }

  /* ---------------------------------------------------- output (rec/stream) */
  const output = {
    stream: null,
    get() {
      if (!this.stream) {
        audio.ensure();
        const video = pgmCanvas.captureStream(settings.fps).getVideoTracks();
        const sound = audio.dest ? audio.dest.stream.getAudioTracks() : [];
        this.stream = new MediaStream([...video, ...sound]);
      }
      return this.stream;
    },
    reset() {
      if (this.stream && !rec.active && !streamer.active) {
        this.stream.getVideoTracks().forEach(t => t.stop());
        this.stream = null;
      }
    }
  };

  // 1440p/4K: ใช้ H.264 ก่อน เพราะคอมพิวเตอร์ส่วนใหญ่มีชิปเข้ารหัส H.264 ในตัว (VP9 มักเข้ารหัสด้วย CPU จึงหนักมากที่ 4K)
  // ไฟล์บันทึกใช้ MP4, การสตรีมใช้ WebM (ส่งผ่าน Gateway ได้ทันทีโดยไม่ต้องรอส่วนหัวไฟล์)
  function pickMime(purpose = 'record') {
    if (!window.MediaRecorder) return null;
    const h264 = purpose === 'stream'
      ? ['video/webm;codecs=h264,opus', 'video/webm;codecs=avc1,opus']
      : ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=h264,opus'];
    const vpx = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const rest = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
    const list = H >= 1440 ? [...h264, ...vpx, ...rest] : [...vpx, ...h264, ...rest];
    return list.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function makeRecorder(purpose = 'record') {
    // WebKitGTK (Linux): MediaRecorder เขียนไฟล์เสีย → เข้ารหัสด้วย WebCodecs แล้วเขียน WebM เอง
    const wcrec = window.WebMix.wcrec;
    if (wcrec && wcrec.preferred()) {
      audio.ensure();
      return wcrec.recorder({
        canvas: pgmCanvas, audioNode: audio.post || null, fps: settings.fps,
        videoBitsPerSecond: settings.videoKbps * 1000, audioBitsPerSecond: 160000,
        // H.264 เบากว่า VP8 มากที่ความละเอียดสูง · สตรีมใช้ H.264 เสมอ (Gateway ถอดรหัสได้เร็ว)
        preferAvc: purpose === 'stream' || H >= 1080
      });
    }
    const mime = pickMime(purpose);
    if (mime === null) throw new Error('เบราว์เซอร์นี้ไม่รองรับการบันทึกวิดีโอ (MediaRecorder)');
    const opts = { videoBitsPerSecond: settings.videoKbps * 1000, audioBitsPerSecond: 160000 };
    if (mime) opts.mimeType = mime;
    return new MediaRecorder(output.get(), opts);
  }

  /* ---- บันทึกลงดิสก์ระหว่างอัด (ไม่เก็บทั้งไฟล์ไว้ใน RAM) ----
     1) โฟลเดอร์ที่เลือกไว้ (Chrome/Edge — File System Access) เขียนไฟล์ลงโฟลเดอร์โดยตรง
     2) พื้นที่เก็บข้อมูลของเบราว์เซอร์บนดิสก์ (OPFS) แล้วดาวน์โหลดเมื่อหยุด
     3) ถ้าเบราว์เซอร์ไม่รองรับทั้งสองแบบ เก็บใน RAM (เตือนเมื่อไฟล์ใหญ่) */
  let recFolder = null;
  const canPickFolder = desktop ? !desktop.mobile : typeof window.showDirectoryPicker === 'function';
  // แอปเดสก์ท็อป: โฟลเดอร์เป็นที่อยู่จริงบนเครื่อง (ค่าเริ่มต้น วิดีโอ/WebMix) เขียนผ่าน Rust ได้ทุกระบบปฏิบัติการ
  const nativeFolder = path => ({ name: path, native: true });
  async function loadRecFolder() {
    if (desktop) {
      const info = await desktop.ready;
      const dir = store.raw('webmix-rec-dir') || (info && info.recDir);
      recFolder = dir ? nativeFolder(dir) : null;
      return;
    }
    try { recFolder = (await idb.get('recFolder')) || null; } catch (e) { recFolder = null; }
  }
  async function pickRecFolder() {
    if (desktop) {
      const dir = await desktop.pickFolder().catch(() => null);
      if (!dir) return null;
      store.setRaw('webmix-rec-dir', dir);
      return (recFolder = nativeFolder(dir));
    }
    try {
      const dir = await window.showDirectoryPicker({ id: 'webmix-recordings', mode: 'readwrite', startIn: 'videos' });
      recFolder = dir;
      await idb.set('recFolder', dir);
      return dir;
    } catch (e) { return null; }
  }
  async function clearRecFolder() {
    if (desktop) { store.setRaw('webmix-rec-dir', ''); await loadRecFolder(); return; }
    recFolder = null; await idb.del('recFolder').catch(() => {});
  }

  async function openRecordingSink(name) {
    if (recFolder && recFolder.native) {
      try {
        return { kind: 'folder', label: recFolder.name, writable: await desktop.createFile(name, recFolder.name) };
      } catch (e) { toast('เขียนไฟล์ลงโฟลเดอร์ไม่ได้: ' + e, 'warn'); }
    }
    if (recFolder && !recFolder.native) {
      try {
        let perm = await recFolder.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await recFolder.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          const fh = await recFolder.getFileHandle(name, { create: true });
          return { kind: 'folder', label: recFolder.name, writable: await fh.createWritable(), handle: fh };
        }
        toast('ไม่ได้รับสิทธิ์เขียนโฟลเดอร์บันทึก — ใช้พื้นที่ชั่วคราวแล้วดาวน์โหลดแทน', 'warn');
      } catch (e) { toast('เขียนไฟล์ลงโฟลเดอร์ไม่ได้: ' + e.message, 'warn'); }
    }
    if (canUseOpfs) {
      try {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(name, { create: true });
        return { kind: 'opfs', label: 'ดิสก์', writable: await fh.createWritable(), handle: fh, root };
      } catch (e) {}
    }
    return { kind: 'memory', label: 'RAM', chunks: [] };
  }

  // ลบไฟล์ชั่วคราวที่ค้างจากครั้งก่อน (เกิน 1 วัน) ใน OPFS
  async function cleanupOpfs() {
    if (!canUseOpfs) return;
    try {
      const root = await navigator.storage.getDirectory();
      for await (const [name, h] of root.entries()) {
        if (h.kind !== 'file' || !/^WebMix-/.test(name)) continue;
        const f = await h.getFile();
        if (Date.now() - f.lastModified > 86400000) await root.removeEntry(name);
      }
    } catch (e) {}
  }

  const rec = { active: false, starting: false, recorder: null, sink: null, chain: Promise.resolve(), bytes: 0, start: 0, warnedRam: false };

  async function toggleRecord() {
    if (rec.active) {
      if (isPhoneUI() && !(await holdConfirm('หยุดบันทึก?', `บันทึกมาแล้ว ${fmtDuration(Date.now() - rec.start)} — ไฟล์จะถูกปิดและบันทึกลงเครื่อง`, 'กดค้างเพื่อหยุดบันทึก'))) return;
      if (rec.active) rec.recorder.stop();
      return;
    }
    if (rec.starting) return;
    let r;
    try { r = makeRecorder(); } catch (e) { toast('เริ่มบันทึกไม่ได้: ' + e.message, 'error'); return; }
    rec.starting = true;
    const type = r.mimeType || 'video/webm';
    const name = `WebMix-${stamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    const sink = await openRecordingSink(name);
    rec.starting = false;
    Object.assign(rec, { recorder: r, sink, chain: Promise.resolve(), bytes: 0, start: Date.now(), active: true, warnedRam: false, failed: false });
    // WebM: เพิ่มความยาวและดัชนีเลื่อนหาตำแหน่ง (Cues) ระหว่างเขียน — MP4 ส่งผ่านตามเดิม
    const fix = !type.includes('mp4') && window.WebmSeek ? new WebmSeek.WebmSeekFix() : null;
    let written = 0;
    const put = data => {
      written += data.byteLength;
      if (sink.kind === 'memory') { sink.chunks.push(data); return Promise.resolve(); }
      return sink.writable.write(data);
    };
    r.ondataavailable = e => {
      if (!e.data.size) return;
      rec.bytes += e.data.size;
      if (sink.kind === 'memory' && !rec.warnedRam && rec.bytes > 1.5e9) {
        rec.warnedRam = true;
        toast('ไฟล์บันทึกเกิน 1.5 GB และเก็บอยู่ใน RAM — ควรหยุดบันทึกเป็นช่วง ๆ (เบราว์เซอร์นี้เขียนลงดิสก์ระหว่างอัดไม่ได้)', 'warn', 10000);
      }
      // เขียนต่อท้ายไฟล์ตามลำดับ
      const data = e.data;
      rec.chain = rec.chain.then(async () => {
        if (!fix) return put(data);
        for (const part of fix.push(new Uint8Array(await data.arrayBuffer()))) await put(part);
      }).catch(err => {
        if (!rec.failed) { rec.failed = true; toast('เขียนไฟล์บันทึกไม่สำเร็จ: ' + err.message, 'error', 8000); }
      });
    };
    r.onstop = async () => {
      rec.active = false;
      rec.last = { name, bytes: rec.bytes, duration: Date.now() - rec.start, where: sink.kind === 'folder' ? sink.label : sink.label || '' };
      setRecButton();
      updateOnAir();
      try {
        await rec.chain;
        const done = fix && !rec.failed ? fix.finish(written) : null;
        if (done) {
          if (done.tail.length) await put(done.tail);
          // หน่วยความจำ: แก้ส่วนหัวไปแล้วในตัว — ดิสก์: เขียนทับตามตำแหน่ง
          if (sink.kind !== 'memory') for (const pt of done.patches) await sink.writable.write({ type: 'write', position: pt.position, data: pt.data });
        }
        rec.lastFix = done ? { durationMs: done.durationMs, cues: done.cues } : null;
        if (sink.kind === 'memory') {
          downloadBlob(new Blob(sink.chunks, { type }), name);
          sink.chunks = [];
          toast(`บันทึกไฟล์ ${fmtBytes(rec.bytes)} แล้ว`, 'success');
        } else {
          await sink.writable.close();
          if (sink.kind === 'folder') {
            toast(`บันทึก ${name} (${fmtBytes(rec.bytes)}) ลงโฟลเดอร์ “${sink.label}” แล้ว`, 'success', 6000);
          } else {
            const file = await sink.handle.getFile();
            downloadBlob(file, name);
            toast(`บันทึกไฟล์ ${fmtBytes(rec.bytes)} แล้ว`, 'success');
            // ลบไฟล์ชั่วคราวหลังเบราว์เซอร์ดาวน์โหลดเสร็จ
            setTimeout(() => sink.root.removeEntry(name).catch(() => {}), 180000);
          }
        }
      } catch (e) {
        toast('ปิดไฟล์บันทึกไม่สำเร็จ: ' + e.message, 'error', 8000);
      }
    };
    r.onerror = e => toast('การบันทึกผิดพลาด: ' + (e.error?.message || 'unknown'), 'error');
    r.start(1000);
    setRecButton();
    updateOnAir();
  }

  function setRecButton() {
    const b = $('#btn-rec');
    b.classList.toggle('is-on', rec.active);
    b.querySelector('.label').textContent = rec.active ? 'STOP' : 'REC';
  }

  const streamer = { active: false, state: 'idle', ws: null, recorder: null, sent: 0, kbps: 0, lastBytes: 0, lastAt: 0, start: 0, dests: new Map(), queue: [] };

  // ปุ่ม STREAM เปิดแผงควบคุมปลายทาง — เริ่ม/หยุดแต่ละช่องได้อิสระ หรือเริ่ม/หยุดทั้งหมดพร้อมกัน
  function toggleStream() {
    // มือถือ: ยังไม่ได้ไลฟ์ → หน้าเตรียมก่อนไลฟ์ (ตรวจความพร้อม + นับถอยหลัง) · ไลฟ์อยู่ → แผงไลฟ์
    if (isPhoneUI() && !streamer.ws && !streamer.reconnecting) openPreflight();
    else openLiveDialog();
  }

  function gatewayProblem() {
    const gw = gatewayUrl();
    return !gw ? 'ยังไม่ได้ตั้งค่า Stream Gateway'
      : !/^wss?:\/\//i.test(gw) ? 'Gateway URL ต้องขึ้นต้นด้วย ws:// หรือ wss://'
      : location.protocol === 'https:' && /^ws:\/\//i.test(gw) ? 'หน้านี้เปิดผ่าน HTTPS จึงต้องใช้ Gateway แบบ wss://' : '';
  }

  const destPayload = d => ({ id: d.id, name: destLabel(d), url: destUrl(d) });
  const isRunning = id => { const st = streamer.dests.get(id); return !!st && st.state !== 'stopped'; };

  // เริ่มเฉพาะปลายทางที่เลือก — ถ้ายังไม่ได้เชื่อมต่อ Gateway จะเปิดการเชื่อมต่อให้อัตโนมัติ
  function startDestinations(list) {
    list = list.filter(d => !isRunning(d.id));
    if (!list.length) return;
    for (const d of list) {
      const max = PLATFORMS[d.platform]?.maxHeight;
      if (max && H > max) toast(`${destLabel(d)} รับภาพสูงสุด ${max}p — สตรีม ${formatTag(H, settings.fps)} อาจถูกปฏิเสธหรือถูกย่อภาพ`, 'warn', 7000);
    }
    const gwErr = gatewayProblem();
    const bad = list.find(d => destProblem(d));
    if (gwErr || bad) {
      toast(gwErr || `${destLabel(bad)}: ${destProblem(bad)}`, 'warn');
      // ปิดแผงปลายทางก่อน แล้วเปิดหน้าตั้งค่าให้แก้ (ไม่ซ้อนสองหน้าต่าง)
      if (closeLiveDialog) closeLiveDialog();
      openSettings('stream');
      return;
    }

    for (const d of list) streamer.dests.set(d.id, { state: 'connecting', message: '', kbps: 0 });
    if (streamer.reconnecting && !streamer.ws) {
      // กำลังรอเชื่อมต่อใหม่ — ปลายทางนี้จะเริ่มพร้อมกันเมื่อเชื่อมต่อได้
    } else if (streamer.ws) {
      if (streamer.ws.readyState === WebSocket.OPEN) {
        for (const d of list) streamer.ws.send(JSON.stringify({ type: 'add', destination: destPayload(d) }));
      } else {
        streamer.queue.push(...list);
      }
    } else {
      connectGateway(list);
    }
    setStreamButton();
    refreshLiveDialog();
    updateStatus();
  }

  function stopDestination(id) {
    const ws = streamer.ws;
    if (!ws) {
      if (streamer.reconnecting) {
        streamer.dests.delete(id);
        if (!destCounts().active) stopAllStreams();
        refreshLiveDialog();
      }
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', id }));
    } else {
      // ยังเชื่อมต่อไม่เสร็จ — ตัดออกจากคิว ถ้าไม่เหลืออะไรก็ยกเลิกการเชื่อมต่อ
      streamer.queue = streamer.queue.filter(d => d.id !== id);
      streamer.dests.delete(id);
      if (!streamer.queue.length) ws.close(1000, 'cancelled');
    }
    refreshLiveDialog();
  }

  function stopAllStreams() {
    cancelReconnect();
    if (streamer.ws) streamer.ws.close(1000, 'stopped by user');
    else if (streamer.reconnecting) finishStream(true, true, '');
  }

  /* ---- ต่อสตรีมใหม่อัตโนมัติ ----
     ถ้าการเชื่อมต่อกับ Gateway หลุดระหว่างไลฟ์ (เน็ตสะดุด, Gateway รีสตาร์ท) ระบบจะเชื่อมต่อใหม่
     และเริ่มปลายทางที่ไลฟ์อยู่ให้เอง — ตรวจจับการเชื่อมต่อที่ค้าง (ไม่มีสถานะจาก Gateway เกิน 8 วินาที) ด้วย */
  const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 10000];
  function cancelReconnect() {
    clearTimeout(streamer.reconnectTimer);
    streamer.reconnectTimer = null;
  }

  function finishStream(byUser, wasLive, reason) {
    cancelReconnect();
    Object.assign(streamer, { active: false, state: 'idle', ws: null, recorder: null, kbps: 0, queue: [], encoder: null, reconnecting: false, attempt: 0 });
    streamer.dests.clear();
    setStreamButton();
    refreshLiveDialog();
    updateOnAir();
    output.reset();
    // ทดสอบปลายทาง: ไม่แสดงสรุป/แจ้งเตือน — ผลไปแสดงที่ปุ่มทดสอบแทน
    if (streamer.testing) { liveStats.end(); streamer.lastError = byUser ? '' : reason || ''; return; }
    if (wasLive && liveStats.session) { const sess = liveStats.end(); if (isPhoneUI()) { closeLiveDialog?.(); openSummary(sess, byUser ? '' : reason); } }
    if (byUser) { if (wasLive && !isPhoneUI()) toast('หยุดสตรีมแล้ว'); }
    else toast((wasLive ? 'การสตรีมหยุดลง: ' : 'เชื่อมต่อ Stream Gateway ไม่ได้: ') + (reason || 'ตรวจสอบว่า Gateway ทำงานอยู่และ URL ถูกต้อง'), 'error', 7000);
  }

  function handleDisconnect(ws, code, reason) {
    if (streamer.ws !== ws) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    if (streamer.recorder && streamer.recorder.state !== 'inactive') streamer.recorder.stop();
    const byUser = code === 1000;
    const fatal = code === 1008; // token/URL ไม่ถูกต้อง — ลองใหม่ไปก็ไม่สำเร็จ
    const wasLive = streamer.active || streamer.reconnecting;
    // ปลายทางที่ยังไลฟ์อยู่ตอนหลุด จะถูกเริ่มใหม่เมื่อเชื่อมต่อได้
    const resume = settings.destinations.filter(d => { const st = streamer.dests.get(d.id); return st && st.state !== 'stopped'; });
    if (byUser || fatal || !wasLive || !resume.length) { finishStream(byUser, wasLive, reason); return; }

    streamer.attempt = (streamer.attempt || 0) + 1;
    const delay = RECONNECT_DELAYS[Math.min(streamer.attempt - 1, RECONNECT_DELAYS.length - 1)];
    Object.assign(streamer, { ws: null, recorder: null, active: false, reconnecting: true, state: 'reconnecting', kbps: 0, encoder: null, queue: [] });
    for (const d of resume) streamer.dests.set(d.id, { state: 'connecting', message: 'กำลังเชื่อมต่อใหม่…', kbps: 0 });
    if (streamer.attempt === 1) toast('การเชื่อมต่อ Stream Gateway หลุด — กำลังเชื่อมต่อใหม่อัตโนมัติ', 'warn', 6000);
    setStreamButton();
    refreshLiveDialog();
    updateOnAir();
    cancelReconnect();
    streamer.reconnectTimer = setTimeout(() => {
      streamer.reconnectTimer = null;
      if (!streamer.reconnecting) return;
      const list = settings.destinations.filter(d => { const st = streamer.dests.get(d.id); return st && st.state !== 'stopped'; });
      if (!list.length) { finishStream(true, true, ''); return; }
      connectGateway(list);
    }, delay);
  }

  // Watchdog: Gateway ส่งสถานะทุก 2 วินาที ถ้าเงียบเกิน 8 วินาทีถือว่าการเชื่อมต่อค้าง (เช่น เน็ตหลุดแบบไม่ปิด socket)
  setInterval(() => {
    const ws = streamer.ws;
    if (ws && streamer.active && ws.readyState === WebSocket.OPEN && Date.now() - (streamer.lastMsgAt || 0) > 8000) {
      handleDisconnect(ws, 4001, 'ไม่ได้รับสัญญาณตอบกลับจาก Gateway');
      try { ws.close(); } catch (e) {}
    }
  }, 2000);

  function connectGateway(initial) {
    let r;
    const vcopy = useVideoCopy();
    try {
      if (vcopy) {
        audio.ensure();
        r = window.WebMix.wcrec.recorder({
          canvas: pgmCanvas, audioNode: audio.post || null, fps: settings.fps,
          videoBitsPerSecond: settings.videoKbps * 1000, audioBitsPerSecond: 160000,
          requireAvc: true, constantBitrate: true
        });
      } else r = makeRecorder('stream');
    } catch (e) {
      initial.forEach(d => streamer.dests.delete(d.id));
      toast('เริ่มสตรีมไม่ได้: ' + e.message, 'error');
      return;
    }
    const gw = gatewayUrl();
    const sep = gw.includes('?') ? '&' : '?';
    const ws = new WebSocket(`${gw}${sep}fps=${settings.fps}&vb=${settings.videoKbps}&res=${H}${vcopy ? '&vcopy=1' : ''}`);
    const reconnecting = !!streamer.reconnecting;
    Object.assign(streamer, { ws, recorder: r, videoCopy: vcopy, state: reconnecting ? 'reconnecting' : 'connecting', sent: 0, kbps: 0, lastBytes: 0, lastAt: performance.now(), queue: [...initial] });
    // เข้ารหัสด้วยชิปของเครื่องไม่สำเร็จ → เลิกใช้ทางนี้ แล้วเชื่อมต่อใหม่ให้ Gateway เข้ารหัสเอง (ระบบเชื่อมต่อใหม่อัตโนมัติ)
    const fallback = why => {
      hwAvc.ok = false;
      toast(`เข้ารหัสวิดีโอด้วยชิปของเครื่อง${why} — สลับให้ Gateway เข้ารหัสแทน`, 'warn', 8000);
      if (streamer.ws === ws) { handleDisconnect(ws, 4002, 'สลับวิธีเข้ารหัส'); try { ws.close(); } catch (err) {} }
    };
    if (vcopy) {
      r.onerror = e => fallback('ไม่สำเร็จ: ' + (e.error?.message || ''));
      // ทิ้งเฟรมเกิน 20% ในช่วง 6 วินาที = ชิปเข้ารหัสไม่ทัน (เช่นเครื่องร้อนจนลดความเร็ว) → ให้ Gateway เข้ารหัส
      let last = { d: 0, e: 0 };
      const watch = setInterval(() => {
        if (streamer.recorder !== r || r.state === 'inactive') { clearInterval(watch); return; }
        const d = r.droppedFrames - last.d, e = r.encodedFrames - last.e;
        last = { d: r.droppedFrames, e: r.encodedFrames };
        if (d + e > settings.fps && d / (d + e) > 0.2) { clearInterval(watch); fallback('ไม่ทัน (ทิ้งเฟรม)'); }
      }, 6000);
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', destinations: streamer.queue.map(destPayload) }));
      streamer.queue = [];
      r.ondataavailable = e => {
        if (e.data.size && ws.readyState === WebSocket.OPEN) { ws.send(e.data); streamer.sent += e.data.size; }
      };
      r.start(1000);
      streamer.lastMsgAt = Date.now();
      Object.assign(streamer, { active: true, state: 'live', reconnecting: false, attempt: 0 });
      if (!reconnecting) streamer.start = Date.now();
      else toast('เชื่อมต่อ Stream Gateway ใหม่สำเร็จ — กำลังเริ่มปลายทางอีกครั้ง', 'success', 4000);
      setStreamButton();
      updateOnAir();
    };
    ws.onmessage = ev => {
      streamer.lastMsgAt = Date.now();
      if (typeof ev.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'error') ws.lastError = String(msg.message || '');
      if (msg.type === 'status' && msg.encoder) onEncoderStats(msg.encoder);
      if (msg.type === 'status' && Array.isArray(msg.destinations)) onDestStatus(msg.destinations);
    };
    ws.onclose = ev => handleDisconnect(ws, ev.code, ws.lastError || (ev.reason === 'invalid token' ? 'token ของ Gateway ไม่ถูกต้อง (ตรวจ Gateway URL ในหน้าตั้งค่า)' : ev.reason === 'too many attempts' ? 'ใส่ token ผิดหลายครั้ง — Gateway บล็อกชั่วคราว 15 นาที' : ev.reason));
  }

  // ความเร็วการเข้ารหัสของ Gateway — ต่ำกว่า 1.0x แปลว่าเซิร์ฟเวอร์เข้ารหัสไม่ทัน ภาพจะกระตุก/ดีเลย์
  let slowEncoderWarned = 0;
  function onEncoderStats(enc) {
    streamer.encoder = { speed: +enc.speed || 0, fps: +enc.fps || 0 };
    if (streamer.encoder.speed && streamer.encoder.speed < 0.9 && Date.now() - slowEncoderWarned > 60000) {
      slowEncoderWarned = Date.now();
      toast(`Stream Gateway เข้ารหัสไม่ทัน (${streamer.encoder.speed.toFixed(2)}x) — ลดความละเอียด/เฟรมเรต หรือใช้เซิร์ฟเวอร์ที่แรงขึ้น`, 'warn', 9000);
    }
  }

  function onDestStatus(list) {
    for (const st of list) {
      const prev = streamer.dests.get(st.id);
      const label = destLabel(settings.destinations.find(d => d.id === st.id)) || st.name;
      if (prev && prev.state !== st.state) {
        if (st.state === 'live') toast(`${label}: ออกอากาศแล้ว`, 'success', 2500);
        else if (st.state === 'error') toast(`${label}: ${st.message || 'เชื่อมต่อไม่ได้'} — กำลังลองใหม่อัตโนมัติ`, 'error', 6000);
        else if (st.state === 'stopped') toast(`${label}: หยุดสตรีมแล้ว`, 'info', 2500);
      }
      streamer.dests.set(st.id, { state: st.state, message: st.message || '', kbps: st.kbps || 0 });
    }
    // ไม่เหลือปลายทางที่ทำงานอยู่ → ปิดการเชื่อมต่อ Gateway เพื่อไม่ส่งข้อมูลเปล่า ๆ
    if (streamer.ws && streamer.active && !destCounts().active) streamer.ws.close(1000, 'all destinations stopped');
    setStreamButton();
    refreshLiveDialog();
    updateStatus();
  }

  const destCounts = () => {
    let live = 0, active = 0, errors = 0;
    for (const d of streamer.dests.values()) {
      if (d.state !== 'stopped') active++;
      if (d.state === 'live') live++;
      if (d.state === 'error') errors++;
    }
    return { live, active, errors };
  };

  function setStreamButton() {
    const b = $('#btn-stream');
    const { live, active } = destCounts();
    const on = streamer.state === 'live' && live > 0;
    b.classList.toggle('is-on', on);
    b.classList.toggle('is-pending', !!streamer.ws && !on);
    b.classList.toggle('is-pending', (!!streamer.ws && !on) || !!streamer.reconnecting);
    b.querySelector('.label').textContent = streamer.reconnecting ? 'RECONNECTING' : on ? `ON AIR ${live}/${active}` : streamer.ws ? 'CONNECTING' : 'STREAM';
  }

  let liveDialog = null, closeLiveDialog = null;
  function openLiveDialog() {
    if (liveDialog) return;
    if (isPhoneUI()) return openMobileLive();
    dialog({
      title: 'ปลายทางการสตรีม',
      wide: true,
      body: `
        <p class="modal-text">กด <b>เริ่ม</b> ทีละช่องเพื่อไลฟ์เฉพาะช่องที่ต้องการ หรือ <b>เริ่มทั้งหมด</b> เพื่อส่งทุกช่องที่ติ๊กไว้พร้อมกัน — แต่ละช่องเริ่ม/หยุดได้โดยไม่กระทบช่องอื่น และช่องที่หลุดจะเชื่อมต่อใหม่เอง</p>
        <div class="dest-live"></div>`,
      actions: [{ label: 'แก้ไขปลายทาง', value: 'edit' }, { label: 'ปิด', primary: true }],
      onOpen(modal, close) {
        liveDialog = modal;
        closeLiveDialog = close;
        const foot = $('.modal-foot', modal);
        foot.insertAdjacentHTML('afterbegin', `
          <button type="button" class="btn btn-green dest-start-all">${icon('broadcast')}เริ่มทั้งหมด</button>
          <button type="button" class="btn btn-danger dest-stop-all">หยุดทั้งหมด</button>
          <span class="ml-auto"></span>`);
        modal.addEventListener('click', async e => {
          const b = e.target.closest('[data-dest-toggle]');
          if (b) {
            const d = settings.destinations.find(x => x.id === b.dataset.destToggle);
            if (b.dataset.on === '1') { if (d) startDestinations([d]); }
            else stopDestination(b.dataset.destToggle);
            return;
          }
          if (e.target.closest('.dest-start-all')) {
            const list = settings.destinations.filter(d => d.enabled);
            if (!list.length) { toast('ยังไม่ได้ติ๊กปลายทางที่จะเริ่มพร้อมกัน — กด “แก้ไขปลายทาง”', 'warn'); return; }
            startDestinations(list);
          } else if (e.target.closest('.dest-stop-all')) {
            if (await confirmStopAll()) stopAllStreams();
          }
        });
        refreshLiveDialog();
      }
    }).then(r => {
      liveDialog = null;
      closeLiveDialog = null;
      if (r?.value === 'edit') openSettings('stream');
    });
  }

  // แผงไลฟ์บนมือถือ (bottom sheet): สุขภาพสตรีม · การ์ดปลายทาง · กดค้างเพื่อหยุด
  function openMobileLive() {
    dialog({
      title: 'ไลฟ์',
      body: '<div class="dest-live"></div>',
      actions: [{ label: 'ปิด' }],
      onOpen(modal, close) {
        modal.classList.add('m-sheet', 'm-live');
        liveDialog = modal;
        closeLiveDialog = close;
        $('.modal-foot', modal).insertAdjacentHTML('afterbegin', `
          <button type="button" class="btn btn-green btn-golive ml-go">${icon('broadcast')}เริ่มไลฟ์</button>
          <button type="button" class="btn btn-danger dest-stop-all">หยุดไลฟ์…</button>`);
        modal.addEventListener('click', async e => {
          const b = e.target.closest('[data-dest-toggle]');
          if (b) {
            const d = settings.destinations.find(x => x.id === b.dataset.destToggle);
            if (b.dataset.on === '1') { if (d) startDestinations([d]); }
            else stopDestination(b.dataset.destToggle);
          } else if (e.target.closest('[data-ml-edit]')) { close(); openSettings('stream'); }
          else if (e.target.closest('.ml-go')) { close(); openPreflight(); }
          else if (e.target.closest('.dest-stop-all')) { if (await confirmStopAll()) stopAllStreams(); }
        });
        refreshLiveDialog();
      }
    }).then(() => { liveDialog = null; closeLiveDialog = null; });
  }

  // หยุดไลฟ์ทั้งหมด: มือถือใช้ "กดค้าง" (กันนิ้วโดน) · จอใหญ่ใช้หน้าต่างยืนยันตามเดิม
  function confirmStopAll() {
    const since = streamer.start ? ` · ไลฟ์มาแล้ว ${fmtDuration(Date.now() - streamer.start)}` : '';
    return isPhoneUI()
      ? holdConfirm('หยุดไลฟ์?', `ทุกปลายทางจะหยุดออกอากาศ ผู้ชมจะเห็นว่าไลฟ์จบ${since}`, 'กดค้างเพื่อหยุดไลฟ์')
      : confirmDialog('หยุดสตรีมทั้งหมด', 'ทุกปลายทางจะหยุดออกอากาศทันที', 'หยุดสตรีม');
  }

  function refreshLiveDialog() {
    const box = liveDialog && $('.dest-live', liveDialog);
    if (!box) return;
    if (liveDialog.classList.contains('m-sheet')) {
      renderMobileLive(box);
      const live = !!(streamer.ws || streamer.reconnecting);
      const go = $('.ml-go', liveDialog), stop = $('.dest-stop-all', liveDialog);
      if (go) go.hidden = live;
      if (stop) stop.hidden = !live;
      return;
    }
    const text = { live: 'LIVE', connecting: 'กำลังเชื่อมต่อ…', error: 'หลุด — กำลังลองใหม่', stopped: 'หยุดแล้ว', off: 'พร้อม' };
    box.innerHTML = settings.destinations.map(d => {
      const st = streamer.dests.get(d.id);
      const state = st ? st.state : 'off';
      const running = !!st && state !== 'stopped';
      return `
        <div class="dest-live-row is-${state}">
          <span class="dest-dot"></span>
          <div class="dest-info"><b>${esc(destLabel(d))}</b><small>${esc(state === 'error' && st.message ? st.message : destMasked(d))}</small></div>
          <span class="dest-state">${text[state]}${state === 'live' && st.kbps ? ` · ${st.kbps} kbps` : ''}</span>
          <button type="button" class="btn btn-sm ${running ? 'btn-danger' : 'btn-green'}" data-dest-toggle="${esc(d.id)}" data-on="${running ? 0 : 1}">${running ? 'หยุด' : 'เริ่ม'}</button>
        </div>`;
    }).join('') || '<p class="note">ยังไม่มีปลายทาง — กด “แก้ไขปลายทาง” เพื่อเพิ่ม</p>';
    const enabledIdle = settings.destinations.some(d => d.enabled && !isRunning(d.id));
    const startAll = $('.dest-start-all', liveDialog), stopAll = $('.dest-stop-all', liveDialog);
    if (startAll) startAll.disabled = !enabledIdle;
    if (stopAll) stopAll.disabled = !streamer.ws && !streamer.reconnecting;
  }

  let onAirSince = null;
  function updateOnAir() {
    const live = rec.active || streamer.active || !!streamer.reconnecting;
    if (live && !onAirSince) onAirSince = Date.now();
    if (!live) onAirSince = null;
    const lamp = $('#tally-lamp');
    lamp.classList.toggle('is-live', live);
    lamp.textContent = live ? 'ON AIR' : 'OFF AIR';
    keepScreenOn(live);
    syncLiveService(live);
    updateStatus();
  }

  // แอป Android: เปิดบริการเบื้องหน้าระหว่างไลฟ์/บันทึก (แจ้งเตือนค้าง) — ระบบจะไม่หยุดกล้องและการสตรีมเมื่อปิดจอหรือสลับแอป
  let liveServiceText = '';
  function syncLiveService(live) {
    if (!desktop || !desktop.mobile) return;
    const text = !live ? '' : streamer.active || streamer.reconnecting
      ? (rec.active ? 'กำลังไลฟ์และบันทึก' : 'กำลังไลฟ์') : 'กำลังบันทึก';
    if (text === liveServiceText) return;
    liveServiceText = text;
    desktop.setLive(!!text, text);
  }

  window.addEventListener('beforeunload', e => {
    if (rec.active || streamer.active) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ------------------------------------------------------------ extras */
  function snapshot() {
    pgmCanvas.toBlob(blob => {
      if (!blob) { toast('บันทึกภาพไม่สำเร็จ', 'error'); return; }
      downloadBlob(blob, `WebMix-Snapshot-${stamp()}.png`);
      toast('บันทึกภาพนิ่งจาก Program แล้ว', 'success');
    }, 'image/png');
  }

  function openOutputWindow() {
    if (desktop && desktop.mobile) { toast('แอป Android เปิดหน้าต่างแยกไม่ได้ — ต่อจอผ่าน HDMI หรือ Cast แล้วกดปุ่มเต็มจอบนจอ Program แทน', 'warn', 6000); return; }
    const win = window.open('about:blank', 'webmix-program-output', 'width=1280,height=720');
    if (!win) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต Pop-up สำหรับเว็บนี้ก่อน', 'warn'); return; }
    win.document.open();
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>WebMix — Program Output</title>
      <style>html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}video{width:100%;height:100%;object-fit:contain;display:block}
      p{position:fixed;left:0;right:0;bottom:12px;margin:0;text-align:center;font:12px system-ui;color:#666;transition:opacity 1s}</style></head>
      <body><video autoplay muted playsinline></video><p>ดับเบิลคลิกเพื่อเต็มจอ</p>
      <script>document.addEventListener('dblclick',()=>{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()});setTimeout(()=>document.querySelector('p').style.opacity=0,3000)<\/script></body></html>`);
    win.document.close();
    const v = win.document.querySelector('video');
    v.srcObject = new MediaStream(pgmCanvas.captureStream(settings.fps).getVideoTracks());
    v.play().catch(() => {});
  }


  const multiview = createMultiview({
    get inputs() { return inputs; }, get state() { return state; }, get ovl() { return ovl; }, get streamer() { return streamer; }, get rec() { return rec; },
    get audio() { return audio; }, get H() { return H; }, get fps() { return settings.fps; }, pvwCanvas, pgmCanvas, byId, drawSource, meterPct, formatTag,
    setPreview, cut, auto: autoTransition,
    onAirText: () => $('#onair-timer').textContent
  });

  function toggleFullscreen() {
    const mon = $('#pgm-monitor');
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (mon.classList.contains('is-fullscreen')) { mon.classList.remove('is-fullscreen'); return; }
    if (mon.requestFullscreen && !isIOS) mon.requestFullscreen().catch(() => mon.classList.add('is-fullscreen'));
    else mon.classList.add('is-fullscreen');
  }

  /* ------------------------------------------------------------ dialogs */
  function dialog({ title, body, actions = [{ label: 'ปิด', primary: true }], wide = false, onOpen }) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head"><div class="modal-title">${esc(title)}</div>
            <button type="button" class="btn btn-ghost btn-sm btn-icon ml-auto" data-close title="ปิด">${icon('x')}</button></div>
          <form class="modal-body" novalidate>${body}</form>
          <div class="modal-foot"></div>
        </div>`;
      const modal = back.querySelector('.modal');
      const form = back.querySelector('form');
      const foot = back.querySelector('.modal-foot');
      const prevFocus = document.activeElement;
      let done = false;
      const close = value => {
        if (done) return;
        done = true;
        back.remove();
        document.removeEventListener('keydown', onKey, true);
        prevFocus?.focus?.({ preventScroll: true });
        resolve(value === undefined ? null : { value, form: form.elements });
      };
      const primary = actions.find(a => a.primary);
      actions.forEach(a => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`;
        b.textContent = a.label;
        b.addEventListener('click', () => close(a.value));
        foot.appendChild(b);
      });
      const onKey = e => {
        // ปิดเฉพาะหน้าต่างบนสุด (เช่นกล่องยืนยันที่ซ้อนอยู่บนแผงปลายทาง)
        if (e.key === 'Escape' && back === $$('.modal-backdrop').pop()) { e.preventDefault(); e.stopPropagation(); close(); }
      };
      form.addEventListener('submit', e => { e.preventDefault(); if (primary) close(primary.value); });
      form.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && primary) { e.preventDefault(); close(primary.value); }
      });
      back.addEventListener('mousedown', e => { if (e.target === back) close(); });
      back.querySelector('[data-close]').addEventListener('click', () => close());
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      onOpen && onOpen(modal, close);
      const first = form.querySelector('input:not([readonly]), select');
      (first && !matchMedia('(hover: none)').matches ? first : foot.lastElementChild)?.focus({ preventScroll: true });
    });
  }

  /* ================================================== มือถือ: หน้าจอไลฟ์ตามแบบ (Android/iPhone)
     สถิติระหว่างไลฟ์ (สุขภาพสตรีม/สรุปหลังไลฟ์) · หน้าเตรียมก่อนไลฟ์ · การ์ดเตือนตอนมีปัญหา · สรุปหลังไลฟ์ */
  let battery = null;
  try { navigator.getBattery?.().then(b => { battery = b; }).catch(() => {}); } catch (e) {}
  const batteryText = () => battery ? `${Math.round(battery.level * 100)}%${battery.charging ? ' (ชาร์จอยู่)' : ''}` : '';

  // เก็บสถิติทุกวินาทีระหว่างไลฟ์: บิตเรตย้อนหลัง 2 นาที, ข้อมูลที่ส่งรวม, เฟรมเรต, การหลุดของแต่ละปลายทาง
  const liveStats = {
    session: null,
    tick() {
      const on = !!(streamer.ws || streamer.reconnecting);
      if (!on) return;
      if (!this.session) this.session = { start: Date.now(), bytes: 0, lastSent: 0, kbps: [], fps: [], reconnects: 0, wasReconnecting: false, dests: {} };
      const s = this.session;
      const d = streamer.sent - s.lastSent;
      s.bytes += d >= 0 ? d : streamer.sent;
      s.lastSent = streamer.sent;
      s.kbps.push(streamer.state === 'live' ? streamer.kbps : 0);
      if (s.kbps.length > 120) s.kbps.shift();
      const f = streamer.encoder?.fps || (streamer.state === 'live' ? fps : 0);
      if (f) s.fps.push(f);
      if (streamer.reconnecting && !s.wasReconnecting) s.reconnects++;
      s.wasReconnecting = !!streamer.reconnecting;
      for (const [id, st] of streamer.dests) {
        const x = s.dests[id] || (s.dests[id] = { label: destLabel(settings.destinations.find(z => z.id === id)) || id, live: 0, down: 0, drops: 0, last: '' });
        if (st.state === 'live') x.live++; else x.down++;
        if (x.last === 'live' && st.state !== 'live') x.drops++;
        x.last = st.state;
      }
    },
    end() {
      const s = this.session;
      this.session = null;
      if (!s) return null;
      s.duration = Date.now() - s.start;
      return s;
    }
  };

  const sparkPath = (vals, w, h) => {
    if (vals.length < 2) return '';
    const max = Math.max(1, ...vals) * 1.15;
    return vals.map((v, i) => `${i ? 'L' : 'M'}${(i / (vals.length - 1) * w).toFixed(1)} ${(h - v / max * h).toFixed(1)}`).join(' ');
  };

  // หน้าเตรียมก่อนไลฟ์: ตรวจความพร้อมทีละข้อ แล้วนับถอยหลัง 3-2-1 ก่อนเริ่มทุกปลายทางที่ติ๊กไว้
  async function openPreflight() {
    const list = settings.destinations.filter(d => d.enabled);
    const items = [];
    const add = (state, title, detail) => items.push({ state, title, detail });
    const gwErr = gatewayProblem();
    const bad = list.find(d => destProblem(d));
    if (!list.length) add('error', 'ยังไม่มีปลายทาง', 'เพิ่มปลายทาง (Facebook / YouTube / …) และติ๊กช่องที่จะไลฟ์');
    else if (bad) add('error', destLabel(bad), destProblem(bad));
    else add('ok', `ปลายทาง ${list.length} ช่อง`, list.map(destLabel).join(' · '));
    if (gwErr) add('error', 'Stream Gateway', gwErr);
    else add('ok', 'Stream Gateway', usingLocalGateway() ? 'ในเครื่องนี้' : 'เซิร์ฟเวอร์ ' + gatewayUrl().replace(/^wss?:\/\//, '').replace(/[/?].*$/, ''));
    const need = settings.videoKbps * Math.max(1, list.length) / 1000;
    const net = navigator.connection;
    if (!navigator.onLine) add('error', 'อินเทอร์เน็ต', 'ไม่ได้เชื่อมต่ออินเทอร์เน็ต');
    else if (net && net.downlink && !usingLocalGateway()) add(net.downlink < need * 1.5 ? 'warn' : 'ok', 'อินเทอร์เน็ต', `ประมาณ ${net.downlink} Mbps · ต้องการราว ${need.toFixed(1)} Mbps ขาขึ้น`);
    else add('ok', 'อินเทอร์เน็ต', `ต้องการขาขึ้นราว ${need.toFixed(1)} Mbps สำหรับ ${Math.max(1, list.length)} ปลายทาง`);
    if (battery) add(battery.charging || battery.level >= 0.5 ? 'ok' : 'warn', `แบตเตอรี่ ${batteryText()}`, battery.charging ? 'เสียบสายชาร์จอยู่' : 'แนะนำเสียบสายชาร์จระหว่างไลฟ์');
    const hasCam = inputs.some(i => ['camera', 'wireless', 'guest'].includes(i.type));
    add(hasCam ? 'ok' : 'warn', 'กล้องและไมค์', hasCam ? `${inputs.filter(i => ['camera', 'wireless', 'guest'].includes(i.type)).length} กล้อง · ${audio.channels.length} ช่องเสียง` : 'ยังไม่มีกล้อง — เพิ่มจากปุ่ม “เพิ่มแหล่งภาพ”');
    if (desktop && desktop.info) add('ok', 'ตัวเข้ารหัส', useVideoCopy() ? 'ชิปของเครื่อง (ไม่เข้ารหัสซ้ำ)' : desktop.info.encoder === 'libx264' ? 'CPU (libx264)' : 'ชิปของเครื่อง (MediaCodec)');
    try {
      const est = await navigator.storage?.estimate?.();
      if (est && est.quota) {
        const hours = (est.quota - est.usage) * 8 / (settings.videoKbps * 1000 + 160000) / 3600;
        add(hours < 0.5 ? 'warn' : 'ok', 'พื้นที่บันทึก', `บันทึกได้อีกราว ${hours >= 10 ? '10+ ชม.' : hours.toFixed(1) + ' ชม.'}`);
      }
    } catch (e) {}
    if (desktop && desktop.mobile) add('ok', 'ไลฟ์เบื้องหลัง', 'ปิดจอหรือสลับแอประหว่างไลฟ์ได้ — ดูสถานะที่แจ้งเตือน');
    const blocked = items.some(i => i.state === 'error');
    const mark = { ok: '✓', warn: '!', error: '✕' };
    const r = await dialog({
      title: 'พร้อมไลฟ์หรือยัง',
      body: `<p class="pf-sub">${formatTag(H, settings.fps)} · ${settings.videoKbps} kbps</p>
        <div class="pf-list">${items.map(i => `<div class="pf-item is-${i.state}"><span class="pf-dot" aria-hidden="true">${mark[i.state]}</span><div><b>${esc(i.title)}</b><small>${esc(i.detail)}</small></div></div>`).join('')}</div>`,
      actions: blocked ? [{ label: 'แก้ไขปลายทาง', value: 'edit', primary: true }, { label: 'ปิด' }] : [{ label: 'ยกเลิก' }, { label: 'เริ่มไลฟ์', value: 'go', primary: true }],
      onOpen(modal) { modal.classList.add('m-sheet'); const go = $('.modal-foot .btn-primary', modal); if (go && !blocked) go.classList.add('btn-golive'); }
    });
    if (r?.value === 'edit') { openSettings('stream'); return; }
    if (r?.value !== 'go') return;
    if (await countdown()) startDestinations(list);
  }

  function countdown(n = 3) {
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'm-countdown';
      el.innerHTML = `<div>กำลังจะออกอากาศใน</div><b>${n}</b><button type="button" class="btn">ยกเลิก</button>`;
      document.body.appendChild(el);
      const num = $('b', el);
      let left = n;
      const t = setInterval(() => {
        left--;
        if (left <= 0) { clearInterval(t); el.remove(); navigator.vibrate?.(80); resolve(true); return; }
        num.textContent = left;
        navigator.vibrate?.(20);
      }, 1000);
      $('button', el).addEventListener('click', () => { clearInterval(t); el.remove(); resolve(false); });
    });
  }

  // การ์ดเตือนบนหน้าสวิตช์ (มือถือ): เรียงตามความรุนแรง บอกว่าเกิดอะไรและควรทำอะไร · กด "รับทราบ" เพื่อซ่อนจนกว่าจะเกิดใหม่
  const alertDismissed = new Set();
  function renderAlerts() {
    const box = $('#m-alerts');
    if (!box) return;
    const live = !!(streamer.ws || streamer.reconnecting);
    const list = [];
    if (battery && !battery.charging && battery.level <= 0.15 && (live || rec.active)) {
      list.push({ key: 'battery', level: 'red', title: `แบตเหลือ ${Math.round(battery.level * 100)}%`, text: 'เสียบสายชาร์จตอนนี้ — ถ้าแบตหมด ไลฟ์และการบันทึกจะหยุด' });
    }
    if (streamer.reconnecting) {
      list.push({ key: 'gw', level: 'amber', title: `การเชื่อมต่อหลุด — กำลังเชื่อมต่อใหม่ (ครั้งที่ ${streamer.attempt || 1})`, text: 'ปลายทางที่ไลฟ์อยู่จะเริ่มต่อให้เองเมื่อเชื่อมต่อได้' });
    }
    for (const [id, st] of streamer.dests) {
      if (st.state !== 'error') continue;
      const d = settings.destinations.find(z => z.id === id);
      const others = [...streamer.dests.values()].filter(x => x.state === 'live').length;
      list.push({ key: 'dest-' + id, level: 'amber', title: `${destLabel(d) || id} หลุด — กำลังเชื่อมต่อใหม่`, text: (st.message ? st.message + ' · ' : '') + (others ? `ปลายทางอื่นยังออกอากาศปกติ (${others})` : 'ลองใหม่อัตโนมัติ'), action: { label: 'หยุดเฉพาะช่องนี้', run: () => stopDestination(id) } });
    }
    if (live && streamer.encoder && streamer.encoder.speed && streamer.encoder.speed < 0.9) {
      list.push({ key: 'enc', level: 'gray', title: `เข้ารหัสไม่ทัน (${streamer.encoder.speed.toFixed(2)}x)`, text: 'ภาพที่ผู้ชมเห็นอาจกระตุก — ลดความละเอียดหรือเฟรมเรตในตั้งค่า', action: { label: 'ตั้งค่า', run: () => openSettings('output') } });
    }
    // เงื่อนไขหายไปแล้ว → ล้างการซ่อน (ถ้าเกิดอีกจะแสดงใหม่)
    for (const k of [...alertDismissed]) if (!list.some(a => a.key === k)) alertDismissed.delete(k);
    const shown = list.filter(a => !alertDismissed.has(a.key));
    const sig = shown.map(a => a.key + a.title + a.text).join('|');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.hidden = !shown.length;
    box.innerHTML = shown.map((a, i) => `
      <div class="m-alert is-${a.level}" role="${a.level === 'red' ? 'alert' : 'status'}">
        <div class="m-alert-text"><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div>
        <div class="m-alert-actions">${a.action ? `<button type="button" class="btn btn-sm" data-alert-act="${i}">${esc(a.action.label)}</button>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-alert-ok="${esc(a.key)}">รับทราบ</button></div>
      </div>`).join('');
    box.onclick = e => {
      const act = e.target.closest('[data-alert-act]');
      if (act) { shown[+act.dataset.alertAct]?.action?.run(); return; }
      const okb = e.target.closest('[data-alert-ok]');
      if (okb) { alertDismissed.add(okb.dataset.alertOk); box.dataset.sig = ''; renderAlerts(); }
    };
  }

  // สรุปหลังไลฟ์ (มือถือ)
  function openSummary(s, reason) {
    if (!s) return;
    const avgFps = s.fps.length ? s.fps.reduce((a, b) => a + b, 0) / s.fps.length : 0;
    const dests = Object.values(s.dests);
    const recLine = rec.active ? `<p class="note">ยังบันทึกอยู่ — กด REC เพื่อหยุดและบันทึกไฟล์</p>`
      : rec.last && Date.now() - rec.start < s.duration + 600000 ? `<div class="sum-file"><b>${esc(rec.last.name)}</b><small>${fmtBytes(rec.last.bytes)}${rec.last.where ? ' · ' + esc(rec.last.where) : ''}</small></div>` : '';
    dialog({
      title: reason ? 'ไลฟ์หยุดลง' : 'จบไลฟ์แล้ว',
      body: `${reason ? `<p class="modal-text">${esc(reason)}</p>` : ''}
        <div class="sum-grid">
          <div><small>ระยะเวลา</small><b>${fmtDuration(s.duration)}</b></div>
          <div><small>ข้อมูลที่ส่ง</small><b>${fmtBytes(s.bytes)}</b></div>
          <div><small>ภาพเฉลี่ย</small><b>${avgFps ? avgFps.toFixed(1) + ' fps' : '—'}</b></div>
          <div><small>หลุด / เชื่อมต่อใหม่</small><b>${s.reconnects} ครั้ง</b></div>
        </div>
        ${dests.length ? `<div class="sum-dests">${dests.map(d => `<div><span>${esc(d.label)}</span><span class="${d.drops || d.down > 5 ? 'warn' : 'ok'}">${d.drops ? `หลุด ${d.drops} ครั้ง` : d.down > 5 ? `ขาด ${d.down} วินาที` : 'ครบทั้งรายการ'}</span></div>`).join('')}</div>` : ''}
        ${recLine}`,
      actions: [{ label: 'กลับหน้าสวิตช์ภาพ', primary: true }],
      onOpen(modal) { modal.classList.add('m-sheet'); }
    });
  }

  // แผงไลฟ์แบบมือถือ: สุขภาพสตรีม + ปลายทาง (การ์ด) — ใช้โครงเดียวกับ openLiveDialog
  function renderMobileLive(box) {
    const s = liveStats.session;
    const live = !!(streamer.ws || streamer.reconnecting);
    const { live: nLive, active } = destCounts();
    const health = streamer.reconnecting ? ['warn', 'กำลังเชื่อมต่อใหม่'] : !live ? ['idle', 'ยังไม่ได้ไลฟ์']
      : streamer.encoder && streamer.encoder.speed && streamer.encoder.speed < 0.9 ? ['warn', 'เข้ารหัสไม่ทัน'] : nLive < active ? ['warn', 'บางปลายทางมีปัญหา'] : ['ok', 'ดีมาก'];
    const fpsNow = streamer.encoder?.fps || (live ? fps : 0);
    const text = { live: 'ออกอากาศ', connecting: 'กำลังเชื่อมต่อ…', error: 'หลุด — กำลังลองใหม่', stopped: 'หยุดแล้ว', off: 'พร้อม' };
    box.innerHTML = `
      <section class="ml-health is-${health[0]}">
        <div class="ml-head"><b>สุขภาพสตรีม</b><span>${health[1]}</span></div>
        <svg class="ml-spark" viewBox="0 0 330 54" preserveAspectRatio="none" role="img" aria-label="กราฟบิตเรต 2 นาทีล่าสุด"><path d="M0 46 H330" class="ml-base"/><path d="${s ? sparkPath(s.kbps, 330, 50) : ''}" class="ml-line"/></svg>
        <div class="ml-stats">
          <div><small>บิตเรต</small><b>${live ? (streamer.kbps / 1000).toFixed(1) + 'M' : '—'}</b></div>
          <div><small>เฟรม</small><b>${fpsNow ? Math.round(fpsNow) + ' fps' : '—'}</b></div>
          <div><small>แบต</small><b>${battery ? Math.round(battery.level * 100) + '%' : '—'}</b></div>
          <div><small>เวลา</small><b>${live && streamer.start ? fmtDuration(Date.now() - streamer.start) : '—'}</b></div>
        </div>
      </section>
      <div class="ml-dests">${settings.destinations.map(d => {
        const st = streamer.dests.get(d.id);
        const state = st ? st.state : 'off';
        const running = !!st && state !== 'stopped';
        return `<div class="ml-dest is-${state}">
          <span class="ml-badge">${esc((PLATFORMS[d.platform]?.label || '?').slice(0, 1))}</span>
          <div class="ml-info"><b>${esc(destLabel(d))}</b><small>${esc(state === 'error' && st.message ? st.message : text[state] + (state === 'live' && st.kbps ? ` · ${(st.kbps / 1000).toFixed(1)} Mbps` : ''))}</small></div>
          <button type="button" class="btn btn-sm ${running ? 'btn-danger' : 'btn-green'}" data-dest-toggle="${esc(d.id)}" data-on="${running ? 0 : 1}">${running ? 'หยุด' : 'เริ่ม'}</button>
        </div>`;
      }).join('') || '<p class="note">ยังไม่มีปลายทาง</p>'}
      <button type="button" class="btn ml-add" data-ml-edit>+ เพิ่ม / แก้ไขปลายทาง</button></div>
      ${desktop && desktop.mobile ? '<p class="ml-tip">ปิดจอหรือสลับแอปได้ — ไลฟ์ยังส่งต่อ ดูสถานะได้จากแจ้งเตือน</p>' : ''}`;
  }

  /* ---- มือถือ: จอแคบใช้เลย์เอาต์แบบแท็บ (CSS @media max-width 760px) ---- */
  // มือถือแนวนอน (จอเตี้ย + นิ้วสัมผัส) ใช้หน้าจอไลฟ์/การยืนยันแบบมือถือเหมือนกัน
  const phoneQuery = matchMedia('(max-width: 760px), (pointer: coarse) and (orientation: landscape) and (max-height: 500px)');
  const isPhoneUI = () => phoneQuery.matches;
  function setMobileView(view) {
    document.documentElement.dataset.mview = view;
    $$('#m-tabs [data-mview]').forEach(b => { if (b.dataset.mview === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    store.set('mview', view);
    if (isPhoneUI()) window.scrollTo({ top: 0 });
  }
  function openMoreMenu(anchor) {
    closeMenu();
    const items = [
      ['camera', 'บันทึกภาพนิ่งจาก Program', snapshot],
      ['folder', 'โชว์: บันทึก / เปิด / เริ่มใหม่', openShowDialog],
      ['phone', 'เชื่อมกล้องมือถือเครื่องอื่น (QR)', showWirelessDialog],
      ...(desktop && desktop.mobile ? [] : [['grid', 'Multiview', () => multiview.open()], ['external', 'หน้าต่าง Program Output', openOutputWindow]]),
      ['sliders', 'ตั้งค่า', () => openSettings()],
      ['broadcast', 'เริ่มต้นใช้งาน (ตั้งค่าไลฟ์ทีละขั้น)', openOnboarding],
      ['help', 'คู่มือ', openHelp]
    ];
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div class="menu-label">เพิ่มเติม</div>' + items.map((it, i) => `<button role="menuitem" data-i="${i}">${icon(it[0])}${esc(it[1])}</button>`).join('');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${clamp(r.right - menu.offsetWidth, 8, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.max(8, r.top - menu.offsetHeight - 6)}px`;
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      closeMenu();
      items[+b.dataset.i][2]();
    });
    setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
  }

  // กดค้างเพื่อยืนยัน (หยุดไลฟ์/หยุดบันทึกบนมือถือ) — ปล่อยก่อนครบเวลาเท่ากับยกเลิก · คีย์บอร์ด: กด Space/Enter ค้าง
  function holdConfirm(title, text, label, ms = 1500) {
    return dialog({
      title,
      body: `<p class="modal-text">${esc(text)}</p>
        <button type="button" class="hold-btn"><span class="hold-fill"></span><span class="hold-label">${esc(label)}</span></button>
        <p class="hold-hint">กดค้าง ${ms / 1000} วินาที — ปล่อยก่อนเพื่อยกเลิก</p>`,
      actions: [{ label: 'ไม่หยุด', primary: true }],
      onOpen(modal, close) {
        const btn = $('.hold-btn', modal), fill = $('.hold-fill', btn);
        let t0 = 0, raf = 0;
        const tick = () => {
          const p = Math.min(1, (performance.now() - t0) / ms);
          fill.style.width = `${p * 100}%`;
          if (p >= 1) { t0 = 0; navigator.vibrate?.(60); close('hold'); return; }
          raf = requestAnimationFrame(tick);
        };
        const start = e => { if (e) e.preventDefault(); if (t0) return; t0 = performance.now(); navigator.vibrate?.(15); raf = requestAnimationFrame(tick); };
        const stop = () => { t0 = 0; cancelAnimationFrame(raf); fill.style.width = '0'; };
        btn.addEventListener('pointerdown', start);
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
        btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
        btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') stop(); });
        btn.addEventListener('contextmenu', e => e.preventDefault());
      }
    }).then(r => r?.value === 'hold');
  }

  async function confirmDialog(title, text, okLabel = 'ยืนยัน') {
    const r = await dialog({
      title,
      body: `<p class="modal-text">${esc(text)}</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: okLabel, danger: true, value: true }]
    });
    return !!(r && r.value);
  }

  // ส่วนตั้งค่า Gateway ในแอปเดสก์ท็อป: สถานะ Gateway ในตัว + ffmpeg (ตัวเข้ารหัสวิดีโอที่ต้องติดตั้งแยก)
  const ENCODER_LABEL = {
    libx264: 'libx264 (ซอฟต์แวร์ ใช้ CPU)', h264_nvenc: 'การ์ดจอ NVIDIA (NVENC)', h264_qsv: 'Intel Quick Sync', h264_amf: 'การ์ดจอ AMD',
    h264_videotoolbox: 'ชิป Apple (VideoToolbox)', h264_mediacodec: 'ฮาร์ดแวร์ของเครื่อง (MediaCodec)'
  };
  function desktopGatewayHtml() {
    const info = desktop.info || {};
    const gw = info.gateway;
    const ff = info.ffmpeg;
    const install = { windows: '<code>winget install ffmpeg</code>', macos: '<code>brew install ffmpeg</code>' }[info.os] || '<code>sudo apt install ffmpeg</code> (หรือตัวจัดการแพ็กเกจของระบบ)';
    return `
      <label class="check"><input type="checkbox" name="localGateway" ${settings.localGateway !== false ? 'checked' : ''} ${gw ? '' : 'disabled'}>
        ใช้ Stream Gateway ในแอปนี้ (สตรีมจากเครื่องนี้โดยตรง ไม่ต้องมีเซิร์ฟเวอร์)</label>
      <p class="note">${gw ? `Gateway ในแอปพร้อม · ${esc(gw.url.replace(/\?.*$/, ''))}${gw.srt ? ' · ส่ง SRT ได้' : ''}` : `เปิด Gateway ในแอปไม่ได้: ${esc(info.gatewayError || desktop.error || 'ไม่ทราบสาเหตุ')}`}</p>
      <p class="note ${ff ? '' : 'warn'}">${ff ? `ffmpeg: ${esc(ff.version)} · ตัวเข้ารหัส: ${esc(ENCODER_LABEL[info.encoder] || info.encoder || 'libx264')}${info.encoderNote ? `<br><small>ใช้ตัวเข้ารหัสฮาร์ดแวร์ไม่ได้: ${esc(info.encoderNote)}</small>` : ''}` : `ไม่พบ ffmpeg — ติดตั้งด้วย ${install} แล้วเปิดแอปใหม่`}</p>
      ${desktop.mobile ? '<p class="note warn">ระหว่างไลฟ์ให้เปิดแอปค้างไว้บนหน้าจอและเสียบสายชาร์จ — ถ้าสลับไปแอปอื่นหรือปิดจอ Android จะหยุดกล้องและการสตรีม</p>' : ''}
      <p class="note">อินเทอร์เน็ตขาขึ้นของเครื่องนี้ต้องพอสำหรับทุกปลายทางรวมกัน (ffmpeg ส่งแยกทีละปลายทาง) · การรับสัญญาณ SRT เข้ามา และ TURN สำหรับมือถือยังต้องใช้ Gateway บนเซิร์ฟเวอร์</p>`;
  }

  function openSettings(tab = 'output') {
    const live = rec.active || streamer.active;
    let readDests = null;
    dialog({
      title: 'ตั้งค่า',
      wide: true,
      body: `
        <div class="modal-tabs"><button type="button" data-mtab="output">เอาต์พุต</button><button type="button" data-mtab="stream">การสตรีม</button></div>
        <div class="modal-pane" data-mpane="output">
          ${live ? '<p class="note warn">กำลังบันทึกหรือสตรีมอยู่ — เปลี่ยนความละเอียดและเฟรมเรตได้หลังหยุดก่อน</p>' : ''}
          <div class="field"><span>คุณภาพการไลฟ์และบันทึก</span>${qualityHtml(qualityOf(settings.resolution, settings.fps, settings.videoKbps)?.id)}</div>
          <details class="adv" ${qualityOf(settings.resolution, settings.fps, settings.videoKbps) ? '' : 'open'}><summary>ขั้นสูง — ความละเอียด เฟรมเรต บิตเรต ระบบวาดภาพ</summary>
          <div class="field-row">
            <label class="field"><span>ความละเอียด Program</span><select name="resolution" class="select" ${live ? 'disabled' : ''}>
              ${Object.keys(RESOLUTIONS).map(k => `<option value="${k}" ${settings.resolution === k ? 'selected' : ''}>${RES_LABEL[k]}</option>`).join('')}
            </select></label>
            <label class="field"><span>เฟรมเรต</span><select name="fps" class="select" ${live ? 'disabled' : ''}>
              ${FRAME_RATES.map(f => `<option value="${f}" ${+settings.fps === f ? 'selected' : ''}>${f} fps</option>`).join('')}
            </select></label>
          </div>
          <label class="field"><span>บิตเรตวิดีโอ (kbps) — ใช้ทั้งบันทึกและสตรีม</span>
            <input name="videoKbps" class="input" type="number" min="800" max="${MAX_KBPS}" step="100" value="${settings.videoKbps}" ${live ? 'disabled' : ''}></label>
          <label class="field"><span>ระบบวาดภาพ</span><select name="renderer" class="select">
            <option value="auto" ${settings.renderer === 'auto' ? 'selected' : ''}>อัตโนมัติ (แนะนำ) — ตอนนี้ใช้ ${gpu && !gpu.software ? 'การ์ดจอ (GPU)' : 'CPU'}</option>
            <option value="gpu" ${settings.renderer === 'gpu' ? 'selected' : ''} ${gpu ? '' : 'disabled'}>การ์ดจอ (GPU / WebGL) — ลื่นที่ 4K และ Overlay หลายชั้น</option>
            <option value="cpu" ${settings.renderer === 'cpu' ? 'selected' : ''}>CPU (Canvas 2D) — ใช้เมื่อการ์ดจอมีปัญหา</option>
          </select></label>
          <p class="note">${gpu ? `การ์ดจอที่พบ: ${esc(gpu.rendererName)}${gpu.software ? ' (เป็นการ์ดจอจำลองด้วยซอฟต์แวร์ — โหมดอัตโนมัติจึงใช้ CPU)' : ''}` : 'เบราว์เซอร์นี้ใช้ WebGL ไม่ได้ — วาดภาพด้วย CPU'}</p>
          <p class="note">ค่าแนะนำจะใส่ให้อัตโนมัติเมื่อเปลี่ยนความละเอียด/เฟรมเรต: 720p ≈ 4500 · 1080p ≈ 6000 · 1440p ≈ 13000 · 4K ≈ 25000 kbps (×1.5 สำหรับ 50/60 fps)</p>
          </details>
          <div class="field"><span>โฟลเดอร์บันทึกวิดีโอ (REC)</span>
            <div class="link-row"><input class="input rec-folder-name" readonly value="${esc(recFolder ? recFolder.name : canPickFolder ? 'ยังไม่ได้เลือก — ดาวน์โหลดไฟล์เมื่อกดหยุด' : 'เบราว์เซอร์นี้เลือกโฟลเดอร์ไม่ได้ — ดาวน์โหลดไฟล์เมื่อกดหยุด')}">
            ${canPickFolder ? `<button type="button" class="btn rec-folder-pick">เลือกโฟลเดอร์</button>${recFolder ? '<button type="button" class="btn btn-ghost rec-folder-clear">ล้าง</button>' : ''}` : ''}</div></div>
          <p class="note">ระหว่างบันทึก ไฟล์ถูกเขียนลง${recFolder ? 'โฟลเดอร์ที่เลือก' : canUseOpfs ? 'ดิสก์ (พื้นที่ชั่วคราวของเบราว์เซอร์) แล้วดาวน์โหลดเมื่อหยุด' : ' RAM — บันทึกนาน ๆ ควรใช้ Chrome หรือ Edge'} จึงบันทึกนานหลายชั่วโมงได้โดยไม่กินหน่วยความจำ</p>
          <p class="note warn res-4k-note" ${RESOLUTIONS[settings.resolution][1] >= 1440 ? '' : 'hidden'}>ความละเอียด 1440p/4K ต้องใช้คอมพิวเตอร์แรง (แนะนำ CPU 8 คอร์ขึ้นไปหรือมีการ์ดจอแยก) และอินเทอร์เน็ตขาขึ้นอย่างน้อย 1.5 เท่าของบิตเรต · Stream Gateway ควรมี 8 vCPU ขึ้นไป · Facebook และ Twitch รับสูงสุด 1080p ส่วน YouTube รับได้ถึง 4K</p>
        </div>
        <div class="modal-pane" data-mpane="stream">
          ${streamer.ws ? '<p class="note warn">กำลังสตรีมอยู่ — การแก้ไขปลายทางจะมีผลเมื่อหยุดแล้วเริ่มปลายทางนั้นใหม่ในแผง STREAM</p>' : ''}
          <div class="field">
            <span>ปลายทาง (สูงสุด ${MAX_DESTINATIONS} ช่อง) — ช่องที่ติ๊กไว้จะเริ่มพร้อมกันเมื่อกด “เริ่มทั้งหมด” ส่วนช่องอื่นเริ่มทีละช่องได้ในแผง STREAM</span>
            <div class="dest-list"></div>
            <button type="button" class="btn btn-sm dest-add">${icon('plus')}เพิ่มปลายทาง</button>
          </div>
          <div class="dest-options">
            <label class="check"><input type="checkbox" class="dest-showkeys"> แสดง Stream Key / รหัสผ่าน</label>
            <label class="check"><input type="checkbox" name="rememberKey" ${settings.rememberKey ? 'checked' : ''}> จำ Stream Key และรหัสผ่าน SRT ไว้ในเบราว์เซอร์เครื่องนี้</label>
          </div>
          <details class="adv" ${gatewayProblem() ? 'open' : ''}><summary>ขั้นสูง — Stream Gateway (ตัวกลางส่งสัญญาณ)${gatewayProblem() ? ' · ต้องตั้งค่า' : ''}</summary>
          ${desktop ? desktopGatewayHtml() : ''}
          <label class="field gateway-remote"><span>${desktop ? 'Stream Gateway บนเซิร์ฟเวอร์ (WebSocket)' : 'Stream Gateway (WebSocket)'}</span>
            <input name="gateway" class="input mono" placeholder="wss://gateway.example.com:8080/?token=..." value="${esc(settings.gateway)}"></label>
          <p class="note" ${desktop ? 'hidden' : ''}>เบราว์เซอร์ส่ง RTMP เองไม่ได้ ต้องมี Gateway (โฟลเดอร์ <code>server/</code> ในโปรเจกต์) คอยแปลงสัญญาณ — หน้า HTTPS ต้องใช้ <code>wss://</code> · ภาพถูกส่งขึ้น Gateway ครั้งเดียวแล้วกระจายไปทุกปลายทาง จึงใช้อินเทอร์เน็ตขาขึ้นเท่ากับสตรีมช่องเดียว</p>
          </details>
        </div>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        const showTab = name => {
          $$('[data-mtab]', modal).forEach(b => b.classList.toggle('is-active', b.dataset.mtab === name));
          $$('[data-mpane]', modal).forEach(p => p.classList.toggle('is-active', p.dataset.mpane === name));
        };
        $$('[data-mtab]', modal).forEach(b => b.addEventListener('click', () => showTab(b.dataset.mtab)));
        showTab(tab);
        const fo = $('form', modal);
        const suggest4k = () => { $('.res-4k-note', modal).hidden = RESOLUTIONS[fo.resolution.value][1] < 1440; };
        const suggest = () => {
          fo.videoKbps.value = recommendedKbps(fo.resolution.value, +fo.fps.value);
          suggest4k();
        };
        fo.resolution.addEventListener('change', suggest);
        // เลือกระดับคุณภาพ → ใส่ค่าในช่องขั้นสูงให้ · แก้ช่องขั้นสูงเองจนไม่ตรงระดับไหน = "กำหนดเอง" (ไม่มีระดับถูกเลือก)
        if (!live) bindQuality(modal, q => { fo.resolution.value = q.res; fo.fps.value = q.fps; fo.videoKbps.value = q.kbps; suggest4k(); });
        else $$('input[name=quality], .q-speed-btn', modal).forEach(el => { el.disabled = true; });
        const syncQ = () => { const q = qualityOf(fo.resolution.value, fo.fps.value, fo.videoKbps.value); $$('input[name=quality]', modal).forEach(r => { r.checked = !!q && r.value === q.id; }); };
        [fo.resolution, fo.fps].forEach(el => el.addEventListener('change', syncQ));
        fo.videoKbps.addEventListener('input', syncQ);
        $('.rec-folder-pick', modal)?.addEventListener('click', async () => {
          const dir = await pickRecFolder();
          if (dir) { $('.rec-folder-name', modal).value = dir.name; toast(`บันทึกวิดีโอลงโฟลเดอร์ “${dir.name}”`, 'success'); }
        });
        $('.rec-folder-clear', modal)?.addEventListener('click', async e => {
          await clearRecFolder();
          $('.rec-folder-name', modal).value = recFolder ? recFolder.name : 'ยังไม่ได้เลือก — ดาวน์โหลดไฟล์เมื่อกดหยุด';
          e.currentTarget.remove();
        });
        fo.fps.addEventListener('change', suggest);
        if (fo.localGateway) {
          const syncGw = () => { $('.gateway-remote', modal).hidden = fo.localGateway.checked; };
          fo.localGateway.addEventListener('change', syncGw);
          syncGw();
        }
        const list = $('.dest-list', modal);
        const addBtn = $('.dest-add', modal);
        const showKeys = $('.dest-showkeys', modal);
        const rowHtml = d => `
          <div class="dest-row ${d.enabled ? '' : 'is-disabled'}" data-id="${esc(d.id)}">
            <label class="dest-enable" title="สตรีมไปปลายทางนี้"><input type="checkbox" data-f="enabled" ${d.enabled ? 'checked' : ''}></label>
            <select class="select" data-f="platform" aria-label="แพลตฟอร์ม">
              ${Object.entries(PLATFORMS).map(([k, p]) => `<option value="${k}" ${d.platform === k ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
            <input class="input mono" data-f="server" value="${esc(d.server)}" placeholder="${isSrt(d) ? 'srt://host:9000' : 'rtmp://...'}" aria-label="Server URL">
            <input class="input mono" data-f="key" type="${showKeys.checked ? 'text' : 'password'}" autocomplete="off" value="${esc(d.key)}" placeholder="${isSrt(d) ? 'Stream ID (ถ้ามี)' : 'Stream Key'}" aria-label="Stream Key / Stream ID">
            <button type="button" class="btn btn-ghost btn-icon dest-remove" title="ลบปลายทาง">${icon('x')}</button>
            <button type="button" class="btn dest-paste">${icon('copy')}วางคีย์จากคลิปบอร์ด</button>
            <div class="dest-test"><button type="button" class="btn btn-sm dest-test-btn" title="${TEST_NOTE}">${icon('broadcast')}ทดสอบ</button><p class="dest-test-out" hidden></p></div>
            <div class="dest-srt" ${isSrt(d) ? '' : 'hidden'}>
              <input class="input mono" data-f="passphrase" type="${showKeys.checked ? 'text' : 'password'}" autocomplete="off" value="${esc(d.passphrase)}" placeholder="รหัสผ่านเข้ารหัส SRT (10–64 ตัว, ถ้ามี)" aria-label="SRT passphrase">
              <select class="select" data-f="latency" aria-label="SRT latency" title="SRT latency — ยิ่งสูงยิ่งทนเน็ตกระตุก แต่ดีเลย์มากขึ้น">
                ${SRT_LATENCIES.map(ms => `<option value="${ms}" ${d.latency === ms ? 'selected' : ''}>Latency ${ms} ms</option>`).join('')}
              </select>
            </div>
          </div>`;
        const syncAdd = () => { addBtn.disabled = $$('.dest-row', list).length >= MAX_DESTINATIONS; };
        list.innerHTML = settings.destinations.map(rowHtml).join('');
        syncAdd();
        addBtn.addEventListener('click', () => {
          // แนะนำแพลตฟอร์มที่ยังไม่ได้ใช้ก่อน (YouTube → Facebook → Twitch → อื่น ๆ)
          const used = $$('[data-f=platform]', list).map(sel => sel.value);
          const next = ['youtube', 'facebook', 'twitch'].find(k => !used.includes(k)) || 'custom';
          list.insertAdjacentHTML('beforeend', rowHtml(newDest(next)));
          list.lastElementChild.querySelector('[data-f=platform]').focus();
          syncAdd();
        });
        list.addEventListener('click', e => {
          // ลบปลายทาง: เหลือแถบ "เลิกทำ" ไว้แทน จนกว่าจะปิดหน้าต่าง
          const rm = e.target.closest('.dest-remove');
          if (rm) {
            const row = rm.closest('.dest-row');
            const ph = document.createElement('div');
            ph.className = 'dest-removed';
            ph.innerHTML = `<span>ลบ “${esc(destLabel(readRow(row)) || 'ปลายทาง')}” แล้ว</span><button type="button" class="btn btn-sm dest-undo">เลิกทำ</button>`;
            ph.row = row;
            row.replaceWith(ph);
            syncAdd();
          }
          const undo = e.target.closest('.dest-undo');
          if (undo) { const ph = undo.closest('.dest-removed'); ph.replaceWith(ph.row); syncAdd(); }
          const paste = e.target.closest('.dest-paste');
          if (paste) pasteKey(paste.closest('.dest-row'));
          const test = e.target.closest('.dest-test-btn');
          if (test) runDestTest(test, $('.dest-test-out', test.closest('.dest-row')), readRow(test.closest('.dest-row')));
        });
        // มือถือ: พิมพ์คีย์ยาว ๆ ยาก — วางจากคลิปบอร์ด · ถ้าวาง URL เต็ม (rtmp://…/คีย์) แยกเป็นเซิร์ฟเวอร์ + คีย์ให้
        const pasteKey = async row => {
          let text = '';
          try { text = (await navigator.clipboard.readText()).trim(); } catch (err) {}
          if (!text) { toast('อ่านคลิปบอร์ดไม่ได้ — กดค้างที่ช่อง Stream Key แล้วเลือก “วาง”', 'warn'); row.querySelector('[data-f=key]').focus(); return; }
          const m = /^(rtmps?:\/\/.+)\/([^/]+)$/i.exec(text);
          if (m && /\/(live|rtmp|live2|app)\b/i.test(m[1])) { row.querySelector('[data-f=server]').value = m[1]; row.querySelector('[data-f=key]').value = m[2]; }
          else row.querySelector('[data-f=key]').value = text;
          toast('วางคีย์แล้ว', 'success', 2000);
        };
        list.addEventListener('change', e => {
          const row = e.target.closest('.dest-row');
          if (e.target.dataset.f === 'platform') {
            const p = PLATFORMS[e.target.value];
            const srt = e.target.value === 'srt';
            const server = row.querySelector('[data-f=server]');
            if (p.server) server.value = p.server; else { server.value = ''; server.focus(); }
            server.placeholder = srt ? 'srt://host:9000' : 'rtmp://...';
            row.querySelector('[data-f=key]').placeholder = srt ? 'Stream ID (ถ้ามี)' : 'Stream Key';
            row.querySelector('.dest-srt').hidden = !srt;
          }
          if (e.target.dataset.f === 'enabled') row.classList.toggle('is-disabled', !e.target.checked);
        });
        showKeys.addEventListener('change', () => {
          $$('[data-f=key], [data-f=passphrase]', list).forEach(i => { i.type = showKeys.checked ? 'text' : 'password'; });
        });
        const readRow = row => ({
          id: row.dataset.id,
          enabled: row.querySelector('[data-f=enabled]').checked,
          platform: row.querySelector('[data-f=platform]').value,
          server: row.querySelector('[data-f=server]').value.trim(),
          key: row.querySelector('[data-f=key]').value.trim(),
          passphrase: row.querySelector('[data-f=passphrase]').value,
          latency: +row.querySelector('[data-f=latency]').value || 500
        });
        readDests = () => $$('.dest-row', list).map(readRow);
      }
    }).then(result => {
      if (result?.value !== 'save') return;
      const f = result.form;
      const before = `${settings.resolution}|${settings.fps}`;
      if (!live) {
        settings.resolution = f.resolution.value;
        settings.fps = +f.fps.value;
        settings.videoKbps = clamp(Math.round(+f.videoKbps.value || 4500), 800, MAX_KBPS);
      }
      const gwBefore = gatewayUrl();
      settings.gateway = f.gateway.value.trim();
      if (f.localGateway) settings.localGateway = f.localGateway.checked;
      const gatewayChanged = gwBefore !== gatewayUrl();
      if (gatewayChanged) wireless.restart();
      if (readDests) settings.destinations = readDests();
      settings.rememberKey = f.rememberKey.checked;
      if (['auto', 'gpu', 'cpu'].includes(f.renderer.value)) settings.renderer = f.renderer.value;
      renderer.resolve();
      saveSettings();
      if (before !== `${settings.resolution}|${settings.fps}`) applyResolution();
      updateStatus();
      toast('บันทึกการตั้งค่าแล้ว', 'success');
    });
  }

  /* ------------------------------------------- ใช้งานง่าย: คุณภาพแบบเลือกคำ · วัดความเร็วเน็ต · ทดสอบปลายทาง · เริ่มต้นใช้งาน */
  // ระดับคุณภาพ — ผู้ใช้ส่วนใหญ่ไม่ต้องรู้จัก kbps/fps (ปรับละเอียดได้ใน "ขั้นสูง")
  const QUALITY = [
    { id: 'eco', label: 'ประหยัดเน็ต', res: '720p', fps: 30, kbps: 2500, note: 'เน็ตมือถือ / เน็ตไม่แรง' },
    { id: 'std', label: 'มาตรฐาน', res: '720p', fps: 30, kbps: 4500, note: 'เหมาะกับงานส่วนใหญ่' },
    { id: 'high', label: 'คมชัดสูง', res: '1080p', fps: 30, kbps: 6000, note: 'เน็ตบ้าน/ไฟเบอร์ เครื่องแรง' }
  ];
  const qualityOf = (res, f, kbps) => QUALITY.find(q => q.res === res && q.fps === +f && q.kbps === +kbps);
  // เน็ตขาขึ้นที่ต้องใช้ (Mbps): Gateway ในเครื่องส่งแยกทีละปลายทาง · Gateway บนเซิร์ฟเวอร์ส่งขึ้นครั้งเดียว · เผื่อ 1.5 เท่า
  const uploadCopies = () => usingLocalGateway() ? Math.max(1, settings.destinations.filter(d => d.enabled).length) : 1;
  const needMbps = kbps => (kbps + 160) * uploadCopies() * 1.5 / 1000;
  function qualityHtml(current) {
    return `<div class="q-picker" role="radiogroup" aria-label="คุณภาพการไลฟ์">${QUALITY.map(q => `
      <label class="q-opt"><input type="radio" name="quality" value="${q.id}" ${current === q.id ? 'checked' : ''}>
        <span class="q-card"><b>${q.label}</b><small>${q.note}</small><small class="q-need">${formatTag(RESOLUTIONS[q.res][1], q.fps)} · เน็ตขาขึ้น ≈ ${needMbps(q.kbps).toFixed(1)} Mbps</small></span></label>`).join('')}
      </div>
      <div class="q-speed"><button type="button" class="btn btn-sm q-speed-btn">${icon('broadcast')}วัดความเร็วเน็ตแล้วแนะนำให้</button><span class="q-speed-out" aria-live="polite"></span></div>`;
  }
  // วัดความเร็วอัปโหลดจริง: ส่งข้อมูลสุ่มไป speed.cloudflare.com (ไม่มีข้อมูลของผู้ใช้) ใช้เน็ตราว 10–30 MB
  async function measureUpload(onProgress) {
    const chunk = n => { const a = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(a.subarray(i, Math.min(n, i + 65536))); return a; };
    const send = body => fetch('https://speed.cloudflare.com/__up', { method: 'POST', body, mode: 'cors', cache: 'no-store', headers: { 'Content-Type': 'text/plain' } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); });
    let best = 0;
    for (const size of [1e6, 4e6, 10e6]) {
      const data = chunk(size);
      const t0 = performance.now();
      await Promise.all([send(data), send(data)]);
      const sec = (performance.now() - t0) / 1000;
      best = Math.max(best, size * 2 * 8 / sec / 1e6);
      onProgress?.(best);
      if (sec > 3) break;
    }
    return best;
  }
  function bindQuality(root, onPick) {
    const out = $('.q-speed-out', root), btn = $('.q-speed-btn', root);
    $$('input[name=quality]', root).forEach(r => r.addEventListener('change', () => onPick(QUALITY.find(q => q.id === r.value))));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.className = 'q-speed-out';
      out.textContent = 'กำลังวัด…';
      try {
        const mbps = await measureUpload(v => { out.textContent = `กำลังวัด… ${v.toFixed(1)} Mbps`; });
        const pick = [...QUALITY].reverse().find(q => needMbps(q.kbps) <= mbps) || QUALITY[0];
        $(`input[name=quality][value=${pick.id}]`, root).checked = true;
        onPick(pick);
        const enough = needMbps(pick.kbps) <= mbps;
        out.classList.add(enough ? 'ok' : 'warn');
        out.textContent = `อัปโหลด ≈ ${mbps.toFixed(1)} Mbps — แนะนำ “${pick.label}”` + (enough ? '' : ' (เน็ตยังช้าไป ภาพอาจกระตุก)');
      } catch (e) {
        out.classList.add('warn');
        out.textContent = 'วัดความเร็วไม่ได้ (ไม่มีอินเทอร์เน็ตหรือถูกบล็อก) — เลือกเองตามเน็ตที่ใช้';
      }
      btn.disabled = false;
    });
  }

  // ทดสอบปลายทาง: ส่งภาพ Program สั้น ๆ จนปลายทางรับได้ ~3 วินาที แล้วหยุด — รู้ก่อนไลฟ์จริงว่าคีย์/เซิร์ฟเวอร์ใช้ได้
  const pause = ms => new Promise(r => setTimeout(r, ms));
  async function testDestination(d) {
    if (streamer.ws || streamer.reconnecting) return { ok: false, message: 'กำลังไลฟ์อยู่ — ทดสอบได้เมื่อหยุดไลฟ์แล้ว' };
    const problem = gatewayProblem() || destProblem(d);
    if (problem) return { ok: false, message: problem };
    streamer.testing = true;
    streamer.lastError = '';
    startDestinations([d]);
    const t0 = Date.now();
    let liveAt = 0, result = null;
    while (!result) {
      await pause(300);
      const st = streamer.dests.get(d.id);
      if (st && st.state === 'live') {
        liveAt = liveAt || Date.now();
        if (Date.now() - liveAt > 2500) result = { ok: true, message: `ส่งภาพถึง ${destLabel(d)} ได้แล้ว — พร้อมไลฟ์` };
      } else if (st && st.state === 'error') result = { ok: false, message: st.message || 'ปลายทางปฏิเสธการเชื่อมต่อ — ตรวจ Stream Key' };
      else if (!streamer.ws && !streamer.reconnecting) result = { ok: false, message: streamer.lastError || 'เชื่อมต่อ Stream Gateway ไม่ได้' };
      else if (Date.now() - t0 > 20000) result = { ok: false, message: 'ปลายทางไม่ตอบรับภายใน 20 วินาที — ตรวจเซิร์ฟเวอร์และ Stream Key' };
    }
    stopAllStreams();
    for (let i = 0; i < 20 && (streamer.ws || streamer.reconnecting); i++) await pause(150);
    streamer.testing = false;
    return result;
  }
  const TEST_NOTE = 'ส่งภาพจริงไปปลายทางประมาณ 5 วินาที — YouTube ที่เปิด “เริ่มอัตโนมัติ” อาจขึ้นไลฟ์สั้น ๆ';
  async function runDestTest(btn, out, d) {
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.textContent = 'กำลังทดสอบ…';
    out.hidden = false;
    out.className = 'dest-test-out';
    out.textContent = 'กำลังส่งภาพทดสอบ…';
    const r = await testDestination(d);
    out.classList.add(r.ok ? 'ok' : 'err');
    out.textContent = (r.ok ? '✓ ' : '✕ ') + r.message;
    btn.innerHTML = label;
    btn.disabled = false;
    return r;
  }

  // ตั้งค่าครั้งแรก 3 ขั้น: กล้อง → ช่องทางไลฟ์ + คีย์ (ทดสอบได้) → คุณภาพ
  const KEY_HELP = {
    youtube: 'หาคีย์: YouTube Studio → สร้าง → ไลฟ์สด → คัดลอก “คีย์สตรีม”',
    facebook: 'หาคีย์: facebook.com/live/producer → “ซอฟต์แวร์สตรีม” → คัดลอก “คีย์สตรีม”',
    twitch: 'หาคีย์: Twitch Creator Dashboard → Settings → Stream → Primary Stream key',
    custom: 'ใส่ RTMP Server URL และ Stream Key จากผู้ให้บริการ'
  };
  const obSteps = n => `<ol class="ob-steps">${['กล้อง', 'ช่องทางไลฟ์', 'คุณภาพ'].map((t, i) => `<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'now' : ''}">${t}</li>`).join('')}</ol>`;
  const obSheet = modal => { modal.classList.add('ob'); if (isPhoneUI()) modal.classList.add('m-sheet'); };
  function shouldOnboard() {
    if (store.get('onboarded', false) || /[?&]call=/.test(location.search)) return false;
    if (/onboard/.test(location.hash)) return true;
    if (navigator.webdriver || (desktop && desktop.info && desktop.info.selftest)) return false;
    return firstRun;
  }
  async function openOnboarding() {
    store.set('onboarded', true);
    // ขั้นที่ 1: กล้อง
    const hasCam = () => inputs.some(i => i.type === 'camera');
    const r1 = await dialog({
      title: 'ยินดีต้อนรับสู่ WebMix',
      body: `${obSteps(1)}<p class="ob-lead">ตั้งค่าให้พร้อมไลฟ์ใน 3 ขั้น — ข้ามแล้วกลับมาทำทีหลังได้จากเมนู “เพิ่มเติม → เริ่มต้นใช้งาน”</p>
        <p class="modal-text">${hasCam() ? 'มีกล้องในรายการแหล่งภาพแล้ว ✓' : 'เริ่มจากเพิ่มกล้องและไมค์ของเครื่องนี้เป็นแหล่งภาพแรก'}</p>`,
      actions: [{ label: 'ข้าม', value: 'skip' }, { label: hasCam() ? 'ถัดไป' : 'เพิ่มกล้อง', value: 'cam', primary: true }],
      onOpen: obSheet
    });
    if (!r1) return;
    if (r1.value === 'cam' && !hasCam()) await openCameraDialog();

    // ขั้นที่ 2: ช่องทางไลฟ์
    const first = settings.destinations[0];
    const tiles = ['youtube', 'facebook', 'twitch', 'custom'];
    const startPlat = first && tiles.includes(first.platform) ? first.platform : 'youtube';
    const needGw = !usingLocalGateway() && !!gatewayProblem();
    let draft = null;
    const r2 = await dialog({
      title: 'ไลฟ์ไปที่ไหน',
      body: `${obSteps(2)}
        <div class="ob-plats" role="radiogroup" aria-label="แพลตฟอร์ม">${tiles.map(k => `
          <label class="ob-plat"><input type="radio" name="plat" value="${k}" ${k === startPlat ? 'checked' : ''}><span>${k === 'custom' ? 'อื่น ๆ (RTMP)' : esc(PLATFORMS[k].label.replace(/ Live$/, ''))}</span></label>`).join('')}</div>
        <label class="field ob-server" hidden><span>RTMP Server URL</span><input name="server" class="input mono" placeholder="rtmp://..." value="${esc(first && first.platform === 'custom' ? first.server : '')}"></label>
        <div class="field"><span>Stream Key</span>
          <div class="link-row"><input name="key" class="input mono" type="password" autocomplete="off" placeholder="วางคีย์สตรีมที่นี่" aria-label="Stream Key" value="${esc(first ? first.key : '')}">
          <button type="button" class="btn ob-paste">${icon('copy')}วาง</button></div></div>
        <p class="note ob-help"></p>
        ${needGw ? `<label class="field"><span>Stream Gateway (WebSocket) — การไลฟ์จากเว็บต้องมีตัวกลางส่งสัญญาณ</span><input name="gateway" class="input mono" placeholder="wss://gateway.example.com:8080/?token=..." value="${esc(settings.gateway)}"></label>` : ''}
        <div class="ob-test"><button type="button" class="btn ob-test-btn">${icon('broadcast')}ทดสอบปลายทาง</button><p class="dest-test-out" hidden></p></div>
        <p class="note">${TEST_NOTE}</p>`,
      actions: [{ label: 'ข้าม', value: 'skip' }, { label: 'ถัดไป', value: 'next', primary: true }],
      onOpen(modal) {
        obSheet(modal);
        const f = $('form', modal);
        const plat = () => $('input[name=plat]:checked', modal).value;
        const sync = () => { $('.ob-server', modal).hidden = plat() !== 'custom'; $('.ob-help', modal).textContent = KEY_HELP[plat()]; };
        $$('input[name=plat]', modal).forEach(r => r.addEventListener('change', sync));
        sync();
        $('.ob-paste', modal).addEventListener('click', async () => {
          let text = '';
          try { text = (await navigator.clipboard.readText()).trim(); } catch (e) {}
          if (!text) { toast('อ่านคลิปบอร์ดไม่ได้ — กดค้างที่ช่องคีย์แล้วเลือก “วาง”', 'warn'); f.key.focus(); return; }
          const m = /^(rtmps?:\/\/.+)\/([^/]+)$/i.exec(text);
          if (m) { f.key.value = m[2]; if (plat() === 'custom') f.server.value = m[1]; } else f.key.value = text;
        });
        draft = () => {
          const k = plat();
          if (f.gateway) settings.gateway = f.gateway.value.trim();
          return { ...(first && first.platform === k ? first : newDest(k)), platform: k, server: k === 'custom' ? f.server.value.trim() : PLATFORMS[k].server, key: f.key.value.trim(), enabled: true };
        };
        $('.ob-test-btn', modal).addEventListener('click', e => runDestTest(e.currentTarget, $('.ob-test .dest-test-out', modal), draft()));
      }
    });
    if (!r2) return;
    if (r2.value === 'next' && draft) {
      const d = draft();
      if (d.key || d.platform === 'custom') {
        const i = settings.destinations.findIndex(x => x.id === d.id);
        if (i >= 0) settings.destinations[i] = d; else settings.destinations.unshift(d);
        // ปลายทางเริ่มต้นที่ยังว่าง (ไม่มีคีย์) ไม่ต้องเก็บไว้ให้สับสน
        settings.destinations = settings.destinations.filter(x => x.id === d.id || x.key).slice(0, MAX_DESTINATIONS);
      }
      saveSettings();
    }

    // ขั้นที่ 3: คุณภาพ
    let picked = qualityOf(settings.resolution, settings.fps, settings.videoKbps) || QUALITY[1];
    const r3 = await dialog({
      title: 'คุณภาพการไลฟ์',
      body: `${obSteps(3)}<p class="modal-text">เลือกตามความเร็วอินเทอร์เน็ต — ไม่แน่ใจให้กด “วัดความเร็วเน็ต”</p>${qualityHtml(picked.id)}
        <p class="note">ปรับความละเอียด/เฟรมเรต/บิตเรตเองได้ที่ ตั้งค่า → เอาต์พุต → ขั้นสูง</p>`,
      actions: [{ label: 'เสร็จสิ้น', value: 'done', primary: true }],
      onOpen(modal) { obSheet(modal); bindQuality(modal, q => { picked = q; }); }
    });
    if (r3 && !(rec.active || streamer.active)) applyQuality(picked);
    if (r3) toast('พร้อมแล้ว — กด STREAM เพื่อเริ่มไลฟ์', 'success', 5000);
  }
  function applyQuality(q) {
    const before = `${settings.resolution}|${settings.fps}`;
    Object.assign(settings, { resolution: q.res, fps: q.fps, videoKbps: q.kbps });
    saveSettings();
    if (before !== `${settings.resolution}|${settings.fps}`) applyResolution();
    updateStatus();
  }

  /* --------------------------------------------------------------- help */
  // ข้อความคู่มือและคีย์ลัดอยู่ใน assets/js/manual.js

  function openHelp() {
    dialog({
      title: 'คู่มือการใช้งาน',
      wide: true,
      body: `
        <div class="help">
          <h3>คีย์ลัด</h3>
          <div class="kbd-grid">${SHORTCUTS.map(([k, d]) => `<div class="kbd-row"><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>
        </div>
        ${MANUAL.map(([h, items]) => `<div class="help"><h3>${esc(h)}</h3><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}`,
      actions: [{ label: 'ดาวน์โหลดคู่มือ (Word)', value: 'word' }, { label: 'ปิด', primary: true }]
    }).then(r => { if (r?.value === 'word') exportManual(); });
  }

  function exportManual() {
    const css = `body{font-family:'TH Sarabun New','Sarabun','Tahoma',sans-serif;font-size:16pt;line-height:1.35}h1{font-size:26pt;margin:0 0 4pt}
      h2{font-size:19pt;color:#b91c1c;border-bottom:1px solid #ddd;margin:16pt 0 6pt}table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #bbb;padding:3pt 8pt;font-size:15pt;text-align:left}th{background:#f1f1f1}.muted{color:#666}`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
      <title>คู่มือ WebMix Pro</title><style>${css}</style></head><body>
      <h1>คู่มือการใช้งาน WebMix Pro</h1>
      <p class="muted">ระบบสลับภาพและเสียงสำหรับไลฟ์สด ทำงานบนเว็บเบราว์เซอร์ · ${esc(location.origin + location.pathname)}</p>
      ${MANUAL.map(([h, items]) => `<h2>${esc(h)}</h2><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
      <h2>คีย์ลัด</h2><table><tr><th>ปุ่ม</th><th>การทำงาน</th></tr>${SHORTCUTS.map(([k, d]) => `<tr><td>${esc(k)}</td><td>${esc(d)}</td></tr>`).join('')}</table>
      <h2>การติดตั้ง Stream Gateway</h2>
      <ul><li>ติดตั้ง Node.js 18+ และ ffmpeg บนเครื่องที่จะรัน Gateway</li>
      <li>ในโฟลเดอร์ server ของโปรเจกต์ สั่ง <b>npm install</b> แล้ว <b>STREAM_TOKEN=รหัสลับ npm start</b></li>
      <li>วาง Gateway ไว้หลัง reverse proxy ที่มี TLS แล้วใส่ wss://โดเมน/?token=รหัสลับ ในหน้าตั้งค่า</li></ul>
      </body></html>`;
    downloadBlob(new Blob(['﻿', html], { type: 'application/msword' }), 'WebMix-Pro-Manual.doc');
  }

  /* ---------------------------------------------------------- add menu */
  // เพิ่มแหล่งภาพ: แผ่นการ์ดไอคอน + คำอธิบายสั้น จัดเป็นหมวด (มือถือเลื่อนขึ้นจากล่าง)
  const ADD_GROUPS = () => [
    ['กล้องและหน้าจอ', [
      ['video', 'กล้อง / แคปเจอร์การ์ด', 'เว็บแคม กล้องของเครื่อง หรือการ์ดจับภาพ HDMI', openCameraDialog],
      ['monitor', 'แชร์หน้าจอ', 'หน้าจอคอม หน้าต่างโปรแกรม หรือแท็บเบราว์เซอร์', addScreen]]],
    ['ไฟล์', [
      ['film', 'ไฟล์วิดีโอ', 'MP4 / WebM จากเครื่องนี้', () => pickFiles('video/*', addVideoFiles)],
      ['repeat', 'Playlist', 'วิดีโอและรูปหลายไฟล์เล่นต่อกัน', addPlaylist],
      ['image', 'ภาพนิ่ง / โลโก้', 'PNG พื้นโปร่งใสใช้เป็นโลโก้มุมจอได้', () => pickFiles('image/*', addImageFiles)]]],
    ['เชื่อมต่อจากที่อื่น', [
      ['phone', 'กล้องมือถือไร้สาย', 'สแกน QR ด้วยมือถืออีกเครื่อง แล้วใช้เป็นกล้อง', showWirelessDialog],
      ['headphones', 'แขกรับเชิญทางไกล', 'ส่งลิงก์ให้แขก คุยกันได้ทั้งภาพและเสียง', addGuest],
      ['broadcast', 'สัญญาณ SRT', 'รับภาพจาก OBS / vMix / encoder', openSrtInputDialog]]],
    ['กราฟิกและข้อความ', [
      ['type', 'Title กราฟิกข้อความ', 'ป้ายชื่อ/ข้อความบนพื้นโปร่งใส', addTitleInput],
      ['clock', 'นาฬิกานับถอยหลัง / จับเวลา', 'นับถอยหลังก่อนเริ่ม หรือจับเวลาการแข่ง', addTimerInput],
      ['grid', 'ป้ายคะแนน', 'คะแนนสองทีม พร้อมเวลาแข่ง', addScoreInput],
      ['type', 'ตัววิ่งข่าว', 'ข้อความวิ่งด้านล่างจอ', addTickerInput]]],
    ['ภาพพื้นฐาน', [
      ['type', 'Slate ข้อความ', 'จอข้อความ เช่น “เริ่มเร็ว ๆ นี้”', () => addGenerator('slate')],
      ['clock', 'นาฬิกา', 'เวลาปัจจุบันเต็มจอ', () => addGenerator('clock')],
      ['bars', 'Color Bars', 'แถบสีสำหรับทดสอบภาพ', () => addGenerator('bars')],
      ['square', 'Black', 'จอดำ', () => addGenerator('black')]]]
  ];
  function openAddMenu(anchor) {
    closeMenu();
    const groups = ADD_GROUPS();
    const items = groups.flatMap(g => g[1]);
    let n = 0;
    const menu = document.createElement('div');
    menu.className = 'menu add-sheet';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'เพิ่มแหล่งภาพ');
    menu.innerHTML = '<div class="add-sheet-title">เพิ่มแหล่งภาพ</div>' + groups.map(([label, list]) => `
      <div class="menu-label">${esc(label)}</div>
      <div class="add-grid">${list.map(it => `<button role="menuitem" class="add-tile" data-i="${n++}">${icon(it[0])}<span><b>${esc(it[1])}</b><small>${esc(it[2])}</small></span></button>`).join('')}</div>`).join('');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${clamp(r.right - mw, 8, innerWidth - mw - 8)}px`;
    menu.style.top = `${r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      closeMenu();
      audio.ensure();
      items[+b.dataset.i][3]();
    });
    menu.querySelector('button').focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
  }
  function outsideMenu(e) { if (!e.target.closest('.menu')) closeMenu(); }
  function closeMenu() {
    $$('.menu').forEach(m => m.remove());
    document.removeEventListener('pointerdown', outsideMenu, true);
  }

  /* -------------------------------------------------------- status bar */
  function setStat(id, text, cls = '') {
    const el = $(id);
    el.className = `stat ${cls}`;
    el.querySelector('b').textContent = text;
  }

  function updateStatus() {
    setStat('#st-engine', `${renderer.label()} · ${fps ? fps.toFixed(0) : '--'} fps · ${renderMs.toFixed(1)} ms`, fps && fps < settings.fps * 0.8 ? 'warn' : 'ok');
    setStat('#st-output', `${W}×${H} ${formatTag(H, settings.fps)} · ${settings.videoKbps} kbps`, 'ok');
    if (streamer.state === 'live') {
      const slow = streamer.ws && streamer.ws.bufferedAmount > 2e6;
      const { live, active, errors } = destCounts();
      const enc = streamer.encoder && streamer.encoder.speed ? ` · ENC ${streamer.encoder.speed.toFixed(2)}x` : '';
      const encSlow = streamer.encoder && streamer.encoder.speed && streamer.encoder.speed < 0.95;
      setStat('#st-stream', `LIVE ${fmtDuration(Date.now() - streamer.start)} · ${streamer.kbps} kbps · ${live}/${active} ปลายทาง${enc}${slow ? ' · เน็ตช้า' : ''}`, slow || errors || encSlow ? 'warn' : 'live');
    } else {
      const n = settings.destinations.filter(d => d.enabled).length;
      setStat('#st-stream', streamer.reconnecting ? `RECONNECTING… (ครั้งที่ ${streamer.attempt})` : streamer.state === 'connecting' ? 'CONNECTING…' : gatewayUrl() ? `READY · ${n} ปลายทาง` : 'NOT SET',
        streamer.reconnecting || streamer.state === 'connecting' ? 'warn' : '');
    }
    setStat('#st-rec', rec.active ? `${fmtDuration(Date.now() - rec.start)} · ${fmtBytes(rec.bytes)} → ${rec.sink.kind === 'folder' ? 'โฟลเดอร์ ' + rec.sink.label : rec.sink.label}` : 'OFF',
      rec.active ? (rec.sink.kind === 'memory' && rec.bytes > 1.5e9 ? 'warn' : 'live') : '');
    const ws = wireless.status;
    const count = wireless.connectedCount();
    setStat('#st-wireless',
      ws === 'ready' ? `${count ? `${count} CONNECTED` : 'READY'}${wireless.sig && wireless.sig.u ? ' · TURN' : ''}` : ws === 'connecting' ? 'CONNECTING…' : ws === 'unavailable' ? 'UNAVAILABLE' : 'OFFLINE',
      ws === 'ready' ? 'ok' : ws === 'connecting' ? 'warn' : 'bad');
    const st = $('#st-audio');
    if (!audio.ctx || audio.ctx.state !== 'running') {
      st.className = 'stat warn';
      st.querySelector('b').innerHTML = '<button class="stat-btn" data-action="audio-on">แตะเพื่อเปิดระบบเสียง</button>';
    } else {
      setStat('#st-audio', `${audio.ctx.sampleRate / 1000} kHz · ${audio.channels.length} CH${audio.monitorOn ? ' · MON' : ''}`, 'ok');
    }
  }

  function resTag(w, h) {
    const p = Math.min(w, h);
    return p >= 2160 ? '4K' : p >= 1440 ? '1440p' : p >= 1080 ? '1080p' : p >= 720 ? '720p' : `${w}×${h}`;
  }
  // ข้อความเล็กใต้ชื่อบนการ์ด: สถานะสัญญาณ, ข้อมูลจากชีต, หรือชนิด + ความละเอียดจริง
  function cardSub(inp) {
    if (inp.type === 'srt' && inp.status !== 'live') return `SRT · ${SRT_IN_STATES[inp.srtState] || 'ไม่มีสัญญาณ'}`;
    if (inp.status !== 'live') return 'ไม่มีสัญญาณ';
    if (inp.data && inp.data.error) return 'DATA ERROR';
    if (inp.type === 'title' && inp.data && inp.data.rows && inp.data.rows.length) return `${inp.data.row + 1}/${inp.data.rows.length}`;
    if (inp.type === 'playlist') return inp.list.items.length ? `${inp.list.index + 1}/${inp.list.items.length}` : 'ว่าง';
    const meta = TYPE_META[inp.type];
    const label = inp.name.toUpperCase() === meta.label ? '' : meta.label;
    const w = inp.el?.videoWidth || inp.el?.naturalWidth, h = inp.el?.videoHeight || inp.el?.naturalHeight;
    return w && h ? `${label}${label ? ' · ' : ''}${resTag(w, h)}` : label;
  }
  function updateCardResolutions() {
    for (const inp of inputs) {
      const card = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
      if (card) card.textContent = cardSub(inp);
    }
  }

  function tickClock() {
    updateCardResolutions();
    const now = new Date();
    $('#clock').textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    $('#onair-timer').textContent = onAirSince ? fmtDuration(Date.now() - onAirSince) : '00:00:00';
    if (streamer.state === 'live') {
      const t = performance.now();
      streamer.kbps = Math.round((streamer.sent - streamer.lastBytes) * 8 / (t - streamer.lastAt));
      streamer.lastBytes = streamer.sent; streamer.lastAt = t;
    }
    liveStats.tick();
    updateStatus();
    renderAlerts();
    if (liveDialog && liveDialog.classList.contains('m-live')) refreshLiveDialog();
  }

  /* --------------------------------------------------------- wiring */
  function initSeg(id, current, onPick) {
    const seg = $(id);
    const paint = v => $$('button', seg).forEach(b => b.classList.toggle('is-active', b.dataset.value === String(v)));
    paint(current);
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      paint(b.dataset.value);
      onPick(b.dataset.value);
      saveSettings();
    });
  }

  function initControls() {
    initOverlayControls();
    initSeg('#seg-transition', settings.transition, v => { settings.transition = v; });
    initSeg('#seg-duration', settings.duration, v => { settings.duration = +v; });
    initSeg('#seg-pip-pos', settings.pip.position, v => { settings.pip.position = v; });
    initSeg('#seg-pip-size', settings.pip.size, v => { settings.pip.size = +v; });
    initSeg('#seg-key-color', settings.key.color, v => { settings.key.color = v; });

    const tb = makeFader($('#tbar'), { value: 0, onInput: onTbar, label: 'T-Bar' });
    tbar.set = v => tb.set(v);

    const head = $('#title-headline'), sub = $('#title-subtitle');
    head.value = settings.title.headline;
    sub.value = settings.title.subtitle;
    head.addEventListener('input', () => { settings.title.headline = head.value; saveSettings(); renderTitlePresets(); });
    sub.addEventListener('input', () => { settings.title.subtitle = sub.value; saveSettings(); renderTitlePresets(); });
    const sw = $('#title-colors');
    sw.innerHTML = TITLE_COLORS.map(c => `<button class="swatch" style="background:${c}" data-color="${c}" title="${c}"></button>`).join('');
    const paintSwatch = () => $$('.swatch', sw).forEach(b => b.classList.toggle('is-active', b.dataset.color === settings.title.color));
    paintSwatch();
    sw.addEventListener('click', e => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      settings.title.color = b.dataset.color;
      paintSwatch();
      saveSettings();
      renderTitlePresets();
    });
    initTitlePresets(() => { head.value = settings.title.headline; sub.value = settings.title.subtitle; paintSwatch(); });

    const tol = $('#key-tolerance');
    tol.value = settings.key.tolerance;
    $('#key-tol-val').textContent = settings.key.tolerance;
    tol.addEventListener('input', () => {
      settings.key.tolerance = +tol.value;
      $('#key-tol-val').textContent = tol.value;
    });
    tol.addEventListener('change', saveSettings);
    $('#pip-source').addEventListener('change', e => { overlays.pip.sourceId = e.target.value; });
    $('#key-source').addEventListener('change', e => { overlays.key.sourceId = e.target.value; });

    $$('.tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.toggle('is-active', t === tab));
      $$('.pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === tab.dataset.tab));
    }));

    $('#inputs-grid').addEventListener('click', onGridClick);

    // มือถือ: แท็บล่าง และปุ่ม "หยุดไลฟ์…" บนแจ้งเตือนของ Android (MainActivity เรียก WebMix.nativeAction)
    setMobileView(['switch', 'audio', 'graphics'].includes(store.get('mview', 'switch')) ? store.get('mview', 'switch') : 'switch');
    $('#m-tabs').addEventListener('click', e => {
      const v = e.target.closest('button[data-mview]');
      if (v) { setMobileView(v.dataset.mview); return; }
      const more = e.target.closest('[data-mmore]');
      if (more) openMoreMenu(more);
    });
    window.WebMix.nativeAction = async action => {
      if (action !== 'stop') return;
      if (streamer.ws || streamer.reconnecting) { if (await confirmStopAll()) stopAllStreams(); }
      else if (rec.active) toggleRecord();
    };
    $('#st-stream').addEventListener('click', openLiveDialog);

    const actions = {
      cut, auto: autoTransition, ftb: toggleFtb,
      title: () => setOverlay('title', !overlays.title.on),
      pip: () => setOverlay('pip', !overlays.pip.on),
      key: () => setOverlay('key', !overlays.key.on),
      stream: toggleStream, record: toggleRecord, snapshot,
      'output-window': openOutputWindow, fullscreen: toggleFullscreen, multiview: () => multiview.open(),
      settings: () => openSettings(), help: openHelp, show: openShowDialog,
      wireless: showWirelessDialog, 'add-mic': openMicDialog,
      monitor: () => { audio.setMonitor(!audio.monitorOn); updateStatus(); },
      'audio-on': () => { audio.ensure(); setTimeout(updateStatus, 100); }
    };
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      audio.ensure();
      if (b.dataset.action === 'add-menu') { openAddMenu(b); return; }
      actions[b.dataset.action]?.();
    });

    // ปลดล็อกระบบเสียงเมื่อผู้ใช้แตะหน้าจอครั้งแรก (ข้อกำหนดของเบราว์เซอร์)
    document.addEventListener('pointerdown', () => {
      audio.ensure();
      // Input SRT ที่สร้างตอนเปิดหน้าอาจถูกเบราว์เซอร์บังคับปิดเสียงไว้ — เปิดเสียงคืนเมื่อผู้ใช้แตะครั้งแรก
      for (const i of inputs) if (i.type === 'srt' && i.el.muted) { i.el.muted = false; i.el.play().catch(() => {}); }
    }, { once: true, capture: true });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeMenu();
        $('#pgm-monitor').classList.remove('is-fullscreen');
        return;
      }
      if (e.target.closest('input, textarea, select, [contenteditable], .vfader') || $('.modal-backdrop') || $('.menu')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) {
        const inp = inputs[+digit[2] - 1];
        if (inp) {
          audio.ensure();
          if (e.shiftKey) { if (inp.id !== state.programId) { state.previewId = inp.id; cut(); } }
          else if (inp.id !== state.programId) setPreview(inp.id);
        }
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      const map = { ' ': cut, enter: autoTransition, f: toggleFtb, t: actions.title, l: actions.title, p: actions.pip, k: actions.key, m: () => multiview.open() };
      const oi = OVL_KEYS.indexOf(k);
      if (oi >= 0) {
        const i = oi + (e.shiftKey ? 4 : 0);
        e.preventDefault();
        audio.ensure();
        setChannel(i, !ovl[i].on);
        return;
      }
      if (map[k]) {
        e.preventDefault();
        audio.ensure();
        map[k]();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) $('#pgm-monitor').classList.remove('is-fullscreen');
    });
  }

  /* ------------------------------------------------------------ show */
  /* โชว์ = ทุกอย่างที่ตั้งไว้สำหรับรายการหนึ่ง: Input (ลำดับ ชื่อ แหล่งภาพ), Program/Preview, กราฟิก, มิกเซอร์เสียง
     - บันทึกอัตโนมัติลงเบราว์เซอร์ทุกครั้งที่มีการเปลี่ยนแปลง → รีเฟรช/ปิดหน้าแล้วเปิดใหม่ โชว์กลับมาครบ
     - ไฟล์วิดีโอ/รูปเก็บสำเนาไว้ในพื้นที่ของเบราว์เซอร์ (OPFS) จึงไม่ต้องเลือกไฟล์ใหม่
     - บันทึกเป็นไฟล์ .webmix.json เพื่อย้ายเครื่องหรือเก็บหลายรายการ (ไฟล์สื่อไม่ได้รวมอยู่ในไฟล์ ต้องเลือกใหม่บนเครื่องอื่น) */

  const SHOW_TYPES = ['bars', 'black', 'slate', 'clock', 'image', 'media', 'camera', 'screen', 'wireless', 'srt', 'title', 'guest', 'timer', 'score', 'ticker', 'playlist'];
  const show = {
    ready: false, last: '', savedAt: 0,
    get name() { return store.get('showName', '') || 'โชว์ใหม่'; },
    set name(v) { store.set('showName', String(v || '').trim().slice(0, 60)); },

    // secrets = รวมรหัส SRT/Stream Key (เฉพาะเมื่อผู้ใช้เลือกให้จำรหัสไว้)
    serialize(secrets = settings.rememberKey) {
      const chan = c => ({ db: c.db === -Infinity ? null : +c.db.toFixed(2), muted: c.muted, afv: c.afv, fx: { ...c.fx } });
      return {
        app: 'webmix', version: 1, name: this.name,
        output: { resolution: settings.resolution, fps: settings.fps, videoKbps: settings.videoKbps, transition: settings.transition, duration: settings.duration },
        graphics: { title: { ...settings.title }, titlePresets: settings.titlePresets.map(t => ({ ...t })), pip: { ...settings.pip }, key: { ...settings.key } },
        inputs: inputs.map(i => {
          const o = { id: i.id, type: i.type, name: i.name };
          if (i.text) o.text = i.text;
          if (i.type === 'camera' && i.cam) o.cam = { ...i.cam };
          if (i.type === 'media') { o.file = i.fileName || ''; o.loop = !!i.el.loop; }
          if (i.type === 'image') o.file = i.fileName || '';
          if (i.type === 'wireless') o.peerId = i.peerId;
          if (i.type === 'srt') o.srt = { ...i.srt, passphrase: secrets ? i.srt.passphrase : '' };
          if (i.type === 'title') o.title = { ...i.title };
          // เวลาที่เดินอยู่บันทึกเป็นเวลาที่ผ่านไปแล้ว (เปิดหน้าใหม่แล้วหยุดรอให้กดเริ่ม)
          const freeze = t => ({ ...t, base: (t.base || 0) + (t.running && t.since ? Date.now() - t.since : 0), running: false, since: 0 });
          if (i.type === 'timer') o.timer = freeze(i.timer);
          if (i.type === 'score') o.score = { ...i.score, clock: freeze(i.score.clock) };
          if (i.type === 'ticker') o.ticker = { ...i.ticker, items: [...i.ticker.items] };
          if (i.type === 'playlist') o.list = { items: i.list.items.map(x => ({ key: x.key, name: x.name, kind: x.kind })), index: i.list.index, loop: i.list.loop, imageSec: i.list.imageSec };
          if (i.data) o.data = { url: i.data.url, header: i.data.header, row: i.data.row || 0 };
          if (i.type === 'guest') o.guest = i.guest;
          if (i.layout) o.layout = JSON.parse(JSON.stringify(i.layout));
          return o;
        }),
        program: state.programId, preview: state.previewId,
        overlays: { pip: overlays.pip.sourceId, key: overlays.key.sourceId },
        // ช่อง Overlay 1–8: Input ที่ผูกไว้และเอฟเฟกต์ (ไม่จำสถานะขึ้นจอ — เปิดหน้าใหม่แล้วไม่มีอะไรขึ้นจอเอง)
        overlayChannels: ovl.map(c => ({ inputId: c.inputId, effect: c.effect, duration: c.duration })),
        audio: {
          master: { db: audio.masterStrip.db === -Infinity ? null : audio.masterStrip.db, muted: audio.masterStrip.muted },
          inputs: Object.fromEntries(audio.channels.filter(c => c.inputId).map(c => [c.inputId, chan(c)])),
          mics: audio.channels.filter(c => c.kind === 'mic' && c.micId).map(c => ({ name: c.name, micId: c.micId, label: c.micLabel || '', clean: !!c.clean, ...chan(c) }))
        }
      };
    },

    autosave(force) {
      if (!this.ready) return;
      const data = this.serialize();
      const json = JSON.stringify(data);
      if (json === this.last && !force) return;
      this.last = json;
      store.set('show', data);
      this.savedAt = Date.now();
    },

    // สร้างโชว์กลับมาจากข้อมูลที่บันทึกไว้ (ตอนเปิดหน้า)
    restore(data) {
      const ids = new Set();
      const loading = [];
      let waitingMics = 0;
      for (const raw of data.inputs) {
        if (!raw || !SHOW_TYPES.includes(raw.type)) continue;
        const id = typeof raw.id === 'string' && raw.id && !ids.has(raw.id) ? raw.id : uid();
        ids.add(id);
        const base = { id, name: String(raw.name || raw.type.toUpperCase()).slice(0, 40) };
        if (data.audio?.inputs?.[raw.id]) audio.pending.set(id, data.audio.inputs[raw.id]);
        try { const job = this.restoreInput(raw, base); if (job) loading.push(job); } catch (e) { console.warn('restore input', e); }
        const made = byId(id);
        if (made && raw.layout) made.layout = sanitizeLayout(raw.layout);
        if (made && GRAPHIC_TYPES.includes(made.type) && raw.data && /^https?:\/\//i.test(raw.data.url || '')) {
          made.data = { url: String(raw.data.url), header: raw.data.header !== false, row: Math.max(0, +raw.data.row || 0), rows: [], error: '', fetchedAt: 0 };
        }
      }
      if (Array.isArray(data.overlayChannels)) {
        data.overlayChannels.slice(0, OVL_COUNT).forEach((c, i) => {
          if (!c) return;
          ovl[i].inputId = byId(c.inputId) ? c.inputId : null;
          if (OVL_EFFECTS[c.effect]) ovl[i].effect = c.effect;
          if (OVL_DURATIONS.includes(+c.duration)) ovl[i].duration = +c.duration;
        });
        refreshOverlaySelects();
      }
      if (byId(data.program)) state.programId = data.program;
      if (byId(data.preview) && data.preview !== state.programId) state.previewId = data.preview;
      else if (state.previewId === state.programId) state.previewId = (inputs.find(i => i.id !== state.programId) || {}).id || null;
      if (byId(data.overlays?.pip)) overlays.pip.sourceId = data.overlays.pip;
      if (byId(data.overlays?.key)) overlays.key.sourceId = data.overlays.key;
      const m = data.audio?.master;
      if (m) { audio.masterStrip.db = typeof m.db === 'number' ? clamp(m.db, -60, 10) : -Infinity; audio.masterStrip.muted = !!m.muted; audio.applyMaster(); }
      // ไมค์: เปิดอุปกรณ์เดิมอีกครั้ง (เบราว์เซอร์อาจถามสิทธิ์)
      const mics = Array.isArray(data.audio?.mics) ? data.audio.mics.slice(0, 16) : [];
      if (mics.length && needMedia()) {
        for (const mc of mics) {
          waitingMics++;
          openMicById(String(mc.micId), String(mc.label || ''), !!mc.clean)
            .then(({ stream, micId }) => audio.addMic(stream, String(mc.name || 'MIC').slice(0, 24), { micId, micLabel: String(mc.label || ''), clean: !!mc.clean, restore: mc }))
            .catch(() => toast(`เปิดไมค์ “${mc.name}” ไม่ได้ — เพิ่มใหม่จากปุ่ม + ในมิกเซอร์`, 'warn', 6000));
        }
      }
      renderInputs();
      refreshSourceSelects();
      renderMixer();
      updateTally();
      // แจ้งหลังโหลดไฟล์/เปิดกล้องเสร็จ (รอไม่เกิน 5 วินาที) จะได้นับ Input ที่ต้องเชื่อมต่อใหม่ได้ถูกต้อง
      Promise.race([Promise.allSettled(loading), new Promise(r => setTimeout(r, 5000))]).then(() => {
        const missing = inputs.filter(i => i.missing && i.type !== 'wireless' && i.type !== 'guest').length;
        toast(`เปิดโชว์ “${this.name}” แล้ว — ${inputs.length} แหล่งภาพ${missing ? ` (รอเชื่อมต่อ ${missing} — กดปุ่ม 🔗 บนการ์ด)` : ''}`, missing ? 'warn' : 'success', 5000);
      });
      return waitingMics;
    },

    restoreInput(raw, base) {
      const text = typeof raw.text === 'string' ? raw.text.slice(0, 80) : '';
      switch (raw.type) {
        case 'bars': case 'black': case 'slate': case 'clock':
          addInput({ type: raw.type, ...base, text });
          break;
        case 'timer': {
          const t = raw.timer || {};
          addInput({ type: 'timer', ...base, timer: { mode: TIMER_MODES[t.mode] ? t.mode : 'down', duration: clamp(+t.duration || 300, 1, 86400), target: /^\d{1,2}:\d{2}$/.test(t.target || '') ? t.target : '19:00',
            label: String(t.label || '').slice(0, 60), style: TIMER_STYLES[t.style] ? t.style : 'center', color: TITLE_COLORS.includes(t.color) ? t.color : '#f5a524', base: Math.max(0, +t.base || 0), running: false, since: 0 } });
          break;
        }
        case 'score': {
          const c = raw.score || {}, ck = c.clock || {};
          addInput({ type: 'score', ...base, score: { teamA: String(c.teamA ?? 'ทีม A').slice(0, 24), teamB: String(c.teamB ?? 'ทีม B').slice(0, 24), scoreA: Math.max(0, +c.scoreA || 0), scoreB: Math.max(0, +c.scoreB || 0),
            colorA: TITLE_COLORS.includes(c.colorA) ? c.colorA : '#ef4444', colorB: TITLE_COLORS.includes(c.colorB) ? c.colorB : '#3b82f6', period: String(c.period || '').slice(0, 20),
            clock: { mode: ['none', 'up', 'down'].includes(ck.mode) ? ck.mode : 'none', duration: clamp(+ck.duration || 2700, 1, 86400), base: Math.max(0, +ck.base || 0), running: false, since: 0 } } });
          break;
        }
        case 'playlist': {
          const l = raw.list || {};
          const items = (Array.isArray(l.items) ? l.items : []).filter(x => x && typeof x.key === 'string' && x.key.startsWith(base.id + '-'))
            .map(x => ({ key: x.key, name: String(x.name || '').slice(0, 120), kind: x.kind === 'image' ? 'image' : 'video' })).slice(0, 500);
          const inp = playlist.create({ ...base, list: { items, index: clamp(+l.index || 0, 0, Math.max(0, items.length - 1)), loop: l.loop !== false, imageSec: clamp(+l.imageSec || 5, 1, 600), playing: true } });
          return playlist.go(inp, inp.list.index);
        }
        case 'ticker': {
          const t = raw.ticker || {};
          addInput({ type: 'ticker', ...base, ticker: { label: String(t.label || '').slice(0, 24), items: (Array.isArray(t.items) ? t.items : []).map(String).slice(0, 100),
            speed: [60, 90, 130, 180].includes(+t.speed) ? +t.speed : 90, color: TITLE_COLORS.includes(t.color) ? t.color : '#ef4444' } });
          break;
        }
        case 'title': {
          const t = raw.title || {};
          addInput({ type: 'title', ...base, title: { headline: String(t.headline || '').slice(0, 80), subtitle: String(t.subtitle || '').slice(0, 120),
            color: TITLE_COLORS.includes(t.color) ? t.color : TITLE_COLORS[0], style: TITLE_STYLES[t.style] ? t.style : 'lower' } });
          break;
        }
        case 'media': case 'image': {
          const inp = raw.type === 'media'
            ? createMediaInput({ ...base, fileName: String(raw.file || ''), loop: raw.loop !== false, status: 'nosignal', missing: true })
            : createImageInput({ ...base, fileName: String(raw.file || ''), status: 'nosignal', missing: true });
          return mediaStore.get(base.id).then(file => {
            if (inp.removed) return;
            if (file) setInputFile(inp, file, false, false);
            renderInputs();
          });
        }
        case 'camera': {
          const inp = addInput({ type: 'camera', ...base, el: createVideo(null), status: 'nosignal', missing: true });
          if (raw.cam && typeof raw.cam.deviceId === 'string') {
            inp.cam = { deviceId: raw.cam.deviceId, micId: String(raw.cam.micId || ''), w: +raw.cam.w || 1920, h: +raw.cam.h || 1080,
              label: String(raw.cam.label || ''), micLabel: String(raw.cam.micLabel || '') };
            if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) {
              return startCamera(inp.cam).then(stream => { if (inp.removed) stream.getTracks().forEach(t => t.stop()); else attachStream(inp, stream); }).catch(() => {});
            }
          }
          break;
        }
        case 'screen':
          addInput({ type: 'screen', ...base, el: createVideo(null), status: 'nosignal', missing: true });
          break;
        case 'wireless':
          // มือถือที่เคยเชื่อมต่อจะโทรกลับมาเองด้วย ID เดิม แล้วเข้ามาที่ Input นี้
          addInput({ type: 'wireless', ...base, el: createVideo(null), status: 'nosignal', peerId: String(raw.peerId || ''), missing: true });
          break;
        case 'guest': {
          // แขกที่เคยเชิญไว้: ลิงก์เดิมยังใช้ได้ แขกจะเชื่อมต่อกลับเข้ามาเอง
          const slot = String(raw.guest || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
          if (!slot) return;
          const inp = addInput({ type: 'guest', ...base, guest: slot, peerId: guestPeerId(slot), el: createVideo(null), status: 'nosignal', missing: true });
          audio.mixMinus(inp.id);
          break;
        }
        case 'srt': {
          const c = raw.srt || {};
          if (c.mode !== 'listener' && c.mode !== 'caller') return;
          createSrtInput({ mode: c.mode, port: +c.port || 9000, url: String(c.url || ''), streamid: String(c.streamid || ''),
            passphrase: String(c.passphrase || ''), latency: SRT_LATENCIES.includes(+c.latency) ? +c.latency : 500 }, base.name, { id: base.id });
          break;
        }
      }
    },

    exportFile() {
      const data = { ...this.serialize(), savedAt: new Date().toISOString(),
        stream: { gateway: settings.gateway, destinations: settings.destinations.map(d => ({ ...d, key: settings.rememberKey ? d.key : '', passphrase: settings.rememberKey ? d.passphrase : '' })) } };
      const safe = this.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'WebMix';
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${safe}.webmix.json`);
      toast(`บันทึกไฟล์โชว์ “${safe}.webmix.json” แล้ว`, 'success');
    },

    busyWarning() {
      return streamer.active || rec.active ? 'กำลังสตรีมหรือบันทึกอยู่ — การเปิดโชว์อื่นจะโหลดหน้าใหม่และหยุดการสตรีม/บันทึกทันที' : '';
    },

    async importFile(file) {
      let data;
      try { data = JSON.parse(await file.text()); } catch (e) { toast('ไฟล์นี้ไม่ใช่ไฟล์โชว์ของ WebMix', 'error'); return; }
      if (!data || data.app !== 'webmix' || !Array.isArray(data.inputs)) { toast('ไฟล์นี้ไม่ใช่ไฟล์โชว์ของ WebMix', 'error'); return; }
      const ok = await confirmDialog(`เปิดโชว์ “${String(data.name || file.name).slice(0, 60)}”`,
        `${this.busyWarning() || 'โชว์ปัจจุบันจะถูกแทนที่ (ถ้ายังไม่ได้บันทึกเป็นไฟล์ ให้กดยกเลิกแล้วบันทึกก่อน)'} · ${data.inputs.length} แหล่งภาพ`, 'เปิดโชว์');
      if (!ok) return;
      this.apply(data);
    },

    // ใช้ค่าจากไฟล์โชว์แล้วโหลดหน้าใหม่ (สร้างทุกอย่างใหม่หมดจากข้อมูลที่บันทึกไว้)
    apply(data) {
      const o = data.output || {};
      if (RESOLUTIONS[o.resolution]) settings.resolution = o.resolution;
      if (FRAME_RATES.includes(+o.fps)) settings.fps = +o.fps;
      if (+o.videoKbps > 0) settings.videoKbps = clamp(Math.round(+o.videoKbps), 500, MAX_KBPS);
      if (['mix', 'dip', 'wipe'].includes(o.transition)) settings.transition = o.transition;
      if ([500, 1000, 2000].includes(+o.duration)) settings.duration = +o.duration;
      const g = data.graphics || {};
      if (g.title && typeof g.title === 'object') settings.title = { ...settings.title, ...g.title };
      if (Array.isArray(g.titlePresets)) settings.titlePresets = g.titlePresets.slice(0, 24);
      if (g.pip && typeof g.pip === 'object') settings.pip = { ...settings.pip, ...g.pip };
      if (g.key && typeof g.key === 'object') settings.key = { ...settings.key, ...g.key };
      const st = data.stream;
      if (st && typeof st.gateway === 'string') settings.gateway = st.gateway;
      if (st && Array.isArray(st.destinations) && st.destinations.length) settings.destinations = st.destinations.slice(0, MAX_DESTINATIONS);
      settings.srtInputs = [];
      saveSettings();
      if (data.name) this.name = data.name;
      this.ready = false;
      store.set('show', data);
      location.reload();
    },

    async startNew() {
      const ok = await confirmDialog('เริ่มโชว์ใหม่',
        `${this.busyWarning() || 'แหล่งภาพ มิกเซอร์ และกราฟิกทั้งหมดจะถูกล้างเป็นค่าเริ่มต้น'} (ค่าเอาต์พุตและปลายทางการสตรีมยังอยู่เหมือนเดิม)`, 'เริ่มใหม่');
      if (!ok) return;
      this.ready = false;
      store.set('show', null);
      store.set('showName', '');
      settings.srtInputs = [];
      saveSettings();
      location.reload();
    }
  };

  function openShowDialog() {
    show.autosave();
    const ago = show.savedAt ? new Date(show.savedAt).toLocaleTimeString('th-TH', { hour12: false }) : '—';
    dialog({
      title: 'โชว์',
      body: `
        <label class="field"><span>ชื่อโชว์</span><input name="showname" class="input" maxlength="60" value="${esc(show.name)}"></label>
        <p class="note">บันทึกอัตโนมัติในเบราว์เซอร์นี้แล้ว (ล่าสุด ${ago}) — รีเฟรชหรือปิดหน้าแล้วเปิดใหม่ แหล่งภาพ มิกเซอร์ และกราฟิกจะกลับมาครบ
          กล้อง/ไฟล์ที่ต้องเชื่อมใหม่จะมีปุ่ม <b>🔗</b> บนการ์ด</p>
        <div class="show-actions">
          <button type="button" class="btn" data-show="export">${icon('download')}บันทึกเป็นไฟล์</button>
          <button type="button" class="btn" data-show="import">${icon('folder')}เปิดไฟล์โชว์</button>
          <button type="button" class="btn btn-danger" data-show="new">${icon('plus')}เริ่มโชว์ใหม่</button>
        </div>
        <p class="note">ไฟล์โชว์ (.webmix.json) เก็บการตั้งค่าทั้งหมด แต่ไม่รวมตัวไฟล์วิดีโอ/รูป — เปิดบนเครื่องอื่นแล้วให้กด 🔗 เพื่อเลือกไฟล์
          ${settings.rememberKey ? 'และ<b>มี Stream Key/รหัส SRT อยู่ในไฟล์</b> — เก็บไฟล์ไว้ให้ปลอดภัย' : 'และไม่มี Stream Key/รหัส SRT อยู่ในไฟล์'}</p>`,
      actions: [{ label: 'ปิด', primary: true, value: 'close' }],
      onOpen(modal) {
        const nameEl = $('[name="showname"]', modal);
        nameEl.addEventListener('input', () => { show.name = nameEl.value; });
        modal.addEventListener('click', e => {
          const b = e.target.closest('[data-show]');
          if (!b) return;
          show.name = nameEl.value;
          const act = b.dataset.show;
          if (act === 'export') show.exportFile();
          else if (act === 'import') {
            const el = document.createElement('input');
            el.type = 'file'; el.accept = '.json,application/json';
            pool.appendChild(el);
            el.onchange = () => { const f = el.files[0]; el.remove(); if (f) show.importFile(f); };
            el.click();
          } else if (act === 'new') show.startNew();
        });
      }
    });
  }

  // preset ป้ายชื่อ: เก็บหัวข้อ/ข้อความรอง/สีไว้หลายชุด แตะเพื่อใช้ (ถ้าป้ายขึ้นจออยู่ จะเปลี่ยนทันที)
  function renderTitlePresets() {
    const box = $('#title-presets');
    const t = settings.title;
    box.innerHTML = settings.titlePresets.map((p, i) => `
      <span class="preset ${p.headline === t.headline && p.subtitle === t.subtitle && p.color === t.color ? 'is-active' : ''}">
        <button type="button" class="preset-use" data-preset="${i}" title="${esc(p.headline)}${p.subtitle ? ' — ' + esc(p.subtitle) : ''}"><i class="preset-dot" style="background:${p.color}"></i><span>${esc(p.headline || p.subtitle || '—')}</span></button>
        <button type="button" class="preset-del" data-preset-del="${i}" title="ลบ preset" aria-label="ลบ preset">×</button>
      </span>`).join('') +
      (settings.titlePresets.length < 24 ? '<button type="button" class="preset-add" data-preset-add>+ บันทึกป้ายนี้</button>' : '');
  }
  function initTitlePresets(syncTitle) {
    renderTitlePresets();
    $('#title-presets').addEventListener('click', e => {
      const use = e.target.closest('[data-preset]'), del = e.target.closest('[data-preset-del]');
      if (e.target.closest('[data-preset-add]')) {
        const t = settings.title;
        if (!t.headline.trim() && !t.subtitle.trim()) { toast('ใส่หัวข้อหรือข้อความรองก่อนบันทึก preset', 'warn'); return; }
        if (!settings.titlePresets.some(p => p.headline === t.headline && p.subtitle === t.subtitle && p.color === t.color)) {
          settings.titlePresets.push({ headline: t.headline, subtitle: t.subtitle, color: t.color });
          saveSettings();
        }
      } else if (del) {
        settings.titlePresets.splice(+del.dataset.presetDel, 1);
        saveSettings();
      } else if (use) {
        const p = settings.titlePresets[+use.dataset.preset];
        if (!p) return;
        Object.assign(settings.title, p);
        saveSettings();
        syncTitle();
      } else return;
      renderTitlePresets();
    });
  }

  /* ------------------------------------------------------------ boot */
  function boot() {
    initControls();
    ticker.init();
    applyResolution();
    renderer.resolve();

    // เปิดโชว์ที่บันทึกไว้ครั้งก่อน — ถ้าไม่มี เริ่มด้วยแหล่งภาพพื้นฐาน
    const savedShow = store.get('show', null);
    if (savedShow && Array.isArray(savedShow.inputs)) {
      show.restore(savedShow);
    } else {
      const slate = addGenerator('slate');
      const bars = addGenerator('bars');
      addGenerator('clock');
      addGenerator('black');
      state.programId = slate.id;
      state.previewId = bars.id;
      // เวอร์ชันก่อนจำเฉพาะ Input SRT ไว้ในการตั้งค่า
      for (const c of Array.isArray(settings.srtInputs) ? settings.srtInputs : []) {
        if (c) show.restoreInput({ type: 'srt', srt: c }, { id: uid(), name: String(c.name || 'SRT').slice(0, 40) });
      }
      renderMixer();
      refreshSourceSelects();
      updateTally();
    }
    show.ready = true;
    show.autosave(true);
    setInterval(() => show.autosave(), 1500);
    addEventListener('pagehide', () => show.autosave());
    mediaStore.prune(new Set([...inputs.filter(i => i.type === 'media' || i.type === 'image').map(i => i.id), ...playlist.keys()]));

    wireless.init();
    loadRecFolder();
    cleanupOpfs();
    tickClock();
    setInterval(tickClock, 1000);
    requestAnimationFrame(rafLoop);
    setTimeout(() => { if (shouldOnboard()) openOnboarding(); }, 700);
    $('#m-gfx').addEventListener('click', quickGfxTap);
    document.documentElement.dataset.cards = cardSize();
    $$('#seg-cardsize button').forEach(b => { b.classList.toggle('is-active', b.dataset.size === cardSize()); b.addEventListener('click', () => setCardSize(b.dataset.size)); });
    // หมุนจอ/ย่อหน้าต่างข้ามขนาดมือถือ → สร้างช่องเสียงใหม่ให้ตรงรูปแบบ (แนวตั้ง/แนวนอน)
    let wasPhone = phoneLayout();
    addEventListener('resize', () => { if (phoneLayout() !== wasPhone) { wasPhone = phoneLayout(); renderMixer(); } });

    // สำหรับดีบัก/ทดสอบอัตโนมัติ
    window.webmix = { playlist, dataSources, timerControl, multiview, renderer, gpu, setRenderer: v => { settings.renderer = v; renderer.resolve(); updateStatus(); }, show, ovl, setChannel, toggleInputOverlay, useRecFolder: dir => { recFolder = dir; }, inputs, state, settings, overlays, audio, rec, streamer, wireless, cut, autoTransition, setPreview, tr, ftb };
  }

  boot();
})();
