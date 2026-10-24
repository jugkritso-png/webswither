/* WebMix — ส่วนกลางที่ทุกส่วนใช้ร่วมกัน: ตัวช่วยทั่วไป, localStorage, toast, กันจอดับ, ค่าการเชื่อมต่อ WebRTC */
window.WebMix = window.WebMix || {};
(function (WM) {
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
  // action = { label, run } → ปุ่มในข้อความ (เช่น "เลิกทำ")
  function toast(message, type = 'info', ms = 4200, action = null) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => { action.run(); el.remove(); });
      el.classList.add('has-action');
      el.appendChild(btn);
    }
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

  /* ---------------------------------------------------- WebRTC signaling */
  // ข้อมูลเซิร์ฟเวอร์ที่ฝังในลิงก์/QR กล้องมือถือ (sig): PeerJS ของ Gateway + TURN แบบรหัสชั่วคราว
  // ไม่มี token ของ Gateway อยู่ในลิงก์ — มีแค่รหัส TURN ที่หมดอายุเอง
  const b64url = str => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = str => decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
  function peerOptionsFromSig(sig) {
    const iceServers = [];
    if (sig && sig.th) {
      const tp = sig.tp || 3478;
      iceServers.push({ urls: `stun:${sig.th}:${tp}` });
      if (sig.u) iceServers.push({ urls: [`turn:${sig.th}:${tp}?transport=udp`, `turn:${sig.th}:${tp}?transport=tcp`], username: sig.u, credential: sig.c });
    }
    iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
    // ไม่มี TURN ของ Gateway → ใช้ TURN สาธารณะของ PeerJS สำรอง (คนละเครือข่าย / Wi-Fi ที่กั้นเครื่องในวงเดียวกัน)
    if (!sig || !sig.u) iceServers.push({ urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' });
    const config = { iceServers };
    // สำหรับทดสอบ: บังคับให้ส่งผ่าน TURN เท่านั้น (localStorage webmix:forceRelay = true)
    if (store.get('forceRelay', false)) config.iceTransportPolicy = 'relay';
    if (!sig || !sig.h) return { config };
    return { host: sig.h, port: sig.p, path: sig.pa || '/peerjs', secure: !!sig.s, config };
  }


  Object.assign(WM, { $, $$, clamp, uid, pad2, esc, icon, fmtDuration, fmtBytes, stamp, easeInOut, easeOut, isIOS, FONT, MONO,
    downloadBlob, store, toast, keepScreenOn, b64url, unb64url, peerOptionsFromSig });
})(window.WebMix);
