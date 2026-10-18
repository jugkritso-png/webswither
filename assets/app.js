/* ==========================================================================
   WebMix Pro — Live Production Switcher
   ระบบสลับภาพ/เสียงสำหรับไลฟ์สด ทำงานบนเบราว์เซอร์ทั้งหมด
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ utils */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad2 = n => String(n).padStart(2, '0');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<svg class="i"><use href="#i-${name}"/></svg>`;
  const fmtDuration = ms => {
    const t = Math.max(0, Math.floor(ms / 1000));
    return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
  };
  const fmtBytes = b => b < 1048576 ? `${Math.round(b / 1024)} KB`
    : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  };
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const FONT = 'Inter, "IBM Plex Sans Thai", system-ui, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, monospace';

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  /* ---------------------------------------------------------------- storage */
  const store = {
    get(key, fallback) {
      try { const raw = localStorage.getItem('webmix:' + key); return raw == null ? fallback : JSON.parse(raw); }
      catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem('webmix:' + key, JSON.stringify(value)); } catch (e) {} },
    raw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    setRaw(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
  };

  /* ---------------------------------------------------------------- toasts */
  function toast(message, type = 'info', ms = 4200) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 300); }, ms);
  }

  /* ---------------------------------------------------------- screen wake */
  let wakeLock = null, wantWakeLock = false;
  async function keepScreenOn(on) {
    wantWakeLock = on;
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantWakeLock) keepScreenOn(true);
  });

  /* ====================================================================== */
  /*  PHONE CAMERA MODE (?call=<studio id>)                                  */
  /* ====================================================================== */
  const callTarget = new URLSearchParams(location.search).get('call');
  if (callTarget) {
    initCaller(callTarget);
    return;
  }

  function initCaller(targetId) {
    $('#studio').hidden = true;
    const root = $('#caller');
    root.hidden = false;
    document.title = 'WebMix Camera';

    const video = $('#caller-video');
    const statusEl = $('#caller-status');
    const msgEl = $('#caller-msg');
    let facing = 'environment', stream = null, peer = null, call = null, conn = null;
    let retryTimer = null, stopped = false, micOn = true;

    const setStatus = (text, kind = '') => { statusEl.textContent = text; statusEl.className = `chip ${kind}`; };
    const showMsg = text => { msgEl.textContent = text; msgEl.hidden = !text; };
    const setTally = t => {
      root.classList.toggle('tally-pgm', t === 'pgm');
      root.classList.toggle('tally-pvw', t === 'pvw');
      $('#caller-tally').textContent = t === 'pgm' ? 'ON AIR' : 'PREVIEW';
    };

    const getCamera = withAudio => navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: withAudio ? { echoCancellation: true, noiseSuppression: true } : false
    });

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('ต้องใช้ HTTPS', 'bad');
        showMsg('เบราว์เซอร์อนุญาตให้ใช้กล้องเฉพาะหน้าเว็บที่เปิดผ่าน HTTPS เท่านั้น');
        return;
      }
      try {
        stream = await getCamera(true);
      } catch (e) {
        setStatus('เปิดกล้องไม่ได้', 'bad');
        showMsg('ไม่ได้รับอนุญาตให้ใช้กล้อง/ไมค์: ' + e.message);
        return;
      }
      video.srcObject = stream;
      keepScreenOn(true);
      if (typeof Peer === 'undefined') {
        setStatus('ออฟไลน์', 'bad');
        showMsg('โหลดระบบเชื่อมต่อ (PeerJS) ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
        return;
      }
      peer = new Peer();
      peer.on('open', () => { placeCall(); openData(); });
      peer.on('error', err => {
        if (stopped) return;
        if (err.type === 'peer-unavailable') scheduleRetry('รอสตูดิโอออนไลน์…');
        else setStatus('ผิดพลาด: ' + err.type, 'bad');
      });
      peer.on('disconnected', () => { if (!stopped && !peer.destroyed) peer.reconnect(); });
    }

    function placeCall() {
      if (stopped) return;
      clearTimeout(retryTimer);
      setStatus('กำลังเชื่อมต่อสตูดิโอ…');
      const c = peer.call(targetId, stream);
      call = c;
      c.peerConnection?.addEventListener('connectionstatechange', () => {
        const st = c.peerConnection.connectionState;
        if (st === 'connected') { setStatus('เชื่อมต่อแล้ว', 'ok'); showMsg(''); }
        else if (st === 'failed') c.close();
      });
      c.on('close', () => { if (call === c) scheduleRetry('ขาดการเชื่อมต่อ กำลังลองใหม่…'); });
    }

    function openData() {
      if (stopped || !peer || peer.destroyed) return;
      const d = peer.connect(targetId, { reliable: true });
      conn = d;
      d.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'tally') setTally(msg.tally);
        if (msg.type === 'removed') stop('สตูดิโอนำกล้องนี้ออกจากรายการแล้ว');
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
      video.srcObject = null;
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
      const oldTrack = stream.getVideoTracks()[0];
      const sender = call?.peerConnection?.getSenders().find(s => s.track && s.track.kind === 'video');
      // มือถือหลายรุ่นเปิดกล้องสองตัวพร้อมกันไม่ได้ ต้องปิดตัวเดิมก่อน
      if (oldTrack) { oldTrack.stop(); stream.removeTrack(oldTrack); }
      let track;
      try { track = (await getCamera(false)).getVideoTracks()[0]; }
      catch (e) {
        facing = prev;
        try { track = (await getCamera(false)).getVideoTracks()[0]; }
        catch (e2) { setStatus('สลับกล้องไม่ได้', 'bad'); return; }
      }
      stream.addTrack(track);
      video.srcObject = stream;
      if (sender) await sender.replaceTrack(track);
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
      else if (b.dataset.caller === 'end') stop();
    });

    start();
  }

  /* ====================================================================== */
  /*  STUDIO                                                                 */
  /* ====================================================================== */

  /* --------------------------------------------------------------- settings */
  const PLATFORMS = {
    youtube: { label: 'YouTube Live', server: 'rtmp://a.rtmp.youtube.com/live2' },
    facebook: { label: 'Facebook Live', server: 'rtmps://live-api-s.facebook.com:443/rtmp' },
    twitch: { label: 'Twitch', server: 'rtmp://live.twitch.tv/app' },
    custom: { label: 'RTMP อื่น ๆ (กำหนดเอง)', server: '' }
  };
  const RESOLUTIONS = { '720p': [1280, 720], '1080p': [1920, 1080] };
  const FRAME_RATES = [25, 30, 50, 60];
  const TITLE_COLORS = ['#ef4444', '#f5a524', '#22c55e', '#3b82f6', '#a855f7', '#e5e7eb'];

  const defaults = {
    resolution: '720p', fps: 30, videoKbps: 4500,
    transition: 'mix', duration: 1000,
    gateway: store.raw('webmix-gateway-url') || '',
    destinations: [], rememberKey: false,
    title: { headline: 'BREAKING NEWS', subtitle: 'รายงานสดจากสตูดิโอ WebMix Pro', color: '#ef4444' },
    pip: { position: 'br', size: 0.32 },
    key: { color: 'green', tolerance: 60 }
  };
  const saved = store.get('settings', {}) || {};
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

  // ปลายทางการสตรีม (ส่งพร้อมกันได้หลายช่อง) — ย้ายค่าแบบปลายทางเดียวของเวอร์ชันก่อนมาด้วย
  const MAX_DESTINATIONS = 6;
  const newDest = (platform = 'youtube', server, key = '') => ({
    id: uid(), platform, server: server ?? PLATFORMS[platform].server, key, enabled: true
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
      enabled: d.enabled !== false
    }));
  delete settings.platform; delete settings.server; delete settings.streamKey;

  function saveSettings() {
    const copy = JSON.parse(JSON.stringify(settings));
    if (!settings.rememberKey) copy.destinations.forEach(d => { d.key = ''; });
    store.set('settings', copy);
  }

  const RTMP_RE = /^rtmps?:\/\/\S+$/i;
  const destUrl = d => {
    const server = d.server.trim().replace(/\/+$/, '');
    return d.key.trim() ? `${server}/${d.key.trim()}` : server;
  };
  const destMasked = d => d.server.trim().replace(/\/+$/, '') + (d.key.trim() ? '/••••' + d.key.trim().slice(-4) : '');
  function destLabel(d) {
    if (!d) return '';
    const base = d.platform !== 'custom' ? PLATFORMS[d.platform].label : ((/^rtmps?:\/\/([^/:]+)/i.exec(d.server) || [])[1] || 'RTMP');
    const same = settings.destinations.filter(x => (x.platform !== 'custom' ? PLATFORMS[x.platform].label : ((/^rtmps?:\/\/([^/:]+)/i.exec(x.server) || [])[1] || 'RTMP')) === base);
    return same.length > 1 ? `${base} #${same.indexOf(d) + 1}` : base;
  }
  function destProblem(d) {
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
    $('#pgm-format').textContent = `${H}p${settings.fps}`;
    output.reset();
    ticker.setRate(settings.fps);
  }

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
    wireless: { icon: 'phone', label: 'MOBILE' }
  };
  const LIVE_TYPES = ['camera', 'screen', 'wireless'];

  /* ------------------------------------------------------------- drawing */
  function fillBlack(ctx, w, h) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }

  function drawFit(ctx, src, sw, sh, w, h) {
    if (!sw || !sh) return;
    const s = Math.min(w / sw, h / sh);
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function fitFont(ctx, text, weight, size, family, maxWidth) {
    ctx.font = `${weight} ${size}px ${family}`;
    const m = ctx.measureText(text).width;
    if (m > maxWidth) ctx.font = `${weight} ${Math.floor(size * maxWidth / m)}px ${family}`;
  }

  function drawBars(ctx, w, h) {
    const top = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    const mid = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
    const bw = w / 7, h1 = Math.round(h * 0.67), h2 = Math.round(h * 0.08);
    top.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, h1); });
    mid.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * bw), h1, Math.ceil(bw) + 1, h2); });
    const bottom = [['#00214c', 1.25], ['#ffffff', 1.25], ['#32006a', 1.25], ['#131313', 1.25],
      ['#090909', 1 / 3], ['#131313', 1 / 3], ['#1d1d1d', 1 / 3], ['#131313', 1]];
    let x = 0;
    for (const [c, u] of bottom) {
      ctx.fillStyle = c;
      ctx.fillRect(Math.floor(x), h1 + h2, Math.ceil(u * bw) + 1, h - h1 - h2);
      x += u * bw;
    }
  }

  function drawSlate(ctx, w, h, inp) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b1220'); g.addColorStop(1, '#1b1030');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const s = h / 720;
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 2 * s;
    ctx.strokeRect(w * 0.05, h * 0.07, w * 0.9, h * 0.86);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5a524';
    ctx.font = `800 ${20 * s}px ${FONT}`;
    ctx.fillText('W E B M I X   P R O', w / 2, h * 0.37);
    ctx.fillStyle = '#fff';
    fitFont(ctx, inp.text || ' ', 700, 58 * s, FONT, w * 0.84);
    ctx.fillText(inp.text || '', w / 2, h * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = `500 ${20 * s}px ${MONO}`;
    ctx.fillText(new Date().toLocaleTimeString('th-TH', { hour12: false }), w / 2, h * 0.63);
  }

  function drawClock(ctx, w, h, inp) {
    ctx.fillStyle = '#07080b'; ctx.fillRect(0, 0, w, h);
    const s = h / 720, now = new Date();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8b94a7';
    fitFont(ctx, inp.text || '', 600, 28 * s, FONT, w * 0.8);
    ctx.fillText(inp.text || '', w / 2, h * 0.3);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${150 * s}px ${MONO}`;
    ctx.fillText(`${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`, w / 2, h * 0.5);
    ctx.fillStyle = '#f5a524';
    ctx.font = `500 ${26 * s}px ${FONT}`;
    ctx.fillText(now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), w / 2, h * 0.69);
  }

  function drawNoSignal(ctx, w, h, inp) {
    ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, w, h);
    const s = h / 720;
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 18 * s;
    for (let x = -h; x < w; x += 60 * s) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f87171';
    ctx.font = `800 ${44 * s}px ${FONT}`;
    ctx.fillText('NO SIGNAL', w / 2, h * 0.46);
    ctx.fillStyle = '#8b94a7';
    fitFont(ctx, inp.name, 500, 22 * s, FONT, w * 0.8);
    ctx.fillText(inp.name, w / 2, h * 0.56);
  }

  function drawSource(ctx, inp, w, h) {
    if (!inp) { fillBlack(ctx, w, h); return; }
    ctx.save();
    switch (inp.type) {
      case 'bars': drawBars(ctx, w, h); break;
      case 'black': fillBlack(ctx, w, h); break;
      case 'slate': drawSlate(ctx, w, h, inp); break;
      case 'clock': drawClock(ctx, w, h, inp); break;
      case 'image':
        fillBlack(ctx, w, h);
        drawFit(ctx, inp.el, inp.el.naturalWidth, inp.el.naturalHeight, w, h);
        break;
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
      drawSource(ctx, A, w, h);
      ctx.globalAlpha = p;
      drawSource(ctx, B, w, h);
      ctx.globalAlpha = 1;
    }
  }

  function updateKeyFrame() {
    overlays.key.ready = false;
    if (!overlays.key.on) return;
    const src = byId(overlays.key.sourceId);
    if (!src) return;
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
    overlays.key.ready = true;
  }

  function pipRect(w, h) {
    const s = +settings.pip.size, pw = w * s, ph = h * s, m = w * 0.03;
    const pos = settings.pip.position;
    return { x: pos[1] === 'l' ? m : w - pw - m, y: pos[0] === 't' ? m : h - ph - m, w: pw, h: ph };
  }

  function drawTitle(ctx, w, h, a) {
    const t = settings.title;
    if (!t.headline && !t.subtitle) return;
    const s = h / 720, e = easeOut(a);
    const x = w * 0.06, y = h * 0.735;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `800 ${30 * s}px ${FONT}`;
    const hw = t.headline ? ctx.measureText(t.headline).width + 40 * s : 0;
    ctx.font = `500 ${23 * s}px ${FONT}`;
    const sw = t.subtitle ? ctx.measureText(t.subtitle).width + 40 * s : 0;
    const maxW = w * 0.82;
    const boxW = Math.min(maxW, Math.max(hw, sw));
    ctx.globalAlpha = Math.min(1, a * 1.6);
    ctx.beginPath();
    ctx.rect(x, y - 4 * s, (boxW + 10 * s) * e, 110 * s);
    ctx.clip();
    ctx.fillStyle = t.color;
    ctx.fillRect(x, y, 7 * s, (t.subtitle ? 96 : 52) * s);
    if (t.headline) {
      ctx.fillStyle = t.color;
      ctx.fillRect(x + 7 * s, y, Math.min(hw, maxW), 52 * s);
      ctx.fillStyle = t.color === '#e5e7eb' ? '#0b0d12' : '#fff';
      fitFont(ctx, t.headline, 800, 30 * s, FONT, maxW - 40 * s);
      ctx.fillText(t.headline, x + 27 * s, y + 27 * s);
    }
    if (t.subtitle) {
      const sy = y + (t.headline ? 52 : 0) * s;
      ctx.fillStyle = 'rgba(10,13,20,.9)';
      ctx.fillRect(x + 7 * s, sy, Math.min(sw, maxW), 44 * s);
      ctx.fillStyle = '#e7eaf0';
      fitFont(ctx, t.subtitle, 500, 23 * s, FONT, maxW - 40 * s);
      ctx.fillText(t.subtitle, x + 27 * s, sy + 23 * s);
    }
    ctx.restore();
  }

  function drawOverlays(ctx, w, h) {
    if (overlays.key.on && overlays.key.ready) ctx.drawImage(keyCanvas, 0, 0, w, h);
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
    if (overlays.title.anim > 0) drawTitle(ctx, w, h, overlays.title.anim);
  }

  /* ----------------------------------------------------------- render loop */
  const thumbs = new Map();
  let lastFrame = 0, lastThumbs = 0, frameCount = 0, fps = 0, fpsSince = performance.now(), renderMs = 0;

  function frame(now) {
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
    lastFrame = now;
    const t0 = performance.now();

    stepTransition(now);
    if (ftb.level !== ftb.target) {
      const step = dt / settings.duration;
      ftb.level = ftb.target > ftb.level ? Math.min(ftb.target, ftb.level + step) : Math.max(ftb.target, ftb.level - step);
    }
    const tTarget = overlays.title.on ? 1 : 0;
    if (overlays.title.anim !== tTarget) {
      const step = dt / 450;
      overlays.title.anim = tTarget > overlays.title.anim ? Math.min(1, overlays.title.anim + step) : Math.max(0, overlays.title.anim - step);
    }

    updateKeyFrame();

    drawProgramBase(pgmCtx, W, H);
    drawOverlays(pgmCtx, W, H);
    if (ftb.level > 0) { pgmCtx.fillStyle = `rgba(0,0,0,${ftb.level})`; pgmCtx.fillRect(0, 0, W, H); }

    drawSource(pvwCtx, byId(state.previewId), PW, PH);
    drawOverlays(pvwCtx, PW, PH);

    if (now - lastThumbs > 100) {
      lastThumbs = now;
      for (const inp of inputs) {
        const ctx = thumbs.get(inp.id);
        if (ctx) drawSource(ctx, inp, 256, 144);
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
      card.classList.toggle('is-pgm', isPgm);
      card.classList.toggle('is-pvw', isPvw);
      card.querySelector('.card-tally').textContent = isPgm ? 'PGM' : isPvw ? 'PVW' : '';
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
      card.querySelector('.card-sub').textContent = status === 'live' ? TYPE_META[inp.type].label : 'NO SIGNAL';
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

  function renderInputs() {
    const grid = $('#inputs-grid');
    grid.innerHTML = '';
    thumbs.clear();
    $('#input-count').textContent = inputs.length;
    if (!inputs.length) {
      grid.innerHTML = '<div class="empty-state">ยังไม่มี Input — กด “เพิ่ม Input” เพื่อเพิ่มกล้อง ไฟล์วิดีโอ หรือแหล่งภาพอื่น</div>';
    }
    inputs.forEach((inp, i) => {
      const meta = TYPE_META[inp.type];
      const isMedia = inp.type === 'media';
      const card = document.createElement('div');
      card.className = 'card' + (inp.status !== 'live' ? ' no-signal' : '');
      card.dataset.id = inp.id;
      card.innerHTML = `
        <div class="card-thumb">
          <canvas width="256" height="144"></canvas>
          <span class="card-num">${i + 1}</span>
          <span class="card-tally"></span>
          <div class="card-actions">
            ${isMedia ? `
              <button class="mini" data-card="play" title="เล่น / หยุดชั่วคราว">${icon(inp.el.paused ? 'play' : 'pause')}</button>
              <button class="mini" data-card="restart" title="เล่นใหม่ตั้งแต่ต้น">${icon('restart')}</button>
              <button class="mini ${inp.el.loop ? 'is-on' : ''}" data-card="loop" title="เล่นวนซ้ำ">${icon('repeat')}</button>` : ''}
            <button class="mini" data-card="rename" title="แก้ไขชื่อ / ข้อความ">${icon('edit')}</button>
            <button class="mini danger" data-card="remove" title="ลบ Input">${icon('x')}</button>
          </div>
        </div>
        <div class="card-foot">${icon(meta.icon)}<span class="card-name">${esc(inp.name)}</span><span class="card-sub">${inp.status !== 'live' ? 'NO SIGNAL' : inp.name.toUpperCase() === meta.label ? '' : meta.label}</span></div>`;
      grid.appendChild(card);
      const ctx = card.querySelector('canvas').getContext('2d');
      thumbs.set(inp.id, ctx);
      drawSource(ctx, inp, 256, 144);
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
    const actionBtn = e.target.closest('[data-card]');
    if (actionBtn) {
      const act = actionBtn.dataset.card;
      if (act === 'remove') removeInput(inp.id);
      else if (act === 'rename') renameInput(inp);
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
      onAir ? 'Input นี้กำลังออกอากาศอยู่ใน Program — ภาพจะถูกเปลี่ยนเป็นแหล่งอื่นทันที' : 'ต้องการลบ Input นี้ออกจากรายการหรือไม่',
      'ลบ Input');
    if (!ok || !byId(id)) return;

    inp.stream && inp.stream.getTracks().forEach(t => t.stop());
    if (inp.el && inp.el.tagName === 'VIDEO') {
      inp.el.pause();
      inp.el.srcObject = null;
      inp.el.removeAttribute('src');
      inp.el.load();
      inp.el.remove();
    }
    if (inp.url) URL.revokeObjectURL(inp.url);
    if (inp.peerId) wireless.release(inp.peerId);
    audio.removeForInput(id);
    inputs.splice(inputs.indexOf(inp), 1);

    tr.auto = false; tr.progress = 0; tbar.set(tr.base);
    $('[data-action="auto"]').classList.remove('is-running');
    if (state.programId === id) {
      state.programId = (inputs.find(i => i.type === 'black') || inputs.find(i => i.id !== state.previewId) || inputs[0] || {}).id || null;
    }
    if (state.previewId === id || state.previewId === state.programId) {
      state.previewId = (inputs.find(i => i.id !== state.programId) || {}).id || null;
    }
    for (const name of ['pip', 'key']) {
      if (overlays[name].sourceId === id) {
        overlays[name].sourceId = null;
        if (overlays[name].on) setOverlay(name, false);
      }
    }
    renderInputs();
    refreshSourceSelects();
    toast(`ลบ “${inp.name}” แล้ว`);
  }

  async function renameInput(inp) {
    const hasText = inp.type === 'slate' || inp.type === 'clock';
    const result = await dialog({
      title: 'แก้ไข Input',
      body: `
        <label class="field"><span>ชื่อ Input</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
        ${hasText ? `<label class="field"><span>${inp.type === 'slate' ? 'ข้อความบนจอ' : 'หัวข้อเหนือนาฬิกา'}</span><input name="text" class="input" maxlength="80" value="${esc(inp.text)}"></label>` : ''}`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }]
    });
    if (result?.value !== 'save') return;
    const name = result.form.name.value.trim();
    if (name) inp.name = name;
    if (hasText) inp.text = result.form.text.value.trim();
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

  async function openCameraDialog() {
    if (!needMedia()) return;
    let devices;
    try { devices = await listDevices('videoinput'); } catch (e) { toast(e.message, 'error'); return; }
    const cams = devices.filter(d => d.kind === 'videoinput');
    const mics = devices.filter(d => d.kind === 'audioinput');
    if (!cams.length) { toast('ไม่พบกล้องในเครื่องนี้', 'error'); return; }
    const result = await dialog({
      title: 'เพิ่มกล้อง',
      body: `
        <label class="field"><span>กล้อง / แคปเจอร์การ์ด</span><select name="cam" class="select">
          ${cams.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Camera ' + (i + 1))}</option>`).join('')}
        </select></label>
        <label class="field"><span>ความละเอียด</span><select name="res" class="select">
          <option value="1280x720">1280 × 720 (HD)</option>
          <option value="1920x1080">1920 × 1080 (Full HD)</option>
          <option value="640x480">640 × 480</option>
        </select></label>
        <label class="field"><span>เสียงของ Input นี้</span><select name="mic" class="select">
          <option value="">ไม่ใช้เสียง</option>
          ${mics.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Microphone ' + (i + 1))}</option>`).join('')}
        </select></label>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'เพิ่มกล้อง', primary: true, value: 'add' }]
    });
    if (result?.value !== 'add') return;
    const f = result.form;
    const [rw, rh] = f.res.value.split('x').map(Number);
    const camLabel = f.cam.options[f.cam.selectedIndex].text;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: f.cam.value }, width: { ideal: rw }, height: { ideal: rh }, frameRate: { ideal: 30 } },
        audio: f.mic.value ? { deviceId: { exact: f.mic.value }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
      });
      addStreamInput(stream, { type: 'camera', name: camLabel.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').slice(0, 32) });
      toast(`เพิ่มกล้อง “${camLabel}” แล้ว`, 'success');
    } catch (e) {
      toast('เปิดกล้องไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  async function addScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast('อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับการแชร์หน้าจอ (ใช้ได้บนคอมพิวเตอร์)', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
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

  function addVideoFiles(files) {
    audio.ensure();
    for (const file of files) {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      v.src = url; v.loop = true; v.playsInline = true; v.preload = 'auto';
      pool.appendChild(v);
      const inp = addInput({ type: 'media', name: file.name.replace(/\.[^.]+$/, '').slice(0, 32), el: v, url });
      v.addEventListener('play', () => updateMediaButtons(inp));
      v.addEventListener('pause', () => updateMediaButtons(inp));
      v.addEventListener('error', () => { setInputStatus(inp, 'nosignal'); toast(`เปิดไฟล์ “${file.name}” ไม่ได้ (ฟอร์แมตไม่รองรับ)`, 'error'); });
      audio.addElement(inp, v);
      v.play().catch(() => {});
    }
  }

  function addImageFiles(files) {
    for (const file of files) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => addInput({ type: 'image', name: file.name.replace(/\.[^.]+$/, '').slice(0, 32), el: img, url });
      img.onerror = () => { URL.revokeObjectURL(url); toast(`เปิดรูป “${file.name}” ไม่ได้`, 'error'); };
      img.src = url;
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
      audio.addMic(stream, label.slice(0, 24));
      toast(`เพิ่ม “${label}” แล้ว`, 'success');
    } catch (e) {
      toast('เปิดไมค์ไม่สำเร็จ: ' + e.message, 'error');
    }
  }

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
        : '<option value="">— ไม่มี Input —</option>';
    }
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
    masterStrip: { name: 'MASTER', db: 0, muted: false, level: -90, peak: -90, peakAt: 0, ui: null },
    monitorOn: false,

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = ctx.createGain();
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.dest = ctx.createMediaStreamDestination();
        this.monitor = ctx.createGain();
        this.monitor.gain.value = 0;
        this.master.connect(this.analyser);
        this.master.connect(this.dest);
        this.master.connect(this.monitor);
        this.monitor.connect(ctx.destination);
        this.buf = new Float32Array(1024);
        this.applyMaster();
        ctx.onstatechange = updateStatus;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },

    addChannel(node, opts) {
      const ctx = this.ctx;
      const fader = ctx.createGain(), afv = ctx.createGain(), analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      node.connect(fader);
      fader.connect(afv);
      afv.connect(analyser);
      afv.connect(this.master);
      const ch = { id: uid(), node, fader, afvGain: afv, analyser, db: 0, muted: false, afv: false, level: -90, peak: -90, peakAt: 0, ...opts };
      this.channels.push(ch);
      this.applyGain(ch);
      renderMixer();
      return ch;
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
      ch.node.connect(ch.fader);
    },
    addElement(inp, el) {
      if (!this.ensure()) return;
      try {
        // เสียงจากไฟล์วิดีโอผ่านมิกเซอร์เท่านั้น (ไม่ดังออกลำโพงตรง) จึงปรับ/ปิดเสียงได้จริง
        this.addChannel(this.ctx.createMediaElementSource(el), { name: inp.name, inputId: inp.id, kind: 'input' });
      } catch (e) { console.warn('audio element', e); }
    },
    addMic(stream, name) {
      if (!this.ensure()) return;
      this.addChannel(this.ctx.createMediaStreamSource(stream), { name, kind: 'mic', stream });
    },
    remove(ch) {
      try { ch.node.disconnect(); ch.afvGain.disconnect(); } catch (e) {}
      if (ch.stream) ch.stream.getTracks().forEach(t => t.stop());
      this.channels.splice(this.channels.indexOf(ch), 1);
      renderMixer();
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
    },
    applyAfv() {
      if (!this.ctx) return;
      for (const ch of this.channels) {
        const on = !ch.afv || ch.inputId === state.programId || ((tr.progress > 0 || tr.auto) && ch.inputId === state.previewId);
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
      if (obj.ui) {
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
        ${!isMaster && ch.inputId ? `<button class="chip-btn afv ${ch.afv ? 'is-on' : ''}" title="Audio Follow Video — เปิดเสียงเฉพาะตอนภาพนี้อยู่ใน Program">AFV</button>` : ''}
        ${!isMaster && ch.kind === 'mic' ? '<button class="chip-btn rm" title="ลบช่องเสียงนี้">✕</button>' : ''}
      </div>`;
    ch.ui = { cover: el.querySelector('.meter-cover'), peak: el.querySelector('.meter-peak') };
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
    el.querySelector('.mute').addEventListener('click', e => {
      audio.ensure();
      ch.muted = !ch.muted;
      e.currentTarget.classList.toggle('is-on', ch.muted);
      isMaster ? audio.applyMaster() : audio.applyGain(ch);
    });
    el.querySelector('.afv')?.addEventListener('click', e => {
      ch.afv = !ch.afv;
      e.currentTarget.classList.toggle('is-on', ch.afv);
      audio.applyAfv();
    });
    el.querySelector('.rm')?.addEventListener('click', async () => {
      if (await confirmDialog(`ลบช่องเสียง “${ch.name}”`, 'ไมค์นี้จะถูกปิดและนำออกจากมิกเซอร์', 'ลบ')) audio.remove(ch);
    });
    return el;
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
    peer: null, status: 'offline', link: '', conns: new Map(), blocked: new Set(),

    init() {
      let id = store.raw('webmix-host-id');
      if (!id) { id = 'webmix-' + uid().slice(0, 6); store.setRaw('webmix-host-id', id); }
      this.create(id, 0);
    },
    create(id, attempt) {
      if (typeof Peer === 'undefined') { this.status = 'unavailable'; updateStatus(); return; }
      const peer = new Peer(id);
      this.peer = peer;
      this.status = 'connecting';
      peer.on('open', openId => {
        this.status = 'ready';
        this.link = `${location.origin}${location.pathname}?call=${encodeURIComponent(openId)}`;
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
      call.answer();
      call.on('stream', remote => {
        let inp = inputs.find(i => i.peerId === call.peer);
        if (inp && inp.stream === remote) return;
        if (inp) {
          inp.stream = remote;
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
      const tally = !inp ? 'off' : inp.id === state.programId ? 'pgm' : inp.id === state.previewId ? 'pvw' : 'off';
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
    connectedCount() { return inputs.filter(i => i.type === 'wireless' && i.status === 'live').length; }
  };

  async function showWirelessDialog() {
    const insecure = location.protocol === 'file:' || !window.isSecureContext || (location.protocol !== 'https:' && !/^(localhost|127\.)/.test(location.hostname));
    const ready = wireless.status === 'ready';
    await dialog({
      title: 'เชื่อมต่อกล้องมือถือ',
      body: `
        <p class="modal-text">ใช้มือถือหรือแท็บเล็ตสแกน QR Code แล้วกดอนุญาตให้ใช้กล้อง ภาพและเสียงจะเข้ามาเป็น Input ใหม่อัตโนมัติ (เชื่อมต่อได้หลายเครื่อง)</p>
        ${insecure ? '<p class="note warn">หน้านี้ไม่ได้เปิดผ่าน HTTPS มือถือจะไม่อนุญาตให้ใช้กล้อง — เปิดผ่าน GitHub Pages หรือเว็บเซิร์ฟเวอร์ HTTPS</p>' : ''}
        ${ready ? `
          <div class="qr-box" id="qr-target"></div>
          <div class="link-row"><input class="input" id="wireless-link" readonly value="${esc(wireless.link)}"><button type="button" class="btn btn-icon" id="copy-link" title="คัดลอกลิงก์">${icon('copy')}</button></div>
          <p class="note">ลิงก์นี้ใช้ได้ถาวรสำหรับเบราว์เซอร์เครื่องนี้ · มือถือจะเห็นไฟ Tally สีแดงเมื่อภาพของตัวเองออกอากาศ</p>`
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

  function pickMime() {
    if (!window.MediaRecorder) return null;
    const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
    return list.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function makeRecorder() {
    const mime = pickMime();
    if (mime === null) throw new Error('เบราว์เซอร์นี้ไม่รองรับการบันทึกวิดีโอ (MediaRecorder)');
    const opts = { videoBitsPerSecond: settings.videoKbps * 1000, audioBitsPerSecond: 160000 };
    if (mime) opts.mimeType = mime;
    return new MediaRecorder(output.get(), opts);
  }

  const rec = { active: false, recorder: null, chunks: [], bytes: 0, start: 0 };

  function toggleRecord() {
    if (rec.active) { rec.recorder.stop(); return; }
    let r;
    try { r = makeRecorder(); } catch (e) { toast('เริ่มบันทึกไม่ได้: ' + e.message, 'error'); return; }
    rec.recorder = r; rec.chunks = []; rec.bytes = 0; rec.start = Date.now(); rec.active = true;
    r.ondataavailable = e => { if (e.data.size) { rec.chunks.push(e.data); rec.bytes += e.data.size; } };
    r.onstop = () => {
      const type = r.mimeType || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(new Blob(rec.chunks, { type }), `WebMix-${stamp()}.${ext}`);
      toast(`บันทึกไฟล์ ${fmtBytes(rec.bytes)} แล้ว`, 'success');
      rec.active = false; rec.chunks = [];
      setRecButton();
      updateOnAir();
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

  const streamer = { active: false, state: 'idle', ws: null, recorder: null, sent: 0, kbps: 0, lastBytes: 0, lastAt: 0, start: 0, dests: new Map() };

  // คลิก STREAM ตอนไม่ได้ไลฟ์ = เริ่ม, ตอนไลฟ์อยู่ = เปิดหน้าต่างจัดการปลายทาง (กันกดหยุดพลาด)
  function toggleStream() {
    if (streamer.ws) openLiveDialog();
    else startStream();
  }

  function startStream() {
    const gw = settings.gateway.trim();
    const list = settings.destinations.filter(d => d.enabled);
    let problem = !gw ? 'ยังไม่ได้ตั้งค่า Stream Gateway'
      : !/^wss?:\/\//i.test(gw) ? 'Gateway URL ต้องขึ้นต้นด้วย ws:// หรือ wss://'
      : location.protocol === 'https:' && /^ws:\/\//i.test(gw) ? 'หน้านี้เปิดผ่าน HTTPS จึงต้องใช้ Gateway แบบ wss://'
      : !list.length ? 'ยังไม่ได้เปิดใช้ปลายทางการสตรีม' : '';
    if (!problem) {
      const bad = list.find(d => destProblem(d));
      if (bad) problem = `${destLabel(bad)}: ${destProblem(bad)}`;
    }
    if (problem) { toast(problem, 'warn'); openSettings('stream'); return; }

    let r;
    try { r = makeRecorder(); } catch (e) { toast('เริ่มสตรีมไม่ได้: ' + e.message, 'error'); return; }
    const sep = gw.includes('?') ? '&' : '?';
    const ws = new WebSocket(`${gw}${sep}fps=${settings.fps}&vb=${settings.videoKbps}`);
    Object.assign(streamer, {
      ws, recorder: r, state: 'connecting', sent: 0, kbps: 0, lastBytes: 0, lastAt: performance.now(),
      dests: new Map(list.map(d => [d.id, { state: 'connecting', message: '', kbps: 0 }]))
    });
    setStreamButton();

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', destinations: list.map(d => ({ id: d.id, name: destLabel(d), url: destUrl(d) })) }));
      r.ondataavailable = e => {
        if (e.data.size && ws.readyState === WebSocket.OPEN) { ws.send(e.data); streamer.sent += e.data.size; }
      };
      r.start(1000);
      Object.assign(streamer, { active: true, state: 'live', start: Date.now() });
      setStreamButton();
      updateOnAir();
      toast(`เริ่มสตรีมไป ${list.length} ปลายทาง`, 'success');
    };
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'status' && Array.isArray(msg.destinations)) onDestStatus(msg.destinations);
    };
    ws.onclose = ev => {
      const byUser = ev.code === 1000;
      const wasLive = streamer.active;
      if (r.state !== 'inactive') r.stop();
      Object.assign(streamer, { active: false, state: 'idle', ws: null, recorder: null, kbps: 0 });
      streamer.dests.clear();
      setStreamButton();
      refreshLiveDialog();
      updateOnAir();
      output.reset();
      if (byUser) toast('หยุดสตรีมแล้ว');
      else toast((wasLive ? 'การสตรีมหยุดลง: ' : 'เชื่อมต่อ Stream Gateway ไม่ได้: ') + (ev.reason || 'ตรวจสอบว่า Gateway ทำงานอยู่และ URL ถูกต้อง'), 'error', 7000);
    };
  }

  function onDestStatus(list) {
    for (const st of list) {
      const prev = streamer.dests.get(st.id);
      const label = destLabel(settings.destinations.find(d => d.id === st.id)) || st.name;
      if (prev && prev.state !== st.state) {
        if (st.state === 'live') toast(`${label}: ออกอากาศแล้ว`, 'success', 2500);
        else if (st.state === 'error') toast(`${label}: ${st.message || 'เชื่อมต่อไม่ได้'} — กำลังลองใหม่อัตโนมัติ`, 'error', 6000);
      }
      streamer.dests.set(st.id, { state: st.state, message: st.message || '', kbps: st.kbps || 0 });
    }
    setStreamButton();
    refreshLiveDialog();
    updateStatus();
  }

  function setDestLive(id, on) {
    const ws = streamer.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const d = settings.destinations.find(x => x.id === id);
    if (on) {
      if (!d) return;
      const problem = destProblem(d);
      if (problem) { toast(`${destLabel(d)}: ${problem}`, 'warn'); return; }
      streamer.dests.set(id, { state: 'connecting', message: '', kbps: 0 });
      ws.send(JSON.stringify({ type: 'add', destination: { id, name: destLabel(d), url: destUrl(d) } }));
    } else {
      ws.send(JSON.stringify({ type: 'stop', id }));
    }
    refreshLiveDialog();
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
    b.classList.toggle('is-on', streamer.state === 'live');
    b.classList.toggle('is-pending', streamer.state === 'connecting');
    b.querySelector('.label').textContent = streamer.state === 'live' ? `ON AIR ${live}/${active}`
      : streamer.state === 'connecting' ? 'CONNECTING' : 'STREAM';
  }

  let liveDialog = null;
  function openLiveDialog() {
    if (liveDialog) return;
    dialog({
      title: 'ปลายทางการสตรีม',
      wide: true,
      body: `
        <p class="modal-text">ส่งสัญญาณขึ้น Gateway ครั้งเดียวแล้วกระจายไปทุกปลายทาง — เริ่มหรือหยุดแต่ละช่องได้โดยไม่กระทบช่องอื่น ช่องที่หลุดจะเชื่อมต่อใหม่เอง</p>
        <div class="dest-live"></div>`,
      actions: [{ label: 'แก้ไขปลายทาง', value: 'edit' }, { label: 'หยุดสตรีมทั้งหมด', danger: true, value: 'stop' }, { label: 'ปิด', primary: true }],
      onOpen(modal) {
        liveDialog = modal;
        refreshLiveDialog();
        modal.addEventListener('click', e => {
          const b = e.target.closest('[data-dest-toggle]');
          if (b) setDestLive(b.dataset.destToggle, b.dataset.on === '1');
        });
      }
    }).then(async r => {
      liveDialog = null;
      if (r?.value === 'edit') openSettings('stream');
      else if (r?.value === 'stop' && await confirmDialog('หยุดสตรีมทั้งหมด', 'ทุกปลายทางจะหยุดออกอากาศทันที', 'หยุดสตรีม')) {
        streamer.ws && streamer.ws.close(1000, 'stopped by user');
      }
    });
  }

  function refreshLiveDialog() {
    const box = liveDialog && $('.dest-live', liveDialog);
    if (!box) return;
    if (!streamer.ws) { box.innerHTML = '<p class="note">ไม่ได้สตรีมอยู่ในขณะนี้</p>'; return; }
    const text = { live: 'LIVE', connecting: 'กำลังเชื่อมต่อ…', error: 'หลุด — กำลังลองใหม่', stopped: 'หยุดแล้ว', off: 'ไม่ได้ใช้' };
    box.innerHTML = settings.destinations.map(d => {
      const st = streamer.dests.get(d.id);
      const state = st ? st.state : 'off';
      const running = !!st && state !== 'stopped';
      return `
        <div class="dest-live-row is-${state}">
          <span class="dest-dot"></span>
          <div class="dest-info"><b>${esc(destLabel(d))}</b><small>${esc(state === 'error' && st.message ? st.message : destMasked(d))}</small></div>
          <span class="dest-state">${text[state]}${state === 'live' && st.kbps ? ` · ${st.kbps} kbps` : ''}</span>
          <button type="button" class="btn btn-sm ${running ? '' : 'btn-green'}" data-dest-toggle="${esc(d.id)}" data-on="${running ? 0 : 1}">${running ? 'หยุด' : 'เริ่ม'}</button>
        </div>`;
    }).join('') || '<p class="note">ยังไม่มีปลายทาง — กด “แก้ไขปลายทาง” เพื่อเพิ่ม</p>';
  }

  let onAirSince = null;
  function updateOnAir() {
    const live = rec.active || streamer.active;
    if (live && !onAirSince) onAirSince = Date.now();
    if (!live) onAirSince = null;
    const lamp = $('#tally-lamp');
    lamp.classList.toggle('is-live', live);
    lamp.textContent = live ? 'ON AIR' : 'OFF AIR';
    keepScreenOn(live);
    updateStatus();
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
    const win = window.open('', 'webmix-program-output', 'width=1280,height=720');
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
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
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

  async function confirmDialog(title, text, okLabel = 'ยืนยัน') {
    const r = await dialog({
      title,
      body: `<p class="modal-text">${esc(text)}</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: okLabel, danger: true, value: true }]
    });
    return !!(r && r.value);
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
          <div class="field-row">
            <label class="field"><span>ความละเอียด Program</span><select name="resolution" class="select" ${live ? 'disabled' : ''}>
              <option value="720p" ${settings.resolution === '720p' ? 'selected' : ''}>1280 × 720 (720p)</option>
              <option value="1080p" ${settings.resolution === '1080p' ? 'selected' : ''}>1920 × 1080 (1080p)</option>
            </select></label>
            <label class="field"><span>เฟรมเรต</span><select name="fps" class="select" ${live ? 'disabled' : ''}>
              ${FRAME_RATES.map(f => `<option value="${f}" ${+settings.fps === f ? 'selected' : ''}>${f} fps</option>`).join('')}
            </select></label>
          </div>
          <label class="field"><span>บิตเรตวิดีโอ (kbps) — ใช้ทั้งบันทึกและสตรีม</span>
            <input name="videoKbps" class="input" type="number" min="800" max="12000" step="100" value="${settings.videoKbps}" ${live ? 'disabled' : ''}></label>
          <p class="note">แนะนำ 720p30 ≈ 3000–4500 kbps · 1080p30 ≈ 4500–6000 kbps · 1080p60 ≈ 6000–9000 kbps ความละเอียดสูงใช้ CPU มากขึ้น</p>
        </div>
        <div class="modal-pane" data-mpane="stream">
          <label class="field"><span>Stream Gateway (WebSocket)</span>
            <input name="gateway" class="input mono" placeholder="wss://gateway.example.com:8080/?token=..." value="${esc(settings.gateway)}"></label>
          <p class="note">เบราว์เซอร์ส่ง RTMP เองไม่ได้ ต้องมี Gateway (โฟลเดอร์ <code>server/</code> ในโปรเจกต์) คอยแปลงสัญญาณ — หน้า HTTPS ต้องใช้ <code>wss://</code> · ภาพถูกส่งขึ้น Gateway ครั้งเดียวแล้วกระจายไปทุกปลายทาง จึงใช้อินเทอร์เน็ตขาขึ้นเท่ากับสตรีมช่องเดียว</p>
          ${streamer.ws ? '<p class="note warn">กำลังสตรีมอยู่ — การแก้ไขปลายทางจะมีผลเมื่อหยุดแล้วเริ่มปลายทางนั้นใหม่ (กดปุ่ม STREAM เพื่อจัดการ)</p>' : ''}
          <div class="field">
            <span>ปลายทาง — ติ๊กช่องที่ต้องการสตรีมพร้อมกัน (สูงสุด ${MAX_DESTINATIONS} ช่อง)</span>
            <div class="dest-list"></div>
            <button type="button" class="btn btn-sm dest-add">${icon('plus')}เพิ่มปลายทาง</button>
          </div>
          <div class="dest-options">
            <label class="check"><input type="checkbox" class="dest-showkeys"> แสดง Stream Key</label>
            <label class="check"><input type="checkbox" name="rememberKey" ${settings.rememberKey ? 'checked' : ''}> จำ Stream Key ไว้ในเบราว์เซอร์เครื่องนี้</label>
          </div>
        </div>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
      onOpen(modal) {
        const showTab = name => {
          $$('[data-mtab]', modal).forEach(b => b.classList.toggle('is-active', b.dataset.mtab === name));
          $$('[data-mpane]', modal).forEach(p => p.classList.toggle('is-active', p.dataset.mpane === name));
        };
        $$('[data-mtab]', modal).forEach(b => b.addEventListener('click', () => showTab(b.dataset.mtab)));
        showTab(tab);
        const list = $('.dest-list', modal);
        const addBtn = $('.dest-add', modal);
        const showKeys = $('.dest-showkeys', modal);
        const rowHtml = d => `
          <div class="dest-row ${d.enabled ? '' : 'is-disabled'}" data-id="${esc(d.id)}">
            <label class="dest-enable" title="สตรีมไปปลายทางนี้"><input type="checkbox" data-f="enabled" ${d.enabled ? 'checked' : ''}></label>
            <select class="select" data-f="platform" aria-label="แพลตฟอร์ม">
              ${Object.entries(PLATFORMS).map(([k, p]) => `<option value="${k}" ${d.platform === k ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
            <input class="input mono" data-f="server" value="${esc(d.server)}" placeholder="rtmp://..." aria-label="RTMP Server">
            <input class="input mono" data-f="key" type="${showKeys.checked ? 'text' : 'password'}" autocomplete="off" value="${esc(d.key)}" placeholder="Stream Key" aria-label="Stream Key">
            <button type="button" class="btn btn-ghost btn-icon dest-remove" title="ลบปลายทาง">${icon('x')}</button>
          </div>`;
        const syncAdd = () => { addBtn.disabled = list.children.length >= MAX_DESTINATIONS; };
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
          const rm = e.target.closest('.dest-remove');
          if (rm) { rm.closest('.dest-row').remove(); syncAdd(); }
        });
        list.addEventListener('change', e => {
          const row = e.target.closest('.dest-row');
          if (e.target.dataset.f === 'platform') {
            const p = PLATFORMS[e.target.value];
            const server = row.querySelector('[data-f=server]');
            if (p.server) server.value = p.server; else { server.value = ''; server.focus(); }
          }
          if (e.target.dataset.f === 'enabled') row.classList.toggle('is-disabled', !e.target.checked);
        });
        showKeys.addEventListener('change', () => {
          $$('[data-f=key]', list).forEach(i => { i.type = showKeys.checked ? 'text' : 'password'; });
        });
        readDests = () => $$('.dest-row', list).map(row => ({
          id: row.dataset.id,
          enabled: row.querySelector('[data-f=enabled]').checked,
          platform: row.querySelector('[data-f=platform]').value,
          server: row.querySelector('[data-f=server]').value.trim(),
          key: row.querySelector('[data-f=key]').value.trim()
        }));
      }
    }).then(result => {
      if (result?.value !== 'save') return;
      const f = result.form;
      const before = `${settings.resolution}|${settings.fps}`;
      if (!live) {
        settings.resolution = f.resolution.value;
        settings.fps = +f.fps.value;
        settings.videoKbps = clamp(Math.round(+f.videoKbps.value || 4500), 800, 12000);
      }
      settings.gateway = f.gateway.value.trim();
      if (readDests) settings.destinations = readDests();
      settings.rememberKey = f.rememberKey.checked;
      saveSettings();
      if (before !== `${settings.resolution}|${settings.fps}`) applyResolution();
      updateStatus();
      toast('บันทึกการตั้งค่าแล้ว', 'success');
    });
  }

  /* --------------------------------------------------------------- help */
  const SHORTCUTS = [
    ['Space', 'CUT — ตัดภาพ Preview เข้า Program'],
    ['Enter', 'AUTO — ทรานซิชันอัตโนมัติ'],
    ['1 – 9', 'เลือก Input เข้า Preview'],
    ['Shift + 1 – 9', 'ตัด Input นั้นเข้า Program ทันที'],
    ['F', 'Fade to Black (FTB)'],
    ['T', 'แสดง / ซ่อนป้ายชื่อ (Title)'],
    ['P', 'แสดง / ซ่อนภาพซ้อน (PIP)'],
    ['K', 'เปิด / ปิด Chroma Key'],
    ['Esc', 'ปิดหน้าต่าง / ออกจากเต็มจอ']
  ];
  const MANUAL = [
    ['ภาพรวม', ['จอ PREVIEW (ขอบเขียว) คือภาพถัดไปที่เตรียมไว้ จอ PROGRAM (ขอบแดง) คือภาพที่ออกอากาศ บันทึก และสตรีมจริง',
      'แตะ/คลิก Input เพื่อส่งเข้า Preview แล้วกด CUT หรือ AUTO เพื่อสลับเข้า Program — แตะสองครั้งเพื่อตัดเข้า Program ทันที']],
    ['ทรานซิชัน', ['CUT ตัดภาพทันที · AUTO เปลี่ยนภาพตามเอฟเฟกต์และเวลาที่เลือก (MIX ผสมภาพ, DIP จางผ่านสีดำ, WIPE กวาดภาพ)',
      'T-Bar เลื่อนเพื่อทำทรานซิชันด้วยมือ เลื่อนสุดแล้วภาพจะสลับ และครั้งต่อไปให้เลื่อนกลับอีกทาง เหมือนสวิตเชอร์จริง',
      'FTB จางภาพ Program ทั้งหมดเป็นสีดำ (รวมกราฟิก) กดอีกครั้งเพื่อกลับมา']],
    ['Input', ['เพิ่ม Input: กล้อง/แคปเจอร์การ์ด (เลือกอุปกรณ์ ความละเอียด และเสียงได้), แชร์หน้าจอ, ไฟล์วิดีโอ, ภาพนิ่ง/โลโก้, Color Bars, Slate ข้อความ, นาฬิกา, Black',
      'ไฟล์วิดีโอมีปุ่มเล่น/หยุด เล่นใหม่ และเล่นวนซ้ำ · ปุ่มดินสอใช้แก้ชื่อ (และข้อความของ Slate/นาฬิกา) · ปุ่ม ✕ ลบ Input',
      'ภาพแนวตั้งหรือสัดส่วนอื่นจะถูกย่อให้พอดีจอโดยไม่ยืดภาพ']],
    ['กล้องมือถือไร้สาย', ['กดปุ่ม “กล้องมือถือ” แล้วสแกน QR ด้วยมือถือ (ต้องเปิดเว็บผ่าน HTTPS)',
      'บนมือถือสลับกล้องหน้า/หลัง ปิดไมค์ หรือหยุดส่งภาพได้ และจะเห็นกรอบแดง ON AIR เมื่อภาพของเครื่องนั้นออกอากาศ',
      'ถ้าสัญญาณหลุด มือถือจะเชื่อมต่อกลับเข้าช่องเดิมเอง']],
    ['กราฟิก (TITLE / PIP / KEY)', ['TITLE: ป้ายชื่อ Lower Third พิมพ์ข้อความแล้วเปลี่ยนบนจอได้ทันที เลือกสีป้ายได้ กด TAKE เพื่อแสดง (มีแอนิเมชันเข้า-ออก)',
      'PIP: ภาพซ้อนมุมจอ เลือกแหล่งภาพ ตำแหน่ง และขนาด',
      'KEY: ลบฉากเขียว/ฟ้าของแหล่งภาพที่เลือกแล้ววางทับ Program ปรับความไวด้วย Tolerance']],
    ['เสียง', ['ทุกช่องมีมิเตอร์ระดับเสียงจริง (dBFS) เฟดเดอร์ (ดับเบิลคลิก = 0 dB) และปุ่ม M ปิดเสียง',
      'AFV (Audio Follow Video) เปิดเสียงของช่องนั้นเฉพาะตอนที่ภาพของมันอยู่ใน Program',
      'MON ฟังเสียง Master ผ่านลำโพง/หูฟังของเครื่องนี้ (ปิดไว้เป็นค่าเริ่มต้นเพื่อกันเสียงหอน)']],
    ['บันทึก สตรีม และเอาต์พุต', ['REC บันทึก Program เป็นไฟล์ (WebM หรือ MP4 ตามเบราว์เซอร์) แล้วดาวน์โหลดอัตโนมัติเมื่อกดหยุด',
      'STREAM ส่งภาพไปหลายปลายทางพร้อมกัน (YouTube / Facebook / Twitch / RTMP อื่น ๆ สูงสุด 6 ช่อง) ผ่าน Stream Gateway — เพิ่มปลายทางที่ปุ่มตั้งค่า (ไอคอนแถบเลื่อน) แท็บการสตรีม',
      'ระหว่างไลฟ์ กดปุ่ม STREAM (หรือแถบสถานะ STREAM) เพื่อดูสถานะแต่ละปลายทาง เริ่ม/หยุดทีละช่อง หรือหยุดสตรีมทั้งหมด — ช่องที่หลุดจะเชื่อมต่อใหม่เอง',
      'ปุ่มกล้องบันทึกภาพนิ่ง PNG · ปุ่มหน้าต่างเปิด Program Output แยกสำหรับต่อจอหรือโปรเจกเตอร์ · ปุ่มเต็มจอบนจอ Program',
      'ระบบยังทำงานต่อแม้สลับแท็บ และกันหน้าจอดับระหว่างออกอากาศ']]
  ];

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
  function openAddMenu(anchor) {
    closeMenu();
    const items = [
      ['video', 'กล้อง / แคปเจอร์การ์ด', openCameraDialog],
      ['monitor', 'แชร์หน้าจอ', addScreen],
      ['film', 'ไฟล์วิดีโอ', () => pickFiles('video/*', addVideoFiles)],
      ['image', 'ภาพนิ่ง / โลโก้', () => pickFiles('image/*', addImageFiles)],
      ['phone', 'กล้องมือถือไร้สาย', showWirelessDialog],
      null,
      ['bars', 'Color Bars', () => addGenerator('bars')],
      ['type', 'Slate ข้อความ', () => addGenerator('slate')],
      ['clock', 'นาฬิกา', () => addGenerator('clock')],
      ['square', 'Black', () => addGenerator('black')]
    ];
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div class="menu-label">แหล่งภาพ</div>' + items.map((it, i) => it
      ? `<button role="menuitem" data-i="${i}">${icon(it[0])}${esc(it[1])}</button>`
      : '<div class="menu-sep"></div><div class="menu-label">แหล่งภาพในตัว</div>').join('');
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
      items[+b.dataset.i][2]();
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
    setStat('#st-engine', `${fps ? fps.toFixed(0) : '--'} fps · ${renderMs.toFixed(1)} ms`, fps && fps < settings.fps * 0.8 ? 'warn' : 'ok');
    setStat('#st-output', `${W}×${H}p${settings.fps} · ${settings.videoKbps} kbps`, 'ok');
    if (streamer.state === 'live') {
      const slow = streamer.ws && streamer.ws.bufferedAmount > 2e6;
      const { live, active, errors } = destCounts();
      setStat('#st-stream', `LIVE ${fmtDuration(Date.now() - streamer.start)} · ${streamer.kbps} kbps · ${live}/${active} ปลายทาง${slow ? ' · เน็ตช้า' : ''}`, slow || errors ? 'warn' : 'live');
    } else {
      const n = settings.destinations.filter(d => d.enabled).length;
      setStat('#st-stream', streamer.state === 'connecting' ? 'CONNECTING…' : settings.gateway ? `READY · ${n} ปลายทาง` : 'NOT SET', streamer.state === 'connecting' ? 'warn' : '');
    }
    setStat('#st-rec', rec.active ? `${fmtDuration(Date.now() - rec.start)} · ${fmtBytes(rec.bytes)}` : 'OFF', rec.active ? 'live' : '');
    const ws = wireless.status;
    const count = wireless.connectedCount();
    setStat('#st-wireless',
      ws === 'ready' ? (count ? `${count} CONNECTED` : 'READY') : ws === 'connecting' ? 'CONNECTING…' : ws === 'unavailable' ? 'UNAVAILABLE' : 'OFFLINE',
      ws === 'ready' ? 'ok' : ws === 'connecting' ? 'warn' : 'bad');
    const st = $('#st-audio');
    if (!audio.ctx || audio.ctx.state !== 'running') {
      st.className = 'stat warn';
      st.querySelector('b').innerHTML = '<button class="stat-btn" data-action="audio-on">แตะเพื่อเปิดระบบเสียง</button>';
    } else {
      setStat('#st-audio', `${audio.ctx.sampleRate / 1000} kHz · ${audio.channels.length} CH${audio.monitorOn ? ' · MON' : ''}`, 'ok');
    }
  }

  function tickClock() {
    const now = new Date();
    $('#clock').textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    $('#onair-timer').textContent = onAirSince ? fmtDuration(Date.now() - onAirSince) : '00:00:00';
    if (streamer.state === 'live') {
      const t = performance.now();
      streamer.kbps = Math.round((streamer.sent - streamer.lastBytes) * 8 / (t - streamer.lastAt));
      streamer.lastBytes = streamer.sent; streamer.lastAt = t;
    }
    updateStatus();
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
    head.addEventListener('input', () => { settings.title.headline = head.value; saveSettings(); });
    sub.addEventListener('input', () => { settings.title.subtitle = sub.value; saveSettings(); });
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
    });

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
    $('#st-stream').addEventListener('click', () => (streamer.ws ? openLiveDialog() : openSettings('stream')));

    const actions = {
      cut, auto: autoTransition, ftb: toggleFtb,
      title: () => setOverlay('title', !overlays.title.on),
      pip: () => setOverlay('pip', !overlays.pip.on),
      key: () => setOverlay('key', !overlays.key.on),
      stream: toggleStream, record: toggleRecord, snapshot,
      'output-window': openOutputWindow, fullscreen: toggleFullscreen,
      settings: () => openSettings(), help: openHelp,
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
    document.addEventListener('pointerdown', () => audio.ensure(), { once: true, capture: true });

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
      const map = { ' ': cut, enter: autoTransition, f: toggleFtb, t: actions.title, l: actions.title, p: actions.pip, k: actions.key };
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

  /* ------------------------------------------------------------ boot */
  function boot() {
    initControls();
    ticker.init();
    applyResolution();

    const slate = addGenerator('slate');
    const bars = addGenerator('bars');
    addGenerator('clock');
    addGenerator('black');
    state.programId = slate.id;
    state.previewId = bars.id;
    renderMixer();
    refreshSourceSelects();
    updateTally();

    wireless.init();
    tickClock();
    setInterval(tickClock, 1000);
    requestAnimationFrame(rafLoop);

    // สำหรับดีบัก/ทดสอบอัตโนมัติ
    window.webmix = { inputs, state, settings, overlays, audio, rec, streamer, wireless, cut, autoTransition, setPreview, tr, ftb };
  }

  boot();
})();
