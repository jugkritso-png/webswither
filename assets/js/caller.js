/* WebMix — หน้ากล้องมือถือ (?call=) และหน้าแขกรับเชิญ (?call=&guest=) */
(function (WM) {
  'use strict';
  const { $, $$, uid, store, icon, keepScreenOn, peerOptionsFromSig, unb64url } = WM;

  function initCaller(targetId) {
    $('#studio').hidden = true;
    const root = $('#caller');
    root.hidden = false;
    // แขกรับเชิญทางไกล (?guest=<slot>): ส่งกล้อง+ไมค์ และรับภาพรายการพร้อมเสียง (ไม่มีเสียงตัวเองย้อนกลับ)
    const params = new URLSearchParams(location.search);
    const guestSlot = (params.get('guest') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
    const guestName = (params.get('n') || '').slice(0, 40);
    document.title = guestSlot ? 'WebMix — แขกรับเชิญ' : 'WebMix Camera';
    const returnVideo = $('#guest-return');

    const video = $('#caller-video');
    const statusEl = $('#caller-status');
    const msgEl = $('#caller-msg');
    let facing = guestSlot ? 'user' : 'environment', stream = null, peer = null, call = null, conn = null;
    let retryTimer = null, stopped = false, micOn = true, camOn = true;

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
    // แขกรับเชิญใช้ HD (คุยผ่านเน็ตบ้าน/มือถือได้ลื่น) — กล้องมือถือของทีมงานเลือกได้ถึง 4K
    let quality = guestSlot ? QUALITIES[0] : QUALITIES[Math.min(2, Math.max(0, +store.get('caller-quality', 1)))] || QUALITIES[1];
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
      let sig = null;
      try { const raw = new URLSearchParams(location.search).get('sig'); if (raw) sig = JSON.parse(unb64url(raw)); } catch (e) {}
      // ใช้ ID เดิมของเครื่องนี้ทุกครั้ง — สตูดิโอที่โหลดโชว์กลับมาจะจับคู่กล้องนี้เข้ากับ Input เดิมได้
      let myId = store.raw('webmix-cam-id');
      if (!myId) { myId = 'webmix-cam-' + uid().slice(0, 8); store.setRaw('webmix-cam-id', myId); }
      // แขกใช้ ID ตามลิงก์เชิญ สตูดิโอจึงรู้ว่าเป็นแขกคนไหน แม้เปิดจากเครื่องใหม่
      if (guestSlot) myId = 'webmix-g-' + guestSlot;
      const connect = id => {
        peer = id ? new Peer(id, peerOptionsFromSig(sig)) : new Peer(peerOptionsFromSig(sig));
        peer.on('open', () => { placeCall(); openData(); });
        peer.on('error', err => {
          if (stopped) return;
          // ID ถูกใช้อยู่ (เช่นเปิดซ้อนสองแท็บ) — ใช้ ID ชั่วคราวแทน
          if (err.type === 'unavailable-id' && guestSlot) { stop('ลิงก์นี้เปิดอยู่ในอีกหน้าต่างหรืออีกเครื่องแล้ว — ปิดหน้านั้นก่อนแล้วรีเฟรช'); }
          else if (err.type === 'unavailable-id' && id) { peer.destroy(); connect(null); }
          else if (err.type === 'peer-unavailable') scheduleRetry('รอสตูดิโอออนไลน์…');
          else setStatus('ผิดพลาด: ' + err.type, 'bad');
        });
        peer.on('disconnected', () => { if (!stopped && !peer.destroyed) peer.reconnect(); });
      };
      connect(myId);
    }

    function placeCall() {
      if (stopped) return;
      clearTimeout(retryTimer);
      setStatus('กำลังเชื่อมต่อสตูดิโอ…');
      const c = peer.call(targetId, stream, guestSlot ? { metadata: { guest: guestSlot } } : undefined);
      call = c;
      // แขก: ภาพและเสียงรายการที่สตูดิโอส่งกลับมา
      if (guestSlot) c.on('stream', remote => { returnVideo.srcObject = remote; returnVideo.hidden = false; returnVideo.play().catch(() => {}); });
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
        if (msg.type === 'removed') stop(guestSlot ? 'สตูดิโอจบการเชื่อมต่อแล้ว ขอบคุณที่ร่วมรายการ' : 'สตูดิโอนำกล้องนี้ออกจากรายการแล้ว');
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
      returnVideo.srcObject = null;
      returnVideo.hidden = true;
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

    // แขก: ปิดกล้องชั่วคราว (สตูดิโอเห็นจอดำ เสียงยังส่งอยู่)
    function toggleCam() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      camOn = !camOn;
      track.enabled = camOn;
      root.classList.toggle('cam-off', !camOn);
      $('#caller-cam').classList.toggle('is-off', !camOn);
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
      else if (b.dataset.caller === 'cam') toggleCam();
      else if (b.dataset.caller === 'end') stop();
    });

    if (guestSlot) {
      // หน้าเข้าร่วม: การกดปุ่มคือการอนุญาตให้เบราว์เซอร์เล่นเสียงรายการ และขอสิทธิ์กล้อง/ไมค์
      root.classList.add('guest-mode');
      $('.caller-title').textContent = guestName ? `แขกรับเชิญ · ${guestName}` : 'แขกรับเชิญ';
      $('#caller-quality').hidden = true;
      $('#caller-cam').hidden = false;
      $('#guest-join-name').textContent = guestName;
      $('#guest-join').hidden = false;
      setStatus('ยังไม่ได้เข้าร่วม');
      $('#guest-join-btn').addEventListener('click', () => {
        $('#guest-join').hidden = true;
        returnVideo.play().catch(() => {});
        start();
      }, { once: true });
    } else {
      start();
    }
  }

  Object.assign(WM, { initCaller });
})(window.WebMix);
