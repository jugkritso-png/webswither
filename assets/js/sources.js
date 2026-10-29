/* WebMix — แหล่งภาพ: ป้ายกลุ่ม (ชื่อ + สี แบบ vMix) · ค้นหา/กรอง · ลากเรียงลำดับ · เลือกหลายแหล่งเพื่อติดป้ายทีเดียว
   ป้าย = ชื่อ + สี เก็บในโชว์ · แหล่งภาพหนึ่งติดได้หลายป้าย · แถบเหนือการ์ดกรองตามป้ายและคำค้น
   ลากการ์ดไปวางระหว่างการ์ดอื่น = เรียงลำดับใหม่ (เลขบนการ์ด = ปุ่มลัด 1–9 เปลี่ยนตาม) · วางบนป้าย = ติดป้ายนั้น
   app.js เรียก WebMix.sourceTags(ctx) ครั้งเดียว — ctx ให้สถานะของแอป (รายการแหล่งภาพ, Preview/Program) และฟังก์ชันที่ใช้ร่วม */
(function (WM) {
  'use strict';
  const { $, $$, clamp, uid, esc, icon, toast } = WM;

  WM.sourceTags = function (ctx) {
    const { inputs, state, TYPE_META, byId, cardSub, closeMenu, outsideMenu, cut, dialog, renderInputs, refreshSourceSelects, setPreview } = ctx;

    const TAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
    const tagDefs = [];
    const srcFilter = { q: '', tag: '' };
    const tagById = id => tagDefs.find(t => t.id === id) || null;
    const inputTags = inp => (inp.tags || []).map(tagById).filter(Boolean);
    const okColor = c => /^#[0-9a-f]{6}$/i.test(c || '');
    function sanitizeTags(list) {
      const seen = new Set();
      return (Array.isArray(list) ? list : []).filter(t => t && typeof t.id === 'string' && t.id && !seen.has(t.id) && seen.add(t.id)).slice(0, 24)
        .map((t, i) => ({ id: t.id.slice(0, 40), name: String(t.name || `ป้าย ${i + 1}`).trim().slice(0, 24) || `ป้าย ${i + 1}`, color: okColor(t.color) ? t.color.toLowerCase() : TAG_COLORS[i % TAG_COLORS.length] }));
    }
    const sanitizeInputTags = ids => [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && tagById(id)))];
    function newTag(name) {
      if (tagDefs.length >= 24) { toast('มีป้ายได้สูงสุด 24 ป้าย', 'warn'); return null; }
      const used = new Set(tagDefs.map(t => t.color));
      const t = { id: uid(), name: String(name || '').trim().slice(0, 24) || `ป้าย ${tagDefs.length + 1}`, color: TAG_COLORS.find(c => !used.has(c)) || TAG_COLORS[tagDefs.length % TAG_COLORS.length] };
      tagDefs.push(t);
      return t;
    }
    function toggleInputTag(inp, id, on) {
      const has = (inp.tags || []).includes(id);
      if (on === undefined) on = !has;
      if (on === has) return;
      inp.tags = on ? [...(inp.tags || []), id] : inp.tags.filter(x => x !== id);
      renderInputs();
      ctx.show.autosave();
    }
    function removeTag(id) {
      const i = tagDefs.findIndex(t => t.id === id);
      if (i < 0) return;
      tagDefs.splice(i, 1);
      for (const inp of inputs) if (inp.tags) inp.tags = inp.tags.filter(x => x !== id);
      if (srcFilter.tag === id) srcFilter.tag = '';
    }
    // ย้ายแหล่งภาพไปลำดับใหม่ (index ใน inputs หลังย้าย)
    function moveInput(inp, to) {
      const from = inputs.indexOf(inp);
      to = clamp(to, 0, inputs.length - 1);
      if (from < 0 || from === to) return false;
      inputs.splice(from, 1);
      inputs.splice(to, 0, inp);
      renderInputs();
      refreshSourceSelects();
      ctx.show.autosave();
      return true;
    }
    const searchText = inp => `${inp.name} ${TYPE_META[inp.type]?.label || ''} ${cardSub(inp)} ${inputTags(inp).map(t => t.name).join(' ')}`.toLowerCase();
    const matchesFilter = inp => (!srcFilter.tag || (inp.tags || []).includes(srcFilter.tag))
      && (!srcFilter.q || srcFilter.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => searchText(inp).includes(w)));

    // ช่องค้นหา + ปุ่มป้ายอยู่ในหัวแผง · แถวป้าย (ทั้งหมด / แต่ละป้ายพร้อมจำนวน) ขึ้นเมื่อมีป้ายแล้วเท่านั้น — ไม่กินที่การ์ด
    function renderSourceBar() {
      const bar = $('#src-bar'), row = $('#src-chips');
      if (!bar || !row) return;
      bar.hidden = !inputs.length && !tagDefs.length;
      if (!$('#src-search', bar)) {
        bar.innerHTML = `<label class="src-search" title="ค้นหาแหล่งภาพ (ปุ่มลัด /)">${icon('search')}<input id="src-search" type="search" placeholder="ค้นหาแหล่งภาพ" aria-label="ค้นหาแหล่งภาพ (ปุ่มลัด /)" autocomplete="off"><kbd>/</kbd></label>`
          + `<button type="button" class="btn btn-sm btn-icon src-tagbtn">${icon('tag')}</button>`;
      }
      const tb = $('.src-tagbtn', bar);
      tb.dataset.tagact = tagDefs.length ? 'manage' : 'new';
      tb.title = tagDefs.length ? 'จัดการป้าย — ตั้งชื่อ / สี / ลบ' : 'สร้างป้ายเพื่อจัดกลุ่มแหล่งภาพ (แบบ vMix)';
      tb.setAttribute('aria-label', tb.title);
      // มือถือแนวตั้ง: หัวแผงไม่มีที่ให้ปุ่มป้าย — แสดงแถวป้ายเสมอ (ยังไม่มีป้าย = มีแค่ปุ่ม + ป้าย)
      const phone = matchMedia('(max-width: 760px)').matches;
      row.hidden = !tagDefs.length && (!phone || !inputs.length);
      if (row.hidden) { row.innerHTML = ''; return; }
      const count = id => inputs.filter(i => (i.tags || []).includes(id)).length;
      row.innerHTML = (tagDefs.length ? `<button type="button" class="src-chip ${srcFilter.tag ? '' : 'is-on'}" data-tag="" aria-pressed="${!srcFilter.tag}">ทั้งหมด <small>${inputs.length}</small></button>` : '')
        + tagDefs.map(t => `<button type="button" class="src-chip ${srcFilter.tag === t.id ? 'is-on' : ''}" data-tag="${t.id}" aria-pressed="${srcFilter.tag === t.id}" style="--tag:${t.color}" title="กรองเฉพาะป้าย “${esc(t.name)}” · ลากการ์ดมาวางเพื่อติดป้ายนี้"><i></i>${esc(t.name)} <small>${count(t.id)}</small></button>`).join('')
        + `<button type="button" class="src-chip src-chip-add" data-tagact="new" title="สร้างป้ายใหม่">${icon('plus')}ป้าย</button>`
        + (inputs.length > 1 ? `<button type="button" class="src-chip src-chip-add" data-tagact="select" title="เลือกหลายแหล่งภาพเพื่อติดป้ายทีเดียว (Ctrl / Shift + คลิกการ์ดก็ได้)">${icon('grid')}เลือก</button>` : '');
    }
    function applySourceFilter() {
      const grid = $('#inputs-grid');
      let shown = 0;
      for (const card of $$('.card', grid)) {
        const inp = byId(card.dataset.id);
        const hit = !inp || matchesFilter(inp);
        card.hidden = !hit;
        if (hit) shown++;
      }
      let none = $('.src-none', grid);
      const filtering = (srcFilter.q || srcFilter.tag) && inputs.length;
      if (filtering && !shown) {
        if (!none) { none = document.createElement('div'); none.className = 'src-none'; grid.appendChild(none); }
        const tag = tagById(srcFilter.tag);
        none.innerHTML = `<p>ไม่พบแหล่งภาพ${srcFilter.q ? ` ที่ตรงกับ “${esc(srcFilter.q)}”` : ''}${tag ? ` ในป้าย “${esc(tag.name)}”` : ''}</p><button type="button" class="btn btn-sm" data-srcclear>ล้างตัวกรอง</button>`;
      } else none?.remove();
      $('#input-count').textContent = filtering ? `${shown}/${inputs.length}` : inputs.length;
    }
    function clearSourceFilter() {
      srcFilter.q = ''; srcFilter.tag = '';
      const s = $('#src-search'); if (s) s.value = '';
      renderSourceBar(); applySourceFilter();
    }
    async function createTagFlow(inp, quiet) {
      const r = await dialog({ title: 'ป้ายใหม่', body: `<label class="field"><span>ชื่อป้าย</span><input name="name" class="input" maxlength="24" placeholder="เช่น กล้อง, เวที, กราฟิก, ผู้พูด" required></label>`,
        actions: [{ label: 'ยกเลิก' }, { label: 'สร้างป้าย', primary: true, value: 'ok' }] });
      if (!r || r.value !== 'ok') return null;
      const t = newTag(r.form.name.value);
      if (!t) return null;
      if (inp) inp.tags = [...(inp.tags || []), t.id];
      renderInputs();
      ctx.show.autosave();
      if (!quiet) toast(inp ? `ติดป้าย “${t.name}” ให้ “${inp.name}” แล้ว` : `สร้างป้าย “${t.name}” แล้ว — ลากการ์ดมาวางบนป้ายเพื่อติดป้าย`, 'success', 4000);
      return t;
    }
    function openTagManager() {
      const row = t => `<div class="tag-row" data-id="${t.id}">
          <span class="tag-swatches" role="radiogroup" aria-label="สีของป้าย">${TAG_COLORS.map(c => `<button type="button" class="${c === t.color ? 'is-on' : ''}" data-color="${c}" style="--tag:${c}" role="radio" aria-checked="${c === t.color}" aria-label="สี ${c}"></button>`).join('')}<input type="color" value="${t.color}" aria-label="เลือกสีเอง" title="เลือกสีเอง"></span>
          <input class="input tag-name" value="${esc(t.name)}" maxlength="24" aria-label="ชื่อป้าย">
          <small class="tag-count">${inputs.filter(i => (i.tags || []).includes(t.id)).length} แหล่ง</small>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" data-del title="ลบป้าย (แหล่งภาพไม่ถูกลบ)">${icon('x')}</button></div>`;
      dialog({
        title: 'จัดการป้าย',
        body: `<p class="note">ตั้งชื่อและสีของป้ายเพื่อจัดกลุ่มแหล่งภาพ — กดที่ป้ายเหนือการ์ดเพื่อดูเฉพาะกลุ่มนั้น</p><div class="tag-rows"></div>
          <button type="button" class="btn btn-sm" data-add>${icon('plus')} เพิ่มป้าย</button>`,
        actions: [{ label: 'เสร็จ', primary: true }],
        onOpen(modal) {
          const box = $('.tag-rows', modal);
          const paint = () => { box.innerHTML = tagDefs.length ? tagDefs.map(row).join('') : '<p class="note">ยังไม่มีป้าย</p>'; };
          const changed = () => { renderInputs(); ctx.show.autosave(); };
          paint();
          const tagOf = el => tagById(el.closest('.tag-row')?.dataset.id);
          const setColor = (row, c) => { const t = tagOf(row); if (!t || !okColor(c)) return; t.color = c.toLowerCase();
            $$('[data-color]', row.closest('.tag-row')).forEach(b => { const on = b.dataset.color === t.color; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on); });
            $('input[type=color]', row.closest('.tag-row')).value = t.color; changed(); };
          box.addEventListener('click', e => {
            const c = e.target.closest('[data-color]');
            if (c) { setColor(c, c.dataset.color); return; }
            if (e.target.closest('[data-del]')) { const t = tagOf(e.target); if (t) { removeTag(t.id); paint(); changed(); } }
          });
          box.addEventListener('input', e => {
            if (e.target.type === 'color') { setColor(e.target, e.target.value); return; }
            if (e.target.classList.contains('tag-name')) { const t = tagOf(e.target); if (t) { t.name = e.target.value.trim().slice(0, 24) || t.name; changed(); } }
          });
          $('[data-add]', modal).addEventListener('click', () => { const t = newTag(); if (t) { paint(); changed(); $(`.tag-row[data-id="${t.id}"] .tag-name`, box)?.select(); } });
        }
      }).then(() => { renderInputs(); ctx.show.autosave(); });
    }
    // เมนูป้ายของการ์ด: ติด/เอาป้ายออก (ไม่ปิดเมนู) · ป้ายใหม่ · เลื่อนลำดับ (สำหรับจอสัมผัส/คีย์บอร์ด)
    /* เลือกหลายแหล่งภาพเพื่อติด/เอาป้ายออกครั้งเดียว: Ctrl/⌘/Shift + คลิกการ์ด · มือถือ: เมนูป้าย → "เลือกหลายแหล่ง"
       ระหว่างเลือก แตะการ์ด = เลือก/ไม่เลือก (ไม่เปลี่ยน Preview) · Esc หรือ "ยกเลิก" = เลิกเลือก */
    const srcSel = new Set();
    let selMode = false; // โหมดเลือก (จากปุ่ม "เลือก") — ยังไม่ได้เลือกสักการ์ดก็แตะเพื่อเลือกได้
    const selecting = () => selMode || srcSel.size > 0;
    const selected = () => inputs.filter(i => srcSel.has(i.id));
    function toggleSelect(inp, on) {
      if (on === undefined) on = !srcSel.has(inp.id);
      if (on) srcSel.add(inp.id); else srcSel.delete(inp.id);
      paintSelection();
    }
    function clearSelection() { if (!selecting()) return; srcSel.clear(); selMode = false; paintSelection(); }
    function paintSelection() {
      for (const id of [...srcSel]) if (!byId(id)) srcSel.delete(id);
      $$('#inputs-grid .card').forEach(c => { const on = srcSel.has(c.dataset.id); c.classList.toggle('is-selected', on); c.setAttribute('aria-selected', on); });
      const bar = $('#src-sel');
      if (!bar) return;
      bar.hidden = !selecting();
      document.documentElement.classList.toggle('is-src-select', selecting());
      bar.innerHTML = selecting() ? `<span class="src-sel-n">${srcSel.size ? `เลือก ${srcSel.size} แหล่ง` : 'แตะการ์ดเพื่อเลือก'}</span>`
        + `<button type="button" class="btn btn-sm" data-sel="tags" ${srcSel.size ? '' : 'disabled'}>${icon('tag')}ติดป้าย…</button>`
        + `<button type="button" class="btn btn-sm btn-ghost" data-sel="all">เลือกทั้งหมด</button>`
        + `<button type="button" class="btn btn-sm btn-ghost" data-sel="clear">ยกเลิก</button>` : '';
    }
    function setTagOn(list, id, on) {
      for (const inp of list) {
        const has = (inp.tags || []).includes(id);
        if (on && !has) inp.tags = [...(inp.tags || []), id];
        else if (!on && has) inp.tags = inp.tags.filter(x => x !== id);
      }
      renderInputs();
      ctx.show.autosave();
    }
    function openMultiTagMenu(list, anchor) {
      closeMenu();
      const menu = document.createElement('div');
      menu.className = 'menu tag-menu';
      menu.setAttribute('role', 'menu');
      const paint = () => {
        menu.innerHTML = `<div class="menu-label">ป้ายของ ${list.length} แหล่งที่เลือก</div>`
          + (tagDefs.length ? tagDefs.map(t => {
            const n = list.filter(i => (i.tags || []).includes(t.id)).length;
            const st = n === list.length ? 'true' : n ? 'mixed' : 'false';
            return `<button role="menuitemcheckbox" aria-checked="${st}" data-tg="${t.id}" style="--tag:${t.color}"><i class="tag-dot"></i>${esc(t.name)}<small>${st === 'true' ? '✓' : st === 'mixed' ? '–' : ''}</small></button>`;
          }).join('') : '<p class="note tag-empty">ยังไม่มีป้าย — สร้างป้ายแรกด้านล่าง</p>')
          + `<button role="menuitem" data-tm="new">${icon('plus')}ป้ายใหม่…</button>`;
      };
      paint();
      document.body.appendChild(menu);
      const r = anchor.getBoundingClientRect();
      menu.style.left = `${clamp(r.left, 8, innerWidth - menu.offsetWidth - 8)}px`;
      menu.style.top = `${r.bottom + 6 + menu.offsetHeight > innerHeight ? Math.max(8, r.top - menu.offsetHeight - 6) : r.bottom + 6}px`;
      menu.addEventListener('click', async e => {
        const t = e.target.closest('[data-tg]');
        // ติดครบทุกแหล่งแล้ว = เอาออกจากทั้งหมด · ยังไม่ครบ = ติดให้ทั้งหมด
        if (t) { setTagOn(list, t.dataset.tg, t.getAttribute('aria-checked') !== 'true'); paint(); return; }
        if (!e.target.closest('[data-tm="new"]')) return;
        closeMenu();
        const tag = await createTagFlow(null, true);
        if (tag) { setTagOn(list, tag.id, true); toast(`ติดป้าย “${tag.name}” ให้ ${list.length} แหล่งแล้ว`, 'success', 3000); }
      });
      menu.querySelector('button')?.focus({ preventScroll: true });
      setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
    }
    function openTagMenu(inp, anchor) {
      // คลิกขวา/ปุ่มป้ายบนการ์ดที่อยู่ในกลุ่มที่เลือก = จัดป้ายทั้งกลุ่ม
      if (srcSel.size > 1 && srcSel.has(inp.id)) { openMultiTagMenu(selected(), anchor); return; }
      closeMenu();
      const menu = document.createElement('div');
      menu.className = 'menu tag-menu';
      menu.setAttribute('role', 'menu');
      const paint = () => {
        const at = inputs.indexOf(inp);
        menu.innerHTML = `<div class="menu-label">ป้ายของ “${esc(inp.name)}”</div>`
          + (tagDefs.length ? tagDefs.map(t => { const on = (inp.tags || []).includes(t.id); return `<button role="menuitemcheckbox" aria-checked="${on}" data-tg="${t.id}" style="--tag:${t.color}"><i class="tag-dot"></i>${esc(t.name)}<small>${on ? '✓' : ''}</small></button>`; }).join('') : '<p class="note tag-empty">ยังไม่มีป้าย — สร้างป้ายแรกด้านล่าง</p>')
          + `<button role="menuitem" data-tm="new">${icon('plus')}ป้ายใหม่…</button>`
          + (tagDefs.length ? `<button role="menuitem" data-tm="manage">${icon('edit')}จัดการป้าย…</button>` : '')
          + `<div class="menu-sep"></div><div class="menu-label">ลำดับ (ตอนนี้ ${at + 1} จาก ${inputs.length})</div>`
          + `<button role="menuitem" data-tm="up" ${at ? '' : 'disabled'}>‹ เลื่อนไปก่อนหน้า</button><button role="menuitem" data-tm="down" ${at < inputs.length - 1 ? '' : 'disabled'}>เลื่อนไปถัดไป ›</button>`
          + `<div class="menu-sep"></div><button role="menuitem" data-tm="select">${icon('grid')}เลือกหลายแหล่ง…</button>`;
      };
      paint();
      document.body.appendChild(menu);
      const r = anchor.getBoundingClientRect();
      menu.style.left = `${clamp(r.left, 8, innerWidth - menu.offsetWidth - 8)}px`;
      menu.style.top = `${r.bottom + 6 + menu.offsetHeight > innerHeight ? Math.max(8, r.top - menu.offsetHeight - 6) : r.bottom + 6}px`;
      menu.addEventListener('click', e => {
        const t = e.target.closest('[data-tg]');
        if (t) { toggleInputTag(inp, t.dataset.tg); paint(); return; }
        const b = e.target.closest('[data-tm]');
        if (!b) return;
        const act = b.dataset.tm;
        if (act === 'up' || act === 'down') { moveInput(inp, inputs.indexOf(inp) + (act === 'up' ? -1 : 1)); paint(); return; }
        closeMenu();
        if (act === 'new') createTagFlow(inp);
        else if (act === 'manage') openTagManager();
        else if (act === 'select') { toggleSelect(inp, true); toast('แตะการ์ดอื่นเพื่อเลือกเพิ่ม แล้วกด “ติดป้าย…”', 'info', 4000); }
      });
      menu.querySelector('button')?.focus({ preventScroll: true });
      setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
    }
    function bindSourceBar() {
      const bar = $('#src-bar');
      if (!bar) return;
      $('#src-sel')?.addEventListener('click', e => {
        const b = e.target.closest('[data-sel]');
        if (!b) return;
        if (b.dataset.sel === 'clear') clearSelection();
        else if (b.dataset.sel === 'all') { $$('#inputs-grid .card:not([hidden])').forEach(c => srcSel.add(c.dataset.id)); paintSelection(); }
        else openMultiTagMenu(selected(), b);
      });
      renderSourceBar();
      bar.addEventListener('input', e => {
        if (e.target.id !== 'src-search') return;
        srcFilter.q = e.target.value.trim();
        applySourceFilter();
      });
      bar.addEventListener('keydown', e => {
        if (e.target.id !== 'src-search') return;
        if (e.key === 'Escape') { e.stopPropagation(); clearSourceFilter(); e.target.blur(); }
        // Enter = ใส่แหล่งแรกที่พบใน Preview (Shift+Enter = ตัดขึ้น Program)
        if (e.key === 'Enter') {
          e.preventDefault();
          const inp = inputs.find(matchesFilter);
          if (!inp) return;
          ctx.audio.ensure();
          if (e.shiftKey) { if (inp.id !== state.programId) { state.previewId = inp.id; cut(); } }
          else if (inp.id !== state.programId) setPreview(inp.id);
        }
      });
      const onClick = e => {
        const c = e.target.closest('.src-chip[data-tag]');
        if (c) { srcFilter.tag = srcFilter.tag === c.dataset.tag ? '' : c.dataset.tag; renderSourceBar(); applySourceFilter(); return; }
        const a = e.target.closest('[data-tagact]');
        if (a?.dataset.tagact === 'new') createTagFlow();
        else if (a?.dataset.tagact === 'manage') openTagManager();
        else if (a?.dataset.tagact === 'select') { selMode = true; paintSelection(); }
      };
      bar.addEventListener('click', onClick);
      $('#src-chips')?.addEventListener('click', onClick);
      $('#inputs-grid').addEventListener('click', e => { if (e.target.closest('[data-srcclear]')) clearSourceFilter(); });
    }

    // ลากการ์ดเพื่อเรียงลำดับ: เมาส์ = กดแล้วลากเกิน 6 px · จอสัมผัส = กดค้าง 0.4 วินาทีแล้วลาก (แตะ/ปัดตามปกติไม่เป็นการลาก)
    function bindCardDrag(grid) {
      let st = null, suppressAt = 0;
      const SKIP = 'button, input, select, a, .card-vcrop, .card-ovl';
      const clear = () => {
        $$('.drop-before, .drop-after, .is-dragging', grid).forEach(c => c.classList.remove('drop-before', 'drop-after', 'is-dragging'));
        $$('.src-chip.is-drop').forEach(c => c.classList.remove('is-drop'));
      };
      const end = () => {
        if (!st) return;
        clearTimeout(st.timer);
        st.ghost?.remove();
        clear();
        document.documentElement.classList.remove('is-card-drag');
        removeEventListener('pointermove', move, true);
        removeEventListener('pointerup', up, true);
        removeEventListener('pointercancel', end, true);
        removeEventListener('keydown', key, true);
        st = null;
      };
      const key = e => { if (e.key === 'Escape' && st?.on) { e.preventDefault(); e.stopPropagation(); suppressAt = performance.now(); end(); } };
      const begin = () => {
        if (!st || st.on) return;
        st.on = true;
        const inp = byId(st.id);
        if (!inp) { end(); return; }
        const g = document.createElement('div');
        const tag = inputTags(inp)[0];
        g.className = 'card-ghost';
        if (tag) g.style.setProperty('--tag', tag.color);
        g.innerHTML = `<b>${inputs.indexOf(inp) + 1}</b>${esc(inp.name)}`;
        document.body.appendChild(g);
        st.ghost = g;
        document.documentElement.classList.add('is-card-drag');
        grid.querySelector(`.card[data-id="${st.id}"]`)?.classList.add('is-dragging');
        navigator.vibrate?.(15);
        track(st.x, st.y);
      };
      const track = (x, y) => {
        st.x = x; st.y = y;
        st.ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
        clear();
        grid.querySelector(`.card[data-id="${st.id}"]`)?.classList.add('is-dragging');
        st.target = null; st.chip = null;
        const el = document.elementFromPoint(x, y);
        const chip = el?.closest('.src-chip[data-tag]');
        if (chip && chip.dataset.tag) { st.chip = chip.dataset.tag; chip.classList.add('is-drop'); return; }
        const card = el?.closest('.card');
        if (card && grid.contains(card) && card.dataset.id !== st.id) {
          const r = card.getBoundingClientRect();
          st.target = card.dataset.id;
          st.after = x > r.left + r.width / 2;
          card.classList.add(st.after ? 'drop-after' : 'drop-before');
        }
        // ลากใกล้ขอบบน/ล่างของแผง = เลื่อนรายการ
        const gr = grid.getBoundingClientRect();
        if (y < gr.top + 36) grid.scrollTop -= 14;
        else if (y > gr.bottom - 36) grid.scrollTop += 14;
      };
      const move = e => {
        if (!st || e.pointerId !== st.pid) return;
        const d = Math.hypot(e.clientX - st.x0, e.clientY - st.y0);
        if (!st.on) {
          st.x = e.clientX; st.y = e.clientY;
          if (st.touch) { if (d > 10) end(); return; }
          if (d > 6) begin();
          return;
        }
        e.preventDefault();
        track(e.clientX, e.clientY);
      };
      const up = e => {
        if (!st || e.pointerId !== st.pid) return;
        if (st.on) {
          // ปล่อยบนการ์ด = เบราว์เซอร์ส่ง click ตามมาหนึ่งครั้ง — ไม่ให้นับเป็นการแตะ (ไม่เปลี่ยน Preview)
          if (grid.contains(document.elementFromPoint(e.clientX, e.clientY))) suppressAt = performance.now();
          const inp = byId(st.id);
          if (inp && st.chip) {
            const t = tagById(st.chip);
            const group = srcSel.has(inp.id) && srcSel.size > 1 ? selected() : null;
            if (t && group) { setTagOn(group, t.id, true); toast(`ติดป้าย “${t.name}” ให้ ${group.length} แหล่งแล้ว`, 'success', 3000); }
            else if (t && !(inp.tags || []).includes(t.id)) { toggleInputTag(inp, t.id, true); toast(`ติดป้าย “${t.name}” ให้ “${inp.name}” แล้ว`, 'success', 3000); }
          } else if (inp && st.target) {
            const tgt = byId(st.target);
            if (tgt) {
              let to = inputs.indexOf(tgt) + (st.after ? 1 : 0);
              if (inputs.indexOf(inp) < to) to--;
              moveInput(inp, to);
            }
          }
        }
        end();
      };
      grid.addEventListener('pointerdown', e => {
        if (st || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest(SKIP)) return;
        const card = e.target.closest('.card');
        if (!card || !byId(card.dataset.id)) return;
        st = { id: card.dataset.id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', on: false };
        if (st.touch) st.timer = setTimeout(begin, 400);
        addEventListener('pointermove', move, true);
        addEventListener('pointerup', up, true);
        addEventListener('pointercancel', end, true);
        addEventListener('keydown', key, true);
      });
      // จอสัมผัส: ระหว่างลาก ห้ามเลื่อนหน้า และไม่ให้กดค้างเปิดเมนูของระบบ
      grid.addEventListener('touchmove', e => { if (st?.on) e.preventDefault(); }, { passive: false });
      grid.addEventListener('contextmenu', e => { if (st) e.preventDefault(); });
      // ปล่อยหลังลาก ไม่นับเป็นการแตะการ์ด (ไม่เปลี่ยน Preview)
      grid.addEventListener('click', e => { if (performance.now() - suppressAt < 400) { suppressAt = 0; e.stopPropagation(); e.preventDefault(); } }, true);
    }

    return {
      tagDefs, inputTags, sanitizeTags, sanitizeInputTags, renderSourceBar, applySourceFilter, openTagManager, openTagMenu,
      bindSourceBar, bindCardDrag, isSelected: id => srcSel.has(id), selecting, toggleSelect, clearSelection, paintSelection
    };
  };
})(window.WebMix = window.WebMix || {});
