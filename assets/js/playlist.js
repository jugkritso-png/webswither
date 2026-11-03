// Playlist — เล่นวิดีโอ/รูปต่อกันอัตโนมัติ: วิดีโอจบแล้วไปรายการถัดไป, รูปแสดงตามเวลาที่ตั้ง · ไฟล์เก็บในเบราว์เซอร์เหมือน Input วิดีโอ/รูป
// ใช้ <video> ตัวเดียวต่อ Playlist เสียงจึงอยู่ในช่องมิกเซอร์เดียวตลอด
(function (WM) {
  'use strict';
  const { $, $$, clamp, uid, esc, icon, fmtDuration, toast, mediaStore } = WM;

  // ctx = สิ่งที่ต้องใช้จากสตูดิโอ (app.js)
  //   inputs, state, pool   รายการแหล่งภาพ · ภาพบน Program/Preview · ที่เก็บ <video> ที่ซ่อนไว้
  //   audio()               ระบบเสียง (ประกาศทีหลังใน app.js จึงส่งมาเป็นฟังก์ชัน)
  //   addInput, setInputStatus, renderInputs, refreshSourceSelects, cardSub, drawSource, autoTransition, pickFiles, dialog
  WM.createPlaylist = function (ctx) {
    const { inputs, state, pool, audio, addInput, setInputStatus, renderInputs, refreshSourceSelects, cardSub, drawSource, autoTransition, pickFiles, dialog } = ctx;
    const playlist = {
      create(props = {}) {
        const v = document.createElement('video');
        v.playsInline = true; v.preload = 'auto';
        pool.appendChild(v);
        const inp = addInput({ type: 'playlist', status: 'nosignal', ...props, el: v,
          list: { items: [], index: 0, loop: true, imageSec: 5, playing: true, ...(props.list || {}) }, urls: new Map() });
        v.addEventListener('ended', () => this.next(inp));
        v.addEventListener('error', () => { if (v.getAttribute('src')) { toast(`${inp.name}: เล่นไฟล์ “${this.current(inp)?.name || ''}” ไม่ได้ — ข้ามไปรายการถัดไป`, 'warn'); this.next(inp); } });
        v.addEventListener('playing', () => setInputStatus(inp, 'live'));
        audio().addElement(inp, v);
        return inp;
      },
      current: inp => inp.list.items[inp.list.index] || null,
      async url(inp, item) {
        if (inp.urls.has(item.key)) return inp.urls.get(item.key);
        const file = await mediaStore.get(item.key);
        if (!file) return null;
        const u = URL.createObjectURL(file);
        inp.urls.set(item.key, u);
        return u;
      },
      // แสดงรายการที่ index (manual = ผู้ใช้กดเอง: เล่นต่อแม้ปิดวนซ้ำ)
      async go(inp, index, manual) {
        const L = inp.list, n = L.items.length;
        clearTimeout(inp.imgTimer);
        if (!n) { inp.showImg = null; inp.el.removeAttribute('src'); inp.el.load(); setInputStatus(inp, 'nosignal'); renderInputs(); return; }
        if (index >= n) { if (!L.loop && !manual) { this.setPlaying(inp, false); return; } index = 0; }
        if (index < 0) index = n - 1;
        L.index = index;
        const item = L.items[index], token = (inp.goToken = (inp.goToken || 0) + 1);
        const src = await this.url(inp, item);
        if (inp.removed || token !== inp.goToken) return;
        if (!src) {
          // ไฟล์ไม่อยู่ในเครื่องนี้ (เช่นเปิดไฟล์โชว์บนเครื่องอื่น) — ข้าม
          if (!item.missingWarned) { item.missingWarned = true; toast(`${inp.name}: ไม่พบไฟล์ “${item.name}” ในเครื่องนี้ — ข้ามไป (เพิ่มไฟล์ใหม่ในหน้าแก้ไข Playlist)`, 'warn', 6000); }
          if (L.items.every(x => x.missingWarned)) { setInputStatus(inp, 'nosignal'); return; }
          return this.go(inp, index + 1, manual);
        }
        if (item.kind === 'image') {
          inp.el.pause();
          const img = new Image();
          img.onload = () => { if (token !== inp.goToken) return; inp.showImg = img; inp.imgStart = performance.now(); setInputStatus(inp, 'live'); this.armImage(inp); };
          img.src = src;
        } else {
          inp.showImg = null;
          inp.el.src = src;
          inp.el.currentTime = 0;
          if (L.playing) inp.el.play().catch(() => {});
        }
        const sub = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`);
        if (sub) sub.textContent = cardSub(inp);
      },
      armImage(inp) {
        clearTimeout(inp.imgTimer);
        if (inp.list.playing && inp.showImg) inp.imgTimer = setTimeout(() => this.next(inp), inp.list.imageSec * 1000);
      },
      // รายการถัดไป: สุ่มลำดับ (ไม่ซ้ำตัวเดิม) · จบรายการแล้วไม่วน + “ตัดกลับ” → AUTO ไปภาพใน Preview
      next(inp) {
        if (inp.removed) return;
        const L = inp.list, n = L.items.length;
        if (L.shuffle && n > 1) { let j; do { j = Math.floor(Math.random() * n); } while (j === L.index); return this.go(inp, j, false); }
        if (L.index + 1 >= n && !L.loop && L.endCut && state.programId === inp.id && state.previewId && state.previewId !== inp.id) { this.setPlaying(inp, false); autoTransition(); return; }
        this.go(inp, L.index + 1, false);
      },
      // ความยาวของแต่ละไฟล์ (อ่านจาก metadata ครั้งเดียว เก็บไว้กับโชว์)
      async durations(inp, onDone) {
        for (const it of inp.list.items) {
          if (it.kind === 'image' || it.dur) continue;
          const u = await this.url(inp, it);
          if (!u) continue;
          it.dur = await new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => res(isFinite(v.duration) ? v.duration : 0); v.onerror = () => res(0); v.src = u; setTimeout(() => res(0), 5000); });
          onDone && onDone();
        }
      },
      reorder(inp, from, to) {
        const it = inp.list.items;
        if (from === to || from < 0 || to < 0 || from >= it.length || to >= it.length) return;
        const cur = it[inp.list.index];
        it.splice(to, 0, it.splice(from, 1)[0]);
        inp.list.index = Math.max(0, it.indexOf(cur));
      },
      setPlaying(inp, on) {
        inp.list.playing = on;
        if (inp.showImg) { if (on) this.armImage(inp); else clearTimeout(inp.imgTimer); }
        else if (inp.el.getAttribute('src')) { if (on) inp.el.play().catch(() => {}); else inp.el.pause(); }
        renderInputs();
      },
      async addFiles(inp, files) {
        for (const file of files) {
          const kind = /^image\//.test(file.type) ? 'image' : /^(video|audio)\//.test(file.type) || /\.(mp4|webm|mov|mkv|m4v|mp3|wav|m4a)$/i.test(file.name) ? 'video' : null;
          if (!kind) { toast(`ข้ามไฟล์ “${file.name}” (ไม่ใช่วิดีโอหรือรูป)`, 'warn'); continue; }
          const item = { key: `${inp.id}-${uid()}`, name: file.name, kind };
          inp.urls.set(item.key, URL.createObjectURL(file));
          inp.list.items.push(item);
          mediaStore.put(item.key, file).then(ok => { if (!ok && !inp.removed) toast(`พื้นที่ในเบราว์เซอร์ไม่พอเก็บ “${file.name}” — เปิดหน้าใหม่แล้วต้องเพิ่มไฟล์นี้อีกครั้ง`, 'warn', 7000); });
        }
        if (inp.list.items.length && inp.status !== 'live') this.go(inp, inp.list.index);
        renderInputs();
      },
      remove(inp, i) {
        const [item] = inp.list.items.splice(i, 1);
        if (!item) return;
        mediaStore.del(item.key);
        const u = inp.urls.get(item.key);
        if (u) { URL.revokeObjectURL(u); inp.urls.delete(item.key); }
        if (i < inp.list.index) inp.list.index--;
        else if (i === inp.list.index) this.go(inp, Math.min(inp.list.index, inp.list.items.length - 1), true);
      },
      move(inp, i, d) {
        const it = inp.list.items, j = i + d;
        if (j < 0 || j >= it.length) return;
        [it[i], it[j]] = [it[j], it[i]];
        if (inp.list.index === i) inp.list.index = j; else if (inp.list.index === j) inp.list.index = i;
      },
      dispose(inp, forget) {
        clearTimeout(inp.imgTimer);
        for (const u of inp.urls.values()) URL.revokeObjectURL(u);
        if (forget) for (const it of inp.list.items) mediaStore.del(it.key);
      },
      keys: () => inputs.filter(i => i.type === 'playlist').flatMap(i => i.list.items.map(x => x.key)),
      // หน้าแก้ Playlist: ลากเรียง · สถานะ เล่นแล้ว / กำลังเล่น / ถัดไป · ความยาว · กำลังเล่น + ปุ่มควบคุม · ตัวเลือกการเล่น
      async edit(inp) {
        const L = inp.list;
        const tc = sec => sec ? fmtDuration(sec * 1000) : '—';
        const durOf = it => it.kind === 'image' ? L.imageSec : it.dur || 0;
        const rows = () => L.items.length ? L.items.map((it, i) => {
          const st = i === L.index ? (inp.status === 'live' ? 'now' : 'cur') : i < L.index && !L.shuffle ? 'done' : i === L.index + 1 || (L.loop && L.index === L.items.length - 1 && i === 0) ? 'next' : '';
          const chip = { now: '<em class="pl-chip now">กำลังเล่น</em>', cur: '<em class="pl-chip now">รายการปัจจุบัน</em>', next: '<em class="pl-chip next">ถัดไป</em>', done: '<em class="pl-chip done">เล่นแล้ว</em>' }[st] || '';
          return `<div class="pl-row ${i === L.index ? 'is-current' : ''} ${st === 'next' ? 'is-next' : ''}" data-i="${i}" draggable="true">
            <span class="pl-grip" aria-hidden="true">⋮⋮</span><span class="pl-num">${i + 1}</span><span class="pl-thumb">${icon(it.kind === 'image' ? 'image' : 'film')}</span>
            <span class="pl-name" translate="no">${esc(it.name)}</span>${chip}<span class="pl-dur mono">${tc(durOf(it))}</span>
            <button type="button" class="mini" data-pl="up" title="เลื่อนขึ้น">▲</button><button type="button" class="mini" data-pl="down" title="เลื่อนลง">▼</button>
            <button type="button" class="mini" data-pl="play" title="เล่นรายการนี้">${icon('play')}</button><button type="button" class="mini danger" data-pl="del" title="ลบออกจากรายการ">${icon('x')}</button>
          </div>`;
        }).join('') : '<p class="note">ยังไม่มีไฟล์</p>';
        const total = () => L.items.reduce((a, it) => a + durOf(it), 0);
        const result = await dialog({
          title: `Playlist — ${inp.name}`,
          wide: true,
          body: `<div class="pl-wrap">
            <div class="pl-left">
              <div class="pl-list">${rows()}</div>
              <button type="button" class="pl-drop" data-pl="add">ลากไฟล์มาวาง หรือ + เพิ่มไฟล์ (วิดีโอ / รูป / เสียง)</button>
            </div>
            <div class="pl-right">
              <section class="pl-card"><div class="pl-h"><h3>กำลังเล่น</h3></div>
                <div class="pl-now"><canvas width="640" height="360" aria-label="ภาพที่กำลังเล่น"></canvas></div>
                <div class="pl-bar"><i></i></div>
                <div class="pl-times mono"><span data-pl-at>00:00:00</span><span data-pl-left></span></div>
                <div class="pl-ctl"><button type="button" class="btn" data-pl="prev">ก่อนหน้า</button><button type="button" class="btn btn-primary" data-pl="toggle">หยุดชั่วคราว</button><button type="button" class="btn" data-pl="next">ถัดไป</button></div>
              </section>
              <section class="pl-card"><div class="pl-h"><h3>การเล่น</h3></div>
                <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
                <label class="check"><input type="checkbox" name="loop" ${L.loop ? 'checked' : ''}> วนรายการ</label>
                <label class="check"><input type="checkbox" name="shuffle" ${L.shuffle ? 'checked' : ''}> สุ่มลำดับ</label>
                <label class="check"><input type="checkbox" name="endCut" ${L.endCut ? 'checked' : ''}> จบรายการแล้วตัดกลับไปภาพใน Preview (เมื่อไม่วน)</label>
                <label class="field"><span>รูปแต่ละรูปแสดง (วินาที)</span><input name="imageSec" class="input mono" type="number" min="1" max="600" value="${L.imageSec}"></label>
              </section>
              <p class="pl-total">รวม <b data-pl-count>${L.items.length}</b> รายการ · <b class="mono" data-pl-total>${tc(total())}</b></p>
            </div>
          </div>`,
          actions: [{ label: 'เสร็จ', primary: true, value: 'save' }],
          onOpen(modal) {
            modal.classList.add('pl-modal');
            const list = $('.pl-list', modal);
            const redraw = () => { list.innerHTML = rows(); $('[data-pl-total]', modal).textContent = tc(total()); $('[data-pl-count]', modal).textContent = L.items.length; };
            playlist.durations(inp, () => modal.isConnected && redraw());
            const after = () => { redraw(); renderInputs(); };
            modal.addEventListener('click', e => {
              const b = e.target.closest('[data-pl]');
              if (!b) return;
              const act = b.dataset.pl, i = +(b.closest('[data-i]')?.dataset.i ?? -1);
              if (act === 'add') { pickFiles('video/*,image/*,audio/*', files => playlist.addFiles(inp, files).then(() => { playlist.durations(inp, redraw); redraw(); })); return; }
              if (act === 'up' || act === 'down') playlist.move(inp, i, act === 'up' ? -1 : 1);
              else if (act === 'del') playlist.remove(inp, i);
              else if (act === 'play') { L.playing = true; playlist.go(inp, i, true); }
              else if (act === 'prev' || act === 'next') { L.playing = true; playlist.go(inp, L.index + (act === 'next' ? 1 : -1), true); }
              else if (act === 'toggle') playlist.setPlaying(inp, !L.playing);
              after();
            });
            // ลากเรียงลำดับ / ลากไฟล์จากเครื่องมาวาง
            let from = -1;
            list.addEventListener('dragstart', e => { const r = e.target.closest('.pl-row'); if (r) { from = +r.dataset.i; e.dataTransfer.effectAllowed = 'move'; r.classList.add('is-drag'); } });
            list.addEventListener('dragend', () => { from = -1; $$('.pl-row', list).forEach(r => r.classList.remove('is-drag', 'is-over')); });
            modal.addEventListener('dragover', e => { e.preventDefault(); $$('.pl-row', list).forEach(r => r.classList.toggle('is-over', r === e.target.closest('.pl-row') && from >= 0)); });
            modal.addEventListener('drop', e => {
              e.preventDefault();
              const files = [...(e.dataTransfer?.files || [])];
              if (files.length) { playlist.addFiles(inp, files).then(() => { playlist.durations(inp, redraw); redraw(); }); return; }
              const r = e.target.closest('.pl-row');
              if (r && from >= 0) { playlist.reorder(inp, from, +r.dataset.i); after(); }
            });
            modal.addEventListener('change', e => {
              if (e.target.name === 'shuffle') L.shuffle = e.target.checked;
              if (e.target.name === 'loop') L.loop = e.target.checked;
              if (e.target.name === 'endCut') L.endCut = e.target.checked;
              if (e.target.name === 'imageSec') { L.imageSec = clamp(Math.round(+e.target.value || 5), 1, 600); redraw(); }
              if (['shuffle', 'loop'].includes(e.target.name)) redraw();
            });
            const cv = $('.pl-now canvas', modal), cx = cv.getContext('2d'), bar = $('.pl-bar i', modal);
            let lastIdx = L.index, lastStatus = inp.status;
            const tick = () => {
              if (!modal.isConnected) return;
              drawSource(cx, inp, 640, 360);
              const it = L.items[L.index], v = inp.el;
              let at = 0, dur = 0;
              if (it && it.kind === 'image') { dur = L.imageSec; at = inp.imgStart ? Math.min(dur, (performance.now() - inp.imgStart) / 1000) : 0; }
              else if (v && isFinite(v.duration)) { dur = v.duration; at = v.currentTime; }
              bar.style.width = `${dur ? at / dur * 100 : 0}%`;
              $('[data-pl-at]', modal).textContent = fmtDuration(at * 1000);
              $('[data-pl-left]', modal).textContent = dur ? `เหลือ ${fmtDuration((dur - at) * 1000)}` : '';
              $('[data-pl=toggle]', modal).textContent = L.playing ? 'หยุดชั่วคราว' : 'เล่น';
              if (lastIdx !== L.index || lastStatus !== inp.status) { lastIdx = L.index; lastStatus = inp.status; redraw(); }
              requestAnimationFrame(tick);
            };
            tick();
          }
        });
        if (result?.value === 'save') {
          const f = result.form;
          inp.name = f.name.value.trim() || inp.name;
          L.imageSec = clamp(Math.round(+f.imageSec.value || 5), 1, 600);
          L.loop = f.loop.checked; L.shuffle = f.shuffle.checked; L.endCut = f.endCut.checked;
        }
        renderInputs();
        refreshSourceSelects();
      }
    };
    function addPlaylist() {
      audio().ensure();
      const n = inputs.filter(i => i.type === 'playlist').length + 1;
      const inp = playlist.create({ name: `PLAYLIST ${n}` });
      pickFiles('video/*,image/*,audio/*', files => playlist.addFiles(inp, files));
      return inp;
    }

    return { playlist, addPlaylist };
  };
})(window.WebMix = window.WebMix || {});
