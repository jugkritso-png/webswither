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

    // คุณภาพที่ส่งเข้าสตูดิโอ — กดปุ่ม HD/FHD/4K บนจอเพื่อสลับ (กล้องที่ไม่รองรับจะได้ค่าสูงสุดที่ทำได้)
    const QUALITIES = [
      { label: 'HD', w: 1280, h: 720, bitrate: 2500000 },
      { label: 'FHD', w: 1920, h: 1080, bitrate: 6000000 },
      { label: '4K', w: 3840, h: 2160, bitrate: 16000000 }
    ];
    let quality = QUALITIES[Math.min(2, Math.max(0, +store.get('caller-quality', 1)))] || QUALITIES[1];
    const getCamera = withAudio => navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: quality.w }, height: { ideal: quality.h }, frameRate: { ideal: 30 } },
      audio: withAudio ? { echoCancellation: true, noiseSuppression: true } : false
    });
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
        try { await track.applyConstraints({ width: { ideal: quality.w }, height: { ideal: quality.h }, frameRate: { ideal: 30 } }); }
        catch (e) {}
      }
      await applyBitrate();
      paintQuality();
      const s = track?.getSettings();
      if (s?.width) showMsgBrief(`ส่งภาพ ${s.width}×${s.height}${s.height < quality.h ? ' (กล้องรองรับสูงสุดเท่านี้)' : ''}`);
    }
    let briefTimer = null;
    const showMsgBrief = text => { showMsg(text); clearTimeout(briefTimer); briefTimer = setTimeout(() => showMsg(''), 2500); };

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
      paintQuality();
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
        if (st === 'connected') { setStatus('เชื่อมต่อแล้ว', 'ok'); showMsg(''); applyBitrate(); }
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
      paintQuality();
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
      else if (b.dataset.caller === 'end') stop();
    });

    start();
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
    srtInputs: []
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
    wireless: { icon: 'phone', label: 'MOBILE' },
    srt: { icon: 'broadcast', label: 'SRT' }
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
    const srtWaiting = inp.type === 'srt' && inp.srtState !== 'live';
    ctx.fillStyle = srtWaiting && inp.srtState !== 'error' ? '#f5a524' : '#f87171';
    ctx.font = `800 ${44 * s}px ${FONT}`;
    ctx.fillText(srtWaiting ? (inp.srtState === 'waiting' ? 'WAITING FOR SRT' : inp.srtState === 'connecting' ? 'CONNECTING SRT…' : 'NO SIGNAL') : 'NO SIGNAL', w / 2, h * 0.46);
    ctx.fillStyle = '#8b94a7';
    fitFont(ctx, inp.name, 500, 22 * s, FONT, w * 0.8);
    ctx.fillText(inp.name, w / 2, h * 0.56);
    if (inp.type === 'srt') {
      const hint = inp.srt.mode === 'listener' ? `UDP ${inp.srt.port} · ${inp.srt.latency} ms` : inp.srt.url.replace(/\?.*$/, '');
      ctx.fillStyle = '#5d6578';
      fitFont(ctx, hint, 500, 18 * s, MONO, w * 0.8);
      ctx.fillText(hint, w / 2, h * 0.64);
    }
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

  // คีย์ฉากเขียวด้วย GPU (WebGL) ที่ความละเอียดสูงสุด 1080p จึงคมพอสำหรับงาน 4K และไม่กิน CPU
  const keyer = (() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
      if (!gl) return null;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER,
        'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5);gl_Position=vec4(p,0.0,1.0);}'));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `precision mediump float;
        uniform sampler2D tex;uniform float hard;uniform float soft;uniform float blue;varying vec2 uv;
        void main(){
          vec4 c=texture2D(tex,uv);
          float k=mix(c.g,c.b,blue);
          float o=mix(max(c.r,c.b),max(c.r,c.g),blue);
          float d=k-o;
          float a=1.0;
          if(d>0.0){
            a=1.0-smoothstep(soft,hard,d);
            if(blue>0.5){c.b=o;}else{c.g=o;}
          }
          gl_FragColor=vec4(c.rgb,a);
        }`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const u = name => gl.getUniformLocation(prog, name);
      const uHard = u('hard'), uSoft = u('soft'), uBlue = u('blue');
      return {
        canvas,
        run(src, opts) {
          if (canvas.width !== src.width || canvas.height !== src.height) {
            canvas.width = src.width; canvas.height = src.height;
            gl.viewport(0, 0, src.width, src.height);
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          gl.uniform1f(uHard, opts.tolerance / 255);
          gl.uniform1f(uSoft, opts.tolerance * 0.5 / 255);
          gl.uniform1f(uBlue, opts.color === 'blue' ? 1 : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          return !gl.isContextLost();
        }
      };
    } catch (e) {
      console.warn('WebGL keyer unavailable, using CPU keyer', e);
      return null;
    }
  })();
  const keySrc = document.createElement('canvas');
  const keySrcCtx = keySrc.getContext('2d');

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
        overlays.key.canvas = keyer.canvas;
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
    if (inp.type === 'srt') closeSrtInput(inp);
    audio.removeForInput(id);
    inputs.splice(inputs.indexOf(inp), 1);
    if (inp.type === 'srt') saveSrtInputs();

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
          <option value="3840x2160">3840 × 2160 (4K UHD)</option>
          <option value="2560x1440">2560 × 1440 (QHD)</option>
          <option value="1920x1080" selected>1920 × 1080 (Full HD)</option>
          <option value="1280x720">1280 × 720 (HD)</option>
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
      const got = stream.getVideoTracks()[0].getSettings();
      if (got.width && got.height < rh) toast(`เพิ่มกล้องแล้ว — ได้ภาพ ${got.width}×${got.height} เพราะกล้องรองรับสูงสุดเท่านี้`, 'warn', 6000);
      else toast(`เพิ่มกล้อง “${camLabel}” แล้ว (${got.width || rw}×${got.height || rh})`, 'success');
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
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } }, audio: true });
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
    const u = new URL(settings.gateway.trim());
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
    try { host = new URL(settings.gateway.trim()).hostname; } catch (e) {}
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
        <label class="field"><span>ชื่อ Input</span><input name="name" class="input" maxlength="32" value="SRT ${n}"></label>
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
      actions: [{ label: 'ยกเลิก' }, { label: 'เพิ่ม Input', primary: true, value: 'add' }],
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
      toast(`พอร์ต ${cfg.port} ถูกใช้โดย Input อื่นแล้ว`, 'warn'); return;
    }
    const inp = createSrtInput(cfg, f.name.value.trim() || 'SRT');
    saveSrtInputs();
    if (mode === 'listener') showSrtSenderInfo(inp);
  }

  function createSrtInput(cfg, name) {
    const v = document.createElement('video');
    v.playsInline = true; v.autoplay = true; v.muted = false;
    v.disableRemotePlayback = true;
    pool.appendChild(v);
    const inp = addInput({ type: 'srt', name, el: v, status: 'nosignal', srt: cfg, srtState: 'connecting' });
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
    try { host = new URL(settings.gateway.trim()).hostname; } catch (e) {}
    const url = srtSenderUrl(c);
    dialog({
      title: `ตั้งค่าผู้ส่งสำหรับ “${inp.name}”`,
      body: `
        <p class="modal-text">ใส่ค่าด้านล่างในโปรแกรม/อุปกรณ์ที่จะส่งภาพเข้ามา แล้วกดเริ่มส่ง ภาพจะขึ้นใน Input นี้อัตโนมัติ</p>
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
    const mime = pickMime(purpose);
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

  const streamer = { active: false, state: 'idle', ws: null, recorder: null, sent: 0, kbps: 0, lastBytes: 0, lastAt: 0, start: 0, dests: new Map(), queue: [] };

  // ปุ่ม STREAM เปิดแผงควบคุมปลายทาง — เริ่ม/หยุดแต่ละช่องได้อิสระ หรือเริ่ม/หยุดทั้งหมดพร้อมกัน
  function toggleStream() { openLiveDialog(); }

  function gatewayProblem() {
    const gw = settings.gateway.trim();
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
    if (streamer.ws) {
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
    if (!ws) return;
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
    streamer.ws && streamer.ws.close(1000, 'stopped by user');
  }

  function connectGateway(initial) {
    let r;
    try { r = makeRecorder('stream'); } catch (e) {
      initial.forEach(d => streamer.dests.delete(d.id));
      toast('เริ่มสตรีมไม่ได้: ' + e.message, 'error');
      return;
    }
    const gw = settings.gateway.trim();
    const sep = gw.includes('?') ? '&' : '?';
    const ws = new WebSocket(`${gw}${sep}fps=${settings.fps}&vb=${settings.videoKbps}&res=${H}`);
    Object.assign(streamer, { ws, recorder: r, state: 'connecting', sent: 0, kbps: 0, lastBytes: 0, lastAt: performance.now(), queue: [...initial] });

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', destinations: streamer.queue.map(destPayload) }));
      streamer.queue = [];
      r.ondataavailable = e => {
        if (e.data.size && ws.readyState === WebSocket.OPEN) { ws.send(e.data); streamer.sent += e.data.size; }
      };
      r.start(1000);
      Object.assign(streamer, { active: true, state: 'live', start: Date.now() });
      setStreamButton();
      updateOnAir();
    };
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'status' && msg.encoder) onEncoderStats(msg.encoder);
      if (msg.type === 'status' && Array.isArray(msg.destinations)) onDestStatus(msg.destinations);
    };
    ws.onclose = ev => {
      const byUser = ev.code === 1000;
      const wasLive = streamer.active;
      if (r.state !== 'inactive') r.stop();
      Object.assign(streamer, { active: false, state: 'idle', ws: null, recorder: null, kbps: 0, queue: [], encoder: null });
      streamer.dests.clear();
      setStreamButton();
      refreshLiveDialog();
      updateOnAir();
      output.reset();
      if (byUser) { if (wasLive) toast('หยุดสตรีมแล้ว'); }
      else toast((wasLive ? 'การสตรีมหยุดลง: ' : 'เชื่อมต่อ Stream Gateway ไม่ได้: ') + (ev.reason || 'ตรวจสอบว่า Gateway ทำงานอยู่และ URL ถูกต้อง'), 'error', 7000);
    };
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
    b.querySelector('.label').textContent = on ? `ON AIR ${live}/${active}` : streamer.ws ? 'CONNECTING' : 'STREAM';
  }

  let liveDialog = null, closeLiveDialog = null;
  function openLiveDialog() {
    if (liveDialog) return;
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
            if (await confirmDialog('หยุดสตรีมทั้งหมด', 'ทุกปลายทางจะหยุดออกอากาศทันที', 'หยุดสตรีม')) stopAllStreams();
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

  function refreshLiveDialog() {
    const box = liveDialog && $('.dest-live', liveDialog);
    if (!box) return;
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
    if (stopAll) stopAll.disabled = !streamer.ws;
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
              ${Object.keys(RESOLUTIONS).map(k => `<option value="${k}" ${settings.resolution === k ? 'selected' : ''}>${RES_LABEL[k]}</option>`).join('')}
            </select></label>
            <label class="field"><span>เฟรมเรต</span><select name="fps" class="select" ${live ? 'disabled' : ''}>
              ${FRAME_RATES.map(f => `<option value="${f}" ${+settings.fps === f ? 'selected' : ''}>${f} fps</option>`).join('')}
            </select></label>
          </div>
          <label class="field"><span>บิตเรตวิดีโอ (kbps) — ใช้ทั้งบันทึกและสตรีม</span>
            <input name="videoKbps" class="input" type="number" min="800" max="${MAX_KBPS}" step="100" value="${settings.videoKbps}" ${live ? 'disabled' : ''}></label>
          <p class="note">ค่าแนะนำจะใส่ให้อัตโนมัติเมื่อเปลี่ยนความละเอียด/เฟรมเรต: 720p ≈ 4500 · 1080p ≈ 6000 · 1440p ≈ 13000 · 4K ≈ 25000 kbps (×1.5 สำหรับ 50/60 fps)</p>
          <p class="note warn res-4k-note" ${RESOLUTIONS[settings.resolution][1] >= 1440 ? '' : 'hidden'}>ความละเอียด 1440p/4K ต้องใช้คอมพิวเตอร์แรง (แนะนำ CPU 8 คอร์ขึ้นไปหรือมีการ์ดจอแยก) และอินเทอร์เน็ตขาขึ้นอย่างน้อย 1.5 เท่าของบิตเรต · Stream Gateway ควรมี 8 vCPU ขึ้นไป · Facebook และ Twitch รับสูงสุด 1080p ส่วน YouTube รับได้ถึง 4K</p>
        </div>
        <div class="modal-pane" data-mpane="stream">
          <label class="field"><span>Stream Gateway (WebSocket)</span>
            <input name="gateway" class="input mono" placeholder="wss://gateway.example.com:8080/?token=..." value="${esc(settings.gateway)}"></label>
          <p class="note">เบราว์เซอร์ส่ง RTMP เองไม่ได้ ต้องมี Gateway (โฟลเดอร์ <code>server/</code> ในโปรเจกต์) คอยแปลงสัญญาณ — หน้า HTTPS ต้องใช้ <code>wss://</code> · ภาพถูกส่งขึ้น Gateway ครั้งเดียวแล้วกระจายไปทุกปลายทาง จึงใช้อินเทอร์เน็ตขาขึ้นเท่ากับสตรีมช่องเดียว</p>
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
        const suggest = () => {
          fo.videoKbps.value = recommendedKbps(fo.resolution.value, +fo.fps.value);
          $('.res-4k-note', modal).hidden = RESOLUTIONS[fo.resolution.value][1] < 1440;
        };
        fo.resolution.addEventListener('change', suggest);
        fo.fps.addEventListener('change', suggest);
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
            <div class="dest-srt" ${isSrt(d) ? '' : 'hidden'}>
              <input class="input mono" data-f="passphrase" type="${showKeys.checked ? 'text' : 'password'}" autocomplete="off" value="${esc(d.passphrase)}" placeholder="รหัสผ่านเข้ารหัส SRT (10–64 ตัว, ถ้ามี)" aria-label="SRT passphrase">
              <select class="select" data-f="latency" aria-label="SRT latency" title="SRT latency — ยิ่งสูงยิ่งทนเน็ตกระตุก แต่ดีเลย์มากขึ้น">
                ${SRT_LATENCIES.map(ms => `<option value="${ms}" ${d.latency === ms ? 'selected' : ''}>Latency ${ms} ms</option>`).join('')}
              </select>
            </div>
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
        readDests = () => $$('.dest-row', list).map(row => ({
          id: row.dataset.id,
          enabled: row.querySelector('[data-f=enabled]').checked,
          platform: row.querySelector('[data-f=platform]').value,
          server: row.querySelector('[data-f=server]').value.trim(),
          key: row.querySelector('[data-f=key]').value.trim(),
          passphrase: row.querySelector('[data-f=passphrase]').value,
          latency: +row.querySelector('[data-f=latency]').value || 500
        }));
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
      'สัญญาณ SRT: เพิ่ม Input → “สัญญาณ SRT” เพื่อรับภาพจาก OBS / vMix / encoder ผ่าน Stream Gateway — โหมดรอรับ (ผู้ส่งเชื่อมต่อเข้ามาที่พอร์ต UDP 9000–9009) หรือดึงจาก SRT Server ระบบแสดงค่าที่ต้องใส่ในโปรแกรมผู้ส่งให้ และเชื่อมต่อกลับเองเมื่อสัญญาณหลุด',
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
      'SRT: เลือกแพลตฟอร์ม “SRT” แล้วใส่ srt://host:port, Stream ID, รหัสผ่านเข้ารหัส (ถ้ามี) และ Latency — ใช้ส่งเข้า vMix, OBS, Wowza, Haivision หรือ SRT Server ได้ทนเน็ตกระตุกกว่า RTMP',
      'STREAM ส่งภาพไปหลายปลายทางพร้อมกัน (YouTube / Facebook / Twitch / SRT / RTMP อื่น ๆ สูงสุด 6 ช่อง) ผ่าน Stream Gateway — เพิ่มปลายทางที่ปุ่มตั้งค่า (ไอคอนแถบเลื่อน) แท็บการสตรีม',
      'กดปุ่ม STREAM เพื่อเปิดแผงปลายทาง: กด “เริ่ม” ทีละช่องเพื่อไลฟ์เฉพาะช่องนั้น หรือ “เริ่มทั้งหมด” สำหรับทุกช่องที่ติ๊กไว้ — แต่ละช่องหยุดได้อิสระ ช่องที่หลุดจะเชื่อมต่อใหม่เอง',
      'ความละเอียดสูงสุด 4K (3840×2160) ตั้งได้ที่ปุ่มตั้งค่า → เอาต์พุต ระบบใส่บิตเรตแนะนำให้ · กล้องเลือก 4K ได้ และการ์ด Input แสดงความละเอียดจริง · มือถือแตะปุ่ม HD/FHD/4K เพื่อเลือกคุณภาพ',
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
      ['broadcast', 'สัญญาณ SRT (OBS / vMix / encoder)', openSrtInputDialog],
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
    setStat('#st-output', `${W}×${H} ${formatTag(H, settings.fps)} · ${settings.videoKbps} kbps`, 'ok');
    if (streamer.state === 'live') {
      const slow = streamer.ws && streamer.ws.bufferedAmount > 2e6;
      const { live, active, errors } = destCounts();
      const enc = streamer.encoder && streamer.encoder.speed ? ` · ENC ${streamer.encoder.speed.toFixed(2)}x` : '';
      const encSlow = streamer.encoder && streamer.encoder.speed && streamer.encoder.speed < 0.95;
      setStat('#st-stream', `LIVE ${fmtDuration(Date.now() - streamer.start)} · ${streamer.kbps} kbps · ${live}/${active} ปลายทาง${enc}${slow ? ' · เน็ตช้า' : ''}`, slow || errors || encSlow ? 'warn' : 'live');
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

  function resTag(w, h) {
    const p = Math.min(w, h);
    return p >= 2160 ? '4K' : p >= 1440 ? '1440p' : p >= 1080 ? '1080p' : p >= 720 ? '720p' : `${w}×${h}`;
  }
  function updateCardResolutions() {
    for (const inp of inputs) {
      const card = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
      if (!card) continue;
      if (inp.type === 'srt' && inp.status !== 'live') { card.textContent = `SRT · ${SRT_IN_STATES[inp.srtState] || 'NO SIGNAL'}`; continue; }
      if (inp.status !== 'live') continue;
      const w = inp.el?.videoWidth || inp.el?.naturalWidth, h = inp.el?.videoHeight || inp.el?.naturalHeight;
      const meta = TYPE_META[inp.type];
      const label = inp.name.toUpperCase() === meta.label ? '' : meta.label;
      card.textContent = w && h ? `${label}${label ? ' · ' : ''}${resTag(w, h)}` : label;
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
    $('#st-stream').addEventListener('click', openLiveDialog);

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
    // สร้าง Input SRT ที่ตั้งไว้ครั้งก่อนกลับมา (เชื่อมต่อ Gateway ใหม่ให้อัตโนมัติ)
    if (Array.isArray(settings.srtInputs)) {
      for (const c of settings.srtInputs) {
        if (!c || (c.mode !== 'listener' && c.mode !== 'caller')) continue;
        createSrtInput({ mode: c.mode, port: +c.port || 9000, url: String(c.url || ''), streamid: String(c.streamid || ''),
          passphrase: String(c.passphrase || ''), latency: SRT_LATENCIES.includes(+c.latency) ? +c.latency : 500 }, String(c.name || 'SRT'));
      }
    }
    tickClock();
    setInterval(tickClock, 1000);
    requestAnimationFrame(rafLoop);

    // สำหรับดีบัก/ทดสอบอัตโนมัติ
    window.webmix = { inputs, state, settings, overlays, audio, rec, streamer, wireless, cut, autoTransition, setPreview, tr, ftb };
  }

  boot();
})();
