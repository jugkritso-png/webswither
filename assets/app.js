/* ==========================================================================
   WebMix Pro — Live Production Switcher
   ระบบสลับภาพ/เสียงสำหรับไลฟ์สด ทำงานบนเบราว์เซอร์ทั้งหมด
   ========================================================================== */
(() => {
  'use strict';

  const { $, $$, clamp, uid, pad2, esc, icon, fmtDuration, fmtBytes, stamp, easeInOut, easeOut, isIOS, FONT, MONO,
    downloadBlob, store, toast, keepScreenOn, b64url, unb64url, peerOptionsFromSig, initCaller,
    fillBlack, drawFit, fitFont, drawBars, drawSlate, drawClock, RELINK_HINT, drawNoSignal, drawTitle, TITLE_STYLES, drawTitleInput, titleAnim,
    createKeyer, createGpu, idb, canUseOpfs, mediaStore, createMultiview, SHORTCUTS, MANUAL,
    TIMER_MODES, TIMER_STYLES, timerText, drawTimer, drawScore, TICKER_BAR, drawTickerBar, drawTicker, sheetCsvUrl, parseCsv, desktop, chat: chatLib } = window.WebMix;
  /* ====================================================================== */
  /*  PHONE CAMERA MODE (?call=<studio id>)                                  */
  /* ====================================================================== */
  const callTarget = new URLSearchParams(location.search).get('call');
  if (callTarget) {
    initCaller(callTarget);
    return;
  }
  // รีโมตคอนโทรล (?remote=<ID สตูดิโอ>&k=<รหัส>) — แท็บเล็ต/มือถือเป็นแผงสั่งงาน
  const remoteTarget = new URLSearchParams(location.search).get('remote');
  if (remoteTarget) {
    window.WebMix.initRemote(remoteTarget);
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
    // TikTok / Instagram ให้ Server URL แยกต่อบัญชี — วางจากหน้าไลฟ์ของแพลตฟอร์ม · ใช้ภาพแนวตั้งเป็นค่าเริ่มต้น
    tiktok: { label: 'TikTok Live', server: '', vertical: true },
    instagram: { label: 'Instagram Live', server: '', vertical: true },
    srt: { label: 'SRT (vMix / OBS / SRT Server)', server: '' },
    custom: { label: 'RTMP อื่น ๆ (กำหนดเอง)', server: '' },
    // ส่ง Program ออกในวง LAN ให้ vMix / OBS / เครื่องอื่นรับ (แอปเดสก์ท็อป) — ช่อง server = ชื่อแหล่ง
    ndi: { label: 'NDI® (ส่งออกในวง LAN)', server: '', net: true },
    omt: { label: 'OMT (ส่งออกในวง LAN)', server: '', net: true }
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
    // Stinger: วิดีโอทับระหว่างเปลี่ยนภาพ (ไฟล์เก็บใน mediaStore คีย์ 'stinger') · cutAt = จุดสลับภาพ (สัดส่วนของความยาว)
    stinger: { name: '', cutAt: 0.5 },
    // MIDI: on = เปิดใช้ · map = การกระทำ → ปุ่ม/ปุ่มหมุนบนคอนโทรลเลอร์ ("note:ช่อง:เลข" หรือ "cc:ช่อง:เลข")
    midi: { on: false, map: {} },
    gateway: store.raw('webmix-gateway-url') || '',
    destinations: [], rememberKey: false,
    // บันทึกสำรองอัตโนมัติเมื่อเริ่มไลฟ์ · บันทึกแยกทุกกล้อง (ISO) พร้อมกับการบันทึก Program
    autoRec: false, isoRec: false,
    // ลดบิตเรตเองเมื่อเน็ตส่งไม่ทัน (ข้อมูลค้างส่ง) แทนที่ภาพจะค้าง/หลุด
    abr: true,
    title: { headline: 'BREAKING NEWS', subtitle: 'รายงานสดจากสตูดิโอ WebMix Pro', color: '#ef4444' },
    pip: { position: 'br', size: 0.32 },
    key: { color: 'green', tolerance: 60 },
    srtInputs: [], titlePresets: [],
    renderer: 'auto',
    orient: 'h',
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
  if (settings.orient !== 'v') settings.orient = 'h';
  const TRANSITIONS = ['mix', 'dip', 'wipe', 'push', 'stinger'];
  if (!TRANSITIONS.includes(settings.transition)) settings.transition = 'mix';
  settings.midi = { on: !!settings.midi?.on, map: Object.fromEntries(Object.entries(settings.midi?.map || {}).filter(([k, v]) => /^[a-z0-9]{2,12}$/.test(k) && /^(note|cc):\d{1,2}:\d{1,3}$/.test(v))) };
  settings.stinger = { name: String(settings.stinger?.name || '').slice(0, 80), cutAt: clamp(+settings.stinger?.cutAt || 0.5, 0.05, 0.95) };
  if (![500, 1000, 2000].includes(+settings.duration)) settings.duration = 1000;
  if (!['auto', 'gpu', 'cpu'].includes(settings.renderer)) settings.renderer = 'auto';
  settings.titlePresets = (Array.isArray(settings.titlePresets) ? settings.titlePresets : [])
    .filter(t => t && typeof t === 'object').slice(0, 24)
    .map(t => ({ headline: String(t.headline || '').slice(0, 80), subtitle: String(t.subtitle || '').slice(0, 120), color: TITLE_COLORS.includes(t.color) ? t.color : TITLE_COLORS[0] }));

  // ปลายทางการสตรีม (ส่งพร้อมกันได้หลายช่อง) — ย้ายค่าแบบปลายทางเดียวของเวอร์ชันก่อนมาด้วย
  const MAX_DESTINATIONS = 6;
  const SRT_LATENCIES = [120, 200, 500, 1000, 2000, 4000];
  // รูปแบบภาพของปลายทาง: h = แนวนอนตาม Program · vcrop = แนวตั้ง 9:16 ตัดกลาง · vfit = แนวตั้ง 9:16 ภาพเต็ม พื้นเบลอ
  const ORIENTS = { h: 'แนวนอน 16:9', vcrop: 'แนวตั้ง 9:16 · ตัดกลางภาพ', vfit: 'แนวตั้ง 9:16 · ภาพเต็ม พื้นเบลอ' };
  const newDest = (platform = 'youtube', server, key = '') => ({
    id: uid(), platform, server: server ?? PLATFORMS[platform].server, key, passphrase: '', latency: 500, enabled: true,
    orient: PLATFORMS[platform].vertical ? 'vcrop' : 'h'
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
      enabled: d.enabled !== false,
      orient: ORIENTS[d.orient] ? d.orient : 'h'
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
      (copy.srtInputs || []).forEach(c => { c.passphrase = ''; c.pass = ''; });
    }
    store.set('settings', copy);
  }

  const RTMP_RE = /^rtmps?:\/\/\S+$/i;
  const SRT_RE = /^srt:\/\/[^\s/?#]+:\d+(\?\S*)?$/i;
  const isSrt = d => d.platform === 'srt';
  const isNet = d => !!PLATFORMS[d.platform]?.net;
  const netName = d => d.server.trim().replace(/[\x00-\x1f]/g, '').slice(0, 60) || 'WebMix Program';
  // SRT: ส่ง MPEG-TS แบบ caller ไปที่ srt://host:port พร้อม Stream ID, รหัสเข้ารหัส (AES) และค่า latency
  function destUrl(d) {
    if (isNet(d)) return `${d.platform}://${netName(d)}`;
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
    if (isNet(d)) return `${d.platform.toUpperCase()} “${netName(d)}” ในวง LAN`;
    const server = d.server.trim().replace(/\/+$/, '');
    if (isSrt(d)) return `${server.replace(/\?.*$/, '')} · ${d.latency} ms${d.key.trim() ? ' · ID ••••' + d.key.trim().slice(-4) : ''}${d.passphrase ? ' · 🔒' : ''}`;
    return server + (d.key.trim() ? '/••••' + d.key.trim().slice(-4) : '');
  }
  const hostOf = d => (/^(?:rtmps?|srt):\/\/([^/:?]+)/i.exec(d.server) || [])[1];
  const baseLabel = d => d.platform === 'custom' ? (hostOf(d) || 'RTMP')
    : isSrt(d) ? `SRT ${hostOf(d) || ''}`.trim() : isNet(d) ? `${d.platform.toUpperCase()} ${netName(d)}` : PLATFORMS[d.platform].label;
  function destLabel(d) {
    if (!d) return '';
    const base = baseLabel(d);
    const same = settings.destinations.filter(x => baseLabel(x) === base);
    const i = same.findIndex(x => x.id === d.id);
    return (same.length > 1 ? `${base} #${(i < 0 ? same.length : i) + 1}` : base) + (d.orient && d.orient !== 'h' ? ' (9:16)' : '');
  }
  function destProblem(d) {
    if (isNet(d)) return '';
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
    // โหมดแนวตั้ง 9:16: สลับกว้าง/สูงของ Program ทั้งระบบ (ไลฟ์ บันทึก Output ได้ภาพแนวตั้งจริง)
    const [bw, bh] = RESOLUTIONS[settings.resolution];
    [W, H] = settings.orient === 'v' ? [bh, bw] : [bw, bh];
    document.documentElement.dataset.orient = settings.orient;
    PW = W >= H ? Math.min(W, 1280) : Math.round(Math.min(H, 1280) * W / H); PH = Math.round(PW * H / W);
    pgmCanvas.width = W; pgmCanvas.height = H;
    pvwCanvas.width = PW; pvwCanvas.height = PH;
    $('#pgm-format').textContent = formatTag(Math.min(W, H), settings.fps) + (W < H ? ' · 9:16' : '');
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
    cg: { icon: 'type', label: 'CG STUDIO' },
    playlist: { icon: 'film', label: 'PLAYLIST' },
    scene: { icon: 'grid', label: 'SCENE' },
    replay: { icon: 'restart', label: 'REPLAY' },
    slides: { icon: 'image', label: 'SLIDES' },
    visualizer: { icon: 'sliders', label: 'VISUALIZER' },
    chat: { icon: 'type', label: 'COMMENTS' },
    captions: { icon: 'type', label: 'CAPTIONS' }
  };
  // กราฟิกที่วาดบนพื้นโปร่งใส (ซ้อนเป็น Overlay ได้ทันที)
  const GRAPHIC_TYPES = ['title', 'timer', 'score', 'ticker', 'visualizer', 'chat', 'captions'];
  const clockOf = inp => inp.type === 'timer' ? inp.timer : inp.type === 'score' && inp.score.clock && inp.score.clock.mode !== 'none' ? inp.score.clock : null;
  const scoreClockText = inp => { const c = clockOf(inp); return inp.type === 'score' && c ? timerText(c).text : ''; };
  // วาดกราฟิกลงพื้นที่ w×h (ไม่มีพื้นหลัง)
  function drawGraphic(ctx, inp, w, h) {
    if (inp.type === 'title') drawTitleInput(ctx, inp, w, h);
    else if (inp.type === 'timer') drawTimer(ctx, w, h, inp);
    else if (inp.type === 'score') drawScore(ctx, w, h, inp, scoreClockText(inp));
    else if (inp.type === 'ticker') drawTicker(ctx, w, h, inp);
    else if (inp.type === 'visualizer') drawViz(ctx, inp, w, h);
    else if (inp.type === 'chat') chatLib.drawChat(ctx, w, h, chatFeed.shown, inp.chat.style, chatAnim());
    else if (inp.type === 'captions') drawCaptions(ctx, w, h, inp);
  }

  /* ---- Audio Visualizer: กราฟิกที่ขยับตามเสียง (แท่งความถี่ / คลื่นเสียง / วงกลมรอบรูป / แท่งสะท้อนกลางจอ) ----
     อ่านค่าจากตัววิเคราะห์เสียงของช่องที่เลือก (หรือ Master) ครั้งเดียวต่อเฟรม — ใช้ร่วมกันทั้ง Program / Preview / การ์ด */
  const VIZ_STYLES = { bars: 'แท่งความถี่', wave: 'เส้นคลื่นเสียง', circle: 'วงกลมรอบรูป / โลโก้', mirror: 'แท่งสะท้อนกลางจอ' };
  const VIZ_BG = { none: 'โปร่งใส (ซ้อนบนภาพอื่น)', dark: 'พื้นเข้ม', black: 'พื้นดำ' };
  const VIZ_BANDS = 48;
  function sanitizeViz(v) {
    v = v || {};
    return { style: VIZ_STYLES[v.style] ? v.style : 'bars', source: typeof v.source === 'string' && v.source ? v.source.slice(0, 80) : 'master',
      color: TITLE_COLORS.includes(v.color) ? v.color : '#3b82f6', bg: VIZ_BG[v.bg] ? v.bg : 'none',
      imageId: typeof v.imageId === 'string' ? v.imageId.slice(0, 40) : '', sens: clamp(+v.sens || 1, 0.3, 3) };
  }
  // ช่องเสียงที่เลือก: 'master' · inputId ของแหล่งภาพ · 'mic:<micId>' · 'src:<srcId>' (ดู chanKey)
  function vizAnalyser(v) {
    if (!audio.ctx) return null;
    if (v.source === 'master') return audio.analyser;
    const ch = chanByKey(v.source);
    return ch ? ch.analyser : null;
  }
  const vizSourceName = v => v.source === 'master' ? 'Master' : chanByKey(v.source)?.name || byId(v.source)?.name || (v.source.startsWith('mic:') ? 'ไมค์' : '—');
  const vizBuf = { freq: new Uint8Array(512), time: new Float32Array(1024) };
  function vizData(inp) {
    const st = inp.vizState || (inp.vizState = { frame: -1, bands: new Float32Array(VIZ_BANDS), wave: new Float32Array(256), level: 0 });
    if (st.frame === frameNo) return st;
    st.frame = frameNo;
    // ลดลงตามเวลาจริง (ไม่ขึ้นกับเฟรมเรต): ราว 0.86 ต่อ 1/60 วินาที
    const t = performance.now(), fall = Math.pow(0.86, Math.min(0.5, (t - (st.t || t)) / 1000) * 60), fallLv = Math.pow(0.9, Math.min(0.5, (t - (st.t || t)) / 1000) * 60);
    st.t = t;
    const an = vizAnalyser(inp.viz), k = inp.viz.sens;
    if (!an) { st.bands.fill(0); st.wave.fill(0); st.level = 0; return st; }
    // ตัวอย่างนุ่มนวลของ AnalyserNode ทำงานต่อการเรียกหนึ่งครั้ง (ช้าลงเมื่อเฟรมเรตต่ำ) — ปิดไว้ แล้วทำให้นุ่มนวลตามเวลาเองด้านล่าง
    // (มิเตอร์เสียงใช้แค่ข้อมูลคลื่น ไม่ได้รับผลจากค่านี้)
    if (an.smoothingTimeConstant) an.smoothingTimeConstant = 0;
    if (vizBuf.freq.length !== an.frequencyBinCount) vizBuf.freq = new Uint8Array(an.frequencyBinCount);
    if (vizBuf.time.length !== an.fftSize) vizBuf.time = new Float32Array(an.fftSize);
    an.getByteFrequencyData(vizBuf.freq);
    an.getFloatTimeDomainData(vizBuf.time);
    // แบ่งช่วงความถี่แบบลอการิทึม 40 Hz – 16 kHz · ขึ้นไวลงช้าให้ดูนุ่มนวล
    const nyq = audio.ctx.sampleRate / 2, bins = vizBuf.freq.length;
    for (let b = 0; b < VIZ_BANDS; b++) {
      const f0 = 40 * Math.pow(400, b / VIZ_BANDS), f1 = 40 * Math.pow(400, (b + 1) / VIZ_BANDS);
      const i0 = Math.max(1, Math.floor(f0 / nyq * bins)), i1 = Math.max(i0 + 1, Math.ceil(f1 / nyq * bins));
      let m = 0;
      for (let i = i0; i < i1 && i < bins; i++) m = Math.max(m, vizBuf.freq[i]);
      const v = clamp(m / 255 * k, 0, 1);
      st.bands[b] = v > st.bands[b] ? v : Math.max(v, st.bands[b] * fall);
    }
    let peak = 0;
    const step = vizBuf.time.length / st.wave.length;
    for (let i = 0; i < st.wave.length; i++) { const x = vizBuf.time[Math.floor(i * step)]; st.wave[i] = clamp(x * k * 2, -1, 1); peak = Math.max(peak, Math.abs(x)); }
    const lv = clamp(peak * k * 1.6, 0, 1);
    st.level = lv > st.level ? lv : Math.max(lv, st.level * fallLv);
    return st;
  }
  function drawViz(ctx, inp, w, h) {
    const v = inp.viz, st = vizData(inp), s = h / 720;
    if (v.bg !== 'none') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      if (v.bg === 'dark') { g.addColorStop(0, '#111827'); g.addColorStop(1, '#030712'); } else { g.addColorStop(0, '#000'); g.addColorStop(1, '#000'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = v.color;
    ctx.shadowColor = v.color; ctx.shadowBlur = 14 * s;
    const n = VIZ_BANDS;
    if (v.style === 'bars' || v.style === 'mirror') {
      const mx = w * 0.08, gap = (w - mx * 2) / n, bw = gap * 0.62;
      const base = v.style === 'bars' ? h * 0.88 : h / 2, maxH = v.style === 'bars' ? h * 0.62 : h * 0.36;
      for (let b = 0; b < n; b++) {
        const bh = Math.max(3 * s, st.bands[b] * maxH), x = mx + b * gap + (gap - bw) / 2;
        ctx.globalAlpha = 0.55 + 0.45 * st.bands[b];
        if (v.style === 'bars') ctx.fillRect(x, base - bh, bw, bh);
        else ctx.fillRect(x, base - bh, bw, bh * 2);
      }
    } else if (v.style === 'wave') {
      ctx.lineWidth = 4 * s; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < st.wave.length; i++) {
        const x = w * 0.05 + (w * 0.9) * i / (st.wave.length - 1), y = h / 2 + st.wave[i] * h * 0.32;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    } else {
      // วงกลม: รูปตรงกลาง (ถ้าเลือก) ขยายตามความดัง + แท่งรอบวง
      const cx = w / 2, cy = h / 2, r = h * 0.2 * (1 + st.level * 0.08);
      for (let b = 0; b < n * 2; b++) {
        const lv = st.bands[b < n ? b : n * 2 - 1 - b], a = b / (n * 2) * Math.PI * 2 - Math.PI / 2;
        const len = 6 * s + lv * h * 0.16;
        ctx.globalAlpha = 0.5 + 0.5 * lv;
        ctx.lineWidth = Math.max(2, (Math.PI * 2 * r) / (n * 2) * 0.55); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r + 8 * s), cy + Math.sin(a) * (r + 8 * s)); ctx.lineTo(cx + Math.cos(a) * (r + 8 * s + len), cy + Math.sin(a) * (r + 8 * s + len)); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      const img = byId(v.imageId), el = img && img.status === 'live' && img.el, iw = el && (el.naturalWidth || el.videoWidth), ih = el && (el.naturalHeight || el.videoHeight);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      if (iw && ih) { const k = Math.max(2 * r / iw, 2 * r / ih); ctx.drawImage(el, cx - iw * k / 2, cy - ih * k / 2, iw * k, ih * k); }
      else { ctx.fillStyle = '#1f2937'; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); }
      ctx.restore();
      ctx.lineWidth = 4 * s; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
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
      case 'title': case 'timer': case 'score': case 'ticker': case 'visualizer': case 'chat': case 'captions': fillBlack(ctx, w, h); drawGraphic(ctx, inp, w, h); break;
      case 'cg': fillBlack(ctx, w, h); window.WebMixCG.draw(ctx, inp.cg.design, w, h, { preview: true }); break;
      case 'scene': drawScene(ctx, inp, w, h); break;
      case 'slides': {
        const c = slideCanvas(inp);
        if (inp.status !== 'live' || !c) { drawNoSignal(ctx, w, h, inp); break; }
        fillBlack(ctx, w, h);
        drawFitColored(ctx, inp, c, c.width, c.height, w, h);
        break;
      }
      case 'image':
        if (inp.status !== 'live') { drawNoSignal(ctx, w, h, inp); break; }
        fillBlack(ctx, w, h);
        drawFitColored(ctx, inp, inp.el, inp.el.naturalWidth, inp.el.naturalHeight, w, h);
        break;
      case 'playlist':
        if (inp.showImg) { fillBlack(ctx, w, h); drawFitColored(ctx, inp, inp.showImg, inp.showImg.naturalWidth, inp.showImg.naturalHeight, w, h); break; }
        // falls through — รายการปัจจุบันเป็นวิดีโอ
      default: {
        const v = inp.el, bg = bgFrame(inp);
        if (bg) {
          fillBlack(ctx, w, h);
          drawFitColored(ctx, inp, bg, bg.width, bg.height, w, h);
        } else if (inp.status === 'live' && v && v.readyState >= 2 && v.videoWidth) {
          fillBlack(ctx, w, h);
          drawFitColored(ctx, inp, v, v.videoWidth, v.videoHeight, w, h);
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
    } else if (settings.transition === 'push') {
      // ภาพ B ดันภาพ A ออกไปทางซ้าย
      ctx.save(); ctx.translate(-w * p, 0); drawSource(ctx, A, w, h); ctx.restore();
      ctx.save(); ctx.translate(w * (1 - p), 0); drawSource(ctx, B, w, h); ctx.restore();
    } else if (settings.transition === 'stinger') {
      // สลับภาพตรงจุดตัด — ตัววิดีโอสติงเกอร์วาดทับทีหลัง (drawStinger)
      drawSource(ctx, p < settings.stinger.cutAt ? A : B, w, h);
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
      const kw = Math.min(W, 1920), kh = Math.round(kw * H / W);
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
  const isOnAir = id => !!id && (id === state.programId || onOverlay(id) || sceneHas(state.programId, id));

  // ปรับสีต่อแหล่งภาพ (กล้อง/วิดีโอ/รูป): b ความสว่าง ×, c คอนทราสต์ ×, s ความอิ่มสี ×, t อุณหภูมิสี (−1 เย็น … +1 อุ่น)
  const COLOR_TYPES = ['camera', 'screen', 'wireless', 'guest', 'media', 'image', 'playlist', 'srt'];
  const NEUTRAL_COLOR = { b: 1, c: 1, s: 1, t: 0 };
  function sanitizeColor(cc) {
    if (!cc || typeof cc !== 'object') return null;
    const n = (v, a, b, d) => Number.isFinite(+v) ? clamp(+v, a, b) : d;
    const out = { b: n(cc.b, 0.3, 2, 1), c: n(cc.c, 0.3, 2, 1), s: n(cc.s, 0, 2.5, 1), t: n(cc.t, -1, 1, 0) };
    return out.b === 1 && out.c === 1 && out.s === 1 && out.t === 0 ? null : out;
  }
  const colorOf = inp => (inp && inp.color && COLOR_TYPES.includes(inp.type) ? inp.color : null);
  // 2D: ใช้ CSS filter ของ canvas · อุณหภูมิสีใช้สีส้ม/ฟ้าทับแบบ soft-light
  // โหมดแนวตั้ง: ภาพแนวนอนเต็มจอแนวตั้งแบบครอป — inp.vx = ตำแหน่งครอปซ้าย-ขวา (0–1, กลาง = 0.5)
  const vCover = (w, h, sw, sh) => settings.orient === 'v' && h > w && sw > sh;
  function drawFitV(ctx, inp, src, sw, sh, w, h) {
    if (!vCover(w, h, sw, sh)) { drawFit(ctx, src, sw, sh, w, h); return; }
    const k = Math.max(w / sw, h / sh), dw = sw * k, dh = sh * k;
    ctx.drawImage(src, -(dw - w) * (inp.vx ?? 0.5), (h - dh) / 2, dw, dh);
  }
  function drawFitColored(ctx, inp, src, sw, sh, w, h) {
    const cc = colorOf(inp);
    if (!cc) { drawFitV(ctx, inp, src, sw, sh, w, h); return; }
    ctx.save();
    ctx.filter = `brightness(${cc.b}) contrast(${cc.c}) saturate(${cc.s})`;
    drawFitV(ctx, inp, src, sw, sh, w, h);
    ctx.restore();
    if (cc.t) {
      const k = Math.min(1, sw && sh ? Math.min(w / sw, h / sh) : 1), dw = sw * k, dh = sh * k;
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = cc.t > 0 ? `rgba(255,140,40,${cc.t * 0.55})` : `rgba(60,140,255,${-cc.t * 0.55})`;
      ctx.fillRect((w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
    }
  }

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
  function drawSourceT(ctx, inp, w, h, cgSceneId) {
    switch (inp.type) {
      case 'title': case 'timer': case 'score': case 'ticker': case 'visualizer': case 'chat': case 'captions': drawGraphic(ctx, inp, w, h); return;
      case 'cg': {
        const fallback = inp.cg.onAirSnapshot && cgSceneId === inp.cg.onAirSceneId && !inp.cg.design.scenes.some(scene => scene.id === cgSceneId) ? inp.cg.onAirSnapshot : null;
        const design = fallback ? { ...inp.cg.design, scenes: [fallback], activeSceneId: fallback.id } : inp.cg.design;
        window.WebMixCG.draw(ctx, design, w, h, { sceneId: cgSceneId }); return;
      }
      case 'image': if (inp.status === 'live') drawFitColored(ctx, inp, inp.el, inp.el.naturalWidth, inp.el.naturalHeight, w, h); return;
      case 'bars': case 'black': case 'slate': case 'clock': case 'scene': drawSource(ctx, inp, w, h); return;
      case 'playlist':
        if (inp.showImg) { drawFitColored(ctx, inp, inp.showImg, inp.showImg.naturalWidth, inp.showImg.naturalHeight, w, h); return; }
        // falls through
      default: {
        const v = inp.el, bg = bgFrame(inp);
        if (bg) drawFitColored(ctx, inp, bg, bg.width, bg.height, w, h);
        else if (inp.status === 'live' && v && v.readyState >= 2 && v.videoWidth) drawFitColored(ctx, inp, v, v.videoWidth, v.videoHeight, w, h);
      }
    }
  }

  // คีย์ฉากเขียว/ฟ้าของ Input นั้น (คำนวณครั้งเดียวต่อเฟรม ใช้ได้ทั้ง Program และ Preview)
  const keyWork = document.createElement('canvas');
  const keyWorkCtx = keyWork.getContext('2d', { willReadFrequently: !keyer });
  function keyedCanvas(inp, L, cgSceneId) {
    const kw = Math.max(64, Math.round(Math.min(W * L.scale, keyer ? 1920 : 640))), kh = Math.round(kw * H / W);
    const cache = inp._key || (inp._key = { canvas: document.createElement('canvas'), frame: -1 });
    if (cache.frame === frameNo && cache.canvas.width === kw) return cache.canvas;
    if (keyWork.width !== kw || keyWork.height !== kh) { keyWork.width = kw; keyWork.height = kh; }
    keyWorkCtx.clearRect(0, 0, kw, kh);
    drawSourceT(keyWorkCtx, inp, kw, kh, cgSceneId);
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
  function drawLayout(ctx, inp, L, w, h, cgSceneId) {
    const { box, vis } = layoutRects(L, w, h);
    if (vis.w <= 0 || vis.h <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(vis.x, vis.y, vis.w, vis.h); ctx.clip();
    if (L.key !== 'none') ctx.drawImage(keyedCanvas(inp, L, cgSceneId), box.x, box.y, box.w, box.h);
    else { ctx.translate(box.x, box.y); drawSourceT(ctx, inp, box.w, box.h, cgSceneId); }
    ctx.restore();
    if (L.border && L.scale < 1) {
      ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = Math.max(1, 3 * h / 720);
      ctx.strokeRect(vis.x, vis.y, vis.w, vis.h);
    }
  }

  function drawOverlayChannel(ctx, c, w, h, a, preview = false) {
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
    const cgSceneId = inp.type === 'cg' ? (preview && c.staged ? inp.cg.previewSceneId : inp.cg.onAirSceneId) : undefined;
    drawLayout(ctx, inp, L, w, h, cgSceneId);
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
      if (c.anim > 0) drawOverlayChannel(ctx, c, w, h, c.anim, preview);
      else if (preview && c.staged && byId(c.inputId)) drawOverlayChannel(ctx, c, w, h, 1, true);
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
  function inputTexture(inp, transparent, cgSceneId) {
    const sec = Math.floor(Date.now() / 1000);
    const GW = Math.min(W, 1920), GH = Math.round(GW * H / W);
    const noSignal = () => transparent ? null
      : { e: genTexture('ns:' + inp.id, `${inp.name}|${inp.srtState}|${inp.missing}|${inp.status}`, GW, GH, (c, w, h) => drawNoSignal(c, w, h, inp)), full: true };
    switch (inp.type) {
      case 'black': return transparent ? { solid: [0, 0, 0, 1] } : { solid: [0, 0, 0, 1] };
      case 'bars': return { e: genTexture('g:' + inp.id, 'bars', GW, GH, drawBars), full: true };
      case 'slate': case 'clock':
        return { e: genTexture('g:' + inp.id, `${inp.text}|${sec}`, GW, GH, (c, w, h) => drawSource(c, inp, w, h)), full: true };
      case 'title':
        return { e: genTexture('g:' + inp.id, JSON.stringify(inp.title) + (inp.title?.anim ? titleAnim(inp).toFixed(2) : ''), W, H, (c, w, h) => drawTitleInput(c, inp, w, h)), full: true, under: transparent ? null : [0, 0, 0, 1] };
      case 'cg': {
        const renderSceneId = cgSceneId || inp.cg.onAirSceneId || inp.cg.design.activeSceneId;
        const renderScene = inp.cg.design.scenes?.find(scene => scene.id === renderSceneId) || inp.cg.design.scenes?.[0];
        const animated = renderScene?.elements?.some(element => element.type === 'ticker' && element.visible);
        const stamp = `${renderSceneId}|${window.WebMixCG.assetRevision}|${JSON.stringify(inp.cg.design)}|${animated ? Math.floor(performance.now() / 33) : 'static'}`;
        return { e: genTexture('cg:' + inp.id, stamp, W, H, (c, w, h) => {
          const fallback = inp.cg.onAirSnapshot && cgSceneId === inp.cg.onAirSceneId && !inp.cg.design.scenes.some(scene => scene.id === cgSceneId) ? inp.cg.onAirSnapshot : null;
          const design = fallback ? { ...inp.cg.design, scenes: [fallback], activeSceneId: fallback.id } : inp.cg.design;
          window.WebMixCG.draw(c, design, w, h, { sceneId: renderSceneId });
        }), full: true, under: transparent ? null : [0, 0, 0, 1] };
      }
      case 'timer': {
        // วาดใหม่เมื่อตัวเลขเปลี่ยน (ทุกวินาที) หรือช่วงกะพริบตอนหมดเวลา
        const tt = timerText(inp.timer), stamp = `${tt.text}|${tt.done ? Math.floor(Date.now() / 500) % 2 : ''}|${JSON.stringify(inp.timer)}`;
        return { e: genTexture('g:' + inp.id, stamp, W, H, (c, w, h) => drawTimer(c, w, h, inp)), full: true, under: transparent ? null : [0, 0, 0, 1] };
      }
      case 'score':
        return { e: genTexture('g:' + inp.id, `${scoreClockText(inp)}|${JSON.stringify(inp.score)}`, W, H, (c, w, h) => drawScore(c, w, h, inp, scoreClockText(inp))), full: true, under: transparent ? null : [0, 0, 0, 1] };
      case 'visualizer':
        return { e: genTexture('g:' + inp.id, frameNo, GW, GH, (c, w, h) => drawViz(c, inp, w, h)), full: true, under: transparent ? null : [0, 0, 0, 1] };
      case 'captions':
        return { e: genTexture('g:' + inp.id, `${captionText(inp)}|${JSON.stringify(inp.cap)}`, W, H, (c, w, h) => drawGraphic(c, inp, w, h)), full: true, under: transparent ? null : [0, 0, 0, 1] };
      case 'chat': {
        const a = chatAnim();
        return { e: genTexture('g:' + inp.id, `${chatFeed.shown?.id}|${a.toFixed(3)}|${inp.chat.style}`, W, H, (c, w, h) => drawGraphic(c, inp, w, h)), full: true, under: transparent ? null : [0, 0, 0, 1] };
      }
      case 'ticker': {
        // ตัววิ่งเลื่อนทุกเฟรม: วาดและส่งขึ้น GPU เฉพาะแถบ ไม่ใช่ทั้งจอ
        const bh = Math.round(H * TICKER_BAR.h);
        return { e: genTexture('g:' + inp.id, frameNo, W, bh, (c, w, h) => drawTickerBar(c, w, h, inp)), region: TICKER_BAR, under: transparent ? null : [0, 0, 0, 1] };
      }
      case 'slides': {
        const c = slideCanvas(inp);
        if (inp.status !== 'live' || !c) return noSignal();
        const e = gpu.entry('s:' + inp.id);
        if (e.stamp !== c) { gpu.upload(e, c, c.width, c.height); e.stamp = c; }
        return { e };
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
        const e = gpu.entry('v:' + inp.id), bg = bgFrame(inp);
        if (bg) { if (e.stamp !== inp.bgState.version) { gpu.upload(e, bg, bg.width, bg.height); e.stamp = inp.bgState.version; e.frame = -1; } return { e }; }
        if (e.frame !== frameNo) { if (!gpu.upload(e, v, v.videoWidth, v.videoHeight)) return noSignal(); e.frame = frameNo; e.stamp = null; }
        return { e };
      }
    }
  }

  // วาด Input ให้พอดีกรอบ box โดยแสดงเฉพาะส่วนที่อยู่ใน clip
  function glDrawInput(inp, box, clip, alpha = 1, opts = {}) {
    if (!inp) return;
    if (inp.type === 'scene') { glDrawScene(inp, box, clip, alpha); return; }
    const t = inputTexture(inp, !!opts.transparent, opts.cgSceneId);
    if (!t) return;
    const vis = intersect(box, clip);
    if (vis.w <= 0 || vis.h <= 0) return;
    if (t.solid) { gpu.solid(vis, t.solid, alpha); return; }
    if (t.under) gpu.solid(vis, t.under, alpha);
    const f = t.region ? { x: box.x, y: box.y + box.h * t.region.y, w: box.w, h: box.h * t.region.h } : t.full ? box
      : vCover(box.w, box.h, t.e.w, t.e.h) ? (k => ({ x: box.x - (t.e.w * k - box.w) * (inp.vx ?? 0.5), y: box.y + (box.h - t.e.h * k) / 2, w: t.e.w * k, h: t.e.h * k }))(Math.max(box.w / t.e.w, box.h / t.e.h))
      : fitRect(t.e.w, t.e.h, box);
    const r = intersect(f, vis);
    if (r.w <= 0 || r.h <= 0) return;
    gpu.quad(t.e, r, [(r.x - f.x) / f.w, (r.y - f.y) / f.h, (r.x + r.w - f.x) / f.w, (r.y + r.h - f.y) / f.h], alpha, opts.key || null, t.full || t.region ? null : colorOf(inp));
  }

  // ซีน: วาดแต่ละช่องด้วยแหล่งภาพของช่องนั้น (เต็มช่องแบบครอปขอบ) บนพื้นสีเข้ม
  function glDrawScene(inp, box, clip, alpha) {
    const vis = intersect(box, clip);
    if (vis.w <= 0 || vis.h <= 0) return;
    gpu.solid(vis, [0.043, 0.051, 0.071, 1], alpha);
    for (const sl of sceneSlots(inp, box.x, box.y, box.w, box.h)) {
      const area = intersect(sl.rect, clip);
      if (area.w <= 0 || area.h <= 0) continue;
      if (!sl.child) { gpu.solid(area, [0.09, 0.105, 0.135, 1], alpha); continue; }
      glDrawInput(sl.child, sl.box, area, alpha);
      if (sl.frame) {
        const r = sl.rect, t = Math.max(2, box.w / 480), col = [1, 1, 1, 0.9];
        gpu.solid({ x: r.x, y: r.y, w: r.w, h: t }, col, alpha); gpu.solid({ x: r.x, y: r.y + r.h - t, w: r.w, h: t }, col, alpha);
        gpu.solid({ x: r.x, y: r.y, w: t, h: r.h }, col, alpha); gpu.solid({ x: r.x + r.w - t, y: r.y, w: t, h: r.h }, col, alpha);
      }
    }
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
    } else if (settings.transition === 'push') {
      glDrawInput(A, { x: -w * p, y: 0, w, h }, full);
      glDrawInput(B, { x: w * (1 - p), y: 0, w, h }, full);
    } else if (settings.transition === 'stinger') {
      glDrawInput(p < settings.stinger.cutAt ? A : B, full, full);
    } else {
      glDrawInput(A, full, full);
      glDrawInput(B, full, full, p);
    }
  }

  // Overlay ตามตำแหน่ง/ครอป/คีย์ของ Input พร้อมเอฟเฟกต์เข้า-ออก (เหมือน drawOverlayChannel)
  function glOverlayChannel(c, w, h, a, preview = false) {
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
    const cgSceneId = inp.type === 'cg' ? (preview && c.staged ? inp.cg.previewSceneId : inp.cg.onAirSceneId) : undefined;
    glDrawInput(inp, box, vis, alpha, { transparent: true, cgSceneId, key: L.key !== 'none' ? { color: L.key, tolerance: L.tolerance } : null });
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
      if (c.anim > 0) glOverlayChannel(c, PW, PH, c.anim, true);
      else if (c.staged && byId(c.inputId)) glOverlayChannel(c, PW, PH, 1, true);
    }
    glClassicOverlays(PW, PH);
    pvwCtx.drawImage(gpu.canvas, 0, 0, PW, PH, 0, 0, PW, PH);

    gpu.begin(W, H);
    glProgramBase(W, H);
    for (const c of ovl) if (c.anim > 0) glOverlayChannel(c, W, H, c.anim, false);
    glClassicOverlays(W, H);
    if (stingerOn()) {
      const e = gpu.entry('stinger');
      if (e.frame !== frameNo && gpu.upload(e, stinger.el, stinger.el.videoWidth, stinger.el.videoHeight)) e.frame = frameNo;
      if (e.frame === frameNo) gpu.quad(e, { x: 0, y: 0, w: W, h: H }, [0, 0, 1, 1]);
    }
    if (ftb.level > 0) gpu.solid({ x: 0, y: 0, w: W, h: H }, [0, 0, 0, 1], ftb.level);
    pgmCtx.drawImage(gpu.canvas, 0, 0);
    feedReplay();
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
    stepBackgrounds(now);
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
      if (stingerOn()) pgmCtx.drawImage(stinger.el, 0, 0, W, H);
      if (ftb.level > 0) { pgmCtx.fillStyle = `rgba(0,0,0,${ftb.level})`; pgmCtx.fillRect(0, 0, W, H); }
      feedReplay();

      drawSource(pvwCtx, byId(state.previewId), PW, PH);
      drawOverlayChannels(pvwCtx, PW, PH, true);
      drawOverlays(pvwCtx, PW, PH);
    }

    enforceMarks();
    if (now - lastThumbs > 100) {
      lastThumbs = now;
      transport.update();
      lufs.render();
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

  /* ---- Stinger: วิดีโอ (ควรเป็น WebM ที่มีพื้นโปร่งใส) เล่นทับ Program ตอนกด AUTO แล้วสลับภาพตรงจุดตัด
     ใช้ความยาววิดีโอเป็นความยาวทรานซิชัน · เลื่อน T-Bar เองจะสลับที่จุดตัดโดยไม่เล่นวิดีโอ */
  const stinger = { el: null, url: '', ready: false, stallMs: 3000 };
  function loadStinger(file) {
    if (stinger.el) stinger.el.pause();
    if (stinger.url) URL.revokeObjectURL(stinger.url);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    stinger.url = URL.createObjectURL(file); stinger.ready = false; stinger.el = v;
    return new Promise(res => {
      v.onloadeddata = () => { stinger.ready = v.duration > 0 && isFinite(v.duration); res(stinger.ready); };
      v.onerror = () => { stinger.ready = false; res(false); };
      v.src = stinger.url;
    });
  }
  const stingerOn = () => tr.stinger && stinger.el && stinger.el.readyState >= 2 && !stinger.el.ended;
  function stopStinger() {
    tr.stinger = false;
    if (stinger.el) stinger.el.pause();
  }
  async function openStingerDialog() {
    let picked = null;
    const r = await dialog({
      title: 'Stinger — วิดีโอเปลี่ยนภาพ',
      body: `
        <p class="note">เลือกวิดีโอสั้น ๆ (1–3 วินาที) แนะนำ WebM ที่มีพื้นโปร่งใส · กด AUTO แล้ววิดีโอจะเล่นทับจอ และสลับภาพตรงจุดที่วิดีโอปิดจอเต็ม</p>
        <div class="field"><span>ไฟล์วิดีโอ</span><div class="st-file"><button type="button" class="btn" data-st-pick>เลือกไฟล์…</button> <b class="st-name">${esc(settings.stinger.name || 'ยังไม่ได้เลือก')}</b></div></div>
        <label class="field"><span>จุดสลับภาพ <b class="st-cut">${Math.round(settings.stinger.cutAt * 100)}%</b> ของความยาววิดีโอ</span><input type="range" name="cutAt" min="5" max="95" step="1" value="${Math.round(settings.stinger.cutAt * 100)}"></label>
        <p class="note st-len">${stinger.ready ? `ความยาว ${stinger.el.duration.toFixed(1)} วินาที` : ''}</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'ใช้ Stinger', primary: true, value: 'save' }],
      onOpen(modal) {
        const cut = $('input[name=cutAt]', modal);
        cut.addEventListener('input', () => { $('.st-cut', modal).textContent = cut.value + '%'; });
        $('[data-st-pick]', modal).addEventListener('click', () => {
          const fi = document.createElement('input');
          fi.type = 'file'; fi.accept = 'video/*';
          fi.onchange = () => {
            picked = fi.files[0] || null;
            if (picked) { $('.st-name', modal).textContent = picked.name; $('.st-len', modal).textContent = ''; }
          };
          fi.click();
        });
      }
    });
    if (r?.value !== 'save') return false;
    if (picked) {
      if (!(await loadStinger(picked))) { toast(`เปิดวิดีโอ “${picked.name}” ไม่ได้ — ลองไฟล์ WebM หรือ MP4`, 'error'); return false; }
      settings.stinger.name = picked.name.slice(0, 80);
      mediaStore.put('stinger', picked).then(ok => { if (!ok) toast('พื้นที่ในเบราว์เซอร์ไม่พอเก็บไฟล์ Stinger — เปิดหน้าใหม่แล้วต้องเลือกอีกครั้ง', 'warn', 6000); });
    }
    settings.stinger.cutAt = clamp(+r.form.cutAt.value / 100, 0.05, 0.95);
    saveSettings();
    if (!stinger.ready) { toast('ยังไม่ได้เลือกวิดีโอ Stinger', 'warn'); return false; }
    return true;
  }

  function cut() {
    if (!byId(state.previewId)) return;
    replayGoingOn(state.previewId);
    stopStinger();
    tr.auto = false;
    tr.progress = 0;
    swapBuses();
    tbar.set(tr.base);
    $('[data-action="auto"]').classList.remove('is-running');
    updateTally();
  }

  function autoTransition() {
    if (tr.auto || !byId(state.previewId) || state.previewId === state.programId) return;
    if (settings.transition === 'stinger') {
      if (!stinger.ready) { toast('ยังไม่มีวิดีโอ Stinger — เลือกไฟล์ก่อน (กดปุ่ม STING อีกครั้ง)', 'warn'); openStingerDialog(); return; }
      if (tr.progress >= settings.stinger.cutAt) { completeTransition(); return; }
      tr.stinger = true;
      tr.stVt = -1;
      tr.from = 0;
      stinger.el.currentTime = 0;
      stinger.el.play().catch(() => {});
    } else tr.from = tr.progress;
    replayGoingOn(state.previewId);
    tr.auto = true;
    tr.start = performance.now();
    $('[data-action="auto"]').classList.add('is-running');
    audio.applyAfv();
  }

  function stepTransition(now) {
    if (!tr.auto) return;
    // Stinger: ตามเวลาของวิดีโอจริง (ถ้าวิดีโอกระตุก จุดสลับภาพยังตรงกับภาพที่ปิดจอ)
    const v = stinger.el;
    const p = tr.stinger ? (v.ended ? 1 : v.currentTime > 0 ? v.currentTime / v.duration : 0)
      : tr.from + (now - tr.start) / settings.duration;
    if (tr.stinger) {
      // วิดีโอค้าง (ถอดรหัสไม่ได้/ไฟล์เสีย) เกิน 3 วินาที → จบทรานซิชันเลย ไม่ให้ค้างกลางทาง
      if (v.currentTime !== tr.stVt) { tr.stVt = v.currentTime; tr.stAt = now; }
      else if (now - tr.stAt > stinger.stallMs) { completeTransition(); return; }
    }
    if (p >= 1) completeTransition();
    else { tr.progress = p; tbar.set(tr.base === 0 ? p * 100 : 100 - p * 100); }
  }

  function completeTransition() {
    stopStinger();
    swapBuses();
    tr.auto = false;
    tr.progress = 0;
    tr.base = tr.base === 0 ? 100 : 0;
    tbar.set(tr.base);
    $('[data-action="auto"]').classList.remove('is-running');
    updateTally();
  }

  function onTbar(v) {
    stopStinger();
    if (tr.auto) { tr.auto = false; $('[data-action="auto"]').classList.remove('is-running'); }
    const was = tr.progress;
    tr.progress = clamp(tr.base === 0 ? v / 100 : (100 - v) / 100, 0, 1);
    if (tr.progress >= 0.999) completeTransition();
    else if ((was > 0) !== (tr.progress > 0)) audio.applyAfv();
    if (was === 0 && tr.progress > 0) replayGoingOn(state.previewId);
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
      const inScene = !isPgm && sceneHas(state.programId, id);
      card.classList.toggle('is-pgm', isPgm);
      card.classList.toggle('is-pvw', isPvw);
      card.classList.toggle('is-ovl', !isPgm && (ovIdx >= 0 || inScene));
      card.querySelector('.card-tally').textContent = isPgm ? 'PGM' : ovIdx >= 0 ? `OV${ovIdx + 1}` : inScene ? 'SCENE' : isPvw ? 'PVW' : '';
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

  function cgOnAir(inp) { return ovl.some(c => c.on && c.inputId === inp.id); }
  function cgStudioUrl(inp) {
    const url = new URL('cg-studio.html', location.href);
    url.searchParams.set('channel', inp.cg.channel);
    return url.href;
  }
  function openCGStudio(inp) {
    const page = window.open(cgStudioUrl(inp), '_blank');
    if (!page) toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต Pop-up สำหรับ WebMix แล้วกดแก้ไข CG อีกครั้ง', 'warn', 6000);
  }
  function attachCGBridge(inp) {
    if (!('BroadcastChannel' in window) || !inp.cg) return;
    try {
      const bus = new BroadcastChannel(`webmix-cg:${inp.cg.channel}`);
      inp.cgBus = bus;
      let cgRevision = 0;
      const reply = (type, payload = {}) => bus.postMessage({ protocolVersion: 1, channel: inp.cg.channel, type, ...payload });
      const onAirSlot = () => ovl.findIndex(c => c.on && c.inputId === inp.id);
      const stagedSlot = () => ovl.findIndex(c => c.staged && c.inputId === inp.id);
      const safeSlot = value => Number.isInteger(+value) && +value >= 0 && +value < OVL_COUNT ? +value : -1;
      bus.onmessage = event => {
        const msg = event.data;
        if (!msg || msg.channel !== inp.cg.channel) return;
        if (msg.type === 'hello' || msg.type === 'ready') {
          reply('snapshot', { document: inp.cg.design, revision: cgRevision, visible: cgOnAir(inp), staged: stagedSlot() >= 0, slot: onAirSlot() >= 0 ? onAirSlot() : stagedSlot() >= 0 ? stagedSlot() : 0, onAirSceneId: inp.cg.onAirSceneId || '' });
        } else if ((msg.type === 'document:update' && msg.document) || (msg.type === 'design' && msg.design)) {
          const previous = inp.cg.design, previousSnapshot = inp.cg.onAirSnapshot, previousSceneId = inp.cg.onAirSceneId, previousPreviewSceneId = inp.cg.previewSceneId;
          const next = window.WebMixCG.sanitize(msg.document || msg.design);
          const oldOnAir = previous.scenes?.find(scene => scene.id === inp.cg.onAirSceneId);
          inp.cg.onAirSnapshot = oldOnAir && !next.scenes.some(scene => scene.id === inp.cg.onAirSceneId) ? oldOnAir : null;
          inp.cg.design = next;
          if (stagedSlot() >= 0) inp.cg.previewSceneId = next.activeSceneId;
          if (!inp.cg.onAirSceneId || !next.scenes.some(scene => scene.id === inp.cg.onAirSceneId) && !inp.cg.onAirSnapshot) inp.cg.onAirSceneId = next.activeSceneId;
          if (JSON.stringify(show.serialize()).length > 2000000) {
            inp.cg.design = previous; inp.cg.onAirSnapshot = previousSnapshot; inp.cg.onAirSceneId = previousSceneId; inp.cg.previewSceneId = previousPreviewSceneId;
            reply('document:rollback', { document: previous, revision: cgRevision, message: 'ข้อมูล CG รวมใหญ่เกินพื้นที่บันทึก Show — ลดขนาด/จำนวนรูปก่อน' }); return;
          }
          cgRevision = Math.max(cgRevision + 1, Number(msg.revision) || 0);
          renderInputs();
          show.autosave();
          reply('document:ack', { revision: cgRevision });
        } else if (msg.type === 'preview:set') {
          const at = safeSlot(msg.slot);
          if (at < 0) { reply('error', { message: 'เลือกช่อง Preview ตั้งแต่ Overlay 1 ถึง 8' }); return; }
          const liveAt = onAirSlot();
          if (liveAt >= 0 && liveAt !== at) { reply('error', { message: `CG นี้กำลังออกอากาศที่ Overlay ${liveAt + 1} อยู่` }); return; }
          if (ovl[at].on && ovl[at].inputId !== inp.id) { reply('error', { message: `Overlay ${at + 1} กำลังแสดงแหล่งภาพอื่นอยู่` }); return; }
          ovl[at].inputId = inp.id; ovl[at].staged = true;
          inp.cg.previewSceneId = inp.cg.design.scenes.some(scene => scene.id === msg.sceneId) ? msg.sceneId : inp.cg.design.activeSceneId;
          updateOverlayUI();
          reply('onair:state', { visible: cgOnAir(inp), slot: at, staged: true });
        } else if (msg.type === 'preview:clear') {
          const at = safeSlot(msg.slot);
          if (at >= 0 && ovl[at].inputId === inp.id && !ovl[at].on) { ovl[at].staged = false; updateOverlayUI(); }
          reply('onair:state', { visible: cgOnAir(inp), slot: at, staged: false });
        } else if (msg.type === 'take') {
          const at = safeSlot(msg.slot);
          if (at < 0) { reply('error', { message: 'เลือกช่อง Overlay ที่จะขึ้นจอ' }); return; }
          if (ovl[at].on && ovl[at].inputId !== inp.id) { reply('error', { message: `Overlay ${at + 1} กำลังแสดงแหล่งภาพอื่นอยู่` }); return; }
          const other = onAirSlot();
          if (other >= 0 && other !== at) { reply('error', { message: `CG นี้กำลังขึ้นจอที่ Overlay ${other + 1} อยู่` }); return; }
          const effect = Object.hasOwn(OVL_EFFECTS, msg.effect) ? msg.effect : 'fade';
          ovl[at].inputId = inp.id; ovl[at].effect = effect; ovl[at].duration = Math.max(150, Math.min(3000, +msg.duration || inp.cg.design.playback?.durationMs || 500));
          ovl[at].staged = false;
          inp.cg.onAirSceneId = inp.cg.design.activeSceneId; inp.cg.onAirSnapshot = null;
          if (!ovl[at].on) setChannel(at, true); else updateOverlayUI();
          reply('onair:state', { visible: true, slot: at });
        } else if (msg.type === 'clear') {
          const requested = safeSlot(msg.slot);
          if (requested >= 0 && ovl[requested].staged && !ovl[requested].on && ovl[requested].inputId === inp.id) {
            ovl[requested].staged = false; updateOverlayUI(); reply('onair:state', { visible: cgOnAir(inp), slot: requested, staged: false }); return;
          }
          const at = requested >= 0 && ovl[requested].on && ovl[requested].inputId === inp.id ? requested : onAirSlot();
          if (at >= 0) {
            ovl[at].effect = Object.hasOwn(OVL_EFFECTS, msg.effect) ? msg.effect : ovl[at].effect;
            ovl[at].duration = Math.max(150, Math.min(3000, +msg.duration || ovl[at].duration));
            setChannel(at, false);
          }
          reply('onair:state', { visible: cgOnAir(inp), slot: at >= 0 ? at : requested });
        }
      };
      inp.status = 'live';
    } catch (e) { console.warn('CG Studio channel unavailable', e); }
  }
  function addCGInput() {
    const n = inputs.filter(i => i.type === 'cg').length + 1;
    const inp = addInput({ type: 'cg', name: `CG ${n}`, status: 'live', cg: { channel: `${uid()}${uid()}`, design: window.WebMixCG.defaults() } });
    attachCGBridge(inp);
    openCGStudio(inp);
    show.autosave();
    return inp;
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
      // หน้าว่าง: ขั้นตอนเริ่มต้น + ทางลัดเพิ่มแหล่งภาพที่ใช้บ่อย (ลากไฟล์มาวางก็ได้)
      grid.innerHTML = `<div class="empty-state">
        <div class="es-plus" aria-hidden="true">+</div>
        <div><b>ยังไม่มีแหล่งภาพ</b><p>เพิ่มกล้อง หน้าจอ วิดีโอ หรือรูปก่อน — หรือลากไฟล์มาวางตรงนี้</p></div>
        <div class="es-tiles">
          <button type="button" data-empty="cam"><b>กล้อง</b><small>เว็บแคม / USB</small></button>
          <button type="button" data-empty="screen"><b>แชร์หน้าจอ</b><small>ทั้งจอหรือหน้าต่าง</small></button>
          <button type="button" data-empty="phone"><b>มือถือเป็นกล้อง</b><small>สแกน QR</small></button>
          <button type="button" data-empty="file"><b>ไฟล์</b><small>วิดีโอ รูป PDF</small></button>
        </div>
        <button type="button" class="btn btn-primary" data-empty="menu">${icon('plus')} เพิ่มแหล่งภาพ</button>
        <p class="es-steps">ขั้นที่ 1 เพิ่มแหล่งภาพ → 2 ตั้งปลายทางไลฟ์ → 3 กด STREAM</p>
      </div>`;
      grid.querySelector('.empty-state').addEventListener('click', e => {
        const b = e.target.closest('[data-empty]');
        if (!b) return;
        const k = b.dataset.empty;
        if (k === 'cam') openCameraDialog();
        else if (k === 'screen') addScreen();
        else if (k === 'phone') showWirelessDialog();
        else if (k === 'file') pickFiles('video/*,image/*,application/pdf', files => addDroppedFiles(files));
        else $('[data-action=add-menu]')?.click();
      });
    }
    // ขนาดการ์ด: ภาพตัวอย่างละเอียดขึ้นตามขนาด (ไม่เบลอเมื่อการ์ดใหญ่)
    const [tw, th] = THUMB_SIZE[cardSize()];
    // จอสัมผัส: ปุ่มแก้ไข/ลบ อยู่แถวชื่อใต้ภาพ — แตะตรงภาพได้ทั้งภาพโดยไม่โดนปุ่ม
    const touch = matchMedia('(hover: none)').matches;
    const editBtns = `<button class="mini" data-card="rename" title="แก้ไขชื่อ / ข้อความ">${icon('edit')}</button><button class="mini danger" data-card="remove" title="ลบแหล่งภาพ">${icon('x')}</button>`;
    inputs.forEach((inp, i) => {
      const meta = TYPE_META[inp.type];
      const isMedia = inp.type === 'media' && !inp.missing;
      const canRelink = ['camera', 'screen', 'media', 'image', 'slides'].includes(inp.type) && (inp.missing || inp.status !== 'live');
      const card = document.createElement('div');
      card.className = 'card' + (inp.status !== 'live' ? ' no-signal' : '');
      card.dataset.id = inp.id;
      card.innerHTML = `
        <div class="card-thumb">
          <canvas width="${tw}" height="${th}"></canvas>
          <span class="card-num">${i + 1}</span>
          <span class="card-tally"></span>
          <span class="card-vu" hidden aria-hidden="true"><i><b></b></i><i><b></b></i><em></em></span>
          ${settings.orient === 'v' && VCROP_TYPES.includes(inp.type) ? '<span class="card-vcrop" title="ส่วนที่จะแสดงในภาพแนวตั้ง — ลากซ้าย/ขวาเพื่อเลื่อน"></span>' : ''}
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
            ${inp.type === 'slides' && inp.slides.count ? `
              <button class="mini txt" data-card="slprev" title="หน้าก่อนหน้า (← / Page Up)">‹</button>
              <button class="mini txt" data-card="slnext" title="หน้าถัดไป (→ / Page Down)">›</button>` : ''}
            ${inp.type === 'replay' ? `
              <button class="mini txt rp-cap" data-card="rcap" title="จับภาพ ${inp.replay.len} วินาทีล่าสุด แล้วใส่ใน Preview (ปุ่มลัด I)">⟲ ${inp.replay.len}s</button>
              <button class="mini txt" data-card="rspd" title="ความเร็วเล่นซ้ำ">${speedLabel(inp.replay.speed)}</button>` : ''}
            ${canRelink ? `<button class="mini warn" data-card="relink" title="เชื่อมต่อแหล่งภาพนี้ใหม่">${icon('link')}</button>` : ''}
            ${inp.type === 'wireless' && inp.cam && inp.status === 'live' ? `<button class="mini ${inp.cam.rec ? 'is-rec' : ''}" data-card="camctl" title="ควบคุมกล้องมือถือ (แสง / สี / โฟกัส / ซูม / บันทึกในเครื่อง)">${icon('sliders')}</button>` : ''}
            ${inp.type === 'captions' ? `<button class="mini ${inp.capRun?.on ? 'is-on' : ''}" data-card="cap" title="เริ่ม / หยุดฟังเสียงพูด">${icon(inp.capRun?.on ? 'pause' : 'play')}</button>` : ''}
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
        <div class="card-foot">${icon(meta.icon)}<span class="card-name">${esc(inp.name)}</span><span class="card-sub">${esc(cardSub(inp))}</span><span class="card-afv" hidden>AFV</span><button type="button" class="card-mute" data-card="mute" hidden title="ปิด / เปิดเสียงแหล่งนี้"><svg class="i"><use href="#i-vol"/></svg><span></span></button>${touch ? `<span class="foot-actions">${editBtns}</span>` : ''}</div>
        <div class="card-ovl">${ovl.map((c, k) => `<button type="button" data-card-ovl="${k}" title="ซ้อนเข้า Overlay ${c.n}">${c.n}</button>`).join('')}<button type="button" class="ovl-pos ${inp.layout ? 'is-set' : ''}" data-card="layout" title="ตำแหน่ง / ขนาด / ครอป / คีย์ฉาก">⧉</button></div>`;
      grid.appendChild(card);
      const ctx = card.querySelector('canvas').getContext('2d');
      thumbs.set(inp.id, ctx);
      drawSource(ctx, inp, tw, th);
    });
    cardVu.sync();
    placeVcrops();
    updateTally();
  }

  // กรอบครอปแนวตั้งบนการ์ด: กว้างตามสัดส่วนที่เห็นจริง · ลากเพื่อเลื่อนตำแหน่ง (inp.vx)
  const VCROP_TYPES = ['camera', 'screen', 'media', 'wireless', 'guest', 'srt', 'image', 'replay', 'playlist', 'slides'];
  const srcAspect = inp => { const e = inp.showImg || inp.el; const w = e && (e.videoWidth || e.naturalWidth), h = e && (e.videoHeight || e.naturalHeight); return w && h ? w / h : 16 / 9; };
  const vcropFrac = inp => clamp((W / H) / srcAspect(inp), 0.05, 1);
  function placeVcrops() {
    for (const el of $$('#inputs-grid .card-vcrop')) {
      const inp = byId(el.closest('.card').dataset.id);
      if (!inp) continue;
      const f = vcropFrac(inp), a = srcAspect(inp), thumbA = 16 / 9;
      // ภาพในการ์ดวางแบบพอดีกรอบ 16:9 — กรอบครอปอยู่ในพื้นที่ภาพจริง
      const imgW = a >= thumbA ? 1 : a / thumbA, x0 = (1 - imgW) / 2;
      el.style.width = `${f * imgW * 100}%`;
      el.style.left = `${(x0 + (1 - f) * imgW * (inp.vx ?? 0.5)) * 100}%`;
    }
  }
  function bindVcropDrag(grid) {
    grid.addEventListener('pointerdown', e => {
      const el = e.target.closest('.card-vcrop');
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      const inp = byId(el.closest('.card').dataset.id), thumb = el.parentElement;
      if (!inp) return;
      el.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = inp.vx ?? 0.5, span = thumb.getBoundingClientRect().width * (1 - vcropFrac(inp)) * Math.min(1, srcAspect(inp) / (16 / 9));
      const move = ev => { inp.vx = span > 0 ? clamp(v0 + (ev.clientX - x0) / span, 0, 1) : 0.5; placeVcrops(); };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.dataset.dragged = '1'; };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    grid.addEventListener('click', e => { if (e.target.closest('.card-vcrop')) e.stopPropagation(); }, true);
  }
  function setOrient(v) {
    if (v === settings.orient) return;
    if (rec.active || streamer.active || streamer.reconnecting) { toast('กำลังไลฟ์หรือบันทึกอยู่ — หยุดก่อนแล้วค่อยเปลี่ยนเป็นแนวตั้ง / แนวนอน', 'warn'); syncOrientSeg(); return; }
    settings.orient = v === 'v' ? 'v' : 'h';
    saveSettings();
    applyResolution();
    renderInputs();
    syncOrientSeg();
    toast(settings.orient === 'v' ? `โหมดแนวตั้ง 9:16 · Program ${W}×${H} — ลากกรอบสีส้มบนการ์ดเพื่อเลือกส่วนที่จะแสดง` : `กลับเป็นแนวนอน 16:9 · Program ${W}×${H}`, 'success', 5000);
  }
  const syncOrientSeg = () => $$('#seg-orient button').forEach(b => b.classList.toggle('is-active', b.dataset.value === settings.orient));

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
      if (act === 'mute') cardVu.toggleMute(inp.id);
      else if (act === 'remove') removeInput(inp.id);
      else if (act === 'rename') renameInput(inp);
      else if (act === 'relink') relinkInput(inp);
      else if (act === 'layout') openLayoutDialog(inp);
      else if (act === 'invite') showGuestInvite(inp);
      else if (act === 'camctl') openCamControl(inp);
      else if (act === 'tplay' || act === 'treset') { timerControl(inp, act === 'tplay' ? 'toggle' : 'reset'); }
      else if (/^s[ab][+-]$/.test(act)) { const k = act[1] === 'a' ? 'scoreA' : 'scoreB'; inp.score[k] = Math.max(0, (+inp.score[k] || 0) + (act[2] === '+' ? 1 : -1)); }
      else if (act === 'dprev' || act === 'dnext') dataSources.step(inp, act === 'dnext' ? 1 : -1);
      else if (act === 'pprev' || act === 'pnext') playlist.go(inp, inp.list.index + (act === 'pnext' ? 1 : -1), true);
      else if (act === 'pplay') playlist.setPlaying(inp, !inp.list.playing);
      else if (act === 'ploop') { inp.list.loop = !inp.list.loop; renderInputs(); }
      else if (act === 'play') clipPlayToggle(inp);
      else if (act === 'restart') clipRestart(inp);
      else if (act === 'loop') { inp.el.loop = !inp.el.loop; actionBtn.classList.toggle('is-on', inp.el.loop); }
      else if (act === 'rcap') replayCapture(inp);
      else if (act === 'cap') { inp.capRun?.on ? captionStop(inp) : captionStart(inp); renderInputs(); }
      else if (act === 'slprev' || act === 'slnext') slideGo(inp, inp.slides.page + (act === 'slnext' ? 1 : -1));
      else if (act === 'rspd') { const i = REPLAY_SPEEDS.indexOf(inp.replay.speed); inp.replay.speed = REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length]; inp.el.playbackRate = inp.replay.speed; actionBtn.textContent = speedLabel(inp.replay.speed); }
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

  /* ------------------------------------------------------ resizable layout */
  // ลากเส้นแบ่งปรับขนาด: ↕ จอ Preview/Program กับแผงด้านล่าง · ↔ คอลัมน์ แหล่งภาพ | ซ้อนภาพ | เสียง
  // ค่าเก็บในเครื่อง (ตัวแปร CSS บน <html>) · ดับเบิลคลิก = ค่าเริ่มต้น · โฟกัสแล้วกดลูกศรได้ · จอแคบ/มือถือใช้เลย์เอาต์อัตโนมัติ
  const layoutSize = {
    v: store.get('layoutSize', {}) || {},
    root: document.documentElement,
    apply() {
      const v = this.v, r = this.root.style;
      if (v.mon) r.setProperty('--mon-vh', `${v.mon}vh`); else r.removeProperty('--mon-vh');
      if (v.b && v.c) { r.setProperty('--ws-b', `${v.b}px`); r.setProperty('--ws-c', `${v.c}px`); } else { r.removeProperty('--ws-b'); r.removeProperty('--ws-c'); }
      requestAnimationFrame(() => this.place());
    },
    save() { store.set('layoutSize', this.v); this.apply(); },
    // จอภาพสูงสุดเท่าที่คอลัมน์กว้างพอ (สูงกว่านั้นไม่มีผล)
    monMax() {
      const col = $('.monitor-panel.pvw .monitor-wrap');
      return col ? clamp((col.clientWidth - 20) * 9 / 16 / innerHeight * 100, 20, 75) : 60;
    },
    monNow() { const m = $('.monitor-panel.pvw .monitor'); return m ? m.getBoundingClientRect().height / innerHeight * 100 : 42; },
    // ย่อได้จนแผงเปลี่ยนภาพ (กลาง) ยังแสดงครบไม่ต้องเลื่อน
    setMon(vh) {
      this.v.mon = clamp(vh, 15, this.monMax());
      this.apply();
      const d = $('.stage > .deck');
      for (let i = 0; i < 3 && d && d.scrollHeight > d.clientHeight + 1; i++) { this.v.mon += (d.scrollHeight - d.clientHeight) / innerHeight * 100; this.apply(); }
      this.v.mon = Math.round(this.v.mon * 10) / 10;
      this.save();
    },
    cols() {
      const ws = $('.workspace'), p = [$('.inputs-panel'), $('.overlays-panel'), $('.audio-panel')];
      return { ws, p, b: p[1].getBoundingClientRect().width, c: p[2].getBoundingClientRect().width, w: ws.clientWidth };
    },
    setCols(b, c) {
      const { w } = this.cols(), minA = 380, gaps = 16;
      c = clamp(c, 240, w - gaps - minA - 220);
      b = clamp(b, 220, w - gaps - minA - c);
      this.v.b = Math.round(b); this.v.c = Math.round(c); this.save();
    },
    place() {
      const { ws, p } = this.cols();
      $$('.split-v', ws).forEach((h, i) => { h.style.left = `${p[i + 1].offsetLeft - 4}px`; });
    },
    drag(el, onMove) {
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('is-drag'); this.root.classList.add('is-resizing');
        const start = onMove(null, e);
        const move = ev => onMove(start, ev);
        const up = () => { el.classList.remove('is-drag'); this.root.classList.remove('is-resizing'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
    },
    init() {
      const ws = $('.workspace'), hs = $('#split-stage');
      if (!ws || !hs) return;
      for (let i = 0; i < 2; i++) {
        const h = document.createElement('div');
        h.className = 'split split-v';
        h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', 'vertical'); h.tabIndex = 0;
        h.title = i ? 'ลากเพื่อปรับความกว้าง ซ้อนภาพ / เสียง ↔ · ดับเบิลคลิก = ค่าเริ่มต้น' : 'ลากเพื่อปรับความกว้าง แหล่งภาพ / ซ้อนภาพ ↔ · ดับเบิลคลิก = ค่าเริ่มต้น';
        ws.appendChild(h);
        this.drag(h, (st, e) => {
          if (!st) { const c = this.cols(); return { x: e.clientX, b: c.b, c: c.c }; }
          const dx = e.clientX - st.x;
          if (i === 0) this.setCols(st.b - dx, st.c); else this.setCols(st.b + dx, st.c - dx);
        });
        h.addEventListener('dblclick', () => { delete this.v.b; delete this.v.c; this.save(); });
        h.addEventListener('keydown', e => {
          const d = { ArrowLeft: -20, ArrowRight: 20 }[e.key];
          if (!d) return;
          e.preventDefault(); e.stopPropagation();
          const c = this.cols();
          if (i === 0) this.setCols(c.b - d, c.c); else this.setCols(c.b + d, c.c - d);
        });
      }
      this.drag(hs, (st, e) => {
        if (!st) return { y: e.clientY, mon: this.monNow() };
        this.setMon(st.mon + (e.clientY - st.y) / innerHeight * 100);
      });
      hs.addEventListener('dblclick', () => { delete this.v.mon; this.save(); });
      hs.addEventListener('keydown', e => {
        const d = { ArrowUp: -2, ArrowDown: 2 }[e.key];
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        this.setMon(this.monNow() + d);
      });
      new ResizeObserver(() => this.place()).observe(ws);
      this.apply();
    },
    reset() { this.v = {}; this.save(); }
  };

  /* ------------------------------------------------------ transport (timeline ใต้จอ Preview / Program) */
  // แบบสตูดิโอ: เล่น/หยุด · เริ่มใหม่ · วนซ้ำ · แถบเลื่อนตำแหน่ง · เวลาที่เล่นไป / ความยาว · เวลาที่เหลือ (เหลือง ≤15 วิ · แดงกะพริบ ≤5 วิ)
  // ใช้กับคลิปวิดีโอ · Playlist · รีเพลย์ · สไลด์ (หน้า) — แหล่งอื่นแสดงชนิดแหล่งภาพ (LIVE) เฉย ๆ
  // ไทม์โค้ด HH:MM:SS:FF ตามเฟรมเรตของรายการ (แบบ vMix)
  const fmtTc = s => {
    if (!isFinite(s) || s < 0) s = 0;
    const fps = Math.round(+settings.fps || 30), t = Math.floor(s), fr = Math.min(fps - 1, Math.floor((s - t) * fps));
    return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor(t / 60) % 60)}:${pad2(t % 60)}:${pad2(fr)}`;
  };
  function clipOf(inp) {
    if (!inp) return null;
    const v = inp.el;
    const isVid = v && v.tagName === 'VIDEO';
    if (inp.type === 'media' && isVid && !inp.missing) return { el: v, loop: v.loop, marks: true };
    if (inp.type === 'playlist' && inp.list.items.length) return { el: inp.showImg ? null : v, loop: inp.list.loop, pl: true, pos: `${inp.list.index + 1}/${inp.list.items.length}`, playing: inp.list.playing };
    if (inp.type === 'replay' && isVid && v.getAttribute('src')) return { el: v, replay: true };
    if (inp.type === 'slides' && inp.slides.count) return { slides: true, pos: `${inp.slides.page}/${inp.slides.count}` };
    return null;
  }
  // Mark In / Mark Out ของคลิปวิดีโอ: เล่นเฉพาะช่วง In–Out (วนซ้ำ = กลับไป In) · ไม่ตั้ง = ทั้งคลิป
  const markIn = inp => inp && inp.mark && inp.mark.in != null ? inp.mark.in : 0;
  const markOut = (inp, dur) => inp && inp.mark && inp.mark.out != null && inp.mark.out < dur ? inp.mark.out : dur;
  function sanitizeMark(m) {
    if (!m || typeof m !== 'object') return null;
    const n = x => x != null && x !== '' && Number.isFinite(+x) && +x >= 0 ? Math.round(+x * 1000) / 1000 : null;
    const o = { in: n(m.in), out: n(m.out) };
    if (o.in != null && o.out != null && o.out <= o.in) o.out = null;
    return o.in == null && o.out == null ? null : o;
  }
  function clipRestart(inp) {
    const v = inp.el;
    v.currentTime = inp.type === 'media' ? markIn(inp) : 0;
    v.play().catch(() => {});
  }
  // เล่นต่อจากตำแหน่งเดิม — ถ้าอยู่ที่ Out แล้ว (หรือก่อน In) เริ่มจาก In
  function clipPlayToggle(inp) {
    const v = inp.el;
    if (!v.paused) { v.pause(); return; }
    if (inp.type === 'media' && inp.mark && isFinite(v.duration) && (v.currentTime >= markOut(inp, v.duration) - 0.05 || v.currentTime < markIn(inp) - 0.05)) v.currentTime = markIn(inp);
    v.play().catch(() => {});
  }
  // ทุกเฟรม: ถึง Out → วนกลับไป In หรือหยุดที่ Out
  function enforceMarks() {
    for (const inp of inputs) {
      if (inp.type !== 'media' || !inp.mark || !inp.el || inp.el.tagName !== 'VIDEO') continue;
      const v = inp.el, d = v.duration, t = v.currentTime;
      if (isFinite(d) && !v.paused) {
        const a = markIn(inp), b = markOut(inp, d);
        if (t >= b - 0.02) { if (v.loop) v.currentTime = a; else { v.pause(); v.currentTime = b; } }
        // เบราว์เซอร์วนกลับไปที่ 0 เอง (Out = ท้ายคลิป) → ไปที่ In
        else if (v.loop && t < a && inp.lastT != null && inp.lastT >= d - 0.6 && t + 0.5 < inp.lastT) v.currentTime = a;
      }
      inp.lastT = v.currentTime;
    }
  }
  // เวลาที่เหลือของคลิปบนจอ (วินาที) ถึงจุด Out — null ถ้าไม่ใช่คลิป
  function clipRemaining(inp) {
    const c = clipOf(inp);
    if (!c || !c.el || !isFinite(c.el.duration) || c.loop) return null;
    const end = c.marks ? markOut(inp, c.el.duration) : c.el.duration;
    return Math.max(0, (end - c.el.currentTime) / (c.el.playbackRate || 1));
  }
  const transport = {
    sig: { pvw: '', pgm: '' },
    bar(bus) { return $(`#${bus}-transport`); },
    update() {
      for (const bus of ['pvw', 'pgm']) {
        const box = this.bar(bus);
        if (!box) continue;
        const inp = byId(bus === 'pgm' ? state.programId : state.previewId);
        const c = clipOf(inp);
        const sig = `${inp?.id}|${c ? Object.keys(c).filter(k => c[k] === true).join() : '-'}`;
        if (sig !== this.sig[bus]) { this.sig[bus] = sig; this.build(box, inp, c); }
        box.classList.toggle('has-clip', !!c);
        if (!c) continue;
        if (c.slides || c.pl) $('.tp-pos', box).textContent = c.pos;
        const btn = $('[data-tp=play]', box);
        const el = c.el;
        const playing = c.pl ? c.playing : el ? !el.paused : false;
        if (btn) { btn.innerHTML = icon(playing ? 'pause' : 'play'); btn.classList.toggle('is-on', playing); }
        $('[data-tp=loop]', box)?.classList.toggle('is-on', !!c.loop);
        if (c.slides) continue;
        const dur = el && isFinite(el.duration) ? el.duration : 0, t = el ? el.currentTime : 0;
        if (!box.dataset.drag) this.pos(box, dur ? t / dur : 0);
        const marked = !!(c.marks && inp.mark && dur);
        const a = marked ? markIn(inp) : 0, z = marked ? markOut(inp, dur) : dur;
        if (c.marks) {
          const pct = x => `${clamp(x / (dur || 1), 0, 1) * 100}%`;
          const mi = $('.tp-in', box), mo = $('.tp-out', box), rg = $('.tp-range', box);
          mi.hidden = !(marked && inp.mark.in != null); mi.style.left = pct(a); mi.title = `IN ${fmtTc(a)}`;
          mo.hidden = !(marked && inp.mark.out != null && inp.mark.out < dur); mo.style.left = pct(z); mo.title = `OUT ${fmtTc(z)}`;
          rg.hidden = !marked; rg.style.left = pct(a); rg.style.width = pct(z - a);
          $('[data-tp=in]', box).classList.toggle('is-on', !mi.hidden);
          $('[data-tp=out]', box).classList.toggle('is-on', !mo.hidden);
          $('[data-tp=clear]', box).hidden = !marked;
        }
        $('.tp-cur', box).textContent = fmtTc(t);
        const durEl = $('.tp-dur', box);
        durEl.textContent = dur ? fmtTc(z - a) : '--:--:--:--';
        durEl.classList.toggle('marked', marked);
        durEl.parentElement.classList.toggle('marked', marked);
        durEl.title = marked ? `ช่วง In–Out (IN ${fmtTc(a)} · OUT ${fmtTc(z)})` : 'ความยาวคลิป';
        const rem = dur ? Math.max(0, z - t) / (el.playbackRate || 1) : 0;
        const remEl = $('.tp-rem', box);
        remEl.textContent = dur ? `-${fmtTc(rem)}` : '';
        const warn = dur && !c.loop && playing ? (rem <= 5 ? 'crit' : rem <= 15 ? 'warn' : '') : '';
        remEl.dataset.level = warn;
        remEl.parentElement.dataset.level = warn;
        remEl.parentElement.hidden = !dur;
        $('.tp-dur-l', box).textContent = marked ? 'IN–OUT' : 'DURATION';
        box.dataset.level = bus === 'pgm' ? warn : '';
      }
    },
    // แถวบน = แถบเลื่อนเต็มความกว้าง · แถวล่าง = กลุ่มปุ่มเล่น | กลุ่ม Mark In / Out | กล่องเวลา (ตำแหน่ง · ความยาว · เหลือ)
    // หน้าตาตามระบบของแอป: กลุ่มปุ่มแบบ .seg (EFFECT / DURATION) และกล่องเวลาแบบนาฬิกา TIME / ON AIR ด้านบน
    build(box, inp, c) {
      const b = (k, ic, title, cls = '') => `<button type="button" class="tp-btn ${cls}" data-tp="${k}" title="${title}">${ic}</button>`;
      const tc = (label, cls, title) => `<div class="tp-tc ${cls}-w" title="${title}"><span class="tc-label">${label}</span><span class="${cls} tc-value">--:--:--:--</span></div>`;
      box.classList.toggle('tp-2row', !!c && !c.slides);
      if (!c) {
        box.innerHTML = `<div class="tp-ctl"><span class="tp-src">${inp ? esc((TYPE_META[inp.type]?.label || inp.type || '').toUpperCase()) : '—'}</span><span class="tp-live">${inp && inp.status === 'live' ? 'LIVE' : ''}</span></div>`;
        return;
      }
      if (c.slides) {
        box.innerHTML = `<div class="tp-ctl"><div class="tp-grp">${b('prev', icon('skip-back'), 'หน้าก่อนหน้า')}${b('next', icon('skip-fwd'), 'หน้าถัดไป')}</div><span class="tp-src">SLIDES</span><div class="tp-tc"><span class="tc-label">PAGE</span><span class="tp-pos tc-value"></span></div></div>`;
        return;
      }
      box.innerHTML = `<div class="tp-seek"><div class="tp-track" role="slider" aria-label="ตำแหน่งในคลิป" tabindex="0"><div class="tp-range" hidden></div><div class="tp-fill"></div><i class="tp-mk tp-in" hidden></i><i class="tp-mk tp-out" hidden></i><div class="tp-head"></div></div></div>
        <div class="tp-ctl"><div class="tp-grp">`
        + b('restart', '<svg class="i" viewBox="0 0 24 24"><path d="M6 5v14"/><path d="M19 5 9 12l10 7z" fill="currentColor"/></svg>', 'เริ่มใหม่ (ไปที่ In)')
        + b('play', icon('play'), 'เล่น / หยุดชั่วคราว', 'tp-play')
        + (c.pl ? b('prev', icon('skip-back'), 'รายการก่อนหน้า') + b('next', icon('skip-fwd'), 'รายการถัดไป') : '')
        + (c.replay ? '' : b('loop', icon('repeat'), 'เล่นวนซ้ำ (Loop)'))
        + '</div>'
        + (c.marks ? '<div class="tp-grp tp-marks">' + b('in', 'IN', 'Mark In — ตั้งจุดเริ่มที่ตำแหน่งนี้ (คลิกแถบแล้วกด I)', 'tp-txt') + b('out', 'OUT', 'Mark Out — ตั้งจุดจบที่ตำแหน่งนี้ (คลิกแถบแล้วกด O)', 'tp-txt') + b('clear', icon('x'), 'ล้าง In / Out') + '</div>' : '')
        + (c.pl ? '<div class="tp-tc"><span class="tc-label">ITEM</span><span class="tp-pos tc-value"></span></div>' : '')
        + '<div class="tp-tcs">'
        + tc('POSITION', 'tp-cur', 'ตำแหน่ง (ชั่วโมง:นาที:วินาที:เฟรม)')
        + tc('<span class="tp-dur-l">DURATION</span>', 'tp-dur', 'ความยาวคลิป')
        + tc('REMAIN', 'tp-rem', 'เวลาที่เหลือ')
        + '</div></div>';
    },
    act(bus, k) {
      const inp = byId(bus === 'pgm' ? state.programId : state.previewId);
      const c = clipOf(inp);
      if (!c) return;
      if (c.slides) { slideGo(inp, inp.slides.page + (k === 'next' ? 1 : -1)); return; }
      if (c.pl) {
        if (k === 'prev' || k === 'next') playlist.go(inp, inp.list.index + (k === 'next' ? 1 : -1), true);
        else if (k === 'play') playlist.setPlaying(inp, !inp.list.playing);
        else if (k === 'loop') { inp.list.loop = !inp.list.loop; renderInputs(); }
        else if (k === 'restart' && c.el) { c.el.currentTime = 0; if (inp.list.playing) c.el.play().catch(() => {}); }
      } else {
        const el = c.el;
        if (k === 'play') clipPlayToggle(inp);
        else if (k === 'restart') clipRestart(inp);
        else if (k === 'loop') el.loop = !el.loop;
        else if ((k === 'in' || k === 'out') && c.marks && isFinite(el.duration)) {
          const t = el.currentTime, m = { ...(inp.mark || {}) };
          if (k === 'in') { m.in = t < 0.05 ? null : t; if (m.out != null && m.out <= t) m.out = null; }
          else { m.out = t > el.duration - 0.05 ? null : t; if (m.in != null && m.in >= t) m.in = null; }
          inp.mark = sanitizeMark(m);
        } else if (k === 'clear') inp.mark = null;
        if (inp.type === 'media') { updateMediaButtons(inp); if (k === 'loop') renderInputs(); }
      }
      this.update();
    },
    // playhead (หัวเหลี่ยม + เส้น) และแถบที่เล่นไปแล้ว
    pos(box, f) {
      f = clamp(f, 0, 1) * 100;
      $('.tp-fill', box).style.width = `${f}%`;
      const h = $('.tp-head', box); if (h) h.style.left = `${f}%`;
    },
    seek(bus, frac) {
      const c = clipOf(byId(bus === 'pgm' ? state.programId : state.previewId));
      if (c && c.el && isFinite(c.el.duration)) c.el.currentTime = clamp(frac, 0, 1) * c.el.duration;
    },
    init() {
      for (const bus of ['pvw', 'pgm']) {
        const box = this.bar(bus);
        if (!box) continue;
        box.addEventListener('click', e => { const t = e.target.closest('[data-tp]'); if (t) { t.blur(); this.act(bus, t.dataset.tp); } });
        box.addEventListener('pointerdown', e => {
          const tr = e.target.closest('.tp-track');
          if (!tr) return;
          e.preventDefault();
          tr.setPointerCapture(e.pointerId);
          const at = ev => { const r = tr.getBoundingClientRect(); const f = clamp((ev.clientX - r.left) / r.width, 0, 1); this.pos(box, f); this.seek(bus, f); };
          box.dataset.drag = '1';
          at(e);
          const move = ev => at(ev);
          const up = () => { delete box.dataset.drag; tr.removeEventListener('pointermove', move); tr.removeEventListener('pointerup', up); tr.removeEventListener('pointercancel', up); };
          tr.addEventListener('pointermove', move); tr.addEventListener('pointerup', up); tr.addEventListener('pointercancel', up);
        });
        box.addEventListener('keydown', e => {
          if (!e.target.closest('.tp-track')) return;
          const mk = { i: 'in', o: 'out' }[e.key.toLowerCase()];
          if (mk) { e.preventDefault(); e.stopPropagation(); this.act(bus, mk); return; }
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault(); e.stopPropagation();
          const c = clipOf(byId(bus === 'pgm' ? state.programId : state.previewId));
          if (c && c.el) c.el.currentTime = clamp(c.el.currentTime + (e.key === 'ArrowRight' ? 5 : -5), 0, c.el.duration || 0);
        });
      }
    }
  };

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
    if (raw.color) made.color = sanitizeColor(raw.color);
    if (raw.bg) made.bg = sanitizeBg(raw.bg);
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
    if (inp.cgBus) { inp.cgBus.postMessage({ protocolVersion: 1, channel: inp.cg.channel, type: 'disconnect', message: 'แหล่งภาพ CG Studio ถูกนำออกจาก WebMix' }); inp.cgBus.close(); inp.cgBus = null; }
    inp.stream && inp.stream.getTracks().forEach(t => t.stop());
    if (inp.type === 'captions') captionStop(inp);
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
    if (forget && (inp.type === 'media' || inp.type === 'image' || inp.type === 'slides')) mediaStore.del(inp.id);
    if (inp.type === 'slides' && inp.pdf) { try { inp.pdf.destroy(); } catch (e) {} inp.pdf = null; }
    if (inp.type === 'playlist') playlist.dispose(inp, forget);
    if (inp.type === 'replay') replayStop(inp);
    bgStop(inp);
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
    if (inp.type === 'scene') return openSceneDialog(inp);
    if (inp.type === 'replay') return openReplayDialog(inp);
    if (inp.type === 'slides') return openSlidesDialog(inp);
    if (inp.type === 'visualizer') return openVizDialog(inp);
    if (inp.type === 'chat') return openChatInputDialog(inp);
    if (inp.type === 'captions') return openCaptionsDialog(inp);
    if (inp.type === 'srt' && inp.srt.mode === 'rtsp') return openRtspDialog(inp);
    if (inp.type === 'srt' && inp.srt.mode === 'rtmp') return showRtmpSenderInfo(inp);
    if (inp.type === 'srt' && (inp.srt.mode === 'ndi' || inp.srt.mode === 'omt')) return openNetVideoDialog(inp.srt.mode, inp);
    if (inp.type === 'title') return openTitleDialog(inp);
    if (inp.type === 'timer') return openTimerDialog(inp);
    if (inp.type === 'score') return openScoreDialog(inp);
    if (inp.type === 'ticker') return openTickerDialog(inp);
    if (inp.type === 'cg') return openCGStudio(inp);
    const hasText = inp.type === 'slate' || inp.type === 'clock';
    const hasColor = COLOR_TYPES.includes(inp.type);
    const before = inp.color ? { ...inp.color } : null;
    const cc = { ...NEUTRAL_COLOR, ...(inp.color || {}) };
    const hasBg = BG_TYPES.includes(inp.type);
    const bgBefore = sanitizeBg(inp.bg);
    const bgSources = inputs.filter(x => x.id !== inp.id && (x.type === 'image' || x.type === 'media'));
    const bgError = inp.bgState?.error || '';
    const slider = (k, label, min, max, step, fmt) => `
      <label class="field cc-row"><span>${label} <b class="mono" data-cc-val="${k}">${fmt(cc[k])}</b></span>
        <input class="range" type="range" data-cc="${k}" min="${min}" max="${max}" step="${step}" value="${cc[k]}"></label>`;
    const pct = v => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`, temp = v => (v > 0 ? 'อุ่น +' : v < 0 ? 'เย็น ' : '') + Math.round(v * 100);
    const result = await dialog({
      title: 'แก้ไขแหล่งภาพ',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        ${hasText ? `<label class="field"><span>${inp.type === 'slate' ? 'ข้อความบนจอ' : 'หัวข้อเหนือนาฬิกา'}</span><input name="text" class="input" maxlength="80" value="${esc(inp.text)}"></label>` : ''}
        ${hasColor ? `<div class="help"><h3>ปรับสีภาพ <small class="muted">(เห็นผลทันที — ให้กล้องหลายตัวสีตรงกัน)</small></h3></div>
          ${slider('b', 'ความสว่าง', 0.3, 2, 0.01, pct)}${slider('c', 'คอนทราสต์', 0.3, 2, 0.01, pct)}
          ${slider('s', 'ความอิ่มสี', 0, 2.5, 0.01, pct)}${slider('t', 'อุณหภูมิสี', -1, 1, 0.01, temp)}
          <button type="button" class="btn btn-sm cc-reset">คืนค่าสีเดิม</button>` : ''}
        ${hasBg ? `<div class="help"><h3>พื้นหลังด้วย AI <small class="muted">(ไม่ต้องใช้ฉากเขียว — ตัดคนออกจากพื้นหลัง)</small></h3></div>
          <label class="field"><span>พื้นหลัง</span><select name="bgmode" class="select">${Object.entries(BG_MODES).map(([k, v]) => `<option value="${k}" ${k === bgBefore.mode ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field bg-img" ${bgBefore.mode === 'image' ? '' : 'hidden'}><span>ภาพพื้นหลัง (แหล่งภาพนิ่งหรือวิดีโอ)</span><select name="bgimg" class="select">${bgSources.length ? bgSources.map(x => `<option value="${x.id}" ${x.id === bgBefore.imageId ? 'selected' : ''}>${esc(x.name)}</option>`).join('') : '<option value="">— เพิ่มภาพนิ่ง/วิดีโอก่อน —</option>'}</select></label>
          <button type="button" class="btn btn-sm bg-more">ปรับละเอียด (ก่อน/หลัง · ขอบ · ความไว · ประสิทธิภาพ)…</button>
          <p class="note bg-note">ทำงานในเครื่อง (ภาพไม่ถูกส่งออกไปไหน) · ครั้งแรกต้องต่อเน็ตเพื่อโหลดโมเดล AI · เหมาะกับคนนั่ง/ยืนหน้ากล้อง ใช้ CPU/GPU เพิ่มต่อกล้อง${bgError ? `<br><b>${esc(bgError)}</b>` : ''}</p>` : ''}`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        if (hasBg) {
          const f = $('form', modal);
          const apply = () => {
            $('.bg-img', modal).hidden = f.bgmode.value !== 'image';
            inp.bg = sanitizeBg({ mode: f.bgmode.value, imageId: f.bgimg.value });
          };
          f.bgmode.addEventListener('change', apply);
          f.bgimg.addEventListener('change', apply);
          // หน้าต่างเต็ม: บันทึกชื่อ/สีที่แก้ไว้ก่อน แล้วเปิดหน้า AI
          $('.bg-more', modal).addEventListener('click', () => { apply(); modal.closest('.modal-backdrop').querySelector('.modal-foot .btn-primary').click(); setTimeout(() => openBgDialog(inp), 0); });
        }
        if (!hasColor) return;
        const fmt = { b: pct, c: pct, s: pct, t: temp };
        const apply = () => {
          $$('[data-cc]', modal).forEach(r => { cc[r.dataset.cc] = +r.value; $(`[data-cc-val="${r.dataset.cc}"]`, modal).textContent = fmt[r.dataset.cc](+r.value); });
          inp.color = sanitizeColor(cc);
        };
        modal.addEventListener('input', e => { if (e.target.dataset.cc) apply(); });
        // ดับเบิลคลิกแถบเลื่อน = ค่าเดิม
        modal.addEventListener('dblclick', e => { const k = e.target.dataset.cc; if (k) { e.target.value = NEUTRAL_COLOR[k]; apply(); } });
        $('.cc-reset', modal).addEventListener('click', () => { $$('[data-cc]', modal).forEach(r => { r.value = NEUTRAL_COLOR[r.dataset.cc]; }); apply(); });
      }
    });
    if (result?.value !== 'save') { inp.color = before; if (hasBg) inp.bg = bgBefore.mode === 'none' ? null : bgBefore; return; }
    if (hasBg && inp.bg && inp.bg.mode === 'none') inp.bg = null;
    if (hasBg && inp.bg) inp.bg = sanitizeBg({ ...bgBefore, ...inp.bg });
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
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
          const r = await permissionGuide(kind);
          if (r === 'retry') return listDevices(kind);
          const q = new Error('permission'); q.quiet = true;
          throw q;
        }
        throw new Error('ไม่ได้รับอนุญาตให้ใช้อุปกรณ์ (' + e.message + ')');
      }
      list = await navigator.mediaDevices.enumerateDevices();
    }
    return list;
  }

  // เบราว์เซอร์/ระบบบล็อกกล้องหรือไมค์ → บอกวิธีเปิดสิทธิ์ทีละขั้น แล้วให้ลองอีกครั้งหรือใช้แหล่งภาพอื่น
  async function permissionGuide(kind) {
    const what = kind === 'audioinput' ? 'ไมค์' : 'กล้องและไมค์';
    const mac = /Mac/.test(navigator.platform || navigator.userAgent);
    const r = await dialog({
      title: `ยังไม่ได้อนุญาตให้ใช้${what}`,
      body: `<div class="perm-guide">
        <div class="perm-head"><span class="perm-ic">!</span><p>เบราว์เซอร์บล็อกไว้ — WebMix จึงยังเห็นภาพและได้ยินเสียงไม่ได้</p></div>
        <ol class="perm-steps">
          <li><b>1</b><span>คลิกไอคอนแม่กุญแจ / ตั้งค่าเว็บไซต์ ทางซ้ายของช่องที่อยู่เว็บ</span></li>
          <li><b>2</b><span>เปลี่ยน “กล้อง” และ “ไมโครโฟน” เป็น <strong>อนุญาต</strong></span></li>
          <li><b>3</b><span>กด “ลองอีกครั้ง” ด้านล่าง</span></li>
        </ol>
        <p class="perm-note">${desktop && mac ? 'แอปเดสก์ท็อปบน macOS: ' : 'ถ้าใช้แอปเดสก์ท็อปบน macOS: '}เปิด การตั้งค่าระบบ → ความเป็นส่วนตัวและความปลอดภัย → กล้อง / ไมโครโฟน แล้วเปิดให้ WebMix Pro</p>
      </div>`,
      actions: [{ label: 'ใช้แหล่งภาพอื่นไปก่อน', value: 'other' }, { label: 'ลองอีกครั้ง', value: 'retry', primary: true }],
      onOpen(modal) { modal.classList.add('perm-modal'); }
    });
    if (r?.value === 'other') setTimeout(() => $('[data-action=add-menu]')?.click(), 0);
    return r?.value || null;
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

  const micConstraints = (id, clean, stereo) => ({ audio: { deviceId: { exact: id }, echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean, ...(stereo ? { channelCount: { ideal: 2 } } : {}) } });
  async function openMicById(micId, label, clean, stereo) {
    const open = id => navigator.mediaDevices.getUserMedia(micConstraints(id, clean, stereo));
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
    try { devices = await listDevices('videoinput'); } catch (e) { if (!e.quiet) toast(e.message, 'error'); return; }
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

  // ไฟล์ที่ลากมาวาง / เลือกจากหน้าว่าง: แยกตามชนิดไฟล์
  function addDroppedFiles(files) {
    const by = re => files.filter(f => re.test(f.type) || re.test(f.name));
    const vids = by(/^video\/|\.(mp4|webm|mov|mkv)$/i), imgs = by(/^image\/|\.(png|jpe?g|gif|webp)$/i), pdfs = by(/pdf$/i);
    if (vids.length) addVideoFiles(vids);
    if (imgs.length) addImageFiles(imgs);
    if (pdfs.length) addSlidesFiles(pdfs);
    if (!vids.length && !imgs.length && !pdfs.length) toast('ไฟล์ชนิดนี้ใช้เป็นแหล่งภาพไม่ได้ — รองรับวิดีโอ รูป และ PDF', 'warn');
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
    if (inp.type === 'slides') return pickFiles('application/pdf,.pdf', files => { if (!inp.removed) loadSlides(inp, files[0], true); });
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
    try { devices = await listDevices('audioinput'); } catch (e) { if (!e.quiet) toast(e.message, 'error'); return; }
    const mics = devices.filter(d => d.kind === 'audioinput');
    if (!mics.length) { toast('ไม่พบไมโครโฟนในเครื่องนี้', 'error'); return; }
    const result = await dialog({
      title: 'เพิ่มไมโครโฟน',
      body: `
        <label class="field"><span>ไมโครโฟน / ออดิโออินเทอร์เฟซ</span><select name="mic" class="select">
          ${mics.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Microphone ' + (i + 1))}</option>`).join('')}
        </select></label>
        <label class="field"><span>ช่องสัญญาณ</span><select name="chan" class="select">
          <option value="all">ทุกช่อง (ปกติ)</option>
          <option value="0">ช่อง 1 / ซ้าย เท่านั้น</option>
          <option value="1">ช่อง 2 / ขวา เท่านั้น</option>
          <option value="split">แยกช่อง 1 และ 2 เป็น 2 ช่องเสียง</option>
        </select></label>
        <label class="check"><input type="checkbox" name="clean"> ลดเสียงสะท้อนและเสียงรบกวน (เหมาะกับไมค์โน้ตบุ๊ก/มือถือ)</label>
        <p class="note">ออดิโออินเทอร์เฟซที่เสียบไมค์ 2 ตัว (เช่น Focusrite 2i2, Behringer UMC) เลือก “แยกช่อง” แล้วปรับเสียงแต่ละไมค์ได้อิสระ ·
          ไมค์มืออาชีพหรือมิกเซอร์ภายนอก แนะนำให้ปิดการลดเสียงรบกวนเพื่อคุณภาพเสียงที่ดีที่สุด (เลือกช่องแล้วจะปิดให้อัตโนมัติ)</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'เพิ่มไมค์', primary: true, value: 'add' }]
    });
    if (result?.value !== 'add') return;
    const f = result.form, pick = f.chan.value, split = pick !== 'all';
    // แยกช่องต้องได้เสียงสเตอริโอดิบ — การลดเสียงรบกวนของเบราว์เซอร์รวมเป็นโมโน
    const clean = f.clean.checked && !split;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints(f.mic.value, clean, split));
      const label = f.mic.options[f.mic.selectedIndex].text.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
      const base = { micId: f.mic.value, micLabel: f.mic.options[f.mic.selectedIndex].text, clean };
      const chans = pick === 'split' ? [0, 1] : pick === 'all' ? [null] : [+pick];
      for (const c of chans) audio.addMic(stream, (c == null ? label : `${label.slice(0, 19).trimEnd()} CH${c + 1}`).slice(0, 24), { ...base, micChan: c });
      const got = stream.getAudioTracks()[0]?.getSettings().channelCount;
      if (split && got === 1 && chans.includes(1)) toast(`“${label}” ส่งเสียงมาช่องเดียว (โมโน) — ช่อง 2 จะไม่มีเสียง`, 'warn', 7000);
      else toast(`เพิ่ม “${label}” แล้ว`, 'success');
    } catch (e) {
      toast('เปิดไมค์ไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  /* ------------------------------------------------------ live captions */
  // คำบรรยายสด: ระบบรู้จำเสียงของเบราว์เซอร์ (Web Speech API — Chrome / Edge / Safari ส่งเสียงไปประมวลผลบนเซิร์ฟเวอร์ของผู้ผลิตเบราว์เซอร์)
  // ฟังจากไมค์หลักของเครื่อง หรือช่องเสียงในมิกเซอร์ (เบราว์เซอร์รุ่นใหม่รับ MediaStreamTrack ได้ — รุ่นเก่าใช้ไมค์หลักแทน)
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CAP_LANGS = { 'th-TH': 'ไทย', 'en-US': 'English (US)', 'en-GB': 'English (UK)', 'zh-CN': '中文', 'ja-JP': '日本語', 'ko-KR': '한국어', 'lo-LA': 'ລາວ', 'my-MM': 'မြန်မာ', 'vi-VN': 'Tiếng Việt' };
  const CAP_SIZES = { s: ['เล็ก', 28], m: ['กลาง', 36], l: ['ใหญ่', 46] };
  const CAP_POS = { bottom: 'ล่างจอ', top: 'บนจอ' };
  function sanitizeCap(c) {
    c = c || {};
    return { lang: CAP_LANGS[c.lang] ? c.lang : 'th-TH', source: typeof c.source === 'string' && c.source ? c.source.slice(0, 80) : 'mic', size: CAP_SIZES[c.size] ? c.size : 'm',
      pos: CAP_POS[c.pos] ? c.pos : 'bottom', lines: clamp(+c.lines || 2, 1, 3), clearSec: clamp(+c.clearSec || 5, 2, 30) };
  }
  function addCaptionsInput() {
    const n = inputs.filter(i => i.type === 'captions').length + 1;
    const inp = addInput({ type: 'captions', name: n > 1 ? `CAPTIONS ${n}` : 'CAPTIONS', cap: sanitizeCap({}) });
    openCaptionsDialog(inp, true);
    return inp;
  }
  // เสียงจากมิกเซอร์ → MediaStreamTrack ให้ตัวรู้จำเสียง (Master = เสียงรวมที่ออกอากาศ)
  function captionTrack(inp) {
    const src = inp.cap.source;
    if (src === 'mic' || !audio.ensure()) return null;
    const r = inp.capRun;
    if (!r.dest) r.dest = audio.ctx.createMediaStreamDestination();
    const node = src === 'master' ? audio.post : chanByKey(src)?.afvGain;
    if (!node) return null;
    try { node.connect(r.dest); } catch (e) { return null; }
    r.tapped = node;
    return r.dest.stream.getAudioTracks()[0] || null;
  }
  function captionStart(inp) {
    if (!SpeechRec) {
      toast('เบราว์เซอร์/แอปนี้ไม่มีระบบแปลงเสียงเป็นข้อความ — ใช้หน้าเว็บ WebMix ใน Chrome, Edge หรือ Safari', 'error', 8000);
      return;
    }
    const r = inp.capRun || (inp.capRun = { lines: [], interim: '', lastAt: 0, log: [] });
    if (r.on) return;
    r.on = true; r.error = ''; r.fails = 0;
    const go = () => {
      if (!r.on || inp.removed) return;
      const rec = new SpeechRec();
      rec.lang = inp.cap.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = String(e.results[i][0].transcript || '').trim();
          if (!t) continue;
          if (e.results[i].isFinal) { r.lines.push(t); r.log.push({ text: t, at: Date.now() }); if (r.lines.length > 20) r.lines.shift(); }
          else interim += (interim ? ' ' : '') + t;
        }
        r.interim = interim;
        r.lastAt = performance.now();
        r.fails = 0;
      };
      rec.onerror = e => {
        const fatal = { 'not-allowed': 'ไม่ได้รับอนุญาตให้ใช้ไมค์', 'service-not-allowed': 'เบราว์เซอร์/แอปนี้ไม่อนุญาตบริการแปลงเสียง — ใช้หน้าเว็บใน Chrome / Edge', 'language-not-supported': 'ไม่รองรับภาษานี้', 'audio-capture': 'เปิดไมค์ไม่ได้' }[e.error];
        if (fatal) { r.on = false; r.error = fatal; toast(`คำบรรยายสด: ${fatal}`, 'error', 7000); renderInputs(); }
        else if (e.error === 'network') r.error = 'ต่อบริการแปลงเสียงไม่ได้ (ต้องต่ออินเทอร์เน็ต) — กำลังลองใหม่';
      };
      // Chrome หยุดฟังเองเมื่อเงียบนาน/ครบเวลา — เริ่มใหม่ทันทีระหว่างที่ยังเปิดอยู่ (ล้มติดกันหลายครั้ง = รอนานขึ้น)
      rec.onend = () => { if (r.rec === rec && r.on) setTimeout(go, Math.min(5000, 250 * 2 ** (r.fails++))); };
      r.rec = rec;
      const track = captionTrack(inp);
      try { track ? rec.start(track) : rec.start(); }
      catch (err) { try { rec.start(); } catch (err2) { r.on = false; r.error = err2.message; toast(`คำบรรยายสด: ${err2.message}`, 'error'); } }
    };
    go();
  }
  function captionStop(inp) {
    const r = inp.capRun;
    if (!r) return;
    r.on = false;
    try { r.rec?.stop(); } catch (e) {}
    try { r.tapped?.disconnect(r.dest); } catch (e) {}
    r.tapped = null;
    r.interim = '';
  }
  // ข้อความที่ขึ้นจอ: ประโยคล่าสุด + ส่วนที่กำลังพูด — เงียบเกินเวลาที่ตั้งแล้วหายไป
  function captionText(inp) {
    const r = inp.capRun;
    if (!r || (!r.lines.length && !r.interim)) return '';
    if (performance.now() - r.lastAt > inp.cap.clearSec * 1000) return '';
    return [...r.lines.slice(-3), r.interim].filter(Boolean).join(' ');
  }
  function drawCaptions(ctx, w, h, inp) {
    const text = captionText(inp);
    if (!text) return;
    const c = inp.cap, s = h / 720, size = CAP_SIZES[c.size][1] * s, lineH = size * 1.32;
    ctx.save();
    ctx.font = `600 ${size}px ${FONT}`;
    const maxW = w * 0.84;
    // ตัดบรรทัดทั้งหมด แล้วแสดงเฉพาะบรรทัดท้าย ๆ (ข้อความใหม่อยู่ล่างสุด)
    const all = chatLib.wrapLines(ctx, text, maxW - 40 * s, 50);
    const lines = all.slice(-c.lines);
    const boxW = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width)) + 40 * s), boxH = lines.length * lineH + 20 * s;
    const x = (w - boxW) / 2, y = c.pos === 'top' ? h * 0.06 : h * 0.93 - boxH;
    ctx.fillStyle = 'rgba(0,0,0,.78)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 8 * s); else ctx.rect(x, y, boxW, boxH);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, y + 10 * s + lineH * (i + 0.5)));
    ctx.restore();
  }
  // ไฟล์คำบรรยาย .srt (เวลาเทียบกับประโยคแรก) สำหรับใส่ในคลิปที่บันทึกไว้
  function captionSrt(log) {
    if (!log.length) return '';
    const t0 = log[0].at - 2500;
    const ts = ms => { ms = Math.max(0, ms); const hh = Math.floor(ms / 3600000), mm = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60; return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)},${String(ms % 1000).padStart(3, '0')}`; };
    return log.map((e, i) => {
      const start = (i ? log[i - 1].at : t0 + 500) - t0, end = Math.min(e.at - t0 + 2000, log[i + 1] ? log[i + 1].at - t0 : Infinity);
      return `${i + 1}\n${ts(start)} --> ${ts(Math.max(end, start + 800))}\n${e.text}\n`;
    }).join('\n');
  }
  // ปุ่ม “แสดงบน Program / ซ่อนจาก Program” ในหน้าต่างแก้ไข — ใช้ช่อง Overlay ว่าง ไม่ปิดหน้าต่าง
  const onAirLabel = inp => ovl.some(c => c.inputId === inp.id && c.on) ? 'ซ่อนจาก Program' : 'แสดงบน Program';
  function bindOnAirButton(modal, inp) {
    const btn = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'แสดงบน Program' || b.textContent === 'ซ่อนจาก Program');
    if (!btn) return;
    const clone = btn.cloneNode(true);
    btn.replaceWith(clone);
    clone.addEventListener('click', () => {
      const on = ovl.findIndex(c => c.inputId === inp.id && c.on);
      if (on >= 0) setChannel(on, false);
      else {
        const free = ovl.findIndex(o => !o.on && (!o.inputId || o.inputId === inp.id));
        audio.ensure();
        toggleInputOverlay(inp.id, free >= 0 ? free : 0);
      }
      clone.textContent = onAirLabel(inp);
    });
  }

  // คำบรรยายสด: ตัวอย่างบนภาพ Program · ข้อความล่าสุดพร้อมเวลา · ฟังจาก · การแสดงผล · ไฟล์ .srt / .txt
  async function openCaptionsDialog(inp, fresh) {
    const before = { ...inp.cap }, c = inp.cap;
    const chans = audioChanOptions();
    const log = () => inp.capRun?.log || [];
    const t0 = () => log()[0]?.at || Date.now();
    const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const r = await dialog({
      title: 'คำบรรยายสด',
      wide: true,
      body: `<div class="cp-wrap">
        <div class="cp-left">
          ${SpeechRec ? '' : '<p class="note warn">เบราว์เซอร์/แอปนี้ไม่มีระบบแปลงเสียงเป็นข้อความ — เปิดหน้าเว็บ WebMix ใน Chrome, Edge หรือ Safari</p>'}
          <div class="cp-prev"><canvas width="960" height="540" aria-label="ตัวอย่างคำบรรยายบนภาพ Program"></canvas></div>
          <section class="cp-card"><div class="cp-h"><h3>ข้อความล่าสุด</h3><span class="cp-state"></span></div><div class="cp-log"></div></section>
        </div>
        <div class="cp-right">
          <section class="cp-card"><div class="cp-h"><h3>ฟังจาก</h3></div>
            <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
            <div class="cp-two">
              <label class="field"><span>ภาษาที่พูด</span><select name="lang" class="select">${Object.entries(CAP_LANGS).map(([k, l]) => `<option value="${k}" ${k === c.lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="field"><span>แหล่งเสียง</span><select name="source" class="select">
                <option value="mic">ไมค์หลักของเครื่อง</option><option value="master" ${c.source === 'master' ? 'selected' : ''}>Master (เสียงรวมที่ออกอากาศ)</option>
                ${chans.map(([k, n]) => `<option value="${esc(k)}" ${k === c.source ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
            </div></section>
          <section class="cp-card"><div class="cp-h"><h3>การแสดงผล</h3></div>
            <div class="cp-seg" role="radiogroup" aria-label="จำนวนบรรทัด">${[1, 2, 3].map(n => `<label><input type="radio" name="lines" value="${n}" ${n === c.lines ? 'checked' : ''}><span>${n} บรรทัด</span></label>`).join('')}</div>
            <div class="cp-two">
              <label class="field"><span>ขนาดตัวอักษร</span><select name="size" class="select">${Object.entries(CAP_SIZES).map(([k, [l]]) => `<option value="${k}" ${k === c.size ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="field"><span>ตำแหน่ง</span><select name="pos" class="select">${Object.entries(CAP_POS).map(([k, l]) => `<option value="${k}" ${k === c.pos ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            </div>
            <label class="field"><span>หายไปเมื่อเงียบ</span><select name="clearSec" class="select">${[3, 5, 8, 15].map(n => `<option value="${n}" ${n === c.clearSec ? 'selected' : ''}>${n} วินาที</option>`).join('')}</select></label></section>
          <section class="cp-card"><div class="cp-h"><h3>ไฟล์คำบรรยาย</h3><span class="cp-count"></span></div>
            <div class="cp-btns"><button type="button" class="btn btn-sm cap-srt">ดาวน์โหลด .srt</button><button type="button" class="btn btn-sm cap-txt">ดาวน์โหลด .txt</button><button type="button" class="btn btn-sm cap-clear">ล้าง</button></div>
            <p class="note">เก็บทุกประโยคที่ฟังได้ เอาไปใส่คลิปที่บันทึกไว้ได้ · ต้องต่ออินเทอร์เน็ต · ความแม่นยำขึ้นกับไมค์และเสียงรบกวน</p></section>
        </div>
      </div>`,
      actions: [{ label: inp.capRun?.on ? 'หยุดฟัง' : 'เริ่มฟัง', value: 'run' }, { label: onAirLabel(inp), value: 'pgm', danger: true }, { label: 'ยกเลิก' }, { label: fresh ? 'บันทึกแล้วเริ่มฟัง' : 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        modal.classList.add('cp-modal');
        const f = $('form', modal).elements;
        const live = () => sanitizeCap({ lang: f.lang.value, source: f.source.value, size: f.size.value, pos: f.pos.value, lines: f.lines.value, clearSec: f.clearSec.value });
        // เปลี่ยนรูปแบบแล้วเห็นผลทันที (ยกเลิก = คืนค่า)
        modal.addEventListener('change', e => { if (['size', 'pos', 'lines', 'clearSec'].includes(e.target.name)) Object.assign(inp.cap, { size: live().size, pos: live().pos, lines: live().lines, clearSec: live().clearSec }); });
        const pc = $('.cp-prev canvas', modal).getContext('2d');
        let sig = '';
        const tick = () => {
          if (!modal.isConnected) return;
          pc.fillStyle = '#23324a'; pc.fillRect(0, 0, 960, 540);
          try { const src = $('#pgm-canvas'); if (src) pc.drawImage(src, 0, 0, 960, 540); } catch (e) {}
          if (!onOverlay(inp.id) && inp.id !== state.programId) {
            const demo = !inp.capRun?.lines?.length && !inp.capRun?.interim;
            drawCaptions(pc, 960, 540, demo ? { ...inp, capRun: { lines: ['ตัวอย่างคำบรรยายสดบนจอ', 'แสดงตามขนาดและตำแหน่งที่เลือก'], interim: '', lastAt: performance.now() } } : inp);
          }
          const L = log(), run = inp.capRun?.on;
          const now = `${L.length}|${run}|${inp.capRun?.interim || ''}`;
          if (now !== sig) {
            sig = now;
            $('.cp-state', modal).innerHTML = run ? '<span class="cp-on">กำลังฟัง</span>' : '<span class="cp-off">หยุดอยู่</span>';
            $('.cp-count', modal).textContent = L.length ? `${L.length} ประโยค` : '';
            const t = t0();
            $('.cp-log', modal).innerHTML = (L.slice(-6).map(e => `<div><span class="mono">${fmtDuration(e.at - t)}</span> ${esc(e.text)}</div>`).join('')
              + (inp.capRun?.interim ? `<div class="cp-interim">${esc(inp.capRun.interim)}…</div>` : '')) || '<p class="note">กด “เริ่มฟัง” แล้วพูดเพื่อทดลอง</p>';
          }
          setTimeout(tick, 150);
        };
        tick();
        $('.cap-srt', modal).addEventListener('click', () => { if (!log().length) return toast('ยังไม่มีข้อความ', 'warn'); downloadBlob(new Blob([captionSrt(log())], { type: 'text/plain' }), `webmix-captions-${stamp()}.srt`); });
        $('.cap-txt', modal).addEventListener('click', () => { if (!log().length) return toast('ยังไม่มีข้อความ', 'warn'); downloadBlob(new Blob([log().map(e => `[${new Date(e.at).toLocaleTimeString('th-TH')}] ${e.text}`).join('\n')], { type: 'text/plain' }), `webmix-captions-${stamp()}.txt`); });
        $('.cap-clear', modal).addEventListener('click', () => { log().length = 0; sig = ''; });
        bindOnAirButton(modal, inp);
        const rb = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'เริ่มฟัง' || b.textContent === 'หยุดฟัง');
        const rc = rb.cloneNode(true); rb.replaceWith(rc);
        rc.addEventListener('click', () => {
          if (inp.capRun?.on) captionStop(inp);
          else { Object.assign(inp.cap, live()); captionStart(inp); }
          rc.textContent = inp.capRun?.on ? 'หยุดฟัง' : 'เริ่มฟัง';
          renderInputs();
        });
      }
    });
    if (r?.value !== 'save') { inp.cap = before; return; }
    const f = r.form;
    inp.name = String(f.name.value || '').trim().slice(0, 40) || inp.name;
    inp.cap = sanitizeCap({ lang: f.lang.value, source: f.source.value, size: f.size.value, pos: f.pos.value, lines: f.lines.value, clearSec: f.clearSec.value });
    // ภาษา/ช่องเสียงเปลี่ยน → เริ่มฟังใหม่ด้วยค่าใหม่
    const restart = inp.capRun?.on && (before.lang !== inp.cap.lang || before.source !== inp.cap.source);
    if (restart) captionStop(inp);
    if ((fresh && !inp.capRun?.on) || restart) captionStart(inp);
    renderInputs(); refreshSourceSelects();
  }

  /* ------------------------------------------------------ viewer comments */
  // คอมเมนต์จาก YouTube / Twitch / พิมพ์เอง เข้ารายการในแท็บ "คอมเมนต์" — กดคอมเมนต์เพื่อขึ้นจอผ่านแหล่งภาพ COMMENTS
  const chatFeed = { list: [], conns: {}, status: { youtube: ['off', ''], twitch: ['off', ''] }, shown: null, at: 0, hideAt: 0, autoHide: +store.get('chat-autohide', 0) || 0 };
  chatFeed.clean = !!store.get('chat-clean', true);
  const CHAT_AUTOHIDE = [0, 8, 10, 15, 30];
  // กรองคำหยาบ (ไทย / อังกฤษ) — แทนด้วย *** ก่อนเข้ารายการ จึงไม่มีทางขึ้นจอ
  const BAD_WORDS = /(เหี้ย|ควย|เย็ด|สัส|ไอ้สัตว์|อีสัตว์|\bfuck\w*|\bshit\w*|\bbitch\w*|\bcunt\b|\basshole\b)/gi;
  const cleanWords = t => t.replace(BAD_WORDS, '***');
  function chatAnim() {
    if (!chatFeed.shown) return 0;
    const now = performance.now();
    if (chatFeed.hideAt) {
      const a = 1 - (now - chatFeed.hideAt) / 250;
      if (a > 0) return a;
      chatFeed.shown = null; chatFeed.hideAt = 0;
      queueMicrotask(renderChat);
      return 0;
    }
    return Math.min(1, (now - chatFeed.at) / 350);
  }
  function chatAdd(m) {
    if (!m || !m.text && !m.amount || chatFeed.list.some(x => x.id === m.id)) return;
    const text = String(m.text || '').slice(0, 300);
    chatFeed.list.push({ ...m, name: String(m.name || 'ผู้ชม').slice(0, 40), text: chatFeed.clean ? cleanWords(text) : text });
    if (chatFeed.list.length > 300) chatFeed.list.splice(0, chatFeed.list.length - 300);
    renderChatSoon();
  }
  let chatRenderQueued = false;
  function renderChatSoon() {
    if (chatRenderQueued) return;
    chatRenderQueued = true;
    requestAnimationFrame(() => { chatRenderQueued = false; renderChat(); });
    setTimeout(() => { if (chatRenderQueued) { chatRenderQueued = false; renderChat(); } }, 300);
  }
  function chatShow(m) {
    chatFeed.shown = m; chatFeed.at = performance.now(); chatFeed.hideAt = 0;
    ensureChatOnAir();
    renderChat();
  }
  function chatHide() {
    if (chatFeed.shown && !chatFeed.hideAt) { chatFeed.hideAt = performance.now(); renderChat(); }
  }
  // ให้การ์ดคอมเมนต์ขึ้นจอจริง: ยังไม่มีแหล่งภาพ COMMENTS → สร้างให้ · ยังไม่อยู่บน Program/Overlay → ใส่ช่อง Overlay ว่างแล้วเปิด
  function ensureChatOnAir() {
    let inp = inputs.find(i => i.type === 'chat');
    if (!inp) inp = addChatInput(true);
    if (inp.id === state.programId || onOverlay(inp.id)) return;
    let i = ovl.findIndex(c => c.inputId === inp.id);
    if (i < 0) {
      i = ovl.findIndex(c => !c.on && !byId(c.inputId));
      if (i < 0) { toast('ไม่มีช่อง Overlay ว่าง — เลือก COMMENTS ใส่ช่อง Overlay ในแท็บ ซ้อนภาพ', 'warn', 6000); return; }
      ovl[i].inputId = inp.id;
      refreshOverlaySelects();
    }
    setChannel(i, true);
  }
  function chatStatus(platform, st, text) {
    chatFeed.status[platform] = [st, text];
    renderChatConn();
  }
  function chatConnect(cfg) {
    for (const c of Object.values(chatFeed.conns)) c.stop();
    chatFeed.conns = {};
    chatFeed.status = { youtube: ['off', ''], twitch: ['off', ''] };
    const on = platform => ({ message: chatAdd, status: (st, text) => chatStatus(platform, st, text) });
    if (cfg.yt) chatFeed.conns.youtube = chatLib.connectYouTube({ video: cfg.yt, key: cfg.key }, on('youtube'));
    if (cfg.tw) chatFeed.conns.twitch = chatLib.connectTwitch(cfg.tw, on('twitch'));
    renderChatConn();
  }
  function renderChatConn() {
    const box = $('#chat-conn');
    if (!box) return;
    const LABEL = { live: 'เชื่อมต่อแล้ว', connecting: 'กำลังเชื่อมต่อ', error: 'ผิดพลาด' };
    const chips = Object.entries(chatFeed.status).filter(([, [st]]) => st !== 'off')
      .map(([k, [st, text]]) => `<span class="chat-chip is-${st}" title="${esc(text)}"><i style="background:${chatLib.PLATFORMS[k].color}"></i>${chatLib.PLATFORMS[k].label}: ${esc(st === 'error' ? text : LABEL[st])}</span>`).join('');
    box.innerHTML = (chips || '<span class="note">ยังไม่ได้เชื่อมต่อแชต — พิมพ์คอมเมนต์เองด้านล่างได้</span>')
      + '<button type="button" class="btn btn-sm" data-chat="connect">เชื่อมต่อแชต…</button>';
  }
  function renderChat() {
    const list = $('#chat-list');
    if (!list) return;
    const sh = chatFeed.shown && !chatFeed.hideAt ? chatFeed.shown : null;
    $('#chat-now').innerHTML = sh
      ? `<span class="chat-now-txt"><b>บนจอ:</b> ${esc(sh.name)} — ${esc(sh.text)}</span><button type="button" class="btn btn-sm btn-danger" data-chat="hide">ซ่อน</button>`
      : '<span class="note">กดคอมเมนต์เพื่อขึ้นจอ (ขึ้นผ่านแหล่งภาพ COMMENTS บน Overlay)</span>';
    const items = chatFeed.list.slice(-80).reverse();
    list.innerHTML = items.map(m => `<button type="button" class="chat-item ${sh && sh.id === m.id ? 'is-shown' : ''}" data-id="${esc(m.id)}" title="กดเพื่อขึ้นจอ">
        <i style="background:${m.amount ? '#f5a524' : (chatLib.PLATFORMS[m.platform] || chatLib.PLATFORMS.manual).color}"></i>
        <b>${esc(m.name)}</b>${m.amount ? `<em>${esc(m.amount)}</em>` : ''}<span>${esc(m.text)}</span></button>`).join('')
      || '<p class="note">คอมเมนต์ใหม่จะขึ้นที่นี่</p>';
    $('.tab[data-tab="chat"]')?.classList.toggle('is-live', !!sh);
  }
  async function openChatConnectDialog() {
    const src = store.get('chat-src', {}) || {};
    const r = await dialog({
      title: 'เชื่อมต่อแชตสด',
      body: `
        <div class="help"><h3>YouTube Live</h3></div>
        <label class="field"><span>ลิงก์ไลฟ์ (หรือรหัสวิดีโอ)</span><input name="yt" class="input mono" placeholder="https://www.youtube.com/live/xxxxxxxxxxx" value="${esc(src.yt || '')}"></label>
        <label class="field"><span>YouTube Data API key</span><input name="key" class="input mono" type="password" autocomplete="off" placeholder="AIza…" value="${esc(store.get('chat-ytkey', '') || '')}"></label>
        <p class="note">สร้างฟรีที่ Google Cloud Console → เปิดใช้ “YouTube Data API v3” → Credentials → Create API key · key เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่อยู่ในไฟล์โชว์ ·
          โควตาฟรีพอดึงแชตได้ราว 3–4 ชั่วโมงต่อวัน</p>
        <div class="help"><h3>Twitch</h3></div>
        <label class="field"><span>ชื่อช่อง Twitch (ไม่ต้องมี key)</span><input name="tw" class="input mono" placeholder="channelname" value="${esc(src.tw || '')}"></label>
        <label class="field"><span>ซ่อนคอมเมนต์บนจอเองหลัง</span><select name="autohide" class="select">${CHAT_AUTOHIDE.map(v => `<option value="${v}" ${v === chatFeed.autoHide ? 'selected' : ''}>${v ? `${v} วินาที` : 'ไม่ซ่อนเอง (กดซ่อน)'}</option>`).join('')}</select></label>
        <p class="note">Facebook / TikTok / LINE: ยังดึงอัตโนมัติไม่ได้ (ต้องใช้สิทธิ์ของเพจ) — คัดลอกคอมเมนต์มาวางในช่อง “พิมพ์เอง” ใต้รายการคอมเมนต์</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'ตัดการเชื่อมต่อ', value: 'off' }, { label: 'เชื่อมต่อ', primary: true, value: 'ok' }]
    });
    if (!r?.value) return;
    chatFeed.autoHide = CHAT_AUTOHIDE.includes(+r.form.autohide.value) ? +r.form.autohide.value : 0;
    store.set('chat-autohide', chatFeed.autoHide);
    if (r.value === 'off') { chatConnect({}); return; }
    const cfg = { yt: r.form.yt.value.trim(), tw: r.form.tw.value.trim(), key: r.form.key.value.trim() };
    if (cfg.yt && !chatLib.youtubeId(cfg.yt)) { toast('ลิงก์ YouTube ไม่ถูกต้อง', 'error'); return; }
    store.set('chat-src', { yt: cfg.yt, tw: cfg.tw });
    store.set('chat-ytkey', cfg.key);
    chatConnect(cfg);
  }
  function addChatInput(silent) {
    const n = inputs.filter(i => i.type === 'chat').length + 1;
    const inp = addInput({ type: 'chat', name: n > 1 ? `COMMENTS ${n}` : 'COMMENTS', chat: { style: 'lower' } });
    if (!silent) {
      openChatInputDialog(inp);
      $('.tab[data-tab="chat"]')?.click();
    }
    return inp;
  }
  // หน้าต่างคอมเมนต์ไลฟ์: กรอง (ทั้งหมด / คำถาม / แพลตฟอร์ม) · หยุดเลื่อน · แสดงขึ้นจอ · บัญชีที่เชื่อม · ตัวอย่างการ์ด · กรองคำหยาบ
  const isQuestion = t => /[?？]|ไหม|มั้ย|ยังไง|อย่างไร|เท่าไร|เท่าไหร่|ทำไม|ที่ไหน|เมื่อไร|เมื่อไหร่|อะไร/.test(t || '');
  async function openChatInputDialog(inp) {
    const before = inp.chat.style;
    const demo = !chatFeed.shown;
    if (demo) { chatFeed.shown = { id: 'demo', platform: 'youtube', name: 'ตัวอย่างผู้ชม', text: 'สวัสดีครับ ติดตามรายการทุกสัปดาห์เลย' }; chatFeed.at = performance.now() - 400; chatFeed.hideAt = 0; }
    const view = { filter: 'all', paused: false, frozen: null };
    const LABEL = { live: 'เชื่อมแล้ว', connecting: 'กำลังเชื่อมต่อ…', error: 'ผิดพลาด', off: 'ยังไม่เชื่อม' };
    const r = await dialog({
      title: 'คอมเมนต์ไลฟ์',
      wide: true,
      body: `<div class="ct-wrap">
        <div class="ct-left">
          <div class="ct-bar">
            ${[['all', 'ทั้งหมด'], ['q', 'คำถาม'], ['youtube', 'YouTube'], ['twitch', 'Twitch'], ['manual', 'พิมพ์เอง']].map(([k, n]) => `<button type="button" class="btn btn-sm ct-f ${k === 'all' ? 'is-on' : ''}" data-f="${k}">${n}</button>`).join('')}
            <span class="ml-auto"></span><button type="button" class="btn btn-sm" data-ct="pause">หยุดเลื่อน</button>
          </div>
          <div class="ct-list" role="list"></div>
          <form class="ct-manual" data-ct-form><input class="input" name="ctName" maxlength="40" placeholder="ชื่อ" aria-label="ชื่อผู้ชม"><input class="input" name="ctText" maxlength="300" placeholder="วางคอมเมนต์จาก Facebook / LINE / TikTok แล้วกดเพิ่ม" aria-label="ข้อความ"><button type="button" class="btn btn-sm" data-ct="add">เพิ่ม</button></form>
        </div>
        <div class="ct-right">
          <section class="ct-card"><div class="ct-h"><h3>บัญชีที่เชื่อม</h3></div><div class="ct-conns"></div>
            <button type="button" class="btn btn-sm" data-ct="connect">+ เชื่อมบัญชี / ตั้งค่า</button></section>
          <section class="ct-card"><div class="ct-h"><h3>ตัวอย่างบนจอ</h3></div>
            <div class="ct-prev"><canvas width="960" height="540" aria-label="ตัวอย่างการ์ดคอมเมนต์"></canvas></div>
            <div class="ct-two">
              <label class="field"><span>รูปแบบ</span><select name="style" class="select">${Object.entries(chatLib.CHAT_STYLES).map(([k, t]) => `<option value="${k}" ${k === inp.chat.style ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
              <label class="field"><span>ซ่อนหลัง</span><select name="autohide" class="select">${CHAT_AUTOHIDE.map(v => `<option value="${v}" ${v === chatFeed.autoHide ? 'selected' : ''}>${v ? `${v} วินาที` : 'ไม่ซ่อนเอง'}</option>`).join('')}</select></label>
            </div>
            <label class="check"><input type="checkbox" name="clean" ${chatFeed.clean ? 'checked' : ''}> กรองคำหยาบอัตโนมัติ (แทนด้วย ***)</label>
          </section>
          <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        </div>
      </div>`,
      actions: [{ label: 'ซ่อนคอมเมนต์จากจอ', value: 'hide' }, { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        modal.classList.add('ct-modal');
        const list = $('.ct-list', modal), conns = $('.ct-conns', modal), f = $('form', modal).elements;
        const pv = $('.ct-prev canvas', modal), px = pv.getContext('2d');
        const paintConns = () => {
          conns.innerHTML = ['youtube', 'twitch'].map(k => { const [st, text] = chatFeed.status[k] || ['off', '']; return `<div class="ct-conn is-${st}"><i style="background:${chatLib.PLATFORMS[k].color}"></i><b>${chatLib.PLATFORMS[k].label}</b><span title="${esc(text)}">${esc(st === 'error' ? text : LABEL[st])}</span></div>`; }).join('')
            + '<div class="ct-conn is-off"><i style="background:#4f86f0"></i><b>Facebook</b><span>ดึงเองไม่ได้ — วางคอมเมนต์ในช่องด้านล่างรายการ</span></div>';
        };
        const paintList = () => {
          const src = view.paused ? view.frozen : chatFeed.list;
          const sh = chatFeed.shown && !chatFeed.hideAt && chatFeed.shown.id !== 'demo' ? chatFeed.shown : null;
          const items = src.filter(m => view.filter === 'all' || (view.filter === 'q' ? isQuestion(m.text) : (m.platform || 'manual') === view.filter)).slice(-120).reverse();
          list.innerHTML = items.map(m => `<div class="ct-item ${sh && sh.id === m.id ? 'is-on' : ''}" role="listitem">
              <span class="ct-pf" style="background:${(chatLib.PLATFORMS[m.platform] || chatLib.PLATFORMS.manual).color}">${esc((chatLib.PLATFORMS[m.platform] || chatLib.PLATFORMS.manual).label.slice(0, 2).toUpperCase())}</span>
              <div><b>${esc(m.name)}</b>${m.amount ? `<em>${esc(m.amount)}</em>` : ''}${isQuestion(m.text) ? '<small class="ct-q">คำถาม</small>' : ''}<p>${esc(m.text)}</p></div>
              ${sh && sh.id === m.id ? '<span class="ct-on">บนจอ</span>' : `<button type="button" class="btn btn-sm" data-show="${esc(m.id)}">แสดง</button>`}</div>`).join('')
            || '<p class="note">ยังไม่มีคอมเมนต์ — เชื่อม YouTube / Twitch หรือพิมพ์เองด้านล่าง</p>';
          const newer = view.paused ? chatFeed.list.length - view.frozen.length : 0;
          $('[data-ct=pause]', modal).textContent = view.paused ? `เลื่อนต่อ${newer > 0 ? ` (ใหม่ ${newer})` : ''}` : 'หยุดเลื่อน';
        };
        let sig = '';
        const tick = () => {
          if (!modal.isConnected) return;
          const now = `${chatFeed.list.length}|${chatFeed.shown?.id}|${chatFeed.hideAt}|${JSON.stringify(chatFeed.status)}|${view.filter}|${view.paused}`;
          if (now !== sig) { sig = now; paintList(); paintConns(); }
          px.fillStyle = '#23324a'; px.fillRect(0, 0, 960, 540);
          try { const src = $('#pgm-canvas'); if (src) px.drawImage(src, 0, 0, 960, 540); } catch (e) {}
          if (!onOverlay(inp.id) && inp.id !== state.programId) chatLib.drawChat(px, 960, 540, chatFeed.shown, inp.chat.style, chatAnim());
          setTimeout(tick, 120);
        };
        tick();
        modal.addEventListener('change', e => {
          if (e.target.name === 'style') inp.chat.style = e.target.value;
          if (e.target.name === 'autohide') { chatFeed.autoHide = CHAT_AUTOHIDE.includes(+e.target.value) ? +e.target.value : 0; store.set('chat-autohide', chatFeed.autoHide); }
          if (e.target.name === 'clean') { chatFeed.clean = e.target.checked; store.set('chat-clean', chatFeed.clean); }
        });
        const addManual = () => {
          const text = f.ctText.value.trim();
          if (!text) return;
          chatAdd({ id: 'm' + uid(), platform: 'manual', name: f.ctName.value.trim() || 'ผู้ชม', text });
          f.ctText.value = ''; f.ctText.focus();
        };
        f.ctText.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addManual(); } });
        modal.addEventListener('click', e => {
          const fb = e.target.closest('[data-f]');
          if (fb) { view.filter = fb.dataset.f; $$('.ct-f', modal).forEach(b => b.classList.toggle('is-on', b === fb)); return; }
          const show = e.target.closest('[data-show]');
          if (show) { const m = chatFeed.list.find(x => x.id === show.dataset.show); if (m) chatShow(m); return; }
          const act = e.target.closest('[data-ct]')?.dataset.ct;
          if (act === 'pause') { view.paused = !view.paused; view.frozen = view.paused ? chatFeed.list.slice() : null; paintList(); }
          else if (act === 'connect') openChatConnectDialog();
          else if (act === 'add') addManual();
        });
        // “ซ่อนคอมเมนต์จากจอ” ไม่ปิดหน้าต่าง
        const hb = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'ซ่อนคอมเมนต์จากจอ');
        const clone = hb.cloneNode(true); hb.replaceWith(clone);
        clone.addEventListener('click', () => chatHide());
      }
    });
    if (demo && chatFeed.shown?.id === 'demo') chatFeed.shown = null;
    if (r?.value !== 'save') { inp.chat.style = before; return; }
    inp.name = String(r.form.name.value || '').trim().slice(0, 40) || inp.name;
    renderInputs(); refreshSourceSelects();
  }
  function bindChatPane() {
    const pane = $('[data-pane="chat"]');
    pane.addEventListener('click', e => {
      const b = e.target.closest('[data-chat]');
      if (b?.dataset.chat === 'hide') chatHide();
      else if (b?.dataset.chat === 'connect') openChatConnectDialog();
      const item = e.target.closest('.chat-item');
      if (!item) return;
      const m = chatFeed.list.find(x => x.id === item.dataset.id);
      if (!m) return;
      if (chatFeed.shown?.id === m.id && !chatFeed.hideAt) chatHide();
      else chatShow(m);
    });
    $('#chat-manual').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target, text = f.text.value.trim();
      if (!text) return;
      chatAdd({ id: 'm-' + uid(), platform: 'manual', name: f.who.value.trim() || 'ผู้ชม', text, at: Date.now() });
      f.text.value = '';
    });
    setInterval(() => {
      if (chatFeed.autoHide && chatFeed.shown && !chatFeed.hideAt && performance.now() - chatFeed.at > chatFeed.autoHide * 1000) chatHide();
    }, 250);
    renderChatConn();
    renderChat();
  }

  /* ------------------------------------------------------ audio sources */
  // แหล่งเสียงที่ไม่มีภาพ อยู่ในมิกเซอร์เท่านั้น: ไมค์ · เสียงจากคอม/แท็บ · เครื่องเล่นเพลง · แผงเสียงเอฟเฟกต์ · สตรีมเสียงจาก URL · สัญญาณทดสอบ
  // แต่ละช่องมี ch.src = { playing, toggle, next?, prev?, edit?, sub, progress, save } ให้แถบควบคุมใต้ช่องเสียงใช้ร่วมกัน
  const chanKey = c => c.kind === 'mic' ? (c.micId ? `mic:${c.micId}${c.micChan != null ? '#' + c.micChan : ''}` : '') : c.srcId ? 'src:' + c.srcId : c.inputId || '';
  const chanByKey = k => k === 'master' ? audio.masterStrip : k ? audio.channels.find(c => chanKey(c) === k) : null;
  const audioChanOptions = () => audio.channels.map(c => [chanKey(c), c.name]).filter(([k]) => k);
  const AUDIO_FILES = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac';
  const PAD_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];
  const PAD_COLORS = ['#3b82f6', '#22c55e', '#f5a524', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b'];
  const TONES = { k1: ['1 kHz (มาตรฐานตั้งระดับ)', 1000], a440: ['440 Hz', 440], k10: ['10 kHz', 10000], pink: ['Pink noise (เช็กลำโพง/EQ)', 0] };
  const TONE_LEVELS = [-12, -18, -20];
  const padChannel = () => audio.channels.find(c => c.kind === 'pad');
  const fmtClock = sec => !isFinite(sec) || sec < 0 ? '--:--' : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  const AUDIO_ADD = () => [['แหล่งเสียง', [
    ['mic', 'ไมโครโฟน / ออดิโออินเทอร์เฟซ', 'ไมค์ USB มิกเซอร์ภายนอก แยกช่อง 1 / 2 ได้', openMicDialog],
    ['monitor', 'เสียงจากคอม / แท็บ', 'เพลงจาก YouTube Spotify หรือเสียงโปรแกรมอื่น', addSystemAudio],
    ['music', 'เครื่องเล่นเพลง', 'MP3 / WAV / M4A หลายไฟล์ เล่นต่อกัน วนซ้ำได้', () => pickFiles(AUDIO_FILES, files => addMusicPlayer(files))],
    ['grid', 'แผงเสียงเอฟเฟกต์', '8 ปุ่ม เสียงปรบมือ จิงเกิล กดแล้วดังทันที', addSoundPad],
    ['broadcast', 'วิทยุ / สตรีมเสียงจาก URL', 'สถานีวิทยุออนไลน์ Icecast / Shoutcast หรือไฟล์เสียงบนเว็บ', () => openAudioUrlDialog()],
    ['bars', 'สัญญาณทดสอบ (Tone)', '1 kHz / Pink noise สำหรับตั้งระดับเสียงกับมิกเซอร์', () => openToneDialog()]]]];
  function openAudioAddMenu(anchor) { openAddMenu(anchor, AUDIO_ADD(), 'เพิ่มแหล่งเสียง'); }

  function addSourceChannel(node, kind, name, extra = {}) {
    return audio.addChannel(node, { name: String(name || kind.toUpperCase()).slice(0, 24), kind, ...extra, srcId: extra.srcId || uid() });
  }
  function refreshStrip(ch) {
    const ui = ch.ui?.src;
    if (!ui) return;
    const on = ch.src.playing();
    if (ui.play) { ui.play.classList.toggle('is-on', on); ui.play.innerHTML = icon(on ? 'pause' : 'play'); ui.play.title = on ? 'หยุด' : 'เล่น'; }
    ui.sub.textContent = ch.src.sub();
    ui.sub.title = ch.src.sub() + (ch.src.edit ? ' — กดเพื่อตั้งค่า' : '');
  }
  function stripSourceHtml(ch) {
    const s = ch.src;
    return `<div class="strip-src">
      <div class="strip-sub" ${s.edit ? 'data-tp="edit" role="button" tabindex="0"' : ''}></div>
      ${s.progress ? '<div class="strip-prog"><span><i></i></span><b class="strip-time mono"></b></div>' : ''}
      <div class="strip-tp">
        ${s.prev ? `<button class="chip-btn" data-tp="prev" title="ก่อนหน้า / เริ่มเพลงใหม่">${icon('skip-back')}</button>` : ''}
        ${s.toggle ? `<button class="chip-btn tp-play" data-tp="toggle" title="เล่น">${icon('play')}</button>` : ''}
        ${s.next ? `<button class="chip-btn" data-tp="next" title="ถัดไป">${icon('skip-fwd')}</button>` : ''}
        ${s.stop ? `<button class="chip-btn" data-tp="stop" title="หยุดทุกเสียง">${icon('stop')}</button>` : ''}
        ${s.edit && !s.next ? `<button class="chip-btn" data-tp="edit" title="ตั้งค่า">${icon('edit')}</button>` : ''}
        <button class="chip-btn rm" title="ลบช่องเสียงนี้">✕</button>
      </div></div>`;
  }
  function bindStripSource(el, ch) {
    ch.ui.src = { play: el.querySelector('[data-tp=toggle]'), sub: el.querySelector('.strip-sub'), bar: el.querySelector('.strip-prog i'), time: el.querySelector('.strip-time') };
    el.querySelector('.strip-src').addEventListener('click', e => {
      const b = e.target.closest('[data-tp]');
      if (!b || !ch.src[b.dataset.tp]) return;
      audio.ensure();
      ch.src[b.dataset.tp]();
      refreshStrip(ch);
    });
    refreshStrip(ch);
  }
  function stripSourceTick(ch) {
    const ui = ch.ui?.src;
    if (ch.kind === 'pad') padTick(ch);
    if (!ui || !ch.src.progress) return;
    const [pos, dur] = ch.src.progress();
    if (ui.bar) ui.bar.style.width = `${dur > 0 && isFinite(dur) ? clamp(pos / dur, 0, 1) * 100 : 0}%`;
    if (ui.time) ui.time.textContent = isFinite(dur) && dur > 0 ? `-${fmtClock(dur - pos)}` : pos > 0 ? fmtClock(pos) : '';
    if (!!ui.play?.classList.contains('is-on') !== ch.src.playing()) refreshStrip(ch);
  }

  // เสียงจากคอม/แท็บ: ใช้ตัวแชร์หน้าจอของเบราว์เซอร์ เก็บเฉพาะเสียง (ไม่บันทึกกับโชว์ — ต้องเลือกใหม่ทุกครั้ง)
  async function addSystemAudio() {
    if (!navigator.mediaDevices?.getDisplayMedia) { toast('อุปกรณ์นี้จับเสียงจากคอมไม่ได้ — ใช้ Chrome หรือ Edge บนคอมพิวเตอร์', 'error', 6000); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include', selfBrowserSurface: 'exclude' });
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('จับเสียงไม่สำเร็จ: ' + e.message, 'error');
      return;
    }
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    stream.getVideoTracks().forEach(t => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) {
      toast('ไม่ได้เสียงมาด้วย — ตอนเลือกให้ติ๊ก “แชร์เสียง” (Windows: แท็บหรือทั้งหน้าจอ · Mac: เลือกเป็นแท็บของ Chrome)', 'warn', 9000);
      return;
    }
    if (!audio.ensure()) return;
    const only = new MediaStream([track]);
    const name = surface === 'browser' ? 'เสียงแท็บ' : surface === 'window' ? 'เสียงโปรแกรม' : 'เสียงคอม';
    const ch = addSourceChannel(audio.ctx.createMediaStreamSource(only), 'sys', name, { stream: only });
    ch.src = { playing: () => track.readyState === 'live', sub: () => track.readyState === 'live' ? 'กำลังรับเสียง' : 'หยุดแล้ว' };
    renderMixer();
    track.addEventListener('ended', () => {
      if (!audio.channels.includes(ch)) return;
      audio.remove(ch);
      toast(`หยุดรับ “${ch.name}” แล้ว (หยุดแชร์จากเบราว์เซอร์)`, 'warn');
    });
    toast(`เพิ่ม “${name}” แล้ว — เสียงเข้ามิกเซอร์เท่านั้น ไม่ดังซ้ำออกลำโพง`, 'success');
  }

  // เครื่องเล่นเพลง: ไฟล์เสียงหลายไฟล์ เล่นต่อกัน · ไฟล์เก็บใน OPFS เปิดหน้าใหม่แล้วยังอยู่
  function storeAudioFile(key, file) {
    mediaStore.put(key, file).then(ok => { if (!ok) toast(`พื้นที่ในเบราว์เซอร์ไม่พอเก็บ “${file.name}” — เปิดหน้าใหม่แล้วต้องเพิ่มไฟล์นี้อีกครั้ง`, 'warn', 7000); });
  }
  function addMusicPlayer(files = [], saved = null) {
    if (!audio.ensure()) return null;
    const el = new Audio();
    el.preload = 'auto';
    const cfg = saved?.cfg || {};
    const list = {
      items: (Array.isArray(cfg.items) ? cfg.items : []).slice(0, 200).filter(it => it && typeof it.key === 'string').map(it => ({ key: it.key.slice(0, 60), name: String(it.name || 'เพลง').slice(0, 60) })),
      index: Math.max(0, +cfg.index || 0), loop: ['all', 'one', 'off'].includes(cfg.loop) ? cfg.loop : 'all'
    };
    const n = audio.channels.filter(c => c.kind === 'player').length + 1;
    const ch = addSourceChannel(audio.ctx.createMediaElementSource(el), 'player', saved?.name || (n > 1 ? `MUSIC ${n}` : 'MUSIC'), { srcId: saved?.srcId, restore: saved || undefined, el, list });
    let url = '';
    const load = async (i, play) => {
      const it = list.items[i];
      if (!it) return;
      list.index = i;
      if (!it.file) it.file = await mediaStore.get(it.key);
      if (!audio.channels.includes(ch)) return;
      if (!it.file) { toast(`ไม่พบไฟล์ “${it.name}” — ลบแล้วเพิ่มใหม่ได้ที่ปุ่ม ✎ ของ ${ch.name}`, 'warn', 6000); refreshStrip(ch); return; }
      if (url) URL.revokeObjectURL(url);
      el.src = url = URL.createObjectURL(it.file);
      el.loop = list.loop === 'one';
      refreshStrip(ch);
      if (play) el.play().catch(() => {});
    };
    const step = d => { if (list.items.length) load((list.index + d + list.items.length) % list.items.length, !el.paused); };
    el.addEventListener('ended', () => {
      if (list.index + 1 < list.items.length) load(list.index + 1, true);
      else if (list.loop === 'all' && list.items.length) load(0, true);
      else refreshStrip(ch);
    });
    ch.src = {
      playing: () => !el.paused,
      toggle: () => { if (!el.paused) el.pause(); else if (el.src) el.play().catch(() => {}); else load(list.index, true); },
      prev: () => { if (el.currentTime > 3) el.currentTime = 0; else step(-1); },
      next: () => step(1),
      edit: () => openPlayerDialog(ch),
      sub: () => list.items[list.index]?.name || 'ยังไม่มีเพลง — กด ✎',
      progress: () => [el.currentTime || 0, el.duration],
      save: () => ({ items: list.items.map(it => ({ key: it.key, name: it.name })), index: list.index, loop: list.loop })
    };
    ch.addFiles = picked => {
      for (const file of picked.slice(0, 200 - list.items.length)) {
        const key = 'aud-' + uid();
        storeAudioFile(key, file);
        list.items.push({ key, name: baseName(file.name), file });
      }
      if (!el.src && list.items.length) load(list.index < list.items.length ? list.index : 0, false);
      refreshStrip(ch);
    };
    ch.load = load;
    ch.dispose = () => { el.pause(); el.removeAttribute('src'); el.load(); if (url) URL.revokeObjectURL(url); list.items.forEach(it => mediaStore.del(it.key)); };
    if (list.index >= list.items.length) list.index = 0;
    if (files.length) ch.addFiles(files);
    else if (list.items.length) load(list.index, false);
    renderMixer();
    if (files.length) toast(`เพิ่ม ${ch.name} (${files.length} เพลง) แล้ว — กด ▶ ใต้ช่องเสียงเพื่อเล่น`, 'success');
    return ch;
  }
  function openPlayerDialog(ch) {
    const list = ch.list;
    dialog({
      title: `เครื่องเล่นเพลง — ${ch.name}`,
      body: `
        <label class="field"><span>ชื่อช่อง</span><input name="pname" class="input" maxlength="24" value="${esc(ch.name)}"></label>
        <label class="field"><span>เมื่อเล่นจบ</span><select name="loop" class="select">
          <option value="all" ${list.loop === 'all' ? 'selected' : ''}>เล่นต่อเพลงถัดไป วนทั้งรายการ</option>
          <option value="one" ${list.loop === 'one' ? 'selected' : ''}>วนเพลงเดิม</option>
          <option value="off" ${list.loop === 'off' ? 'selected' : ''}>เล่นจนจบรายการแล้วหยุด</option></select></label>
        <div class="field"><span>รายการเพลง</span><div class="tracks"></div>
          <button type="button" class="btn btn-sm track-add">+ เพิ่มเพลง</button></div>
        <p class="note">เพลงจะเล่นเข้ามิกเซอร์ (ไลฟ์/บันทึก) เท่านั้น — กด “ฟังเสียง” ด้านบนเพื่อฟังในหูฟัง · ตั้งปุ่ม MIDI หรือ Macro สั่งเล่น/หยุดได้</p>`,
      actions: [{ label: 'เสร็จสิ้น', primary: true }],
      onOpen(modal) {
        const box = $('.tracks', modal);
        const paint = () => {
          box.innerHTML = list.items.map((it, i) => `<div class="track ${i === list.index ? 'is-cur' : ''}" data-i="${i}">
            <button type="button" class="mini" data-act="play" title="เล่นเพลงนี้">${icon('play')}</button>
            <span class="track-name" title="${esc(it.name)}">${i + 1}. ${esc(it.name)}</span>
            <button type="button" class="mini" data-act="up" title="ขึ้น">↑</button><button type="button" class="mini" data-act="down" title="ลง">↓</button>
            <button type="button" class="mini danger" data-act="rm" title="ลบ">✕</button></div>`).join('') || '<p class="note">ยังไม่มีเพลง</p>';
        };
        paint();
        box.addEventListener('click', e => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          const i = +b.closest('[data-i]').dataset.i, cur = list.items[list.index];
          if (b.dataset.act === 'play') { audio.ensure(); ch.load(i, true); }
          else if (b.dataset.act === 'rm') {
            const [gone] = list.items.splice(i, 1);
            mediaStore.del(gone.key);
            if (gone === cur) { ch.el.pause(); ch.el.removeAttribute('src'); list.index = Math.min(i, Math.max(0, list.items.length - 1)); if (list.items.length) ch.load(list.index, false); }
            else list.index = Math.max(0, list.items.indexOf(cur));
          } else {
            const j = i + (b.dataset.act === 'up' ? -1 : 1);
            if (j < 0 || j >= list.items.length) return;
            [list.items[i], list.items[j]] = [list.items[j], list.items[i]];
            list.index = list.items.indexOf(cur);
          }
          paint();
          refreshStrip(ch);
        });
        $('.track-add', modal).addEventListener('click', () => pickFiles(AUDIO_FILES, files => { ch.addFiles(files); paint(); }));
        modal.addEventListener('change', e => {
          if (e.target.name === 'loop') { list.loop = e.target.value; ch.el.loop = list.loop === 'one'; }
        });
        modal.addEventListener('input', e => { if (e.target.name === 'pname') ch.name = e.target.value.trim().slice(0, 24) || ch.name; });
      }
    }).then(() => renderMixer());
  }

  // แผงเสียงเอฟเฟกต์: 8 ปุ่ม ถอดรหัสเสียงไว้ล่วงหน้า กดแล้วดังทันที · กดซ้ำระหว่างดัง = หยุด · ทุกปุ่มรวมเป็นช่องเสียงเดียว
  function addSoundPad(saved = null) {
    const have = padChannel();
    if (have && !saved?.cfg) { openPadDialog(have); return have; }
    if (!audio.ensure()) return null;
    const cfg = saved?.cfg || {};
    const pads = PAD_SLOTS.map(i => {
      const p = Array.isArray(cfg.pads) ? cfg.pads[i] : null;
      return p && typeof p.key === 'string' ? { key: p.key.slice(0, 60), name: String(p.name || `SFX ${i + 1}`).slice(0, 24), loop: !!p.loop, color: PAD_COLORS.includes(p.color) ? p.color : PAD_COLORS[i] } : null;
    });
    const sum = audio.ctx.createGain();
    const ch = addSourceChannel(sum, 'pad', saved?.name || 'SFX', { srcId: saved?.srcId, restore: saved || undefined, pads, buffers: new Map(), active: new Map() });
    ch.src = {
      playing: () => ch.active.size > 0,
      stop: () => { for (const a of [...ch.active.values()]) a.node.stop(); },
      edit: () => openPadDialog(ch),
      sub: () => ch.active.size ? `กำลังเล่น ${ch.active.size} เสียง` : `${pads.filter(Boolean).length}/8 ปุ่ม`,
      save: () => ({ pads: pads.map(p => p && { key: p.key, name: p.name, loop: p.loop, color: p.color }) })
    };
    ch.playingPad = i => ch.active.has(i);
    ch.dispose = () => { for (const a of ch.active.values()) { try { a.node.stop(); } catch (e) {} } pads.forEach(p => p && mediaStore.del(p.key)); renderSfxBar(); };
    pads.forEach(p => p && padDecode(ch, p));
    renderMixer();
    renderSfxBar();
    if (!saved) openPadDialog(ch);
    return ch;
  }
  async function padDecode(ch, p, file) {
    try {
      file = file || await mediaStore.get(p.key);
      if (!file) { p.missing = true; renderSfxBar(); return null; }
      const buf = await audio.ctx.decodeAudioData(await file.arrayBuffer());
      ch.buffers.set(p.key, buf);
      p.missing = false;
      renderSfxBar();
      return buf;
    } catch (e) {
      p.missing = true;
      toast(`เปิดไฟล์เสียง “${p.name}” ไม่ได้ — ไฟล์เสียหายหรือไม่รองรับ`, 'error');
      renderSfxBar();
      return null;
    }
  }
  function padFire(ch, i) {
    const p = ch.pads[i];
    if (!p) { openPadDialog(ch, i); return; }
    const cur = ch.active.get(i);
    if (cur) { cur.node.stop(); return; }
    const buf = ch.buffers.get(p.key);
    if (!buf) { toast(p.missing ? `ไม่พบไฟล์ของปุ่ม “${p.name}” — เลือกไฟล์ใหม่ที่ ✎` : `กำลังเตรียมเสียง “${p.name}”…`, 'warn'); return; }
    audio.ensure();
    const node = audio.ctx.createBufferSource();
    node.buffer = buf;
    node.loop = p.loop;
    node.connect(ch.node);
    const entry = { node, at: audio.ctx.currentTime, dur: buf.duration };
    node.onended = () => { if (ch.active.get(i) === entry) ch.active.delete(i); padTick(ch, true); refreshStrip(ch); };
    ch.active.set(i, entry);
    node.start();
    padTick(ch, true);
    refreshStrip(ch);
  }
  function padTick(ch, force) {
    const bar = $('#sfx-bar');
    if (!bar || (!ch.active.size && !force)) return;
    const now = audio.ctx.currentTime;
    bar.querySelectorAll('[data-pad]').forEach(b => {
      const a = ch.active.get(+b.dataset.pad);
      b.classList.toggle('is-on', !!a);
      b.style.setProperty('--p', a ? (a.node.loop ? 1 : clamp((now - a.at) / a.dur, 0, 1)) : 0);
    });
  }
  function renderSfxBar() {
    const bar = $('#sfx-bar');
    if (!bar) return;
    const ch = padChannel();
    bar.hidden = !ch;
    if (!ch) { bar.innerHTML = ''; return; }
    bar.innerHTML = ch.pads.map((p, i) => `<button class="sfx-pad ${p ? '' : 'is-empty'} ${p?.missing ? 'is-missing' : ''}" data-pad="${i}" style="--c:${p ? p.color : 'transparent'}"
        title="${p ? `${esc(p.name)}${p.loop ? ' (วนซ้ำ)' : ''} — กดเพื่อเล่น กดซ้ำเพื่อหยุด` : 'ปุ่มว่าง — กดเพื่อเลือกไฟล์เสียง'}"><b>${i + 1}</b><span>${p ? esc(p.name) : '+'}</span></button>`).join('')
      + `<button class="sfx-edit mini" title="ตั้งค่าแผงเสียงเอฟเฟกต์">${icon('edit')}</button>`;
    padTick(ch, true);
  }
  function openPadDialog(ch, focus = -1) {
    const pads = ch.pads;
    dialog({
      title: 'แผงเสียงเอฟเฟกต์',
      wide: true,
      body: `<div class="pad-rows"></div>
        <p class="note">ไฟล์เสียงสั้น ๆ เช่น ปรบมือ หัวเราะ จิงเกิลเปิดรายการ · กดปุ่มบนแผงใต้ “เสียง” เพื่อเล่น กดซ้ำเพื่อหยุด · ตั้งปุ่ม MIDI (เสียงเอฟเฟกต์ 1–8) หรือใส่ใน Macro ได้ · ระดับเสียงรวมปรับที่ช่อง ${esc(ch.name)} ในมิกเซอร์</p>`,
      actions: [{ label: 'เสร็จสิ้น', primary: true }],
      onOpen(modal) {
        const box = $('.pad-rows', modal);
        const paint = () => {
          box.innerHTML = pads.map((p, i) => `<div class="pad-row" data-i="${i}">
            <b class="pad-n" style="background:${p ? p.color : 'var(--line-2)'}">${i + 1}</b>
            ${p ? `<input class="input" data-k="name" maxlength="24" value="${esc(p.name)}">
              <label class="check"><input type="checkbox" data-k="loop" ${p.loop ? 'checked' : ''}> วน</label>
              <select class="select" data-k="color">${PAD_COLORS.map(c => `<option value="${c}" ${c === p.color ? 'selected' : ''} style="background:${c}">●</option>`).join('')}</select>
              <button type="button" class="mini" data-act="test" title="ลองเล่น">${icon('play')}</button>
              <button type="button" class="mini" data-act="file" title="เปลี่ยนไฟล์">${icon('folder')}</button>
              <button type="button" class="mini danger" data-act="rm" title="ล้างปุ่ม">✕</button>`
            : `<span class="note">ว่าง</span><button type="button" class="btn btn-sm" data-act="file">เลือกไฟล์เสียง…</button>`}</div>`).join('');
        };
        const assign = (i, file) => {
          const old = pads[i];
          if (old) { mediaStore.del(old.key); ch.buffers.delete(old.key); }
          const p = pads[i] = { key: 'sfx-' + uid(), name: baseName(file.name).slice(0, 24), loop: false, color: old?.color || PAD_COLORS[i] };
          storeAudioFile(p.key, file);
          padDecode(ch, p, file);
        };
        paint();
        box.addEventListener('click', e => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          const i = +b.closest('[data-i]').dataset.i;
          if (b.dataset.act === 'file') {
            // เลือกหลายไฟล์ = ใส่ปุ่มนี้และปุ่มว่างถัดไป
            pickFiles(AUDIO_FILES, files => {
              const slots = [i, ...PAD_SLOTS.filter(j => j !== i && !pads[j])];
              files.slice(0, slots.length).forEach((f, k) => assign(slots[k], f));
              paint(); renderSfxBar(); refreshStrip(ch);
            });
          } else if (b.dataset.act === 'test') padFire(ch, i);
          else if (b.dataset.act === 'rm') {
            ch.active.get(i)?.node.stop();
            mediaStore.del(pads[i].key); ch.buffers.delete(pads[i].key);
            pads[i] = null;
            paint(); renderSfxBar(); refreshStrip(ch);
          }
        });
        box.addEventListener('input', e => {
          const k = e.target.dataset.k, p = pads[+e.target.closest('[data-i]')?.dataset.i];
          if (!k || !p) return;
          if (k === 'name') p.name = e.target.value.trim().slice(0, 24) || p.name;
          if (k === 'loop') p.loop = e.target.checked;
          if (k === 'color') { p.color = e.target.value; e.target.closest('.pad-row').querySelector('.pad-n').style.background = p.color; }
          renderSfxBar();
        });
        if (focus >= 0 && !pads[focus]) box.querySelector(`[data-i="${focus}"] [data-act=file]`)?.click();
      }
    });
  }

  // วิทยุ/สตรีมเสียงจาก URL — เซิร์ฟเวอร์ต้องอนุญาต CORS (สถานี Icecast/Shoutcast ส่วนใหญ่อนุญาต)
  async function openAudioUrlDialog(ch) {
    const r = await dialog({
      title: ch ? `สตรีมเสียง — ${ch.name}` : 'วิทยุ / สตรีมเสียงจาก URL',
      body: `
        <label class="field"><span>ลิงก์เสียง</span><input name="url" class="input mono" placeholder="https://stream.example.com/live.mp3" value="${esc(ch?.url || '')}"></label>
        <label class="field"><span>ชื่อช่อง</span><input name="name" class="input" maxlength="24" value="${esc(ch?.name || 'RADIO')}"></label>
        <p class="note">ใช้ได้กับสถานีวิทยุออนไลน์ (Icecast / Shoutcast: ลิงก์ที่ลงท้าย .mp3 .aac หรือ /stream) และไฟล์เสียงบนเว็บ ·
          ลิงก์ต้องเป็น https และเซิร์ฟเวอร์ต้องอนุญาตให้ดึงเสียง (CORS) · ระวังลิขสิทธิ์เพลงเมื่อไลฟ์ขึ้นแพลตฟอร์ม</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: ch ? 'บันทึก' : 'เพิ่ม', primary: true, value: 'ok' }]
    });
    if (r?.value !== 'ok') return;
    const url = r.form.url.value.trim(), name = r.form.name.value.trim() || 'RADIO';
    if (!/^https?:\/\/\S+$/i.test(url)) { toast('ลิงก์ต้องขึ้นต้นด้วย https://', 'error'); return; }
    if (location.protocol === 'https:' && /^http:/i.test(url)) toast('ลิงก์ http อาจถูกเบราว์เซอร์บล็อกในหน้า https — ใช้ลิงก์ https ถ้าสถานีมีให้', 'warn', 7000);
    if (ch) { ch.name = name.slice(0, 24); ch.setUrl(url); renderMixer(); return; }
    const made = addAudioUrl({ name, cfg: { url } });
    if (made) { made.src.toggle(); toast(`เพิ่ม “${made.name}” แล้ว — กำลังเชื่อมต่อ…`, 'success'); }
  }
  function addAudioUrl(saved) {
    if (!audio.ensure()) return null;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'none';
    const ch = addSourceChannel(audio.ctx.createMediaElementSource(el), 'url', saved.name || 'RADIO', { srcId: saved.srcId, restore: saved.db !== undefined ? saved : undefined, el, url: String(saved.cfg?.url || '').slice(0, 500) });
    let state = 'idle';
    const set = s => { state = s; refreshStrip(ch); };
    el.addEventListener('playing', () => set('playing'));
    el.addEventListener('waiting', () => set('loading'));
    el.addEventListener('pause', () => set('idle'));
    el.addEventListener('error', () => {
      if (!el.getAttribute('src')) return;
      set('error');
      toast(`เปิด “${ch.name}” ไม่ได้ — ลิงก์ผิด สถานีปิดอยู่ หรือเซิร์ฟเวอร์ไม่อนุญาตให้ดึงเสียง (CORS)`, 'error', 7000);
    });
    // สตรีมสด: หยุดแล้วเล่นใหม่ให้ต่อที่เสียงปัจจุบัน ไม่ใช่เสียงที่ค้างในบัฟเฟอร์
    const live = () => !isFinite(el.duration);
    ch.setUrl = url => { ch.url = url; el.pause(); el.removeAttribute('src'); el.load(); set('idle'); };
    ch.src = {
      playing: () => !el.paused,
      toggle: () => {
        if (!el.paused) { el.pause(); if (live()) { el.removeAttribute('src'); el.load(); } return; }
        if (!el.getAttribute('src')) el.src = ch.url;
        set('loading');
        el.play().catch(e => { if (e.name !== 'AbortError') set('error'); });
      },
      edit: () => openAudioUrlDialog(ch),
      sub: () => ({ playing: live() ? 'สด' : 'กำลังเล่น', loading: 'กำลังเชื่อมต่อ…', error: 'เชื่อมต่อไม่ได้', idle: 'หยุดอยู่' })[state],
      progress: () => [el.currentTime || 0, live() ? NaN : el.duration],
      save: () => ({ url: ch.url })
    };
    ch.dispose = () => { el.pause(); el.removeAttribute('src'); el.load(); };
    renderMixer();
    return ch;
  }

  // สัญญาณทดสอบ: Sine ที่ระดับ peak ตามที่เลือก (−18 dBFS = มาตรฐานตั้งระดับ EBU) หรือ Pink noise
  async function openToneDialog(ch) {
    const t = ch?.tone || { type: 'k1', level: -18 };
    const r = await dialog({
      title: 'สัญญาณทดสอบ (Tone)',
      body: `
        <label class="field"><span>สัญญาณ</span><select name="type" class="select">${Object.entries(TONES).map(([k, [l]]) => `<option value="${k}" ${k === t.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>ระดับ</span><select name="level" class="select">${TONE_LEVELS.map(l => `<option value="${l}" ${l === t.level ? 'selected' : ''}>${l} dBFS</option>`).join('')}</select></label>
        <p class="note">ใช้ตั้งระดับเสียงกับมิกเซอร์/เครื่องบันทึกปลายทาง: เฟดเดอร์ 0 dB แล้วมิเตอร์ต้องอยู่ที่ระดับนี้พอดี · ช่องนี้เริ่มแบบปิดเสียง (M) กันเผลอดังออกไลฟ์ — กด M เพื่อเปิด</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: ch ? 'บันทึก' : 'เพิ่ม', primary: true, value: 'ok' }]
    });
    if (r?.value !== 'ok') return;
    const tone = { type: r.form.type.value, level: +r.form.level.value };
    if (ch) { ch.setTone(tone); refreshStrip(ch); return; }
    const made = addTone({ cfg: tone });
    if (made) toast('เพิ่มสัญญาณทดสอบแล้ว (ปิดเสียงไว้ — กด M เพื่อเปิด)', 'success');
  }
  function sanitizeTone(t) {
    t = t || {};
    return { type: TONES[t.type] ? t.type : 'k1', level: TONE_LEVELS.includes(+t.level) ? +t.level : -18 };
  }
  function addTone(saved) {
    if (!audio.ensure()) return null;
    const ctx = audio.ctx, out = ctx.createGain();
    const ch = addSourceChannel(out, 'tone', saved.name || 'TONE', { srcId: saved.srcId, restore: saved.db !== undefined ? saved : { muted: true, db: 0 }, tone: sanitizeTone(saved.cfg) });
    let gen = null;
    ch.setTone = tone => {
      ch.tone = sanitizeTone(tone);
      if (gen) { try { gen.stop(); gen.disconnect(); } catch (e) {} }
      const [, hz] = TONES[ch.tone.type];
      if (hz) { gen = ctx.createOscillator(); gen.frequency.value = hz; }
      else {
        // Pink noise (Paul Kellet) 4 วินาที วนซ้ำ — ปรับให้ peak = 1 แล้วลดตามระดับที่เลือก
        const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, peak = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
          peak = Math.max(peak, Math.abs(d[i]));
        }
        for (let i = 0; i < len; i++) d[i] /= peak;
        gen = ctx.createBufferSource(); gen.buffer = buf; gen.loop = true;
      }
      out.gain.value = dbToGain(ch.tone.level);
      gen.connect(out);
      gen.start();
    };
    ch.src = {
      playing: () => !ch.muted,
      edit: () => openToneDialog(ch),
      sub: () => `${TONES[ch.tone.type][0].split(' (')[0]} · ${ch.tone.level} dBFS`,
      save: () => ({ ...ch.tone })
    };
    ch.dispose = () => { try { gen.stop(); } catch (e) {} };
    ch.setTone(ch.tone);
    renderMixer();
    return ch;
  }

  // สร้างแหล่งเสียงกลับจากโชว์ที่บันทึกไว้
  function restoreAudioSource(s) {
    if (!s || typeof s !== 'object') return;
    const saved = { ...s, srcId: typeof s.srcId === 'string' && s.srcId ? s.srcId.slice(0, 40) : uid(), name: String(s.name || '').slice(0, 24) };
    try {
      if (s.kind === 'player') addMusicPlayer([], saved);
      else if (s.kind === 'pad' && !padChannel()) addSoundPad(saved);
      else if (s.kind === 'url' && /^https?:\/\//i.test(s.cfg?.url || '')) addAudioUrl(saved);
      else if (s.kind === 'tone') addTone(saved);
    } catch (e) { console.warn('restore audio source', e); }
  }
  const audioSourceKeys = () => audio.channels.flatMap(c => c.kind === 'player' ? c.list.items.map(it => it.key) : c.kind === 'pad' ? c.pads.filter(Boolean).map(p => p.key) : []);

  /* ------------------------------------------------------ overlay controls */
  function playIfMedia(inp) {
    if (inp && inp.type === 'media' && inp.el.paused) inp.el.play().catch(() => {});
  }
  function setChannel(i, on) {
    const c = ovl[i];
    if (on && !byId(c.inputId)) { toast(`เลือกแหล่งภาพให้ Overlay ${c.n} ก่อน (แท็บ ซ้อนภาพ หรือปุ่ม ${c.n} ใต้การ์ดแหล่งภาพ)`, 'warn'); return; }
    const input = byId(c.inputId);
    if (on && input?.type === 'cg' && !c.on) { input.cg.onAirSceneId = input.cg.design.activeSceneId; input.cg.onAirSnapshot = null; }
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
      const input = byId(id);
      if (input?.type === 'cg') { input.cg.onAirSceneId = input.cg.design.activeSceneId; input.cg.onAirSnapshot = null; }
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
    $('#ovl-keys').innerHTML = ovl.map((c, i) => `<button class="key key-ovl" data-ovl="${i}" title="Overlay ${c.n} — เปิด/ปิดบน Program (${ovlKeyLabel(i)})"><b>${c.n}</b><kbd>${ovlKeyLabel(i)}</kbd></button>`).join('');
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
  const GFX_LABEL = { title: 'ป้ายชื่อ', timer: 'นับเวลา', score: 'ป้ายคะแนน', ticker: 'ตัววิ่ง', cg: 'CG Studio', visualizer: 'คลื่นเสียง', image: 'ภาพ / โลโก้', playlist: 'Playlist' };
  function renderQuickGfx() {
    const box = $('#m-gfx');
    if (!box) return;
    const bound = new Set(ovl.map(c => c.inputId).filter(Boolean));
    const list = inputs.filter(i => GRAPHIC_TYPES.includes(i.type) || i.type === 'cg' || i.type === 'image' || bound.has(i.id));
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
        <button type="button" class="gfx-card gfx-add" data-gfx-add="cg">${icon('plus')}<b>CG Studio</b></button>
        <button type="button" class="gfx-card gfx-add" data-gfx-add="image">${icon('plus')}<b>โลโก้</b></button>
      </div>`;
  }
  function quickGfxTap(e) {
    if (e.target.closest('[data-gfx-clear]')) { ovl.forEach((c, i) => { if (c.on) setChannel(i, false); }); return; }
    const add = e.target.closest('[data-gfx-add]');
    if (add) {
      ({ title: addTitleInput, timer: addTimerInput, score: addScoreInput, cg: addCGInput, image: () => pickFiles('image/*', addImageFiles) })[add.dataset.gfxAdd]();
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

  // ป้ายชื่อที่เพิ่งขึ้นจอ: เริ่มภาพเคลื่อนไหว และตั้งเวลาซ่อนเอง (ถ้าตั้งไว้)
  function titleOnAir(c, i) {
    const inp = byId(c.inputId), now = c.on && inp && inp.type === 'title' ? inp.id : null;
    if (now === c.titleOn) return;
    c.titleOn = now;
    clearTimeout(c.hideTimer);
    if (!now) return;
    inp.shownAt = performance.now();
    const sec = inp.title?.autoHide;
    if (sec > 0) c.hideTimer = setTimeout(() => { if (ovl[i].on && ovl[i].inputId === now) setChannel(i, false); }, sec * 1000);
  }
  function updateOverlayUI() {
    ovl.forEach((c, i) => {
      titleOnAir(c, i);
      const inp = byId(c.inputId);
      const key = $(`.key-ovl[data-ovl="${i}"]`);
      if (key) {
        key.classList.toggle('is-on', c.on);
        key.classList.toggle('is-staged', c.staged && !c.on);
        // ไม่แสดงชื่อแหล่งภาพบนปุ่ม (ชื่อไฟล์ยาวทำให้ปุ่มล้น) — ดูได้จากคำอธิบายเมื่อชี้ และจุดบอกว่าช่องนี้มีภาพผูกไว้
        key.classList.toggle('has-src', !!inp);
        key.title = `Overlay ${c.n}${inp ? ` — ${inp.name}` : ' — ยังไม่ได้เลือกแหล่งภาพ'} · เปิด/ปิดบน Program (${ovlKeyLabel(i)})`;
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
    for (const input of inputs) if (input.type === 'cg' && input.cgBus) {
      const slot = ovl.findIndex(c => (c.on || c.staged) && c.inputId === input.id);
      input.cgBus.postMessage({ protocolVersion: 1, type: 'onair:state', channel: input.cg.channel, visible: cgOnAir(input), slot, staged: slot >= 0 && ovl[slot].staged });
    }
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
        <canvas class="layout-preview" width="960" height="540" tabindex="0" aria-label="ลากเพื่อย้าย · ลากมุมเพื่อย่อ/ขยาย · ลากขอบเพื่อครอป"></canvas>
        <p class="note layout-hint">ลากภาพเพื่อย้าย · ลาก<b>มุม</b>เพื่อย่อ/ขยาย · ลาก<b>ขีดกลางขอบ</b>เพื่อครอป · ดับเบิลคลิก = เต็มจอ · ปุ่มลูกศรขยับทีละนิด (Shift = มากขึ้น) · ติดแนวกลาง/ขอบเอง (กด Alt ค้างเพื่อไม่ให้ติด)</p>
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
        // ภาพตัวอย่าง: Program ปัจจุบันจาง ๆ เป็นพื้นหลัง แล้ววาด Input นี้ตามตำแหน่ง — ลากวางได้โดยตรง
        const cv = $('.layout-preview', modal), ctx = cv.getContext('2d');
        const CW = cv.width, CH = cv.height;
        // ขนาดจุดจับเป็นพิกเซลบนจอ (ภาพตัวอย่างถูกย่อลงตามความกว้างหน้าต่าง) — นิ้วได้พื้นที่จับใหญ่กว่าเมาส์
        const px = () => CW / Math.max(1, cv.getBoundingClientRect().width);
        let HS = 12 * px(), drag = null, hover = null, snapLines = [];
        // จุดจับ: มุม 4 จุด (ย่อ/ขยาย) และกลางขอบ 4 จุด (ครอป) บนส่วนที่มองเห็น
        const handles = () => {
          const { vis: v } = layoutRects(L, CW, CH), mx = v.x + v.w / 2, my = v.y + v.h / 2;
          return [['nw', v.x, v.y], ['ne', v.x + v.w, v.y], ['sw', v.x, v.y + v.h], ['se', v.x + v.w, v.y + v.h],
            ['l', v.x, my], ['r', v.x + v.w, my], ['t', mx, v.y], ['b', mx, v.y + v.h]];
        };
        const hitTest = (x, y) => {
          const h = handles().find(([, hx, hy]) => Math.abs(x - hx) <= HS && Math.abs(y - hy) <= HS);
          if (h) return h[0];
          const { vis: v } = layoutRects(L, CW, CH);
          return x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h ? 'move' : null;
        };
        const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', l: 'ew-resize', r: 'ew-resize', t: 'ns-resize', b: 'ns-resize', move: 'move' };
        const toCanvas = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * CW / r.width, (e.clientY - r.top) * CH / r.height]; };
        // ติดแนว: กึ่งกลาง ขอบจอ และขอบปลอดภัย 5% (ห่างไม่เกิน ~1% ของจอ)
        const snapMove = noSnap => {
          snapLines = [];
          if (noSnap) return;
          const { vis: v } = layoutRects(L, CW, CH), th = CW * 0.012;
          const tryAxis = (edges, targets, axis) => {
            let best = null;
            for (const [e, off] of edges) for (const t of targets) { const d = t - e; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; }
            if (!best) return;
            if (axis === 'x') L.x += best.d / CW; else L.y += best.d / CH;
            snapLines.push([axis, best.t]);
          };
          tryAxis([[v.x], [v.x + v.w / 2], [v.x + v.w]], [0, CW * 0.05, CW / 2, CW * 0.95, CW], 'x');
          tryAxis([[v.y], [v.y + v.h / 2], [v.y + v.h]], [0, CH * 0.05, CH / 2, CH * 0.95, CH], 'y');
        };
        cv.addEventListener('pointerdown', e => {
          HS = (e.pointerType === 'touch' ? 22 : 12) * px();
          const [x, y] = toCanvas(e), mode = hitTest(x, y);
          if (!mode) return;
          e.preventDefault();
          cv.setPointerCapture(e.pointerId);
          cv.focus();
          const { box, vis } = layoutRects(L, CW, CH);
          drag = { mode, x0: x, y0: y, L0: JSON.parse(JSON.stringify(L)), box, vis };
        });
        cv.addEventListener('pointermove', e => {
          const [x, y] = toCanvas(e);
          if (!drag) { HS = 12 * px(); hover = hitTest(x, y); cv.style.cursor = CURSOR[hover] || 'default'; return; }
          const d = drag, L0 = d.L0, dx = x - d.x0, dy = y - d.y0;
          if (d.mode === 'move') {
            L.x = L0.x + dx / CW; L.y = L0.y + dy / CH;
            snapMove(e.altKey);
          } else if (d.mode.length === 2) {
            // มุม: มุมตรงข้ามอยู่กับที่ ย่อ/ขยายแบบคงสัดส่วน
            const left = d.mode[1] === 'e', top = d.mode[0] === 's';
            const fx = left ? d.vis.x : d.vis.x + d.vis.w, fy = top ? d.vis.y : d.vis.y + d.vis.h;
            const fw = 1 - L0.crop.l - L0.crop.r, fh = 1 - L0.crop.t - L0.crop.b;
            const s = clamp(Math.max(Math.abs(x - fx) / (CW * fw), Math.abs(y - fy) / (CH * fh)), 0.05, 1);
            const bw = CW * s, bh = CH * s;
            const visX = left ? fx : fx - bw * fw, visY = top ? fy : fy - bh * fh;
            L.scale = s;
            L.x = (visX - bw * L0.crop.l + bw / 2) / CW;
            L.y = (visY - bh * L0.crop.t + bh / 2) / CH;
            snapLines = [];
          } else {
            // ขอบ: ครอปด้านนั้น (กรอบภาพไม่ขยับ)
            const b = d.box, c = L.crop, lim = (v, other) => clamp(v, 0, Math.min(0.45, 0.9 - other));
            if (d.mode === 'l') c.l = lim((x - b.x) / b.w, c.r);
            if (d.mode === 'r') c.r = lim((b.x + b.w - x) / b.w, c.l);
            if (d.mode === 't') c.t = lim((y - b.y) / b.h, c.b);
            if (d.mode === 'b') c.b = lim((b.y + b.h - y) / b.h, c.t);
          }
          L.x = clamp(L.x, -0.5, 1.5); L.y = clamp(L.y, -0.5, 1.5);
          sync();
        });
        const endDrag = () => { drag = null; snapLines = []; };
        cv.addEventListener('pointerup', endDrag);
        cv.addEventListener('pointercancel', endDrag);
        cv.addEventListener('dblclick', () => { Object.assign(L, { x: 0.5, y: 0.5, scale: 1 }); sync(); });
        cv.addEventListener('keydown', e => {
          const step = e.shiftKey ? 0.05 : 0.005, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (!mv) return;
          e.preventDefault(); e.stopPropagation();
          L.x = clamp(L.x + mv[0], -0.5, 1.5); L.y = clamp(L.y + mv[1], -0.5, 1.5);
          sync();
        });
        const draw = () => {
          if (!document.body.contains(cv)) return;
          ctx.clearRect(0, 0, CW, CH);
          ctx.globalAlpha = 0.35; ctx.drawImage(pgmCanvas, 0, 0, CW, CH); ctx.globalAlpha = 1;
          ctx.save(); ctx.globalAlpha = L.opacity; drawLayout(ctx, inp, L, CW, CH); ctx.restore();
          // กรอบที่ครอปออก (จาง) + กรอบที่มองเห็น + จุดจับ
          const { box, vis } = layoutRects(L, CW, CH);
          ctx.save();
          ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
          if (L.crop.l || L.crop.r || L.crop.t || L.crop.b) ctx.strokeRect(box.x, box.y, box.w, box.h);
          ctx.setLineDash([]); ctx.strokeStyle = '#f5a524'; ctx.lineWidth = 2 * px(); ctx.strokeRect(vis.x, vis.y, vis.w, vis.h);
          const u = px();
          for (const [k, hx, hy] of handles()) {
            const r = (k.length === 2 ? 6 : 5) * u;
            ctx.fillStyle = (drag && drag.mode === k) || hover === k ? '#f5a524' : '#fff';
            ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 * u;
            if (k.length === 2) { ctx.fillRect(hx - r, hy - r, r * 2, r * 2); ctx.strokeRect(hx - r, hy - r, r * 2, r * 2); }
            else { ctx.beginPath(); ctx.ellipse(hx, hy, k === 'l' || k === 'r' ? r * 0.6 : r * 1.4, k === 'l' || k === 'r' ? r * 1.4 : r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
          }
          ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5 * px();
          for (const [axis, t] of snapLines) { ctx.beginPath(); if (axis === 'x') { ctx.moveTo(t, 0); ctx.lineTo(t, CH); } else { ctx.moveTo(0, t); ctx.lineTo(CW, t); } ctx.stroke(); }
          ctx.restore();
          requestAnimationFrame(draw);
        };
        draw();
      }
    });
    if (result?.value === 'reset' || isDefaultLayout(inp.layout)) inp.layout = null;
    renderInputs();
  }

  // Title Input
  /* ------------------------------------------------------------ ซีน (หลายแหล่งภาพในจอเดียว)
     ซีนเป็นแหล่งภาพแบบหนึ่ง: ขึ้น Preview/Program, ทรานซิชัน, บันทึก และสตรีมได้เหมือนแหล่งภาพอื่น
     แต่ละช่องวาดแหล่งภาพที่เลือกให้เต็มช่อง (ครอปขอบที่เกิน) — ซีนซ้อนซีนไม่ได้ */
  const SCENE_LAYOUTS = {
    side: { label: 'คู่กัน', slots: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
    pip: { label: 'ภาพซ้อนมุม', slots: [[0, 0, 1, 1], [0.655, 0.625, 0.32, 0.32, 'frame']] },
    grid4: { label: '4 ช่อง', slots: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
    main3: { label: 'ใหญ่ 1 + เล็ก 2', slots: [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]] },
    three: { label: '3 ช่อง', slots: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] }
  };
  function sanitizeScene(sc) {
    const layout = SCENE_LAYOUTS[sc && sc.layout] ? sc.layout : 'side';
    const slots = Array.isArray(sc && sc.slots) ? sc.slots.slice(0, 4).map(v => (typeof v === 'string' && v ? v.slice(0, 40) : null)) : [];
    return { layout, slots, gap: sc ? sc.gap !== false : true };
  }
  // ตำแหน่งแต่ละช่องในกรอบ (x, y, w, h): rect = ช่อง, box = กรอบ 16:9 ที่ครอบช่องไว้ (วาดแล้วตัดส่วนเกิน)
  function sceneSlots(inp, x, y, w, h) {
    const L = SCENE_LAYOUTS[inp.scene.layout] || SCENE_LAYOUTS.side;
    const g = inp.scene.gap ? Math.max(1, w * 0.004) : 0;
    return L.slots.map((sl, i) => {
      const frame = sl[4] === 'frame';
      const inset = frame ? 0 : g / 2;
      const rect = { x: x + sl[0] * w + inset, y: y + sl[1] * h + inset, w: sl[2] * w - inset * 2, h: sl[3] * h - inset * 2 };
      const k = Math.max(rect.w / 16, rect.h / 9), bw = 16 * k, bh = 9 * k;
      const box = { x: rect.x + (rect.w - bw) / 2, y: rect.y + (rect.h - bh) / 2, w: bw, h: bh };
      const c = byId(inp.scene.slots[i]);
      return { rect, box, frame, child: c && c.type !== 'scene' ? c : null, n: i + 1 };
    });
  }
  function drawScene(ctx, inp, w, h) {
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w, h);
    for (const sl of sceneSlots(inp, 0, 0, w, h)) {
      const r = sl.rect;
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      if (sl.child) {
        ctx.translate(sl.box.x, sl.box.y);
        drawSource(ctx, sl.child, sl.box.w, sl.box.h);
      } else {
        ctx.fillStyle = '#171b23'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#5d6578'; ctx.font = `600 ${Math.round(Math.min(r.w, r.h) * 0.12)}px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`ช่อง ${sl.n}`, r.x + r.w / 2, r.y + r.h / 2);
      }
      ctx.restore();
      if (sl.frame) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(2, w / 480); ctx.strokeRect(r.x, r.y, r.w, r.h); }
    }
  }
  // แหล่งภาพในซีนที่ออกอากาศ (Program) — นับว่า "ออกอากาศ" ด้วย (tally, AFV)
  const sceneHas = (sceneId, id) => { const sc = byId(sceneId); return !!(sc && sc.type === 'scene' && id && sc.scene.slots.includes(id)); };

  function addSceneInput() {
    const n = inputs.filter(i => i.type === 'scene').length + 1;
    const cams = inputs.filter(i => i.type !== 'scene').map(i => i.id);
    openSceneDialog(null, { name: `SCENE ${n}`, scene: { layout: 'side', slots: cams.slice(0, 2), gap: true } });
  }
  async function openSceneDialog(inp, draft) {
    const cur = inp ? { name: inp.name, scene: { ...inp.scene, slots: [...inp.scene.slots] } } : draft;
    const sources = inputs.filter(i => i.type !== 'scene');
    const diagram = key => `<span class="sc-diagram">${SCENE_LAYOUTS[key].slots.map(sl => `<i style="left:${sl[0] * 100}%;top:${sl[1] * 100}%;width:${sl[2] * 100}%;height:${sl[3] * 100}%"${sl[4] ? ' class="frame"' : ''}></i>`).join('')}</span>`;
    let layout = cur.scene.layout;
    const r = await dialog({
      title: inp ? 'แก้ไขซีน' : 'ซีนใหม่ — หลายแหล่งภาพในจอเดียว',
      wide: true,
      body: `
        <label class="field"><span>ชื่อซีน</span><input name="name" class="input" maxlength="40" value="${esc(cur.name)}"></label>
        <div class="field"><span>รูปแบบ</span><div class="sc-layouts" role="radiogroup" aria-label="รูปแบบซีน">${Object.entries(SCENE_LAYOUTS).map(([k, L]) => `
          <label class="sc-layout"><input type="radio" name="layout" value="${k}" ${k === layout ? 'checked' : ''}>${diagram(k)}<b>${L.label}</b></label>`).join('')}</div></div>
        <div class="sc-slots"></div>
        <label class="check"><input type="checkbox" name="gap" ${cur.scene.gap ? 'checked' : ''}> เว้นเส้นแบ่งระหว่างช่อง</label>
        ${sources.length ? '' : '<p class="note warn">ยังไม่มีแหล่งภาพให้เลือก — เพิ่มกล้องหรือไฟล์ก่อน แล้วค่อยแก้ไขซีนนี้</p>'}`,
      actions: [{ label: 'ยกเลิก' }, { label: inp ? 'บันทึก' : 'สร้างซีน', primary: true, value: 'save' }],
      onOpen(modal) {
        const box = $('.sc-slots', modal);
        const renderSlots = () => {
          const keep = $$('select[data-slot]', box).map(sel => sel.value);
          const slots = keep.length ? keep : cur.scene.slots;
          box.innerHTML = SCENE_LAYOUTS[layout].slots.map((sl, i) => `
            <label class="field"><span>ช่อง ${i + 1}${i === 0 && layout === 'pip' ? ' (ภาพหลัก)' : i === 1 && layout === 'pip' ? ' (ภาพมุม)' : i === 0 && layout === 'main3' ? ' (ภาพใหญ่)' : ''}</span>
              <select class="select" data-slot="${i}"><option value="">— ว่าง —</option>${sources.map((s2, n2) => `<option value="${s2.id}" ${slots[i] === s2.id ? 'selected' : ''}>${n2 + 1}. ${esc(s2.name)}</option>`).join('')}</select></label>`).join('');
        };
        renderSlots();
        $$('input[name=layout]', modal).forEach(rd => rd.addEventListener('change', () => { layout = rd.value; renderSlots(); }));
      }
    });
    if (r?.value !== 'save') return null;
    const f = r.form;
    const slots = [...f].filter(el => el.dataset && el.dataset.slot !== undefined).map(el => el.value || null);
    const scene = sanitizeScene({ layout: f.layout.value || layout, slots, gap: f.gap.checked });
    const name = String(f.name.value || '').trim().slice(0, 40) || cur.name;
    if (inp) { inp.scene = scene; inp.name = name; renderInputs(); refreshSourceSelects(); updateTally(); return inp; }
    const made = addInput({ type: 'scene', name, scene });
    setPreview(made.id);
    toast(`สร้าง “${name}” แล้ว — อยู่ใน Preview กด CUT เพื่อขึ้นจอ`, 'success');
    return made;
  }

  /* ---- พื้นหลังด้วย AI (MediaPipe Image Segmenter, โมเดล selfie แนวนอน 256×144) ----
     ตัดคนออกจากพื้นหลังทุกเฟรมในเครื่อง แล้ว เบลอพื้นหลัง / ใส่ภาพอื่นแทน / ทำโปร่งใส (ใช้ซ้อนบนสไลด์)
     โหลดตัวประมวลผลและโมเดลครั้งแรกจาก CDN (ต้องต่อเน็ต) — หลังจากนั้นเบราว์เซอร์เก็บไว้ */
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
    for (const inp of inputs) {
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
      if (now - st.last < Math.max(1000 / Math.min(30, settings.fps) - 2, (st.cost || 0) * 3)) continue;
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
      const src = byId(inp.bg.imageId);
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
    const cams = inputs.filter(x => BG_TYPES.includes(x.type));
    const imgs = inputs.filter(x => x.id !== inp.id && (x.type === 'image' || x.type === 'media'));
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
          if (e.target.name === 'cam' && e.target.value !== inp.id) { close(); const o = byId(e.target.value); if (o) setTimeout(() => openBgDialog(o), 0); }
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
          $('.ab-stat', modal).textContent = st && st.ready ? `${(st.cost || 0).toFixed(1)} ms ต่อมาสก์ · ภาพ ${Math.round(fps)} fps` : '';
          setTimeout(tick, 66);
        };
        tick();
        const rb = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'รีเซ็ต');
        const rc = rb.cloneNode(true); rb.replaceWith(rc);
        rc.addEventListener('click', () => { const d = sanitizeBg({ mode: f.mode.value }); f.feather.value = d.feather; f.sensUi.value = Math.round((0.65 - d.sens) / 0.6 * 100); $$('[name=quality]', modal).forEach(x => { x.checked = x.value === d.quality; }); apply(); });
      }
    });
    if (r?.value !== 'save') { inp.bg = before; return; }
    renderInputs();
  }

  /* ---- สไลด์ PDF: เปิดด้วย pdf.js (อยู่ในแอป ใช้ได้แม้ไม่มีเน็ต) วาดทีละหน้าเป็นภาพตามความละเอียดเอาต์พุต
     เตรียมหน้าถัดไป/ก่อนหน้าไว้ล่วงหน้า กดเปลี่ยนหน้าแล้วภาพเปลี่ยนทันที · PowerPoint / Keynote / Google Slides → บันทึกเป็น PDF ก่อน */
  let pdfjsLoading = null;
  function loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsLoading) {
      pdfjsLoading = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'assets/vendor/pdfjs-3.11.174.min.js';
        el.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdfjs-3.11.174.worker.min.js'; resolve(window.pdfjsLib); };
        el.onerror = () => { pdfjsLoading = null; reject(new Error('โหลดตัวเปิด PDF ไม่สำเร็จ')); };
        document.head.appendChild(el);
      });
    }
    return pdfjsLoading;
  }
  const slideCanvas = inp => inp.slideCache && inp.slideCache.get(inp.slides.page) || inp.slideShown || null;
  function createSlidesInput(props, page = 1) {
    return addInput({ type: 'slides', status: 'nosignal', ...props, slides: { page, count: 0 }, slideCache: new Map(), slideShown: null });
  }
  async function loadSlides(inp, file, store) {
    try {
      const lib = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await lib.getDocument({ data, isEvalSupported: false }).promise;
      if (inp.removed) { pdf.destroy(); return; }
      if (inp.pdf) { try { inp.pdf.destroy(); } catch (e) {} }
      inp.pdf = pdf;
      inp.slideCache = new Map();
      inp.slides.count = pdf.numPages;
      inp.slides.page = clamp(inp.slides.page, 1, pdf.numPages);
      if (file.name && file.name !== inp.id) inp.fileName = file.name;
      inp.missing = false;
      await renderSlide(inp, inp.slides.page);
      inp.slideShown = inp.slideCache.get(inp.slides.page) || null;
      setInputStatus(inp, 'live');
      renderInputs();
      prefetchSlides(inp);
      if (store) mediaStore.put(inp.id, file).then(ok => { if (!ok && !inp.removed) toast(`พื้นที่ในเบราว์เซอร์ไม่พอเก็บ “${inp.fileName}” — เปิดหน้าใหม่แล้วต้องเลือกไฟล์นี้อีกครั้ง`, 'warn', 7000); });
      return true;
    } catch (e) {
      toast(`เปิด “${file.name || inp.name}” ไม่ได้: ${/password/i.test(e.name || e.message) ? 'PDF มีรหัสผ่าน' : 'ไม่ใช่ไฟล์ PDF ที่อ่านได้'}`, 'error', 6000);
      return false;
    }
  }
  // วาดหน้าเป็นภาพขนาดพอดีเอาต์พุต (สูงสุด 1080p — ตัวอักษรคมพอและไม่กินหน่วยความจำ)
  async function renderSlide(inp, n) {
    if (!inp.pdf || inp.slideCache.has(n)) return;
    const busy = inp.slideBusy || (inp.slideBusy = new Map());
    if (busy.has(n)) return busy.get(n);
    const job = (async () => {
      const page = await inp.pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const tw = Math.min(W, 1920), th = Math.round(tw * H / W);
      const vp = page.getViewport({ scale: Math.min(tw / base.width, th / base.height) });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: cx, viewport: vp }).promise;
      page.cleanup();
      inp.slideCache.set(n, c);
    })().finally(() => busy.delete(n));
    busy.set(n, job);
    return job;
  }
  // เก็บไว้เฉพาะหน้าใกล้ ๆ หน้าปัจจุบัน
  function prefetchSlides(inp) {
    const p = inp.slides.page;
    for (const k of inp.slideCache.keys()) if (Math.abs(k - p) > 2) inp.slideCache.delete(k);
    for (const n of [p + 1, p - 1, p + 2]) if (n >= 1 && n <= inp.slides.count) renderSlide(inp, n).catch(() => {});
  }
  async function slideGo(inp, n) {
    if (!inp.pdf) return;
    n = clamp(n, 1, inp.slides.count);
    if (n === inp.slides.page) return;
    inp.slides.page = n;
    if (!inp.slideCache.has(n)) await renderSlide(inp, n).catch(() => {});
    if (inp.slides.page !== n || inp.removed) return;
    inp.slideShown = inp.slideCache.get(n) || inp.slideShown;
    const sub = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
    if (sub) sub.textContent = cardSub(inp);
    prefetchSlides(inp);
  }
  function slideStep(d) {
    const on = byId(state.programId), pv = byId(state.previewId);
    const inp = on && on.type === 'slides' && on.pdf ? on : pv && pv.type === 'slides' && pv.pdf ? pv : inputs.find(i => i.type === 'slides' && i.pdf && onOverlay(i.id));
    if (!inp) return false;
    slideGo(inp, inp.slides.page + d);
    return true;
  }
  function addSlidesFiles(files) {
    for (const file of files.slice(0, 4)) {
      const inp = createSlidesInput({ name: baseName(file.name || 'SLIDES') });
      loadSlides(inp, file, true).then(ok => {
        if (ok) toast(`เปิดสไลด์ ${inp.slides.count} หน้าแล้ว — กด ‹ › บนการ์ด, ลูกศร ← → หรือรีโมตพรีเซนต์เพื่อเปลี่ยนหน้า`, 'success', 5000);
        else { disposeInput(inp, true); resetAfterRemoval(inp.id); renderInputs(); refreshSourceSelects(); }
      });
    }
  }
  async function openSlidesDialog(inp) {
    const r = await dialog({
      title: `สไลด์ — ${inp.name}`,
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        <label class="field"><span>ไปที่หน้า (1–${inp.slides.count || 1})</span><input name="page" class="input mono" type="number" min="1" max="${inp.slides.count || 1}" value="${inp.slides.page}"></label>
        <p class="note">ไฟล์: ${esc(inp.fileName || '—')}${inp.slides.count ? ` · ${inp.slides.count} หน้า` : ''}<br>
        PowerPoint / Keynote / Google Slides: บันทึกหรือดาวน์โหลดเป็น PDF แล้วเปิดไฟล์นั้น (แอนิเมชันในสไลด์จะไม่ขยับ)<br>
        เปลี่ยนหน้า: ‹ › บนการ์ด · ปุ่มลูกศร ← → หรือ Page Up/Down (รีโมตพรีเซนต์ส่วนใหญ่ใช้ปุ่มเหล่านี้) · ตั้งปุ่ม MIDI ได้</p>`,
      actions: [{ label: 'เปลี่ยนไฟล์…', value: 'file' }, { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }]
    });
    if (r?.value === 'file') { relinkInput(inp); return; }
    if (r?.value !== 'save') return;
    inp.name = String(r.form.name.value || '').trim().slice(0, 40) || inp.name;
    renderInputs(); refreshSourceSelects();
    await slideGo(inp, +r.form.page.value || 1);
  }

  /* ---- Instant Replay: บัฟเฟอร์ภาพย้อนหลังตลอดเวลา กด ⟲ (หรือ I) แล้วได้คลิป N วินาทีล่าสุดใน Preview
     ตัดขึ้นจอแล้วเล่น (สโลว์ได้) จบคลิปแล้วกลับภาพเดิมให้อัตโนมัติ
     บัฟเฟอร์: MediaRecorder 2 ตัวสลับกันเริ่มใหม่ทุก N วินาที → ตัวเก่ามีภาพย้อนหลัง N–2N วินาทีเสมอ (หน่วยความจำคงที่)
     แหล่ง: Program (ย่อเหลือ ≤960px) หรือกล้อง/แหล่งภาพสดตัวเดียว */
  const REPLAY_LENS = [5, 8, 12, 20];
  const REPLAY_SPEEDS = [1, 0.75, 0.5, 0.25];
  const speedLabel = v => v === 1 ? '1×' : v === 0.75 ? '¾×' : v === 0.5 ? '½×' : '¼×';
  const replayFeed = { canvas: document.createElement('canvas'), stream: null, users: 0 };
  replayFeed.ctx = replayFeed.canvas.getContext('2d');
  function sanitizeReplay(r) {
    r = r || {};
    return { len: REPLAY_LENS.includes(+r.len) ? +r.len : 8, speed: REPLAY_SPEEDS.includes(+r.speed) ? +r.speed : 0.5,
      source: typeof r.source === 'string' && r.source ? r.source.slice(0, 40) : 'program', autoReturn: r.autoReturn !== false, sting: !!r.sting };
  }
  function replayStream(inp) {
    if (inp.replay.source !== 'program') {
      const src = byId(inp.replay.source);
      const t = src && src.stream && src.stream.getVideoTracks().find(x => x.readyState === 'live');
      if (t) return new MediaStream([t]);
    }
    if (!replayFeed.stream) {
      const w = Math.min(960, W), h = Math.round(w * H / W / 2) * 2;
      replayFeed.canvas.width = w; replayFeed.canvas.height = h;
      replayFeed.stream = replayFeed.canvas.captureStream(Math.min(30, settings.fps));
    }
    replayFeed.users++;
    inp.rbProgram = true;
    return replayFeed.stream;
  }
  // เรียกทุกเฟรมหลังวาด Program
  function feedReplay() {
    if (!replayFeed.users) return;
    const c = replayFeed.canvas;
    replayFeed.ctx.drawImage(pgmCanvas, 0, 0, c.width, c.height);
  }
  function replayStart(inp) {
    replayStop(inp);
    if (!window.MediaRecorder || (window.WebMix.wcrec && window.WebMix.wcrec.preferred())) { inp.rbError = 'เครื่องนี้บันทึกภาพย้อนหลังไม่ได้'; return; }
    const mime = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const stream = replayStream(inp);
    const rb = inp.rb = { recs: [], mime, stop: null };
    const spawn = () => {
      if (inp.removed || inp.rb !== rb) return;
      try {
        const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 5000000 });
        const rec = { r, chunks: [], t0: performance.now(), type: r.mimeType || mime || 'video/webm' };
        r.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
        r.start(250);
        rb.recs.push(rec);
      } catch (e) { inp.rbError = e.message; }
      while (rb.recs.length > 2) { const old = rb.recs.shift(); try { old.r.stop(); } catch (e) {} old.chunks = []; }
    };
    spawn();
    const ms = inp.replay.len * 1000;
    rb.stop = window.WebMix.wcrec && window.WebMix.wcrec.every ? window.WebMix.wcrec.every(spawn, ms) : (id => () => clearInterval(id))(setInterval(spawn, ms));
  }
  function replayStop(inp) {
    const rb = inp.rb;
    if (!rb) return;
    inp.rb = null;
    if (rb.stop) rb.stop();
    for (const rec of rb.recs) { try { rec.r.stop(); } catch (e) {} rec.chunks = []; }
    if (inp.rbProgram) { inp.rbProgram = false; replayFeed.users = Math.max(0, replayFeed.users - 1); }
  }
  // ทำให้ WebM จาก MediaRecorder (ยังไม่จบ) เลื่อนตำแหน่งเล่นได้: เติมความยาว + Cues
  async function seekableClip(blob, type) {
    if (!type.includes('webm') || !window.WebmSeek) return blob;
    try {
      const fix = new WebmSeek.WebmSeekFix();
      const parts = fix.push(new Uint8Array(await blob.arrayBuffer()));
      const n = parts.reduce((a, x) => a + x.byteLength, 0);
      const done = fix.finish(n);
      if (!done) return blob;
      const out = new Uint8Array(n + done.tail.byteLength);
      let at = 0;
      for (const x of [...parts, done.tail]) { out.set(x, at); at += x.byteLength; }
      for (const pt of done.patches) out.set(pt.data, pt.position);
      return new Blob([out], { type });
    } catch (e) { return blob; }
  }
  async function replayCapture(inp) {
    if (!inp) {
      inp = inputs.find(i => i.type === 'replay');
      if (!inp) { toast('เพิ่มแหล่งภาพ “Instant Replay” ก่อน (เพิ่มแหล่งภาพ → Instant Replay)', 'warn'); return; }
    }
    if (inp.capturing) return;
    const rec = inp.rb && inp.rb.recs[0];
    if (!rec) { toast(inp.rbError || 'ยังไม่มีภาพย้อนหลัง', 'warn'); return; }
    if (state.programId === inp.id) { toast('รีเพลย์กำลังออกอากาศอยู่ — ตัดออกก่อนแล้วค่อยจับภาพใหม่', 'warn'); return; }
    inp.capturing = true;
    try {
      try { rec.r.requestData(); } catch (e) {}
      await new Promise(r => setTimeout(r, 150));
      const age = (performance.now() - rec.t0) / 1000;
      if (!rec.chunks.length || age < 1) { toast('ภาพย้อนหลังยังไม่พอ — รอสักครู่แล้วกดใหม่', 'warn'); return; }
      const clip = await seekableClip(new Blob(rec.chunks, { type: rec.type }), rec.type);
      if (inp.removed) return;
      if (inp.url && !(inp.clips || []).some(c => c.url === inp.url)) URL.revokeObjectURL(inp.url);
      inp.url = URL.createObjectURL(clip);
      const v = inp.el;
      v.pause();
      await new Promise(res => { v.onloadedmetadata = res; v.onerror = res; v.src = inp.url; setTimeout(res, 3000); });
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : age;
      inp.clipStart = Math.max(0, dur - inp.replay.len);
      inp.clipLen = dur - inp.clipStart;
      // เก็บคลิปล่าสุด 6 คลิปไว้เลือกเล่นซ้ำ (ไฮไลต์)
      const clips = inp.clips || (inp.clips = []);
      clips.unshift({ url: inp.url, name: `ไฮไลต์ ${(inp.clipNo = (inp.clipNo || 0) + 1)}`, start: inp.clipStart, len: inp.clipLen, at: Date.now() });
      while (clips.length > 6) { const old = clips.pop(); if (old.url !== inp.url) URL.revokeObjectURL(old.url); }
      v.playbackRate = inp.replay.speed;
      v.currentTime = inp.clipStart;
      setInputStatus(inp, 'live');
      setPreview(inp.id);
      toast(`รีเพลย์ ${inp.clipLen.toFixed(1)} วินาทีอยู่ใน Preview — กด AUTO / CUT เพื่อเล่นบนจอ`, 'success', 4000);
    } finally { inp.capturing = false; }
  }
  // เริ่มเล่นเมื่อรีเพลย์กำลังขึ้นจอ (CUT / AUTO / T-Bar) — จำภาพเดิมไว้กลับไปตอนจบ
  // โหลดคลิปที่เก็บไว้กลับมาเป็นรีเพลย์ปัจจุบัน
  async function replayUseClip(inp, c) {
    const v = inp.el;
    v.pause();
    inp.url = c.url;
    await new Promise(res => { v.onloadedmetadata = res; v.onerror = res; v.src = c.url; setTimeout(res, 3000); });
    inp.clipStart = c.start; inp.clipLen = c.len;
    v.playbackRate = inp.replay.speed;
    v.currentTime = c.start;
    setInputStatus(inp, 'live');
  }
  function replayGoingOn(id) {
    const inp = byId(id);
    if (!inp || inp.type !== 'replay' || inp.status !== 'live' || !inp.el.paused) return;
    // จุด OUT: หยุดเมื่อถึงปลายช่วงที่เลือก แล้วทำเหมือนเล่นจบ
    if (!inp.outWatch) {
      inp.outWatch = true;
      inp.el.addEventListener('timeupdate', () => { const v = inp.el; if (inp.clipLen && !v.paused && v.currentTime >= inp.clipStart + inp.clipLen - 0.02 && v.currentTime < v.duration - 0.05) { v.pause(); replayEnded(inp); } });
    }
    inp.returnTo = state.programId !== id ? state.programId : null;
    inp.el.currentTime = inp.clipStart || 0;
    inp.el.playbackRate = inp.replay.speed;
    inp.el.play().catch(() => {});
  }
  function replayEnded(inp) {
    if (state.programId !== inp.id || !inp.replay.autoReturn || !byId(inp.returnTo)) return;
    if (tr.auto) return;
    setPreview(inp.returnTo);
    replayAuto(inp);
  }
  // AUTO ของรีเพลย์: ถ้าตั้ง “ใส่ Stinger” ไว้ ใช้ Stinger ทั้งตอนเข้าและออก แล้วคืนเอฟเฟกต์เดิม
  function replayAuto(inp) {
    if (inp.replay.sting && stinger.ready && settings.transition !== 'stinger') {
      const prev = settings.transition;
      settings.transition = 'stinger';
      autoTransition();
      settings.transition = prev;
    } else autoTransition();
  }
  function createReplayInput(props) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    pool.appendChild(v);
    const inp = addInput({ type: 'replay', status: 'nosignal', ...props, replay: sanitizeReplay(props.replay), el: v });
    v.addEventListener('ended', () => replayEnded(inp));
    replayStart(inp);
    return inp;
  }
  function addReplayInput() {
    const n = inputs.filter(i => i.type === 'replay').length + 1;
    const inp = createReplayInput({ name: n > 1 ? `REPLAY ${n}` : 'REPLAY' });
    toast('เริ่มเก็บภาพย้อนหลังแล้ว — กด ⟲ บนการ์ด (หรือปุ่ม I) เมื่อต้องการรีเพลย์', 'success', 5000);
    return inp;
  }
  // Instant Replay + Stinger: ภาพรีเพลย์ · ช่วง IN / OUT · ความเร็ว · คลิปไฮไลต์ · ตั้งค่า · Stinger
  async function openReplayDialog(inp) {
    const cur = inp.replay;
    const sources = inputs.filter(i => i.stream && i.type !== 'replay');
    const pct = v => `${Math.round(v * 100)}%`;
    let stPicked = null;
    const r = await dialog({
      title: 'Instant Replay และ Stinger',
      wide: true,
      body: `<div class="rp-wrap">
        <div class="rp-left">
          <section class="rp-card"><div class="rp-h"><h3>Instant Replay</h3><span class="rp-buf"></span></div>
            <div class="rp-view"><canvas width="960" height="540" aria-label="ภาพรีเพลย์"></canvas><span class="rp-badge"></span></div>
            <div class="rp-tl" aria-label="ช่วงรีเพลย์"><div class="rp-range"></div><span class="rp-head"></span></div>
            <div class="rp-ctl">
              <button type="button" class="btn btn-sm rp-in" data-rp="in">IN</button><button type="button" class="btn btn-sm rp-out" data-rp="out">OUT</button>
              ${REPLAY_SPEEDS.slice().reverse().map(x => `<button type="button" class="btn btn-sm rp-spd ${x === cur.speed ? 'is-on' : ''}" data-spd="${x}">${pct(x)}</button>`).join('')}
              <span class="rp-gap"></span>
              <button type="button" class="btn btn-sm" data-rp="cap">⟲ จับ ${cur.len} วิล่าสุด (I)</button>
              <button type="button" class="btn btn-sm btn-danger" data-rp="air">เล่นรีเพลย์ออก Program</button>
            </div>
          </section>
          <div class="rp-clips"></div>
        </div>
        <div class="rp-right">
          <section class="rp-card"><div class="rp-h"><h3>ตั้งค่ารีเพลย์</h3></div>
            <label class="field"><span>ชื่อ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
            <div class="rp-two">
              <label class="field"><span>ภาพที่เก็บย้อนหลัง</span><select name="source" class="select">
                <option value="program">Program (ภาพที่ออกอากาศ)</option>
                ${sources.map(s2 => `<option value="${s2.id}" ${cur.source === s2.id ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}</select></label>
              <label class="field"><span>ความยาวรีเพลย์</span><select name="len" class="select">${REPLAY_LENS.map(l => `<option value="${l}" ${l === cur.len ? 'selected' : ''}>${l} วินาที</option>`).join('')}</select></label>
            </div>
            <label class="field rp-hide"><span>ความเร็ว</span><select name="speed" class="select">${REPLAY_SPEEDS.map(x => `<option value="${x}" ${x === cur.speed ? 'selected' : ''}>${pct(x)}</option>`).join('')}</select></label>
            <label class="check"><input type="checkbox" name="autoReturn" ${cur.autoReturn ? 'checked' : ''}> เล่นจบแล้วกลับภาพเดิมอัตโนมัติ</label>
            <label class="check"><input type="checkbox" name="sting" ${cur.sting ? 'checked' : ''}> ใส่ Stinger ก่อน / หลังรีเพลย์</label>
            <p class="note">${inp.rbError ? esc(inp.rbError) : 'ปุ่มลัด: I = จับรีเพลย์ · เก็บภาพย้อนหลังในหน่วยความจำ ไม่บันทึกลงดิสก์'}</p></section>
          <section class="rp-card"><div class="rp-h"><h3>Stinger (วิดีโอเปลี่ยนภาพ)</h3><span class="rp-st-state"></span></div>
            <div class="rp-st"><button type="button" class="btn btn-sm" data-st-pick>เลือกไฟล์…</button><b class="st-name">${esc(settings.stinger.name || 'ยังไม่ได้เลือก')}</b></div>
            <label class="field"><span>จุดตัดภาพ <b class="st-cut mono">${Math.round(settings.stinger.cutAt * 100)}%</b> ของความยาว</span><input type="range" class="range" name="cutAt" min="5" max="95" step="1" value="${Math.round(settings.stinger.cutAt * 100)}"></label>
            <p class="note">รองรับ .webm (พื้นโปร่งใส) และ .mp4 · ภาพสลับตอนวิดีโอบังเต็มจอ · ใช้กับปุ่ม AUTO เมื่อเลือกเอฟเฟกต์ STING</p></section>
        </div>
      </div>`,
      actions: [{ label: 'ล้างคลิป', value: 'clear' }, { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        modal.classList.add('rp-modal');
        const f = $('form', modal).elements, v = inp.el;
        const cx = $('.rp-view canvas', modal).getContext('2d');
        const paintClips = () => {
          const L = inp.clips || [];
          $('.rp-clips', modal).innerHTML = L.length ? L.map((c, i) => `<button type="button" class="rp-clip ${c.url === inp.url ? 'is-on' : ''}" data-clip="${i}"><b>${esc(c.name)}</b><span class="mono">${c.len.toFixed(1)} วิ</span></button>`).join('')
            : '<p class="note">คลิปที่จับไว้จะเก็บที่นี่ (ล่าสุด 6 คลิป)</p>';
        };
        paintClips();
        const tick = () => {
          if (!modal.isConnected) return;
          drawSource(cx, inp, 960, 540);
          const dur = isFinite(v.duration) ? v.duration : 0;
          const rec = inp.rb && inp.rb.recs[0];
          $('.rp-buf', modal).innerHTML = rec ? `<span class="rp-rec">บัฟเฟอร์ ${Math.min(cur.len, Math.round((performance.now() - rec.t0) / 1000))} วิ · กำลังเก็บ</span>` : `<span class="rp-off">${esc(inp.rbError || 'ไม่ได้เก็บภาพ')}</span>`;
          $('.rp-badge', modal).textContent = inp.status === 'live' ? `REPLAY ${pct(cur.speed)}` : 'ยังไม่มีคลิป';
          if (dur) {
            const a = (inp.clipStart || 0) / dur, b = ((inp.clipStart || 0) + (inp.clipLen || dur)) / dur;
            Object.assign($('.rp-range', modal).style, { left: `${a * 100}%`, width: `${Math.max(0, b - a) * 100}%` });
            $('.rp-head', modal).style.left = `${(v.currentTime / dur) * 100}%`;
          }
          $('.rp-st-state', modal).textContent = stinger.ready ? `${stinger.el.duration.toFixed(1)} วิ` : '';
          requestAnimationFrame(tick);
        };
        tick();
        // คลิกบนแถบเวลา = เลื่อนไปจุดนั้น (ดูก่อนตั้ง IN / OUT)
        $('.rp-tl', modal).addEventListener('pointerdown', e => {
          const dur = isFinite(v.duration) ? v.duration : 0;
          if (!dur) return;
          const rc = e.currentTarget.getBoundingClientRect();
          v.currentTime = clamp((e.clientX - rc.left) / rc.width, 0, 1) * dur;
        });
        modal.addEventListener('click', async e => {
          const sp = e.target.closest('[data-spd]');
          if (sp) { cur.speed = +sp.dataset.spd; f.speed.value = sp.dataset.spd; v.playbackRate = cur.speed; $$('.rp-spd', modal).forEach(b => b.classList.toggle('is-on', b === sp)); renderInputs(); return; }
          const clip = e.target.closest('[data-clip]');
          if (clip) { await replayUseClip(inp, inp.clips[+clip.dataset.clip]); paintClips(); return; }
          const a = e.target.closest('[data-rp]')?.dataset.rp;
          const dur = isFinite(v.duration) ? v.duration : 0;
          if (a === 'in' && dur) { const end = (inp.clipStart || 0) + (inp.clipLen || dur); inp.clipStart = Math.min(v.currentTime, end - 0.2); inp.clipLen = end - inp.clipStart; }
          else if (a === 'out' && dur) { inp.clipLen = Math.max(0.2, v.currentTime - (inp.clipStart || 0)); }
          else if (a === 'cap') { await replayCapture(inp); paintClips(); }
          else if (a === 'air') {
            if (inp.status !== 'live') { toast('ยังไม่มีคลิป — กด “จับ” ก่อน', 'warn'); return; }
            if (state.programId === inp.id) return;
            audio.ensure();
            state.previewId = inp.id;
            replayAuto(inp);
          }
          if ((a === 'in' || a === 'out') && inp.clips?.[0]?.url === inp.url) Object.assign(inp.clips.find(c => c.url === inp.url), { start: inp.clipStart, len: inp.clipLen });
          if (a === 'in' || a === 'out') paintClips();
        });
        const cutIn = f.cutAt;
        cutIn.addEventListener('input', () => { $('.st-cut', modal).textContent = cutIn.value + '%'; });
        $('[data-st-pick]', modal).addEventListener('click', () => pickFiles('video/*', files => { stPicked = files[0] || null; if (stPicked) $('.st-name', modal).textContent = stPicked.name; }));
        // “ล้างคลิป” ไม่ปิดหน้าต่าง
        const cb = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'ล้างคลิป');
        const cc = cb.cloneNode(true); cb.replaceWith(cc);
        cc.addEventListener('click', () => { for (const c of inp.clips || []) if (c.url !== inp.url) URL.revokeObjectURL(c.url); inp.clips = (inp.clips || []).filter(c => c.url === inp.url).slice(0, 1); paintClips(); });
      }
    });
    if (r?.value !== 'save') return;
    const f = r.form;
    const next = sanitizeReplay({ len: f.len.value, speed: f.speed.value, source: f.source.value, autoReturn: f.autoReturn.checked, sting: f.sting.checked });
    const restart = next.len !== cur.len || next.source !== cur.source;
    inp.replay = next;
    inp.name = String(f.name.value || '').trim().slice(0, 40) || inp.name;
    inp.el.playbackRate = next.speed;
    if (restart) replayStart(inp);
    settings.stinger.cutAt = clamp(+f.cutAt.value / 100, 0.05, 0.95);
    if (stPicked) {
      if (await loadStinger(stPicked)) {
        settings.stinger.name = stPicked.name.slice(0, 80);
        mediaStore.put('stinger', stPicked).then(ok => { if (!ok) toast('พื้นที่ในเบราว์เซอร์ไม่พอเก็บไฟล์ Stinger — เปิดหน้าใหม่แล้วต้องเลือกอีกครั้ง', 'warn', 6000); });
      } else toast(`เปิดวิดีโอ “${stPicked.name}” ไม่ได้ — ลองไฟล์ WebM หรือ MP4`, 'error');
    }
    saveSettings();
    renderInputs(); refreshSourceSelects();
  }

  /* ---- ควบคุมภายนอกด้วย MIDI (คอนโทรลเลอร์ USB / ปุ่มกด / เฟดเดอร์) ----
     ตั้งค่า → ควบคุม: กด "สอน" ข้างคำสั่ง แล้วกดปุ่มหรือขยับเฟดเดอร์บนคอนโทรลเลอร์ — จำไว้ในเครื่องนี้
     ปุ่ม (Note / CC ≥ 64) = สั่งงาน · เฟดเดอร์/ปุ่มหมุน (CC 0–127) = T-Bar, เสียง Master, เสียงช่อง 1–8 */
  const midi = { access: null, learn: null, onLearn: null, last: '', ccHigh: new Map(), error: '' };
  const MIDI_ACTIONS = () => {
    const pick = (n, take) => { const inp = inputs[n - 1]; if (!inp || inp.id === state.programId) return; audio.ensure(); if (take) { state.previewId = inp.id; cut(); } else setPreview(inp.id); };
    const strip = n => n === 0 ? audio.masterStrip : audio.channels[n - 1];
    const fade = n => v => {
      const ch = strip(n);
      if (!ch) return;
      ch.db = posToDb(v);
      n === 0 ? audio.applyMaster() : audio.applyGain(ch);
      ch.ui?.fader?.set(v * 100);
      if (ch.ui?.db) ch.ui.db.textContent = `${fmtDb(ch.db)} dB`;
    };
    const nums = [1, 2, 3, 4, 5, 6, 7, 8];
    return [
      ['cut', 'CUT', cut], ['auto', 'AUTO', autoTransition], ['ftb', 'FTB (จอดำ)', toggleFtb],
      ['tbar', 'T-Bar', null, v => { onTbar(v * 100); tbar.set(tr.base === 0 ? tr.progress * 100 : 100 - tr.progress * 100); }],
      ['replay', 'Instant Replay', () => replayCapture()],
      ['slnext', 'สไลด์ถัดไป', () => slideStep(1)], ['slprev', 'สไลด์ก่อนหน้า', () => slideStep(-1)],
      ...nums.map(n => [`mac${n}`, `Macro ${n}`, () => { if (macros[n - 1]) runMacro(macros[n - 1]); }]),
      ['rec', 'เริ่ม / หยุดบันทึก', toggleRecord],
      ...nums.map(n => [`sfx${n}`, `เสียงเอฟเฟกต์ ${n}`, () => { const ch = padChannel(); if (ch) padFire(ch, n - 1); }]),
      ['chathide', 'ซ่อนคอมเมนต์บนจอ', () => chatHide()],
      ['captions', 'คำบรรยายสด: เริ่ม / หยุด', () => { const l = inputs.filter(i => i.type === 'captions'); const on = l.some(i => i.capRun?.on); l.forEach(i => on ? captionStop(i) : captionStart(i)); renderInputs(); }],
      ['music', 'เครื่องเล่นเพลง: เล่น / หยุด', () => audio.channels.find(c => c.kind === 'player')?.src.toggle()],
      ['musicnext', 'เครื่องเล่นเพลง: เพลงถัดไป', () => audio.channels.find(c => c.kind === 'player')?.src.next()],
      ...nums.map(n => [`pvw${n}`, `Preview ${n}`, () => pick(n, false)]),
      ...nums.map(n => [`pgm${n}`, `ตัดเข้า Program ${n}`, () => pick(n, true)]),
      ...ovl.map((c, i) => [`ovl${i + 1}`, `Overlay ${c.n}`, () => setChannel(i, !ovl[i].on)]),
      ['master', 'เสียง Master', null, fade(0)],
      ...nums.map(n => [`vol${n}`, `เสียงช่อง ${n}`, null, fade(n)])
    ];
  };
  function midiMessage(e) {
    const [st, d1 = 0, d2 = 0] = e.data;
    const kind = st & 0xf0, ch = (st & 0x0f) + 1;
    let id, on = false, value = null;
    if (kind === 0x90 && d2 > 0) { id = `note:${ch}:${d1}`; on = true; }
    else if (kind === 0xb0) {
      id = `cc:${ch}:${d1}`; value = d2 / 127;
      const high = d2 >= 64, was = midi.ccHigh.get(id);
      midi.ccHigh.set(id, high);
      on = high && !was;
    } else return;
    midi.last = id;
    if (midi.learn) {
      // ปุ่ม CC ส่งค่า 0 ตอนปล่อย — สอนจากค่าที่กดเท่านั้น ยกเว้นคำสั่งแบบเฟดเดอร์
      const act = MIDI_ACTIONS().find(a => a[0] === midi.learn);
      if (!act || (!act[3] && !on)) return;
      for (const [k, v] of Object.entries(settings.midi.map)) if (v === id) delete settings.midi.map[k];
      settings.midi.map[midi.learn] = id;
      saveSettings();
      const done = midi.learn;
      midi.learn = null;
      if (midi.onLearn) midi.onLearn(done, id);
      return;
    }
    const key = Object.keys(settings.midi.map).find(k => settings.midi.map[k] === id);
    if (!key) return;
    const act = MIDI_ACTIONS().find(a => a[0] === key);
    if (!act) return;
    if (act[3] && value !== null) act[3](value);
    else if (act[2] && on) { audio.ensure(); act[2](); }
  }
  const midiDevices = () => midi.access ? [...midi.access.inputs.values()].filter(i => i.state !== 'disconnected').map(i => i.name || 'MIDI') : [];
  async function midiEnable() {
    if (midi.access) return true;
    if (!navigator.requestMIDIAccess) { midi.error = 'เบราว์เซอร์นี้ไม่รองรับ MIDI (ใช้ Chrome / Edge)'; return false; }
    try {
      midi.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) { midi.error = 'ไม่ได้รับอนุญาตให้ใช้ MIDI'; return false; }
    const hook = () => { for (const i of midi.access.inputs.values()) i.onmidimessage = midiMessage; if (midi.onDevices) midi.onDevices(); };
    midi.access.onstatechange = hook;
    hook();
    return true;
  }
  function midiDisable() {
    if (!midi.access) return;
    for (const i of midi.access.inputs.values()) i.onmidimessage = null;
    midi.access.onstatechange = null;
    midi.access = null;
  }
  const midiLabel = id => {
    if (!id) return '—';
    const [k, ch, n] = id.split(':');
    return `${k === 'note' ? 'Note' : 'CC'} ${n}${ch !== '1' ? ` · ch${ch}` : ''}`;
  };
  function midiPaneHtml() {
    return `
          <label class="check"><input type="checkbox" class="midi-on" ${settings.midi.on ? 'checked' : ''}> ใช้คอนโทรลเลอร์ MIDI (เสียบ USB แล้วเปิดตัวเลือกนี้)</label>
          <p class="note midi-dev"></p>
          <div class="midi-list">${MIDI_ACTIONS().map(([k, label, , cont]) => `
            <div class="midi-row" data-midi="${k}"><span>${label}${cont ? ' <small>(เฟดเดอร์/ปุ่มหมุน)</small>' : ''}</span>
              <b class="mono midi-map">${midiLabel(settings.midi.map[k])}</b>
              <button type="button" class="btn btn-sm midi-learn">สอน</button>
              <button type="button" class="btn btn-sm btn-ghost midi-clear" ${settings.midi.map[k] ? '' : 'hidden'} title="ลบการจับคู่">✕</button></div>`).join('')}</div>
          <p class="note">กด “สอน” แล้วกดปุ่ม หรือขยับเฟดเดอร์บนคอนโทรลเลอร์ · ใช้ได้ทันทีและจำไว้ในเครื่องนี้ (ไม่ต้องกดบันทึก)<br>
          Stream Deck / ปุ่มกดอื่น ๆ: ตั้งให้ส่งคีย์ลัด เช่น Space = CUT, Enter = AUTO, 1–9 = Preview, Shift+1–9 = ตัดเข้า Program, I = Replay (ดูทั้งหมดในคู่มือ)</p>`;
  }
  function bindMidiPane(modal) {
    const pane = $('[data-mpane=control]', modal);
    if (!pane) return;
    const devs = () => {
      const el = $('.midi-dev', pane);
      if (!settings.midi.on) { el.textContent = 'ปิดอยู่'; return; }
      if (midi.error && !midi.access) { el.textContent = midi.error; return; }
      const d = midiDevices();
      el.textContent = d.length ? `เชื่อมต่อแล้ว: ${d.join(', ')}` : 'ยังไม่พบอุปกรณ์ MIDI — เสียบสาย USB แล้วรอสักครู่';
    };
    midi.onDevices = devs;
    const paint = () => $$('.midi-row', pane).forEach(r => {
      const k = r.dataset.midi, id = settings.midi.map[k];
      $('.midi-map', r).textContent = midi.learn === k ? 'กดปุ่มบนคอนโทรลเลอร์…' : midiLabel(id);
      r.classList.toggle('is-learning', midi.learn === k);
      $('.midi-clear', r).hidden = !id;
    });
    midi.onLearn = (k, id) => { paint(); toast(`จับคู่ “${MIDI_ACTIONS().find(a => a[0] === k)[1]}” กับ ${midiLabel(id)} แล้ว`, 'success', 2500); };
    $('.midi-on', pane).addEventListener('change', async e => {
      settings.midi.on = e.target.checked;
      saveSettings();
      if (settings.midi.on) await midiEnable(); else { midi.learn = null; midiDisable(); }
      devs(); paint();
    });
    pane.addEventListener('click', async e => {
      const row = e.target.closest('.midi-row');
      if (!row) return;
      const k = row.dataset.midi;
      if (e.target.closest('.midi-clear')) { delete settings.midi.map[k]; saveSettings(); if (midi.learn === k) midi.learn = null; paint(); return; }
      if (!e.target.closest('.midi-learn')) return;
      if (!settings.midi.on) { $('.midi-on', pane).checked = true; settings.midi.on = true; saveSettings(); }
      if (!(await midiEnable())) { devs(); toast(midi.error, 'error'); return; }
      midi.learn = midi.learn === k ? null : k;
      devs(); paint();
    });
    devs(); paint();
  }

  function addTitleInput() {
    const n = inputs.filter(i => i.type === 'title').length + 1;
    const inp = addInput({ type: 'title', name: `TITLE ${n}`, title: { headline: 'ชื่อ นามสกุล', subtitle: 'ตำแหน่ง / หน่วยงาน', color: TITLE_COLORS[0], style: 'lower' } });
    openTitleDialog(inp);
    return inp;
  }
  const TITLE_SIZES = [[0.8, 'เล็ก'], [1, 'ปกติ'], [1.2, 'ใหญ่'], [1.4, 'ใหญ่มาก']];
  const TITLE_POS = [['left', 'ล่างซ้าย'], ['center', 'ล่างกลาง'], ['right', 'ล่างขวา']];
  const TITLE_HIDE = [[0, 'ไม่ซ่อนเอง'], [5, '5 วินาที'], [8, '8 วินาที'], [12, '12 วินาที'], [20, '20 วินาที']];
  // ตัวช่วยอ่านค่าป้ายจากข้อมูลที่ไม่น่าเชื่อถือ (โชว์ที่โหลด / รีโมต)
  const cleanTitle = (t = {}) => ({ headline: String(t.headline || '').slice(0, 80), subtitle: String(t.subtitle || '').slice(0, 120),
    color: TITLE_COLORS.includes(t.color) ? t.color : TITLE_COLORS[0], style: TITLE_STYLES[t.style] ? t.style : 'lower',
    size: TITLE_SIZES.some(([v]) => v === +t.size) ? +t.size : 1, pos: TITLE_POS.some(([v]) => v === t.pos) ? t.pos : 'left',
    autoHide: TITLE_HIDE.some(([v]) => v === +t.autoHide) ? +t.autoHide : 0, anim: !!t.anim });

  // แก้ป้ายชื่อ: ตัวอย่างบนภาพ Program จริง · สไตล์ · สี · ขนาด / ตำแหน่ง · ซ่อนเอง · ภาพเคลื่อนไหว · รายชื่อจาก Google Sheets
  async function openTitleDialog(inp) {
    const t = inp.title = cleanTitle(inp.title || {});
    const draft = { ...t };
    const d = inp.data;
    const ovlOf = () => ovl.findIndex(c => c.inputId === inp.id && c.on);
    const result = await dialog({
      title: 'แก้ป้ายชื่อ',
      wide: true,
      body: `<div class="tt-wrap">
        <div class="tt-left">
          <div class="tt-prev"><canvas width="960" height="540" aria-label="ตัวอย่างป้ายบนภาพ Program"></canvas></div>
          <section class="tt-card">
            <div class="tt-h"><h3>ข้อมูลจาก Google Sheets</h3>${d && d.url ? `<span class="tt-chip ${d.error ? 'bad' : 'ok'}">${d.error ? esc(d.error) : 'ซิงก์ทุก 10 วิ'}</span>` : ''}</div>
            ${dataFields(inp, 'คอลัมน์ A = ข้อความหลัก, B = ข้อความรอง · แตะแถวเพื่อขึ้นป้ายคนนั้น')}
            ${d && d.rows && d.rows.length ? `<div class="tt-rows">${d.rows.slice(0, 50).map((r, i) => `<button type="button" class="tt-row ${i === d.row ? 'is-on' : ''}" data-row="${i}"><span class="mono">${i + 1}</span><b>${esc(r[0] || '')}</b><span>${esc(r[1] || '')}</span>${i === d.row ? '<em>กำลังใช้</em>' : ''}</button>`).join('')}</div>` : ''}
          </section>
        </div>
        <div class="tt-right">
          <section class="tt-card">
            <div class="tt-h"><h3>ข้อความ</h3></div>
            <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
            <div class="tt-two">
              <label class="field"><span>บรรทัด 1 (ข้อความหลัก)</span><input name="headline" class="input" maxlength="80" value="${esc(t.headline)}"></label>
              <label class="field"><span>บรรทัด 2 (ข้อความรอง)</span><input name="subtitle" class="input" maxlength="120" value="${esc(t.subtitle)}"></label>
            </div>
          </section>
          <section class="tt-card">
            <div class="tt-h"><h3>สไตล์</h3></div>
            <div class="tt-styles">${Object.entries(TITLE_STYLES).map(([k, v]) => `<label class="tt-style"><input type="radio" name="style" value="${k}" ${k === t.style ? 'checked' : ''}><canvas width="192" height="108" data-style="${k}"></canvas><span>${v}</span></label>`).join('')}</div>
          </section>
          <section class="tt-card">
            <div class="tt-h"><h3>สีและการแสดง</h3></div>
            <div class="tt-colors">${TITLE_COLORS.map(c => `<label class="tt-color" title="${c}"><input type="radio" name="color" value="${c}" ${c === t.color ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('')}</div>
            <div class="tt-three">
              <label class="field"><span>ขนาด</span><select name="size" class="select">${TITLE_SIZES.map(([v, n]) => `<option value="${v}" ${v === t.size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
              <label class="field"><span>ตำแหน่ง</span><select name="pos" class="select">${TITLE_POS.map(([v, n]) => `<option value="${v}" ${v === t.pos ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
              <label class="field"><span>ซ่อนเองหลังขึ้นจอ</span><select name="autoHide" class="select">${TITLE_HIDE.map(([v, n]) => `<option value="${v}" ${v === t.autoHide ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            </div>
            <label class="check"><input type="checkbox" name="anim" ${t.anim ? 'checked' : ''}> ภาพเคลื่อนไหวตอนขึ้นจอ (เลื่อนเข้า)</label>
            <p class="note">ขนาดและตำแหน่งใช้กับป้ายชื่อล่าง · พื้นหลังโปร่งใส ซ้อนบน Program ด้วยปุ่ม 1–8 ใต้การ์ด</p>
          </section>
        </div>
      </div>`,
      actions: [{ label: 'บันทึกเป็นพรีเซ็ต', value: 'preset' }, { label: 'ดูใน Preview', value: 'pvw' }, { label: ovlOf() >= 0 ? 'ซ่อนจาก Program' : 'แสดงบน Program', value: 'pgm', danger: true }, { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        modal.classList.add('tt-modal');
        const f = $('form', modal).elements;
        const prev = $('.tt-prev canvas', modal), pc = prev.getContext('2d');
        const read = () => Object.assign(draft, cleanTitle({ headline: f.headline.value.trim(), subtitle: f.subtitle.value.trim(), color: f.color.value, style: f.style.value,
          size: f.size.value, pos: f.pos.value, autoHide: f.autoHide.value, anim: f.anim.checked }));
        const fake = { title: draft };
        const paint = () => {
          if (!modal.isConnected) return;
          const src = $('#pgm-canvas');
          pc.fillStyle = '#23324a'; pc.fillRect(0, 0, 960, 540);
          try { if (src) pc.drawImage(src, 0, 0, 960, 540); } catch (e) {}
          drawTitleInput(pc, fake, 960, 540);
        };
        const paintStyles = () => {
          for (const c of $$('[data-style]', modal)) {
            // ซูมเข้าไปตรงที่ป้ายของแต่ละสไตล์อยู่ ให้อ่านออกในช่องเล็ก
            const x = c.getContext('2d'), st = c.dataset.style;
            const [ox, oy] = st === 'top' ? [0, 0] : st === 'live' ? [96, 0] : st === 'center' ? [48, 27] : [0, 54];
            x.setTransform(1, 0, 0, 1, 0, 0);
            x.fillStyle = '#0b0d12'; x.fillRect(0, 0, 192, 108);
            x.setTransform(2, 0, 0, 2, -ox * 2, -oy * 2);
            drawTitleInput(x, { title: { ...draft, style: st, size: 1, pos: 'left', anim: false, headline: draft.headline || 'ชื่อ นามสกุล', subtitle: draft.subtitle || 'ตำแหน่ง' } }, 192, 108);
            x.setTransform(1, 0, 0, 1, 0, 0);
          }
        };
        read(); paint(); paintStyles();
        const timer = setInterval(() => { if (!modal.isConnected) clearInterval(timer); else paint(); }, 250);
        modal.addEventListener('input', () => { read(); paint(); paintStyles(); });
        modal.addEventListener('change', () => { read(); paint(); });
        $('.tt-rows', modal)?.addEventListener('click', e => {
          const b = e.target.closest('[data-row]');
          if (!b || !inp.data) return;
          inp.data.row = +b.dataset.row;
          dataSources.apply(inp);
          f.headline.value = inp.title.headline; f.subtitle.value = inp.title.subtitle;
          for (const r of $$('.tt-row', modal)) { r.classList.toggle('is-on', r === b); r.querySelector('em')?.remove(); }
          b.insertAdjacentHTML('beforeend', '<em>กำลังใช้</em>');
          read(); paint();
        });
        // ปุ่มพรีเซ็ต / Preview / Program ทำงานโดยไม่ปิดหน้าต่าง (บันทึกค่าที่แก้ก่อน)
        const commit = () => { inp.name = f.name.value.trim() || inp.name; Object.assign(inp.title, read()); renderInputs(); refreshSourceSelects(); };
        for (const btn of $$('.modal-foot .btn', modal)) {
          const label = btn.textContent;
          if (!['บันทึกเป็นพรีเซ็ต', 'ดูใน Preview', 'แสดงบน Program', 'ซ่อนจาก Program'].includes(label)) continue;
          const clone = btn.cloneNode(true);
          btn.replaceWith(clone);
          clone.addEventListener('click', () => {
            commit();
            if (label === 'บันทึกเป็นพรีเซ็ต') {
              const { headline, subtitle, color } = inp.title;
              if (!headline && !subtitle) { toast('ใส่ข้อความก่อนบันทึกพรีเซ็ต', 'warn'); return; }
              if (!settings.titlePresets.some(p => p.headline === headline && p.subtitle === subtitle && p.color === color) && settings.titlePresets.length < 24) {
                settings.titlePresets.push({ headline, subtitle, color }); saveSettings(); renderTitlePresets();
              }
              toast('บันทึกพรีเซ็ตป้ายชื่อแล้ว (ดูที่แท็บ “ป้ายชื่อ”)', 'success');
            } else if (label === 'ดูใน Preview') { if (inp.id !== state.programId) setPreview(inp.id); toast('ป้ายอยู่ใน Preview แล้ว', 'success'); }
            else {
              const on = ovlOf();
              if (on >= 0) { setChannel(on, false); clone.textContent = 'แสดงบน Program'; }
              else {
                const free = ovl.findIndex(c => !c.on && (!c.inputId || c.inputId === inp.id));
                const i = free >= 0 ? free : 0;
                audio.ensure();
                toggleInputOverlay(inp.id, i);
                clone.textContent = 'ซ่อนจาก Program';
              }
            }
          });
        }
      }
    });
    if (result?.value !== 'save') return;
    const f = result.form;
    inp.name = f.name.value.trim() || inp.name;
    Object.assign(inp.title, cleanTitle({ headline: f.headline.value.trim(), subtitle: f.subtitle.value.trim(), color: f.color.value, style: f.style.value,
      size: f.size.value, pos: f.pos.value, autoHide: f.autoHide.value, anim: f.anim.checked }));
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
        img.onload = () => { if (token !== inp.goToken) return; inp.showImg = img; inp.imgStart = performance.now(); setInputStatus(inp, 'live'); this.armImage(inp); };
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
    // รายการถัดไป: สุ่มลำดับ (ไม่ซ้ำตัวเดิม) · จบรายการแล้วไม่วน + “ตัดกลับ” → AUTO ไปภาพใน Preview
    next(inp) {
      if (inp.removed) return;
      const L = inp.list, n = L.items.length;
      if (L.shuffle && n > 1) { let j; do { j = Math.floor(Math.random() * n); } while (j === L.index); return this.go(inp, j, false); }
      if (L.index + 1 >= n && !L.loop && L.endCut && state.programId === inp.id && state.previewId && state.previewId !== inp.id) { this.setPlaying(inp, false); autoTransition(); return; }
      this.go(inp, L.index + 1, false);
    },
    // ความยาวของแต่ละไฟล์ (อ่านจาก metadata ครั้งเดียว เก็บไว้กับโชว์)
    async durations(inp, onDone) {
      for (const it of inp.list.items) {
        if (it.kind === 'image' || it.dur) continue;
        const u = await this.url(inp, it);
        if (!u) continue;
        it.dur = await new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => res(isFinite(v.duration) ? v.duration : 0); v.onerror = () => res(0); v.src = u; setTimeout(() => res(0), 5000); });
        onDone && onDone();
      }
    },
    reorder(inp, from, to) {
      const it = inp.list.items;
      if (from === to || from < 0 || to < 0 || from >= it.length || to >= it.length) return;
      const cur = it[inp.list.index];
      it.splice(to, 0, it.splice(from, 1)[0]);
      inp.list.index = Math.max(0, it.indexOf(cur));
    },
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
    // หน้าแก้ Playlist: ลากเรียง · สถานะ เล่นแล้ว / กำลังเล่น / ถัดไป · ความยาว · กำลังเล่น + ปุ่มควบคุม · ตัวเลือกการเล่น
    async edit(inp) {
      const L = inp.list;
      const tc = sec => sec ? fmtDuration(sec * 1000) : '—';
      const durOf = it => it.kind === 'image' ? L.imageSec : it.dur || 0;
      const rows = () => L.items.length ? L.items.map((it, i) => {
        const st = i === L.index ? (inp.status === 'live' ? 'now' : 'cur') : i < L.index && !L.shuffle ? 'done' : i === L.index + 1 || (L.loop && L.index === L.items.length - 1 && i === 0) ? 'next' : '';
        const chip = { now: '<em class="pl-chip now">กำลังเล่น</em>', cur: '<em class="pl-chip now">รายการปัจจุบัน</em>', next: '<em class="pl-chip next">ถัดไป</em>', done: '<em class="pl-chip done">เล่นแล้ว</em>' }[st] || '';
        return `<div class="pl-row ${i === L.index ? 'is-current' : ''} ${st === 'next' ? 'is-next' : ''}" data-i="${i}" draggable="true">
          <span class="pl-grip" aria-hidden="true">⋮⋮</span><span class="pl-num">${i + 1}</span><span class="pl-thumb">${icon(it.kind === 'image' ? 'image' : 'film')}</span>
          <span class="pl-name">${esc(it.name)}</span>${chip}<span class="pl-dur mono">${tc(durOf(it))}</span>
          <button type="button" class="mini" data-pl="up" title="เลื่อนขึ้น">▲</button><button type="button" class="mini" data-pl="down" title="เลื่อนลง">▼</button>
          <button type="button" class="mini" data-pl="play" title="เล่นรายการนี้">${icon('play')}</button><button type="button" class="mini danger" data-pl="del" title="ลบออกจากรายการ">${icon('x')}</button>
        </div>`;
      }).join('') : '<p class="note">ยังไม่มีไฟล์</p>';
      const total = () => L.items.reduce((a, it) => a + durOf(it), 0);
      const result = await dialog({
        title: `Playlist — ${inp.name}`,
        wide: true,
        body: `<div class="pl-wrap">
          <div class="pl-left">
            <div class="pl-list">${rows()}</div>
            <button type="button" class="pl-drop" data-pl="add">ลากไฟล์มาวาง หรือ + เพิ่มไฟล์ (วิดีโอ / รูป / เสียง)</button>
          </div>
          <div class="pl-right">
            <section class="pl-card"><div class="pl-h"><h3>กำลังเล่น</h3></div>
              <div class="pl-now"><canvas width="640" height="360" aria-label="ภาพที่กำลังเล่น"></canvas></div>
              <div class="pl-bar"><i></i></div>
              <div class="pl-times mono"><span data-pl-at>00:00:00</span><span data-pl-left></span></div>
              <div class="pl-ctl"><button type="button" class="btn" data-pl="prev">ก่อนหน้า</button><button type="button" class="btn btn-primary" data-pl="toggle">หยุดชั่วคราว</button><button type="button" class="btn" data-pl="next">ถัดไป</button></div>
            </section>
            <section class="pl-card"><div class="pl-h"><h3>การเล่น</h3></div>
              <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
              <label class="check"><input type="checkbox" name="loop" ${L.loop ? 'checked' : ''}> วนรายการ</label>
              <label class="check"><input type="checkbox" name="shuffle" ${L.shuffle ? 'checked' : ''}> สุ่มลำดับ</label>
              <label class="check"><input type="checkbox" name="endCut" ${L.endCut ? 'checked' : ''}> จบรายการแล้วตัดกลับไปภาพใน Preview (เมื่อไม่วน)</label>
              <label class="field"><span>รูปแต่ละรูปแสดง (วินาที)</span><input name="imageSec" class="input mono" type="number" min="1" max="600" value="${L.imageSec}"></label>
            </section>
            <p class="pl-total">รวม <b data-pl-count>${L.items.length}</b> รายการ · <b class="mono" data-pl-total>${tc(total())}</b></p>
          </div>
        </div>`,
        actions: [{ label: 'เสร็จ', primary: true, value: 'save' }],
        onOpen(modal) {
          modal.classList.add('pl-modal');
          const list = $('.pl-list', modal);
          const redraw = () => { list.innerHTML = rows(); $('[data-pl-total]', modal).textContent = tc(total()); $('[data-pl-count]', modal).textContent = L.items.length; };
          playlist.durations(inp, () => modal.isConnected && redraw());
          const after = () => { redraw(); renderInputs(); };
          modal.addEventListener('click', e => {
            const b = e.target.closest('[data-pl]');
            if (!b) return;
            const act = b.dataset.pl, i = +(b.closest('[data-i]')?.dataset.i ?? -1);
            if (act === 'add') { pickFiles('video/*,image/*,audio/*', files => playlist.addFiles(inp, files).then(() => { playlist.durations(inp, redraw); redraw(); })); return; }
            if (act === 'up' || act === 'down') playlist.move(inp, i, act === 'up' ? -1 : 1);
            else if (act === 'del') playlist.remove(inp, i);
            else if (act === 'play') { L.playing = true; playlist.go(inp, i, true); }
            else if (act === 'prev' || act === 'next') { L.playing = true; playlist.go(inp, L.index + (act === 'next' ? 1 : -1), true); }
            else if (act === 'toggle') playlist.setPlaying(inp, !L.playing);
            after();
          });
          // ลากเรียงลำดับ / ลากไฟล์จากเครื่องมาวาง
          let from = -1;
          list.addEventListener('dragstart', e => { const r = e.target.closest('.pl-row'); if (r) { from = +r.dataset.i; e.dataTransfer.effectAllowed = 'move'; r.classList.add('is-drag'); } });
          list.addEventListener('dragend', () => { from = -1; $$('.pl-row', list).forEach(r => r.classList.remove('is-drag', 'is-over')); });
          modal.addEventListener('dragover', e => { e.preventDefault(); $$('.pl-row', list).forEach(r => r.classList.toggle('is-over', r === e.target.closest('.pl-row') && from >= 0)); });
          modal.addEventListener('drop', e => {
            e.preventDefault();
            const files = [...(e.dataTransfer?.files || [])];
            if (files.length) { playlist.addFiles(inp, files).then(() => { playlist.durations(inp, redraw); redraw(); }); return; }
            const r = e.target.closest('.pl-row');
            if (r && from >= 0) { playlist.reorder(inp, from, +r.dataset.i); after(); }
          });
          modal.addEventListener('change', e => {
            if (e.target.name === 'shuffle') L.shuffle = e.target.checked;
            if (e.target.name === 'loop') L.loop = e.target.checked;
            if (e.target.name === 'endCut') L.endCut = e.target.checked;
            if (e.target.name === 'imageSec') { L.imageSec = clamp(Math.round(+e.target.value || 5), 1, 600); redraw(); }
            if (['shuffle', 'loop'].includes(e.target.name)) redraw();
          });
          const cv = $('.pl-now canvas', modal), cx = cv.getContext('2d'), bar = $('.pl-bar i', modal);
          let lastIdx = L.index, lastStatus = inp.status;
          const tick = () => {
            if (!modal.isConnected) return;
            drawSource(cx, inp, 640, 360);
            const it = L.items[L.index], v = inp.el;
            let at = 0, dur = 0;
            if (it && it.kind === 'image') { dur = L.imageSec; at = inp.imgStart ? Math.min(dur, (performance.now() - inp.imgStart) / 1000) : 0; }
            else if (v && isFinite(v.duration)) { dur = v.duration; at = v.currentTime; }
            bar.style.width = `${dur ? at / dur * 100 : 0}%`;
            $('[data-pl-at]', modal).textContent = fmtDuration(at * 1000);
            $('[data-pl-left]', modal).textContent = dur ? `เหลือ ${fmtDuration((dur - at) * 1000)}` : '';
            $('[data-pl=toggle]', modal).textContent = L.playing ? 'หยุดชั่วคราว' : 'เล่น';
            if (lastIdx !== L.index || lastStatus !== inp.status) { lastIdx = L.index; lastStatus = inp.status; redraw(); }
            requestAnimationFrame(tick);
          };
          tick();
        }
      });
      if (result?.value === 'save') {
        const f = result.form;
        inp.name = f.name.value.trim() || inp.name;
        L.imageSec = clamp(Math.round(+f.imageSec.value || 5), 1, 600);
        L.loop = f.loop.checked; L.shuffle = f.shuffle.checked; L.endCut = f.endCut.checked;
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

  // หน้าต่างกราฟิกข้อมูล (สกอร์ / นาฬิกา / ตัววิ่ง) แบบเดียวกัน: แท็บสลับชนิด · ตัวอย่างสดบนภาพ Program · ปุ่มควบคุมสด · แสดงบน Program
  const GFX_TABS = [['score', 'สกอร์บอร์ด'], ['timer', 'นาฬิกา / นับถอยหลัง'], ['ticker', 'ตัววิ่ง']];
  function dataGfxDialog(inp, { title, body, live = '', bind }) {
    const ovlOf = () => ovl.findIndex(c => c.inputId === inp.id && c.on);
    return dialog({
      title, wide: true,
      body: `<nav class="dg-tabs" role="tablist">${GFX_TABS.map(([k, n]) => `<button type="button" role="tab" class="dg-tab ${k === inp.type ? 'is-on' : ''}" aria-selected="${k === inp.type}" data-gfx-tab="${k}">${n}${k !== inp.type ? `<small>${inputs.filter(i => i.type === k).length || '+'}</small>` : ''}</button>`).join('')}</nav>
        <div class="dg-wrap">
          <div class="dg-left">
            <div class="dg-prev"><canvas width="960" height="540" aria-label="ตัวอย่างบนภาพ Program"></canvas></div>
            ${live}
          </div>
          <div class="dg-right">${body}</div>
        </div>`,
      actions: [{ label: ovlOf() >= 0 ? 'ซ่อนจาก Program' : 'แสดงบน Program', value: 'pgm', danger: true }, { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal, close) {
        modal.classList.add('dg-modal');
        const c = $('.dg-prev canvas', modal), x = c.getContext('2d');
        const paint = () => {
          if (!modal.isConnected) return;
          x.fillStyle = '#23324a'; x.fillRect(0, 0, 960, 540);
          try { const src = $('#pgm-canvas'); if (src) x.drawImage(src, 0, 0, 960, 540); } catch (e) {}
          if (!ovl.some(o => o.on && o.inputId === inp.id)) drawGraphic(x, inp, 960, 540);
          requestAnimationFrame(paint);
        };
        paint();
        $('.dg-tabs', modal).addEventListener('click', e => {
          const k = e.target.closest('[data-gfx-tab]')?.dataset.gfxTab;
          if (!k || k === inp.type) return;
          close();
          const other = inputs.find(i => i.type === k);
          setTimeout(() => other ? renameInput(other) : ({ score: addScoreInput, timer: addTimerInput, ticker: addTickerInput })[k](), 0);
        });
        const btn = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'แสดงบน Program' || b.textContent === 'ซ่อนจาก Program');
        const clone = btn.cloneNode(true);
        btn.replaceWith(clone);
        clone.addEventListener('click', () => {
          const on = ovlOf();
          if (on >= 0) { setChannel(on, false); clone.textContent = 'แสดงบน Program'; return; }
          const free = ovl.findIndex(o => !o.on && (!o.inputId || o.inputId === inp.id));
          audio.ensure();
          toggleInputOverlay(inp.id, free >= 0 ? free : 0);
          clone.textContent = 'ซ่อนจาก Program';
        });
        bind && bind(modal, $('form', modal).elements);
      }
    });
  }

  function addTimerInput() {
    const n = inputs.filter(i => i.type === 'timer').length + 1;
    const inp = addInput({ type: 'timer', name: `TIMER ${n}`, timer: { mode: 'down', duration: 300, target: '19:00', label: 'เริ่มรายการใน', style: 'center', color: '#f5a524', base: 0, running: false, since: 0 } });
    openTimerDialog(inp);
  }
  async function openTimerDialog(inp) {
    const t = inp.timer;
    const result = await dataGfxDialog(inp, {
      title: 'นาฬิกานับถอยหลัง / จับเวลา',
      live: `<section class="dg-card dg-clock"><div class="dg-big mono" data-clock>--:--</div>
        <div class="dg-btns"><button type="button" class="btn btn-primary" data-t="toggle">เริ่ม / หยุด</button><button type="button" class="btn" data-t="reset">รีเซ็ต</button></div></section>`,
      bind(modal) {
        const big = $('[data-clock]', modal), go = $('[data-t=toggle]', modal);
        const tick = () => { if (!modal.isConnected) return; const r = timerText(t); big.textContent = r.text; big.classList.toggle('is-over', !!r.over); go.textContent = t.running ? 'หยุด' : 'เริ่ม'; setTimeout(tick, 200); };
        tick();
        modal.addEventListener('click', e => { const a = e.target.closest('[data-t]')?.dataset.t; if (a) { timerControl(inp, a); renderInputs(); } });
      },
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
    const team = (k, name, color) => `<div class="dg-team"><div class="dg-team-h"><i style="background:${color}"></i><b>${esc(name)}</b></div>
      <div class="dg-score"><button type="button" class="btn" data-sc="${k}-" aria-label="ลดคะแนน ${esc(name)}">−</button><span class="mono" data-sc-v="${k}">${+sc['score' + k] || 0}</span><button type="button" class="btn btn-primary" data-sc="${k}+" aria-label="เพิ่มคะแนน ${esc(name)}">+</button></div></div>`;
    const result = await dataGfxDialog(inp, {
      title: 'ป้ายคะแนน',
      live: `<section class="dg-card"><div class="dg-teams">${team('A', sc.teamA, sc.colorA)}${team('B', sc.teamB, sc.colorB)}</div>
        ${sc.clock.mode !== 'none' ? `<div class="dg-btns"><span class="mono dg-mini" data-sclock></span><button type="button" class="btn" data-t="toggle">เริ่ม / หยุดเวลา</button><button type="button" class="btn" data-t="reset">รีเซ็ตเวลา</button></div>` : ''}</section>`,
      bind(modal, f) {
        // ปุ่ม +/− เปลี่ยนคะแนนบนจอทันที และอัปเดตช่องในฟอร์มด้วย (กดบันทึกแล้วไม่ย้อนค่า)
        modal.addEventListener('click', e => {
          const b = e.target.closest('[data-sc]');
          if (b) {
            const k = 'score' + b.dataset.sc[0];
            sc[k] = Math.max(0, (+sc[k] || 0) + (b.dataset.sc[1] === '+' ? 1 : -1));
            f[k].value = sc[k];
            $(`[data-sc-v="${b.dataset.sc[0]}"]`, modal).textContent = sc[k];
            return;
          }
          const a = e.target.closest('[data-t]')?.dataset.t;
          if (a) { timerControl(inp, a); renderInputs(); }
        });
        modal.addEventListener('input', e => { if (e.target.name === 'scoreA' || e.target.name === 'scoreB') { sc[e.target.name] = Math.max(0, +e.target.value || 0); $(`[data-sc-v="${e.target.name.slice(-1)}"]`, modal).textContent = sc[e.target.name]; } });
        const clk = $('[data-sclock]', modal);
        const tick = () => { if (!modal.isConnected || !clk) return; clk.textContent = scoreClockText(inp); setTimeout(tick, 250); };
        tick();
      },
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

  /* ---- Macro: กดปุ่มเดียวทำหลายขั้นตอนต่อกัน (ตัดภาพ / Overlay / เสียง / บันทึก / ไลฟ์ / รอ) ----
     สั่งได้จากปุ่มในแท็บ Macro, ปุ่ม F1–F12, ปุ่ม MIDI หรือให้เริ่มเองตามเวลา · บันทึกไว้กับโชว์ */
  const MACRO_ACTIONS = {
    preview: ['ใส่ใน Preview', 'input'], program: ['ตัดเข้า Program', 'input'], cut: ['CUT', ''], auto: ['AUTO (รอจนเปลี่ยนเสร็จ)', ''],
    effect: ['ตั้งเอฟเฟกต์เปลี่ยนภาพ', 'effect'], ovlOn: ['Overlay ขึ้นจอ', 'ovl'], ovlOff: ['Overlay ลงจอ', 'ovl'], ovlAllOff: ['เอา Overlay ลงทั้งหมด', ''],
    ftbOn: ['จอดำ (FTB) เปิด', ''], ftbOff: ['จอดำ (FTB) ปิด', ''], mute: ['ปิดเสียงช่อง', 'audio'], unmute: ['เปิดเสียงช่อง', 'audio'],
    play: ['เล่นวิดีโอ / Playlist จากต้น', 'media'], recStart: ['เริ่มบันทึก', ''], recStop: ['หยุดบันทึก', ''],
    liveStart: ['เริ่มไลฟ์ (ปลายทางที่เปิดใช้)', ''], liveStop: ['หยุดไลฟ์ทั้งหมด', ''], replay: ['Instant Replay', ''],
    slideNext: ['สไลด์ถัดไป', ''], slidePrev: ['สไลด์ก่อนหน้า', ''],
    chatHide: ['ซ่อนคอมเมนต์บนจอ', ''], capOn: ['คำบรรยายสด: เริ่มฟัง', ''], capOff: ['คำบรรยายสด: หยุด', ''], sfx: ['เล่นเสียงเอฟเฟกต์', 'pad'], musicPlay: ['เครื่องเล่นเพลง: เล่น', 'player'], musicStop: ['เครื่องเล่นเพลง: หยุด', 'player'], musicNext: ['เครื่องเล่นเพลง: เพลงถัดไป', 'player'],
    wait: ['รอ (วินาที)', 'secs']
  };
  const MACRO_KEYS = ['', 'F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12'];
  const macros = [];
  const macroRun = { id: null, step: 0, cancel: false };
  function sanitizeMacros(list) {
    return (Array.isArray(list) ? list : []).filter(m => m && typeof m === 'object').slice(0, 24).map(m => ({
      id: typeof m.id === 'string' && /^[\w-]{1,24}$/.test(m.id) ? m.id : uid(),
      name: String(m.name || 'Macro').slice(0, 40),
      key: MACRO_KEYS.includes(m.key) ? m.key : '',
      at: /^\d{2}:\d{2}$/.test(m.at || '') ? m.at : '',
      // วันที่เริ่มเองตามเวลาไปแล้ว — เปิดหน้าใหม่ในนาทีเดิมจะไม่ทำซ้ำ
      ranOn: typeof m.ranOn === 'string' ? m.ranOn.slice(0, 24) : '',
      steps: (Array.isArray(m.steps) ? m.steps : []).filter(st => st && MACRO_ACTIONS[st.a]).slice(0, 60)
        .map(st => ({ a: st.a, v: st.a === 'wait' ? clamp(+st.v || 1, 0.1, 3600) : String(st.v ?? '').slice(0, 80) }))
    }));
  }
  const sleepCancellable = async ms => { const end = performance.now() + ms; while (!macroRun.cancel && performance.now() < end) await new Promise(r => setTimeout(r, Math.min(100, end - performance.now()))); };
  const macroChannel = v => chanByKey(v);
  async function macroStep(st) {
    const v = st.v;
    switch (st.a) {
      case 'preview': if (byId(v) && v !== state.programId) setPreview(v); break;
      case 'program': if (byId(v) && v !== state.programId) { state.previewId = v; cut(); } break;
      case 'cut': cut(); break;
      case 'auto':
        autoTransition();
        for (let t = 0; tr.auto && t < 300 && !macroRun.cancel; t++) await new Promise(r => setTimeout(r, 50));
        break;
      case 'effect':
        if (TRANSITIONS.includes(v) && (v !== 'stinger' || stinger.ready)) { settings.transition = v; $$('#seg-transition button').forEach(b => b.classList.toggle('is-active', b.dataset.value === v)); saveSettings(); }
        break;
      case 'ovlOn': case 'ovlOff': { const i = +v; if (ovl[i] && ovl[i].on !== (st.a === 'ovlOn') && (st.a === 'ovlOff' || byId(ovl[i].inputId))) setChannel(i, st.a === 'ovlOn'); break; }
      case 'ovlAllOff': ovl.forEach((c, i) => { if (c.on) setChannel(i, false); }); break;
      case 'ftbOn': case 'ftbOff': if (!!ftb.target !== (st.a === 'ftbOn')) toggleFtb(); break;
      case 'mute': case 'unmute': {
        const ch = macroChannel(v);
        if (!ch) break;
        ch.muted = st.a === 'mute';
        ch === audio.masterStrip ? audio.applyMaster() : audio.applyGain(ch);
        renderMixer();
        break;
      }
      case 'play': {
        const inp = byId(v);
        if (inp && inp.type === 'playlist') playlist.go(inp, 0, true);
        else if (inp && inp.el && inp.el.tagName === 'VIDEO' && inp.type === 'media') clipRestart(inp);
        break;
      }
      case 'recStart': if (!rec.active && !rec.starting) await toggleRecord(); break;
      case 'recStop': if (rec.active && rec.recorder) rec.recorder.stop(); break;
      case 'liveStart': startDestinations(settings.destinations.filter(d => d.enabled)); break;
      case 'liveStop': if (streamer.active || streamer.reconnecting) stopAllStreams(); break;
      case 'replay': await replayCapture(); break;
      case 'slideNext': slideStep(1); break;
      case 'slidePrev': slideStep(-1); break;
      case 'chatHide': chatHide(); break;
      case 'capOn': case 'capOff': inputs.filter(i => i.type === 'captions').forEach(i => st.a === 'capOn' ? captionStart(i) : captionStop(i)); renderInputs(); break;
      case 'sfx': { const ch = padChannel(); if (ch && !ch.playingPad(+v)) padFire(ch, +v); break; }
      case 'musicPlay': case 'musicStop': case 'musicNext': {
        const ch = chanByKey(v);
        if (!ch?.src) break;
        if (st.a === 'musicNext') ch.src.next?.();
        else if (ch.src.playing() !== (st.a === 'musicPlay')) ch.src.toggle();
        break;
      }
      case 'wait': await sleepCancellable(v * 1000); break;
    }
  }
  async function runMacro(m) {
    if (macroRun.id) {
      if (macroRun.id === m.id) { macroRun.cancel = true; toast(`หยุด Macro “${m.name}”`, 'info', 2000); }
      else toast('มี Macro อื่นทำงานอยู่ — รอให้จบหรือกดซ้ำที่ Macro นั้นเพื่อหยุด', 'warn');
      return;
    }
    audio.ensure();
    Object.assign(macroRun, { id: m.id, step: 0, cancel: false });
    renderMacros();
    try {
      for (let i = 0; i < m.steps.length && !macroRun.cancel; i++) {
        macroRun.step = i;
        paintMacroProgress(m);
        try { await macroStep(m.steps[i]); } catch (e) { console.warn('macro step', e); }
      }
    } finally {
      macroRun.id = null;
      renderMacros();
    }
  }
  // เริ่มเองตามเวลา (ครั้งเดียวต่อวัน ขณะเปิดแอปอยู่)
  function macroClock(now) {
    const hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`, day = now.toDateString();
    for (const m of macros) {
      if (m.at && m.at === hm && m.ranOn !== day) { m.ranOn = day; show.autosave(true); toast(`เริ่ม Macro “${m.name}” ตามเวลา ${m.at}`, 'info', 4000); runMacro(m); }
    }
  }
  const macroLabel = st => {
    const [label, arg] = MACRO_ACTIONS[st.a] || ['?', ''];
    const v = st.v;
    const what = arg === 'input' || arg === 'media' ? byId(v)?.name || '—' : arg === 'ovl' ? `ช่อง ${+v + 1}` : arg === 'effect' ? String(v).toUpperCase()
      : arg === 'audio' ? (v === 'master' ? 'Master' : macroChannel(v)?.name || byId(v)?.name || '—') : arg === 'secs' ? `${v} วินาที`
      : arg === 'player' ? chanByKey(v)?.name || '—' : arg === 'pad' ? padChannel()?.pads[+v]?.name || `ปุ่ม ${+v + 1}` : '';
    return what ? `${label}: ${what}` : label;
  };
  function renderMacros() {
    const box = $('#macro-list');
    if (!box) return;
    box.innerHTML = macros.length ? macros.map((m, i) => `
      <div class="macro-row ${macroRun.id === m.id ? 'is-running' : ''}" data-macro="${m.id}">
        <button type="button" class="macro-run" title="${esc(m.steps.map(macroLabel).join(' → ') || 'ยังไม่มีขั้นตอน')}">
          <b>${esc(m.name)}</b><small>${m.steps.length} ขั้นตอน${m.key ? ` · ${m.key}` : ''}${m.at ? ` · เริ่มเอง ${m.at}` : ''}${i < 8 ? ` · MIDI Macro ${i + 1}` : ''}</small>
          <span class="macro-progress"></span></button>
        <button type="button" class="mini macro-edit" title="แก้ไข Macro">${icon('edit')}</button>
      </div>`).join('') : '<p class="note">ยังไม่มี Macro — สร้างเพื่อทำหลายอย่างในปุ่มเดียว เช่น “เปิดรายการ”: โลโก้ขึ้น → เริ่มบันทึก → เปลี่ยนเป็นกล้อง 1 แบบ AUTO</p>';
    const m = macros.find(x => x.id === macroRun.id);
    if (m) paintMacroProgress(m);
  }
  function paintMacroProgress(m) {
    const el = $(`.macro-row[data-macro="${m.id}"] .macro-progress`);
    if (el) el.style.width = `${Math.round((macroRun.step + 1) / Math.max(1, m.steps.length) * 100)}%`;
  }
  function bindMacroPane() {
    renderMacros();
    $('#macro-add').addEventListener('click', () => openMacroDialog(null));
    $('#macro-list').addEventListener('click', e => {
      const row = e.target.closest('.macro-row');
      const m = row && macros.find(x => x.id === row.dataset.macro);
      if (!m) return;
      if (e.target.closest('.macro-edit')) openMacroDialog(m);
      else if (e.target.closest('.macro-run')) runMacro(m);
    });
  }
  async function openMacroDialog(m) {
    const draft = m ? { ...m, steps: m.steps.map(st => ({ ...st })) } : { id: uid(), name: `Macro ${macros.length + 1}`, key: '', at: '', steps: [{ a: 'auto', v: '' }] };
    const opts = arg => {
      if (arg === 'input') return inputs.map((x, i) => [x.id, `${i + 1}. ${x.name}`]);
      if (arg === 'media') return inputs.filter(x => x.type === 'media' || x.type === 'playlist').map(x => [x.id, x.name]);
      if (arg === 'ovl') return ovl.map((c, i) => [String(i), `ช่อง ${c.n}${byId(c.inputId) ? ` (${byId(c.inputId).name})` : ''}`]);
      if (arg === 'effect') return TRANSITIONS.map(t => [t, t.toUpperCase()]);
      if (arg === 'audio') return [['master', 'Master'], ...audioChanOptions()];
      if (arg === 'player') return audio.channels.filter(c => c.kind === 'player' || c.kind === 'url').map(c => [chanKey(c), c.name]);
      if (arg === 'pad') return PAD_SLOTS.map(i => [String(i), `ปุ่ม ${i + 1}${padChannel()?.pads[i] ? ` (${padChannel().pads[i].name})` : ''}`]);
      return [];
    };
    const rowHtml = (st, i) => {
      const arg = MACRO_ACTIONS[st.a][1], list = opts(arg);
      if (arg && arg !== 'secs' && !list.some(([k]) => k === st.v)) st.v = list[0] ? list[0][0] : '';
      return `<div class="mstep" data-i="${i}"><span class="mstep-n">${i + 1}</span>
        <select class="select" data-k="a">${Object.entries(MACRO_ACTIONS).map(([k, [l]]) => `<option value="${k}" ${k === st.a ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${arg === 'secs' ? `<input class="input mono" data-k="v" type="number" min="0.1" max="3600" step="0.1" value="${st.v || 1}">`
          : arg ? `<select class="select" data-k="v">${list.map(([k, l]) => `<option value="${esc(k)}" ${k === st.v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : '<span></span>'}
        <span class="mstep-btns"><button type="button" class="mini" data-mv="-1" title="ขึ้น">↑</button><button type="button" class="mini" data-mv="1" title="ลง">↓</button><button type="button" class="mini danger" data-rm title="ลบขั้นตอน">✕</button></span></div>`;
    };
    const r = await dialog({
      title: m ? `แก้ไข Macro — ${m.name}` : 'สร้าง Macro',
      wide: true,
      body: `
        <div class="field-row">
          <label class="field"><span>ชื่อ</span><input name="mname" class="input" maxlength="40" value="${esc(draft.name)}"></label>
          <label class="field"><span>ปุ่มลัด</span><select name="mkey" class="select">${MACRO_KEYS.map(k => `<option value="${k}" ${k === draft.key ? 'selected' : ''}>${k || '— ไม่มี —'}</option>`).join('')}</select></label>
          <label class="field"><span>เริ่มเองเวลา (ไม่บังคับ)</span><input name="mat" class="input mono" type="time" value="${draft.at}"></label>
        </div>
        <div class="field"><span>ขั้นตอน (ทำตามลำดับ)</span><div class="msteps"></div>
          <button type="button" class="btn btn-sm mstep-add">+ เพิ่มขั้นตอน</button></div>
        <p class="note">กด Macro อีกครั้งระหว่างทำงาน = หยุด · “รอ” ใช้เว้นจังหวะ เช่น โลโก้ขึ้น → รอ 3 วินาที → ตัดเข้ากล้อง · Macro 1–8 ตั้งปุ่ม MIDI ได้ที่ ตั้งค่า → ควบคุม · เวลาเริ่มเองทำงานเมื่อเปิดแอปค้างไว้</p>`,
      actions: [...(m ? [{ label: 'ลบ Macro', value: 'delete' }] : []), { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        const box = $('.msteps', modal);
        const paint = () => { box.innerHTML = draft.steps.map(rowHtml).join('') || '<p class="note">ยังไม่มีขั้นตอน</p>'; };
        paint();
        box.addEventListener('change', e => {
          const row = e.target.closest('.mstep'), st = row && draft.steps[+row.dataset.i];
          if (!st) return;
          if (e.target.dataset.k === 'a') { st.a = e.target.value; st.v = st.a === 'wait' ? 1 : ''; paint(); }
          else st.v = e.target.type === 'number' ? +e.target.value : e.target.value;
        });
        box.addEventListener('click', e => {
          const row = e.target.closest('.mstep');
          if (!row) return;
          const i = +row.dataset.i;
          if (e.target.closest('[data-rm]')) { draft.steps.splice(i, 1); paint(); }
          const mv = e.target.closest('[data-mv]');
          if (mv) { const j = i + +mv.dataset.mv; if (j >= 0 && j < draft.steps.length) { [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]]; paint(); } }
        });
        $('.mstep-add', modal).addEventListener('click', () => { if (draft.steps.length < 60) { draft.steps.push({ a: 'wait', v: 2 }); paint(); } });
      }
    });
    if (r?.value === 'delete') {
      if (macroRun.id === m.id) macroRun.cancel = true;
      macros.splice(macros.indexOf(m), 1);
      renderMacros();
      toast(`ลบ Macro “${m.name}” แล้ว`);
      return;
    }
    if (r?.value !== 'save') return;
    const f = r.form;
    if (f.mkey.value && macros.some(x => x.id !== draft.id && x.key === f.mkey.value)) { toast(`ปุ่ม ${f.mkey.value} ใช้กับ Macro อื่นแล้ว`, 'warn'); return; }
    const [clean] = sanitizeMacros([{ ...draft, name: f.mname.value.trim() || draft.name, key: f.mkey.value, at: f.mat.value }]);
    if (m) Object.assign(m, clean); else macros.push(clean);
    renderMacros();
    show.autosave(true);
  }

  /* ---- ควบคุมกล้องมือถือจากสตูดิโอ (แบบ Camera Control ของ ATEM) ----
     ค่าที่ปรับได้มาจากกล้องจริงของมือถือเครื่องนั้น — ปรับแล้วมือถือส่งสถานะกลับมา ค่าบนหน้านี้จึงตรงกับกล้องเสมอ */
  let camCtl = null;
  const camShutter = t => t > 0 ? (t >= 10000 ? `${(t / 10000).toFixed(1)}s` : `1/${Math.round(10000 / t)}`) : '—';
  function openCamControl(inp) {
    if (!inp.cam) return;
    let dragging = false, sendTimer = null, sig = '';
    const send = set => wireless.sendCam(inp, { type: 'cam-set', set });
    const cmd = (c, value) => wireless.sendCam(inp, { type: 'cam-cmd', cmd: c, value });
    const R = r => r && r.max > r.min;
    const fmt = { iso: v => Math.round(v), exposureTime: camShutter, exposureCompensation: v => (v > 0 ? '+' : '') + (+v).toFixed(1), colorTemperature: v => Math.round(v) + 'K', focusDistance: v => (+v).toFixed(2) + ' m', zoom: v => (+v).toFixed(1) + '×' };
    const slider = (k, label, r, v) => R(r) ? `<label class="field cc-row"><span>${label} <b class="mono" data-cv="${k}">${v == null ? '—' : fmt[k](v)}</b></span>
      <input class="range" type="range" data-ck="${k}" min="${r.min}" max="${r.max}" step="${r.step || (r.max - r.min) / 200}" value="${v ?? r.min}"></label>` : '';
    const segs = (name, items, cur) => `<div class="seg cam-seg" data-cs="${name}">${items.map(([v, l]) => `<button type="button" data-v="${esc(String(v))}" class="${String(v) === String(cur) ? 'is-active' : ''}">${esc(String(l))}</button>`).join('')}</div>`;
    const status = () => {
      const c = inp.cam, st = c.set || {}, x = c.stats || {};
      return [`${st.width || '?'}×${st.height || '?'} @ ${x.fps || st.fps || '?'} fps`, x.kbps ? `${(x.kbps / 1000).toFixed(1)} Mb/s` : '', x.rtt != null ? `ดีเลย์ ${x.rtt} ms` : '',
        x.limit && x.limit !== 'none' ? `⚠ ${x.limit === 'bandwidth' ? 'เน็ตไม่พอ' : x.limit === 'cpu' ? 'เครื่องช้า/ร้อน' : x.limit}` : '',
        c.battery ? `🔋 ${Math.round(c.battery.level * 100)}%${c.battery.charging ? ' ⚡' : ''}` : '', c.tilt != null ? `เอียง ${c.tilt}°` : ''].filter(Boolean).join(' · ');
    };
    const body = () => {
      const c = inp.cam, k = c.caps || {}, st = c.set || {}, man = m => m === 'manual';
      sig = [st.exposureMode, st.whiteBalanceMode, st.focusMode, (c.lenses || []).length, !!c.rec, c.locked].join('|');
      const parts = [];
      parts.push(`<p class="note cam-status">${esc(status())}</p>`);
      parts.push(`<div class="cam-row"><button type="button" class="btn ${c.rec ? 'btn-danger' : ''} cam-rec">${c.rec ? '■ หยุดบันทึกในมือถือ' : '● บันทึกในมือถือ (ไฟล์สำรองคุณภาพสูง)'}</button>
        <button type="button" class="btn cam-lock ${c.locked ? 'is-on' : ''}">${c.locked ? 'ปลดล็อก AE/AWB/AF' : 'ล็อก AE/AWB/AF'}</button>
        ${k.torch ? `<button type="button" class="btn cam-torch ${st.torch ? 'is-on' : ''}">ไฟฉาย ${st.torch ? 'ON' : 'OFF'}</button>` : ''}</div>`);
      if (R(k.iso) || R(k.exposureTime) || R(k.exposureCompensation)) {
        parts.push(`<div class="help"><h3>แสง (Exposure)</h3></div>`);
        if ((k.exposureMode || []).includes('manual')) parts.push(segs('exposureMode', [['continuous', 'AUTO'], ['manual', 'MANUAL']], man(st.exposureMode) ? 'manual' : 'continuous'));
        if (man(st.exposureMode)) parts.push(slider('iso', 'ISO', k.iso, st.iso) + slider('exposureTime', 'ชัตเตอร์', k.exposureTime, st.exposureTime));
        else parts.push(slider('exposureCompensation', 'EV', k.exposureCompensation, st.exposureCompensation ?? 0));
      }
      if (R(k.colorTemperature)) {
        parts.push(`<div class="help"><h3>สมดุลแสงขาว (WB)</h3></div>`);
        parts.push(segs('whiteBalanceMode', [['continuous', 'AUTO'], ['manual', 'MANUAL']], man(st.whiteBalanceMode) ? 'manual' : 'continuous'));
        if (man(st.whiteBalanceMode)) parts.push(slider('colorTemperature', 'อุณหภูมิสี', k.colorTemperature, st.colorTemperature) + segs('wb', [[3200, 'หลอดไส้ 3200K'], [4000, 'ฟลูออเรสเซนต์ 4000K'], [5600, 'แดด 5600K'], [6500, 'ครึ้ม 6500K']].filter(([v]) => v >= k.colorTemperature.min && v <= k.colorTemperature.max), ''));
      }
      if (R(k.focusDistance)) {
        parts.push(`<div class="help"><h3>โฟกัส</h3></div>`);
        parts.push(segs('focusMode', [['continuous', 'AF'], ['manual', 'MF']], man(st.focusMode) ? 'manual' : 'continuous'));
        if (man(st.focusMode)) parts.push(slider('focusDistance', 'ระยะโฟกัส', k.focusDistance, st.focusDistance));
      }
      if (R(k.zoom)) parts.push(`<div class="help"><h3>ซูม</h3></div>` + slider('zoom', 'ซูม', k.zoom, st.zoom));
      parts.push(`<div class="help"><h3>ภาพที่ส่ง</h3></div>`);
      parts.push(segs('quality', (c.qualities || []).map(q => [q, q]), st.quality));
      parts.push(segs('fps', [24, 25, 30, 50, 60].filter(f => f <= (k.maxFps || 30) + 0.5).map(f => [f, f + ' fps']), st.fps));
      if ((c.lenses || []).length > 1) parts.push(segs('lens', c.lenses.map(l => [l.id, l.label]), st.lens));
      if (!R(k.iso) && !R(k.colorTemperature) && !R(k.focusDistance) && !R(k.zoom)) parts.push('<p class="note warn">มือถือเครื่องนี้ (หรือเบราว์เซอร์) ไม่ให้ปรับแสง/สี/โฟกัสเอง — Android + Chrome รองรับมากที่สุด</p>');
      parts.push(`<div class="field"><span>ข้อความถึงช่างกล้อง (ขึ้นบนจอมือถือ)</span><div class="link-row"><input class="input cam-msg" maxlength="120" placeholder="เช่น ซูมเข้าหน้าผู้พูด"><button type="button" class="btn cam-msg-send">ส่ง</button></div></div>`);
      return parts.join('');
    };
    dialog({
      title: `ควบคุมกล้อง — ${inp.name}`,
      body: `<div class="cam-ctl">${body()}</div>`,
      actions: [{ label: 'ปิด', primary: true }],
      onOpen(modal) {
        const box = $('.cam-ctl', modal);
        camCtl = {
          inp,
          refresh() {
            if (!box.isConnected) return;
            const st = inp.cam.set || {};
            const nextSig = [st.exposureMode, st.whiteBalanceMode, st.focusMode, (inp.cam.lenses || []).length, !!inp.cam.rec, inp.cam.locked].join('|');
            if (nextSig !== sig && !dragging) { box.innerHTML = body(); return; }
            const s1 = $('.cam-status', box);
            if (s1) s1.textContent = status();
            if (!dragging) for (const el of $$('[data-ck]', box)) { const v = st[el.dataset.ck]; if (v != null) { el.value = v; const l = $(`[data-cv="${el.dataset.ck}"]`, box); if (l) l.textContent = fmt[el.dataset.ck](v); } }
            for (const sg of $$('[data-cs]', box)) {
              const cur = { quality: st.quality, fps: st.fps, lens: st.lens }[sg.dataset.cs];
              if (cur != null) $$('button', sg).forEach(b => b.classList.toggle('is-active', b.dataset.v === String(cur)));
            }
          }
        };
        box.addEventListener('pointerdown', e => { if (e.target.dataset.ck) dragging = true; });
        addEventListener('pointerup', () => { dragging = false; }, { once: false });
        box.addEventListener('input', e => {
          const k = e.target.dataset.ck;
          if (!k) return;
          const v = +e.target.value, l = $(`[data-cv="${k}"]`, box);
          if (l) l.textContent = fmt[k](v);
          clearTimeout(sendTimer);
          sendTimer = setTimeout(() => send({ [k]: v }), 60);
        });
        box.addEventListener('click', e => {
          if (e.target.closest('.cam-rec')) { cmd('rec', !inp.cam.rec); return; }
          if (e.target.closest('.cam-lock')) { cmd('lock', !inp.cam.locked); return; }
          if (e.target.closest('.cam-torch')) { send({ torch: !(inp.cam.set || {}).torch }); return; }
          if (e.target.closest('.cam-msg-send')) { const i = $('.cam-msg', box); if (i.value.trim()) { cmd('msg', i.value.trim()); toast('ส่งข้อความถึงช่างกล้องแล้ว', 'success', 2000); i.value = ''; } return; }
          const b = e.target.closest('[data-cs] button');
          if (!b) return;
          const name = b.closest('[data-cs]').dataset.cs, v = b.dataset.v, st = inp.cam.set || {};
          if (name === 'quality' || name === 'lens') cmd(name, v);
          else if (name === 'fps') cmd('fps', +v);
          else if (name === 'wb') send({ colorTemperature: +v });
          else {
            const set = { [name]: v };
            if (v === 'manual' && name === 'exposureMode') Object.assign(set, { iso: st.iso, exposureTime: st.exposureTime });
            if (v === 'manual' && name === 'whiteBalanceMode' && st.colorTemperature) set.colorTemperature = st.colorTemperature;
            if (v === 'manual' && name === 'focusMode' && st.focusDistance != null) set.focusDistance = st.focusDistance;
            for (const k of Object.keys(set)) if (set[k] == null) delete set[k];
            send(set);
          }
        });
        cmd('state');
      }
    }).then(() => { if (camCtl && camCtl.inp === inp) camCtl = null; });
  }

  function addVizInput() {
    audio.ensure();
    const n = inputs.filter(i => i.type === 'visualizer').length + 1;
    const inp = addInput({ type: 'visualizer', name: n > 1 ? `VISUALIZER ${n}` : 'VISUALIZER', viz: sanitizeViz({ bg: 'dark' }) });
    openVizDialog(inp);
    return inp;
  }
  async function openVizDialog(inp) {
    const before = { ...inp.viz };
    const chans = audioChanOptions().map(([id, name]) => ({ id, name }));
    const imgs = inputs.filter(i => i.type === 'image');
    const v = inp.viz;
    const r = await dialog({
      title: 'Audio Visualizer',
      body: `
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        <label class="field"><span>รูปแบบ</span><select name="style" class="select">${Object.entries(VIZ_STYLES).map(([k, t]) => `<option value="${k}" ${k === v.style ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>ฟังเสียงจาก</span><select name="source" class="select"><option value="master">Master (เสียงรวมที่ออกอากาศ)</option>${chans.map(c => `<option value="${esc(c.id)}" ${c.id === v.source ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <div class="field-row">
          <label class="field"><span>สี</span><select name="color" class="select">${TITLE_COLORS.map(c => `<option value="${c}" ${c === v.color ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span>พื้นหลัง</span><select name="bg" class="select">${Object.entries(VIZ_BG).map(([k, t]) => `<option value="${k}" ${k === v.bg ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
        <label class="field viz-img" ${v.style === 'circle' ? '' : 'hidden'}><span>รูปตรงกลาง (เช่น รูปแขก / โลโก้รายการ)</span><select name="imageId" class="select"><option value="">— ไม่มี —</option>${imgs.map(i => `<option value="${i.id}" ${i.id === v.imageId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
        <label class="field"><span>ความไวต่อเสียง <b class="mono viz-sens">${v.sens.toFixed(1)}×</b></span><input name="sens" class="range" type="range" min="0.3" max="3" step="0.1" value="${v.sens}"></label>
        <p class="note">เห็นผลทันทีบนการ์ด/Preview · ใช้เต็มจอ หรือกด 1–8 ใต้การ์ดเพื่อซ้อนบน Program (เลือกพื้นหลัง “โปร่งใส”)</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        const f = $('form', modal);
        const apply = () => {
          inp.viz = sanitizeViz({ style: f.style.value, source: f.source.value, color: f.color.value, bg: f.bg.value, imageId: f.imageId.value, sens: f.sens.value });
          $('.viz-img', modal).hidden = f.style.value !== 'circle';
          $('.viz-sens', modal).textContent = (+f.sens.value).toFixed(1) + '×';
        };
        modal.addEventListener('input', apply);
        modal.addEventListener('change', apply);
      }
    });
    if (r?.value !== 'save') { inp.viz = before; return; }
    inp.name = String(r.form.name.value || '').trim().slice(0, 40) || inp.name;
    renderInputs(); refreshSourceSelects();
  }

  function addTickerInput() {
    const n = inputs.filter(i => i.type === 'ticker').length + 1;
    const inp = addInput({ type: 'ticker', name: n > 1 ? `TICKER ${n}` : 'TICKER', ticker: { label: 'ข่าวด่วน', items: ['พิมพ์ข้อความข่าวบรรทัดละหนึ่งเรื่อง', 'ตัววิ่งจะเลื่อนต่อกันไปเรื่อย ๆ'], speed: 90, color: '#ef4444' } });
    openTickerDialog(inp);
  }
  async function openTickerDialog(inp) {
    const tk = inp.ticker;
    const orig = { ...tk, items: tk.items.slice() };
    const result = await dataGfxDialog(inp, {
      title: 'ตัววิ่งข่าว (Ticker)',
      live: `<section class="dg-card"><div class="dg-h"><b>ข้อความที่วิ่งอยู่</b><span class="dg-sub">${tk.items.length} เรื่อง</span></div>
        <ol class="dg-items">${tk.items.slice(0, 8).map(t => `<li>${esc(t)}</li>`).join('')}</ol></section>`,
      bind(modal, f) {
        // แก้ข้อความ / ความเร็ว / สี แล้วเห็นผลในตัวอย่างทันที (กดยกเลิก = คืนค่าเดิม)
        modal.addEventListener('input', () => {
          Object.assign(tk, { label: f.label.value.trim().slice(0, 24), speed: [60, 90, 130, 180].includes(+f.speed.value) ? +f.speed.value : tk.speed, color: pickColor(f.color.value, tk.color),
            items: f.items.value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 100) });
        });
        modal.addEventListener('change', () => modal.dispatchEvent(new Event('input')));
      },
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
    if (result?.value !== 'save') { Object.assign(tk, orig); return; }
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

  const FX_DEFAULT = { delayMs: 0, lowCut: false, lowCutHz: 80, low: 0, mid: 0, midHz: 1000, high: 0, comp: false, threshold: -18, ratio: 4, attack: 5, release: 150, gate: false, gateDb: -50, duck: false, duckDb: -15, duckThr: -40, duckBy: 'voice' };
  // ช่องที่นับว่าเป็น "เสียงพูด" สำหรับ Ducking: ไมค์ แขกรับเชิญ และกล้องมือถือไร้สาย
  const isVoiceChannel = c => c.kind === 'mic' || (!!c.inputId && ['guest', 'wireless'].includes(byId(c.inputId)?.type));
  /* ------------------------------------------------------ loudness (LUFS) */
  // EBU R128 / ITU-R BS.1770: M = 400 ms · S = 3 วิ · I = ตั้งแต่เริ่มวัด (gate −70 LUFS และ −10 LU)
  // วัดหลังลิมิตเตอร์ = เสียงที่ออกสตรีมและบันทึกจริง · เริ่มวัด I ใหม่เมื่อเริ่มไลฟ์
  const LUFS_TARGETS = { '-14': 'YouTube / Facebook / Spotify', '-16': 'Apple Podcasts / Music', '-23': 'ทีวี EBU R128', '-24': 'ทีวี ATSC A/85' };
  const lufs = {
    node: null, blocks: [], gated: [], m: -Infinity, s: -Infinity, i: -Infinity, n: 0,
    target: LUFS_TARGETS[store.get('lufsTarget', '-14')] ? +store.get('lufsTarget', '-14') : -14,
    lk: ms => ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity,
    async start() {
      if (this.node || !audio.ctx || !audio.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return;
      this.node = 'loading';
      try {
        await audio.ctx.audioWorklet.addModule('assets/js/lufs-worklet.js');
        const n = new AudioWorkletNode(audio.ctx, 'webmix-lufs', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
        // ต่อลงปลายทางผ่าน gain 0 ให้เบราว์เซอร์ประมวลผลตลอด (ไม่มีเสียงออก)
        const sink = audio.ctx.createGain();
        sink.gain.value = 0;
        audio.post.connect(n); n.connect(sink); sink.connect(audio.ctx.destination);
        n.port.onmessage = e => this.feed(e.data);
        this.node = n;
      } catch (e) { this.node = null; console.warn('lufs worklet', e); }
    },
    feed(ms) {
      const b = this.blocks;
      b.push(ms);
      if (b.length > 30) b.shift();
      const mean = k => { const a = b.slice(-k); let t = 0; for (const x of a) t += x; return t / a.length; };
      this.m = b.length >= 4 ? this.lk(mean(4)) : -Infinity;
      this.s = b.length >= 4 ? this.lk(mean(Math.min(30, b.length))) : -Infinity;
      // บล็อก 400 ms ทุก 100 ms (ซ้อน 75%) ที่ดังกว่า −70 LUFS เก็บไว้คิด Integrated
      if (b.length >= 4 && this.m > -70) this.gated.push(mean(4));
      if (++this.n % 10 === 0) this.integrate();
    },
    integrate() {
      const g = this.gated;
      if (!g.length) { this.i = -Infinity; return; }
      let t = 0;
      for (const x of g) t += x;
      const rel = this.lk(t / g.length) - 10;
      let u = 0, c = 0;
      for (const x of g) if (this.lk(x) > rel) { u += x; c++; }
      this.i = c ? this.lk(u / c) : -Infinity;
    },
    reset() { this.gated = []; this.i = -Infinity; this.render(); },
    level(v) {
      if (!isFinite(v) || v < -60) return 'off';
      const d = v - this.target;
      return d > 2 ? 'hot' : d > 1 ? 'warn' : d >= -2 ? 'ok' : 'low';
    },
    fmt: v => isFinite(v) && v > -60 ? v.toFixed(1) : '--.-',
    render() {
      const el = $('#lufs');
      if (!el) return;
      $('.lu-m', el).textContent = this.fmt(this.m);
      $('.lu-s', el).textContent = this.fmt(this.s);
      $('.lu-i', el).textContent = this.fmt(this.i);
      $('.lu-t', el).textContent = this.target;
      el.dataset.level = this.level(this.s);
      $('.lu-i', el).dataset.level = this.level(this.i);
    },
    openMenu(anchor) {
      closeMenu();
      const menu = document.createElement('div');
      menu.className = 'menu';
      menu.innerHTML = '<div class="menu-label">เป้าหมายความดัง (LUFS)</div>'
        + Object.entries(LUFS_TARGETS).map(([k, v]) => `<button data-t="${k}" class="${+k === this.target ? 'is-active' : ''}">${k} LUFS — ${esc(v)}</button>`).join('')
        + '<div class="menu-label">Integrated (I)</div><button data-reset="1">เริ่มวัดใหม่</button>'
        + '<div class="menu-note">M = 0.4 วิ · S = 3 วิ · I = ตั้งแต่เริ่มวัด (เริ่มใหม่เองเมื่อเริ่มไลฟ์) · สีเขียว = ใกล้เป้า · เหลือง/แดง = ดังเกิน · ฟ้า = เบาเกิน</div>';
      document.body.appendChild(menu);
      const r = anchor.getBoundingClientRect();
      menu.style.left = `${clamp(r.left, 8, innerWidth - menu.offsetWidth - 8)}px`;
      menu.style.top = `${r.bottom + 6 + menu.offsetHeight > innerHeight ? Math.max(8, r.top - menu.offsetHeight - 6) : r.bottom + 6}px`;
      menu.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.t) { this.target = +b.dataset.t; store.set('lufsTarget', b.dataset.t); }
        if (b.dataset.reset) this.reset();
        closeMenu();
        this.render();
      });
      setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
    }
  };

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
        if (store.get('monitorSink', '')) setTimeout(applySink, 0);
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
        // Noise Gate ทำงานใน AudioWorklet (ต้องเป็น https/localhost) — ไม่มีก็ใช้ส่วนอื่นได้ตามปกติ
        this.gateReady = ctx.audioWorklet ? ctx.audioWorklet.addModule('assets/js/gate-worklet.js').then(() => true, e => { console.warn('gate worklet', e); return false; }) : Promise.resolve(false);
        lufs.start();
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
      // ตัดเสียงทุ้ม (Low cut) อยู่หน้า EQ เสมอ — ปิดอยู่ = ความถี่ 10 Hz (ไม่มีผลกับเสียงที่ได้ยิน)
      const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 10; hpf.Q.value = 0.707;
      delay.connect(hpf); hpf.connect(low); low.connect(mid); mid.connect(high); high.connect(fader);
      comp.connect(fader);
      // ducking: เกนแยกหลังเฟดเดอร์ ลดเสียงอัตโนมัติเมื่อช่องเสียงพูดดัง (ดู duckTick)
      const duck = ctx.createGain();
      fader.connect(duck);
      duck.connect(afv);
      afv.connect(analyser);
      afv.connect(this.master);
      // มิเตอร์ L/R บนการ์ดแหล่งภาพ — เสียงโมโนกระจายเข้าทั้งสองข้าง
      const st = ctx.createGain(), split = ctx.createChannelSplitter(2), anL = ctx.createAnalyser(), anR = ctx.createAnalyser();
      st.channelCount = 2; st.channelCountMode = 'explicit'; st.channelInterpretation = 'speakers';
      anL.fftSize = anR.fftSize = 512;
      afv.connect(st); st.connect(split); split.connect(anL, 0); split.connect(anR, 1);
      const ch = {
        id: uid(), node, input: delay, delay, hpf, low, mid, high, comp, fader, duckGain: duck, afvGain: afv, analyser, split: st, anL, anR,
        lr: { l: -90, r: -90, peak: -90, peakAt: 0, clipAt: 0, lastAt: 0 },
        db: 0, muted: false, afv: false, level: -90, peak: -90, peakAt: 0,
        fx: { ...FX_DEFAULT },
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
            comp: !!f.comp, threshold: clamp(+f.threshold || -18, -60, 0), ratio: clamp(+f.ratio || 4, 1, 20),
            gate: !!f.gate, gateDb: clamp(+f.gateDb || FX_DEFAULT.gateDb, -80, -10),
            duck: !!f.duck, duckDb: clamp(+f.duckDb || FX_DEFAULT.duckDb, -40, -3), duckThr: clamp(+f.duckThr || FX_DEFAULT.duckThr, -60, -10),
            duckBy: typeof f.duckBy === 'string' && f.duckBy ? f.duckBy.slice(0, 80) : 'voice',
            lowCut: !!f.lowCut, lowCutHz: clamp(+f.lowCutHz || 80, 20, 400), midHz: clamp(+f.midHz || 1000, 200, 8000),
            attack: clamp(+f.attack || 5, 1, 200), release: clamp(+f.release || 150, 20, 1000) };
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
      ch.hpf.frequency.setTargetAtTime(f.lowCut ? f.lowCutHz : 10, t, 0.01);
      ch.mid.frequency.setTargetAtTime(f.midHz || 1000, t, 0.01);
      ch.comp.attack.setTargetAtTime((f.attack || 5) / 1000, t, 0.01);
      ch.comp.release.setTargetAtTime((f.release || 150) / 1000, t, 0.01);
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
      this.applyGate(ch);
      if (ch.ducked) ch.duckGain.gain.setTargetAtTime(f.duck ? dbToGain(f.duckDb) : 1, t, 0.05);
      if (!f.duck) ch.ducked = false;
    },
    // Noise Gate อยู่หลังดีเลย์ ก่อน EQ: ดีเลย์ → (เกต) → EQ
    async applyGate(ch) {
      const f = ch.fx;
      if (ch.gate) ch.gate.parameters.get('threshold').setTargetAtTime(f.gateDb, this.ctx.currentTime, 0.01);
      if (!!ch.gateOn === !!f.gate) return;
      if (f.gate && !ch.gate) {
        if (ch.gateLoading) return;
        ch.gateLoading = true;
        const ready = await this.gateReady;
        ch.gateLoading = false;
        if (!ready) { ch.gateError = true; return; }
        ch.gate = new AudioWorkletNode(this.ctx, 'webmix-gate', { parameterData: { threshold: f.gateDb } });
        ch.gate.port.onmessage = e => { ch.gateOpen = e.data; };
        if (!ch.fx.gate) return;
      }
      ch.gateOn = !!f.gate;
      try { ch.delay.disconnect(); } catch (e) {}
      try { ch.gate.disconnect(); } catch (e) {}
      if (f.gate) { ch.delay.connect(ch.gate); ch.gate.connect(ch.hpf); }
      else { ch.delay.connect(ch.hpf); ch.gateOpen = true; }
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
    // micChan: null = ทุกช่อง · 0/1 = ใช้เฉพาะช่อง 1 หรือ 2 ของออดิโออินเทอร์เฟซ (ไมค์คนละตัวบนช่องซ้าย/ขวา)
    addMic(stream, name, extra = {}) {
      if (!this.ensure()) return;
      const src = this.ctx.createMediaStreamSource(stream);
      let node = src, dispose = null;
      if (extra.micChan != null) {
        const split = this.ctx.createChannelSplitter(2);
        node = this.ctx.createGain();
        node.channelCount = 1; node.channelCountMode = 'explicit';
        src.connect(split); split.connect(node, extra.micChan);
        dispose = () => { try { src.disconnect(); split.disconnect(); } catch (e) {} };
      }
      return this.addChannel(node, { name, kind: 'mic', stream, dispose, ...extra });
    },
    remove(ch) {
      try { ch.node.disconnect(); ch.afvGain.disconnect(); ch.split.disconnect(); } catch (e) {}
      if (ch.dispose) ch.dispose();
      this.channels.splice(this.channels.indexOf(ch), 1);
      // ไมค์ที่แยกช่อง 1/2 ใช้อุปกรณ์เดียวกัน — ปิดอุปกรณ์เมื่อไม่มีช่องไหนใช้แล้ว
      if (ch.stream && !this.channels.some(c => c.stream === ch.stream)) ch.stream.getTracks().forEach(t => t.stop());
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
        const on = !ch.afv || ch.inputId === state.programId || onOverlay(ch.inputId) || sceneHas(state.programId, ch.inputId)
          || ((tr.progress > 0 || tr.auto) && (ch.inputId === state.previewId || sceneHas(state.previewId, ch.inputId)));
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
      // นับครั้งที่เสียงแตะ 0 dB (ใช้เตือน “ดังเกิน”)
      const hot = db > -0.3;
      if (hot && !obj.hot) { (obj.clips || (obj.clips = [])).push(Date.now()); if (obj.clips.length > 20) obj.clips.shift(); }
      obj.hot = hot;
      if (obj.ui) {
        obj.ui.cover.style.height = `${(1 - meterPct(obj.level)) * 100}%`;
        obj.ui.peak.style.bottom = `${meterPct(obj.peak) * 100}%`;
        obj.ui.peak.style.opacity = obj.peak > -59 ? (obj.peak > -1 ? '1' : '.75') : '0';
        obj.ui.peak.style.background = obj.peak > -1 ? '#ef4444' : '#fff';
      }
    },
    // Ducking ทำงานทุกเฟรม รวมตอนแท็บถูกซ่อน (เฟรมมาจาก Worker) — ไม่แตะค่ามิเตอร์ที่แสดงบนจอ
    duckTick(now) {
      const list = this.channels.filter(c => c.fx.duck);
      if (!list.length) return;
      const buf = this.duckBuf || (this.duckBuf = new Float32Array(1024)), peaks = new Map();
      const peakDb = c => {
        if (!peaks.has(c)) {
          c.analyser.getFloatTimeDomainData(buf);
          let p = 0;
          for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
          peaks.set(c, p > 0 ? 20 * Math.log10(p) : -90);
        }
        return peaks.get(c);
      };
      for (const ch of list) {
        const f = ch.fx;
        const triggers = f.duckBy === 'voice' ? this.channels.filter(c => c !== ch && isVoiceChannel(c)) : this.channels.filter(c => c !== ch && chanKey(c) === f.duckBy);
        // ค้างไว้ครู่หนึ่งหลังเสียงพูดหยุด กันเพลงดัง-เบาสลับไปมาระหว่างคำ
        if (triggers.some(c => peakDb(c) > f.duckThr)) ch.duckHold = now + 500;
        const on = now < (ch.duckHold || 0);
        if (on === !!ch.ducked) continue;
        ch.ducked = on;
        ch.duckGain.gain.setTargetAtTime(on ? dbToGain(f.duckDb) : 1, this.ctx.currentTime, on ? 0.04 : 0.35);
      }
    },
    tick(now) {
      if (!this.ctx) return;
      this.duckTick(now);
      if (document.hidden) return;
      for (const ch of this.channels) this.measure(ch.analyser, ch, now);
      this.measure(this.analyser, this.masterStrip, now);
      cardVu.tick(now);
      // ไฟ LIM / COMP สว่างเมื่อกำลังลดระดับเสียงอยู่
      const lim = this.masterStrip.ui?.lim;
      if (lim) lim.classList.toggle('is-active', this.masterStrip.limiter && this.limiter.reduction < -0.5);
      for (const ch of this.channels) if (ch.ui?.fxBtn) {
        ch.ui.fxBtn.classList.toggle('is-active', ch.fx.comp && ch.comp.reduction < -1);
        ch.ui.fxBtn.classList.toggle('is-duck', !!ch.ducked);
      }
      for (const ch of this.channels) if (ch.src) stripSourceTick(ch);
    }
  };

  // มิเตอร์เสียงข้างการ์ดแหล่งภาพ: แถบ L/R + ขีดพีค + ปุ่มปิดเสียง/ค่า dB + ป้าย AFV (เฉพาะแหล่งที่มีเสียง)
  const cardVu = {
    chanOf: id => id && audio.channels.find(c => c.inputId === id),
    sync(only) {
      for (const card of $$('#inputs-grid .card')) {
        const id = card.dataset.id;
        if (only && id !== only) continue;
        const ch = this.chanOf(id), vu = card.querySelector('.card-vu');
        if (!vu) continue;
        const btn = card.querySelector('.card-mute');
        vu.hidden = btn.hidden = !ch;
        card.querySelector('.card-afv').hidden = !ch || !ch.afv || ch.muted;
        card.classList.toggle('has-audio', !!ch);
        if (!ch) continue;
        vu.classList.toggle('is-muted', ch.muted);
        btn.classList.toggle('is-muted', ch.muted);
        btn.querySelector('use').setAttribute('href', ch.muted ? '#i-vol-off' : '#i-vol');
        btn.querySelector('span').textContent = ch.muted ? 'MUTE' : (ch.db === -Infinity ? '-∞' : fmtDb(ch.db));
      }
    },
    toggleMute(id) {
      const ch = this.chanOf(id);
      if (!ch) return;
      audio.ensure();
      ch.muted = !ch.muted;
      audio.applyGain(ch);
      renderMixer();
    },
    level(an, buf) {
      an.getFloatTimeDomainData(buf);
      let p = 0;
      for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
      return p > 0 ? 20 * Math.log10(p) : -90;
    },
    tick(now) {
      const buf = this.buf || (this.buf = new Float32Array(512));
      for (const ch of audio.channels) {
        if (!ch.inputId || !ch.anL) continue;
        const card = ch.cardEl?.isConnected ? ch.cardEl : (ch.cardEl = $(`#inputs-grid .card[data-id="${ch.inputId}"]`));
        if (!card) continue;
        const v = ch.lr, dt = v.lastAt ? (now - v.lastAt) / 1000 : 0;
        v.lastAt = now;
        const l = this.level(ch.anL, buf), r = this.level(ch.anR, buf), top = Math.max(l, r);
        v.l = l > v.l ? l : Math.max(l, v.l - 26 * dt);
        v.r = r > v.r ? r : Math.max(r, v.r - 26 * dt);
        if (top >= v.peak || now - v.peakAt > 1500) { v.peak = top; v.peakAt = now; }
        if (top > -1) v.clipAt = now;
        const ui = ch.cardUi?.vu?.isConnected ? ch.cardUi : (ch.cardUi = { vu: card.querySelector('.card-vu'), bars: card.querySelectorAll('.card-vu b'), pk: card.querySelector('.card-vu em'), btn: card.querySelector('.card-mute') });
        if (!ui.vu) continue;
        ui.bars[0].style.height = `${(1 - meterPct(v.l)) * 100}%`;
        ui.bars[1].style.height = `${(1 - meterPct(v.r)) * 100}%`;
        ui.pk.style.bottom = `${meterPct(v.peak) * 100}%`;
        ui.pk.style.opacity = v.peak > -59 ? '1' : '0';
        const clip = now - v.clipAt < 2000 && !ch.muted;
        ui.vu.classList.toggle('is-clip', clip);
        ui.btn?.classList.toggle('is-clip', clip);
      }
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
      hint.innerHTML = `<b>ยังไม่มีช่องเสียง</b><span>เสียงจากกล้องและวิดีโอจะมาเอง · หรือเพิ่มไมค์ เพลง เสียงจากคอม</span><button type="button" class="btn btn-sm">${icon('plus')} เพิ่มแหล่งเสียง</button>`;
      hint.querySelector('button').onclick = () => $('[data-action=add-audio]')?.click();
      mixer.appendChild(hint);
    }
    cardVu.sync();
  }

  function buildStrip(ch, isMaster) {
    const el = document.createElement('div');
    el.className = 'strip' + (isMaster ? ' master' : '') + (!isMaster && ch.src ? ' has-src' : '');
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
        ${!isMaster && !ch.inputId && !ch.src ? '<button class="chip-btn rm" title="ลบช่องเสียงนี้">✕</button>' : ''}
      </div>
      ${!isMaster && ch.src ? stripSourceHtml(ch) : ''}`;
    ch.ui = { cover: el.querySelector('.meter-cover'), peak: el.querySelector('.meter-peak'), lim: el.querySelector('.lim'), fxBtn: el.querySelector('.fx') };
    const dbEl = ch.ui.db = el.querySelector('.strip-db');
    ch.ui.fader = makeFader(el.querySelector('.vfader'), {
      value: dbToPos(ch.db) * 100,
      defaultValue: 75,
      label: `${ch.name} volume`,
      onInput: v => {
        ch.db = posToDb(v / 100);
        dbEl.textContent = `${fmtDb(ch.db)} dB`;
        isMaster ? audio.applyMaster() : audio.applyGain(ch);
        if (!isMaster) cardVu.sync(ch.inputId);
      }
    });
    bindStripButtons(el, ch, isMaster);
    if (!isMaster && ch.src) bindStripSource(el, ch);
    return el;
  }

  function bindStripButtons(el, ch, isMaster) {
    el.querySelector('.mute').addEventListener('click', e => {
      audio.ensure();
      ch.muted = !ch.muted;
      e.currentTarget.classList.toggle('is-on', ch.muted);
      isMaster ? audio.applyMaster() : audio.applyGain(ch);
      cardVu.sync();
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
      cardVu.sync();
    });
    el.querySelector('.rm')?.addEventListener('click', async () => {
      if (await confirmDialog(`ลบช่องเสียง “${ch.name}”`, 'แหล่งเสียงนี้จะถูกปิดและนำออกจากมิกเซอร์', 'ลบ')) audio.remove(ch);
    });
  }

  const fxActive = ch => ch.fx && (ch.fx.delayMs || ch.fx.lowCut || ch.fx.low || ch.fx.mid || ch.fx.high || ch.fx.comp || ch.fx.gate || ch.fx.duck);

  // หน้าต่างปรับเสียงต่อช่อง — เปลี่ยนค่าแล้วได้ยินผลทันที
  // หน้าต่างเอฟเฟกต์เสียงรายช่อง: รายชื่อช่องซ้าย · กราฟ EQ จริงจากฟิลเตอร์ · คอมเพรสเซอร์พร้อมมิเตอร์ลดระดับ · เกต / ดีเลย์ / ดั๊กกิ้ง
  // เปลี่ยนค่าแล้วได้ยินผลทันที
  const FX_VOICE = { lowCut: true, lowCutHz: 80, low: -2.5, mid: 3, midHz: 3200, high: 1.5, comp: true, threshold: -18, ratio: 3, attack: 10, release: 120, gate: true, gateDb: -48 };
  function openChannelFx(ch) {
    const f = ch.fx;
    const fmt = (key, v) => key === 'delayMs' || key === 'attack' || key === 'release' ? `${v} ms` : key === 'ratio' ? `${v} : 1`
      : key === 'lowCutHz' || key === 'midHz' ? (v >= 1000 ? `${+(v / 1000).toFixed(1)} kHz` : `${v} Hz`) : `${v > 0 && /low|mid|high/.test(key) ? '+' : ''}${v} dB`;
    const row = (key, label, min, max, step) => `
      <label class="fx-row"><span>${label}<b class="mono" data-val="${key}">${fmt(key, f[key])}</b></span>
        <input class="range" type="range" data-fx="${key}" min="${min}" max="${max}" step="${step}" value="${f[key]}"></label>`;
    const sw = (key, label, extra = '') => `<label class="fx-sw"><input type="checkbox" data-fx="${key}" ${f[key] ? 'checked' : ''}><i aria-hidden="true"></i><span>${label}</span>${extra}</label>`;
    const others = audio.channels.filter(c => c !== ch);
    const list = audio.channels.map(c => `<button type="button" class="fx-ch ${c === ch ? 'is-on' : ''}" data-ch="${c.id}">
        <b>${esc(c.name)}</b><span class="fx-ch-meter"><i></i></span>
        <span class="fx-ch-tags">${c.fx.lowCut || c.fx.low || c.fx.mid || c.fx.high ? '<em>EQ</em>' : ''}${c.fx.comp ? '<em>COMP</em>' : ''}${c.fx.gate ? '<em>GATE</em>' : ''}${c.fx.duck ? '<em>DUCK</em>' : ''}</span></button>`).join('');
    dialog({
      title: `เอฟเฟกต์เสียง — ${ch.name}`,
      wide: true,
      body: `<div class="fx-wrap">
        <nav class="fx-list" aria-label="ช่องเสียง">${list}</nav>
        <div class="fx-main">
          <section class="fx-card fx-eq">
            <div class="fx-h"><h3>EQ 4 ย่าน</h3><span class="fx-sub">ลากแถบเพื่อปรับ · เส้นกราฟคือผลรวมจริง</span></div>
            <svg class="fx-graph" viewBox="0 0 700 150" preserveAspectRatio="none" aria-label="กราฟ EQ"><g class="fx-grid"></g><path class="fx-fill"/><path class="fx-curve"/></svg>
            <div class="fx-bands">
              <div class="fx-band">${sw('lowCut', 'Low cut')}${row('lowCutHz', 'ความถี่', 20, 400, 5)}</div>
              <div class="fx-band"><b>Low</b>${row('low', 'เสียงต่ำ 120 Hz', -12, 12, 0.5)}</div>
              <div class="fx-band"><b>Presence</b>${row('mid', 'ระดับ', -12, 12, 0.5)}${row('midHz', 'ความถี่', 200, 8000, 50)}</div>
              <div class="fx-band"><b>Air</b>${row('high', 'เสียงสูง 8 kHz', -12, 12, 0.5)}</div>
            </div>
          </section>
          <section class="fx-card">
            <div class="fx-h"><h3>คอมเพรสเซอร์</h3>${sw('comp', 'เปิด')}</div>
            ${row('threshold', 'Threshold', -50, 0, 1)}${row('ratio', 'Ratio', 1, 20, 0.5)}
            <div class="fx-two">${row('attack', 'Attack', 1, 200, 1)}${row('release', 'Release', 20, 1000, 10)}</div>
            <div class="fx-gr"><span>ลดเสียงอยู่</span><span class="fx-gr-bar"><i></i></span><b class="mono">0.0 dB</b></div>
          </section>
          <section class="fx-card">
            <div class="fx-h"><h3>เกต · ดีเลย์ · ดั๊กกิ้ง</h3></div>
            ${sw('gate', 'Noise Gate — ตัดเสียงรบกวนตอนไม่ได้พูด', '<b class="gate-led ' + (f.gate ? '' : 'off') + '" aria-hidden="true"></b>')}
            ${row('gateDb', 'ระดับเปิดเสียง', -80, -10, 1)}
            <p class="note gate-note">${audio.ctx && !audio.ctx.audioWorklet ? 'เบราว์เซอร์นี้ไม่รองรับ Noise Gate (ต้องเปิดผ่าน https)' : 'พูดปกติแล้วไฟเขียวต้องติด — ไฟดับตอนเงียบ'}</p>
            ${row('delayMs', 'ดีเลย์ (ซิงก์ปาก)', 0, 500, 10)}
            ${sw('duck', 'ดั๊กกิ้ง: ลดช่องนี้เมื่อมีคนพูด', '<b class="duck-led" aria-hidden="true"></b>')}
            <label class="fx-row"><span>ลดเสียงเมื่อช่องนี้มีเสียง</span><select class="select" data-fx="duckBy">
              <option value="voice">ไมค์และแขกรับเชิญทุกช่อง</option>
              ${audioChanOptions().filter(([k]) => k !== chanKey(ch)).map(([k, n]) => `<option value="${esc(k)}" ${k === f.duckBy ? 'selected' : ''}>${esc(n)}</option>`).join('')}
            </select></label>
            <div class="fx-two">${row('duckDb', 'ลดลง', -40, -3, 1)}${row('duckThr', 'ถือว่าเริ่มพูดที่', -60, -10, 1)}</div>
          </section>
        </div>
      </div>`,
      actions: [{ label: 'ตั้งเป็นเสียงพูดชัด', value: 'voice' }, ...(others.length ? [{ label: 'คัดลอกไปช่องอื่น', value: 'copy' }] : []), { label: 'รีเซ็ต', value: 'reset' }, { label: 'เสร็จ', primary: true }],
      onOpen(modal, close) {
        modal.classList.add('fx-modal');
        const curve = $('.fx-curve', modal), fill = $('.fx-fill', modal);
        // เส้นกริด: 50 / 200 / 1k / 4k / 12k Hz และ 0 dB
        const N = 140, freqs = new Float32Array(N), mag = new Float32Array(N), ph = new Float32Array(N);
        const xOf = hz => Math.log(hz / 20) / Math.log(1000) * 700;
        for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
        $('.fx-grid', modal).innerHTML = [50, 200, 1000, 4000, 12000].map(hz => `<line x1="${xOf(hz)}" x2="${xOf(hz)}" y1="0" y2="150"/><text x="${xOf(hz) + 4}" y="144">${hz >= 1000 ? hz / 1000 + 'k' : hz}</text>`).join('') + '<line x1="0" x2="700" y1="75" y2="75" class="z"/>';
        const draw = () => {
          const total = new Float32Array(N);
          if (audio.ctx) for (const node of [ch.hpf, ch.low, ch.mid, ch.high]) {
            node.getFrequencyResponse(freqs, mag, ph);
            for (let i = 0; i < N; i++) total[i] += 20 * Math.log10(Math.max(mag[i], 1e-5));
          }
          let d = '';
          for (let i = 0; i < N; i++) d += `${i ? 'L' : 'M'}${(i / (N - 1) * 700).toFixed(1)} ${clamp(75 - total[i] * 5, 2, 148).toFixed(1)} `;
          curve.setAttribute('d', d);
          fill.setAttribute('d', d + 'L700 150 L0 150 Z');
        };
        const refresh = () => {
          for (const el of $$('[data-fx]', modal)) {
            const k = el.dataset.fx;
            if (el.type === 'checkbox') el.checked = !!f[k]; else el.value = f[k];
            const label = $(`[data-val="${k}"]`, modal);
            if (label) label.textContent = fmt(k, f[k]);
          }
          $('.gate-led', modal).classList.toggle('off', !f.gate);
          ch.ui?.fxBtn?.classList.toggle('is-on', !!fxActive(ch));
          // AudioParam เปลี่ยนแบบค่อยเป็นค่อยไป — วาดใหม่หลังค่าเข้าที่
          draw(); setTimeout(draw, 80);
        };
        modal.addEventListener('input', e => {
          const key = e.target.dataset.fx;
          if (!key) return;
          f[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : +e.target.value;
          const label = $(`[data-val="${key}"]`, modal);
          if (label) label.textContent = fmt(key, f[key]);
          audio.applyFx(ch);
          if (key === 'gate') $('.gate-led', modal).classList.toggle('off', !f.gate);
          ch.ui?.fxBtn?.classList.toggle('is-on', !!fxActive(ch));
          draw(); setTimeout(draw, 80);
        });
        $('.fx-list', modal).addEventListener('click', e => {
          const b = e.target.closest('[data-ch]');
          const next = b && audio.channels.find(c => c.id === b.dataset.ch);
          if (!next || next === ch) return;
          close();
          setTimeout(() => openChannelFx(next), 0);
        });
        modal._fxRefresh = refresh;
        draw(); setTimeout(draw, 80);
        // ไฟเกต / ดั๊ก · มิเตอร์ลดระดับของคอมเพรสเซอร์ · มิเตอร์ของแต่ละช่องในรายการ
        const led = $('.gate-led', modal), gr = $('.fx-gr-bar i', modal), grText = $('.fx-gr b', modal);
        const meters = $$('.fx-ch', modal).map(b => [audio.channels.find(c => c.id === b.dataset.ch), $('.fx-ch-meter i', b)]);
        const tick = () => {
          if (!modal.isConnected) return;
          led.classList.toggle('open', !!(f.gate && ch.gateOn && ch.gateOpen));
          $('.duck-led', modal).classList.toggle('on', !!(f.duck && ch.ducked));
          if (ch.gateError) $('.gate-note', modal).textContent = 'เปิด Noise Gate ไม่ได้ในเบราว์เซอร์นี้ (ต้องเปิดผ่าน https หรือ localhost)';
          const red = f.comp && audio.ctx ? Math.min(0, ch.comp.reduction) : 0;
          gr.style.width = `${clamp(-red / 20, 0, 1) * 100}%`;
          grText.textContent = `${red.toFixed(1)} dB`;
          for (const [c, el] of meters) if (c) el.style.width = `${meterPct(c.level) * 100}%`;
          setTimeout(tick, 100);
        };
        tick();
        // ปุ่มด้านล่าง (ยกเว้น “เสร็จ”) ทำงานโดยไม่ปิดหน้าต่าง
        for (const btn of $$('.modal-foot .btn', modal)) {
          const label = btn.textContent;
          if (label === 'เสร็จ') continue;
          const clone = btn.cloneNode(true);
          btn.replaceWith(clone);
          clone.addEventListener('click', () => {
            if (label === 'รีเซ็ต') { Object.assign(f, FX_DEFAULT, { duckBy: f.duckBy }); toast(`รีเซ็ตการปรับเสียงของ “${ch.name}” แล้ว`); }
            else if (label === 'ตั้งเป็นเสียงพูดชัด') { Object.assign(f, FX_VOICE); toast('ตั้งเป็น “เสียงพูดชัด” แล้ว — ตัดเสียงทุ้ม เน้นความชัด เกลี่ยระดับ ตัดเสียงรบกวน', 'success'); }
            else if (label.startsWith('คัดลอก')) {
              const { duck, duckBy, duckDb, duckThr, ...eq } = f;
              for (const c of others) { Object.assign(c.fx, eq); audio.applyFx(c); }
              renderMixer();
              toast(`คัดลอก EQ / คอมเพรสเซอร์ / เกต / ดีเลย์ ไปอีก ${others.length} ช่องแล้ว`, 'success');
              return;
            }
            audio.applyFx(ch);
            refresh();
          });
        }
      }
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
      if (call.metadata && call.metadata.talk) { remoteCtl.talkCall(call); return; }
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
      if (conn.metadata && conn.metadata.remote) { remoteCtl.accept(conn); return; }
      if (this.blocked.has(conn.peer)) {
        conn.on('open', () => { conn.send({ type: 'removed' }); setTimeout(() => conn.close(), 500); });
        return;
      }
      this.conns.set(conn.peer, conn);
      conn.on('open', () => this.sendTallyTo(conn));
      conn.on('data', msg => this.onCamMsg(conn.peer, msg));
      conn.on('close', () => { if (this.conns.get(conn.peer) === conn) this.conns.delete(conn.peer); });
    },
    sendTallyTo(conn) {
      if (!conn.open) return;
      const inp = inputs.find(i => i.peerId === conn.peer);
      const tally = !inp ? 'off' : isOnAir(inp.id) ? 'pgm' : inp.id === state.previewId ? 'pvw' : 'off';
      try { conn.send({ type: 'tally', tally }); } catch (e) {}
    },
    sendTally() { for (const conn of this.conns.values()) this.sendTallyTo(conn); },
    // กล้องมือถือแบบโปร: สถานะกล้อง (ความสามารถ/ค่าปัจจุบัน/แบต/บันทึก) และคำสั่งควบคุมจากสตูดิโอ
    onCamMsg(peerId, msg) {
      if (!msg || msg.type !== 'cam-state' || typeof msg !== 'object') return;
      const inp = inputs.find(i => i.type === 'wireless' && i.peerId === peerId);
      if (!inp) return;
      const first = !inp.cam;
      inp.cam = msg;
      if (first || !!$(`#inputs-grid .card[data-id="${inp.id}"] [data-card=camctl]`) !== (inp.status === 'live')) renderInputs();
      else {
        const sub = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
        if (sub) sub.textContent = cardSub(inp);
        $(`#inputs-grid .card[data-id="${inp.id}"] [data-card=camctl]`)?.classList.toggle('is-rec', !!msg.rec);
      }
      if (camCtl && camCtl.inp === inp) camCtl.refresh();
    },
    sendCam(inp, msg) {
      const conn = this.conns.get(inp.peerId);
      if (conn && conn.open) { try { conn.send(msg); return true; } catch (e) {} }
      return false;
    },
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

  /* ------------------------------------------------------ remote control */
  // แท็บเล็ต/มือถือสั่งงานสตูดิโอผ่าน PeerJS data channel — ต้องมีรหัสในลิงก์ (สร้างใหม่ได้ = ตัดรีโมตเดิมทั้งหมด)
  // ทีมงานหลายตำแหน่ง: แต่ละเครื่องเลือกตำแหน่งจากลิงก์/QR แล้วจับคู่ด้วยรหัส 6 หลักที่แสดงบนเครื่องหลัก
  // จับคู่แล้วได้ token เก็บในเครื่องนั้น (ต่อใหม่ไม่ต้องใส่รหัสอีก) · เครื่องหลักเปลี่ยนตำแหน่ง/ถอดเครื่องได้ · สิทธิ์ตรวจที่เครื่องหลัก
  const REMOTE_ROLES = window.WebMix.REMOTE_ROLES;
  const INSERT_TYPES = ['media', 'playlist', 'slides', 'replay'];
  const REMOTE_ALLOW = {
    director: '*',
    switcher: ['pvw', 'take', 'cut', 'auto', 'ftb', 'trans'],
    sound: ['vol', 'mute', 'sfx', 'music'],
    cg: ['ovl', 'gfx', 'title', 'ticker', 'cap', 'chathide', 'timer', 'score'],
    insert: ['media', 'pvw'],
    camera: [],
    monitor: []
  };
  const randCode = (n, abc) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => abc[b % abc.length]).join('');
  const remoteCtl = {
    conns: new Map(), last: '', timer: 0, thumbAt: 0, fails: [], msgs: [],
    pin() {
      if (!/^\d{6}$/.test(settings.remotePin || '')) { settings.remotePin = randCode(6, '0123456789'); saveSettings(); }
      return settings.remotePin;
    },
    team() { if (!Array.isArray(settings.remoteTeam)) settings.remoteTeam = []; return settings.remoteTeam; },
    link(role) {
      const q = new URLSearchParams({ remote: wireless.peerId, role });
      if (wireless.sig) q.set('sig', b64url(JSON.stringify(wireless.sig)));
      return `${pageBase()}?${q}`;
    },
    deny(conn, code, message) {
      try { conn.send({ type: 'r-denied', code, message }); } catch (e) {}
      setTimeout(() => { try { conn.close(); } catch (e) {} }, 500);
    },
    accept(conn) {
      conn.on('open', () => {
        const md = conn.metadata || {};
        const dev = String(md.dev || '').slice(0, 40), name = String(md.name || '').trim().slice(0, 30);
        if (!dev) { this.deny(conn, 'old', 'ลิงก์รีโมตเวอร์ชันเก่า — สแกน QR ใหม่จากปุ่ม “รีโมต” บนเครื่องหลัก'); return; }
        let m = md.token && this.team().find(t => t.dev === dev && t.token === md.token);
        if (!m) {
          const now = Date.now();
          this.fails = this.fails.filter(t => now - t < 60000);
          if (!md.pin) { this.deny(conn, 'pair', ''); return; }
          if (this.fails.length >= 5) { this.deny(conn, 'locked', 'ใส่รหัสผิดหลายครั้ง — รอ 1 นาทีแล้วลองใหม่'); return; }
          if (String(md.pin) !== this.pin()) { this.fails.push(now); this.deny(conn, 'pin', 'รหัสจับคู่ไม่ถูกต้อง — ดูรหัส 6 หลักบนเครื่องหลัก (ปุ่ม “รีโมต”)'); return; }
          m = { dev, token: randCode(24, 'abcdefghijkmnpqrstuvwxyz23456789'), name: name || 'ไม่ระบุชื่อ', role: REMOTE_ROLES[md.role] ? md.role : 'monitor' };
          settings.remoteTeam = this.team().filter(t => t.dev !== dev).concat(m);
          saveSettings();
          conn.send({ type: 'r-paired', token: m.token });
        } else if (name && name !== m.name) { m.name = name; saveSettings(); }
        // เครื่องเดิมต่อซ้ำ → ปิดการเชื่อมต่อเก่า
        for (const [c, x] of this.conns) if (x === m) { this.conns.delete(c); try { c.close(); } catch (e) {} }
        this.conns.set(conn, m);
        this.last = '';
        conn.send({ type: 'r-hello', role: m.role, name: m.name, msgs: this.msgs.slice(-20) });
        conn.send({ type: 'r-talking', names: [...this.talking].concat(this.hostTalking ? ['เครื่องหลัก'] : []) });
        toast(`${m.name} (${REMOTE_ROLES[m.role].label}) เข้าร่วมแล้ว`, 'success', 3000);
        this.start();
        this.push(true);
        this.changed();
      });
      conn.on('data', msg => { const m = this.conns.get(conn); if (m) this.command(msg, m, conn); });
      conn.on('close', () => {
        const m = this.conns.get(conn);
        if (m && this.conns.delete(conn)) {
          toast(`${m.name} ออกจากทีม`, 'info', 2500);
          if (!this.online(m) && this.talks.get(m)) this.talkDrop(m, this.talks.get(m));
          this.changed();
        }
      });
    },
    // ---- ทอล์กแบ็ก (อินเตอร์คอมแบบ party line): ทุกเครื่องได้ยินกันหมด ยกเว้นเสียงตัวเอง · ไม่เข้า Program
    // เสียงจากรีโมตแต่ละเครื่อง → gain → ปลายทางของเครื่องอื่นทุกเครื่อง + ลำโพงเครื่องหลัก · ไมค์เครื่องหลัก (กดค้าง) → ทุกเครื่อง
    talks: new Map(), talking: new Set(), talkMic: null, talkMicGain: null, talkMon: null, hostTalking: false,
    talkMonitor() {
      if (!this.talkMon) {
        this.talkMon = audio.ctx.createGain();
        this.talkMon.gain.value = +store.get('talkVol', 1);
        this.talkMon.connect(audio.ctx.destination);
      }
      return this.talkMon;
    },
    talkCall(call) {
      const md = call.metadata || {};
      const m = this.team().find(t => t.dev === md.dev && t.token && t.token === md.token);
      if (!m) { try { call.close(); } catch (e) {} return; }
      if (!audio.ensure()) { try { call.close(); } catch (e) {} return; }
      const ctx = audio.ctx;
      const old = this.talks.get(m);
      if (old) this.talkDrop(m, old);
      const e = { call, dest: ctx.createMediaStreamDestination(), gain: ctx.createGain(), src: null, el: null };
      for (const o of this.talks.values()) { o.gain.connect(e.dest); e.gain.connect(o.dest); }
      if (this.talkMicGain) this.talkMicGain.connect(e.dest);
      e.gain.connect(this.talkMonitor());
      this.talks.set(m, e);
      call.answer(e.dest.stream);
      call.on('stream', s => {
        if (this.talks.get(m) !== e || e.src) return;
        // Chrome ส่งเสียงจาก WebRTC เข้า Web Audio ได้ก็ต่อเมื่อผูกกับ <audio> ด้วย (ปิดเสียงไว้)
        e.el = new Audio(); e.el.muted = true; e.el.srcObject = s; e.el.play().catch(() => {});
        e.src = ctx.createMediaStreamSource(s);
        e.src.connect(e.gain);
      });
      call.on('close', () => { if (this.talks.get(m) === e) this.talkDrop(m, e); });
    },
    talkDrop(m, e) {
      this.talks.delete(m);
      for (const n of [e.src, e.gain]) { try { n && n.disconnect(); } catch (x) {} }
      for (const o of this.talks.values()) { try { o.gain.disconnect(e.dest); } catch (x) {} }
      if (this.talkMicGain) { try { this.talkMicGain.disconnect(e.dest); } catch (x) {} }
      try { e.call.close(); } catch (x) {}
      if (e.el) e.el.srcObject = null;
      if (this.talking.delete(m.name)) this.talkState();
    },
    talkState() {
      const names = [...this.talking].concat(this.hostTalking ? ['เครื่องหลัก'] : []);
      this.send({ type: 'r-talking', names });
      const b = $('#btn-talk');
      if (b) {
        const others = [...this.talking];
        b.classList.toggle('is-hearing', others.length > 0);
        $('.talk-who', b).textContent = others.length ? others.join(', ') : '';
      }
    },
    async hostTalk(on) {
      this.hostTalking = on;
      if (on && !this.talkMic) {
        if (!audio.ensure()) return;
        try {
          this.talkMic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (e) { toast('ใช้ไมค์สำหรับทอล์กแบ็กไม่ได้ — อนุญาตไมค์ให้หน้านี้ก่อน', 'error'); this.hostTalking = false; return; }
        const src = audio.ctx.createMediaStreamSource(this.talkMic);
        this.talkMicGain = audio.ctx.createGain();
        this.talkMicGain.gain.value = 0;
        src.connect(this.talkMicGain);
        for (const o of this.talks.values()) this.talkMicGain.connect(o.dest);
      }
      if (this.talkMicGain) this.talkMicGain.gain.setTargetAtTime(this.hostTalking ? 1 : 0, audio.ctx.currentTime, 0.02);
      $('#btn-talk')?.classList.toggle('is-on', this.hostTalking);
      this.talkState();
    },
    online(m) { return [...this.conns.values()].includes(m); },
    // รายชื่อทีมส่งให้ทุกเครื่อง + รีเฟรชหน้าต่างทีมงานถ้าเปิดอยู่
    changed() {
      const tb = $('#btn-talk');
      if (tb) tb.hidden = !this.conns.size;
      this.send({ type: 'r-team', members: this.team().map(m => ({ name: m.name, role: m.role, on: this.online(m) })) });
      if (this.renderList) this.renderList();
    },
    setRole(m, role) {
      if (!REMOTE_ROLES[role]) return;
      m.role = role; saveSettings();
      for (const [c, x] of this.conns) if (x === m) { try { c.send({ type: 'r-role', role }); } catch (e) {} }
      this.last = '';
      this.changed();
    },
    unpair(m) {
      settings.remoteTeam = this.team().filter(t => t !== m); saveSettings();
      for (const [c, x] of this.conns) if (x === m) { this.conns.delete(c); this.deny(c, 'revoked', 'เครื่องหลักยกเลิกการจับคู่เครื่องนี้แล้ว — ขอรหัสใหม่เพื่อเข้าร่วมอีกครั้ง'); }
      this.changed();
    },
    message(text, from, role) {
      text = String(text || '').trim().slice(0, 200);
      if (!text) return;
      const msg = { type: 'r-msg', from, role, text, at: Date.now() };
      this.msgs = this.msgs.concat(msg).slice(-50);
      this.send(msg);
      if (role !== 'host') toast(`💬 ${from}: ${text}`, 'info', 6000);
      if (this.renderList) this.renderList();
    },
    start() {
      if (this.timer) return;
      this.timer = setInterval(() => {
        if (!this.conns.size) { clearInterval(this.timer); this.timer = 0; return; }
        this.push(false);
      }, 200);
    },
    state() {
      const chans = [audio.masterStrip, ...audio.channels];
      const inp = i => {
        const o = { id: i.id, n: inputs.indexOf(i) + 1, name: i.name, t: i.type, live: i.status === 'live', air: isOnAir(i.id) };
        if (i.type === 'title') Object.assign(o, { hl: i.title.headline, sub: i.title.subtitle });
        else if (i.type === 'ticker') o.items = i.ticker.items.join('\n');
        else if (i.type === 'score') Object.assign(o, { ta: i.score.teamA, tb: i.score.teamB, sa: +i.score.scoreA || 0, sb: +i.score.scoreB || 0 });
        else if (i.type === 'timer') o.run = !!i.timer.running;
        else if (i.type === 'media' && i.el && i.el.tagName === 'VIDEO') Object.assign(o, { play: !i.el.paused, loop: !!i.el.loop });
        else if (i.type === 'playlist') Object.assign(o, { play: !!i.list.playing, pos: i.list.items.length ? `${i.list.index + 1}/${i.list.items.length}` : '', item: i.list.items[i.list.index]?.name || '' });
        else if (i.type === 'slides') o.pos = i.slides.count ? `${i.slides.page}/${i.slides.count}` : '';
        else if (i.type === 'captions') o.on = !!i.capRun?.on;
        return o;
      };
      return {
        type: 'r-state', pgm: state.programId, pvw: state.previewId, ftb: !!ftb.target, live: !!(streamer.ws || streamer.reconnecting), rec: !!rec.active,
        trans: settings.transition, transList: TRANSITIONS.filter(t => t !== 'stinger' || stinger.ready),
        inputs: inputs.map(inp),
        ovl: ovl.map(c => ({ on: !!c.on, id: byId(c.inputId) ? c.inputId : '', name: byId(c.inputId)?.name || '' })),
        audio: chans.map(c => {
          const o = { key: c === audio.masterStrip ? 'master' : chanKey(c) || c.id, name: c.name, db: c.db === -Infinity ? null : +c.db.toFixed(1), muted: !!c.muted, kind: c.kind || '' };
          if (c.kind === 'pad') o.pads = c.pads.map((p, i) => p ? { name: p.name, on: c.playingPad(i) } : null);
          if (c.kind === 'player' && c.src) o.play = c.src.playing();
          return o;
        }),
        macros: macros.map(m => ({ id: m.id, name: m.name })), runMacro: macroRun.id,
        chat: !!(chatFeed.shown && !chatFeed.hideAt)
      };
    },
    send(msg, filter) { for (const [c, m] of this.conns) { if (c.open && (!filter || filter(m))) { try { c.send(msg); } catch (e) {} } } },
    push(force) {
      const st = JSON.stringify(this.state());
      if (force || st !== this.last) { this.last = st; this.send(JSON.parse(st)); }
      this.send({ type: 'r-lv', v: [audio.masterStrip, ...audio.channels].map(c => Math.round(c.level || -90)), oa: onAirSince ? Date.now() - onAirSince : 0, rem: clipRemaining(byId(state.programId)), lu: [lufs.m, lufs.s, lufs.i].map(v => isFinite(v) && v > -60 ? Math.round(v * 10) / 10 : null), lt: lufs.target });
      // ภาพย่อ Preview / Program และ Multiview (ทุกแหล่งภาพ) วินาทีละครั้ง
      if (performance.now() - this.thumbAt > 1000) {
        this.thumbAt = performance.now();
        const snap = (src, w, h, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h); return c.toDataURL('image/jpeg', q); };
        try { this.send({ type: 'r-thumbs', pgm: snap(pgmCanvas, 384, 216, 0.6), pvw: snap(pvwCanvas, 384, 216, 0.6) }); } catch (e) {}
        const wantMv = m => ['director', 'switcher', 'insert', 'monitor', 'camera'].includes(m.role);
        if ([...this.conns.values()].some(wantMv)) {
          const mv = {};
          for (const i of inputs) {
            try {
              const ctx = thumbs.get(i.id);
              if (ctx) mv[i.id] = snap(ctx.canvas, 192, 108, 0.5);
              else { const c = document.createElement('canvas'); c.width = 192; c.height = 108; drawSource(c.getContext('2d'), i, 192, 108); mv[i.id] = c.toDataURL('image/jpeg', 0.5); }
            } catch (e) {}
          }
          this.send({ type: 'r-mv', mv }, wantMv);
        }
      }
    },
    command(m, mem) {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'r-msg') { this.message(m.text, mem.name, mem.role); return; }
      if (m.type === 'r-talk') { if (m.on) this.talking.add(mem.name); else this.talking.delete(mem.name); this.talkState(); return; }
      if (m.type !== 'r-cmd') return;
      const allow = REMOTE_ALLOW[mem.role];
      if (allow !== '*' && !(allow || []).includes(m.cmd)) return;
      audio.ensure();
      const v = m.v, inp = byId(m.id);
      switch (m.cmd) {
        case 'pvw':
          if (mem.role === 'insert' && !(inp && INSERT_TYPES.includes(inp.type))) break;
          if (inp && m.id !== state.programId) setPreview(m.id);
          break;
        case 'take': if (inp && m.id !== state.programId) { state.previewId = m.id; cut(); } break;
        case 'cut': cut(); break;
        case 'auto': autoTransition(); break;
        case 'ftb': toggleFtb(); break;
        case 'trans':
          if (TRANSITIONS.includes(v) && (v !== 'stinger' || stinger.ready)) { settings.transition = v; $$('#seg-transition button').forEach(b => b.classList.toggle('is-active', b.dataset.value === v)); saveSettings(); }
          break;
        case 'ovl': { const i = +v; if (ovl[i] && (ovl[i].on || byId(ovl[i].inputId))) setChannel(i, !ovl[i].on); break; }
        // ขึ้น/ลงกราฟิกหนึ่งชิ้น: ใช้ช่อง Overlay ที่ผูกไว้ ถ้ายังไม่มีใช้ช่องว่างช่องแรก
        case 'gfx': {
          if (!inp || !GRAPHIC_TYPES.includes(inp.type)) break;
          const at = ovl.findIndex(c => c.inputId === m.id);
          if (at >= 0) { setChannel(at, !ovl[at].on); break; }
          const free = ovl.findIndex(c => !byId(c.inputId));
          const idx = free >= 0 ? free : ovl.findIndex(c => !c.on);
          if (idx >= 0) toggleInputOverlay(m.id, idx);
          break;
        }
        case 'title':
          if (inp && inp.type === 'title') { inp.title.headline = String(m.hl ?? '').slice(0, 80); inp.title.subtitle = String(m.sub ?? '').slice(0, 120); renderInputs(); }
          break;
        case 'ticker':
          if (inp && inp.type === 'ticker') { inp.ticker.items = String(m.items || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100); renderInputs(); }
          break;
        case 'timer': if (inp && inp.type === 'timer' && (v === 'toggle' || v === 'reset')) timerControl(inp, v); break;
        case 'score':
          if (inp && inp.type === 'score' && (v === 'a' || v === 'b')) { const k = v === 'a' ? 'scoreA' : 'scoreB'; inp.score[k] = Math.max(0, (+inp.score[k] || 0) + (m.d > 0 ? 1 : -1)); }
          break;
        case 'chathide': chatHide(); break;
        case 'media': {
          if (!inp || !INSERT_TYPES.includes(inp.type)) break;
          const vid = inp.el && inp.el.tagName === 'VIDEO' && inp.type === 'media';
          if (v === 'play' && vid) clipPlayToggle(inp);
          else if (v === 'restart' && vid) clipRestart(inp);
          else if (v === 'loop' && vid) inp.el.loop = !inp.el.loop;
          else if ((v === 'prev' || v === 'next') && inp.type === 'playlist') playlist.go(inp, inp.list.index + (v === 'next' ? 1 : -1), true);
          else if (v === 'play' && inp.type === 'playlist') playlist.setPlaying(inp, !inp.list.playing);
          else if ((v === 'prev' || v === 'next') && inp.type === 'slides' && inp.slides.count) slideGo(inp, inp.slides.page + (v === 'next' ? 1 : -1));
          else if (v === 'capture' && inp.type === 'replay') replayCapture(inp);
          if (vid) updateMediaButtons(inp);
          break;
        }
        case 'mute': case 'vol': {
          const ch = chanByKey(v) || audio.channels.find(c => c.id === v);
          if (!ch) break;
          if (m.cmd === 'mute') ch.muted = !ch.muted;
          else { ch.db = clamp(+m.db, -60, 10); if (ch.db <= -59.9) ch.db = -Infinity; ch.ui?.fader?.set(dbToPos(ch.db) * 100); if (ch.ui?.db) ch.ui.db.textContent = `${fmtDb(ch.db)} dB`; }
          ch === audio.masterStrip ? audio.applyMaster() : audio.applyGain(ch);
          if (m.cmd === 'mute') renderMixer();
          break;
        }
        case 'sfx': { const ch = chanByKey(v); if (ch && ch.kind === 'pad' && ch.pads[+m.i]) padFire(ch, +m.i); break; }
        case 'music': {
          const ch = chanByKey(v);
          if (!ch || ch.kind !== 'player' || !ch.src) break;
          if (m.a === 'next') ch.src.next(); else if (m.a === 'prev') ch.src.prev(); else ch.src.toggle();
          break;
        }
        case 'macro': { const mm = macros.find(x => x.id === v); if (mm) runMacro(mm); break; }
        case 'rec': toggleRecord(); break;
        case 'cap': { if (inp && inp.type === 'captions') { inp.capRun?.on ? captionStop(inp) : captionStart(inp); renderInputs(); } break; }
      }
      this.push(false);
    },
    async openDialog() {
      // ระบบเชื่อมต่อยังไม่พร้อม: ต่อใหม่ให้เองแล้วรอสักครู่ แทนที่จะให้ผู้ใช้กดซ้ำ
      if (wireless.status !== 'ready') {
        if (wireless.status !== 'connecting') wireless.restart();
        toast('กำลังเปิดระบบเชื่อมต่อรีโมต…', 'info', 2500);
        for (let t = 0; t < 40 && wireless.status !== 'ready'; t++) await new Promise(r => setTimeout(r, 250));
        if (wireless.status !== 'ready') { toast('เปิดระบบเชื่อมต่อไม่สำเร็จ — ตรวจอินเทอร์เน็ตของเครื่องนี้แล้วลองใหม่', 'error'); return; }
      }
      let role = store.get('remoteRole', 'switcher');
      if (!REMOTE_ROLES[role]) role = 'switcher';
      const r = await dialog({
        title: 'รีโมต / ทีมงาน',
        body: `
          <p class="note">ทีมงานแต่ละตำแหน่งใช้แท็บเล็ต/มือถือ/คอมของตัวเอง: เลือกตำแหน่ง → สแกน QR → ใส่<b>รหัสจับคู่</b>ด้านล่าง · เครื่องนี้เป็นเครื่องหลัก (ประมวลผล + สตรีม) เปิดค้างไว้ · รีโมตเริ่ม/หยุดไลฟ์ไม่ได้</p>
          <div class="rt-pin"><span>รหัสจับคู่</span><b class="mono" id="remote-pin">${this.pin().replace(/(\d{3})/, '$1 ')}</b></div>
          <div class="rt-roles" role="tablist">${Object.entries(REMOTE_ROLES).map(([k, v]) => `<button type="button" data-role="${k}" class="${k === role ? 'is-on' : ''}"><b>${esc(v.label)}</b><small>${esc(v.desc)}</small></button>`).join('')}</div>
          <div class="rt-qr-row"><div class="qr-box" id="remote-qr"></div>
            <label class="field"><span>ลิงก์สำหรับตำแหน่ง <b id="remote-role-name"></b></span><input id="remote-link" class="input mono" readonly></label></div>
          <h4 class="rt-h">ทีมงานที่จับคู่แล้ว</h4>
          <div id="remote-team" class="rt-team"></div>
          <div class="rt-msgs" id="remote-msgs"></div>
          <div class="rt-send"><input id="remote-msg" class="input" maxlength="200" placeholder="ส่งข้อความถึงทุกตำแหน่ง เช่น “เตรียมตัด กล้อง 2”"><button type="button" class="btn" id="remote-msg-send">ส่ง</button></div>
          <label class="field rt-talkvol"><span>ทอล์กแบ็ก: ระดับเสียงทีมที่เครื่องนี้ (ไม่เข้า Program — ใช้หูฟังกันเสียงย้อนเข้าไมค์รายการ) · พูดกลับ: กดค้างปุ่ม 🎙 ด้านบน</span><input type="range" id="remote-talkvol" min="0" max="2" step="0.05" value="${+store.get('talkVol', 1)}"></label>`,
        actions: [{ label: 'เปลี่ยนรหัสจับคู่', value: 'repin' }, { label: 'คัดลอกลิงก์', value: 'copy' }, { label: 'ปิด', primary: true }],
        onOpen: modal => {
          const showRole = k => {
            role = k; store.set('remoteRole', k);
            $$('.rt-roles button', modal).forEach(b => b.classList.toggle('is-on', b.dataset.role === k));
            $('#remote-role-name', modal).textContent = REMOTE_ROLES[k].label;
            $('#remote-link', modal).value = this.link(k);
            const t = $('#remote-qr', modal);
            t.innerHTML = '';
            if (typeof QRCode !== 'undefined') new QRCode(t, { text: this.link(k), width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
          };
          $('.rt-roles', modal).addEventListener('click', e => { const b = e.target.closest('[data-role]'); if (b) showRole(b.dataset.role); });
          showRole(role);
          this.renderList = () => {
            if (!modal.isConnected) { this.renderList = null; return; }
            const team = this.team();
            $('#remote-team', modal).innerHTML = team.length ? team.map((m, i) => `<div class="rt-mem ${this.online(m) ? 'on' : ''}" data-i="${i}">
              <span class="rt-dot"></span><b>${esc(m.name)}</b>
              <select class="select" data-f="role" aria-label="ตำแหน่ง">${Object.entries(REMOTE_ROLES).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
              <button type="button" class="btn btn-sm" data-f="unpair">ถอด</button></div>`).join('') : '<p class="note">ยังไม่มีเครื่องจับคู่</p>';
            $('#remote-msgs', modal).innerHTML = this.msgs.slice(-6).map(x => `<div><b>${esc(x.from)}</b> ${esc(x.text)}</div>`).join('');
          };
          this.renderList();
          $('#remote-team', modal).addEventListener('change', e => { const row = e.target.closest('[data-i]'); if (row && e.target.dataset.f === 'role') this.setRole(this.team()[+row.dataset.i], e.target.value); });
          $('#remote-team', modal).addEventListener('click', e => { const row = e.target.closest('[data-i]'); if (row && e.target.dataset.f === 'unpair') this.unpair(this.team()[+row.dataset.i]); });
          const sendMsg = () => { const el = $('#remote-msg', modal); this.message(el.value, 'เครื่องหลัก', 'host'); el.value = ''; };
          $('#remote-msg-send', modal).addEventListener('click', sendMsg);
          $('#remote-talkvol', modal).addEventListener('input', e => { store.set('talkVol', +e.target.value); if (this.talkMon) this.talkMon.gain.value = +e.target.value; });
          $('#remote-msg', modal).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } });
        }
      });
      this.renderList = null;
      if (r?.value === 'copy') copyText(this.link(role));
      if (r?.value === 'repin') {
        settings.remotePin = '';
        this.pin();
        toast('เปลี่ยนรหัสจับคู่แล้ว — เครื่องที่จับคู่ไว้ยังใช้ได้ (ถอดออกได้ในรายชื่อทีม)', 'success');
        this.openDialog();
      }
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
      body: `${netTabsHtml('srt')}
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
      onOpen(modal, close) {
        bindNetTabs(modal, close, 'srt');
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
      ws.send(JSON.stringify({ type: 'open', mode: c.mode, port: c.port, url: c.mode === 'rtsp' ? rtspUrl(c) : c.url, streamid: c.streamid, passphrase: c.passphrase, latency: c.latency, key: c.key, source: c.source }));
    };
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'opened') {
        inp.srtSession = msg.id;
        inp.srtLanIp = msg.lanIp || '';
      } else if (msg.type === 'status') {
        const prev = inp.srtState;
        inp.srtState = msg.state;
        inp.srtMessage = msg.message || '';
        inp.srtInfo = msg.info || null;
        if (msg.state === 'live') {
          startSrtPlayer(inp);
          if (prev !== 'live') toast(`${inp.name}: รับสัญญาณ ${netLabel(inp)} แล้ว${msg.info ? ` (${msg.info.width}×${msg.info.height}${msg.transcode ? `, แปลง ${msg.info.codec.toUpperCase()} → H.264` : ''})` : ''}`, 'success', 3500);
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
      // กล้องปฏิเสธรหัสผ่าน (เช่นเปิดหน้าใหม่แล้วไม่ได้จำรหัสไว้) — บอกวิธีแก้
      if (msg.type === 'status' && msg.state === 'error' && inp.srt.mode === 'rtsp' && /401|unauthori[sz]ed/i.test(msg.message || '')) {
        inp.srtMessage = 'กล้องไม่รับชื่อผู้ใช้/รหัสผ่าน — กดแก้ไขที่การ์ดเพื่อใส่ใหม่';
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

  /* ---- NDI / OMT: Gateway ในแอปเดสก์ท็อปค้นหาแหล่งในวง LAN แล้วรับเข้ามาเป็นแหล่งภาพ (ทางเดียวกับ SRT) ---- */
  const NET_PROTOS = { ndi: 'NDI®', omt: 'OMT' };
  // ถาม Gateway ว่ามีแหล่งอะไรบ้าง (ใช้ช่องควบคุมเดียวกับ SRT แค่ไม่ส่ง open)
  function listNetSources(proto) {
    return new Promise(resolve => {
      let ws;
      try { ws = new WebSocket(gatewayEndpoint('/srt-in')); } catch (e) { resolve({ list: [], error: e.message }); return; }
      const done = r => { clearTimeout(t); try { ws.close(); } catch (e) {} resolve(r); };
      const t = setTimeout(() => done({ list: [], error: 'Gateway ไม่ตอบ (Gateway บนเซิร์ฟเวอร์ไม่รองรับ NDI / OMT — ใช้แอปเดสก์ท็อป)' }), 8000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'sources', proto }));
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'sources') done({ list: Array.isArray(m.list) ? m.list.map(String) : [], error: m.error || '' });
        else if (m.type === 'error') done({ list: [], error: m.message || 'Gateway ปฏิเสธ' });
      };
      ws.onerror = () => done({ list: [], error: 'เชื่อมต่อ Gateway ไม่ได้' });
    });
  }
  // แท็บสลับชนิดแหล่งภาพเครือข่าย (ตอนเพิ่มใหม่): NDI / OMT · SRT · RTMP · RTSP
  const NET_TABS = [['ndi', 'NDI / OMT'], ['srt', 'SRT'], ['rtmp', 'RTMP (รับเข้า)'], ['rtsp', 'RTSP (กล้อง IP)']];
  const netTabsHtml = cur => `<nav class="dg-tabs net-tabs" role="tablist">${NET_TABS.map(([k, n]) => `<button type="button" role="tab" class="dg-tab ${k === cur ? 'is-on' : ''}" aria-selected="${k === cur}" data-net-tab="${k}">${n}</button>`).join('')}</nav>`;
  function bindNetTabs(modal, close, cur) {
    modal.classList.add('net-modal');
    $('.net-tabs', modal)?.addEventListener('click', e => {
      const k = e.target.closest('[data-net-tab]')?.dataset.netTab;
      if (!k || k === cur) return;
      close();
      setTimeout(() => ({ ndi: () => openNetVideoDialog(), srt: openSrtInputDialog, rtmp: openRtmpInputDialog, rtsp: () => openRtspDialog() })[k](), 0);
    });
  }

  async function openNetVideoDialog(proto = store.get('net-proto', 'ndi'), inp = null) {
    const gwErr = gatewayProblem();
    if (gwErr) { toast(`${gwErr} — NDI / OMT ต้องใช้ Stream Gateway ในแอปเดสก์ท็อป`, 'warn'); openSettings('stream'); return; }
    if (!NET_PROTOS[proto]) proto = 'ndi';
    const cur = inp ? inp.srt.source : '';
    const r = await dialog({
      title: inp ? `แหล่งสัญญาณ — ${inp.name}` : 'รับภาพ NDI® / OMT',
      body: `${!inp ? netTabsHtml('ndi') : ''}
        <div class="seg net-proto">${Object.entries(NET_PROTOS).map(([k, l]) => `<button type="button" data-value="${k}" class="${k === proto ? 'is-active' : ''}">${l}</button>`).join('')}</div>
        <div class="field"><span>แหล่งในวง LAN <button type="button" class="btn btn-sm net-refresh">ค้นหาใหม่</button></span>
          <div class="net-list" role="listbox"><p class="note">กำลังค้นหา…</p></div></div>
        <label class="field"><span>หรือพิมพ์ชื่อแหล่งเอง (เช่น PC-VMIX (vMix - Output 1))</span><input name="source" class="input mono" value="${esc(cur)}" maxlength="200"></label>
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="32" value="${esc(inp ? inp.name : '')}" placeholder="ตั้งจากชื่อแหล่งให้อัตโนมัติ"></label>
        <p class="note net-help"></p>`,
      actions: [{ label: 'ยกเลิก' }, { label: inp ? 'บันทึก' : 'เพิ่มแหล่งภาพ', primary: true, value: 'ok' }],
      onOpen(modal, close) {
        bindNetTabs(modal, close, 'ndi');
        const f = $('form', modal), box = $('.net-list', modal), help = $('.net-help', modal);
        modal.dataset.proto = proto;
        const HELP = {
          ndi: 'ต้องติดตั้ง NDI Tools (ฟรี) จาก ndi.video/tools ในเครื่องนี้ก่อน · เครื่องส่ง (vMix, OBS + DistroAV, กล้อง PTZ NDI) ต้องอยู่ในวง LAN เดียวกัน · ภาพจะช้ากว่าต้นทางราว 0.2–0.5 วินาที',
          omt: 'Open Media Transport ของ vMix (ฟรี โอเพนซอร์ส) — vMix 29 ขึ้นไปส่ง OMT ได้ · เครื่องส่งต้องอยู่ในวง LAN เดียวกัน · ภาพจะช้ากว่าต้นทางราว 0.2–0.5 วินาที'
        };
        let seq = 0;
        const scan = async () => {
          const my = ++seq;
          help.textContent = HELP[modal.dataset.proto];
          box.innerHTML = '<p class="note">กำลังค้นหา…</p>';
          const { list, error } = await listNetSources(modal.dataset.proto);
          if (my !== seq || !box.isConnected) return;
          if (error) { box.innerHTML = `<p class="note net-err">${esc(error)}</p>`; return; }
          // "เครื่อง (ชื่อ)" → แสดงชื่อแหล่งตัวใหญ่ และชื่อเครื่องตัวเล็ก
          box.innerHTML = list.length ? list.map(n => { const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(n) || [, '', n]; return `<button type="button" class="net-src ${n === f.source.value ? 'is-active' : ''}" data-src="${esc(n)}"><span class="net-thumb">${icon('monitor')}</span><span class="net-txt"><b>${esc(m[2])}</b><small>${esc(m[1] || 'ในวง LAN')}</small></span><em class="net-chip">${esc(NET_PROTOS[modal.dataset.proto] || '')}</em></button>`; }).join('')
            : '<p class="note">ยังไม่พบแหล่งในวง LAN — ตรวจว่าเครื่องส่งเปิดอยู่และอยู่วงเดียวกัน แล้วกด “ค้นหาใหม่”</p>';
        };
        $('.net-proto', modal).addEventListener('click', e => {
          const b = e.target.closest('button');
          if (!b) return;
          modal.dataset.proto = b.dataset.value;
          $$('.net-proto button', modal).forEach(x => x.classList.toggle('is-active', x === b));
          scan();
        });
        $('.net-refresh', modal).addEventListener('click', scan);
        box.addEventListener('click', e => {
          const b = e.target.closest('.net-src');
          if (!b) return;
          f.source.value = b.dataset.src;
          $$('.net-src', box).forEach(x => x.classList.toggle('is-active', x === b));
        });
        scan();
      }
    });
    if (r?.value !== 'ok') return;
    const source = r.form.source.value.trim();
    const chosen = r.form.source.closest('.modal')?.dataset.proto || proto;
    if (!source) { toast('ยังไม่ได้เลือกแหล่งสัญญาณ', 'warn'); return; }
    store.set('net-proto', chosen);
    // "เครื่อง (ชื่อ)" → ใช้ชื่อในวงเล็บเป็นชื่อการ์ด
    const auto = (/\(([^)]+)\)\s*$/.exec(source) || [, source])[1].slice(0, 32);
    const name = r.form.name.value.trim() || auto;
    if (inp) {
      inp.srt = { ...inp.srt, mode: chosen, source };
      inp.name = name;
      if (inp.srtCtl) { const ws = inp.srtCtl; inp.srtCtl = null; ws.close(1000, 'changed'); }
      stopSrtPlayer(inp);
      connectSrtInput(inp);
      renderInputs(); refreshSourceSelects();
    } else {
      createSrtInput({ mode: chosen, source, port: 0, latency: 500 }, name);
    }
    saveSrtInputs();
  }

  /* ---- กล้อง IP (RTSP) และรับ RTMP — ใช้ทางเดียวกับ SRT: Gateway รับสัญญาณแล้วส่งต่อเป็น MPEG-TS ให้หน้านี้เล่น ---- */
  const netLabel = inp => ({ rtsp: 'IP CAM', rtmp: 'RTMP', ndi: 'NDI', omt: 'OMT' })[inp.srt?.mode] || 'SRT';
  const rtmpKey = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  // ยี่ห้อกล้องที่พบบ่อย: path ของภาพหลัก (main stream) — {ch} = ช่องกล้อง (เครื่องบันทึก NVR)
  const RTSP_BRANDS = {
    hikvision: ['Hikvision / HiLook / EZVIZ', '/Streaming/Channels/{ch}01', 554],
    dahua: ['Dahua / IMOU / Amcrest', '/cam/realmonitor?channel={ch}&subtype=0', 554],
    tapo: ['TP-Link Tapo / VIGI', '/stream1', 554],
    reolink: ['Reolink', '/h264Preview_0{ch}_main', 554],
    uniview: ['Uniview (UNV)', '/unicast/c{ch}/s0/live', 554],
    axis: ['Axis', '/axis-media/media.amp', 554],
    onvif: ['กล้อง PTZ / ONVIF ทั่วไป', '/live/av0', 554],
    custom: ['กำหนดเอง (วาง URL ทั้งหมด)', '', 554]
  };
  function rtspUrl(c) {
    if (!c.user) return c.url;
    try {
      const u = new URL(c.url);
      u.username = encodeURIComponent(c.user);
      u.password = encodeURIComponent(c.pass || '');
      return u.toString();
    } catch (e) { return c.url; }
  }
  async function openRtspDialog(target) {
    const gwErr = gatewayProblem();
    if (gwErr) { toast(`${gwErr} — กล้อง IP ต้องใช้ Stream Gateway (แอปเดสก์ท็อปมีในตัว)`, 'warn'); openSettings('stream'); return; }
    const cur = target ? target.srt : {};
    let host = '', path = '', port = 554;
    try { if (cur.url) { const u = new URL(cur.url); host = u.hostname; port = +u.port || 554; path = u.pathname + u.search; } } catch (e) {}
    const n = inputs.filter(i => i.type === 'srt' && i.srt.mode === 'rtsp').length + 1;
    const r = await dialog({
      title: target ? `กล้อง IP — ${target.name}` : 'เพิ่มกล้อง IP (RTSP)',
      body: `${!target ? netTabsHtml('rtsp') : ''}
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="32" value="${esc(target ? target.name : `IP CAM ${n}`)}"></label>
        <label class="field"><span>ยี่ห้อกล้อง</span><select name="brand" class="select">${Object.entries(RTSP_BRANDS).map(([k, b]) => `<option value="${k}" ${k === (target ? 'custom' : 'hikvision') ? 'selected' : ''}>${b[0]}</option>`).join('')}</select></label>
        <div class="rtsp-parts">
          <div class="field-row">
            <label class="field"><span>IP ของกล้อง</span><input name="host" class="input mono" placeholder="192.168.1.64" value="${esc(host)}"></label>
            <label class="field"><span>ช่อง (NVR)</span><input name="ch" class="input mono" type="number" min="1" max="64" value="1"></label>
          </div>
        </div>
        <label class="field rtsp-url"><span>RTSP URL</span><input name="url" class="input mono" placeholder="rtsp://192.168.1.64:554/…" value="${esc(cur.url || '')}"></label>
        <div class="field-row">
          <label class="field"><span>ชื่อผู้ใช้กล้อง</span><input name="user" class="input mono" autocomplete="off" value="${esc(cur.user || 'admin')}"></label>
          <label class="field"><span>รหัสผ่านกล้อง</span><input name="pass" class="input mono" type="password" autocomplete="off" value="${esc(cur.pass || '')}"></label>
        </div>
        <p class="note">กล้องต้องอยู่ในวงเครือข่ายเดียวกับ Gateway (แอปเดสก์ท็อป = เครื่องนี้) · ใช้ภาพหลัก (main stream) ได้ถึง 4K · กล้อง H.265 แปลงเป็น H.264 ให้อัตโนมัติ (ใช้ CPU เพิ่ม — ตั้งกล้องเป็น H.264 จะเบากว่า)${settings.rememberKey ? '' : '<br>รหัสกล้องไม่ถูกจำหลังปิดหน้า (เหมือน Stream Key) — เปิด “จำ Stream Key” ในตั้งค่าถ้าต้องการให้จำ'}</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: target ? 'บันทึก' : 'เพิ่มกล้อง', primary: true, value: 'add' }],
      onOpen(modal, close) {
        bindNetTabs(modal, close, 'rtsp');
        const f = $('form', modal);
        const build = () => {
          const b = RTSP_BRANDS[f.brand.value];
          $('.rtsp-parts', modal).hidden = f.brand.value === 'custom';
          if (f.brand.value === 'custom' || !f.host.value.trim()) return;
          const ch = Math.max(1, +f.ch.value || 1);
          f.url.value = `rtsp://${f.host.value.trim()}:${b[2]}${b[1].replace('{ch}', ch)}`;
        };
        [f.brand, f.host, f.ch].forEach(el => el.addEventListener('input', build));
        f.brand.addEventListener('change', build);
        build();
      }
    });
    if (r?.value !== 'add') return;
    const f = r.form;
    let url = f.url.value.trim(), user = f.user.value.trim(), pass = f.pass.value;
    // วาง URL ที่มีชื่อผู้ใช้/รหัสมาด้วย → แยกออกมาเก็บ (ไม่ให้รหัสไปอยู่ใน URL ที่แสดง)
    try { const u = new URL(url); if (u.username) { user = decodeURIComponent(u.username); pass = decodeURIComponent(u.password); u.username = ''; u.password = ''; url = u.toString(); } } catch (e) {}
    if (!/^rtsps?:\/\/[^\s"'<>]+$/i.test(url)) { toast('URL กล้องต้องขึ้นต้นด้วย rtsp://', 'warn'); return; }
    const name = f.name.value.trim().slice(0, 32) || 'IP CAM';
    const cfg = { mode: 'rtsp', url, user: user.slice(0, 64), pass: pass.slice(0, 128), latency: 500 };
    if (target) {
      target.name = name; target.srt = cfg;
      closeSrtInput(target); target.removed = false;
      connectSrtInput(target);
      renderInputs(); saveSrtInputs();
      return;
    }
    createSrtInput(cfg, name);
    saveSrtInputs();
    toast(`กำลังเชื่อมต่อ “${name}” — ภาพจะขึ้นในไม่กี่วินาที`, 'info', 4000);
  }

  async function openRtmpInputDialog() {
    const gwErr = gatewayProblem();
    if (gwErr) { toast(`${gwErr} — การรับ RTMP ต้องใช้ Stream Gateway (แอปเดสก์ท็อปมีในตัว)`, 'warn'); openSettings('stream'); return; }
    const used = inputs.filter(i => i.type === 'srt' && i.srt.mode === 'rtmp').map(i => i.srt.port);
    const port = [1935, 1936, 1937, 1938, 1939, 1940, 1941, 1942, 1943, 1944].find(p => !used.includes(p));
    if (!port) { toast('รับ RTMP ได้สูงสุด 10 แหล่งพร้อมกัน', 'warn'); return; }
    const n = inputs.filter(i => i.type === 'srt' && i.srt.mode === 'rtmp').length + 1;
    const r = await dialog({
      title: 'รับภาพ RTMP (OBS / vMix / มือถือ / โดรน)',
      body: `${netTabsHtml('rtmp')}
        <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="32" value="RTMP ${n}"></label>
        <label class="field"><span>พอร์ต TCP บน Gateway</span><input name="port" class="input mono" type="number" min="1935" max="1944" value="${port}"></label>
        <p class="note">กดเพิ่มแล้วจะได้ที่อยู่เซิร์ฟเวอร์และ Stream key สำหรับใส่ในโปรแกรม/อุปกรณ์ที่ส่งภาพ (OBS, vMix, แอป Larix / Prism บนมือถือ, โดรน DJI, encoder)</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'เพิ่มแหล่งภาพ', primary: true, value: 'add' }]
    });
    if (r?.value !== 'add') return;
    const p = +r.form.port.value;
    if (!(p >= 1935 && p <= 1944)) { toast('พอร์ต RTMP ต้องอยู่ระหว่าง 1935–1944', 'warn'); return; }
    if (used.includes(p)) { toast(`พอร์ต ${p} ถูกใช้โดยแหล่งภาพอื่นแล้ว`, 'warn'); return; }
    const inp = createSrtInput({ mode: 'rtmp', port: p, key: rtmpKey(), latency: 500 }, r.form.name.value.trim().slice(0, 32) || 'RTMP');
    saveSrtInputs();
    // รอให้ Gateway บอกที่อยู่ในวง LAN (กรณี Gateway อยู่ในเครื่องนี้) ก่อนแสดงวิธีตั้งค่าผู้ส่ง
    for (let i = 0; i < 15 && !inp.srtSession; i++) await new Promise(res => setTimeout(res, 100));
    showRtmpSenderInfo(inp);
  }
  function rtmpSenderHost(inp) {
    let host = '';
    try { host = new URL(gatewayUrl()).hostname; } catch (e) {}
    return /^(127\.|localhost$|\[?::1)/.test(host) && inp.srtLanIp ? inp.srtLanIp : host;
  }
  function showRtmpSenderInfo(inp) {
    const c = inp.srt, host = rtmpSenderHost(inp);
    const server = `rtmp://${host}:${c.port}/live`, full = `${server}/${c.key}`;
    const copyBtn = v => `<button type="button" class="btn btn-icon rtmp-copy" data-copy="${esc(v)}" title="คัดลอก">${icon('copy')}</button>`;
    dialog({
      title: `ตั้งค่าผู้ส่งสำหรับ “${inp.name}”`,
      body: `
        <p class="modal-text">ใส่ค่าด้านล่างในโปรแกรม/อุปกรณ์ที่จะส่งภาพเข้ามา แล้วกดเริ่มสตรีม ภาพจะขึ้นในแหล่งภาพนี้อัตโนมัติ</p>
        <label class="field"><span>เซิร์ฟเวอร์ (Server / URL)</span><div class="link-row"><input class="input mono" readonly value="${esc(server)}">${copyBtn(server)}</div></label>
        <label class="field"><span>Stream key</span><div class="link-row"><input class="input mono" readonly value="${esc(c.key)}">${copyBtn(c.key)}</div></label>
        <label class="field"><span>URL เต็ม (สำหรับแอปที่มีช่องเดียว เช่น Larix)</span><div class="link-row"><input class="input mono" readonly value="${esc(full)}">${copyBtn(full)}</div></label>
        <p class="note">อุปกรณ์ที่ส่งต้องเข้าถึงเครื่อง Gateway ได้ (วง Wi-Fi/LAN เดียวกัน หรือเซิร์ฟเวอร์ที่เปิดพอร์ต <b>TCP ${c.port}</b>) · ${/^(127\.|localhost)/.test(host) ? '<b>ยังไม่รู้ที่อยู่ในวง LAN ของเครื่องนี้ — ใช้ IP ของเครื่อง (ดูในการตั้งค่าเครือข่าย) แทน 127.0.0.1</b> · ' : ''}Windows อาจถามอนุญาตไฟร์วอลล์ครั้งแรก ให้กดอนุญาต · ผู้ส่งที่ใช้ key อื่นจะถูกปฏิเสธ · แนะนำ H.264 + AAC, keyframe ทุก 2 วินาที</p>`,
      actions: [{ label: 'ปิด', primary: true }],
      onOpen(modal, close) {
        bindNetTabs(modal, close, 'rtmp');
        $$('.rtmp-copy', modal).forEach(b => b.addEventListener('click', () => {
          (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.copy) : Promise.reject())
            .then(() => toast('คัดลอกแล้ว', 'success'))
            .catch(() => toast('คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง', 'warn'));
        }));
      }
    });
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
        videoBitsPerSecond: (purpose === 'stream' ? streamKbps() : settings.videoKbps) * 1000, audioBitsPerSecond: 160000,
        // H.264 เบากว่า VP8 มากที่ความละเอียดสูง · สตรีมใช้ H.264 เสมอ (Gateway ถอดรหัสได้เร็ว)
        preferAvc: purpose === 'stream' || H >= 1080
      });
    }
    const mime = pickMime(purpose);
    if (mime === null) throw new Error('เบราว์เซอร์นี้ไม่รองรับการบันทึกวิดีโอ (MediaRecorder)');
    const opts = { videoBitsPerSecond: (purpose === 'stream' ? streamKbps() : settings.videoKbps) * 1000, audioBitsPerSecond: 160000 };
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
        const writable = await desktop.createFile(name, recFolder.name);
        recMark(name, 'folder', recFolder.name);
        return { kind: 'folder', label: recFolder.name, writable };
      } catch (e) { toast('เขียนไฟล์ลงโฟลเดอร์ไม่ได้: ' + e, 'warn'); }
    }
    if (recFolder && !recFolder.native) {
      try {
        let perm = await recFolder.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await recFolder.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          const fh = await recFolder.getFileHandle(name, { create: true });
          const writable = await fh.createWritable();
          recMark(name, 'folder', recFolder.name);
          return { kind: 'folder', label: recFolder.name, writable, handle: fh };
        }
        toast('ไม่ได้รับสิทธิ์เขียนโฟลเดอร์บันทึก — ใช้พื้นที่ชั่วคราวแล้วดาวน์โหลดแทน', 'warn');
      } catch (e) { toast('เขียนไฟล์ลงโฟลเดอร์ไม่ได้: ' + e.message, 'warn'); }
    }
    if (canUseOpfs) {
      try {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(name, { create: true });
        // เขียนตรงลงไฟล์ผ่าน worker (ข้อมูลอยู่บนดิสก์ทันที กู้ได้ถ้าเบราว์เซอร์ปิดกะทันหัน) — ไม่ได้ค่อยใช้ createWritable
        let writable;
        try { writable = await opfsDirectWritable(name); } catch (e) { writable = await fh.createWritable(); }
        recMark(name, 'opfs', 'ดิสก์');
        return { kind: 'opfs', label: 'ดิสก์', writable, handle: fh, root };
      } catch (e) {}
    }
    return { kind: 'memory', label: 'RAM', chunks: [] };
  }

  /* ---- กู้งานเมื่อแอป/เบราว์เซอร์ปิดกะทันหัน ----
     createWritable เก็บข้อมูลไว้ในไฟล์ชั่วคราวจนกว่าจะปิดไฟล์ — ถ้าเบราว์เซอร์ล่มระหว่างบันทึก ข้อมูลหายทั้งไฟล์
     จึงบันทึกลง OPFS ผ่าน worker ที่ใช้ FileSystemSyncAccessHandle (เขียนลงไฟล์จริงทันที flush ทุก ~4 วินาที)
     ไฟล์ที่กำลังบันทึกจดชื่อไว้ใน localStorage — เปิดหน้าใหม่แล้วยังมีชื่อค้าง = ปิดไม่สำเร็จ → เสนอให้บันทึกไฟล์ที่กู้ได้ */
  const OPFS_WORKER_SRC = `let h = null, n = 0;
onmessage = async e => {
  const m = e.data;
  try {
    if (m.op === 'open') { const root = await navigator.storage.getDirectory(); const fh = await root.getFileHandle(m.name, { create: true }); h = await fh.createSyncAccessHandle(); h.truncate(0); }
    else if (m.op === 'append') { h.write(new Uint8Array(m.data), { at: h.getSize() }); if (++n % 4 === 0) h.flush(); }
    else if (m.op === 'patch') h.write(new Uint8Array(m.data), { at: m.position });
    else if (m.op === 'close') { h.flush(); h.close(); h = null; }
    postMessage({ id: m.id, ok: true });
  } catch (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
};`;
  let opfsWorkerUrl = null;
  function opfsDirectWritable(name) {
    if (typeof Worker === 'undefined') return Promise.reject(new Error('no worker'));
    opfsWorkerUrl = opfsWorkerUrl || URL.createObjectURL(new Blob([OPFS_WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(opfsWorkerUrl), pend = new Map();
    let seq = 0;
    w.onmessage = e => { const p = pend.get(e.data.id); if (!p) return; pend.delete(e.data.id); e.data.ok ? p.res() : p.rej(new Error(e.data.error)); };
    w.onerror = () => { for (const p of pend.values()) p.rej(new Error('worker error')); pend.clear(); };
    const call = (op, extra = {}, transfer = []) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); w.postMessage({ id, op, ...extra }, transfer); });
    const buf = async d => d instanceof Blob ? d.arrayBuffer() : ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d;
    return call('open', { name }).then(() => ({
      direct: true,
      async write(chunk) {
        if (chunk && chunk.type === 'write') { const b = await buf(chunk.data); return call('patch', { data: b, position: chunk.position }, [b]); }
        const b = await buf(chunk);
        return call('append', { data: b }, [b]);
      },
      async close() { await call('close'); w.terminate(); }
    }), e => { w.terminate(); throw e; });
  }
  const recMarks = () => { const m = store.get('rec-open', []); return Array.isArray(m) ? m : []; };
  function recMark(name, kind, where) { store.set('rec-open', [...recMarks().filter(x => x.name !== name), { name, kind, where, at: Date.now() }]); }
  function recUnmark(name) { store.set('rec-open', recMarks().filter(x => x.name !== name)); }
  // เปิดหน้าใหม่: ไฟล์ที่ค้าง (ยังไม่ได้ปิด) จากครั้งก่อน
  async function recoverRecordings() {
    const marks = recMarks().filter(m => m && typeof m.name === 'string' && /^WebMix-[\w.-]+$/.test(m.name));
    if (!marks.length) return;
    const found = [];
    for (const m of marks) {
      if (m.kind === 'opfs' && canUseOpfs) {
        try {
          const root = await navigator.storage.getDirectory();
          const file = await (await root.getFileHandle(m.name)).getFile();
          if (file.size > 0) found.push({ ...m, file });
          else recUnmark(m.name);
        } catch (e) { recUnmark(m.name); }
      } else if (m.kind === 'folder') {
        found.push(m);
      } else recUnmark(m.name);
    }
    const local = found.filter(f => f.file), folder = found.filter(f => !f.file);
    if (folder.length) {
      const native = desktop && !desktop.mobile;
      toast(`การบันทึกครั้งก่อนหยุดกะทันหัน: ${folder.map(f => f.name).join(', ')} อยู่ในโฟลเดอร์ “${folder[0].where}”${native ? ' — เปิดดูได้ (เลื่อนเวลาอาจไม่ได้ เพราะไฟล์ไม่ได้ปิดตามปกติ)' : ' — ถ้าไม่เห็นไฟล์ ให้หาไฟล์ชื่อเดียวกันที่ลงท้าย .crswap แล้วเปลี่ยนนามสกุลเป็น .webm'}`, 'warn', 15000);
      folder.forEach(f => recUnmark(f.name));
    }
    if (!local.length) return;
    const total = local.reduce((a, f) => a + f.file.size, 0);
    toast(`กู้ไฟล์บันทึกที่ค้างจากครั้งก่อนได้ ${local.length} ไฟล์ (${fmtBytes(total)}) — เบราว์เซอร์/แอปปิดกะทันหันระหว่างบันทึก`, 'warn', 60000, {
      label: 'บันทึกไฟล์ที่กู้ได้',
      run: async () => {
        for (const f of local) {
          const type = /\.mp4$/.test(f.name) ? 'video/mp4' : 'video/webm';
          // WebM: เติมความยาว + จุดเลื่อนเวลา (ไฟล์ไม่เกิน 1.5 GB — ใหญ่กว่านั้นบันทึกตามเดิม เปิดดูได้แต่เลื่อนเวลาอาจไม่ได้)
          const out = type === 'video/webm' && f.file.size < 1.5e9 ? await seekableClip(f.file, type) : f.file;
          downloadBlob(out, f.name.replace(/(\.\w+)$/, '-recovered$1'));
          recUnmark(f.name);
          navigator.storage.getDirectory().then(root => setTimeout(() => root.removeEntry(f.name).catch(() => {}), 180000)).catch(() => {});
        }
        toast('บันทึกไฟล์ที่กู้ได้แล้ว (ชื่อลงท้าย -recovered)', 'success', 6000);
      }
    });
  }

  // ไลฟ์ค้าง: จดปลายทางที่กำลังไลฟ์ไว้ — เปิดหน้าใหม่หลังแอปปิดกะทันหัน ถามว่าจะไลฟ์ต่อไหม
  function liveMark() {
    const ids = [...streamer.dests.entries()].filter(([, st]) => st.state !== 'stopped').map(([id]) => id);
    if (ids.length && !streamer.testing) store.set('live-open', { ids, at: streamer.start || Date.now() });
  }
  async function offerLiveResume() {
    const m = store.get('live-open', null);
    store.set('live-open', null);
    if (!m || !Array.isArray(m.ids) || Date.now() - (+m.at || 0) > 6 * 3600 * 1000) return;
    const list = settings.destinations.filter(d => m.ids.includes(d.id));
    if (!list.length) return;
    const t = new Date(+m.at);
    const r = await dialog({
      title: 'ไลฟ์ครั้งก่อนหยุดกะทันหัน',
      body: `<p class="modal-text">แอปถูกปิดระหว่างไลฟ์ (เริ่มเมื่อ ${pad2(t.getHours())}:${pad2(t.getMinutes())}) ไปยัง ${list.map(d => `<b>${esc(destLabel(d))}</b>`).join(', ')}</p>
        <p class="note">ตรวจกล้องและเสียงให้พร้อมก่อน แล้วกด “ไลฟ์ต่อ” — ปลายทางเดิมจะเริ่มส่งภาพอีกครั้ง (YouTube / Facebook ส่วนใหญ่ต่อเข้าไลฟ์เดิมได้ถ้าไม่เกินไม่กี่นาที)</p>`,
      actions: [{ label: 'ไม่ต้อง' }, { label: 'ไลฟ์ต่อ', primary: true, value: 'go' }]
    });
    if (r?.value === 'go') startDestinations(list);
  }

  // ลบไฟล์ชั่วคราวที่ค้างจากครั้งก่อน (เกิน 1 วัน) ใน OPFS
  async function cleanupOpfs() {
    if (!canUseOpfs) return;
    try {
      const root = await navigator.storage.getDirectory();
      for await (const [name, h] of root.entries()) {
        if (h.kind !== 'file' || !/^WebMix-/.test(name)) continue;
        const f = await h.getFile();
        const keep = recMarks().some(m => m.name === name) ? 7 * 86400000 : 86400000;
        if (Date.now() - f.lastModified > keep) await root.removeEntry(name);
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
    const when = stamp();
    const name = `WebMix-${when}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
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
      rec.auto = false;
      stopIso();
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
          recUnmark(name);
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
    if (settings.isoRec) startIso(when);
    setRecButton();
    updateOnAir();
  }

  /* ---- ไฟล์บันทึกแยกจากการบันทึก Program (ใช้กับ ISO) — เขียนลงที่เดียวกัน (โฟลเดอร์/ดิสก์/RAM) ---- */
  async function openRecordFile(name, type) {
    const sink = await openRecordingSink(name);
    const fix = !type.includes('mp4') && window.WebmSeek ? new WebmSeek.WebmSeekFix() : null;
    let written = 0, bytes = 0, failed = false, chain = Promise.resolve();
    const put = data => {
      written += data.byteLength;
      if (sink.kind === 'memory') { sink.chunks.push(data); return Promise.resolve(); }
      return sink.writable.write(data);
    };
    return {
      sink,
      get bytes() { return bytes; },
      push(blob) {
        bytes += blob.size;
        chain = chain.then(async () => {
          if (!fix) return put(blob);
          for (const part of fix.push(new Uint8Array(await blob.arrayBuffer()))) await put(part);
        }).catch(() => { failed = true; });
      },
      async finish() {
        await chain;
        const done = fix && !failed ? fix.finish(written) : null;
        if (done) {
          if (done.tail.length) await put(done.tail);
          if (sink.kind !== 'memory') for (const pt of done.patches) await sink.writable.write({ type: 'write', position: pt.position, data: pt.data });
        }
        if (sink.kind === 'memory') { downloadBlob(new Blob(sink.chunks, { type }), name); sink.chunks = []; }
        else {
          await sink.writable.close();
          recUnmark(name);
          if (sink.kind !== 'folder') {
            downloadBlob(await sink.handle.getFile(), name);
            setTimeout(() => sink.root.removeEntry(name).catch(() => {}), 180000);
          }
        }
        return { failed, bytes };
      }
    };
  }

  /* ---- ISO: บันทึกแยกทุกกล้อง (กล้อง / หน้าจอ / มือถือ / แขก) เป็นไฟล์ละแหล่งภาพ สำหรับตัดต่อทีหลัง ----
     เริ่ม-หยุดพร้อมการบันทึก Program และใช้ชื่อเวลาเดียวกัน · แหล่งภาพที่เพิ่มระหว่างบันทึกจะไม่ถูกบันทึกแยก */
  const iso = { list: [] };
  const isoSources = () => inputs.filter(i => i.stream && i.status === 'live' && i.stream.getVideoTracks().some(t => t.readyState === 'live'));
  async function startIso(when) {
    if (window.WebMix.wcrec && window.WebMix.wcrec.preferred()) { toast('เครื่องนี้บันทึกแยกทุกกล้องไม่ได้ (ใช้ตัวบันทึก WebCodecs) — บันทึกเฉพาะ Program', 'warn', 6000); return; }
    const mime = pickMime('record');
    const list = isoSources();
    if (!list.length) return;
    const safe = n => String(n).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'CAM';
    for (const [k, inp] of list.entries()) {
      try {
        const r = new MediaRecorder(inp.stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: settings.videoKbps * 1000, audioBitsPerSecond: 160000 });
        const type = r.mimeType || 'video/webm';
        const name = `WebMix-${when}-ISO${k + 1}-${safe(inp.name)}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
        const file = await openRecordFile(name, type);
        const item = { inp, r, file, name, done: null };
        r.ondataavailable = e => { if (e.data.size) file.push(e.data); };
        item.done = new Promise(res => { r.onstop = () => file.finish().then(res, () => res({ failed: true, bytes: file.bytes })); });
        if (!rec.active) { file.finish().catch(() => {}); return; }
        r.start(1000);
        iso.list.push(item);
      } catch (e) {
        toast(`บันทึกแยก “${inp.name}” ไม่ได้: ${e.message}`, 'warn', 6000);
      }
    }
    if (iso.list.length) toast(`บันทึกแยก ${iso.list.length} กล้อง (ISO) พร้อม Program`, 'info', 4000);
  }
  async function stopIso() {
    const list = iso.list.splice(0);
    if (!list.length) return;
    for (const it of list) { try { if (it.r.state !== 'inactive') it.r.stop(); } catch (e) {} }
    const res = await Promise.all(list.map(it => it.done));
    const bytes = res.reduce((a, r) => a + (r.bytes || 0), 0), bad = res.filter(r => r.failed).length;
    iso.last = { files: list.map(it => it.name), bytes };
    toast(bad ? `บันทึกแยกกล้องเสร็จ แต่มี ${bad} ไฟล์ที่เขียนไม่สำเร็จ` : `บันทึกแยก ${list.length} กล้องแล้ว (${fmtBytes(bytes)})`, bad ? 'warn' : 'success', 6000);
  }

  /* ---- บันทึกสำรองอัตโนมัติ: เริ่มไลฟ์แล้วเริ่มบันทึกให้ (ถ้ายังไม่ได้บันทึก) หยุดไลฟ์ครบทุกช่องแล้วหยุดให้ ---- */
  async function autoRecStart() {
    if (!settings.autoRec || rec.active || rec.starting || streamer.testing) return;
    await toggleRecord();
    if (rec.active) { rec.auto = true; toast('บันทึกสำรองอัตโนมัติระหว่างไลฟ์', 'info', 4000); }
  }
  function autoRecStop() {
    if (rec.active && rec.auto && rec.recorder) rec.recorder.stop();
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

  const destPayload = d => ({ id: d.id, name: destLabel(d), url: destUrl(d), ...(settings.orient === 'v' ? {} : d.orient === 'vcrop' ? { vertical: 'crop' } : d.orient === 'vfit' ? { vertical: 'fit' } : {}) });
  const isRunning = id => { const st = streamer.dests.get(id); return !!st && st.state !== 'stopped'; };

  // เริ่มเฉพาะปลายทางที่เลือก — ถ้ายังไม่ได้เชื่อมต่อ Gateway จะเปิดการเชื่อมต่อให้อัตโนมัติ
  function startDestinations(list) {
    list = list.filter(d => !isRunning(d.id));
    if (!list.length) return;
    for (const d of list) {
      const max = PLATFORMS[d.platform]?.maxHeight;
      if (max && Math.min(W, H) > max) toast(`${destLabel(d)} รับภาพสูงสุด ${max}p — สตรีม ${formatTag(Math.min(W, H), settings.fps)} อาจถูกปฏิเสธหรือถูกย่อภาพ`, 'warn', 7000);
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
      autoRecStart();
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
    store.set('live-open', null);
    abrReset(true);
    streamer.abrSwitch = false;
    Object.assign(streamer, { active: false, state: 'idle', ws: null, recorder: null, kbps: 0, queue: [], encoder: null, reconnecting: false, attempt: 0 });
    streamer.dests.clear();
    setStreamButton();
    refreshLiveDialog();
    updateOnAir();
    output.reset();
    autoRecStop();
    // ทดสอบปลายทาง: ไม่แสดงสรุป/แจ้งเตือน — ผลไปแสดงที่ปุ่มทดสอบแทน
    if (streamer.testing) { liveStats.end(); streamer.lastError = byUser ? '' : reason || ''; return; }
    if (wasLive && liveStats.session) { const sess = liveStats.end(); if (isPhoneUI()) { closeLiveDialog?.(); openSummary(sess, byUser ? '' : reason); } else if (sess.duration >= 60000) { closeLiveDialog?.(); openDeskSummary(sess, byUser ? '' : reason); } }
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
    if (streamer.attempt === 1 && !streamer.abrSwitch) toast('การเชื่อมต่อ Stream Gateway หลุด — กำลังเชื่อมต่อใหม่อัตโนมัติ', 'warn', 6000);
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

  /* ---- ปรับบิตเรตอัตโนมัติ (Adaptive bitrate) ----
     ดูข้อมูลที่ค้างส่ง 2 ทาง: แอป → Gateway (ws.bufferedAmount) และ Gateway → ปลายทาง (lag ที่ Gateway รายงาน)
     ค้างเกิน 2.5 วินาที 2 รอบติด (หรือเกิน 6 วินาที) → ลดบิตเรต 30% (ต่ำสุด 35% ของค่าที่ตั้ง / 800 kbps)
     เข้ารหัสด้วยชิปของเครื่อง (WebCodecs) → เปลี่ยนได้ทันทีไม่สะดุด และเพิ่มกลับทีละ 15% เมื่อเน็ตดีต่อเนื่อง 30 วินาที
     ทางอื่น → เชื่อมต่อ Gateway ใหม่ที่บิตเรตใหม่ (ภาพสะดุดสั้น ๆ) ไม่เพิ่มกลับเอง แต่เสนอปุ่ม "คืนคุณภาพเต็ม" เมื่อเน็ตดี 1 นาที */
  const abr = { kbps: 0, high: 0, lastChange: 0, clearSince: 0, offered: false, log: [] };
  const streamKbps = () => abr.kbps || settings.videoKbps;
  function abrReset(all) {
    abr.high = 0; abr.clearSince = 0;
    if (all) { abr.kbps = 0; abr.lastChange = 0; abr.offered = false; abr.log = []; }
  }
  // ตัดสินใจจากตัวอย่างหนึ่งรอบ — คืน { kbps, dir } หรือ null
  function abrDecide({ upLag, destLag }, now, seamless) {
    const target = settings.videoKbps, cur = streamKbps(), lag = Math.max(upLag, destLag);
    const floor = Math.min(target, Math.max(800, Math.round(target * 0.35 / 100) * 100));
    abr.high = lag > 2500 ? abr.high + 1 : 0;
    if ((abr.high >= 2 || lag > 6000) && cur > floor && now - abr.lastChange > (seamless ? 8000 : 30000)) {
      return { kbps: Math.max(floor, Math.round(cur * 0.7 / 100) * 100), dir: 'down' };
    }
    if (lag < 400) { if (!abr.clearSince) abr.clearSince = now; } else abr.clearSince = 0;
    if (cur < target && abr.clearSince && now - abr.lastChange > 30000) {
      if (seamless && now - abr.clearSince >= 30000) return { kbps: Math.min(target, Math.round(cur * 1.15 / 100) * 100), dir: 'up' };
      if (!seamless && now - abr.clearSince >= 60000 && !abr.offered) return { kbps: target, dir: 'offer' };
    }
    return null;
  }
  function abrApply(kbps, dir) {
    const ws = streamer.ws, r = streamer.recorder;
    if (!ws || streamer.state !== 'live') return;
    abr.kbps = kbps >= settings.videoKbps ? 0 : kbps;
    abr.lastChange = Date.now();
    abrReset();
    abr.log.push({ at: Date.now(), kbps, dir, how: streamer.videoCopy && r && r.setBitrate ? 'live' : 'reconnect' });
    if (streamer.videoCopy && r && r.setBitrate && r.setBitrate(kbps * 1000)) {
      if (dir === 'down') toast(`เน็ตส่งไม่ทัน — ลดบิตเรตเป็น ${kbps} kbps ชั่วคราว`, 'warn', 5000);
      updateStatus();
      return;
    }
    // ตัวเข้ารหัสในเบราว์เซอร์/ใน Gateway เปลี่ยนบิตเรตกลางทางไม่ได้ → เชื่อมต่อใหม่ด้วยค่าใหม่ (ปลายทางเริ่มต่อเองอัตโนมัติ)
    toast(dir === 'down' ? `เน็ตส่งไม่ทัน — ลดบิตเรตเป็น ${kbps} kbps (ภาพจะสะดุดสั้น ๆ ระหว่างเปลี่ยน)` : `กลับไปคุณภาพเต็ม ${kbps} kbps`, dir === 'down' ? 'warn' : 'info', 6000);
    streamer.abrSwitch = true;
    handleDisconnect(ws, 4003, 'ปรับบิตเรต');
    try { ws.close(); } catch (e) {}
  }
  function abrTick() {
    const ws = streamer.ws;
    if (!settings.abr || streamer.state !== 'live' || streamer.testing || !ws || ws.readyState !== WebSocket.OPEN) { abrReset(); return; }
    const cur = streamKbps() + 160;
    const upLag = ws.bufferedAmount * 8 / cur;
    const destLag = Math.max(0, ...[...streamer.dests.values()].filter(d => d.state === 'live').map(d => d.lag || 0));
    const seamless = !!(streamer.videoCopy && streamer.recorder && streamer.recorder.setBitrate);
    abr.last = { upLag: Math.round(upLag), destLag };
    const d = abrDecide({ upLag, destLag }, Date.now(), seamless);
    if (!d) return;
    if (d.dir === 'offer') {
      abr.offered = true;
      toast(`เน็ตกลับมาดีแล้ว — ตอนนี้ส่งที่ ${streamKbps()} kbps`, 'info', 15000, { label: 'คืนคุณภาพเต็ม', run: () => abrApply(settings.videoKbps, 'up') });
      return;
    }
    abrApply(d.kbps, d.dir);
  }
  setInterval(abrTick, 2000);

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
          videoBitsPerSecond: streamKbps() * 1000, audioBitsPerSecond: 160000,
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
    const ws = new WebSocket(`${gw}${sep}fps=${settings.fps}&vb=${streamKbps()}&res=${H}${vcopy ? '&vcopy=1' : ''}`);
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
      else if (!streamer.abrSwitch) toast('เชื่อมต่อ Stream Gateway ใหม่สำเร็จ — กำลังเริ่มปลายทางอีกครั้ง', 'success', 4000);
      streamer.abrSwitch = false;
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
      streamer.dests.set(st.id, { state: st.state, message: st.message || '', kbps: st.kbps || 0, lag: +st.lag || 0 });
      if (st.state === 'live' && (!prev || prev.state !== 'live')) liveMark();
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
    // แผงไลฟ์ด้านขวา: สถานะ · ตัวเลขสุขภาพสตรีม · ปลายทาง (เริ่ม/หยุดแยก) · ปรับบิตเรตอัตโนมัติ · คุณภาพ
    dialog({
      title: 'ไลฟ์',
      body: `
        <div class="lv-head"><span class="lv-pill"></span><span class="lv-count"></span></div>
        <div class="lv-stats"></div>
        <div class="lv-sec"><b>ปลายทาง</b><small class="modal-text">แต่ละปลายทางเริ่ม/หยุดแยกกันได้ · ช่องที่หลุดจะเชื่อมต่อใหม่เอง</small></div>
        <div class="dest-live"></div>
        <button type="button" class="btn btn-sm lv-add" data-lv="edit">${icon('plus')}เพิ่ม / แก้ไขปลายทาง</button>
        <label class="lv-row lv-abr"><span><b>ปรับบิตเรตอัตโนมัติ</b><small>เน็ตตก → ลดบิตเรตเอง ไม่ให้ภาพค้าง</small></span><input type="checkbox" data-lv-abr ${settings.abr ? 'checked' : ''}><i aria-hidden="true"></i></label>
        <div class="lv-row"><span><b>คุณภาพ</b><small class="lv-q"></small></span><button type="button" class="btn btn-sm" data-lv="quality">เปลี่ยน</button></div>`,
      actions: [{ label: 'ปิด' }],
      onOpen(modal, close) {
        modal.classList.add('lv-drawer');
        modal.parentElement.classList.add('drawer-back');
        liveDialog = modal;
        closeLiveDialog = close;
        modal.addEventListener('change', e => { if (e.target.matches('[data-lv-abr]')) { settings.abr = e.target.checked; saveSettings(); } });
        modal.addEventListener('click', e => {
          const a = e.target.closest('[data-lv]')?.dataset.lv;
          if (a === 'edit') { close(); openSettings('stream'); }
          else if (a === 'quality') { close(); openSettings('output'); }
        });
        const t = setInterval(() => { if (!modal.isConnected) clearInterval(t); else refreshLiveDialog(); }, 1000);
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
            // ยังไม่ได้ไลฟ์ → หน้าเตรียมก่อนไลฟ์ (ตรวจความพร้อม + นับถอยหลัง) · ไลฟ์อยู่แล้ว → เริ่มช่องที่เหลือทันที
            if (!streamer.ws && !streamer.reconnecting && !gatewayProblem() && !list.some(d => destProblem(d))) { close(); openDeskPreflight(); }
            else startDestinations(list);
          } else if (e.target.closest('.dest-stop-all')) {
            if (await confirmStopAll()) stopAllStreams();
          }
        });
        refreshLiveDialog();
      }
    }).then(() => {
      liveDialog = null;
      closeLiveDialog = null;
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
    // หัวแผง + ตัวเลขสุขภาพสตรีม
    const live = !!(streamer.ws || streamer.reconnecting), { live: nLive } = destCounts(), s = liveStats.session;
    const pill = $('.lv-pill', liveDialog);
    if (pill) {
      pill.className = `lv-pill ${streamer.reconnecting ? 'is-warn' : live ? 'is-live' : ''}`;
      pill.innerHTML = `${streamer.reconnecting ? 'กำลังต่อใหม่' : live ? 'LIVE' : 'พร้อม'} <b>${live && streamer.start ? fmtDuration(Date.now() - streamer.start) : '00:00:00'}</b>`;
      $('.lv-count', liveDialog).textContent = `ออกอากาศ ${nLive} จาก ${settings.destinations.length} ปลายทาง`;
      const fpsNow = streamer.encoder?.fps || (live ? fps : 0), spd = streamer.encoder?.speed;
      const tile = (k, v, u, cls = '', extra = '') => `<div class="lv-tile ${cls}"><small>${k}</small><b>${v}<em>${u}</em></b>${extra}</div>`;
      $('.lv-stats', liveDialog).innerHTML =
        tile('BITRATE', live ? (streamer.kbps / 1000).toFixed(1) : '—', live ? 'Mbps' : '', 'lv-wide', `<svg viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true"><path d="${s ? sparkPath(s.kbps, 200, 34) : ''}"/></svg>`)
        + tile('FPS', fpsNow ? fpsNow.toFixed(1) : '—', '')
        + tile('เข้ารหัส', spd ? spd.toFixed(2) : '—', spd ? 'x' : '', spd && spd < 0.9 ? 'is-bad' : '')
        + tile('หลุด / ต่อใหม่', s ? s.reconnects : 0, 'ครั้ง');
      const q = $('.lv-q', liveDialog);
      if (q) q.textContent = `${formatTag(Math.min(W, H), settings.fps)} · H.264 · ${settings.videoKbps} kbps${W < H ? ' · 9:16' : ''}`;
    }
    box.innerHTML = settings.destinations.map(d => {
      const st = streamer.dests.get(d.id);
      const state = st ? st.state : 'off';
      const running = !!st && state !== 'stopped';
      const pf = PLATFORMS[d.platform] || {};
      return `
        <div class="dest-live-row is-${state}">
          <span class="dest-dot"></span><span class="lv-abbr lv-${esc(d.platform)}" aria-hidden="true">${esc((pf.label || '?').slice(0, 2).toUpperCase())}</span>
          <div class="dest-info"><b>${esc(destLabel(d))}</b><small>${esc((state === 'error' || (isNet(d) && state === 'live')) && st.message ? st.message : destMasked(d))}</small></div>
          <span class="dest-state">${text[state]}${state === 'live' && st.kbps && !isNet(d) ? ` · ${st.kbps} kbps` : ''}</span>
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
    if (live && !onAirSince) { onAirSince = Date.now(); lufs.reset(); }
    if (!live) onAirSince = null;
    const lamp = $('#tally-lamp');
    lamp.classList.toggle('is-live', live);
    lamp.textContent = live ? 'ON AIR' : 'OFF AIR';
    keepScreenOn(live && settings.keepAwake !== false);
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

  // หน้าต่าง Program Output: ภาพเต็มจอไม่มีกรอบ · แถบควบคุมลอย (ON AIR · เวลา · จอ · เลือกจอ · ซ่อน · ออกจากเต็มจอ) หายเองใน 3 วินาที
  function openOutputWindow() {
    if (desktop && desktop.mobile) { toast('แอป Android เปิดหน้าต่างแยกไม่ได้ — ต่อจอผ่าน HDMI หรือ Cast แล้วกดปุ่มเต็มจอบนจอ Program แทน', 'warn', 6000); return; }
    const win = window.open('about:blank', 'webmix-program-output', 'width=1280,height=720');
    if (!win) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต Pop-up สำหรับเว็บนี้ก่อน', 'warn'); return; }
    win.document.open();
    win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>WebMix — Program Output</title>
      <style>html,body{margin:0;height:100%;background:#000;overflow:hidden;font:13px system-ui,sans-serif;color:#e8ecf1}body.idle{cursor:none}
      video{width:100%;height:100%;object-fit:contain;display:block}
      #bar{position:fixed;left:50%;top:18px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:7px 8px 7px 14px;border-radius:999px;background:rgba(18,22,28,.92);border:1px solid #2a313d;box-shadow:0 10px 30px rgba(0,0,0,.5);transition:opacity .4s;white-space:nowrap}
      body.idle #bar,body.idle #hint,body.hide #bar{opacity:0;pointer-events:none}
      #st{padding:2px 8px;border-radius:5px;background:#2a313d;font-weight:800;letter-spacing:1px;font-size:11px}#st.on{background:#c8323a}
      #tm{font:600 13px ui-monospace,monospace}#scr{color:#9aa4b2}
      button{height:30px;padding:0 12px;border-radius:999px;border:1px solid #3a4250;background:#171b22;color:#e8ecf1;font:inherit;font-size:12px;cursor:pointer}button.p{border-color:#4f86f0;background:#2f6fe8;color:#fff}
      #menu{position:fixed;left:50%;top:62px;transform:translateX(-50%);display:none;flex-direction:column;gap:4px;padding:6px;border-radius:12px;background:#12161c;border:1px solid #2a313d}#menu.open{display:flex}#menu button{border-radius:8px;text-align:left}
      #hint{position:fixed;right:24px;bottom:24px;padding:6px 10px;border-radius:8px;background:rgba(18,22,28,.85);color:#9aa4b2;font-size:12px;transition:opacity .4s}</style></head>
      <body><video autoplay muted playsinline></video>
      <div id="bar" role="toolbar" aria-label="ควบคุม Program Output"><span id="st">OFF AIR</span><span id="tm">00:00:00</span><span id="scr"></span>
        <button id="pick" type="button">เลือกจอ</button><button id="hide" type="button">ซ่อนแถบนี้</button><button id="fs" type="button" class="p">เต็มจอ</button></div>
      <div id="menu" role="menu"></div><div id="hint">แถบควบคุมจะหายไปเองใน 3 วินาที · ขยับเมาส์เพื่อเรียกกลับ · ดับเบิลคลิก = เต็มจอ</div></body></html>`);
    win.document.close();
    const d = win.document, $w = id => d.getElementById(id);
    const v = d.querySelector('video');
    v.srcObject = new MediaStream(pgmCanvas.captureStream(settings.fps).getVideoTracks());
    v.play().catch(() => {});
    let idleT = 0;
    const wake = () => { d.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => d.body.classList.add('idle'), 3000); };
    d.addEventListener('mousemove', wake); d.addEventListener('keydown', wake); wake();
    const fs = () => d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen().catch(() => {});
    d.addEventListener('dblclick', e => { if (!e.target.closest('#bar,#menu')) fs(); });
    $w('fs').onclick = fs;
    $w('hide').onclick = () => { d.body.classList.add('hide'); $w('hint').textContent = 'ขยับเมาส์ไม่เรียกแถบกลับแล้ว — กด H เพื่อแสดงแถบอีกครั้ง'; };
    d.addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') d.body.classList.toggle('hide'); });
    // เลือกจอ: Window Management API (Chrome / Edge) — เต็มจอบนจอที่เลือกได้เลย
    $w('pick').onclick = async () => {
      const menu = $w('menu');
      if (menu.classList.toggle('open') === false) return;
      if (!('getScreenDetails' in win)) { menu.innerHTML = '<button type="button" disabled>เบราว์เซอร์นี้เลือกจอไม่ได้ — ลากหน้าต่างไปจอที่ต้องการแล้วกดเต็มจอ</button>'; return; }
      try {
        const sd = await win.getScreenDetails();
        menu.innerHTML = sd.screens.map((sc, i) => `<button type="button" data-i="${i}">จอ ${i + 1}${sc.isPrimary ? ' (หลัก)' : ''} · ${sc.width}×${sc.height}${sc.label ? ' · ' + sc.label.replace(/[<>&"]/g, '') : ''}</button>`).join('');
        menu.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; menu.classList.remove('open'); d.documentElement.requestFullscreen({ screen: sd.screens[+b.dataset.i] }).catch(() => {}); };
      } catch (e) { menu.innerHTML = '<button type="button" disabled>ไม่ได้รับอนุญาตให้ดูรายชื่อจอ</button>'; }
    };
    // สถานะจากหน้าหลัก ทุกครึ่งวินาที
    const tick = () => {
      if (win.closed) return;
      const live = !!onAirSince;
      $w('st').textContent = live ? 'ON AIR' : 'OFF AIR'; $w('st').className = live ? 'on' : '';
      $w('tm').textContent = $('#onair-timer').textContent;
      const sc = win.screen;
      $w('scr').textContent = `${sc.width}×${sc.height}${d.fullscreenElement ? ' · เต็มจอ' : ''}`;
      $w('fs').textContent = d.fullscreenElement ? 'ออกจากเต็มจอ (Esc)' : 'เต็มจอ';
      setTimeout(tick, 500);
    };
    tick();
    return win;
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
      if (!this.session) this.session = { start: Date.now(), bytes: 0, lastSent: 0, kbps: [], fps: [], reconnects: 0, wasReconnecting: false, dests: {}, all: [], step: 1, acc: [], events: [], abr0: abr.log.length };
      const s = this.session;
      const d = streamer.sent - s.lastSent;
      s.bytes += d >= 0 ? d : streamer.sent;
      s.lastSent = streamer.sent;
      s.kbps.push(streamer.state === 'live' ? streamer.kbps : 0);
      if (s.kbps.length > 120) s.kbps.shift();
      // บิตเรตตลอดรายการ (สรุปหลังไลฟ์): เก็บไม่เกิน ~900 จุด — ยาวกว่านั้นรวมทีละ 2 จุด
      s.acc.push(s.kbps[s.kbps.length - 1]);
      if (s.acc.length >= s.step) { s.all.push(s.acc.reduce((a, b) => a + b, 0) / s.acc.length); s.acc = []; }
      if (s.all.length > 900) { s.all = s.all.reduce((o, v, i, a) => (i % 2 ? o : o.concat((v + (a[i + 1] ?? v)) / 2)), []); s.step *= 2; }
      const f = streamer.encoder?.fps || (streamer.state === 'live' ? fps : 0);
      if (f) s.fps.push(f);
      if (streamer.reconnecting && !s.wasReconnecting) { s.reconnects++; s.events.push({ at: Date.now(), text: 'เน็ตหลุด — ต่อใหม่อัตโนมัติ' }); }
      s.wasReconnecting = !!streamer.reconnecting;
      for (const [id, st] of streamer.dests) {
        const x = s.dests[id] || (s.dests[id] = { label: destLabel(settings.destinations.find(z => z.id === id)) || id, live: 0, down: 0, drops: 0, last: '' });
        if (st.state === 'live') x.live++; else x.down++;
        if (x.last === 'live' && st.state !== 'live') { x.drops++; s.events.push({ at: Date.now(), text: `${x.label} ต่อใหม่` }); }
        x.last = st.state;
      }
    },
    end() {
      const s = this.session;
      this.session = null;
      if (!s) return null;
      s.duration = Date.now() - s.start;
      s.end = Date.now();
      for (const a of abr.log.slice(s.abr0)) if (a.dir === 'down') s.events.push({ at: a.at, text: `ลดบิตเรตอัตโนมัติเหลือ ${(a.kbps / 1000).toFixed(1)} Mbps` });
      s.events.sort((a, b) => a.at - b.at);
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
    if (!isPhoneUI()) return openDeskPreflight();
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
    add(settings.autoRec || rec.active ? 'ok' : 'warn', 'บันทึกสำรอง', rec.active ? 'กำลังบันทึกอยู่' : settings.autoRec ? 'เริ่มบันทึกอัตโนมัติพร้อมไลฟ์' : 'ปิดอยู่ — เปิดได้ที่ ตั้งค่า → เอาต์พุต (เน็ตหลุดก็ยังมีไฟล์)');
    if (desktop && desktop.mobile) add('ok', 'ไลฟ์เบื้องหลัง', 'ปิดจอหรือสลับแอประหว่างไลฟ์ได้ — ดูสถานะที่แจ้งเตือน');
    const blocked = items.some(i => i.state === 'error');
    const mark = { ok: '✓', warn: '!', error: '✕' };
    const r = await dialog({
      title: 'พร้อมไลฟ์หรือยัง',
      body: `<p class="pf-sub">${formatTag(Math.min(W, H), settings.fps)} · ${settings.videoKbps} kbps</p>
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

  // หน้าเตรียมก่อนไลฟ์ (เดสก์ท็อป/แท็บเล็ต): รายการตรวจอัตโนมัติ (อัปเดตทุกวินาที) · ภาพ Program ตอนเริ่ม · นับถอยหลัง · เริ่มไลฟ์ / ทดสอบส่ง
  let upMbps = 0;
  async function preflightChecks() {
    const out = [];
    const add = (state, name, detail, fix) => out.push({ state, name, detail, fix });
    const list = settings.destinations.filter(d => d.enabled);
    const srcs = inputs.filter(i => !['color', 'bars', 'clock', 'black', 'title', 'timer', 'score', 'ticker'].includes(i.type));
    const dead = srcs.filter(i => i.status !== 'live');
    add(dead.length ? 'warn' : 'ok', 'แหล่งภาพทุกตัวมีสัญญาณ', dead.length ? `“${dead.map(i => i.name).slice(0, 3).join('”, “')}” ยังไม่มีสัญญาณ` : `${srcs.length || inputs.length} แหล่ง${inputs.some(i => i.type === 'wireless') ? ` · กล้องมือถือ ${inputs.filter(i => i.type === 'wireless').length} เครื่อง` : ''}`);
    const mics = audio.channels.filter(c => !c.muted && c.kind !== 'player' && c.kind !== 'pad');
    const quiet = mics.filter(c => !(c.level > -55));
    add(!mics.length || quiet.length ? 'warn' : 'ok', 'ไมค์มีเสียง', !mics.length ? 'ยังไม่มีไมค์ — กด “เพิ่มเสียง” ในแผงเสียง'
      : quiet.length ? `${quiet.map(c => c.name).slice(0, 2).join(', ')} เงียบ — ตรวจสายหรือปุ่ม Mute` : mics.slice(0, 2).map(c => `${c.name} ${Math.round(c.level)} dB`).join(' · '));
    const gwErr = gatewayProblem(), bad = list.find(d => destProblem(d));
    add(!list.length || bad || gwErr ? 'error' : 'ok', 'ปลายทางพร้อม', !list.length ? 'ยังไม่ได้ติ๊กปลายทาง — เพิ่ม / ติ๊กปลายทางในตั้งค่า' : bad ? `${destLabel(bad)}: ${destProblem(bad)}` : gwErr || `${list.map(destLabel).join(' · ')} — ข้อมูลครบ`, () => openSettings('stream'));
    const need = settings.videoKbps * Math.max(1, list.length) / 1000, have = upMbps || (!usingLocalGateway() && navigator.connection?.downlink) || 0;
    add(!navigator.onLine ? 'error' : have && have < need * 1.5 ? 'warn' : 'ok', 'อัปโหลดพอ', !navigator.onLine ? 'ไม่ได้เชื่อมต่ออินเทอร์เน็ต'
      : have ? `วัดได้ ${have.toFixed(1)} Mbps · ต้องการ ${need.toFixed(1)} Mbps (${Math.max(1, list.length)} ปลายทาง)${have < need * 1.5 ? ' — ลดความละเอียดหรือปลายทาง' : ''}` : `ต้องการ ${need.toFixed(1)} Mbps · กดเพื่อวัดความเร็ว`, 'measure');
    try {
      const est = await navigator.storage?.estimate?.();
      if (est && est.quota) {
        const left = est.quota - est.usage, hours = left * 8 / (settings.videoKbps * 1000 + 160000) / 3600;
        add(hours < 0.5 ? 'warn' : 'ok', 'พื้นที่บันทึก', `เหลือ ${fmtBytes(left)} · พอประมาณ ${hours >= 10 ? '10+' : hours.toFixed(1)} ชม.`);
      }
    } catch (e) {}
    const lu = isFinite(lufs.i) ? lufs.i : lufs.s;
    add(!isFinite(lu) ? 'warn' : Math.abs(lu - lufs.target) > 4 ? 'warn' : 'ok', 'ความดังเสียง', !isFinite(lu) ? 'ยังไม่มีเสียงให้วัด — ลองพูดใส่ไมค์' : `วัดได้ ${lu.toFixed(1)} LUFS · เป้า ${lufs.target}${lu < lufs.target - 4 ? ' — เบาเกินไป' : lu > lufs.target + 4 ? ' — ดังเกินไป' : ''}`);
    const team = remoteCtl.team();
    if (team.length) {
      const on = team.filter(m => remoteCtl.online(m));
      add(on.length === team.length ? 'ok' : 'warn', 'ทีมงานพร้อม', `${on.length} จาก ${team.length} ออนไลน์${on.length < team.length ? ' · ' + team.filter(m => !remoteCtl.online(m)).map(m => m.name).slice(0, 2).join(', ') + ' ยังไม่ออนไลน์' : ''}`, () => remoteCtl.openDialog());
    }
    const lowBat = battery && !battery.charging && battery.level < 0.3, slow = fps && fps < (+settings.fps || 30) * 0.8;
    add(lowBat || slow ? 'warn' : 'ok', 'เครื่องนี้', [fps ? `ภาพ ${Math.round(fps)} fps` : '', battery ? (battery.charging ? 'เสียบสายชาร์จอยู่' : `แบต ${Math.round(battery.level * 100)}%`) : ''].filter(Boolean).join(' · ') + (lowBat ? ' — เสียบสายชาร์จ' : slow ? ' — เครื่องทำงานหนัก' : ''), slow ? () => openSettings('output') : null);
    return out;
  }
  function openDeskPreflight() {
    let checks = [], cd = [0, 3, 10].includes(store.get('pfCountdown', 3)) ? store.get('pfCountdown', 3) : 3, timer = 0;
    const list = () => settings.destinations.filter(d => d.enabled);
    dialog({
      title: 'เตรียมก่อนไลฟ์',
      wide: true,
      body: `<p class="note pf-hint">ตรวจอัตโนมัติ — กดรายการเพื่อดูวิธีแก้</p>
        <div class="pf-desk">
          <section class="pf-checks" aria-label="รายการตรวจ"><div class="pf-sum"><b></b><span class="pf-bar"><i></i></span></div><div class="pf-rows"></div></section>
          <aside class="pf-side" aria-label="เริ่มไลฟ์">
            <small class="pf-cap">PROGRAM ตอนเริ่ม</small>
            <canvas class="pf-pgm" width="384" height="216"></canvas>
            <div class="pf-kv">
              <div><span>ปลายทาง</span><b class="pf-dests"></b></div>
              <div><span>คุณภาพ</span><b>${formatTag(Math.min(W, H), settings.fps)} · ${(settings.videoKbps / 1000).toFixed(1)} Mbps${W < H ? ' · 9:16' : ''}</b></div>
              <div><span>บันทึกพร้อมไลฟ์</span><button type="button" class="pf-rec" role="switch" aria-checked="${!!settings.autoRec}">${settings.autoRec ? 'เปิด' : 'ปิด'}</button></div>
            </div>
            <div class="seg pf-cd" role="group" aria-label="นับถอยหลัง">${[[0, 'ไม่นับ'], [3, '3-2-1'], [10, '10 วิ']].map(([v, l]) => `<button type="button" data-cd="${v}" aria-pressed="${v === cd}">${l}</button>`).join('')}</div>
            <span class="pf-grow"></span>
            <div class="pf-warn" hidden></div>
            <button type="button" class="btn btn-green btn-golive pf-go" data-pf="go">${icon('broadcast')}เริ่มไลฟ์</button>
            <button type="button" class="btn pf-test" data-pf="test">ทดสอบส่งปลายทาง (ไม่กี่วินาที)</button>
            <p class="pf-test-out" hidden></p>
          </aside>
        </div>`,
      actions: [{ label: 'ปิด', value: 'close' }],
      onOpen(modal, close) {
        modal.classList.add('pf-modal');
        const pgm = $('.pf-pgm', modal), g = pgm.getContext('2d');
        pgm.height = Math.round(pgm.width * H / W);
        const paint = async () => {
          if (!modal.isConnected) { clearInterval(timer); return; }
          try { g.drawImage(pgmCanvas, 0, 0, pgm.width, pgm.height); } catch (e) {}
          checks = await preflightChecks();
          const ok = checks.filter(c => c.state === 'ok').length, err = checks.filter(c => c.state === 'error').length;
          $('.pf-sum b', modal).textContent = `ผ่าน ${ok} จาก ${checks.length}`;
          const bar = $('.pf-bar i', modal); bar.style.width = `${Math.round(ok / checks.length * 100)}%`; bar.className = ok === checks.length ? 'is-ok' : err ? 'is-err' : 'is-warn';
          $('.pf-rows', modal).innerHTML = checks.map((c, i) => `<button type="button" class="pf-row is-${c.state}" data-pf-row="${i}" ${c.fix ? '' : 'tabindex="-1"'}>
              <span class="pf-mark">${c.state === 'ok' ? 'OK' : c.state === 'error' ? '✕' : '!'}</span>
              <span class="pf-txt"><b>${esc(c.name)}</b><small>${esc(c.detail)}</small></span>
              <span class="pf-badge">${c.state === 'ok' ? 'พร้อม' : c.state === 'error' ? 'ต้องแก้' : 'ควรดู'}</span></button>`).join('');
          $('.pf-dests', modal).textContent = list().map(destLabel).join(' · ') || '—';
          const warn = checks.length - ok - err, w = $('.pf-warn', modal);
          w.hidden = !(warn || err);
          w.className = 'pf-warn' + (err ? ' is-err' : '');
          w.textContent = err ? `ยังมี ${err} รายการที่ต้องแก้ก่อนเริ่มไลฟ์` : `ยังมี ${warn} รายการที่ควรดู — เริ่มได้ แต่แนะนำให้แก้ก่อน`;
          $('[data-pf=go]', modal).disabled = !!err;
          $('[data-pf=test]', modal).disabled = !!err || !!streamer.testing;
        };
        paint();
        timer = setInterval(paint, 1000);
        modal.addEventListener('click', async e => {
          const row = e.target.closest('[data-pf-row]');
          if (row) {
            const c = checks[+row.dataset.pfRow];
            if (c?.fix === 'measure') { row.querySelector('small').textContent = 'กำลังวัดความเร็วอัปโหลด…'; try { upMbps = await measureUpload(() => {}); } catch (err) { toast('วัดความเร็วไม่ได้ — ตรวจอินเทอร์เน็ต', 'warn'); } paint(); }
            else if (typeof c?.fix === 'function') { close(); c.fix(); }
            return;
          }
          const cdb = e.target.closest('[data-cd]');
          if (cdb) { cd = +cdb.dataset.cd; store.set('pfCountdown', cd); $$('[data-cd]', modal).forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.cd === cd))); return; }
          const recb = e.target.closest('.pf-rec');
          if (recb) { settings.autoRec = !settings.autoRec; saveSettings(); recb.setAttribute('aria-checked', String(settings.autoRec)); recb.textContent = settings.autoRec ? 'เปิด' : 'ปิด'; return; }
          const act = e.target.closest('[data-pf]')?.dataset.pf;
          if (act === 'go') {
            clearInterval(timer); close();
            if (cd && !(await countdown(cd))) return;
            startDestinations(list());
            if (streamer.ws || streamer.reconnecting) openLiveDialog();
          } else if (act === 'test') {
            const out = $('.pf-test-out', modal), b = $('[data-pf=test]', modal);
            b.disabled = true; out.hidden = false; out.className = 'pf-test-out';
            const lines = [];
            for (const d of list()) {
              out.textContent = `กำลังทดสอบ ${destLabel(d)}…`;
              const r = await testDestination(d);
              lines.push((r.ok ? '✓ ' : '✕ ') + r.message);
              if (!r.ok) out.classList.add('err');
            }
            out.textContent = lines.join('\n');
            b.disabled = false;
          }
        });
      }
    }).then(() => clearInterval(timer));
  }

  // สรุปหลังไลฟ์ (เดสก์ท็อป): ตัวเลขสำคัญ · กราฟบิตเรตตลอดรายการพร้อมเหตุการณ์ · ปลายทาง · ไฟล์ที่ได้
  function openDeskSummary(s, reason) {
    if (!s) return;
    const avgFps = s.fps.length ? s.fps.reduce((a, b) => a + b, 0) / s.fps.length : 0;
    const series = s.all.length ? s.all : s.kbps, live = series.filter(v => v > 0);
    const avgKbps = live.length ? live.reduce((a, b) => a + b, 0) / live.length : 0;
    const t = ms => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    const dests = Object.values(s.dests);
    const stats = [
      ['ระยะเวลา', fmtDuration(s.duration), `${t(s.start)} – ${t(s.end || Date.now())}`],
      ['ข้อมูลที่ส่ง', fmtBytes(s.bytes), `${dests.length} ปลายทาง`],
      ['บิตเรตเฉลี่ย', avgKbps ? (avgKbps / 1000).toFixed(1) + ' Mbps' : '—', `เป้า ${(settings.videoKbps / 1000).toFixed(1)} Mbps`],
      ['ภาพเฉลี่ย', avgFps ? avgFps.toFixed(1) + ' fps' : '—', `ตั้งไว้ ${settings.fps} fps`],
      ['หลุด / ต่อใหม่', `${s.reconnects} ครั้ง`, s.reconnects ? 'ต่อกลับอัตโนมัติ' : 'ไม่หลุดเลย']
    ];
    // กราฟ: เส้นประ = เป้าบิตเรต · เส้นแนวตั้ง = เหตุการณ์ (เน็ตหลุด / ลดบิตเรต / ปลายทางต่อใหม่)
    const GWd = 976, GHt = 140, max = Math.max(settings.videoKbps * 1.25, ...series, 1);
    const y = v => (GHt - 16 - v / max * (GHt - 30)).toFixed(1);
    const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1) * GWd).toFixed(1)},${y(v)}`).join(' ');
    const ev = s.events.slice(0, 6).map((e, i) => {
      const x = Math.min(GWd - 4, Math.max(4, (e.at - s.start) / Math.max(1, s.duration) * GWd)), right = x > GWd * 0.65;
      return `<line x1="${x.toFixed(1)}" y1="10" x2="${x.toFixed(1)}" y2="${GHt - 10}" class="sm-ev"/><text x="${(right ? x - 8 : x + 8).toFixed(1)}" y="${24 + i * 16}" text-anchor="${right ? 'end' : 'start'}" class="sm-evt">นาที ${Math.floor((e.at - s.start) / 60000)} · ${esc(e.text)}</text>`;
    }).join('');
    const caps = inputs.filter(i => i.capRun?.log?.length);
    const files = [];
    if (rec.last && Date.now() - rec.start < s.duration + 600000) files.push([rec.last.name, fmtBytes(rec.last.bytes)]);
    if (iso.last && iso.last.files?.length) files.push([`ไฟล์แยกทุกกล้อง (ISO) · ${iso.last.files.length} ไฟล์`, fmtBytes(iso.last.bytes || 0)]);
    for (const c of caps) files.push([`คำบรรยาย .srt · ${c.capRun.log.length} บรรทัด`, fmtBytes(new Blob([captionSrt(c.capRun.log)]).size)]);
    dialog({
      title: reason ? 'ไลฟ์หยุดลง' : 'ไลฟ์จบเรียบร้อย',
      wide: true,
      body: `<p class="note sm-sub">${esc(show.name || 'โชว์')} · ${t(s.start)} – ${t(s.end || Date.now())}${reason ? ' · ' + esc(reason) : ''}</p>
        <section class="sm-stats" aria-label="ตัวเลขสำคัญ">${stats.map(([l, v, n]) => `<div><small>${l}</small><b>${v}</b><em>${n}</em></div>`).join('')}</section>
        <section class="sm-graph" aria-label="บิตเรตตลอดรายการ"><div class="sm-gh"><b>บิตเรตตลอดรายการ</b><small>เส้นประ = เป้า ${(settings.videoKbps / 1000).toFixed(1)} Mbps</small></div>
          <svg viewBox="0 0 ${GWd} ${GHt}" preserveAspectRatio="none" role="img" aria-label="กราฟบิตเรตตลอดรายการ"><line x1="0" x2="${GWd}" y1="${y(settings.videoKbps)}" y2="${y(settings.videoKbps)}" class="sm-target"/>${pts ? `<polyline points="${pts}" class="sm-line"/>` : ''}${ev}</svg></section>
        <div class="sm-cols">
          <section aria-label="ปลายทาง"><b>ปลายทาง</b>${dests.map(d => `<div class="sm-row"><span>${esc(d.label)}</span><span class="${d.drops || d.down > 5 ? 'warn' : 'ok'}">${d.drops ? `ต่อใหม่ ${d.drops} ครั้ง · หาย ${d.down} วิ` : d.down > 5 ? `ขาด ${d.down} วิ` : `ครบ ${fmtDuration(d.live * 1000)} · ไม่หลุด`}</span></div>`).join('') || '<p class="note">—</p>'}</section>
          <section aria-label="ไฟล์ที่ได้"><b>ไฟล์ที่ได้</b>${files.map(([n, z]) => `<div class="sm-row"><span class="sm-file">${esc(n)}</span><span>${z}</span></div>`).join('') || `<p class="note">${rec.active ? 'ยังบันทึกอยู่ — กด REC เพื่อหยุดและบันทึกไฟล์' : 'ไม่ได้บันทึกไฟล์ — เปิด “บันทึกพร้อมไลฟ์” ในหน้าเตรียมก่อนไลฟ์ครั้งหน้า'}</p>`}</section>
        </div>`,
      actions: [{ label: 'เสร็จสิ้น', primary: true }],
      onOpen(modal) {
        modal.classList.add('sm-modal');
        const foot = $('.modal-foot', modal);
        foot.insertAdjacentHTML('afterbegin', `${caps.length ? '<button type="button" class="btn" data-sm="srt">ดาวน์โหลดคำบรรยาย</button>' : ''}<button type="button" class="btn" data-sm="save">บันทึกโชว์นี้ไว้ใช้ครั้งหน้า</button><span class="ml-auto"></span>`);
        foot.addEventListener('click', e => {
          const a = e.target.closest('[data-sm]')?.dataset.sm;
          if (a === 'srt') caps.forEach(c => downloadBlob(new Blob([captionSrt(c.capRun.log)], { type: 'text/plain' }), `webmix-captions-${stamp()}.srt`));
          else if (a === 'save') { const m = library.save(false); toast(m ? `บันทึก “${m.name}” ลงคลังโชว์แล้ว` : 'พื้นที่เก็บในเบราว์เซอร์เต็ม', m ? 'success' : 'error'); }
        });
      }
    });
  }

  // การ์ดเตือนบนหน้าสวิตช์ (มือถือ): เรียงตามความรุนแรง บอกว่าเกิดอะไรและควรทำอะไร · กด "รับทราบ" เพื่อซ่อนจนกว่าจะเกิดใหม่
  const alertDismissed = new Set(), trouble = { lowFps: 0 }, wideAlerts = matchMedia('(min-width: 761px) and (min-height: 501px)');
  function renderAlerts() {
    renderNetBanner();
    const box = $('#m-alerts');
    if (!box) return;
    const live = !!(streamer.ws || streamer.reconnecting);
    const list = [];
    if (battery && !battery.charging && battery.level <= 0.15 && (live || rec.active)) {
      list.push({ key: 'battery', level: 'red', title: `แบตเหลือ ${Math.round(battery.level * 100)}%`, text: 'เสียบสายชาร์จตอนนี้ — ถ้าแบตหมด ไลฟ์และการบันทึกจะหยุด' });
    }
    // เดสก์ท็อป / แท็บเล็ตมีแถบเตือนเน็ตหลุดแยกอยู่แล้ว (renderNetBanner)
    if (streamer.reconnecting && !wideAlerts.matches) {
      list.push({ key: 'gw', level: 'amber', title: `การเชื่อมต่อหลุด — กำลังเชื่อมต่อใหม่ (ครั้งที่ ${streamer.attempt || 1})`, text: 'ปลายทางที่ไลฟ์อยู่จะเริ่มต่อให้เองเมื่อเชื่อมต่อได้' });
    }
    for (const [id, st] of streamer.dests) {
      if (st.state !== 'error') continue;
      const d = settings.destinations.find(z => z.id === id);
      const others = [...streamer.dests.values()].filter(x => x.state === 'live').length;
      list.push({ key: 'dest-' + id, level: 'amber', title: `${destLabel(d) || id} หลุด — กำลังเชื่อมต่อใหม่`, text: (st.message ? st.message + ' · ' : '') + (others ? `ปลายทางอื่นยังออกอากาศปกติ (${others})` : 'ลองใหม่อัตโนมัติ'), action: { label: 'หยุดเฉพาะช่องนี้', run: () => stopDestination(id) } });
    }
    // กล้อง / มือถือ / แขก หลุดหลังจากเคยมีภาพ
    for (const inp of inputs) {
      if (!['camera', 'wireless', 'guest', 'ndi', 'srt', 'rtsp', 'rtmp'].includes(inp.type)) continue;
      if (inp.status === 'live') { inp.wasLive = true; continue; }
      if (!inp.wasLive) continue;
      list.push({ key: 'lost-' + inp.id, level: 'amber', icon: String(inputs.indexOf(inp) + 1), title: `${inp.name} หลุด`, text: 'กำลังรอเชื่อมต่อใหม่… (ภาพสุดท้ายค้างไว้ในการ์ด)',
        action: inp.type === 'camera' ? { label: 'เชื่อมต่อใหม่', run: () => relinkInput(inp) } : { label: 'ลบออก', run: () => removeInput(inp.id) } });
    }
    // ตกเฟรม: ภาพช้ากว่าเฟรมเรตที่ตั้งไว้ต่อเนื่อง 5 วินาที
    const target = +settings.fps || 30;
    trouble.lowFps = fps && fps < target * 0.8 && !document.hidden ? (trouble.lowFps || Date.now()) : 0;
    if (trouble.lowFps && Date.now() - trouble.lowFps > 5000) {
      const bg = inputs.some(i => i.bg && i.bg.mode && i.bg.mode !== 'none');
      list.push({ key: 'fps', level: 'amber', icon: '%', title: `เครื่องทำงานหนัก — ภาพเหลือ ${Math.round(fps)} จาก ${target} fps`,
        text: 'ลองลดความละเอียด Program' + (bg ? ' หรือปิด AI ลบพื้นหลัง' : '') + ' · ปิดโปรแกรมอื่นที่ไม่ใช้',
        action: { label: 'ตั้งค่าภาพ', run: () => openSettings('output') } });
    }
    // เสียงแตก: แตะ 0 dB ตั้งแต่ 3 ครั้งใน 10 วินาที
    for (const ch of audio.channels) {
      const n = (ch.clips || []).filter(t => Date.now() - t < 10000).length;
      if (n < 3 || ch.muted) continue;
      list.push({ key: 'clip-' + ch.id, level: 'red', icon: 'dB', title: `${ch.name} ดังเกิน (CLIP)`, text: `พีคแตะ 0 dB ${n} ครั้ง · แนะนำลดระดับ 4 dB`,
        action: { label: 'ลด 4 dB', run: () => { ch.db = Math.max(-60, (ch.db === -Infinity ? -60 : ch.db) - 4); ch.clips = []; audio.applyGain(ch); renderMixer(); } } });
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
        <span class="m-alert-ic" aria-hidden="true">${esc(a.icon || '!')}</span>
        <div class="m-alert-text"><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div>
        <div class="m-alert-actions">${a.action ? `<button type="button" class="btn btn-sm" data-alert-act="${i}">${esc(a.action.label)}</button>` : ''}<button type="button" class="btn btn-sm btn-ghost m-alert-ok" data-alert-ok="${esc(a.key)}">รับทราบ</button></div>
        <button type="button" class="m-alert-x" data-alert-ok="${esc(a.key)}" aria-label="ปิด">${icon('x')}</button>
      </div>`).join('');
    box.onclick = e => {
      const act = e.target.closest('[data-alert-act]');
      if (act) { shown[+act.dataset.alertAct]?.action?.run(); return; }
      const okb = e.target.closest('[data-alert-ok]');
      if (okb) { alertDismissed.add(okb.dataset.alertOk); box.dataset.sig = '-'; renderAlerts(); }
    };
  }

  // เน็ตหลุดระหว่างไลฟ์: แถบเตือนใต้แถบบน + ป้าย “ไม่ได้ส่งออก” บนจอ Program (เดสก์ท็อป / แท็บเล็ต)
  function renderNetBanner() {
    const el = $('#net-banner');
    if (!el) return;
    const on = !!streamer.reconnecting;
    $('#pgm-offair').hidden = !on;
    el.hidden = !on;
    document.body.classList.toggle('has-netbanner', on);
    if (!on) { el.dataset.sig = ''; return; }
    const ids = [...streamer.dests.keys()];
    const chips = (ids.length ? ids.map(id => settings.destinations.find(d => d.id === id)).filter(Boolean) : settings.destinations.filter(d => d.enabled))
      .map(d => `<span class="nb-chip">${esc(destLabel(d))}</span>`).join('');
    const sig = streamer.attempt + chips;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = `<span class="nb-spin" aria-hidden="true"></span><b>อินเทอร์เน็ตหลุด — กำลังต่อใหม่ (ครั้งที่ ${streamer.attempt || 1})</b>
      <span class="nb-text">ยังบันทึกลงเครื่องต่อ · ปลายทางจะกลับมาเองเมื่อต่อได้</span><span class="nb-chips">${chips}</span>
      <button type="button" class="btn btn-sm" data-nb="live">ดูปลายทาง</button>`;
    $('[data-nb=live]', el).onclick = () => $('#btn-stream')?.click();
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
      ['grid', 'Multiview — ดูทุกภาพ แตะเพื่อสลับ', () => multiview.open()],
      ['users', 'รีโมต / ทีมงาน — สวิตเชอร์ · เสียง · CG · อินเสิร์ต · มอนิเตอร์', () => remoteCtl.openDialog()],
      ...(desktop && desktop.mobile ? [] : [['external', 'หน้าต่าง Program Output', openOutputWindow]]),
      ['sliders', 'ตั้งค่า', () => openSettings()],
      ['sliders', 'ควบคุมด้วย MIDI / Stream Deck', () => openSettings('control')],
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
      <p class="note">อินเทอร์เน็ตขาขึ้นของเครื่องนี้ต้องพอสำหรับทุกปลายทางรวมกัน (ffmpeg ส่งแยกทีละปลายทาง) · TURN สำหรับกล้องมือถือผ่านเน็ตมือถือยังต้องใช้ Gateway บนเซิร์ฟเวอร์</p>
      <p class="note app-ver">แอปเวอร์ชัน ${esc(info.version || '?')}${appUpdate.available ? ` · <b>มีเวอร์ชันใหม่ ${esc(appUpdate.available.version)}</b>` : appUpdate.checkedAt ? ' · เป็นเวอร์ชันล่าสุด' : ''}
        <button type="button" class="btn btn-sm app-update-btn">${appUpdate.available ? (desktop.mobile ? 'ดาวน์โหลด' : 'อัปเดตเลย') : 'ตรวจหาอัปเดต'}</button></p>`;
  }

  /* ---- อัปเดตแอป ----
     คอมพิวเตอร์: ตรวจ latest.json ใน GitHub Release (ลงลายเซ็นไว้ — แอปตรวจลายเซ็นก่อนติดตั้งเสมอ) แล้วดาวน์โหลด ติดตั้ง เปิดใหม่ในแอป
     Android: ดูเลขเวอร์ชันจาก GitHub แล้วบอกให้ดาวน์โหลด APK (ติดตั้งทับได้ ข้อมูลไม่หาย)
     ตรวจหลังเปิดแอป 20 วินาที และทุก 6 ชั่วโมง · ไม่ติดตั้งระหว่างไลฟ์/บันทึก */
  const RELEASES_URL = 'https://github.com/jugkritso-png/webswither/releases/latest';
  const appUpdate = { available: null, checkedAt: 0, installing: false };
  const newerVersion = (a, b) => {
    const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  async function checkAppUpdate(manual) {
    if (!desktop) return;
    const info = await desktop.ready;
    if (!info) return;
    try {
      if (desktop.mobile) {
        const r = await fetch('https://api.github.com/repos/jugkritso-png/webswither/releases/latest', { cache: 'no-store' });
        const tag = r.ok ? (await r.json()).tag_name : '';
        appUpdate.available = tag && newerVersion(tag, info.version) ? { version: tag.replace(/^v/, '') } : null;
      } else {
        appUpdate.available = await desktop.updateCheck();
      }
      appUpdate.checkedAt = Date.now();
    } catch (e) {
      if (manual) toast('ตรวจหาอัปเดตไม่ได้ (ต้องต่ออินเทอร์เน็ต) — ดาวน์โหลดเองได้ที่หน้า Release', 'warn', 7000, { label: 'คัดลอกลิงก์', run: () => copyText(RELEASES_URL) });
      return;
    }
    if (appUpdate.available) {
      const v = appUpdate.available.version;
      toast(desktop.mobile ? `มี WebMix Pro ${v} แล้ว — ดาวน์โหลด APK ใหม่ติดตั้งทับได้เลย (ข้อมูลไม่หาย)` : `มี WebMix Pro ${v} แล้ว — อัปเดตได้ในคลิกเดียว แอปจะเปิดใหม่เอง`, 'info', 20000,
        desktop.mobile ? { label: 'คัดลอกลิงก์', run: () => copyText(RELEASES_URL) } : { label: 'ดูรายละเอียด', run: openUpdateDialog });
    } else if (manual) toast(`เป็นเวอร์ชันล่าสุดแล้ว (${info.version})`, 'success');
    refreshAppVersion();
  }
  async function installAppUpdate() {
    if (desktop.mobile) { copyText(RELEASES_URL); return; }
    if (streamer.active || streamer.reconnecting || rec.active) { toast('กำลังไลฟ์หรือบันทึกอยู่ — หยุดก่อนแล้วค่อยอัปเดต (แอปต้องปิดแล้วเปิดใหม่)', 'warn', 7000); return; }
    if (appUpdate.installing) return;
    appUpdate.installing = true;
    show.autosave(true);
    toast('กำลังดาวน์โหลดและติดตั้งอัปเดต… แอปจะปิดแล้วเปิดใหม่เอง', 'info', 60000);
    try { await desktop.updateInstall(); }
    catch (e) {
      appUpdate.installing = false;
      toast(`อัปเดตไม่สำเร็จ: ${e.message || e} — ดาวน์โหลดตัวติดตั้งเองได้ที่หน้า Release`, 'error', 10000, { label: 'คัดลอกลิงก์', run: () => copyText(RELEASES_URL) });
    }
  }
  // หน้าต่างอัปเดตแอป: มีอะไรใหม่ · ดาวน์โหลดเบื้องหลัง (ไลฟ์ต่อได้) · ติดตั้งเมื่อปิดแอป หรือรีสตาร์ทและติดตั้งตอนนี้
  const updateLines = notes => String(notes || '').split('\n').map(l => l.trim().replace(/^[-*•]\s*/, '')).filter(l => l && !/^#/.test(l)).slice(0, 12)
    .map(l => /^(แก้|fix)/i.test(l) ? ['แก้ไข', l.replace(/^(แก้ไข|fix)\s*[:：-]?\s*/i, '')] : ['ใหม่', l.replace(/^(ใหม่|new)\s*[:：-]?\s*/i, '')]);
  function openUpdateDialog() {
    const u = appUpdate.available;
    if (!u || !desktop || desktop.mobile) return installAppUpdate();
    const info = desktop.info || {};
    const lines = updateLines(u.notes);
    const live = () => streamer.active || streamer.reconnecting || rec.active;
    const dl = appUpdate.dl || (appUpdate.dl = { done: 0, total: 0, state: 'idle', error: '' });
    const start = () => {
      if (dl.state === 'busy' || dl.state === 'ready') return;
      Object.assign(dl, { state: 'busy', error: '', done: 0 });
      desktop.updateDownload(m => { dl.done = m.done; dl.total = m.total || dl.total; })
        .then(() => { dl.state = 'ready'; })
        .catch(e => { dl.state = 'error'; dl.error = String(e.message || e); });
    };
    start();
    dialog({
      title: 'อัปเดตแอป',
      body: `<div class="up-wrap">
        <div class="up-head"><span class="up-logo" aria-hidden="true"></span><div><b>WebMix Pro ${esc(u.version)}</b><small>เวอร์ชันปัจจุบัน ${esc(info.version || u.current || '?')}</small></div></div>
        <section class="up-card"><h3>มีอะไรใหม่</h3>${lines.length ? `<ul class="up-notes">${lines.map(([t, l]) => `<li><em class="${t === 'ใหม่' ? 'new' : 'fix'}">${t}</em><span>${esc(l)}</span></li>`).join('')}</ul>` : '<p class="note">ดูรายละเอียดทั้งหมดได้ที่หน้า Release</p>'}</section>
        <section class="up-card"><div class="up-row"><h3 class="up-state">กำลังดาวน์โหลด</h3><span class="mono up-mb"></span></div><div class="up-bar"><i></i></div>
          <p class="note">ดาวน์โหลดเบื้องหลังได้ ไลฟ์ต่อได้ตามปกติ · เลือก “ติดตั้งเมื่อปิดแอป” แล้วเปิดครั้งหน้าจะเป็นเวอร์ชันใหม่</p></section>
        <p class="up-live" hidden>กำลังไลฟ์หรือบันทึกอยู่ — แอปจะไม่รีสตาร์ทเองระหว่างออกอากาศ</p>
      </div>`,
      actions: [{ label: 'ภายหลัง' }, { label: 'ติดตั้งเมื่อปิดแอป', value: 'later' }, { label: 'รีสตาร์ทและติดตั้ง', primary: true, value: 'now' }],
      onOpen(modal, close) {
        modal.classList.add('up-modal');
        const now = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'รีสตาร์ทและติดตั้ง');
        const nowC = now.cloneNode(true); now.replaceWith(nowC);
        const tick = () => {
          if (!modal.isConnected) return;
          const pct = dl.total ? dl.done / dl.total : dl.state === 'ready' ? 1 : 0;
          $('.up-bar i', modal).style.width = `${pct * 100}%`;
          $('.up-mb', modal).textContent = dl.total ? `${fmtBytes(dl.done)} / ${fmtBytes(dl.total)}` : dl.done ? fmtBytes(dl.done) : '';
          $('.up-state', modal).textContent = dl.state === 'ready' ? 'ดาวน์โหลดเสร็จ — พร้อมติดตั้ง' : dl.state === 'error' ? `ดาวน์โหลดไม่สำเร็จ: ${dl.error}` : 'กำลังดาวน์โหลด';
          $('.up-live', modal).hidden = !live();
          nowC.disabled = dl.state !== 'ready' || live();
          setTimeout(tick, 200);
        };
        tick();
        nowC.addEventListener('click', async () => {
          if (live()) return;
          show.autosave(true);
          nowC.disabled = true; nowC.textContent = 'กำลังติดตั้ง…';
          try { await desktop.updateApply(); } catch (e) { toast(`ติดตั้งไม่สำเร็จ: ${e.message || e}`, 'error', 9000); close(); }
        });
      }
    }).then(r => {
      if (r?.value === 'later') { appUpdate.onQuit = true; toast('จะติดตั้งเวอร์ชันใหม่ให้เมื่อปิดแอป', 'success'); }
      if (dl.state === 'error') dl.state = 'idle';
    });
  }

  function copyText(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('คัดลอกลิงก์แล้ว — เปิดในเบราว์เซอร์เพื่อดาวน์โหลด', 'success'))
      .catch(() => toast(text, 'info', 15000));
  }
  function refreshAppVersion() {
    const el = $('.app-ver');
    if (el) el.outerHTML = desktopGatewayHtml().match(/<p class="note app-ver">[\s\S]*?<\/p>/)[0];
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('.app-update-btn')) return;
    appUpdate.available ? (desktop.mobile ? installAppUpdate() : openUpdateDialog()) : checkAppUpdate(true);
  });
  if (desktop) {
    setTimeout(() => settings.autoUpdate !== false && checkAppUpdate(false), 20000);
    setInterval(() => settings.autoUpdate !== false && checkAppUpdate(false), 6 * 3600 * 1000);
  }

  // หมวดตั้งค่าเพิ่ม: ทั่วไป · เสียง · ระบบและอัปเดต — เปลี่ยนแล้วมีผลทันที
  function settingsExtraHtml() {
    const info = desktop?.info || {};
    const sw = (name, on, label, note = '') => `<label class="set-sw"><span><b>${label}</b>${note ? `<small>${note}</small>` : ''}</span><input type="checkbox" data-x="${name}" ${on ? 'checked' : ''}><i aria-hidden="true"></i></label>`;
    const row = (label, ctl) => `<div class="set-row"><span>${label}</span><div>${ctl}</div></div>`;
    const seg = (name, cur, opts) => `<div class="set-seg">${opts.map(([v, n]) => `<button type="button" data-x-seg="${name}" data-v="${v}" class="${String(v) === String(cur) ? 'is-active' : ''}">${n}</button>`).join('')}</div>`;
    return `
      <div class="modal-pane" data-mpane="general">
        <h3 class="set-h">ทั่วไป</h3>
        ${row('ขนาดการ์ดแหล่งภาพ', seg('cardSize', cardSize(), [['s', 'เล็ก'], ['m', 'กลาง'], ['l', 'ใหญ่']]))}
        ${sw('keepAwake', settings.keepAwake !== false, 'ป้องกันจอดับระหว่างไลฟ์ / บันทึก')}
        ${row('ขนาดแผงต่าง ๆ', '<button type="button" class="btn btn-sm" data-x-act="layout">คืนขนาดเริ่มต้น</button>')}
        ${row('ปุ่มลัดคีย์บอร์ด', '<button type="button" class="btn btn-sm" data-x-act="help">ดูคู่มือและคีย์ลัด</button>')}
        <p class="note">ภาษา: ไทย · ธีม: มืด (ออกแบบมาให้อ่านง่ายในห้องสตูดิโอ)</p>
      </div>
      <div class="modal-pane" data-mpane="audio">
        <h3 class="set-h">เสียง</h3>
        ${row('เป้าหมายความดัง (LUFS)', seg('lufs', lufs.target, Object.keys(LUFS_TARGETS).map(k => [k, `${k} · ${LUFS_TARGETS[k].split(' ')[0]}`])))}
        ${sw('limiter', audio.masterStrip.limiter, 'ลิมิตเตอร์ที่ Master', 'กันเสียงแตกในไฟล์บันทึกและสตรีม')}
        ${row('ลำโพง / หูฟังสำหรับฟังเสียง', `<select class="select" data-x="sink">${'setSinkId' in AudioContext.prototype ? '<option value="">ค่าเริ่มต้นของเครื่อง</option>' : '<option value="">เบราว์เซอร์นี้เลือกไม่ได้ (ใช้ค่าเริ่มต้นของเครื่อง)</option>'}</select>`)}
        <p class="note">EQ / คอมเพรสเซอร์ / เกต / ดีเลย์ ตั้งแยกแต่ละช่องที่ปุ่ม FX ในมิกเซอร์</p>
      </div>
      <div class="modal-pane" data-mpane="system">
        <h3 class="set-h">ระบบและอัปเดต</h3>
        ${row('เวอร์ชัน', desktop ? `<span class="set-ver">WebMix Pro ${esc(info.version || '?')}${appUpdate.available ? ` <em>มี ${esc(appUpdate.available.version)}</em>` : ''}</span> <button type="button" class="btn btn-sm app-update-btn">${appUpdate.available ? 'อัปเดต' : 'ตรวจหาอัปเดต'}</button>` : '<span class="set-ver">เวอร์ชันเว็บ — อัปเดตเองทุกครั้งที่เปิดหน้าใหม่</span>')}
        ${desktop ? sw('autoUpdate', settings.autoUpdate !== false, 'ตรวจอัปเดตอัตโนมัติ', 'ตอนเปิดแอปและทุก 6 ชั่วโมง') : ''}
        ${row('ตัววาดภาพ', `<span>${renderer.active === 'gpu' ? `GPU (WebGL) · ${esc(gpu.rendererName || '')}` : 'CPU (Canvas 2D)'}</span>`)}
        ${desktop ? row('ตัวเข้ารหัส', `<span>${esc(ENCODER_LABEL[info.encoder] || info.encoder || 'libx264')}</span>`) : ''}
        ${row('ข้อมูลในเครื่องนี้', '<button type="button" class="btn btn-sm" data-x-act="export">ส่งออกโชว์เป็นไฟล์</button>')}
      </div>`;
  }
  function bindSettingsExtra(modal) {
    modal.addEventListener('click', e => {
      const b = e.target.closest('[data-x-seg]');
      if (b) {
        const k = b.dataset.xSeg, v = b.dataset.v;
        $$(`[data-x-seg="${k}"]`, modal).forEach(x => x.classList.toggle('is-active', x === b));
        if (k === 'cardSize') setCardSize(v);
        if (k === 'lufs') { lufs.target = +v; store.set('lufsTarget', v); lufs.render(); }
        return;
      }
      const a = e.target.closest('[data-x-act]')?.dataset.xAct;
      if (a === 'layout') { layoutSize.v = {}; layoutSize.save(); toast('คืนขนาดแผงเริ่มต้นแล้ว', 'success'); }
      else if (a === 'help') openHelp();
      else if (a === 'export') show.exportFile?.();
    });
    modal.addEventListener('change', e => {
      const k = e.target.dataset.x;
      if (!k) return;
      if (k === 'keepAwake') { settings.keepAwake = e.target.checked; saveSettings(); updateOnAir(); }
      else if (k === 'autoUpdate') { settings.autoUpdate = e.target.checked; saveSettings(); }
      else if (k === 'limiter') { audio.ensure(); audio.setLimiter(e.target.checked); renderMixer(); }
      else if (k === 'sink') { store.set('monitorSink', e.target.value); applySink(); }
    });
    // รายชื่อลำโพง / หูฟัง
    const sel = $('[data-x=sink]', modal);
    if (sel && 'setSinkId' in AudioContext.prototype && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(list => {
        const cur = store.get('monitorSink', '');
        for (const d of list.filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default')) sel.insertAdjacentHTML('beforeend', `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || 'ลำโพง')}</option>`);
      }).catch(() => {});
    }
  }
  function applySink() {
    const id = store.get('monitorSink', '');
    if (audio.ctx && audio.ctx.setSinkId) audio.ctx.setSinkId(id).catch(() => { store.set('monitorSink', ''); toast('เปลี่ยนลำโพงไม่ได้ — ใช้ค่าเริ่มต้นของเครื่อง', 'warn'); });
  }

  function openSettings(tab = 'output') {
    const live = rec.active || streamer.active;
    let readDests = null;
    dialog({
      title: 'ตั้งค่า',
      wide: true,
      body: `
        <div class="modal-tabs set-tabs" role="tablist"><button type="button" data-mtab="general">ทั่วไป</button><button type="button" data-mtab="output">วิดีโอและเอาต์พุต</button><button type="button" data-mtab="stream">สตรีมและปลายทาง</button><button type="button" data-mtab="audio">เสียง</button><button type="button" data-mtab="control">ควบคุม MIDI</button><button type="button" data-mtab="system">ระบบและอัปเดต</button></div>
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
          <label class="check"><input type="checkbox" name="autoRec" ${settings.autoRec ? 'checked' : ''}> บันทึกสำรองอัตโนมัติเมื่อเริ่มไลฟ์ — หยุดไลฟ์ครบทุกช่องแล้วหยุดบันทึกให้ (เน็ตหลุดก็ยังมีไฟล์)</label>
          <label class="check"><input type="checkbox" name="abr" ${settings.abr ? 'checked' : ''}> ปรับบิตเรตอัตโนมัติเมื่อเน็ตส่งไม่ทัน — ลดคุณภาพลงชั่วคราวแทนที่ไลฟ์จะค้างหรือหลุด</label>
          <label class="check"><input type="checkbox" name="isoRec" ${settings.isoRec ? 'checked' : ''}> บันทึกแยกทุกกล้อง (ISO) — ไฟล์ละกล้องพร้อมไฟล์ Program สำหรับตัดต่อทีหลัง (ใช้ CPU และพื้นที่เพิ่มตามจำนวนกล้อง)</label>
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
        $('.modal-body', modal).insertAdjacentHTML('beforeend', `<div class="modal-pane" data-mpane="control">${midiPaneHtml()}</div>${settingsExtraHtml()}`);
        bindMidiPane(modal);
        bindSettingsExtra(modal);
        // พื้นฐาน / ขั้นสูง: ขั้นสูงกางตัวเลือกที่พับไว้ทุกหมวด
        modal.classList.add('set-modal');
        $('.modal-title', modal).insertAdjacentHTML('afterend', `<div class="set-level" role="group" aria-label="ระดับการตั้งค่า"><button type="button" data-lv="basic">พื้นฐาน</button><button type="button" data-lv="adv">ขั้นสูง</button></div>`);
        const level = lv => {
          store.set('settingsLevel', lv);
          $$('[data-lv]', modal).forEach(b => b.classList.toggle('is-active', b.dataset.lv === lv));
          if (lv === 'adv') $$('details.adv', modal).forEach(d => { d.open = true; });
        };
        $('.set-level', modal).addEventListener('click', e => { const b = e.target.closest('[data-lv]'); if (b) level(b.dataset.lv); });
        level(store.get('settingsLevel', 'basic'));
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
          <div class="dest-row ${d.enabled ? '' : 'is-disabled'} ${isNet(d) ? 'is-net' : ''} ${d.platform === 'ndi' ? 'is-ndi' : ''}" data-id="${esc(d.id)}">
            <label class="dest-enable" title="สตรีมไปปลายทางนี้"><input type="checkbox" data-f="enabled" ${d.enabled ? 'checked' : ''}></label>
            <select class="select" data-f="platform" aria-label="แพลตฟอร์ม">
              ${Object.entries(PLATFORMS).map(([k, p]) => `<option value="${k}" ${d.platform === k ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
            <input class="input mono" data-f="server" value="${esc(d.server)}" placeholder="${isNet(d) ? 'ชื่อแหล่ง เช่น WebMix Program' : isSrt(d) ? 'srt://host:9000' : 'rtmp://...'}" aria-label="Server URL">
            <input class="input mono" data-f="key" type="${showKeys.checked ? 'text' : 'password'}" autocomplete="off" value="${esc(d.key)}" placeholder="${isSrt(d) ? 'Stream ID (ถ้ามี)' : 'Stream Key'}" aria-label="Stream Key / Stream ID">
            <button type="button" class="btn btn-ghost btn-icon dest-remove" title="ลบปลายทาง">${icon('x')}</button>
            <button type="button" class="btn dest-paste">${icon('copy')}วางคีย์จากคลิปบอร์ด</button>
            <div class="dest-test"><select class="select dest-orient" data-f="orient" aria-label="รูปแบบภาพ">${Object.entries(ORIENTS).map(([k, v]) => `<option value="${k}" ${(d.orient || 'h') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <button type="button" class="btn btn-sm dest-test-btn" title="${TEST_NOTE}">${icon('broadcast')}ทดสอบ</button><p class="dest-test-out" hidden></p></div>
            <div class="dest-srt" ${isSrt(d) ? '' : 'hidden'}>
              <input class="input mono" data-f="passphrase" type="${showKeys.checked ? 'text' : 'password'}" autocomplete="off" value="${esc(d.passphrase)}" placeholder="รหัสผ่านเข้ารหัส SRT (10–64 ตัว, ถ้ามี)" aria-label="SRT passphrase">
              <select class="select" data-f="latency" aria-label="SRT latency" title="SRT latency — ยิ่งสูงยิ่งทนเน็ตกระตุก แต่ดีเลย์มากขึ้น">
                ${SRT_LATENCIES.map(ms => `<option value="${ms}" ${d.latency === ms ? 'selected' : ''}>Latency ${ms} ms</option>`).join('')}
              </select>
            </div>
            <p class="dest-net-note">เครื่องอื่นในวง LAN (vMix, OBS + DistroAV, NDI Studio Monitor) จะเห็น Program ในชื่อนี้ · ใช้ได้ในแอปเดสก์ท็อป${'' /* NDI ต้องติดตั้ง NDI Tools */}<span class="dest-ndi-only"> · ต้องติดตั้ง NDI Tools (ฟรี) จาก ndi.video ก่อน</span></p>
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
          // แพลตฟอร์มที่ไม่มีเซิร์ฟเวอร์ตายตัว (TikTok / Instagram / อื่น ๆ) แยกส่วนท้ายเป็นคีย์ได้เสมอ
          const noFixed = !PLATFORMS[row.querySelector('[data-f=platform]').value]?.server;
          if (m && (noFixed || /\/(live|rtmp|live2|app)\b/i.test(m[1]))) { row.querySelector('[data-f=server]').value = m[1]; row.querySelector('[data-f=key]').value = m[2]; }
          else row.querySelector('[data-f=key]').value = text;
          toast('วางคีย์แล้ว', 'success', 2000);
        };
        list.addEventListener('change', e => {
          const row = e.target.closest('.dest-row');
          if (e.target.dataset.f === 'platform') {
            const p = PLATFORMS[e.target.value];
            const srt = e.target.value === 'srt';
            const server = row.querySelector('[data-f=server]');
            if (p.server) server.value = p.server; else if (p.net) server.value = 'WebMix Program'; else { server.value = ''; server.focus(); }
            row.querySelector('[data-f=orient]').value = p.vertical ? 'vcrop' : 'h';
            row.classList.toggle('is-net', !!p.net);
            row.classList.toggle('is-ndi', e.target.value === 'ndi');
            server.placeholder = p.net ? 'ชื่อแหล่ง เช่น WebMix Program' : srt ? 'srt://host:9000' : 'rtmp://...';
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
          latency: +row.querySelector('[data-f=latency]').value || 500,
          orient: row.querySelector('[data-f=orient]').value
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
      settings.autoRec = f.autoRec.checked;
      settings.isoRec = f.isoRec.checked;
      settings.abr = f.abr.checked;
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

  // คู่มือและคีย์ลัด: สารบัญซ้าย · ค้นหา · คีย์ลัดเป็นกลุ่มพร้อมปุ่มแบบคีย์บอร์ด · พิมพ์ใบคีย์ลัด
  const KEY_GROUPS = [['ตัดภาพ', /^(Space|Enter|1 – 9|Shift \+ 1 – 9|F)$/], ['กราฟิกและรีเพลย์', /^(T|P|K|Q W E R|Shift \+ Q W E R|I)$/], ['อื่น ๆ', /./]];
  const kbdHtml = k => k.split(/\s*\+\s*/).map(part => part.split(/\s+(?=\S)/).length > 1 && !/–/.test(part) ? part.split(/\s+/).map(x => `<kbd>${esc(x)}</kbd>`).join('') : `<kbd>${esc(part)}</kbd>`).join('<span class="kb-plus">+</span>');
  function openHelp(section) {
    const groups = KEY_GROUPS.map(([g]) => [g, []]);
    for (const sc of SHORTCUTS) groups[KEY_GROUPS.findIndex(([, re]) => re.test(sc[0]))][1].push(sc);
    const secs = [['คีย์ลัด', null], ...MANUAL];
    dialog({
      title: 'คู่มือและคีย์ลัด',
      wide: true,
      body: `<div class="hp-wrap">
        <nav class="hp-toc" aria-label="สารบัญ">${secs.map(([h], i) => `<button type="button" data-sec="${i}" class="${i === 0 ? 'is-on' : ''}">${esc(h)}</button>`).join('')}</nav>
        <div class="hp-main">
          <label class="hp-search">${icon('search')}<input type="search" placeholder="ค้นหา เช่น ตัดภาพ, ปิดเสียง, รีเพลย์" aria-label="ค้นหาในคู่มือ"></label>
          <section class="hp-sec" data-sec="0"><h3>คีย์ลัด</h3><div class="hp-keys">${groups.filter(([, l]) => l.length).map(([g, l]) => `<div class="hp-card"><h4>${esc(g)}</h4>${l.map(([k, d]) => `<div class="hp-k" data-q="${esc((k + ' ' + d).toLowerCase())}"><span>${esc(d)}</span><span class="hp-kb">${kbdHtml(k)}</span></div>`).join('')}</div>`).join('')}</div></section>
          ${MANUAL.map(([h, items], i) => `<section class="hp-sec" data-sec="${i + 1}"><h3>${esc(h)}</h3><ul>${items.map(t => `<li data-q="${esc((h + ' ' + t).toLowerCase())}">${esc(t)}</li>`).join('')}</ul></section>`).join('')}
          <p class="note hp-none" hidden>ไม่พบคำที่ค้นหา</p>
        </div>
      </div>`,
      actions: [{ label: 'พิมพ์ใบคีย์ลัด', value: 'print' }, { label: 'ดาวน์โหลดคู่มือ (Word)', value: 'word' }, { label: 'ปิด', primary: true }],
      onOpen(modal) {
        modal.classList.add('hp-modal');
        const main = $('.hp-main', modal);
        const go = i => { const sec = $(`.hp-sec[data-sec="${i}"]`, modal); if (sec) main.scrollTo({ top: sec.offsetTop - main.offsetTop - 8, behavior: 'smooth' }); };
        $('.hp-toc', modal).addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (!b) return; $$('.hp-toc button', modal).forEach(x => x.classList.toggle('is-on', x === b)); go(+b.dataset.sec); });
        main.addEventListener('scroll', () => {
          const top = main.scrollTop + main.offsetTop + 30;
          let cur = 0;
          for (const sec of $$('.hp-sec', modal)) if (sec.offsetTop <= top && !sec.hidden) cur = +sec.dataset.sec;
          $$('.hp-toc button', modal).forEach(x => x.classList.toggle('is-on', +x.dataset.sec === cur));
        });
        $('.hp-search input', modal).addEventListener('input', e => {
          const q = e.target.value.trim().toLowerCase();
          let any = false;
          for (const el of $$('[data-q]', modal)) { const hit = !q || el.dataset.q.includes(q); el.hidden = !hit; any = any || hit; }
          for (const sec of $$('.hp-sec', modal)) sec.hidden = !!q && !$$('[data-q]', sec).some(x => !x.hidden);
          for (const c of $$('.hp-card', modal)) c.hidden = !!q && !$$('[data-q]', c).some(x => !x.hidden);
          $('.hp-none', modal).hidden = any;
        });
        const pb = [...$$('.modal-foot .btn', modal)].find(b => b.textContent === 'พิมพ์ใบคีย์ลัด');
        const pc = pb.cloneNode(true); pb.replaceWith(pc);
        pc.addEventListener('click', printShortcuts);
        if (section != null) setTimeout(() => go(section), 50);
      }
    }).then(r => { if (r?.value === 'word') exportManual(); });
  }
  function printShortcuts() {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปแล้วลองใหม่', 'warn'); return; }
    w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>คีย์ลัด WebMix Pro</title><style>body{font-family:sans-serif;padding:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}td{border:1px solid #bbb;padding:6px 10px;font-size:14px}td:first-child{font-family:monospace;font-weight:700;white-space:nowrap;width:30%}</style></head><body>
      <h1>คีย์ลัด WebMix Pro</h1><table>${SHORTCUTS.map(([k, d]) => `<tr><td>${esc(k)}</td><td>${esc(d)}</td></tr>`).join('')}</table></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
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
      ['monitor', 'แชร์หน้าจอ', 'หน้าจอคอม หน้าต่างโปรแกรม หรือแท็บเบราว์เซอร์', addScreen],
      ['grid', 'ซีน / แบ่งจอ', 'หลายแหล่งภาพในจอเดียว: คู่กัน ภาพซ้อนมุม 3–4 ช่อง', addSceneInput],
      ['restart', 'Instant Replay', 'ย้อนดูช็อตเด็ด 5–20 วินาทีล่าสุด เล่นสโลว์ได้', addReplayInput]]],
    ['ไฟล์', [
      ['film', 'ไฟล์วิดีโอ', 'MP4 / WebM จากเครื่องนี้', () => pickFiles('video/*', addVideoFiles)],
      ['repeat', 'Playlist', 'วิดีโอและรูปหลายไฟล์เล่นต่อกัน', addPlaylist],
      ['image', 'ภาพนิ่ง / โลโก้', 'PNG พื้นโปร่งใสใช้เป็นโลโก้มุมจอได้', () => pickFiles('image/*', addImageFiles)],
      ['type', 'สไลด์ PDF / PowerPoint', 'เปลี่ยนหน้าด้วย ‹ › ปุ่มลูกศร หรือรีโมตพรีเซนต์', () => pickFiles('application/pdf,.pdf', addSlidesFiles)]]],
    ['เชื่อมต่อจากที่อื่น', [
      ['phone', 'กล้องมือถือไร้สาย', 'สแกน QR ด้วยมือถืออีกเครื่อง แล้วใช้เป็นกล้อง', showWirelessDialog],
      ['headphones', 'แขกรับเชิญทางไกล', 'ส่งลิงก์ให้แขก คุยกันได้ทั้งภาพและเสียง', addGuest],
      ['video', 'กล้อง IP (RTSP)', 'กล้องวงจรปิด / PTZ เช่น Hikvision Dahua Tapo Reolink', () => openRtspDialog()],
      ['broadcast', 'รับ RTMP', 'OBS / vMix / แอปมือถือ / โดรน ส่งภาพเข้ามา', openRtmpInputDialog],
      ['broadcast', 'สัญญาณ SRT', 'รับภาพจาก OBS / vMix / encoder', openSrtInputDialog],
      ['monitor', 'NDI® / OMT', 'รับภาพจาก vMix / OBS / กล้อง PTZ ในวง LAN (แอปเดสก์ท็อป)', () => openNetVideoDialog()]]],
    ['กราฟิกและข้อความ', [
      ['type', 'Title กราฟิกข้อความ', 'ป้ายชื่อ/ข้อความบนพื้นโปร่งใส', addTitleInput],
      ['type', 'CG Studio', 'ออกแบบแถบชื่อ ตัววิ่ง ป้าย LIVE และคะแนนในหน้าแยก เชื่อมกับ WebMix แบบสด', addCGInput],
      ['clock', 'นาฬิกานับถอยหลัง / จับเวลา', 'นับถอยหลังก่อนเริ่ม หรือจับเวลาการแข่ง', addTimerInput],
      ['grid', 'ป้ายคะแนน', 'คะแนนสองทีม พร้อมเวลาแข่ง', addScoreInput],
      ['type', 'ตัววิ่งข่าว', 'ข้อความวิ่งด้านล่างจอ', addTickerInput],
      ['sliders', 'Audio Visualizer', 'กราฟิกขยับตามเสียง สำหรับพอดแคสต์ / เพลง / แขกที่ไม่เปิดกล้อง', addVizInput],
      ['type', 'คอมเมนต์ผู้ชม', 'ดึงแชต YouTube / Twitch แล้วเลือกขึ้นจอ', () => addChatInput()],
      ['mic', 'คำบรรยายสด (Captions)', 'แปลงเสียงพูดเป็นตัวหนังสือบนจอแบบเรียลไทม์ ภาษาไทย / อังกฤษ', addCaptionsInput]]],
    ['เสียง (ไม่มีภาพ)', [
      ['music', 'แหล่งเสียง', 'ไมค์ เครื่องเล่นเพลง เสียงเอฟเฟกต์ เสียงจากคอม วิทยุออนไลน์', () => setTimeout(() => openAudioAddMenu($('[data-action=add-audio]')))]]],
    ['ภาพพื้นฐาน', [
      ['type', 'Slate ข้อความ', 'จอข้อความ เช่น “เริ่มเร็ว ๆ นี้”', () => addGenerator('slate')],
      ['clock', 'นาฬิกา', 'เวลาปัจจุบันเต็มจอ', () => addGenerator('clock')],
      ['bars', 'Color Bars', 'แถบสีสำหรับทดสอบภาพ', () => addGenerator('bars')],
      ['square', 'Black', 'จอดำ', () => addGenerator('black')]]]
  ];
  function openAddMenu(anchor, groups = ADD_GROUPS(), title = 'เพิ่มแหล่งภาพ') {
    closeMenu();
    const items = groups.flatMap(g => g[1]);
    let n = 0;
    const menu = document.createElement('div');
    menu.className = 'menu add-sheet';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', title);
    // จอใหญ่: หน้าต่างกลางจอพร้อมช่องค้นหา + ลากไฟล์มาวาง (ตามแบบ) · มือถือ: แผ่นเลื่อนขึ้นจากล่างเหมือนเดิม
    const big = !isPhoneUI() && title === 'เพิ่มแหล่งภาพ';
    menu.innerHTML = (big
      ? `<div class="add-big-head"><b>${esc(title)}</b><label class="add-search">${icon('search')}<input type="search" placeholder="ค้นหา เช่น กล้อง, NDI, สไลด์" aria-label="ค้นหาแหล่งภาพ"></label><span class="add-drop-hint">ลากไฟล์วิดีโอ / รูป / PDF มาวางในหน้าต่างนี้ก็ได้</span><button type="button" class="btn btn-ghost btn-icon add-close" aria-label="ปิด">${icon('x')}</button></div>`
      : `<div class="add-sheet-title">${esc(title)}</div>`) + groups.map(([label, list], gi) => `
      <div class="add-group g${gi % 5}"><div class="menu-label">${esc(label)}</div>
      <div class="add-grid">${list.map(it => `<button role="menuitem" class="add-tile" data-i="${n++}" data-q="${esc((it[1] + ' ' + it[2]).toLowerCase())}">${icon(it[0])}<span><b>${esc(it[1])}</b><small>${esc(it[2])}</small></span></button>`).join('')}</div></div>`).join('')
      + (big ? '<p class="note add-none" hidden>ไม่พบแหล่งภาพที่ค้นหา</p>' : '');
    if (big) {
      menu.classList.add('add-big');
      const scrim = document.createElement('div');
      scrim.className = 'menu add-scrim';
      document.body.appendChild(scrim);
      menu.querySelector('.add-close').addEventListener('click', closeMenu);
      menu.querySelector('.add-search input').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        let any = false;
        for (const t of menu.querySelectorAll('.add-tile')) { const hit = !q || t.dataset.q.includes(q); t.hidden = !hit; any = any || hit; }
        for (const g of menu.querySelectorAll('.add-group')) g.hidden = ![...g.querySelectorAll('.add-tile')].some(t => !t.hidden);
        menu.querySelector('.add-none').hidden = any;
      });
      menu.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); menu.classList.add('is-drop'); } });
      menu.addEventListener('dragleave', e => { if (!menu.contains(e.relatedTarget)) menu.classList.remove('is-drop'); });
      menu.addEventListener('drop', e => { const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return; e.preventDefault(); closeMenu(); audio.ensure(); addDroppedFiles(files); });
    }
    document.body.appendChild(menu);
    // ปุ่มที่ซ่อนอยู่ (เช่น แผงเสียงบนมือถือ) — วางเมนูกลางจอแทน
    let r = anchor.getBoundingClientRect();
    if (!r.width) r = { right: innerWidth / 2 + menu.offsetWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (big) { menu.style.left = `${Math.max(8, (innerWidth - mw) / 2)}px`; menu.style.top = `${Math.max(8, (innerHeight - mh) / 2)}px`; }
    else {
      menu.style.left = `${clamp(r.right - mw, 8, innerWidth - mw - 8)}px`;
      menu.style.top = `${r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
    }
    menu.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      closeMenu();
      audio.ensure();
      items[+b.dataset.i][3]();
    });
    (menu.querySelector('.add-search input') || menu.querySelector('button')).focus({ preventScroll: true });
    setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
  }
  function outsideMenu(e) { if (!e.target.closest('.menu') || e.target.closest('.add-scrim')) closeMenu(); }
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
    setStat('#st-output', `${W}×${H} ${formatTag(Math.min(W, H), settings.fps)} · ${settings.videoKbps} kbps`, 'ok');
    if (streamer.state === 'live') {
      const slow = streamer.ws && streamer.ws.bufferedAmount > 2e6;
      const { live, active, errors } = destCounts();
      const enc = streamer.encoder && streamer.encoder.speed ? ` · ENC ${streamer.encoder.speed.toFixed(2)}x` : '';
      const encSlow = streamer.encoder && streamer.encoder.speed && streamer.encoder.speed < 0.95;
      setStat('#st-stream', `LIVE ${fmtDuration(Date.now() - streamer.start)} · ${streamer.kbps} kbps · ${live}/${active} ปลายทาง${enc}${abr.kbps ? ` · ลดบิตเรต ${abr.kbps}/${settings.videoKbps}` : ''}${slow ? ' · เน็ตช้า' : ''}`, slow || errors || encSlow || abr.kbps ? 'warn' : 'live');
    } else {
      const n = settings.destinations.filter(d => d.enabled).length;
      setStat('#st-stream', streamer.reconnecting ? `RECONNECTING… (ครั้งที่ ${streamer.attempt})` : streamer.state === 'connecting' ? 'CONNECTING…' : gatewayUrl() ? `READY · ${n} ปลายทาง` : 'NOT SET',
        streamer.reconnecting || streamer.state === 'connecting' ? 'warn' : '');
    }
    setStat('#st-rec', rec.active ? `${fmtDuration(Date.now() - rec.start)} · ${fmtBytes(rec.bytes)} → ${rec.sink.kind === 'folder' ? 'โฟลเดอร์ ' + rec.sink.label : rec.sink.label}${iso.list.length ? ` · ISO ${iso.list.length}` : ''}${rec.auto ? ' · สำรองอัตโนมัติ' : ''}` : 'OFF',
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
    if (inp.type === 'replay' && inp.status !== 'live') return inp.rbError ? 'REPLAY · ใช้ไม่ได้' : `REPLAY · พร้อม (${inp.replay.source === 'program' ? 'Program' : byId(inp.replay.source)?.name || '—'})`;
    if (inp.type === 'srt' && inp.status !== 'live') return `${netLabel(inp)} · ${SRT_IN_STATES[inp.srtState] || 'ไม่มีสัญญาณ'}`;
    if (inp.status !== 'live') return 'ไม่มีสัญญาณ';
    if (inp.data && inp.data.error) return 'DATA ERROR';
    if (inp.type === 'title' && inp.data && inp.data.rows && inp.data.rows.length) return `${inp.data.row + 1}/${inp.data.rows.length}`;
    if (inp.type === 'wireless' && inp.cam && inp.status === 'live') {
      const c = inp.cam, st = c.set || {};
      return ['MOBILE', st.height ? `${resTag(st.width, st.height)} ${st.fps}` : '', c.battery ? `🔋${Math.round(c.battery.level * 100)}%` : '', c.rec ? '● REC' : '', c.stats && c.stats.limit && c.stats.limit !== 'none' ? '⚠ เน็ต' : ''].filter(Boolean).join(' · ');
    }
    if (inp.type === 'visualizer') return `VISUALIZER · ${VIZ_STYLES[inp.viz.style]} · ${vizSourceName(inp.viz)}`;
    if (inp.type === 'captions') return `CAPTIONS · ${inp.capRun?.error ? inp.capRun.error : inp.capRun?.on ? 'กำลังฟัง' : 'หยุดอยู่ — กด ▶'}`;
    if (inp.type === 'chat') return `COMMENTS · ${chatFeed.shown && !chatFeed.hideAt ? 'กำลังแสดง' : 'รอเลือกคอมเมนต์'}`;
    if (inp.type === 'slides') return inp.slides.count ? `SLIDES · หน้า ${inp.slides.page}/${inp.slides.count}` : 'SLIDES';
    if (inp.type === 'playlist') return inp.list.items.length ? `${inp.list.index + 1}/${inp.list.items.length}` : 'ว่าง';
    const meta = TYPE_META[inp.type];
    const tag = inp.type === 'srt' ? netLabel(inp) : meta.label;
    const label = inp.name.toUpperCase() === tag ? '' : tag;
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
    macroClock(now);
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
    initSeg('#seg-transition', settings.transition, v => {
      const prev = settings.transition;
      settings.transition = v;
      // เลือก STING ครั้งแรก (ยังไม่มีวิดีโอ) หรือกด STING ซ้ำ = เลือกวิดีโอ/จุดตัด
      if (v === 'stinger' && (prev === 'stinger' || !stinger.ready)) openStingerDialog();
    });
    mediaStore.get('stinger').then(f => { if (f) loadStinger(f); });
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

    bindVcropDrag($('#inputs-grid'));
    $('#inputs-grid').addEventListener('click', onGridClick);
    $('#seg-orient').addEventListener('click', e => { const b = e.target.closest('[data-value]'); if (b) setOrient(b.dataset.value); });
    syncOrientSeg();
    // ลากไฟล์วิดีโอ / รูป / PDF มาวางในแผงแหล่งภาพ
    const srcPanel = $('#inputs-grid').closest('.panel') || $('#inputs-grid');
    srcPanel.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); srcPanel.classList.add('is-drop'); } });
    srcPanel.addEventListener('dragleave', e => { if (!srcPanel.contains(e.relatedTarget)) srcPanel.classList.remove('is-drop'); });
    srcPanel.addEventListener('drop', e => {
      srcPanel.classList.remove('is-drop');
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      addDroppedFiles(files);
    });
    bindMacroPane();

    // มือถือ: แท็บล่าง และปุ่ม "หยุดไลฟ์…" บนแจ้งเตือนของ Android (MainActivity เรียก WebMix.nativeAction)
    setMobileView(['switch', 'audio', 'graphics'].includes(store.get('mview', 'switch')) ? store.get('mview', 'switch') : 'switch');
    transport.init();
    layoutSize.init();
    $('#lufs').addEventListener('click', e => { audio.ensure(); lufs.openMenu(e.currentTarget); });
    // ทอล์กแบ็ก: กดค้างเพื่อพูด
    const talkBtn = $('#btn-talk');
    const talkOff = () => { if (remoteCtl.hostTalking) remoteCtl.hostTalk(false); };
    talkBtn.addEventListener('pointerdown', e => { e.preventDefault(); try { talkBtn.setPointerCapture(e.pointerId); } catch (x) {} remoteCtl.hostTalk(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) talkBtn.addEventListener(ev, talkOff);
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
      'output-window': openOutputWindow, fullscreen: toggleFullscreen, multiview: () => multiview.open(), remote: () => remoteCtl.openDialog(),
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
      if (b.dataset.action === 'add-audio') { openAudioAddMenu(b); return; }
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
      // Macro ที่ตั้งปุ่ม F1–F12 ไว้
      const fm = /^F([1-9]|1[0-2])$/.test(e.key) && macros.find(m => m.key === e.key);
      if (fm) { e.preventDefault(); runMacro(fm); return; }
      // รีโมตพรีเซนต์ (ส่ง Page Up/Down หรือลูกศร) — เปลี่ยนหน้าสไลด์ที่อยู่บน Program (ถ้าไม่มี ใช้ตัวใน Preview)
      const slideKey = { PageDown: 1, ArrowRight: 1, PageUp: -1, ArrowLeft: -1 }[e.key];
      if (slideKey && slideStep(slideKey)) { e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      const map = { ' ': cut, enter: autoTransition, f: toggleFtb, t: actions.title, l: actions.title, p: actions.pip, k: actions.key, m: () => multiview.open(), i: () => replayCapture() };
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

  const SHOW_TYPES = ['bars', 'black', 'slate', 'clock', 'image', 'media', 'camera', 'screen', 'wireless', 'srt', 'title', 'guest', 'timer', 'score', 'ticker', 'cg', 'playlist', 'scene', 'replay', 'slides', 'visualizer', 'chat', 'captions'];
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
          if (i.type === 'media') { o.file = i.fileName || ''; o.loop = !!i.el.loop; if (i.mark) o.mark = { ...i.mark }; }
          if (i.type === 'image') o.file = i.fileName || '';
          if (i.type === 'wireless') o.peerId = i.peerId;
          if (i.type === 'srt') o.srt = { ...i.srt, passphrase: secrets ? i.srt.passphrase : '', pass: secrets ? i.srt.pass || '' : '' };
          if (i.type === 'title') o.title = { ...i.title };
          if (i.type === 'cg') o.cg = { channel: i.cg.channel, design: window.WebMixCG.sanitize(i.cg.design), onAirSceneId: i.cg.onAirSceneId || i.cg.design.activeSceneId };
          // เวลาที่เดินอยู่บันทึกเป็นเวลาที่ผ่านไปแล้ว (เปิดหน้าใหม่แล้วหยุดรอให้กดเริ่ม)
          const freeze = t => ({ ...t, base: (t.base || 0) + (t.running && t.since ? Date.now() - t.since : 0), running: false, since: 0 });
          if (i.type === 'timer') o.timer = freeze(i.timer);
          if (i.type === 'score') o.score = { ...i.score, clock: freeze(i.score.clock) };
          if (i.type === 'ticker') o.ticker = { ...i.ticker, items: [...i.ticker.items] };
          if (i.type === 'playlist') o.list = { items: i.list.items.map(x => ({ key: x.key, name: x.name, kind: x.kind, dur: x.dur || 0 })), index: i.list.index, loop: i.list.loop, imageSec: i.list.imageSec, shuffle: !!i.list.shuffle, endCut: !!i.list.endCut };
          if (i.data) o.data = { url: i.data.url, header: i.data.header, row: i.data.row || 0 };
          if (i.type === 'guest') o.guest = i.guest;
          if (i.type === 'scene') o.scene = { ...i.scene, slots: [...i.scene.slots] };
          if (i.type === 'replay') o.replay = { ...i.replay };
          if (i.type === 'visualizer') o.viz = { ...i.viz };
          if (i.type === 'chat') o.chat = { ...i.chat };
          if (i.type === 'captions') o.cap = { ...i.cap };
          if (i.type === 'slides') o.slides = { page: i.slides.page, file: i.fileName || '' };
          if (i.layout) o.layout = JSON.parse(JSON.stringify(i.layout));
          if (i.color) o.color = { ...i.color };
          if (typeof i.vx === 'number' && i.vx !== 0.5) o.vx = i.vx;
          if (i.bg && i.bg.mode !== 'none') o.bg = { ...i.bg };
          return o;
        }),
        program: state.programId, preview: state.previewId,
        overlays: { pip: overlays.pip.sourceId, key: overlays.key.sourceId },
        // ช่อง Overlay 1–8: Input ที่ผูกไว้และเอฟเฟกต์ (ไม่จำสถานะขึ้นจอ — เปิดหน้าใหม่แล้วไม่มีอะไรขึ้นจอเอง)
        overlayChannels: ovl.map(c => ({ inputId: c.inputId, effect: c.effect, duration: c.duration })),
        macros: macros.map(m => ({ ...m, steps: m.steps.map(st => ({ ...st })) })),
        audio: {
          master: { db: audio.masterStrip.db === -Infinity ? null : audio.masterStrip.db, muted: audio.masterStrip.muted },
          inputs: Object.fromEntries(audio.channels.filter(c => c.inputId).map(c => [c.inputId, chan(c)])),
          mics: audio.channels.filter(c => c.kind === 'mic' && c.micId).map(c => ({ name: c.name, micId: c.micId, label: c.micLabel || '', clean: !!c.clean, channel: c.micChan ?? null, ...chan(c) })),
          // เสียงจากคอม/แท็บไม่บันทึก — เบราว์เซอร์ให้เลือกใหม่ทุกครั้ง
          sources: audio.channels.filter(c => c.srcId && c.src?.save).map(c => ({ kind: c.kind, srcId: c.srcId, name: c.name, cfg: c.src.save(), ...chan(c) }))
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
        if (made && raw.color) made.color = sanitizeColor(raw.color);
        if (made && typeof raw.vx === 'number') made.vx = clamp(raw.vx, 0, 1);
        if (made && raw.bg) made.bg = sanitizeBg(raw.bg);
        if (made && GRAPHIC_TYPES.includes(made.type) && raw.data && /^https?:\/\//i.test(raw.data.url || '')) {
          made.data = { url: String(raw.data.url), header: raw.data.header !== false, row: Math.max(0, +raw.data.row || 0), rows: [], error: '', fetchedAt: 0 };
        }
      }
      macros.splice(0, macros.length, ...sanitizeMacros(data.macros));
      renderMacros();
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
          const micChan = mc.channel === 0 || mc.channel === 1 ? mc.channel : null;
          openMicById(String(mc.micId), String(mc.label || ''), !!mc.clean, micChan != null)
            .then(({ stream, micId }) => audio.addMic(stream, String(mc.name || 'MIC').slice(0, 24), { micId, micLabel: String(mc.label || ''), clean: !!mc.clean, micChan, restore: mc }))
            .catch(() => toast(`เปิดไมค์ “${mc.name}” ไม่ได้ — เพิ่มใหม่จากปุ่ม + ในมิกเซอร์`, 'warn', 6000));
        }
      }
      for (const src of Array.isArray(data.audio?.sources) ? data.audio.sources.slice(0, 16) : []) restoreAudioSource(src);
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
        case 'scene':
          addInput({ type: 'scene', ...base, scene: sanitizeScene(raw.scene) });
          break;
        case 'replay':
          createReplayInput({ ...base, replay: raw.replay });
          break;
        case 'captions':
          addInput({ type: 'captions', ...base, cap: sanitizeCap(raw.cap) });
          break;
        case 'chat':
          addInput({ type: 'chat', ...base, chat: { style: chatLib.CHAT_STYLES[raw.chat?.style] ? raw.chat.style : 'lower' } });
          break;
        case 'visualizer':
          addInput({ type: 'visualizer', ...base, viz: sanitizeViz(raw.viz) });
          break;
        case 'slides': {
          const inp = createSlidesInput({ ...base, fileName: String(raw.slides?.file || '').slice(0, 120), missing: true }, Math.max(1, +raw.slides?.page || 1));
          return mediaStore.get(base.id).then(file => { if (file && !inp.removed) return loadSlides(inp, file, false); });
        }
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
            .map(x => ({ key: x.key, name: String(x.name || '').slice(0, 120), kind: x.kind === 'image' ? 'image' : 'video', dur: clamp(+x.dur || 0, 0, 86400) })).slice(0, 500);
          const inp = playlist.create({ ...base, list: { items, index: clamp(+l.index || 0, 0, Math.max(0, items.length - 1)), loop: l.loop !== false, imageSec: clamp(+l.imageSec || 5, 1, 600), playing: true, shuffle: !!l.shuffle, endCut: !!l.endCut } });
          return playlist.go(inp, inp.list.index);
        }
        case 'ticker': {
          const t = raw.ticker || {};
          addInput({ type: 'ticker', ...base, ticker: { label: String(t.label || '').slice(0, 24), items: (Array.isArray(t.items) ? t.items : []).map(String).slice(0, 100),
            speed: [60, 90, 130, 180].includes(+t.speed) ? +t.speed : 90, color: TITLE_COLORS.includes(t.color) ? t.color : '#ef4444' } });
          break;
        }
        case 'title': {
          addInput({ type: 'title', ...base, title: cleanTitle(raw.title || {}) });
          break;
        }
        case 'cg': {
          const channel = typeof raw.cg?.channel === 'string' && /^[a-z\d]{8,64}$/i.test(raw.cg.channel) ? raw.cg.channel : `${uid()}${uid()}`;
          const design = window.WebMixCG.sanitize(raw.cg?.design);
          const onAirSceneId = design.scenes.some(scene => scene.id === raw.cg?.onAirSceneId) ? raw.cg.onAirSceneId : design.activeSceneId;
          const inp = addInput({ type: 'cg', ...base, status: 'live', cg: { channel, design, onAirSceneId } });
          attachCGBridge(inp);
          break;
        }
        case 'media': case 'image': {
          const inp = raw.type === 'media'
            ? createMediaInput({ ...base, fileName: String(raw.file || ''), loop: raw.loop !== false, mark: sanitizeMark(raw.mark), status: 'nosignal', missing: true })
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
          if (c.mode === 'ndi' || c.mode === 'omt') {
            createSrtInput({ mode: c.mode, source: String(c.source || '').slice(0, 200), port: 0, latency: 500 }, base.name, { id: base.id });
            break;
          }
          if (!['listener', 'caller', 'rtsp', 'rtmp'].includes(c.mode)) return;
          createSrtInput({ mode: c.mode, port: +c.port || (c.mode === 'rtmp' ? 1935 : 9000), url: String(c.url || ''), streamid: String(c.streamid || ''),
            passphrase: String(c.passphrase || ''), latency: SRT_LATENCIES.includes(+c.latency) ? +c.latency : 500,
            user: String(c.user || '').slice(0, 64), pass: String(c.pass || '').slice(0, 128), key: /^[A-Za-z0-9_-]{4,64}$/.test(c.key || '') ? c.key : rtmpKey() }, base.name, { id: base.id });
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
      if (TRANSITIONS.includes(o.transition)) settings.transition = o.transition;
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
      store.set('showLibId', '');
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

  // คลังโชว์ในเครื่อง: เก็บหลายรายการ (ข้อมูลโชว์ + ภาพย่อ) ใน localStorage · ไฟล์วิดีโอ/รูปของทุกโชว์ในคลังไม่ถูกลบตอนเปิดหน้า
  const library = {
    list: () => (Array.isArray(store.get('library', [])) ? store.get('library', []) : []).filter(x => x && typeof x.id === 'string').slice(0, 24),
    data: id => store.get('lib:' + id, null),
    drop(id) { try { localStorage.removeItem('webmix:lib:' + id); } catch (e) {} },
    thumb() {
      try {
        const c = document.createElement('canvas'); c.width = 192; c.height = Math.round(192 * H / W);
        c.getContext('2d').drawImage(pgmCanvas, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.6);
      } catch (e) { return ''; }
    },
    save(asNew) {
      const list = this.list();
      let id = !asNew && store.get('showLibId', '');
      if (!id || !list.some(x => x.id === id)) id = uid();
      const data = show.serialize(false);
      const meta = { id, name: show.name || 'โชว์', savedAt: Date.now(), n: data.inputs.length, ch: (data.audio?.sources || []).length + Object.keys(data.audio?.inputs || {}).length, mac: (data.macros || []).length, thumb: this.thumb() };
      store.set('lib:' + id, data);
      if (!this.data(id)) return null;   // พื้นที่ในเครื่องเต็ม
      const next = [meta, ...list.filter(x => x.id !== id)];
      while (next.length > 24) this.drop(next.pop().id);
      store.set('library', next);
      store.set('showLibId', id);
      return meta;
    },
    remove(id) { this.drop(id); store.set('library', this.list().filter(x => x.id !== id)); if (store.get('showLibId', '') === id) store.set('showLibId', ''); },
    // ทุกสตริงในข้อมูลโชว์ของคลัง (รหัสแหล่งภาพ / ไฟล์ในเพลย์ลิสต์ / เพลง) — ใช้กันไม่ให้ไฟล์ถูกลบ
    keys() {
      const out = new Set();
      const walk = v => { if (typeof v === 'string') { if (v.length < 80) out.add(v); } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); };
      for (const x of this.list()) walk(this.data(x.id));
      return out;
    }
  };
  const agoText = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีก่อน` : m < 1440 ? `${Math.round(m / 60)} ชั่วโมงก่อน` : `${Math.round(m / 1440)} วันก่อน`; };

  function openShowDialog() {
    show.autosave();
    const ago = show.savedAt ? new Date(show.savedAt).toLocaleTimeString('th-TH', { hour12: false }) : '—';
    let sel = '';
    const chs = audio.channels.length;
    dialog({
      title: 'โชว์',
      wide: true,
      body: `
        <p class="note sh-sub">โชว์ = แหล่งภาพ เสียง กราฟิก Macro และการตั้งค่าทั้งหมดของรายการหนึ่ง</p>
        <section class="sh-cur">
          <div class="sh-cur-l"><small>เปิดอยู่</small><label class="sh-name"><input name="showname" class="input" maxlength="60" value="${esc(show.name)}" aria-label="ชื่อโชว์"></label>
            <span class="sh-meta">บันทึกอัตโนมัติ ${ago} · ${inputs.length} แหล่งภาพ · ${chs} ช่องเสียง · ${macros.length} Macro</span></div>
          <div class="sh-cur-r"><button type="button" class="btn btn-primary" data-show="lib-save">บันทึกลงคลัง</button><button type="button" class="btn" data-show="lib-saveas">บันทึกเป็นชื่อใหม่</button></div>
        </section>
        <div class="sh-h"><b>โชว์ที่บันทึกไว้</b><small>ในเครื่องนี้</small><span class="ml-auto"></span>
          <button type="button" class="btn btn-sm" data-show="import">${icon('folder')}นำเข้าไฟล์ .webmix</button>
          <button type="button" class="btn btn-sm" data-show="new">${icon('plus')}เริ่มโชว์ใหม่</button></div>
        <div class="sh-grid"></div>
        <div class="sh-sel" hidden><span>เลือก: <b class="sh-sel-name"></b></span><span class="ml-auto"></span>
          <button type="button" class="btn btn-sm btn-ghost" data-show="lib-del">ลบ</button>
          <button type="button" class="btn btn-sm" data-show="lib-export">ส่งออกไฟล์ (ไม่รวมรหัสสตรีม)</button>
          <button type="button" class="btn btn-sm btn-primary" data-show="lib-open">เปิดโชว์นี้</button></div>
        <div class="show-actions sh-file"><button type="button" class="btn" data-show="export">${icon('download')}บันทึกโชว์นี้เป็นไฟล์</button></div>
        <p class="note">ไฟล์โชว์ (.webmix.json) ใช้ย้ายเครื่อง — ไม่รวมตัวไฟล์วิดีโอ/รูป (เปิดบนเครื่องอื่นแล้วกด 🔗 บนการ์ดเพื่อเลือกไฟล์)
          ${settings.rememberKey ? 'และ<b>มี Stream Key/รหัส SRT อยู่ในไฟล์</b>' : 'และไม่มี Stream Key/รหัส SRT อยู่ในไฟล์'}</p>`,
      actions: [{ label: 'ปิด', primary: true, value: 'close' }],
      onOpen(modal, close) {
        modal.classList.add('sh-modal');
        const nameEl = $('[name="showname"]', modal);
        nameEl.addEventListener('input', () => { show.name = nameEl.value; });
        const cur = store.get('showLibId', '');
        const paint = () => {
          const list = library.list();
          $('.sh-grid', modal).innerHTML = list.length ? list.map(x => `<button type="button" class="sh-card ${x.id === sel ? 'is-sel' : ''}" data-lib="${esc(x.id)}">
              <span class="sh-thumb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ''}${x.id === cur ? '<em>เปิดอยู่</em>' : ''}</span>
              <b>${esc(x.name)}</b><small>แก้ไข${agoText(x.savedAt)} · ${x.n} แหล่งภาพ</small></button>`).join('')
            : '<p class="note">ยังไม่มีโชว์ในคลัง — กด “บันทึกลงคลัง” เพื่อเก็บโชว์นี้ไว้เปิดทีหลัง</p>';
          const it = list.find(x => x.id === sel);
          $('.sh-sel', modal).hidden = !it;
          if (it) $('.sh-sel-name', modal).textContent = it.name;
        };
        paint();
        modal.addEventListener('click', async e => {
          const card = e.target.closest('[data-lib]');
          if (card) { sel = card.dataset.lib; paint(); return; }
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
          else if (act === 'lib-save' || act === 'lib-saveas') {
            if (act === 'lib-saveas') { show.name = (nameEl.value.trim() || 'โชว์') + ' (สำเนา)'; nameEl.value = show.name; }
            const m = library.save(act === 'lib-saveas');
            if (!m) { toast('พื้นที่เก็บในเบราว์เซอร์เต็ม — ลบโชว์เก่าในคลังหรือส่งออกเป็นไฟล์แทน', 'error'); return; }
            sel = m.id; paint();
            toast(`บันทึก “${m.name}” ลงคลังแล้ว`, 'success');
          } else if (act === 'lib-del') {
            const it = library.list().find(x => x.id === sel);
            if (it && await confirmDialog(`ลบ “${it.name}” จากคลัง`, 'ลบเฉพาะในคลังของเครื่องนี้ (โชว์ที่เปิดอยู่ไม่เปลี่ยน)', 'ลบ')) { library.remove(sel); sel = ''; paint(); }
          } else if (act === 'lib-export') {
            const it = library.list().find(x => x.id === sel), data = library.data(sel);
            if (!it || !data) return;
            const safe = it.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'WebMix';
            downloadBlob(new Blob([JSON.stringify({ ...data, savedAt: new Date(it.savedAt).toISOString() }, null, 2)], { type: 'application/json' }), `${safe}.webmix.json`);
          } else if (act === 'lib-open') {
            const it = library.list().find(x => x.id === sel), data = library.data(sel);
            if (!it || !data) { toast('ข้อมูลโชว์นี้หายไปจากเครื่อง', 'error'); return; }
            if (!(await confirmDialog(`เปิดโชว์ “${it.name}”`, show.busyWarning() || 'โชว์ที่เปิดอยู่จะถูกแทนที่ — บันทึกลงคลังก่อนถ้ายังต้องการเก็บไว้', 'เปิดโชว์'))) return;
            store.set('showLibId', it.id);
            close();
            show.apply({ ...data, name: it.name });
          }
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
    if (settings.midi.on) midiEnable();
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
    mediaStore.prune(new Set(['stinger', ...inputs.filter(i => i.type === 'media' || i.type === 'image' || i.type === 'slides').map(i => i.id), ...playlist.keys(), ...audioSourceKeys(), ...library.keys()]));

    bindChatPane();
    $('#sfx-bar').addEventListener('click', e => {
      const ch = padChannel();
      if (!ch) return;
      audio.ensure();
      const b = e.target.closest('[data-pad]');
      if (b) padFire(ch, +b.dataset.pad);
      else if (e.target.closest('.sfx-edit')) openPadDialog(ch);
    });

    wireless.init();
    loadRecFolder();
    recoverRecordings().finally(cleanupOpfs);
    setTimeout(() => { if (!shouldOnboard()) offerLiveResume(); }, 1500);
    tickClock();
    setInterval(tickClock, 1000);
    requestAnimationFrame(rafLoop);
    setTimeout(() => { if (shouldOnboard()) openOnboarding(); }, 700);
    $('#m-gfx').addEventListener('click', quickGfxTap);
    document.documentElement.dataset.cards = cardSize();
    $$('#seg-cardsize button').forEach(b => { b.classList.toggle('is-active', b.dataset.size === cardSize()); b.addEventListener('click', () => setCardSize(b.dataset.size)); });

    // สำหรับดีบัก/ทดสอบอัตโนมัติ
    window.webmix = { chatFeed, chatAdd, chatShow, chatHide, playlist, dataSources, timerControl, multiview, renderer, gpu, setRenderer: v => { settings.renderer = v; renderer.resolve(); updateStatus(); }, show, ovl, setChannel, toggleInputOverlay, useRecFolder: dir => { recFolder = dir; }, inputs, state, settings, overlays, audio, rec, iso, stinger, replayCapture, slideGo, midi, checkAppUpdate, macros, runMacro, openCamControl, abr: { state: abr, decide: abrDecide, apply: abrApply, tick: abrTick }, openDeskSummary, openDeskPreflight, liveStats, streamer, wireless, cut, autoTransition, setPreview, tr, ftb, padFire, chanKey, remote: remoteCtl, lufs, layoutSize, renderInputs, renderAlerts, openOutputWindow, setOrient };
  }

  boot();
})();
