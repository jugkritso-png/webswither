/* wireless */
(function (WM) {
  'use strict';
  const { $, b64url, desktop, peerOptionsFromSig, store, toast, uid } = WM;

  // studio = สิ่งที่ใช้จากสตูดิโอ (app.js): addStreamInput, attachStream, cardSub, gatewayProblem, guestReturnStream, renderInputs, renderMixer, setInputStatus, tuneGuestReturn, updateStatus, H, audio, camCtl, gatewayUrl, guestPeerId, inputs, isOnAir, pageBase, pgmCanvas, remoteCtl, show, state
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน studio.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createWireless = function (studio) {
    const { addStreamInput, attachStream, cardSub, gatewayProblem, guestReturnStream, renderInputs, renderMixer, setInputStatus, tuneGuestReturn, updateStatus } = studio;
    const wireless = {
      peer: null, status: 'offline', link: '', conns: new Map(), blocked: new Set(), sig: null, peerId: '',

      // ถ้าตั้ง Stream Gateway ไว้ ใช้ PeerJS + TURN ของ Gateway (มือถือเน็ต 4G/5G เชื่อมต่อได้)
      // ไม่เช่นนั้นใช้เซิร์ฟเวอร์ PeerJS สาธารณะ
      async fetchSig() {
        if (gatewayProblem()) return null;
        try {
          const u = new URL(studio.gatewayUrl());
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
        const base = `${studio.pageBase()}?call=${encodeURIComponent(this.peerId)}`;
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
        if (call.metadata && call.metadata.talk) { studio.remoteCtl.talkCall(call); return; }
        if (call.metadata && call.metadata.guest) { this.onGuestCall(call, String(call.metadata.guest)); return; }
        call.answer();
        call.on('stream', remote => {
          let inp = studio.inputs.find(i => i.peerId === call.peer);
          if (inp && inp.stream === remote) return;
          if (inp) {
            inp.stream = remote;
            inp.missing = false;
            inp.el.srcObject = remote;
            inp.el.play().catch(() => {});
            setInputStatus(inp, 'live');
            studio.audio.replaceStream(inp, remote);
          } else {
            const n = studio.inputs.filter(i => i.type === 'wireless').length + 1;
            inp = addStreamInput(remote, { type: 'wireless', name: `MOBILE ${n}`, peerId: call.peer });
            toast(`${inp.name} เชื่อมต่อแล้ว`, 'success');
          }
          inp.call = call;
          updateStatus();
          this.sendTally();
        });
        const lost = () => {
          const inp = studio.inputs.find(i => i.peerId === call.peer);
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
        const inp = studio.inputs.find(i => i.type === 'guest' && i.guest === slot);
        if (!inp || call.peer !== studio.guestPeerId(slot)) { call.answer(); setTimeout(() => call.close(), 300); return; }
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
        if (conn.metadata && conn.metadata.remote) { studio.remoteCtl.accept(conn); return; }
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
        const inp = studio.inputs.find(i => i.peerId === conn.peer);
        const tally = !inp ? 'off' : studio.isOnAir(inp.id) ? 'pgm' : inp.id === studio.state.previewId ? 'pvw' : 'off';
        try { conn.send({ type: 'tally', tally }); if (inp && inp.type === 'guest' && inp.guestView) conn.send({ type: 'view', v: inp.guestView }); if (inp && inp.type === 'wireless') conn.send({ type: 'hello', name: inp.name, show: studio.show.name || '', num: studio.inputs.indexOf(inp) + 1 }); } catch (e) {}
      },
      sendTally() { for (const conn of this.conns.values()) this.sendTallyTo(conn); },
      // กล้องมือถือแบบโปร: สถานะกล้อง (ความสามารถ/ค่าปัจจุบัน/แบต/บันทึก) และคำสั่งควบคุมจากสตูดิโอ
      onCamMsg(peerId, msg) {
        // แขกแจ้งชื่อที่จะแสดง (แก้ได้ในหน้าเข้าร่วม)
        if (msg && msg.type === 'guest-info') {
          const g = studio.inputs.find(i => i.type === 'guest' && i.peerId === peerId), n = String(msg.name || '').trim().slice(0, 32);
          if (g && n && n !== g.name) { g.name = n; renderInputs(); renderMixer(); }
          return;
        }
        // ช่างกล้องขอดูภาพ Program: สตูดิโอโทรกลับไปพร้อมภาพย่อ (ไม่มีเสียง กันเสียงย้อน)
        if (msg && msg.type === 'cam-return') {
          const w = studio.inputs.find(i => i.type === 'wireless' && i.peerId === peerId);
          if (w) this.camReturn(w, !!msg.on);
          return;
        }
        if (!msg || msg.type !== 'cam-state' || typeof msg !== 'object') return;
        const inp = studio.inputs.find(i => i.type === 'wireless' && i.peerId === peerId);
        if (!inp) return;
        const first = !inp.cam;
        inp.cam = msg;
        if (first || !!$(`#inputs-grid .card[data-id="${inp.id}"] [data-card=camctl]`) !== (inp.status === 'live')) renderInputs();
        else {
          const sub = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
          if (sub) sub.textContent = cardSub(inp);
          $(`#inputs-grid .card[data-id="${inp.id}"] [data-card=camctl]`)?.classList.toggle('is-rec', !!msg.rec);
        }
        if (studio.camCtl && studio.camCtl.inp === inp) studio.camCtl.refresh();
      },
      camReturn(inp, on) {
        if (inp.retCall) { try { inp.retCall.close(); } catch (e) {} inp.retCall = null; }
        if (inp.retTrack) { inp.retTrack.stop(); inp.retTrack = null; }
        if (!on || !this.peer || this.peer.destroyed) return;
        inp.retTrack = studio.pgmCanvas.captureStream(15).getVideoTracks()[0];
        const call = this.peer.call(inp.peerId, new MediaStream([inp.retTrack]), { metadata: { ret: 1 } });
        if (!call) return;
        inp.retCall = call;
        call.on('close', () => { if (inp.retCall === call) { inp.retCall = null; if (inp.retTrack) { inp.retTrack.stop(); inp.retTrack = null; } } });
        // ภาพสำหรับดูเฉย ๆ: ~360p 15 fps ไม่เกิน 600 kbps — ไม่แย่งเน็ตกับภาพที่มือถือส่งเข้ามา
        call.peerConnection?.addEventListener('connectionstatechange', async () => {
          if (call.peerConnection.connectionState !== 'connected') return;
          const sender = call.peerConnection.getSenders().find(x => x.track && x.track.kind === 'video');
          if (!sender) return;
          try {
            const params = sender.getParameters();
            if (!params.encodings || !params.encodings.length) params.encodings = [{}];
            Object.assign(params.encodings[0], { maxBitrate: 600000, maxFramerate: 15, scaleResolutionDownBy: Math.max(1, studio.H / 360) });
            await sender.setParameters(params);
          } catch (e) {}
        });
      },
      sendCam(inp, msg) {
        const conn = this.conns.get(inp.peerId);
        if (conn && conn.open) { try { conn.send(msg); return true; } catch (e) {} }
        return false;
      },
      release(peerId) {
        this.blocked.add(peerId);
        const conn = this.conns.get(peerId);
        const sent = conn && conn.open && (() => { try { conn.send({ type: 'removed' }); return true; } catch (e) { return false; } })();
        const inp = studio.inputs.find(i => i.peerId === peerId);
        // ให้ข้อความ “นำออกแล้ว” ถึงมือถือก่อนตัดสายภาพ — ไม่อย่างนั้นมือถือเห็นสายหลุดก่อน แล้วพยายามต่อใหม่
        const call = inp && inp.call;
        if (call) sent ? setTimeout(() => call.close(), 500) : call.close();
        if (inp) this.camReturn(inp, false);
      },
      connectedCount() { return studio.inputs.filter(i => i.type === 'wireless' && i.status === 'live').length; },
      guestLink(inp) {
        const q = new URLSearchParams({ call: this.peerId, guest: inp.guest, n: inp.name, ...(studio.show.name ? { s: studio.show.name } : {}) });
        if (this.sig) q.set('sig', b64url(JSON.stringify(this.sig)));
        return `${studio.pageBase()}?${q}`;
      }
    };

    return { wireless };
  };
})(window.WebMix = window.WebMix || {});
