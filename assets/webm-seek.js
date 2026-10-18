/* WebMix — ทำให้ไฟล์ WebM จาก MediaRecorder มีความยาว (Duration) และเลื่อนหาตำแหน่งได้ (Cues)
   MediaRecorder ของ Chrome เขียน WebM แบบสด: ไม่มี Duration, Segment/Cluster ไม่ระบุขนาด และไม่มี Cues
   จึงเปิดในโปรแกรมเล่นแล้วไม่รู้ความยาวและลากแถบเวลาไม่ได้

   วิธีแก้แบบไม่ต้องเก็บทั้งไฟล์ไว้ใน RAM:
   - ระหว่างอัด: เขียนส่วนหัวใหม่ (เพิ่มช่อง Duration และพื้นที่สำรองสำหรับ SeekHead) แล้วส่งข้อมูลที่เหลือผ่านไปตามเดิม
     พร้อมจดตำแหน่ง Cluster และเวลาของ keyframe
   - เมื่อหยุด: ต่อท้ายไฟล์ด้วย Cues และแก้ไขส่วนหัว 2 จุด (Duration, SeekHead) ด้วยการเขียนแบบระบุตำแหน่ง
   ใช้ได้ทั้งในเบราว์เซอร์ (window.WebmSeek) และ Node (module.exports) */
(function (root) {
  'use strict';

  const ID = {
    EBML: 0x1A45DFA3, Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPosition: 0x53AC,
    Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489, Tracks: 0x1654AE6B, TrackEntry: 0xAE,
    TrackNumber: 0xD7, TrackType: 0x83, Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3, BlockGroup: 0xA0,
    Block: 0xA1, ReferenceBlock: 0xFB, Cues: 0x1C53BB6B, CuePoint: 0xBB, CueTime: 0xB3, CueTrackPositions: 0xB7,
    CueTrack: 0xF7, CueClusterPosition: 0xF1, Void: 0xEC
  };
  // องค์ประกอบระดับบนสุดของ Segment — เจอเมื่อไรแปลว่า Cluster ที่ไม่ระบุขนาดจบแล้ว
  const TOP = new Set([ID.Cluster, ID.Cues, ID.Info, ID.Tracks, ID.SeekHead, 0x1254C367, 0x1043A770, 0x1941A469, ID.EBML, ID.Segment]);
  const RESERVED = 96; // พื้นที่สำหรับ SeekHead (3 รายการใช้ 68 ไบต์)

  // อ่าน ID: คืน {id, len} หรือ null ถ้าข้อมูลยังไม่พอ / false ถ้าไม่ถูกต้อง
  function readId(b, p) {
    if (p >= b.length) return null;
    const first = b[p];
    const len = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
    if (!len) return false;
    if (p + len > b.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
    return { id, len };
  }
  // อ่านขนาด (vint): คืน {size, len} — size = -1 หมายถึงไม่ระบุขนาด
  function readSize(b, p) {
    if (p >= b.length) return null;
    const first = b[p];
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8) return false;
    if (p + len > b.length) return null;
    let v = first & (0xFF >> len), allOnes = v === (0xFF >> len);
    for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xFF) allOnes = false; }
    return { size: allOnes ? -1 : v, len };
  }
  function readHeader(b, p) {
    const id = readId(b, p);
    if (!id) return id;
    const sz = readSize(b, p + id.len);
    if (!sz) return sz;
    return { id: id.id, size: sz.size, hlen: id.len + sz.len };
  }
  const readUint = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };

  function encId(id) {
    const out = [];
    while (id > 0) { out.unshift(id & 0xFF); id = Math.floor(id / 256); }
    return out;
  }
  function encSize(n, width) {
    const len = width || (n < 0x7F ? 1 : n < 0x3FFF ? 2 : n < 0x1FFFFF ? 3 : n < 0x0FFFFFFF ? 4 : 8);
    const out = new Array(len);
    for (let i = len - 1; i >= 0; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
    out[0] |= 0x80 >> (len - 1);
    return out;
  }
  function encUint(n) {
    const out = [];
    do { out.unshift(n % 256); n = Math.floor(n / 256); } while (n > 0);
    return out;
  }
  const el = (id, body) => [...encId(id), ...encSize(body.length), ...body];
  const elUint = (id, n) => el(id, encUint(n));
  function float64(v) {
    const a = new Uint8Array(8);
    new DataView(a.buffer).setFloat64(0, v);
    return Array.from(a);
  }
  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  class WebmSeekFix {
    constructor() {
      this.mode = 'head';      // head → body | pass (ไฟล์ไม่ใช่ WebM แบบที่รู้จัก: ส่งผ่านโดยไม่แก้)
      this.headBuf = new Uint8Array(0);
      this.carry = new Uint8Array(0);
      this.carryAt = 0;        // ตำแหน่งในไฟล์ต้นทางของไบต์แรกใน carry
      this.inPos = 0;          // จำนวนไบต์ต้นทางที่รับมาทั้งหมด
      this.delta = 0;          // ตำแหน่งปลายทาง = ตำแหน่งต้นทาง + delta (ส่วนหัวเปลี่ยนขนาด)
      this.skip = 0;           // ไบต์ที่ต้องข้าม (เนื้อข้อมูลของ block)
      this.stack = [];         // คอนเทนเนอร์ที่กำลังอยู่ข้างใน: {id, end} (end = -1 ไม่ระบุขนาด)
      this.timescale = 1000000;
      this.videoTrack = 0;
      this.clusterPos = -1;
      this.clusterTime = 0;
      this.clusterCued = false;
      this.group = null;       // BlockGroup ปัจจุบัน {time, track, ref}
      this.cues = [];
      this.maxTime = 0;
      this.lastVideo = -1;
      this.frameDelta = 0;
      this.head = null;        // ส่วนหัวที่เขียนใหม่ (ใช้แก้ไขในหน่วยความจำได้)
    }

    // รับข้อมูลชิ้นถัดไป คืนรายการไบต์ที่ต้องเขียนต่อท้ายไฟล์ตามลำดับ
    push(chunk) {
      chunk = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (this.mode === 'pass') return [chunk];
      if (this.mode === 'head') {
        this.headBuf = concat([this.headBuf, chunk]);
        const r = this._parseHead();
        if (r === null) {
          if (this.headBuf.length > 4 * 1024 * 1024) return this._giveUp();
          return [];
        }
        if (r === false) return this._giveUp();
        const rest = this.headBuf.subarray(r.consumed);
        this.head = r.head;
        this.delta = r.head.length - r.consumed;
        this.inPos = r.consumed;
        this.carryAt = r.consumed;
        this.headBuf = null;
        this.mode = 'body';
        const out = [r.head];
        if (rest.length) out.push(...this._body(rest));
        return out;
      }
      return this._body(chunk);
    }

    _giveUp() {
      this.mode = 'pass';
      const b = this.headBuf;
      this.headBuf = null;
      return [b];
    }

    // แยกส่วนหัวจนถึง Cluster แรก แล้วสร้างส่วนหัวใหม่
    _parseHead() {
      const b = this.headBuf;
      const ebml = readHeader(b, 0);
      if (!ebml) return ebml;
      if (ebml.id !== ID.EBML || ebml.size < 0) return false;
      let p = ebml.hlen + ebml.size;
      const seg = readHeader(b, p);
      if (!seg) return seg;
      if (seg.id !== ID.Segment) return false;
      const ebmlBytes = b.subarray(0, p);
      p += seg.hlen;
      const kept = [];
      let info = null, tracks = false;
      for (;;) {
        const h = readHeader(b, p);
        if (!h) return h;
        if (h.id === ID.Cluster) break;
        if (h.size < 0) return false;
        if (p + h.hlen + h.size > b.length) return null;
        const body = b.subarray(p + h.hlen, p + h.hlen + h.size);
        if (h.id === ID.Info) info = body;
        else if (h.id === ID.Tracks) { tracks = true; this._parseTracks(body); kept.push(b.subarray(p, p + h.hlen + h.size)); }
        else if (h.id !== ID.SeekHead && h.id !== ID.Void && h.id !== ID.Cues) kept.push(b.subarray(p, p + h.hlen + h.size));
        p += h.hlen + h.size;
      }
      if (!info || !tracks) return false;

      // Info ใหม่: คัดลอกทุกอย่างยกเว้น Duration เดิม แล้วเพิ่ม Duration (float64) ที่จะแก้ค่าตอนหยุด
      const infoParts = [];
      for (let q = 0; q < info.length;) {
        const h = readHeader(info, q);
        if (!h || h.size < 0) return false;
        if (h.id === ID.TimecodeScale) this.timescale = readUint(info, q + h.hlen, h.size) || 1000000;
        if (h.id !== ID.Duration) infoParts.push(info.subarray(q, q + h.hlen + h.size));
        q += h.hlen + h.size;
      }
      // ระหว่างอัดเป็น Void ขนาดเท่ากัน (11 ไบต์) — ถ้าหยุดไม่สมบูรณ์ ไฟล์ก็ยังเปิดได้แบบไฟล์สดทั่วไป
      const infoBody = concat([...infoParts, new Uint8Array([ID.Void, 0x89, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
      const infoEl = concat([new Uint8Array([...encId(ID.Info), ...encSize(infoBody.length, 8)]), infoBody]);

      const segHead = new Uint8Array([...encId(ID.Segment), 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
      const voidEl = new Uint8Array(RESERVED);
      voidEl[0] = ID.Void; voidEl.set(encSize(RESERVED - 2, 1), 1);
      const head = concat([ebmlBytes, segHead, voidEl, infoEl, ...kept]);
      let off = RESERVED + infoEl.length;
      for (const k of kept) { if (readId(k, 0).id === ID.Tracks) this.tracksPos = off; off += k.length; }

      this.segStart = ebmlBytes.length + segHead.length;
      this.voidPos = this.segStart;
      this.infoPos = RESERVED;
      this.durPos = this.segStart + RESERVED + infoEl.length - 11;
      return { head, consumed: p };
    }

    _parseTracks(body) {
      for (let q = 0; q < body.length;) {
        const h = readHeader(body, q);
        if (!h || h.size < 0) return;
        if (h.id === ID.TrackEntry) {
          let num = 0, type = 0;
          const e = body.subarray(q + h.hlen, q + h.hlen + h.size);
          for (let r = 0; r < e.length;) {
            const c = readHeader(e, r);
            if (!c || c.size < 0) break;
            if (c.id === ID.TrackNumber) num = readUint(e, r + c.hlen, c.size);
            if (c.id === ID.TrackType) type = readUint(e, r + c.hlen, c.size);
            r += c.hlen + c.size;
          }
          if (type === 1 && !this.videoTrack) this.videoTrack = num;
        }
        q += h.hlen + h.size;
      }
    }

    // ส่วนเนื้อไฟล์: ส่งผ่านตามเดิม แต่ไล่อ่านโครงสร้างเพื่อจดตำแหน่ง Cluster/keyframe
    _body(chunk) {
      this.inPos += chunk.length;
      let b, p;
      if (this.skip >= chunk.length && !this.carry.length) {
        this.skip -= chunk.length;
        this.carryAt += chunk.length;
        return [chunk];
      }
      b = this.carry.length ? concat([this.carry, chunk]) : chunk;
      p = 0;
      try { p = this._scan(b); } catch (e) { this.mode = 'pass'; this.carry = new Uint8Array(0); return [chunk]; }
      // เก็บส่วนที่ยังอ่านไม่จบไว้รอชิ้นถัดไป (เป็นแค่ส่วนหัวขององค์ประกอบ ไม่กี่ไบต์)
      this.carry = b.slice(p);
      this.carryAt += p;
      return [chunk];
    }

    _scan(b) {
      let p = 0;
      for (;;) {
        if (this.skip) {
          const n = Math.min(this.skip, b.length - p);
          this.skip -= n; p += n;
          if (this.skip) return p;
        }
        const abs = this.carryAt + p;
        // ออกจากคอนเทนเนอร์ที่ระบุขนาดและอ่านครบแล้ว
        while (this.stack.length && this.stack[this.stack.length - 1].end >= 0 && abs >= this.stack[this.stack.length - 1].end) this._leave();
        const h = readHeader(b, p);
        if (h === null) return p;
        if (h === false) throw new Error('bad element');
        const top = this.stack[this.stack.length - 1];
        if (top && top.id === ID.Cluster && top.end < 0 && TOP.has(h.id)) { this._leave(); continue; }
        const inCluster = this.stack.some(s => s.id === ID.Cluster);
        const bodyAt = abs + h.hlen;
        if (h.id === ID.Cluster) {
          this.stack.push({ id: ID.Cluster, end: h.size < 0 ? -1 : bodyAt + h.size });
          this.clusterPos = abs + this.delta - this.segStart;
          this.clusterTime = 0;
          this.clusterCued = false;
          p += h.hlen;
        } else if (inCluster && h.id === ID.BlockGroup && h.size >= 0) {
          this.stack.push({ id: ID.BlockGroup, end: bodyAt + h.size });
          this.group = { time: -1, track: 0, ref: false };
          p += h.hlen;
        } else if (inCluster && (h.id === ID.Timecode || h.id === ID.SimpleBlock || h.id === ID.Block || h.id === ID.ReferenceBlock)) {
          const need = h.id === ID.Timecode ? h.size : Math.min(h.size, 12);
          if (p + h.hlen + need > b.length) return p; // รอให้มีข้อมูลส่วนต้นครบ
          const d = p + h.hlen;
          if (h.id === ID.Timecode) this.clusterTime = readUint(b, d, h.size);
          else if (h.id === ID.ReferenceBlock) { if (this.group) this.group.ref = true; }
          else {
            const tn = readSize(b, d);
            const rel = (b[d + tn.len] << 24 >> 16) | b[d + tn.len + 1]; // int16 แบบมีเครื่องหมาย
            const time = this.clusterTime + rel;
            const key = h.id === ID.SimpleBlock ? !!(b[d + tn.len + 2] & 0x80) : null;
            if (h.id === ID.Block && this.group) { this.group.time = time; this.group.track = tn.size; }
            else this._block(tn.size, time, key);
          }
          p += h.hlen;
          this.skip = h.size;
        } else {
          if (h.size < 0) throw new Error('unknown size');
          p += h.hlen;
          this.skip = h.size;
        }
      }
    }

    _leave() {
      const s = this.stack.pop();
      if (s.id === ID.BlockGroup && this.group) {
        const g = this.group;
        this.group = null;
        if (g.time >= 0) this._block(g.track, g.time, !g.ref);
      }
    }

    _block(track, time, key) {
      if (time > this.maxTime) this.maxTime = time;
      const video = !this.videoTrack || track === this.videoTrack;
      if (video && track === this.videoTrack) {
        if (this.lastVideo >= 0 && time > this.lastVideo) this.frameDelta = time - this.lastVideo;
        this.lastVideo = Math.max(this.lastVideo, time);
      }
      if (video && key && !this.clusterCued && this.clusterPos >= 0) {
        this.clusterCued = true;
        this.cues.push({ time, track, pos: this.clusterPos });
      }
    }

    get durationMs() { return (this.maxTime + this.frameDelta) * this.timescale / 1e6; }

    // เมื่อหยุดบันทึก: totalBytes = จำนวนไบต์ที่เขียนลงไฟล์แล้วทั้งหมด
    // คืน { tail: ข้อมูลต่อท้ายไฟล์ (Cues), patches: [{position, data}] } หรือ null ถ้าแก้ไม่ได้
    finish(totalBytes) {
      if (this.mode !== 'body') return null;
      while (this.stack.length) this._leave();
      const cuesPos = totalBytes - this.segStart;
      const points = this.cues.map(c => el(ID.CuePoint, [
        ...elUint(ID.CueTime, c.time),
        ...el(ID.CueTrackPositions, [...elUint(ID.CueTrack, c.track), ...elUint(ID.CueClusterPosition, c.pos)])
      ]));
      const tail = this.cues.length ? new Uint8Array(el(ID.Cues, [].concat(...points))) : new Uint8Array(0);
      const u64 = n => { const a = new Array(8); for (let i = 7; i >= 0; i--) { a[i] = n % 256; n = Math.floor(n / 256); } return a; };
      const seek = (id, pos) => el(ID.Seek, [...el(ID.SeekID, encId(id)), ...el(ID.SeekPosition, u64(pos))]);
      const seeks = [...seek(ID.Info, this.infoPos), ...seek(ID.Tracks, this.tracksPos)];
      if (tail.length) seeks.push(...seek(ID.Cues, cuesPos));
      const seekHead = el(ID.SeekHead, seeks);
      const fill = RESERVED - seekHead.length;
      const reserved = new Uint8Array(RESERVED);
      reserved.set(seekHead, 0);
      reserved[seekHead.length] = ID.Void;
      reserved.set(encSize(fill - 2, 1), seekHead.length + 1);
      const dur = this.durationMs * 1e6 / this.timescale;
      const patches = [
        // ขนาด Segment คงเป็น "ไม่ระบุ" เพราะ Cluster ข้างในไม่ระบุขนาด (ไฟล์สดมาตรฐาน)
        { position: this.voidPos, data: reserved },
        { position: this.durPos, data: new Uint8Array([0x44, 0x89, 0x88, ...float64(dur)]) }
      ];
      // ทุกจุดที่แก้อยู่ในส่วนหัว จึงแก้ในหน่วยความจำได้ด้วย (กรณีบันทึกลง RAM)
      for (const pt of patches) this.head.set(pt.data, pt.position);
      return { tail, patches, durationMs: this.durationMs, cues: this.cues.length };
    }
  }

  const api = { WebmSeekFix };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WebmSeek = api;
})(typeof self !== 'undefined' ? self : this);
