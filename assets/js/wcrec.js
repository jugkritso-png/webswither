/* WebMix — ตัวบันทึกด้วย WebCodecs + ตัวเขียนไฟล์ WebM เอง
   ใช้แทน MediaRecorder ในที่ที่ MediaRecorder เสีย: WebKitGTK บน Linux (แอปเดสก์ท็อป / Epiphany)
   เขียน MP4 ที่ ffmpeg อ่านไม่ได้ แต่ตัวเข้ารหัส WebCodecs ของมันทำงานถูกต้อง

   หน้าตาเหมือน MediaRecorder (start / stop / ondataavailable / onstop / mimeType / state) จึงใช้กับ
   ปุ่ม REC (รวมถึงการแก้ไฟล์ให้เลื่อนหาตำแหน่งได้ใน webm-seek.js) และการสตรีมผ่าน Gateway ได้ทันที
   ไฟล์ที่ได้เป็น WebM แบบสดเหมือนของ Chrome: Segment/Cluster ไม่ระบุขนาด, SimpleBlock, Cluster ใหม่ทุก keyframe */
(function (WM) {
  'use strict';

  /* ------------------------------------------------------------------ EBML */
  const te = new TextEncoder();
  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function idBytes(id) {
    const b = [];
    while (id > 0) { b.unshift(id % 256); id = Math.floor(id / 256); }
    return Uint8Array.from(b);
  }
  function sizeBytes(n) {
    for (let len = 1; len <= 8; len++) {
      if (n < 2 ** (7 * len) - 1) {
        const b = new Uint8Array(len);
        let v = n;
        for (let i = len - 1; i >= 0; i--) { b[i] = v % 256; v = Math.floor(v / 256); }
        b[0] |= 0x80 >> (len - 1);
        return b;
      }
    }
    throw new Error('EBML size too large');
  }
  const UNKNOWN_SIZE = Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const el = (id, ...body) => { const b = concat(body); return concat([idBytes(id), sizeBytes(b.length), b]); };
  const elUint = (id, v) => { const b = []; do { b.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return el(id, Uint8Array.from(b)); };
  const elFloat = (id, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); };
  const elStr = (id, s) => el(id, te.encode(s));

  // OpusHead สำหรับ CodecPrivate (ถ้าตัวเข้ารหัสไม่ได้ให้มา)
  function opusHead(channels, sampleRate) {
    const b = new Uint8Array(19);
    b.set(te.encode('OpusHead'));
    const v = new DataView(b.buffer);
    b[8] = 1; b[9] = channels;
    v.setUint16(10, 312, true);           // pre-skip
    v.setUint32(12, sampleRate, true);
    return b;
  }

  // ความยาวจริงของแพ็กเก็ต Opus (ไมโครวินาที) จาก TOC byte — RFC 6716 §3.1
  function opusDuration(p) {
    if (!p.length) return 0;
    const config = p[0] >> 3, code = p[0] & 3;
    const frameUs = config < 12 ? [10000, 20000, 40000, 60000][config % 4]
      : config < 16 ? [10000, 20000][config % 2]
      : [2500, 5000, 10000, 20000][config % 4];
    const frames = code === 0 ? 1 : code === 3 ? (p.length > 1 ? p[1] & 0x3f : 1) : 2;
    return frameUs * frames;
  }

  /* ---------------------------------------------------------- WebM muxer */
  // เวลาในไฟล์เป็นมิลลิวินาที (TimecodeScale 1,000,000 ns) · SimpleBlock เก็บเวลาเทียบกับ Cluster (int16)
  function createMuxer({ video, audio, onData }) {
    let headerDone = false, cluster = null;
    const header = () => {
      const tracks = [];
      tracks.push(el(0xAE,
        elUint(0xD7, 1), elUint(0x73C5, 1), elUint(0x83, 1), elStr(0x86, video.codecId),
        ...(video.priv ? [el(0x63A2, video.priv)] : []),
        el(0xE0, elUint(0xB0, video.width), elUint(0xBA, video.height))));
      if (audio) {
        tracks.push(el(0xAE,
          elUint(0xD7, 2), elUint(0x73C5, 2), elUint(0x83, 2), elStr(0x86, audio.codecId),
          ...(audio.priv ? [el(0x63A2, audio.priv)] : []),
          ...(audio.codecId === 'A_OPUS' ? [elUint(0x56AA, 6500000), elUint(0x56BB, 80000000)] : []),
          el(0xE1, elFloat(0xB5, audio.sampleRate), elUint(0x9F, audio.channels))));
      }
      return concat([
        el(0x1A45DFA3, elUint(0x4286, 1), elUint(0x42F7, 1), elUint(0x42F2, 4), elUint(0x42F3, 8),
          elStr(0x4282, 'webm'), elUint(0x4287, 4), elUint(0x4285, 2)),
        idBytes(0x18538067), UNKNOWN_SIZE,
        el(0x1549A966, elUint(0x2AD7B1, 1000000), elStr(0x4D80, 'WebMix'), elStr(0x5741, 'WebMix WebCodecs')),
        el(0x1654AE6B, ...tracks)
      ]);
    };
    const block = (track, ms, key, data) => {
      const b = new Uint8Array(4 + data.length);
      b[0] = 0x80 | track;
      new DataView(b.buffer).setInt16(1, Math.max(-32768, Math.min(32767, ms - cluster)));
      b[3] = key ? 0x80 : 0;
      b.set(data, 4);
      return el(0xA3, b);
    };
    const queue = [];
    const last = { 1: -Infinity, 2: -Infinity };
    return {
      add(track, ms, key, data) {
        ms = Math.max(0, ms);
        queue.push({ track, ms, key, data });
        last[track] = Math.max(last[track], ms);
        this.drain(false);
      },
      // เขียนข้อมูลเรียงตามเวลาถึงจุดที่ทั้งสองแทร็กไปถึงแล้ว (แต่ละแทร็กส่งมาตามลำดับเวลา)
      // ถ้าเสียงหยุดมา (เช่น AudioContext ยังไม่เริ่ม) เกิน 1.5 วินาที ไม่รอเสียง
      drain(all) {
        if (!headerDone) {
          if (!video.ready) return;
          onData(header());
          headerDone = true;
        }
        const waitAudio = audio && last[2] > last[1] - 1500;
        const limit = all ? Infinity : waitAudio ? Math.min(last[1], last[2]) : last[1];
        queue.sort((a, b) => a.ms - b.ms || a.track - b.track);
        const parts = [];
        while (queue.length && queue[0].ms <= limit) {
          const p = queue.shift();
          // Cluster ใหม่ที่ทุก keyframe ของวิดีโอ (เลื่อนหาตำแหน่งได้ และผู้รับที่ต่อกลางคันเริ่มที่ภาพเต็ม)
          if (cluster === null || (p.track === 1 && p.key) || p.ms - cluster > 30000) {
            cluster = p.ms;
            parts.push(idBytes(0x1F43B675), UNKNOWN_SIZE, elUint(0xE7, cluster));
          }
          if (p.ms - cluster < -32768) continue; // มาช้าเกินไป (ไม่ควรเกิด)
          parts.push(block(p.track, p.ms, p.key, p.data));
        }
        if (parts.length) onData(concat(parts));
      }
    };
  }

  /* -------------------------------------------------------------- support */
  const hasApi = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function' &&
    typeof AudioEncoder === 'function' && typeof AudioData === 'function';

  // MediaRecorder ใช้ไม่ได้จริง: WebKitGTK (Linux) — ทดสอบแล้วว่าไฟล์ MP4 เสียทั้งภาพและเสียง
  // บังคับใช้ตัวนี้ได้ด้วย localStorage 'webmix-wcrec' = '1' (ใช้ในชุดทดสอบ)
  function preferred() {
    let forced = false;
    try { forced = localStorage.getItem('webmix-wcrec') === '1'; } catch (e) {}
    const webkitGtk = /X11|Linux/.test(navigator.userAgent) && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent);
    return hasApi() && (forced || webkitGtk);
  }

  async function pickVideoConfig(width, height, fps, bitrate, preferAvc, requireAvc = false, constantBitrate = false) {
    const level = height > 1080 ? '33' : height > 720 ? '28' : '1f';
    // High → Main → Baseline: ตัวเข้ารหัสของมือถือบางรุ่น (MediaCodec) ไม่รับโปรไฟล์ High
    const avc = ['6400', '4d00', '42e0'].map(p => ({ codec: `avc1.${p}${level}`, codecId: 'V_MPEG4/ISO/AVC', avc: { format: 'avc' }, mime: 'h264' }));
    let list = [...avc, { codec: 'vp8', codecId: 'V_VP8', mime: 'vp8' }];
    if (requireAvc) list = avc;
    else if (!preferAvc) list = [list[list.length - 1], ...avc];
    for (const c of list) {
      const base = { codec: c.codec, width, height, bitrate, framerate: fps, latencyMode: 'realtime', ...(c.avc ? { avc: c.avc } : {}) };
      // สตรีม: บิตเรตคงที่ช่วยให้ปลายทาง (RTMP) ไม่ล้นบัฟเฟอร์ — ถ้าตัวเข้ารหัสไม่รองรับใช้แบบปกติ
      for (const cfg of constantBitrate ? [{ ...base, bitrateMode: 'constant' }, base] : [base]) {
        try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, codecId: c.codecId, mime: c.mime }; } catch (e) {}
      }
    }
    return null;
  }

  // เข้ารหัส H.264 ด้วย WebCodecs ได้ไหม (มือถือ Android = ชิปเข้ารหัสของเครื่องผ่าน MediaCodec)
  async function avcSupported(width, height, fps, bitrate) {
    if (!hasApi()) return false;
    return !!(await pickVideoConfig(width & ~1, height & ~1, fps, bitrate, true, true));
  }

  // ลองเข้ารหัส H.264 จริง ๆ สั้น ๆ แล้ววัดว่าทันเฟรมเรตไหม — บางเครื่อง (เช่น emulator) รองรับแต่ช้ามาก
  // คืน { ok, fps } · ok = ได้อย่างน้อย 90% ของเฟรมเรตที่ต้องการ
  async function avcBenchmark(width, height, fps, bitrate, ms = 2500) {
    width &= ~1; height &= ~1;
    const sel = hasApi() && await pickVideoConfig(width, height, fps, bitrate, true, true, true);
    if (!sel) return { ok: false, fps: 0 };
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const g = canvas.getContext('2d');
    let out = 0, broken = false, n = 0;
    const enc = new VideoEncoder({ output: () => { out++; }, error: () => { broken = true; } });
    try { enc.configure(sel.cfg); } catch (e) { return { ok: false, fps: 0 }; }
    const t0 = performance.now();
    await new Promise(resolve => {
      const stop = every(() => {
        const t = performance.now() - t0;
        if (t >= ms || broken) { stop(); resolve(); return; }
        if (t < n * 1000 / fps) return;
        g.fillStyle = `hsl(${(n * 9) % 360} 60% 50%)`; g.fillRect(0, 0, width, height);
        g.fillStyle = '#fff'; g.fillRect((n * 17) % width, (n * 11) % height, width / 6, height / 6);
        n++;
        if (enc.encodeQueueSize > 2) return;
        try { const f = new VideoFrame(canvas, { timestamp: Math.round(t * 1000) }); enc.encode(f, { keyFrame: n === 1 }); f.close(); } catch (e) { broken = true; }
      }, Math.max(4, 1000 / fps / 4));
    });
    // ไม่รอ flush นาน — นับเฉพาะที่เข้ารหัสออกมาภายในเวลาทดสอบ
    const got = out / (ms / 1000);
    try { enc.close(); } catch (e) {}
    return { ok: !broken && got >= fps * 0.9, fps: Math.round(got * 10) / 10 };
  }

  // ตัวจับเวลาใน Worker — เบราว์เซอร์ลด setInterval ของหน้าที่ซ่อนอยู่ (ปิดจอ/สลับแอป) เหลือวินาทีละครั้ง
  // แต่ไม่ลดของ Worker จึงยังเข้ารหัสได้ครบทุกเฟรมระหว่างไลฟ์เบื้องหลัง
  function every(fn, ms) {
    try {
      const src = 'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = fn;
      w.postMessage(ms);
      return () => { w.postMessage(0); w.terminate(); };
    } catch (e) {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    }
  }

  /* ------------------------------------------------------------ recorder */
  // canvas: ภาพ Program · audioNode: โหนดเสียง Master (null = ไม่มีเสียง)
  async function createRecorder({ canvas, audioNode, fps, videoBitsPerSecond, audioBitsPerSecond, preferAvc = true, requireAvc = false, constantBitrate = false }) {
    if (!hasApi()) throw new Error('เบราว์เซอร์นี้ไม่มี WebCodecs');
    const width = canvas.width & ~1, height = canvas.height & ~1;
    const vsel = await pickVideoConfig(width, height, fps, videoBitsPerSecond, preferAvc, requireAvc, constantBitrate);
    if (!vsel) throw new Error(requireAvc ? 'เข้ารหัส H.264 ด้วย WebCodecs ไม่ได้' : 'ไม่มีตัวเข้ารหัสวิดีโอ (H.264 / VP8) ใน WebCodecs');

    const actx = audioNode ? audioNode.context : null;
    let acfg = null;
    if (actx) {
      for (const sr of [actx.sampleRate, 48000]) {
        const cfg = { codec: 'opus', sampleRate: sr, numberOfChannels: 2, bitrate: audioBitsPerSecond };
        try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { acfg = cfg; break; } } catch (e) {}
      }
    }

    const rec = {
      mimeType: `video/webm;codecs=${vsel.mime}${acfg ? ',opus' : ''}`,
      state: 'inactive', ondataavailable: null, onstop: null, onerror: null,
      videoCodec: vsel.cfg.codec, droppedFrames: 0, encodedFrames: 0
    };
    const vinfo = { codecId: vsel.codecId, width, height, priv: null, ready: vsel.codecId === 'V_VP8' };
    const ainfo = acfg ? { codecId: 'A_OPUS', sampleRate: acfg.sampleRate, channels: 2, priv: opusHead(2, acfg.sampleRate) } : null;
    let buf = [], bufBytes = 0, stopSlice = null, failed = false;
    const emit = () => {
      if (!bufBytes || !rec.ondataavailable) return;
      const blob = new Blob(buf, { type: rec.mimeType });
      buf = []; bufBytes = 0;
      rec.ondataavailable({ data: blob });
    };
    const fail = e => {
      if (failed) return;
      failed = true;
      if (rec.onerror) rec.onerror({ error: e instanceof Error ? e : new Error(String(e)) });
      rec.stop();
    };
    const mux = createMuxer({ video: vinfo, audio: ainfo, onData: d => { buf.push(d); bufBytes += d.length; } });

    const venc = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !vinfo.priv) {
          vinfo.priv = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer.slice(0));
        }
        if (vinfo.codecId !== 'V_VP8') vinfo.ready = !!vinfo.priv;
        rec.encodedFrames++;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        mux.add(1, Math.round(chunk.timestamp / 1000), chunk.type === 'key', data);
      },
      error: fail
    });
    venc.configure(vsel.cfg);

    let aenc = null, proc = null, sink = null;
    let aNext = null;
    let t0 = 0, aStart = null, aFrames = 0, lastKey = -Infinity, stopFrames = null;
    if (ainfo) {
      aenc = new AudioEncoder({
        output: chunk => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          // WebKitGTK ให้ทุกแพ็กเก็ตจากบัฟเฟอร์เดียวกันมีเวลาเดียวกัน (เวลาของบัฟเฟอร์ ~93 ms)
          // → ต่อเวลาตามความยาวจริงของแพ็กเก็ต Opus แทน (ถ้าต่างจากเวลาที่ได้มาเกิน 150 ms เช่นเสียงขาดช่วง ใช้เวลาที่ได้มา)
          let ts = chunk.timestamp;
          if (aNext !== null && Math.abs(ts - aNext) < 150000) ts = aNext;
          aNext = ts + (opusDuration(data) || 20000);
          mux.add(2, Math.round(ts / 1000), true, data);
        },
        error: fail
      });
      aenc.configure(acfg);
      // ดึงเสียงจาก Master ด้วย ScriptProcessor (WebKitGTK ไม่มี MediaStreamTrackProcessor)
      proc = actx.createScriptProcessor(4096, 2, 2);
      sink = actx.createGain();
      sink.gain.value = 0;
      audioNode.connect(proc);
      proc.connect(sink);
      sink.connect(actx.destination);
      const srcRate = actx.sampleRate, dstRate = ainfo.sampleRate;
      let rsPos = 0, rsPrev = [0, 0];
      proc.onaudioprocess = e => {
        if (rec.state !== 'recording') return;
        const ib = e.inputBuffer, n = ib.length;
        const l = ib.getChannelData(0), r = ib.numberOfChannels > 1 ? ib.getChannelData(1) : l;
        if (aStart === null) aStart = (performance.now() - t0) * 1000 - n / srcRate * 1e6;
        let L = l, R = r, m = n;
        if (srcRate !== dstRate) {
          // แปลงอัตราสุ่มแบบเชิงเส้น (เช่น 44.1 → 48 kHz)
          const step = srcRate / dstRate;
          m = Math.floor((n - rsPos) / step);
          L = new Float32Array(m); R = new Float32Array(m);
          for (let i = 0; i < m; i++) {
            const x = rsPos + i * step, k = Math.floor(x), f = x - k;
            const l0 = k - 1 < 0 ? rsPrev[0] : l[k - 1], r0 = k - 1 < 0 ? rsPrev[1] : r[k - 1];
            L[i] = l0 + (l[Math.min(k, n - 1)] - l0) * f;
            R[i] = r0 + (r[Math.min(k, n - 1)] - r0) * f;
          }
          rsPos = rsPos + m * step - n;
          rsPrev = [l[n - 1], r[n - 1]];
        }
        if (!m) return;
        const planar = new Float32Array(m * 2);
        planar.set(L.subarray ? L.subarray(0, m) : L, 0);
        planar.set(R.subarray ? R.subarray(0, m) : R, m);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: dstRate, numberOfFrames: m, numberOfChannels: 2,
          timestamp: Math.round(aStart + aFrames / dstRate * 1e6), data: planar });
        aFrames += m;
        try { aenc.encode(ad); } catch (err) { fail(err); }
        ad.close();
      };
    }

    // ตัวจับเวลาเดินถี่กว่าเฟรมเรต แล้วจับภาพตามเวลาจริง — ข้อความจาก Worker อาจมาเป็นชุดตอนหน้าเว็บทำงานหนัก
    // เวลาของเฟรมวางบนตาราง 1/fps (ช่องละหนึ่งเฟรม) จึงไม่มีสองเฟรมในช่องเดียวกัน และปลายทางได้จังหวะภาพสม่ำเสมอ
    const frameMs = 1000 / fps;
    let lastSlot = -1;
    const grab = () => {
      if (rec.state !== 'recording') return;
      const slot = Math.round((performance.now() - t0) / frameMs);
      if (slot <= lastSlot) return;
      lastSlot = slot;
      if (venc.encodeQueueSize > 2) { rec.droppedFrames++; return; }
      const ts = Math.round(slot * frameMs * 1000);
      let frame;
      try { frame = new VideoFrame(canvas, { timestamp: ts }); } catch (err) { return; }
      const key = ts - lastKey >= 2e6;
      if (key) lastKey = ts;
      try { venc.encode(frame, { keyFrame: key }); } catch (err) { fail(err); }
      frame.close();
    };

    rec.start = (timeslice = 1000) => {
      if (rec.state !== 'inactive') return;
      rec.state = 'recording';
      t0 = performance.now();
      lastSlot = -1;
      stopFrames = every(grab, Math.max(4, frameMs / 4));
      grab();
      stopSlice = every(emit, Math.max(100, timeslice));
    };
    rec.stop = async () => {
      if (rec.state === 'inactive') return;
      rec.state = 'inactive';
      if (stopFrames) stopFrames();
      if (stopSlice) stopSlice();
      try { await venc.flush(); } catch (e) {}
      if (aenc) { try { await aenc.flush(); } catch (e) {} }
      mux.drain(true);
      emit();
      try { venc.close(); } catch (e) {}
      if (aenc) { try { aenc.close(); } catch (e) {} }
      if (proc) { try { audioNode.disconnect(proc); } catch (e) {} proc.disconnect(); sink.disconnect(); proc.onaudioprocess = null; }
      if (rec.onstop) rec.onstop();
    };
    return rec;
  }

  // สร้างแบบเดียวกับ new MediaRecorder(...) (ทันที) — เตรียมตัวเข้ารหัสจริงตอน start()
  function recorder(opts) {
    let inner = null, stopRequested = false;
    const rec = {
      mimeType: 'video/webm', state: 'inactive', ondataavailable: null, onstop: null, onerror: null,
      get droppedFrames() { return inner ? inner.droppedFrames : 0; },
      get encodedFrames() { return inner ? inner.encodedFrames : 0; },
      start(timeslice) {
        if (rec.state !== 'inactive') return;
        rec.state = 'recording';
        createRecorder(opts).then(r => {
          inner = r;
          rec.mimeType = r.mimeType;
          r.ondataavailable = e => rec.ondataavailable && rec.ondataavailable(e);
          r.onerror = e => rec.onerror && rec.onerror(e);
          r.onstop = () => { rec.state = 'inactive'; if (rec.onstop) rec.onstop(); };
          if (stopRequested) { rec.state = 'inactive'; if (rec.onstop) rec.onstop(); return; }
          r.start(timeslice);
        }).catch(e => {
          rec.state = 'inactive';
          if (rec.onerror) rec.onerror({ error: e });
          if (rec.onstop) rec.onstop();
        });
      },
      stop() {
        if (inner) inner.stop();
        else stopRequested = true;
      }
    };
    return rec;
  }

  WM.wcrec = { preferred, recorder, createRecorder, createMuxer, hasApi, avcSupported, avcBenchmark, every };
})(window.WebMix = window.WebMix || {});
