/* remote control */
(function (WM) {
  'use strict';
  const { $, $$, b64url, clamp, esc, store, toast } = WM;

  // studio = สิ่งที่ใช้จากสตูดิโอ (app.js): autoTransition, captionStart, captionStop, chatHide, clipPlayToggle, clipRemaining, clipRestart, copyText, cut, dialog, drawSource, padFire, renderInputs, renderMixer, replayCapture, runMacro, saveSettings, setChannel, setPreview, slideGo, toggleFtb, toggleInputOverlay, toggleRecord, updateMediaButtons, GRAPHIC_TYPES, TRANSITIONS, audio, byId, chanByKey, chanKey, chatFeed, dbToPos, fmtDb, ftb, inputs, isOnAir, lufs, macroRun, macros, onAirSince, ovl, pageBase, pgmCanvas, playlist, pvwCanvas, rec, settings, state, stinger, streamer, thumbs, timerControl, wireless
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน studio.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createRemoteControl = function (studio) {
    const { autoTransition, captionStart, captionStop, chatHide, clipPlayToggle, clipRemaining, clipRestart, copyText, cut, dialog, drawSource, padFire, renderInputs, renderMixer, replayCapture, runMacro, saveSettings, setChannel, setPreview, slideGo, toggleFtb, toggleInputOverlay, toggleRecord, updateMediaButtons } = studio;
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
        if (!/^\d{6}$/.test(studio.settings.remotePin || '')) { studio.settings.remotePin = randCode(6, '0123456789'); saveSettings(); }
        return studio.settings.remotePin;
      },
      team() { if (!Array.isArray(studio.settings.remoteTeam)) studio.settings.remoteTeam = []; return studio.settings.remoteTeam; },
      link(role) {
        const q = new URLSearchParams({ remote: studio.wireless.peerId, role });
        if (studio.wireless.sig) q.set('sig', b64url(JSON.stringify(studio.wireless.sig)));
        return `${studio.pageBase()}?${q}`;
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
            if (String(md.pin) !== this.pin()) { this.fails.push(now); const left = 5 - this.fails.length; this.deny(conn, 'pin', `รหัสจับคู่ไม่ถูกต้อง — ดูรหัส 6 หลักบนเครื่องหลัก (ปุ่ม “รีโมต”)${left > 0 ? ` · ผิดได้อีก ${left} ครั้ง` : ''}`); return; }
            m = { dev, token: randCode(24, 'abcdefghijkmnpqrstuvwxyz23456789'), name: name || 'ไม่ระบุชื่อ', role: REMOTE_ROLES[md.role] ? md.role : 'monitor' };
            studio.settings.remoteTeam = this.team().filter(t => t.dev !== dev).concat(m);
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
          this.talkMon = studio.audio.ctx.createGain();
          this.talkMon.gain.value = +store.get('talkVol', 1);
          this.talkMon.connect(studio.audio.ctx.destination);
        }
        return this.talkMon;
      },
      talkCall(call) {
        const md = call.metadata || {};
        const m = this.team().find(t => t.dev === md.dev && t.token && t.token === md.token);
        if (!m) { try { call.close(); } catch (e) {} return; }
        if (!studio.audio.ensure()) { try { call.close(); } catch (e) {} return; }
        const ctx = studio.audio.ctx;
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
          if (!studio.audio.ensure()) return;
          try {
            this.talkMic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          } catch (e) { toast('ใช้ไมค์สำหรับทอล์กแบ็กไม่ได้ — อนุญาตไมค์ให้หน้านี้ก่อน', 'error'); this.hostTalking = false; return; }
          const src = studio.audio.ctx.createMediaStreamSource(this.talkMic);
          this.talkMicGain = studio.audio.ctx.createGain();
          this.talkMicGain.gain.value = 0;
          src.connect(this.talkMicGain);
          for (const o of this.talks.values()) this.talkMicGain.connect(o.dest);
        }
        if (this.talkMicGain) this.talkMicGain.gain.setTargetAtTime(this.hostTalking ? 1 : 0, studio.audio.ctx.currentTime, 0.02);
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
        studio.settings.remoteTeam = this.team().filter(t => t !== m); saveSettings();
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
        const chans = [studio.audio.masterStrip, ...studio.audio.channels];
        const inp = i => {
          const o = { id: i.id, n: studio.inputs.indexOf(i) + 1, name: i.name, t: i.type, live: i.status === 'live', air: studio.isOnAir(i.id) };
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
          type: 'r-state', pgm: studio.state.programId, pvw: studio.state.previewId, ftb: !!studio.ftb.target, live: !!(studio.streamer.ws || studio.streamer.reconnecting), rec: !!studio.rec.active,
          trans: studio.settings.transition, transList: studio.TRANSITIONS.filter(t => t !== 'stinger' || studio.stinger.ready),
          inputs: studio.inputs.map(inp),
          ovl: studio.ovl.map(c => ({ on: !!c.on, id: studio.byId(c.inputId) ? c.inputId : '', name: studio.byId(c.inputId)?.name || '' })),
          audio: chans.map(c => {
            const o = { key: c === studio.audio.masterStrip ? 'master' : studio.chanKey(c) || c.id, name: c.name, db: c.db === -Infinity ? null : +c.db.toFixed(1), muted: !!c.muted, kind: c.kind || '' };
            if (c.kind === 'pad') o.pads = c.pads.map((p, i) => p ? { name: p.name, on: c.playingPad(i) } : null);
            if (c.kind === 'player' && c.src) o.play = c.src.playing();
            return o;
          }),
          macros: studio.macros.map(m => ({ id: m.id, name: m.name })), runMacro: studio.macroRun.id,
          chat: !!(studio.chatFeed.shown && !studio.chatFeed.hideAt)
        };
      },
      send(msg, filter) { for (const [c, m] of this.conns) { if (c.open && (!filter || filter(m))) { try { c.send(msg); } catch (e) {} } } },
      push(force) {
        const st = JSON.stringify(this.state());
        if (force || st !== this.last) { this.last = st; this.send(JSON.parse(st)); }
        this.send({ type: 'r-lv', v: [studio.audio.masterStrip, ...studio.audio.channels].map(c => Math.round(c.level || -90)), oa: studio.onAirSince ? Date.now() - studio.onAirSince : 0, rem: clipRemaining(studio.byId(studio.state.programId)), lu: [studio.lufs.m, studio.lufs.s, studio.lufs.i].map(v => isFinite(v) && v > -60 ? Math.round(v * 10) / 10 : null), lt: studio.lufs.target });
        // ภาพย่อ Preview / Program และ Multiview (ทุกแหล่งภาพ) วินาทีละครั้ง
        if (performance.now() - this.thumbAt > 1000) {
          this.thumbAt = performance.now();
          const snap = (src, w, h, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h); return c.toDataURL('image/jpeg', q); };
          try { this.send({ type: 'r-thumbs', pgm: snap(studio.pgmCanvas, 384, 216, 0.6), pvw: snap(studio.pvwCanvas, 384, 216, 0.6) }); } catch (e) {}
          const wantMv = m => ['director', 'switcher', 'insert', 'monitor', 'camera'].includes(m.role);
          if ([...this.conns.values()].some(wantMv)) {
            const mv = {};
            for (const i of studio.inputs) {
              try {
                const ctx = studio.thumbs.get(i.id);
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
        studio.audio.ensure();
        const v = m.v, inp = studio.byId(m.id);
        switch (m.cmd) {
          case 'pvw':
            if (mem.role === 'insert' && !(inp && INSERT_TYPES.includes(inp.type))) break;
            if (inp && m.id !== studio.state.programId) setPreview(m.id);
            break;
          case 'take': if (inp && m.id !== studio.state.programId) { studio.state.previewId = m.id; cut(); } break;
          case 'cut': cut(); break;
          case 'auto': autoTransition(); break;
          case 'ftb': toggleFtb(); break;
          case 'trans':
            if (studio.TRANSITIONS.includes(v) && (v !== 'stinger' || studio.stinger.ready)) { studio.settings.transition = v; $$('#seg-transition button').forEach(b => b.classList.toggle('is-active', b.dataset.value === v)); saveSettings(); }
            break;
          case 'ovl': { const i = +v; if (studio.ovl[i] && (studio.ovl[i].on || studio.byId(studio.ovl[i].inputId))) setChannel(i, !studio.ovl[i].on); break; }
          // ขึ้น/ลงกราฟิกหนึ่งชิ้น: ใช้ช่อง Overlay ที่ผูกไว้ ถ้ายังไม่มีใช้ช่องว่างช่องแรก
          case 'gfx': {
            if (!inp || !studio.GRAPHIC_TYPES.includes(inp.type)) break;
            const at = studio.ovl.findIndex(c => c.inputId === m.id);
            if (at >= 0) { setChannel(at, !studio.ovl[at].on); break; }
            const free = studio.ovl.findIndex(c => !studio.byId(c.inputId));
            const idx = free >= 0 ? free : studio.ovl.findIndex(c => !c.on);
            if (idx >= 0) toggleInputOverlay(m.id, idx);
            break;
          }
          case 'title':
            if (inp && inp.type === 'title') { inp.title.headline = String(m.hl ?? '').slice(0, 80); inp.title.subtitle = String(m.sub ?? '').slice(0, 120); renderInputs(); }
            break;
          case 'ticker':
            if (inp && inp.type === 'ticker') { inp.ticker.items = String(m.items || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100); renderInputs(); }
            break;
          case 'timer': if (inp && inp.type === 'timer' && (v === 'toggle' || v === 'reset')) studio.timerControl(inp, v); break;
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
            else if ((v === 'prev' || v === 'next') && inp.type === 'playlist') studio.playlist.go(inp, inp.list.index + (v === 'next' ? 1 : -1), true);
            else if (v === 'play' && inp.type === 'playlist') studio.playlist.setPlaying(inp, !inp.list.playing);
            else if ((v === 'prev' || v === 'next') && inp.type === 'slides' && inp.slides.count) slideGo(inp, inp.slides.page + (v === 'next' ? 1 : -1));
            else if (v === 'capture' && inp.type === 'replay') replayCapture(inp);
            if (vid) updateMediaButtons(inp);
            break;
          }
          case 'mute': case 'vol': {
            const ch = studio.chanByKey(v) || studio.audio.channels.find(c => c.id === v);
            if (!ch) break;
            if (m.cmd === 'mute') ch.muted = !ch.muted;
            else { ch.db = clamp(+m.db, -60, 10); if (ch.db <= -59.9) ch.db = -Infinity; ch.ui?.fader?.set(studio.dbToPos(ch.db) * 100); if (ch.ui?.db) ch.ui.db.textContent = `${studio.fmtDb(ch.db)} dB`; }
            ch === studio.audio.masterStrip ? studio.audio.applyMaster() : studio.audio.applyGain(ch);
            if (m.cmd === 'mute') renderMixer();
            break;
          }
          case 'sfx': { const ch = studio.chanByKey(v); if (ch && ch.kind === 'pad' && ch.pads[+m.i]) padFire(ch, +m.i); break; }
          case 'music': {
            const ch = studio.chanByKey(v);
            if (!ch || ch.kind !== 'player' || !ch.src) break;
            if (m.a === 'next') ch.src.next(); else if (m.a === 'prev') ch.src.prev(); else ch.src.toggle();
            break;
          }
          case 'macro': { const mm = studio.macros.find(x => x.id === v); if (mm) runMacro(mm); break; }
          case 'rec': toggleRecord(); break;
          case 'cap': { if (inp && inp.type === 'captions') { inp.capRun?.on ? captionStop(inp) : captionStart(inp); renderInputs(); } break; }
        }
        this.push(false);
      },
      async openDialog() {
        // ระบบเชื่อมต่อยังไม่พร้อม: ต่อใหม่ให้เองแล้วรอสักครู่ แทนที่จะให้ผู้ใช้กดซ้ำ
        if (studio.wireless.status !== 'ready') {
          if (studio.wireless.status !== 'connecting') studio.wireless.restart();
          toast('กำลังเปิดระบบเชื่อมต่อรีโมต…', 'info', 2500);
          for (let t = 0; t < 40 && studio.wireless.status !== 'ready'; t++) await new Promise(r => setTimeout(r, 250));
          if (studio.wireless.status !== 'ready') { toast('เปิดระบบเชื่อมต่อไม่สำเร็จ — ตรวจอินเทอร์เน็ตของเครื่องนี้แล้วลองใหม่', 'error'); return; }
        }
        let role = store.get('remoteRole', 'switcher');
        if (!REMOTE_ROLES[role]) role = 'switcher';
        const r = await dialog({
          title: 'รีโมต / ทีมงาน',
          wide: true,
          body: `
            <p class="note">ทีมงานแต่ละตำแหน่งใช้แท็บเล็ต/มือถือ/คอมของตัวเอง: เลือกตำแหน่ง → สแกน QR → ใส่<b>รหัสจับคู่</b>ด้านล่าง · เครื่องนี้เป็นเครื่องหลัก (ประมวลผล + สตรีม) เปิดค้างไว้ · รีโมตเริ่ม/หยุดไลฟ์ไม่ได้</p>
            <div class="rt-pin"><span>รหัสจับคู่</span><b class="mono" id="remote-pin">${this.pin().replace(/(\d{3})/, '$1 ')}</b><small>ทีมงานใส่รหัสนี้ครั้งแรกครั้งเดียว</small></div>
            <div class="rt-steps">
              <section><h4 class="rt-h">1 · เลือกตำแหน่ง</h4>
                <div class="rt-roles" role="tablist">${Object.entries(REMOTE_ROLES).map(([k, v]) => `<button type="button" data-role="${k}" class="${k === role ? 'is-on' : ''}"><b>${esc(v.label)}</b><small>${esc(v.desc)}</small></button>`).join('')}</div></section>
              <section><h4 class="rt-h">2 · สแกน QR แล้วใส่รหัสจับคู่</h4>
                <div class="rt-qr-row"><div class="qr-box" id="remote-qr"></div>
                  <label class="field"><span>ลิงก์สำหรับตำแหน่ง <b id="remote-role-name"></b> (ไม่มีรหัสลับในลิงก์)</span><input id="remote-link" class="input mono" readonly></label></div></section>
            </div>
            <h4 class="rt-h">ทีมงานที่จับคู่แล้ว <small id="remote-online"></small></h4>
            <div id="remote-team" class="rt-team"></div>
            <div class="rt-msgs" id="remote-msgs"></div>
            <div class="rt-send"><input id="remote-msg" class="input" maxlength="200" placeholder="ส่งข้อความถึงทุกตำแหน่ง เช่น “เตรียมตัด กล้อง 2”"><button type="button" class="btn" id="remote-msg-send">ส่ง</button></div>
            <label class="field rt-talkvol"><span>ทอล์กแบ็ก: ระดับเสียงทีมที่เครื่องนี้ (ไม่เข้า Program — ใช้หูฟังกันเสียงย้อนเข้าไมค์รายการ) · พูดกลับ: กดค้างปุ่ม 🎙 ด้านบน</span><input type="range" id="remote-talkvol" min="0" max="2" step="0.05" value="${+store.get('talkVol', 1)}"></label>`,
          actions: [{ label: 'เปลี่ยนรหัสจับคู่', value: 'repin' }, { label: 'คัดลอกลิงก์', value: 'copy' }, { label: 'ปิด', primary: true }],
          onOpen: modal => {
            modal.classList.add('rt-modal');
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
              $('#remote-online', modal).textContent = team.length ? `ออนไลน์ ${team.filter(m => this.online(m)).length} จาก ${team.length}` : '';
              $('#remote-team', modal).innerHTML = team.length ? team.map((m, i) => `<div class="rt-mem ${this.online(m) ? 'on' : ''}" data-i="${i}">
                <span class="rt-dot"></span><b>${esc(m.name)}</b>
                <select class="select" data-f="role" aria-label="ตำแหน่ง">${Object.entries(REMOTE_ROLES).map(([k, v]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
                <button type="button" class="btn btn-sm" data-f="unpair">ถอด</button></div>`).join('') : '<p class="note">ยังไม่มีเครื่องจับคู่</p>';
              $('#remote-msgs', modal).innerHTML = this.msgs.slice(-6).map(x => `<div translate="no"><b>${esc(x.from)}</b> ${esc(x.text)}</div>`).join('');
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
          studio.settings.remotePin = '';
          this.pin();
          toast('เปลี่ยนรหัสจับคู่แล้ว — เครื่องที่จับคู่ไว้ยังใช้ได้ (ถอดออกได้ในรายชื่อทีม)', 'success');
          this.openDialog();
        }
      }
    };

    return { remoteCtl };
  };
})(window.WebMix = window.WebMix || {});
