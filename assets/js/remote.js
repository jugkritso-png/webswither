/* WebMix — รีโมตคอนโทรล (?remote=<ID สตูดิโอ>&k=<รหัส>): แท็บเล็ต/มือถือเป็นแผงสั่งงานของสตูดิโอผ่าน PeerJS data channel
   สตูดิโอเป็นผู้ประมวลผลทั้งหมด หน้านี้แค่แสดงสถานะและส่งคำสั่ง (ไม่มีปุ่มเริ่ม/หยุดไลฟ์ — กันกดพลาด) */
(function (WM) {
  'use strict';
  const { $, $$, esc, icon, unb64url, peerOptionsFromSig, keepScreenOn } = WM;

  function initRemote(target) {
    const q = new URLSearchParams(location.search);
    const key = q.get('k') || '';
    let sig = null;
    try { const raw = q.get('sig'); if (raw) sig = JSON.parse(unb64url(raw)); } catch (e) {}
    document.documentElement.classList.add('remote-mode');
    document.title = 'WebMix รีโมต';
    const root = document.createElement('div');
    root.id = 'remote';
    root.innerHTML = `
      <header class="rmt-head"><span class="rmt-dot"></span><b>WebMix รีโมต</b><span class="rmt-status">กำลังเชื่อมต่อ…</span>
        <span class="rmt-badges"></span></header>
      <section class="rmt-mons">
        <figure class="rmt-mon pvw"><img alt=""><figcaption>PREVIEW <span class="rmt-pvw-name"></span></figcaption></figure>
        <figure class="rmt-mon pgm"><img alt=""><figcaption>PROGRAM <span class="rmt-pgm-name"></span></figcaption></figure>
      </section>
      <section class="rmt-take">
        <button class="rmt-btn cut" data-r="cut">CUT</button><button class="rmt-btn auto" data-r="auto">AUTO</button><button class="rmt-btn ftb" data-r="ftb">FTB</button>
        <div class="rmt-trans"></div>
      </section>
      <h3>แหล่งภาพ <small>แตะ = Preview · แตะสองครั้ง = ตัดเข้า Program</small></h3>
      <section class="rmt-inputs"></section>
      <h3>Overlay</h3>
      <section class="rmt-ovl"></section>
      <h3>เสียง</h3>
      <section class="rmt-audio"></section>
      <h3 class="rmt-mac-h">Macro</h3>
      <section class="rmt-macros"></section>
      <section class="rmt-extra"></section>`;
    document.body.appendChild(root);
    keepScreenOn && keepScreenOn(true);

    let peer = null, conn = null, st = null, retry = 0, stopped = false;
    const setStatus = (text, cls) => {
      $('.rmt-status', root).textContent = text;
      root.dataset.conn = cls;
    };
    const send = msg => { if (conn && conn.open) { try { conn.send(msg); } catch (e) {} } };
    const cmd = (c, extra = {}) => send({ type: 'r-cmd', cmd: c, ...extra });

    // ทุกขั้นมีเวลาจำกัด — ค้างที่ไหนก็บอกสาเหตุแล้วลองใหม่เอง (ไม่ค้าง "กำลังเชื่อมต่อ…" ตลอดไป)
    let watchdog = 0;
    const HINT = 'ตรวจว่าเปิด WebMix บนคอมค้างไว้ และทั้งสองเครื่องต่ออินเทอร์เน็ต';
    function connect() {
      if (stopped) return;
      if (typeof Peer === 'undefined') { setStatus('โหลดระบบเชื่อมต่อไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วรีเฟรช', 'bad'); return; }
      if (!peer || peer.destroyed) {
        setStatus('กำลังต่อเซิร์ฟเวอร์…', 'wait');
        peer = new Peer(peerOptionsFromSig(sig));
        const me = peer;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => { if (peer === me && !me.open) { setStatus('ต่อเซิร์ฟเวอร์เชื่อมต่อไม่ได้ — กำลังลองใหม่… (' + HINT + ')', 'wait'); renew(); } }, 15000);
        peer.on('open', openConn);
        peer.on('error', err => {
          if (peer !== me || stopped) return;
          if (err.type === 'peer-unavailable') { clearTimeout(watchdog); setStatus('ไม่พบสตูดิโอ — ' + HINT + ' (ถ้ารีเฟรชหน้าสตูดิโอ ให้สแกน QR ใหม่)', 'wait'); later(); }
          else { setStatus('เชื่อมต่อขัดข้อง (' + err.type + ') — กำลังลองใหม่…', 'wait'); renew(); }
        });
        peer.on('disconnected', () => { if (peer === me && !me.destroyed) setTimeout(() => { if (!me.destroyed && me.disconnected) me.reconnect(); }, 1000); });
      } else if (peer.open) openConn();
    }
    // สร้างการเชื่อมต่อเซิร์ฟเวอร์ใหม่ทั้งหมด
    function renew() {
      clearTimeout(watchdog);
      try { peer && peer.destroy(); } catch (e) {}
      peer = null;
      setTimeout(connect, Math.min(10000, 2000 * ++retry));
    }
    function later() { setTimeout(() => { if (!conn || !conn.open) openConn(); }, Math.min(10000, 2000 * ++retry)); }
    function openConn() {
      if (stopped || !peer || peer.disconnected || peer.destroyed) return;
      setStatus('กำลังเชื่อมต่อสตูดิโอ…', 'wait');
      if (conn && !conn.open) { try { conn.close(); } catch (e) {} }
      const c = peer.connect(target, { metadata: { remote: 1, key }, reliable: true });
      conn = c;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (conn !== c || c.open || stopped) return;
        setStatus('เชื่อมต่อสตูดิโอไม่สำเร็จ — กำลังลองใหม่… (เครือข่ายอาจบล็อก ลองใช้ Wi-Fi เดียวกับคอม)', 'wait');
        try { c.close(); } catch (e) {}
        later();
      }, 15000);
      c.on('open', () => { clearTimeout(watchdog); retry = 0; setStatus('เชื่อมต่อแล้ว', 'ok'); });
      c.on('data', onMsg);
      c.on('error', () => {});
      c.on('close', () => { if (conn !== c || stopped) return; setStatus('การเชื่อมต่อหลุด — กำลังต่อใหม่…', 'wait'); later(); });
    }
    function onMsg(m) {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'r-denied') { stopped = true; clearTimeout(watchdog); setStatus(m.message || 'รหัสรีโมตไม่ถูกต้อง — สแกน QR ใหม่จากสตูดิโอ', 'bad'); try { conn.close(); } catch (e) {} return; }
      if (m.type === 'r-state') { st = m; render(); }
      if (m.type === 'r-lv' && st) meters(m.v);
      if (m.type === 'r-thumbs') {
        if (m.pgm) $('.rmt-mon.pgm img', root).src = m.pgm;
        if (m.pvw) $('.rmt-mon.pvw img', root).src = m.pvw;
      }
    }

    // วาดใหม่เฉพาะส่วนที่เปลี่ยน — กันปุ่มกระพริบ/สไลเดอร์กระโดดระหว่างลาก
    const sig2 = {};
    const part = (name, data, fn) => { const s = JSON.stringify(data); if (sig2[name] === s) return; sig2[name] = s; fn(); };
    function render() {
      const byId = id => st.inputs.find(i => i.id === id);
      $('.rmt-pgm-name', root).textContent = byId(st.pgm)?.name || '—';
      $('.rmt-pvw-name', root).textContent = byId(st.pvw)?.name || '—';
      $('.rmt-badges', root).innerHTML = `${st.live ? '<span class="rmt-badge live">LIVE</span>' : ''}${st.rec ? '<span class="rmt-badge rec">REC</span>' : ''}${st.ftb ? '<span class="rmt-badge ftb">FTB</span>' : ''}`;
      $('[data-r=ftb]', root).classList.toggle('is-on', !!st.ftb);
      part('trans', [st.trans, st.transList], () => {
        $('.rmt-trans', root).innerHTML = st.transList.map(t => `<button data-r="trans" data-v="${esc(t)}" class="${t === st.trans ? 'is-on' : ''}">${esc(t.toUpperCase())}</button>`).join('');
      });
      part('inputs', [st.inputs, st.pgm, st.pvw], () => {
        $('.rmt-inputs', root).innerHTML = st.inputs.map(i => `<button class="rmt-in ${i.id === st.pgm ? 'pgm' : i.id === st.pvw ? 'pvw' : ''} ${i.live ? '' : 'off'}" data-r="in" data-v="${esc(i.id)}"><b>${i.n}</b><span>${esc(i.name)}</span></button>`).join('');
      });
      part('ovl', st.ovl, () => {
        $('.rmt-ovl', root).innerHTML = st.ovl.map((c, i) => `<button class="rmt-ov ${c.on ? 'is-on' : ''} ${c.name ? '' : 'empty'}" data-r="ovl" data-v="${i}"><b>${i + 1}</b><span>${esc(c.name || 'ว่าง')}</span></button>`).join('');
      });
      part('audio', st.audio.map(a => [a.key, a.name, a.muted]), () => {
        $('.rmt-audio', root).innerHTML = st.audio.map(a => `<div class="rmt-ch" data-key="${esc(a.key)}">
          <span class="rmt-ch-name">${esc(a.name)}</span><span class="rmt-meter"><i></i></span>
          <input type="range" min="-60" max="10" step="0.5" value="${a.db ?? -60}" data-r="vol" aria-label="${esc(a.name)} volume">
          <b class="rmt-db mono">${a.db == null ? '-∞' : a.db.toFixed(1)}</b>
          <button class="rmt-mute ${a.muted ? 'is-on' : ''}" data-r="mute" data-v="${esc(a.key)}">M</button></div>`).join('');
      });
      // ค่า dB จากสตูดิโอ — ไม่ทับสไลเดอร์ที่กำลังลากอยู่
      for (const a of st.audio) {
        const row = $(`.rmt-ch[data-key="${CSS.escape(a.key)}"]`, root);
        if (!row) continue;
        const r = $('input', row);
        if (document.activeElement !== r && Date.now() - (+r.dataset.at || 0) > 800) r.value = a.db ?? -60;
        $('.rmt-db', row).textContent = a.db == null ? '-∞' : a.db.toFixed(1);
        $('.rmt-mute', row).classList.toggle('is-on', !!a.muted);
      }
      part('macros', [st.macros, st.runMacro], () => {
        $('.rmt-mac-h', root).hidden = !st.macros.length;
        $('.rmt-macros', root).innerHTML = st.macros.map(m => `<button class="rmt-mac ${m.id === st.runMacro ? 'is-on' : ''}" data-r="macro" data-v="${esc(m.id)}">${esc(m.name)}</button>`).join('');
      });
      part('extra', [st.rec, st.caps], () => {
        $('.rmt-extra', root).innerHTML = `<button class="rmt-btn small ${st.rec ? 'rec is-on' : ''}" data-r="rec">${st.rec ? 'หยุดบันทึก' : 'เริ่มบันทึก'}</button>`
          + st.caps.map(c => `<button class="rmt-btn small ${c.on ? 'is-on' : ''}" data-r="cap" data-v="${esc(c.id)}">${icon('mic')}${esc(c.name)} ${c.on ? 'ON' : 'OFF'}</button>`).join('');
      });
    }
    function meters(v) {
      $$('.rmt-ch', root).forEach((row, i) => {
        const db = v[i] ?? -90;
        $('.rmt-meter i', row).style.width = `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`;
      });
    }

    let lastTap = { id: '', at: 0 };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b || b.tagName === 'INPUT') return;
      const r = b.dataset.r, v = b.dataset.v;
      if (r === 'in') {
        const now = Date.now(), dbl = lastTap.id === v && now - lastTap.at < 400;
        lastTap = dbl ? { id: '', at: 0 } : { id: v, at: now };
        cmd(dbl ? 'take' : 'pvw', { id: v });
      } else if (r === 'ovl' || r === 'macro' || r === 'cap' || r === 'mute' || r === 'trans') cmd(r, { v });
      else cmd(r);
      if (navigator.vibrate) navigator.vibrate(15);
    });
    root.addEventListener('input', e => {
      if (e.target.dataset.r !== 'vol') return;
      const row = e.target.closest('.rmt-ch');
      e.target.dataset.at = Date.now();
      $('.rmt-db', row).textContent = (+e.target.value).toFixed(1);
      cmd('vol', { v: row.dataset.key, db: +e.target.value });
    });
    connect();
  }

  WM.initRemote = initRemote;
})(window.WebMix);
