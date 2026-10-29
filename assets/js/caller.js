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
    let guestName = (params.get('n') || '').slice(0, 40);
    const showName = (params.get('s') || '').slice(0, 60);
    // แขก: อุปกรณ์ที่เลือกในหน้าเข้าร่วม + ภาพตัวอย่าง (ใช้ต่อเป็นภาพที่ส่ง ไม่เปิดกล้องซ้ำ)
    let preStream = null, micId = '';
    document.title = guestSlot ? 'WebMix — แขกรับเชิญ' : 'WebMix Camera';
    const returnVideo = $('#guest-return');

    const video = $('#caller-video');
    const statusEl = $('#caller-status');
    const msgEl = $('#caller-msg');
    let facing = guestSlot ? 'user' : 'environment', stream = null, peer = null, call = null, conn = null;
    let retryTimer = null, stopped = false, micOn = true, camOn = true;

    const setStatus = (text, kind = '') => { statusEl.textContent = text; statusEl.className = `chip ${kind}`; };
    const showMsg = text => { msgEl.textContent = text; msgEl.hidden = !text; };
    let lastTally = 'off';
    const setTally = t => {
      // ขึ้น ON AIR = สั่นเตือนช่างกล้อง (กล้องจริงมีไฟแดงที่ช่องมอง)
      if (t === 'pgm' && lastTally !== 'pgm' && !guestSlot) { try { navigator.vibrate && navigator.vibrate([90, 60, 90]); } catch (e) {} }
      lastTally = t;
      root.classList.toggle('tally-pgm', t === 'pgm');
      root.classList.toggle('tally-pvw', t === 'pvw');
      $('#caller-tally').textContent = t === 'pgm' ? 'ON AIR' : 'PREVIEW';
      const ct = $('#cam-tally');
      if (ct) { ct.textContent = t === 'pgm' ? 'ON AIR' : t === 'pvw' ? 'PREVIEW' : 'STANDBY'; ct.className = 'cam-tally' + (t === 'pgm' ? ' is-pgm' : t === 'pvw' ? ' is-pvw' : ''); }
      const gs = $('#gt-state');
      if (gs) { gs.textContent = t === 'pgm' ? 'ออกอากาศอยู่' : t === 'pvw' ? 'ทีมงานกำลังดูภาพคุณ' : 'รอทีมงาน'; gs.className = 'gt-state' + (t === 'pgm' ? ' is-pgm' : t === 'pvw' ? ' is-pvw' : ''); }
    };

    // คุณภาพที่ส่งเข้าสตูดิโอ — กดปุ่ม HD/FHD/4K บนจอเพื่อสลับ (กล้องที่ไม่รองรับจะได้ค่าสูงสุดที่ทำได้)
    const QUALITIES = [
      { label: 'HD', w: 1280, h: 720, bitrate: 2500000 },
      { label: 'FHD', w: 1920, h: 1080, bitrate: 6000000 },
      { label: '4K', w: 3840, h: 2160, bitrate: 16000000 }
    ];
    // แขกรับเชิญใช้ HD (คุยผ่านเน็ตบ้าน/มือถือได้ลื่น) — กล้องมือถือของทีมงานเลือกได้ถึง 4K
    let quality = guestSlot ? QUALITIES[0] : QUALITIES[Math.min(2, Math.max(0, +store.get('caller-quality', 1)))] || QUALITIES[1];
    // กล้องมือถือของทีมงาน: เลือกเลนส์ (deviceId) และเฟรมเรตได้จากแผงกล้องโปร
    let lensId = null, fps = guestSlot ? 30 : [24, 25, 30, 50, 60].includes(+store.get('caller-fps', 30)) ? +store.get('caller-fps', 30) : 30;
    const getCamera = withAudio => navigator.mediaDevices.getUserMedia({
      video: { ...(lensId ? { deviceId: { exact: lensId } } : { facingMode: facing }), width: { ideal: quality.w }, height: { ideal: quality.h }, frameRate: { ideal: fps } },
      // กล้องทีมงาน: ไม่ตัดเสียงรอบข้าง (เสียงบรรยากาศ/ดนตรีไม่ถูกบีบ) · แขก: ตัดเสียงสะท้อน
      audio: withAudio ? (guestSlot ? { echoCancellation: true, noiseSuppression: true, ...(micId ? { deviceId: { exact: micId } } : {}) } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }) : false
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
        try { await track.applyConstraints({ width: { ideal: quality.w }, height: { ideal: quality.h }, frameRate: { ideal: fps } }); }
        catch (e) {}
      }
      await applyBitrate();
      paintQuality();
      const s = track?.getSettings();
      if (s?.width) showMsgBrief(`ส่งภาพ ${s.width}×${s.height}${s.height < quality.h ? ' (กล้องรองรับสูงสุดเท่านี้)' : ''}`);
    }
    let briefTimer = null;
    const showMsgBrief = (text, ms = 2500) => { showMsg(text); clearTimeout(briefTimer); briefTimer = setTimeout(() => showMsg(''), ms); };
    let pro = null;
    // ข้อความจากทีมงาน (แขก): ค้างไว้ 12 วินาที
    let bubbleTimer = null;
    const teamMsg = text => { const el = $('#guest-bubble'); el.innerHTML = ''; const b = document.createElement('b'); b.textContent = guestSlot ? 'ทีมงาน: ' : 'ผู้กำกับ: '; el.append(b, text.slice(0, 160)); el.hidden = false; clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => { el.hidden = true; }, 12000); };
    // คุณภาพสัญญาณ (แขก): บิตเรตที่ส่งออกจริง + สถานะการเชื่อมต่อ
    let lastOut = null;
    async function paintNet() {
      const pc = call?.peerConnection, el = $('#gt-net');
      if (!pc || !el) return;
      try {
        const rep = await pc.getStats();
        let bytes = 0, rtt = null;
        rep.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') bytes += r.bytesSent || 0; if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime; });
        const now = performance.now();
        if (lastOut) {
          const mbps = (bytes - lastOut.bytes) * 8 / ((now - lastOut.t) * 1000);
          const good = mbps > 0.6 && (rtt == null || rtt < 0.3);
          el.textContent = `${good ? 'สัญญาณดี' : mbps > 0.2 ? 'สัญญาณพอใช้' : 'สัญญาณอ่อน'} · ${mbps.toFixed(1)} Mbps`;
          el.className = 'gt-net ' + (good ? 'ok' : 'warn');
        }
        lastOut = { bytes, t: now };
      } catch (e) {}
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('ต้องใช้ HTTPS', 'bad');
        showMsg('เบราว์เซอร์อนุญาตให้ใช้กล้องเฉพาะหน้าเว็บที่เปิดผ่าน HTTPS เท่านั้น');
        return;
      }
      try {
        stream = preStream || await getCamera(true);
        preStream = null;
      } catch (e) {
        setStatus('เปิดกล้องไม่ได้', 'bad');
        showMsg('ไม่ได้รับอนุญาตให้ใช้กล้อง/ไมค์: ' + e.message);
        return;
      }
      video.srcObject = stream;
      paintQuality();
      keepScreenOn(true);
      if (!guestSlot && WM.initProCam) pro = WM.initProCam({
        root, video, brief: showMsgBrief,
        getStream: () => stream,
        getPeerConnection: () => call?.peerConnection || null,
        send: msg => { if (conn && conn.open) { try { conn.send(msg); } catch (e) {} } },
        qualities: () => QUALITIES.map(q => q.label),
        getQuality: () => quality.label,
        getFps: () => fps,
        async setQuality(label) { const i = QUALITIES.findIndex(q => q.label === label); if (i < 0 || QUALITIES[i] === quality) return; quality = QUALITIES[(i + QUALITIES.length - 1) % QUALITIES.length]; await cycleQuality(); },
        async setFps(v) { fps = v; store.set('caller-fps', v); const t = stream?.getVideoTracks()[0]; try { await t.applyConstraints({ frameRate: { ideal: v } }); } catch (e) { await reopenVideo(); } },
        async setLens(id) { lensId = id; await reopenVideo(); },
        teamMsg: text => teamMsg(text),
        flip: () => flip()
      });
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
        // สตูดิโอโทรกลับมาเพื่อส่งภาพ Program ให้ช่างกล้องดู (ขอจากปุ่ม PGM)
        peer.on('call', c => {
          if (guestSlot || !c.metadata || !c.metadata.ret || c.peer !== targetId) { try { c.close(); } catch (e) {} return; }
          c.answer();
          c.on('stream', s => pro && pro.showReturn(s));
          c.on('close', () => pro && pro.showReturn(null));
        });
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
      d.on('open', () => { if (pro) pro.onConnected(); if (guestSlot) { try { d.send({ type: 'guest-info', name: guestName }); } catch (e) {} } });
      d.on('data', msg => {
        if (!msg || typeof msg !== 'object') return;
        if (pro && (msg.type === 'cam-set' || msg.type === 'cam-cmd')) pro.onStudioMsg(msg);
        if (msg.type === 'tally') setTally(msg.tally);
        if (!guestSlot && msg.type === 'hello' && msg.name) $('.caller-title').textContent = `${String(msg.name).slice(0, 32)}${msg.show ? ' · สตูดิโอ ' + String(msg.show).slice(0, 40) : ''}`;
        // เลขกล้อง = ลำดับการ์ดในสตูดิโอ (ตรงกับปุ่มลัด 1–9 ของผู้กำกับ)
        if (!guestSlot && msg.type === 'hello') { const n = $('#cam-num'); if (n) { n.hidden = !(msg.num > 0); n.textContent = `CAM ${msg.num | 0}`; } }
        if (guestSlot && msg.type === 'msg' && typeof msg.text === 'string') teamMsg(msg.text);
        if (guestSlot && msg.type === 'view') root.classList.toggle('view-self', msg.v === 'self');
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
      lensId = null;
      await reopenVideo(prev);
    }
    // เปิดกล้องใหม่ตามตัวเลือกปัจจุบัน (ด้าน / เลนส์ / เฟรมเรต) แล้วสลับแทร็กในสายเดิม
    async function reopenVideo(prevFacing) {
      if (!stream || stopped) return;
      const prev = prevFacing || facing;
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
      if (pro) pro.afterTrackChange();
    }

    // แขก: ปิดกล้องชั่วคราว (สตูดิโอเห็นจอดำ เสียงยังส่งอยู่)
    function toggleCam() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      camOn = !camOn;
      track.enabled = camOn;
      root.classList.toggle('cam-off', !camOn);
      $('#caller-cam').classList.toggle('is-off', !camOn);
      if (guestSlot) $('#caller-cam').dataset.label = camOn ? 'ปิดกล้อง' : 'เปิดกล้อง';
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
      // หน้าเข้าร่วม (design 33): ภาพตัวอย่าง · ชื่อ · เลือกกล้อง/ไมค์ · ระดับเสียง · ทดสอบลำโพง
      // การกด “เข้าร่วม” คือการอนุญาตให้เบราว์เซอร์เล่นเสียงรายการ
      root.classList.add('guest-mode');
      $('.caller-title').textContent = guestName ? `แขกรับเชิญ · ${guestName}` : 'แขกรับเชิญ';
      $('#caller-quality').hidden = true;
      $('#caller-cam').hidden = false;
      for (const [k, l] of [['mic', 'ไมค์'], ['flip', 'สลับกล้อง'], ['cam', 'ปิดกล้อง'], ['end', 'ออกจากรายการ']]) $(`[data-caller=${k}]`, root).dataset.label = l;
      $('#guest-join-name').textContent = guestName;
      $('#gj-show').textContent = showName || 'รายการสด';
      $('#gt-show').textContent = showName || 'รายการสด';
      const nameIn = $('#gj-name'), chip = $('#gj-name-chip');
      nameIn.value = guestName; chip.textContent = guestName || 'ชื่อของคุณ';
      nameIn.addEventListener('input', () => { chip.textContent = nameIn.value.trim() || 'ชื่อของคุณ'; });
      $('#guest-join').hidden = false;
      setStatus('ยังไม่ได้เข้าร่วม');
      const camSel = $('#gj-cam'), micSel = $('#gj-mic'), pv = $('#gj-preview'), bar = $('#gj-meter');
      let meterAc = null, raf = 0;
      const stopMeter = () => { cancelAnimationFrame(raf); meterAc?.close().catch(() => {}); meterAc = null; };
      const openPreview = async () => {
        stopMeter();
        preStream?.getTracks().forEach(t => t.stop());
        preStream = null;
        lensId = camSel.value || null; micId = micSel.value || '';
        try { preStream = await getCamera(true); }
        catch (e) { $('#gj-off').textContent = 'เปิดกล้อง/ไมค์ไม่ได้: ' + e.message; $('#gj-off').hidden = false; return; }
        pv.srcObject = preStream; pv.play().catch(() => {}); $('#gj-off').hidden = true;
        const vt = preStream.getVideoTracks()[0], at = preStream.getAudioTracks()[0];
        $('#gj-cam-label').textContent = vt ? vt.label || 'กล้อง' : 'ไม่มีกล้อง';
        $('#gj-mic-label').textContent = at ? at.label || 'ไมค์' : 'ไม่มีไมค์';
        if (at) {
          meterAc = new AudioContext(); meterAc.resume().catch(() => {});
          const an = meterAc.createAnalyser(); an.fftSize = 512; meterAc.createMediaStreamSource(preStream).connect(an);
          const buf = new Float32Array(512);
          const tick = () => { an.getFloatTimeDomainData(buf); let pk = 0; for (const x of buf) pk = Math.max(pk, Math.abs(x)); bar.style.width = `${Math.max(0, Math.min(100, (20 * Math.log10(pk || 1e-6) + 60) / 60 * 100))}%`; raf = requestAnimationFrame(tick); };
          tick();
        }
      };
      const fillDevices = async () => {
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const opt = (list, cur, none) => list.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === cur ? 'selected' : ''}>${(d.label || none + ' ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
          camSel.innerHTML = opt(devs.filter(d => d.kind === 'videoinput'), preStream?.getVideoTracks()[0]?.getSettings().deviceId, 'กล้อง');
          micSel.innerHTML = opt(devs.filter(d => d.kind === 'audioinput'), preStream?.getAudioTracks()[0]?.getSettings().deviceId, 'ไมค์');
        } catch (e) {}
      };
      if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) openPreview().then(fillDevices);
      camSel.addEventListener('change', openPreview);
      micSel.addEventListener('change', openPreview);
      $('#gj-speaker').addEventListener('click', () => {
        const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 660; g.gain.setValueAtTime(0.2, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.8);
        o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.8); setTimeout(() => ac.close(), 1200);
      });
      $('#guest-join-btn').addEventListener('click', () => {
        guestName = nameIn.value.trim().slice(0, 40) || guestName;
        $('.caller-title').textContent = guestName ? `แขกรับเชิญ · ${guestName}` : 'แขกรับเชิญ';
        $('#guest-self-name').textContent = guestName;
        stopMeter();
        $('#guest-join').hidden = true;
        for (const id of ['guest-top', 'guest-cap', 'guest-self-name', 'guest-hear']) $('#' + id).hidden = false;
        returnVideo.play().catch(() => {});
        setInterval(paintNet, 2000);
        start();
      }, { once: true });
    } else {
      start();
    }
  }

  Object.assign(WM, { initCaller });
})(window.WebMix);
