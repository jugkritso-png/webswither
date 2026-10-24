/* WebMix — รีโมต / ทีมงาน (?remote=<ID เครื่องหลัก>&role=<ตำแหน่ง>): แท็บเล็ต/มือถือ/คอมของทีมงานแต่ละตำแหน่ง ต่อกับเครื่องหลักผ่าน PeerJS data channel
   จับคู่ครั้งแรกด้วยรหัส 6 หลักที่แสดงบนเครื่องหลัก → ได้ token เก็บไว้ในเครื่องนี้ (ต่อใหม่ไม่ต้องใส่รหัสอีก)
   เครื่องหลักประมวลผลทั้งหมดและตรวจสิทธิ์ตามตำแหน่ง หน้านี้แค่แสดงสถานะและส่งคำสั่ง (ไม่มีปุ่มเริ่ม/หยุดไลฟ์ — กันกดพลาด) */
(function (WM) {
  'use strict';
  const { $, $$, esc, icon, unb64url, peerOptionsFromSig, keepScreenOn, store } = WM;

  // ตำแหน่งงาน — ใช้ทั้งหน้ารีโมตและหน้าต่าง “รีโมต / ทีมงาน” บนเครื่องหลัก
  const ROLES = {
    switcher: { label: 'สวิตเชอร์', desc: 'Multiview · ตัดภาพ · ทรานซิชัน' },
    sound: { label: 'ควบคุมเสียง', desc: 'เฟดเดอร์ · ปิดเสียง · เสียงเอฟเฟกต์ · เพลง' },
    cg: { label: 'กราฟิก CG', desc: 'Title · ตัววิ่ง · สกอร์ · Overlay' },
    insert: { label: 'อินเสิร์ต', desc: 'คลิปวิดีโอ · Playlist · สไลด์ · รีเพลย์' },
    camera: { label: 'ตากล้อง (Tally)', desc: 'ไฟ Tally เต็มจอ · ภาพกล้องตัวเอง' },
    monitor: { label: 'มอนิเตอร์', desc: 'ดูภาพ/เสียงอย่างเดียว' },
    director: { label: 'ผู้กำกับ', desc: 'ควบคุมได้ทุกอย่าง' }
  };
  const SECTIONS = {
    director: ['mons', 'take', 'mv', 'ovl', 'gfx', 'ins', 'audio', 'fx', 'macros', 'extra'],
    switcher: ['mons', 'take', 'mv'],
    sound: ['mons', 'audio', 'fx'],
    cg: ['mons', 'ovl', 'gfx'],
    insert: ['mons', 'ins', 'mv'],
    camera: ['tally'],
    monitor: ['mons', 'mv', 'audio']
  };
  const GFX = ['title', 'ticker', 'score', 'timer', 'chat', 'captions', 'visualizer'];
  const INS = ['media', 'playlist', 'slides', 'replay'];

  function initRemote(target) {
    const q = new URLSearchParams(location.search);
    let sig = null;
    try { const raw = q.get('sig'); if (raw) sig = JSON.parse(unb64url(raw)); } catch (e) {}
    const memKey = 'rmt:' + target;
    const mem = store.get(memKey, {}) || {};
    let dev = store.get('rmtDev', '');
    if (!dev) { dev = 'd' + Math.random().toString(36).slice(2, 12); store.set('rmtDev', dev); }
    let role = ROLES[q.get('role')] ? q.get('role') : mem.role || 'switcher';
    let pin = '';

    document.documentElement.classList.add('remote-mode');
    document.title = 'WebMix รีโมต';
    const root = document.createElement('div');
    root.id = 'remote';
    root.innerHTML = `
      <header class="rmt-head"><span class="rmt-dot"></span><b>WebMix</b><span class="rmt-role"></span><span class="rmt-status">กำลังเชื่อมต่อ…</span>
        <span class="rmt-badges"></span><button class="rmt-teambtn" data-r="team" aria-label="ทีมงานและข้อความ">${icon('users')}<i class="rmt-unread" hidden></i></button></header>
      <form class="rmt-pair" hidden>
        <h2>จับคู่กับเครื่องหลัก</h2>
        <p class="rmt-pair-msg note">ใส่รหัสจับคู่ 6 หลักที่แสดงบนเครื่องหลัก (ปุ่ม “รีโมต” ด้านบนของเครื่องหลัก)</p>
        <label class="field"><span>ชื่อของคุณ</span><input name="name" class="input" maxlength="30" autocomplete="name" required></label>
        <label class="field"><span>ตำแหน่ง</span><select name="role" class="select">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v.label)} — ${esc(v.desc)}</option>`).join('')}</select></label>
        <label class="field"><span>รหัสจับคู่</span><input name="pin" class="input mono rmt-pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
        <button class="btn btn-primary rmt-pair-go" type="submit">เข้าร่วมทีม</button>
      </form>
      <aside class="rmt-team" hidden>
        <div class="rmt-members"></div>
        <div class="rmt-msgs"></div>
        <div class="rmt-send"><input class="input" maxlength="200" placeholder="ข้อความถึงทีม"><button class="btn" data-r="send">ส่ง</button></div>
        <div class="rmt-quick">${['พร้อม', 'รอสักครู่', 'ตัดได้', 'มีปัญหา'].map(t => `<button data-r="quick" data-v="${t}">${t}</button>`).join('')}</div>
      </aside>
      <div class="rmt-body">
        <section data-sec="tally" class="rmt-tally">
          <label class="rmt-tally-pick"><span>กล้องของฉัน</span><select class="select"></select></label>
          <div class="rmt-tally-box">
            <b class="rmt-tally-state">STANDBY</b>
            <span class="rmt-tally-name"></span>
            <img class="rmt-tally-img" alt="">
            <small class="rmt-tally-pgm"></small>
          </div>
          <button class="rmt-btn small rmt-tally-fs" data-r="fs">เต็มจอ</button>
        </section>
        <section data-sec="mons" class="rmt-mons">
          <figure class="rmt-mon pvw"><img alt=""><figcaption>PREVIEW <span class="rmt-pvw-name"></span></figcaption></figure>
          <figure class="rmt-mon pgm"><img alt=""><figcaption>PROGRAM <span class="rmt-pgm-name"></span> <em class="rmt-oa mono"></em> <em class="rmt-rem mono"></em></figcaption></figure>
        </section>
        <section data-sec="take" class="rmt-take">
          <button class="rmt-btn cut" data-r="cut">CUT</button><button class="rmt-btn auto" data-r="auto">AUTO</button><button class="rmt-btn ftb" data-r="ftb">FTB</button>
          <div class="rmt-trans"></div>
        </section>
        <h3 data-sec="mv">Multiview <small class="rmt-mv-hint"></small></h3>
        <section data-sec="mv" class="rmt-inputs"></section>
        <h3 data-sec="ovl">Overlay</h3>
        <section data-sec="ovl" class="rmt-ovl"></section>
        <h3 data-sec="gfx">กราฟิก <small>แก้ข้อความแล้วกด “อัปเดต” · ขึ้นจอ = ซ้อนบน Program</small></h3>
        <section data-sec="gfx" class="rmt-gfx"></section>
        <h3 data-sec="ins">อินเสิร์ต</h3>
        <section data-sec="ins" class="rmt-ins"></section>
        <h3 data-sec="audio">เสียง</h3>
        <section data-sec="audio" class="rmt-audio"></section>
        <h3 data-sec="fx">เสียงเอฟเฟกต์ / เพลง</h3>
        <section data-sec="fx" class="rmt-fx"></section>
        <h3 data-sec="macros" class="rmt-mac-h">Macro</h3>
        <section data-sec="macros" class="rmt-macros"></section>
        <section data-sec="extra" class="rmt-extra"></section>
      </div>`;
    document.body.appendChild(root);
    keepScreenOn && keepScreenOn(true);
    const form = $('.rmt-pair', root);

    let peer = null, conn = null, st = null, retry = 0, stopped = false, unread = 0, team = [], msgs = [];
    const setStatus = (text, cls) => {
      $('.rmt-status', root).textContent = text;
      root.dataset.conn = cls;
    };
    const send = msg => { if (conn && conn.open) { try { conn.send(msg); } catch (e) {} } };
    const cmd = (c, extra = {}) => send({ type: 'r-cmd', cmd: c, ...extra });
    const readOnly = () => role === 'monitor';

    function applyRole() {
      root.dataset.role = role;
      $('.rmt-role', root).textContent = ROLES[role].label + (mem.name ? ` · ${mem.name}` : '');
      const show = SECTIONS[role];
      $$('[data-sec]', root).forEach(el => { el.hidden = !show.includes(el.dataset.sec); });
      $('.rmt-mv-hint', root).textContent = role === 'switcher' || role === 'director' ? 'แตะ = Preview · แตะสองครั้ง = ตัดเข้า Program' : role === 'insert' ? 'แตะคลิป = ส่งเข้า Preview ให้สวิตเชอร์' : '';
      for (const k in sig2) delete sig2[k];
      if (st) render();
    }
    function showPair(message) {
      form.hidden = false;
      $('.rmt-body', root).hidden = true;
      form.name.value = mem.name || '';
      form.role.value = role;
      form.pin.value = '';
      if (message) $('.rmt-pair-msg', root).textContent = message;
      setStatus('ยังไม่ได้จับคู่', 'bad');
      setTimeout(() => (form.name.value ? form.pin : form.name).focus(), 50);
    }
    form.addEventListener('submit', e => {
      e.preventDefault();
      const p = form.pin.value.replace(/\D/g, '');
      if (p.length !== 6) { $('.rmt-pair-msg', root).textContent = 'รหัสจับคู่มี 6 หลัก'; return; }
      mem.name = form.name.value.trim().slice(0, 30);
      role = form.role.value;
      store.set(memKey, { ...mem, role });
      pin = p;
      form.hidden = true;
      $('.rmt-body', root).hidden = false;
      stopped = false; retry = 0;
      if (conn) { try { conn.close(); } catch (e2) {} conn = null; }
      connect();
    });

    // ทุกขั้นมีเวลาจำกัด — ค้างที่ไหนก็บอกสาเหตุแล้วลองใหม่เอง (ไม่ค้าง "กำลังเชื่อมต่อ…" ตลอดไป)
    let watchdog = 0;
    const HINT = 'ตรวจว่าเปิด WebMix บนเครื่องหลักค้างไว้ และทั้งสองเครื่องต่ออินเทอร์เน็ต';
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
          if (err.type === 'peer-unavailable') { clearTimeout(watchdog); setStatus('ไม่พบเครื่องหลัก — ' + HINT + ' (ถ้ารีเฟรชหน้าเครื่องหลัก ให้สแกน QR ใหม่)', 'wait'); later(); }
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
    function later() { setTimeout(() => { if (!stopped && (!conn || !conn.open)) openConn(); }, Math.min(10000, 2000 * ++retry)); }
    function openConn() {
      if (stopped || !peer || peer.disconnected || peer.destroyed) return;
      setStatus('กำลังเชื่อมต่อเครื่องหลัก…', 'wait');
      if (conn && !conn.open) { try { conn.close(); } catch (e) {} }
      const c = peer.connect(target, { metadata: { remote: 2, dev, token: mem.token || '', pin, name: mem.name || '', role }, reliable: true });
      conn = c;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (conn !== c || c.open || stopped) return;
        setStatus('เชื่อมต่อเครื่องหลักไม่สำเร็จ — กำลังลองใหม่… (เครือข่ายอาจบล็อก ลองใช้ Wi-Fi เดียวกับเครื่องหลัก)', 'wait');
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
      if (m.type === 'r-denied') {
        stopped = true; clearTimeout(watchdog);
        try { conn.close(); } catch (e) {}
        if (m.code === 'revoked' || m.code === 'pin' || m.code === 'pair' || m.code === 'locked') {
          delete mem.token; store.set(memKey, mem); pin = '';
          showPair(m.message || undefined);
        } else setStatus(m.message || 'เครื่องหลักปฏิเสธการเชื่อมต่อ', 'bad');
        return;
      }
      if (m.type === 'r-paired') { mem.token = m.token; pin = ''; store.set(memKey, { ...mem, role }); return; }
      if (m.type === 'r-hello' || m.type === 'r-role') {
        if (m.name) mem.name = m.name;
        role = ROLES[m.role] ? m.role : 'monitor';
        store.set(memKey, { ...mem, role });
        if (m.msgs) { msgs = m.msgs; renderTeam(); }
        if (m.type === 'r-role') toast(`เครื่องหลักเปลี่ยนตำแหน่งของคุณเป็น “${ROLES[role].label}”`);
        applyRole();
        return;
      }
      if (m.type === 'r-team') { team = m.members || []; renderTeam(); return; }
      if (m.type === 'r-msg') {
        msgs = msgs.concat(m).slice(-50);
        renderTeam();
        if ($('.rmt-team', root).hidden) { unread++; $('.rmt-unread', root).hidden = false; toast(`💬 ${m.from}: ${m.text}`); }
        if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
        return;
      }
      if (m.type === 'r-state') { st = m; render(); }
      if (m.type === 'r-lv' && st) {
        meters(m.v);
        $('.rmt-oa', root).textContent = m.oa ? fmt(m.oa) : '';
        // เวลาที่เหลือของคลิปบน Program — เหลือง ≤15 วิ · แดง ≤5 วิ
        const rem = $('.rmt-rem', root);
        rem.textContent = m.rem == null ? '' : `เหลือ -${fmt(m.rem * 1000 + 999)}`;
        rem.dataset.level = m.rem == null ? '' : m.rem <= 5 ? 'crit' : m.rem <= 15 ? 'warn' : '';
      }
      if (m.type === 'r-thumbs') {
        if (m.pgm) $('.rmt-mon.pgm img', root).src = m.pgm;
        if (m.pvw) $('.rmt-mon.pvw img', root).src = m.pvw;
      }
      if (m.type === 'r-mv' && m.mv) {
        for (const [id, src] of Object.entries(m.mv)) { const img = $(`.rmt-in[data-v="${CSS.escape(id)}"] img`, root); if (img) img.src = src; }
        const ti = $('.rmt-tally-img', root);
        if (role === 'camera' && m.mv[mem.cam]) ti.src = m.mv[mem.cam];
      }
    }
    const fmt = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
    function toast(text) {
      const t = document.createElement('div');
      t.className = 'rmt-toast';
      t.textContent = text;
      root.appendChild(t);
      setTimeout(() => t.remove(), 5000);
    }
    function renderTeam() {
      $('.rmt-members', root).innerHTML = team.map(x => `<span class="rmt-mem ${x.on ? 'on' : ''}"><i></i>${esc(x.name)} <small>${esc(ROLES[x.role]?.label || '')}</small></span>`).join('') || '<span class="note">ยังไม่มีทีมงานอื่น</span>';
      $('.rmt-msgs', root).innerHTML = msgs.slice(-30).map(x => `<div><b>${esc(x.from)}</b>${x.role && ROLES[x.role] ? ` <small>${esc(ROLES[x.role].label)}</small>` : ''} ${esc(x.text)}</div>`).join('');
      const box = $('.rmt-msgs', root); box.scrollTop = box.scrollHeight;
    }

    // วาดใหม่เฉพาะส่วนที่เปลี่ยน — กันปุ่มกระพริบ/สไลเดอร์กระโดดระหว่างลาก/ช่องพิมพ์ถูกล้างระหว่างแก้
    const sig2 = {};
    const part = (name, data, fn) => { const s = JSON.stringify(data); if (sig2[name] === s) return; sig2[name] = s; fn(); };
    const editing = el => { const a = document.activeElement; return !!a && el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
    function render() {
      const byId = id => st.inputs.find(i => i.id === id);
      $('.rmt-pgm-name', root).textContent = byId(st.pgm)?.name || '—';
      $('.rmt-pvw-name', root).textContent = byId(st.pvw)?.name || '—';
      $('.rmt-badges', root).innerHTML = `${st.live ? '<span class="rmt-badge live">LIVE</span>' : ''}${st.rec ? '<span class="rmt-badge rec">REC</span>' : ''}${st.ftb ? '<span class="rmt-badge ftb">FTB</span>' : ''}`;
      $('[data-r=ftb]', root).classList.toggle('is-on', !!st.ftb);
      part('trans', [st.trans, st.transList], () => {
        $('.rmt-trans', root).innerHTML = st.transList.map(t => `<button data-r="trans" data-v="${esc(t)}" class="${t === st.trans ? 'is-on' : ''}">${esc(t.toUpperCase())}</button>`).join('');
      });
      // Multiview: ภาพย่อทุกแหล่ง + tally — ภาพ (img) อยู่คงที่ เปลี่ยนแค่ class เพื่อไม่ให้ภาพกระพริบ
      part('mvlist', [role, st.inputs.map(i => [i.id, i.n, i.name, i.t])], () => {
        const box = $('.rmt-inputs', root);
        const list = role === 'insert' ? st.inputs.filter(i => INS.includes(i.t)) : st.inputs;
        box.innerHTML = list.map(i => `<button class="rmt-in" data-r="in" data-v="${esc(i.id)}" ${readOnly() ? 'disabled' : ''}><img alt=""><b>${i.n}</b><span>${esc(i.name)}</span></button>`).join('');
      });
      $$('.rmt-in', root).forEach(b => {
        const i = byId(b.dataset.v);
        b.classList.toggle('pgm', b.dataset.v === st.pgm);
        b.classList.toggle('pvw', b.dataset.v === st.pvw && b.dataset.v !== st.pgm);
        b.classList.toggle('off', !!i && !i.live);
      });
      part('ovl', st.ovl, () => {
        $('.rmt-ovl', root).innerHTML = st.ovl.map((c, i) => `<button class="rmt-ov ${c.on ? 'is-on' : ''} ${c.name ? '' : 'empty'}" data-r="ovl" data-v="${i}"><b>${i + 1}</b><span>${esc(c.name || 'ว่าง')}</span></button>`).join('');
      });
      if (role === 'camera') renderTally(); else delete root.dataset.tally;
      renderGfx();
      renderIns();
      part('audio', [role, st.audio.map(a => [a.key, a.name, a.muted])], () => {
        $('.rmt-audio', root).innerHTML = st.audio.map(a => `<div class="rmt-ch" data-key="${esc(a.key)}">
          <span class="rmt-ch-name">${esc(a.name)}</span><span class="rmt-meter"><i></i></span>
          <input type="range" min="-60" max="10" step="0.5" value="${a.db ?? -60}" data-r="vol" aria-label="${esc(a.name)} volume" ${readOnly() ? 'disabled' : ''}>
          <b class="rmt-db mono">${a.db == null ? '-∞' : a.db.toFixed(1)}</b>
          <button class="rmt-mute ${a.muted ? 'is-on' : ''}" data-r="mute" data-v="${esc(a.key)}" ${readOnly() ? 'disabled' : ''}>M</button></div>`).join('');
      });
      // ค่า dB จากเครื่องหลัก — ไม่ทับสไลเดอร์ที่กำลังลากอยู่
      for (const a of st.audio) {
        const row = $(`.rmt-ch[data-key="${CSS.escape(a.key)}"]`, root);
        if (!row) continue;
        const r = $('input', row);
        if (document.activeElement !== r && Date.now() - (+r.dataset.at || 0) > 800) r.value = a.db ?? -60;
        $('.rmt-db', row).textContent = a.db == null ? '-∞' : a.db.toFixed(1);
        $('.rmt-mute', row).classList.toggle('is-on', !!a.muted);
      }
      part('fx', st.audio.filter(a => a.kind === 'pad' || a.kind === 'player'), () => {
        const fx = st.audio.filter(a => a.kind === 'pad' || a.kind === 'player');
        $('.rmt-fx', root).innerHTML = fx.length ? fx.map(a => a.kind === 'pad'
          ? `<div class="rmt-pads"><b>${esc(a.name)}</b>${a.pads.map((p, i) => p ? `<button class="rmt-pad ${p.on ? 'is-on' : ''}" data-r="sfx" data-v="${esc(a.key)}" data-i="${i}">${esc(p.name)}</button>` : '').join('')}</div>`
          : `<div class="rmt-player"><b>${esc(a.name)}</b><button data-r="music" data-v="${esc(a.key)}" data-a="prev" aria-label="ก่อนหน้า">⏮</button><button class="${a.play ? 'is-on' : ''}" data-r="music" data-v="${esc(a.key)}" data-a="toggle">${a.play ? '⏸ หยุด' : '▶ เล่น'}</button><button data-r="music" data-v="${esc(a.key)}" data-a="next" aria-label="ถัดไป">⏭</button></div>`).join('')
          : '<p class="note">ยังไม่มีปุ่มเสียงเอฟเฟกต์หรือเครื่องเล่นเพลงบนเครื่องหลัก</p>';
      });
      part('macros', [st.macros, st.runMacro], () => {
        $('.rmt-macros', root).innerHTML = st.macros.map(m => `<button class="rmt-mac ${m.id === st.runMacro ? 'is-on' : ''}" data-r="macro" data-v="${esc(m.id)}">${esc(m.name)}</button>`).join('');
        if (role === 'director') { $('.rmt-mac-h', root).hidden = !st.macros.length; }
      });
      part('extra', [st.rec, st.inputs.filter(i => i.t === 'captions')], () => {
        $('.rmt-extra', root).innerHTML = `<button class="rmt-btn small ${st.rec ? 'rec is-on' : ''}" data-r="rec">${st.rec ? 'หยุดบันทึก' : 'เริ่มบันทึก'}</button>`
          + st.inputs.filter(i => i.t === 'captions').map(c => `<button class="rmt-btn small ${c.on ? 'is-on' : ''}" data-r="cap" data-v="${esc(c.id)}">${icon('mic')}${esc(c.name)} ${c.on ? 'ON' : 'OFF'}</button>`).join('');
      });
    }
    // กราฟิก: แต่ละชิ้นมีปุ่มขึ้นจอ + ช่องแก้ข้อความ (Title / ตัววิ่ง) / ปุ่มสกอร์ / นาฬิกา
    // Tally: แดง = ออกอากาศ (Program / Overlay / ในซีน) · เขียว = Preview · เทา = พัก
    function renderTally() {
      const sel = $('.rmt-tally-pick select', root);
      part('tallylist', st.inputs.map(i => [i.id, i.n, i.name]), () => {
        sel.innerHTML = '<option value="">— เลือกกล้อง —</option>' + st.inputs.map(i => `<option value="${esc(i.id)}">${i.n}. ${esc(i.name)}</option>`).join('');
      });
      if (!mem.cam || !st.inputs.some(i => i.id === mem.cam)) {
        const guess = st.inputs.find(i => ['camera', 'wireless', 'srt', 'guest'].includes(i.t));
        if (!mem.cam && guess) { mem.cam = guess.id; store.set(memKey, { ...mem, role }); }
      }
      sel.value = mem.cam || '';
      const me = st.inputs.find(i => i.id === mem.cam);
      const t = !me ? '' : me.air ? 'pgm' : me.id === st.pvw ? 'pvw' : '';
      if (t === 'pgm' && root.dataset.tally !== 'pgm' && navigator.vibrate) navigator.vibrate([200, 80, 200]);
      root.dataset.tally = t;
      $('.rmt-tally-state', root).textContent = !me ? 'เลือกกล้องด้านบน' : t === 'pgm' ? 'ON AIR' : t === 'pvw' ? 'PREVIEW' : 'STANDBY';
      $('.rmt-tally-name', root).textContent = me ? `${me.n}. ${me.name}` : '';
      $('.rmt-tally-img', root).dataset.v = mem.cam || '';
      const pg = st.inputs.find(i => i.id === st.pgm);
      $('.rmt-tally-pgm', root).textContent = pg ? `Program: ${pg.name}` : '';
    }
    function renderGfx() {
      const box = $('.rmt-gfx', root);
      const list = st.inputs.filter(i => GFX.includes(i.t));
      const onAir = id => st.ovl.some(c => c.on && c.id === id) || st.pgm === id;
      part('gfx', list.map(i => [i.id, i.name, i.t, i.hl, i.sub, i.items, i.ta, i.tb, i.sa, i.sb, i.run, i.on, onAir(i.id)]).concat([st.chat]), () => {
        if (editing(box)) { delete sig2.gfx; return; }
        box.innerHTML = list.length ? list.map(i => {
          const on = onAir(i.id);
          let body = '';
          if (i.t === 'title') body = `<input class="input" data-f="hl" maxlength="80" value="${esc(i.hl || '')}" placeholder="ข้อความหลัก"><input class="input" data-f="sub" maxlength="120" value="${esc(i.sub || '')}" placeholder="ข้อความรอง"><button class="btn btn-sm" data-r="title" data-v="${esc(i.id)}">อัปเดต</button>`;
          else if (i.t === 'ticker') body = `<textarea class="input" data-f="items" rows="3" placeholder="ข่าวละหนึ่งบรรทัด">${esc(i.items || '')}</textarea><button class="btn btn-sm" data-r="ticker" data-v="${esc(i.id)}">อัปเดต</button>`;
          else if (i.t === 'score') body = `<div class="rmt-score"><span>${esc(i.ta)}</span><button data-r="score" data-v="a" data-id="${esc(i.id)}" data-d="-1">−</button><b class="mono">${i.sa}</b><button data-r="score" data-v="a" data-id="${esc(i.id)}" data-d="1">+</button>
            <span>${esc(i.tb)}</span><button data-r="score" data-v="b" data-id="${esc(i.id)}" data-d="-1">−</button><b class="mono">${i.sb}</b><button data-r="score" data-v="b" data-id="${esc(i.id)}" data-d="1">+</button></div>`;
          else if (i.t === 'timer') body = `<button class="btn btn-sm" data-r="timer" data-v="toggle" data-id="${esc(i.id)}">${i.run ? '⏸ หยุดเวลา' : '▶ เริ่มเวลา'}</button><button class="btn btn-sm" data-r="timer" data-v="reset" data-id="${esc(i.id)}">รีเซ็ต</button>`;
          else if (i.t === 'chat') body = st.chat ? `<button class="btn btn-sm" data-r="chathide">ซ่อนคอมเมนต์ที่ขึ้นจอ</button>` : '';
          else if (i.t === 'captions') body = `<button class="btn btn-sm ${i.on ? 'is-on' : ''}" data-r="cap" data-v="${esc(i.id)}">${i.on ? 'คำบรรยาย: กำลังฟัง' : 'คำบรรยาย: หยุดอยู่'}</button>`;
          return `<div class="rmt-g ${on ? 'on' : ''}" data-id="${esc(i.id)}"><div class="rmt-g-head"><b>${esc(i.name)}</b><button class="rmt-g-air ${on ? 'is-on' : ''}" data-r="gfx" data-v="${esc(i.id)}">${on ? 'ON AIR — เอาลง' : 'ขึ้นจอ'}</button></div>${body}</div>`;
        }).join('') : '<p class="note">ยังไม่มีกราฟิก — เพิ่ม Title / ตัววิ่ง / สกอร์ ที่เครื่องหลัก</p>';
      });
    }
    // อินเสิร์ต: คลิป / Playlist / สไลด์ / รีเพลย์ — สั่งเล่น แล้วส่งเข้า Preview ให้สวิตเชอร์ตัด
    function renderIns() {
      const list = st.inputs.filter(i => INS.includes(i.t));
      part('ins', list.map(i => [i.id, i.name, i.t, i.play, i.loop, i.pos, i.item, i.id === st.pvw, i.id === st.pgm]), () => {
        $('.rmt-ins', root).innerHTML = list.length ? list.map(i => {
          const b = (v, label, on) => `<button class="${on ? 'is-on' : ''}" data-r="media" data-v="${v}" data-id="${esc(i.id)}">${label}</button>`;
          let ctl = '';
          if (i.t === 'media' && i.play !== undefined) ctl = b('play', i.play ? '⏸ หยุด' : '▶ เล่น', i.play) + b('restart', '⟲ เริ่มใหม่') + b('loop', 'วนซ้ำ', i.loop);
          else if (i.t === 'playlist') ctl = b('prev', '⏮') + b('play', i.play ? '⏸ หยุด' : '▶ เล่น', i.play) + b('next', '⏭');
          else if (i.t === 'slides') ctl = b('prev', '‹ หน้าก่อน') + b('next', 'หน้าถัดไป ›');
          else if (i.t === 'replay') ctl = b('capture', '⟲ จับรีเพลย์');
          const tally = i.id === st.pgm ? '<em class="pgm">PROGRAM</em>' : i.id === st.pvw ? '<em class="pvw">PREVIEW</em>' : '';
          return `<div class="rmt-ix"><div class="rmt-g-head"><b>${esc(i.name)}</b>${tally}<small>${esc([i.pos, i.item].filter(Boolean).join(' · '))}</small></div><div class="rmt-ix-ctl">${ctl}<button data-r="in" data-v="${esc(i.id)}" class="rmt-ix-pvw">ส่งเข้า Preview</button></div></div>`;
        }).join('') : '<p class="note">ยังไม่มีคลิป / Playlist / สไลด์ / รีเพลย์ บนเครื่องหลัก</p>';
      });
    }
    function meters(v) {
      $$('.rmt-ch', root).forEach((row, i) => {
        const db = v[i] ?? -90;
        $('.rmt-meter i', row).style.width = `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`;
      });
    }
    function sendMsg(text) {
      text = String(text || '').trim();
      if (!text) return;
      send({ type: 'r-msg', text });
    }

    let lastTap = { id: '', at: 0 };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b || b.tagName === 'INPUT' || b.disabled) return;
      const r = b.dataset.r, v = b.dataset.v;
      if (r === 'team') {
        const p = $('.rmt-team', root); p.hidden = !p.hidden;
        if (!p.hidden) { unread = 0; $('.rmt-unread', root).hidden = true; }
        return;
      }
      if (r === 'send') { const el = $('.rmt-send input', root); sendMsg(el.value); el.value = ''; return; }
      if (r === 'quick') { sendMsg(v); return; }
      if (r === 'fs') { const d = document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen?.())?.catch?.(() => {}); return; }
      if (readOnly()) return;
      if (r === 'in') {
        if (role === 'insert' || b.classList.contains('rmt-ix-pvw')) cmd('pvw', { id: v });
        else {
          const now = Date.now(), dbl = lastTap.id === v && now - lastTap.at < 400;
          lastTap = dbl ? { id: '', at: 0 } : { id: v, at: now };
          cmd(dbl ? 'take' : 'pvw', { id: v });
        }
      } else if (r === 'title') {
        const g = b.closest('.rmt-g');
        cmd('title', { id: v, hl: $('[data-f=hl]', g).value, sub: $('[data-f=sub]', g).value });
        delete sig2.gfx; b.blur();
      } else if (r === 'ticker') {
        cmd('ticker', { id: v, items: $('[data-f=items]', b.closest('.rmt-g')).value });
        delete sig2.gfx; b.blur();
      } else if (r === 'score') cmd('score', { id: b.dataset.id, v, d: +b.dataset.d });
      else if (r === 'timer' || r === 'media') cmd(r, { id: b.dataset.id, v });
      else if (r === 'gfx') cmd('gfx', { id: v });
      else if (r === 'cap') cmd('cap', { id: v });
      else if (r === 'sfx') cmd('sfx', { v, i: +b.dataset.i });
      else if (r === 'music') cmd('music', { v, a: b.dataset.a });
      else if (r === 'ovl' || r === 'macro' || r === 'mute' || r === 'trans') cmd(r, { v });
      else cmd(r);
      if (navigator.vibrate) navigator.vibrate(15);
    });
    root.addEventListener('change', e => {
      if (!e.target.closest('.rmt-tally-pick')) return;
      mem.cam = e.target.value; store.set(memKey, { ...mem, role });
      $('.rmt-tally-img', root).removeAttribute('src');
      if (st) renderTally();
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.closest('.rmt-send')) { e.preventDefault(); $('[data-r=send]', root).click(); }
    });
    root.addEventListener('input', e => {
      if (e.target.dataset.r !== 'vol') return;
      const row = e.target.closest('.rmt-ch');
      e.target.dataset.at = Date.now();
      $('.rmt-db', row).textContent = (+e.target.value).toFixed(1);
      cmd('vol', { v: row.dataset.key, db: +e.target.value });
    });

    applyRole();
    renderTeam();
    if (mem.token) connect();
    else showPair();
  }

  WM.REMOTE_ROLES = ROLES;
  WM.initRemote = initRemote;
})(window.WebMix);
