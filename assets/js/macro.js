/* Macro: กดปุ่มเดียวทำหลายขั้นตอนต่อกัน (ตัดภาพ / Overlay / เสียง / บันทึก / ไลฟ์ / รอ) ----
   สั่งได้จากปุ่มในแท็บ Macro, ปุ่ม F1–F12, ปุ่ม MIDI หรือให้เริ่มเองตามเวลา · บันทึกไว้กับโชว์ */
(function (WM) {
  'use strict';
  const { $, $$, clamp, esc, icon, pad2, toast, uid } = WM;

  // ctx = สิ่งที่ใช้จากสตูดิโอ (app.js): autoTransition, captionStart, captionStop, chatHide, clipRestart, cut, dialog, padFire, renderInputs, renderMixer, replayCapture, saveSettings, setChannel, setPreview, slideStep, startDestinations, stopAllStreams, toggleFtb, toggleRecord, PAD_SLOTS, TRANSITIONS, audio, audioChanOptions, byId, chanByKey, chanKey, ftb, inputs, ovl, padChannel, playlist, rec, settings, show, state, stinger, streamer, tr
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน ctx.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createMacros = function (ctx) {
    const { autoTransition, captionStart, captionStop, chatHide, clipRestart, cut, dialog, padFire, renderInputs, renderMixer, replayCapture, saveSettings, setChannel, setPreview, slideStep, startDestinations, stopAllStreams, toggleFtb, toggleRecord } = ctx;
    const MACRO_ACTIONS = {
      preview: ['ใส่ใน Preview', 'input'], program: ['ตัดเข้า Program', 'input'], cut: ['CUT', ''], auto: ['AUTO (รอจนเปลี่ยนเสร็จ)', ''],
      effect: ['ตั้งเอฟเฟกต์เปลี่ยนภาพ', 'effect'], ovlOn: ['Overlay ขึ้นจอ', 'ovl'], ovlOff: ['Overlay ลงจอ', 'ovl'], ovlAllOff: ['เอา Overlay ลงทั้งหมด', ''],
      ftbOn: ['จอดำ (FTB) เปิด', ''], ftbOff: ['จอดำ (FTB) ปิด', ''], mute: ['ปิดเสียงช่อง', 'audio'], unmute: ['เปิดเสียงช่อง', 'audio'],
      play: ['เล่นวิดีโอ / Playlist จากต้น', 'media'], recStart: ['เริ่มบันทึก', ''], recStop: ['หยุดบันทึก', ''],
      liveStart: ['เริ่มไลฟ์ (ปลายทางที่เปิดใช้)', ''], liveStop: ['หยุดไลฟ์ทั้งหมด', ''], replay: ['Instant Replay', ''],
      slideNext: ['สไลด์ถัดไป', ''], slidePrev: ['สไลด์ก่อนหน้า', ''],
      chatHide: ['ซ่อนคอมเมนต์บนจอ', ''], capOn: ['คำบรรยายสด: เริ่มฟัง', ''], capOff: ['คำบรรยายสด: หยุด', ''], sfx: ['เล่นเสียงเอฟเฟกต์', 'pad'], musicPlay: ['เครื่องเล่นเพลง: เล่น', 'player'], musicStop: ['เครื่องเล่นเพลง: หยุด', 'player'], musicNext: ['เครื่องเล่นเพลง: เพลงถัดไป', 'player'],
      wait: ['รอ (วินาที)', 'secs']
    };
    const MACRO_KEYS = ['', 'F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12'];
    const macros = [];
    const macroRun = { id: null, step: 0, cancel: false };
    function sanitizeMacros(list) {
      return (Array.isArray(list) ? list : []).filter(m => m && typeof m === 'object').slice(0, 24).map(m => ({
        id: typeof m.id === 'string' && /^[\w-]{1,24}$/.test(m.id) ? m.id : uid(),
        name: String(m.name || 'Macro').slice(0, 40),
        key: MACRO_KEYS.includes(m.key) ? m.key : '',
        at: /^\d{2}:\d{2}$/.test(m.at || '') ? m.at : '',
        // วันที่เริ่มเองตามเวลาไปแล้ว — เปิดหน้าใหม่ในนาทีเดิมจะไม่ทำซ้ำ
        ranOn: typeof m.ranOn === 'string' ? m.ranOn.slice(0, 24) : '',
        steps: (Array.isArray(m.steps) ? m.steps : []).filter(st => st && MACRO_ACTIONS[st.a]).slice(0, 60)
          .map(st => ({ a: st.a, v: st.a === 'wait' ? clamp(+st.v || 1, 0.1, 3600) : String(st.v ?? '').slice(0, 80) }))
      }));
    }
    const sleepCancellable = async ms => { const end = performance.now() + ms; while (!macroRun.cancel && performance.now() < end) await new Promise(r => setTimeout(r, Math.min(100, end - performance.now()))); };
    const macroChannel = v => ctx.chanByKey(v);
    async function macroStep(st) {
      const v = st.v;
      switch (st.a) {
        case 'preview': if (ctx.byId(v) && v !== ctx.state.programId) setPreview(v); break;
        case 'program': if (ctx.byId(v) && v !== ctx.state.programId) { ctx.state.previewId = v; cut(); } break;
        case 'cut': cut(); break;
        case 'auto':
          autoTransition();
          for (let t = 0; ctx.tr.auto && t < 300 && !macroRun.cancel; t++) await new Promise(r => setTimeout(r, 50));
          break;
        case 'effect':
          if (ctx.TRANSITIONS.includes(v) && (v !== 'stinger' || ctx.stinger.ready)) { ctx.settings.transition = v; $$('#seg-transition button').forEach(b => b.classList.toggle('is-active', b.dataset.value === v)); saveSettings(); }
          break;
        case 'ovlOn': case 'ovlOff': { const i = +v; if (ctx.ovl[i] && ctx.ovl[i].on !== (st.a === 'ovlOn') && (st.a === 'ovlOff' || ctx.byId(ctx.ovl[i].inputId))) setChannel(i, st.a === 'ovlOn'); break; }
        case 'ovlAllOff': ctx.ovl.forEach((c, i) => { if (c.on) setChannel(i, false); }); break;
        case 'ftbOn': case 'ftbOff': if (!!ctx.ftb.target !== (st.a === 'ftbOn')) toggleFtb(); break;
        case 'mute': case 'unmute': {
          const ch = macroChannel(v);
          if (!ch) break;
          ch.muted = st.a === 'mute';
          ch === ctx.audio.masterStrip ? ctx.audio.applyMaster() : ctx.audio.applyGain(ch);
          renderMixer();
          break;
        }
        case 'play': {
          const inp = ctx.byId(v);
          if (inp && inp.type === 'playlist') ctx.playlist.go(inp, 0, true);
          else if (inp && inp.el && inp.el.tagName === 'VIDEO' && inp.type === 'media') clipRestart(inp);
          break;
        }
        case 'recStart': if (!ctx.rec.active && !ctx.rec.starting) await toggleRecord(); break;
        case 'recStop': if (ctx.rec.active && ctx.rec.recorder) ctx.rec.recorder.stop(); break;
        case 'liveStart': startDestinations(ctx.settings.destinations.filter(d => d.enabled)); break;
        case 'liveStop': if (ctx.streamer.active || ctx.streamer.reconnecting) stopAllStreams(); break;
        case 'replay': await replayCapture(); break;
        case 'slideNext': slideStep(1); break;
        case 'slidePrev': slideStep(-1); break;
        case 'chatHide': chatHide(); break;
        case 'capOn': case 'capOff': ctx.inputs.filter(i => i.type === 'captions').forEach(i => st.a === 'capOn' ? captionStart(i) : captionStop(i)); renderInputs(); break;
        case 'sfx': { const ch = ctx.padChannel(); if (ch && !ch.playingPad(+v)) padFire(ch, +v); break; }
        case 'musicPlay': case 'musicStop': case 'musicNext': {
          const ch = ctx.chanByKey(v);
          if (!ch?.src) break;
          if (st.a === 'musicNext') ch.src.next?.();
          else if (ch.src.playing() !== (st.a === 'musicPlay')) ch.src.toggle();
          break;
        }
        case 'wait': await sleepCancellable(v * 1000); break;
      }
    }
    async function runMacro(m) {
      if (macroRun.id) {
        if (macroRun.id === m.id) { macroRun.cancel = true; toast(`หยุด Macro “${m.name}”`, 'info', 2000); }
        else toast('มี Macro อื่นทำงานอยู่ — รอให้จบหรือกดซ้ำที่ Macro นั้นเพื่อหยุด', 'warn');
        return;
      }
      ctx.audio.ensure();
      Object.assign(macroRun, { id: m.id, step: 0, cancel: false });
      renderMacros();
      try {
        for (let i = 0; i < m.steps.length && !macroRun.cancel; i++) {
          macroRun.step = i;
          paintMacroProgress(m);
          try { await macroStep(m.steps[i]); } catch (e) { console.warn('macro step', e); }
        }
      } finally {
        macroRun.id = null;
        renderMacros();
      }
    }
    // เริ่มเองตามเวลา (ครั้งเดียวต่อวัน ขณะเปิดแอปอยู่)
    function macroClock(now) {
      const hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`, day = now.toDateString();
      for (const m of macros) {
        if (m.at && m.at === hm && m.ranOn !== day) { m.ranOn = day; ctx.show.autosave(true); toast(`เริ่ม Macro “${m.name}” ตามเวลา ${m.at}`, 'info', 4000); runMacro(m); }
      }
    }
    const macroLabel = st => {
      const [label, arg] = MACRO_ACTIONS[st.a] || ['?', ''];
      const v = st.v;
      const what = arg === 'input' || arg === 'media' ? ctx.byId(v)?.name || '—' : arg === 'ovl' ? `ช่อง ${+v + 1}` : arg === 'effect' ? String(v).toUpperCase()
        : arg === 'audio' ? (v === 'master' ? 'Master' : macroChannel(v)?.name || ctx.byId(v)?.name || '—') : arg === 'secs' ? `${v} วินาที`
        : arg === 'player' ? ctx.chanByKey(v)?.name || '—' : arg === 'pad' ? ctx.padChannel()?.pads[+v]?.name || `ปุ่ม ${+v + 1}` : '';
      return what ? `${label}: ${what}` : label;
    };
    function renderMacros() {
      const box = $('#macro-list');
      if (!box) return;
      box.innerHTML = macros.length ? macros.map((m, i) => `
        <div class="macro-row ${macroRun.id === m.id ? 'is-running' : ''}" data-macro="${m.id}">
          <button type="button" class="macro-run" title="${esc(m.steps.map(macroLabel).join(' → ') || 'ยังไม่มีขั้นตอน')}">
            <b>${esc(m.name)}</b><small>${m.steps.length} ขั้นตอน${m.key ? ` · ${m.key}` : ''}${m.at ? ` · เริ่มเอง ${m.at}` : ''}${i < 8 ? ` · MIDI Macro ${i + 1}` : ''}</small>
            <span class="macro-progress"></span></button>
          <button type="button" class="mini macro-edit" title="แก้ไข Macro">${icon('edit')}</button>
        </div>`).join('') : '<p class="note">ยังไม่มี Macro — สร้างเพื่อทำหลายอย่างในปุ่มเดียว เช่น “เปิดรายการ”: โลโก้ขึ้น → เริ่มบันทึก → เปลี่ยนเป็นกล้อง 1 แบบ AUTO</p>';
      const m = macros.find(x => x.id === macroRun.id);
      if (m) paintMacroProgress(m);
    }
    function paintMacroProgress(m) {
      const el = $(`.macro-row[data-macro="${m.id}"] .macro-progress`);
      if (el) el.style.width = `${Math.round((macroRun.step + 1) / Math.max(1, m.steps.length) * 100)}%`;
    }
    function bindMacroPane() {
      renderMacros();
      $('#macro-add').addEventListener('click', () => openMacroDialog(null));
      $('#macro-list').addEventListener('click', e => {
        const row = e.target.closest('.macro-row');
        const m = row && macros.find(x => x.id === row.dataset.macro);
        if (!m) return;
        if (e.target.closest('.macro-edit')) openMacroDialog(m);
        else if (e.target.closest('.macro-run')) runMacro(m);
      });
    }
    async function openMacroDialog(m) {
      let switchTo = null;
      const draft = m ? { ...m, steps: m.steps.map(st => ({ ...st })) } : { id: uid(), name: `Macro ${macros.length + 1}`, key: '', at: '', steps: [{ a: 'auto', v: '' }] };
      const opts = arg => {
        if (arg === 'input') return ctx.inputs.map((x, i) => [x.id, `${i + 1}. ${x.name}`]);
        if (arg === 'media') return ctx.inputs.filter(x => x.type === 'media' || x.type === 'playlist').map(x => [x.id, x.name]);
        if (arg === 'ovl') return ctx.ovl.map((c, i) => [String(i), `ช่อง ${c.n}${ctx.byId(c.inputId) ? ` (${ctx.byId(c.inputId).name})` : ''}`]);
        if (arg === 'effect') return ctx.TRANSITIONS.map(t => [t, t.toUpperCase()]);
        if (arg === 'audio') return [['master', 'Master'], ...ctx.audioChanOptions()];
        if (arg === 'player') return ctx.audio.channels.filter(c => c.kind === 'player' || c.kind === 'url').map(c => [ctx.chanKey(c), c.name]);
        if (arg === 'pad') return ctx.PAD_SLOTS.map(i => [String(i), `ปุ่ม ${i + 1}${ctx.padChannel()?.pads[i] ? ` (${ctx.padChannel().pads[i].name})` : ''}`]);
        return [];
      };
      const rowHtml = (st, i) => {
        const arg = MACRO_ACTIONS[st.a][1], list = opts(arg);
        if (arg && arg !== 'secs' && !list.some(([k]) => k === st.v)) st.v = list[0] ? list[0][0] : '';
        return `<div class="mstep" data-i="${i}" draggable="true"><span class="mstep-grip" aria-hidden="true" title="ลากเพื่อสลับลำดับ">⋮⋮</span><span class="mstep-n">${i + 1}</span>
          <select class="select" data-k="a">${Object.entries(MACRO_ACTIONS).map(([k, [l]]) => `<option value="${k}" ${k === st.a ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${arg === 'secs' ? `<input class="input mono" data-k="v" type="number" min="0.1" max="3600" step="0.1" value="${st.v || 1}">`
            : arg ? `<select class="select" data-k="v">${list.map(([k, l]) => `<option value="${esc(k)}" ${k === st.v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : '<span></span>'}
          <span class="mstep-btns"><button type="button" class="mini" data-mv="-1" title="ขึ้น">↑</button><button type="button" class="mini" data-mv="1" title="ลง">↓</button><button type="button" class="mini danger" data-rm title="ลบขั้นตอน">✕</button></span></div>`;
      };
      const r = await dialog({
        title: m ? `แก้ไข Macro — ${m.name}` : 'สร้าง Macro',
        wide: true,
        body: `<p class="note mc-sub">กดปุ่มเดียว ทำหลายขั้นต่อกัน · สั่งจากคีย์ F1–F12, MIDI, รีโมต หรือเวลาที่ตั้งไว้</p>
          <div class="mc-wrap"><nav class="mc-list" aria-label="Macro ทั้งหมด">${[...macros, ...(m ? [] : [draft])].map(x => `<button type="button" class="mc-item ${x.id === draft.id ? 'is-on' : ''}" data-mc="${esc(x.id)}"><b>${esc(x.name)}</b>${x.key ? `<kbd>${esc(x.key)}</kbd>` : ''}<small>${x.steps.length} ขั้นตอน${x.at ? ` · เริ่มเอง ${esc(x.at)}` : ''}</small></button>`).join('')}
            <button type="button" class="btn btn-sm mc-new" data-mc="">+ Macro ใหม่</button></nav><div class="mc-edit">
          <div class="field-row">
            <label class="field"><span>ชื่อ</span><input name="mname" class="input" maxlength="40" value="${esc(draft.name)}"></label>
            <label class="field"><span>ปุ่มลัด</span><select name="mkey" class="select">${MACRO_KEYS.map(k => `<option value="${k}" ${k === draft.key ? 'selected' : ''}>${k || '— ไม่มี —'}</option>`).join('')}</select></label>
            <label class="field"><span>เริ่มเองเวลา (ไม่บังคับ)</span><input name="mat" class="input mono" type="time" value="${draft.at}"></label>
          </div>
          <div class="field"><span>ขั้นตอน <small class="note-inline">ลากเพื่อสลับลำดับ</small></span><div class="msteps"></div>
            <button type="button" class="btn btn-sm mstep-add">+ เพิ่มขั้นตอน</button></div>
          <p class="note">กด Macro อีกครั้งระหว่างทำงาน = หยุด · “รอ” ใช้เว้นจังหวะ เช่น โลโก้ขึ้น → รอ 3 วินาที → ตัดเข้ากล้อง · Macro 1–8 ตั้งปุ่ม MIDI ได้ที่ ตั้งค่า → ควบคุม · เวลาเริ่มเองทำงานเมื่อเปิดแอปค้างไว้</p></div></div>`,
        actions: [...(m ? [{ label: 'ลบ Macro นี้', value: 'delete' }] : []), { label: '▶ ทดลองรัน', value: 'try' }, { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
        onOpen(modal, close) {
          modal.classList.add('mc-modal');
          // ทดลองรัน: ทำตามขั้นตอนที่แก้อยู่ (ยังไม่บันทึก) — หน้าต่างไม่ปิด
          const tb = [...$$('.modal-foot .btn', modal)].find(x => (x.dataset.label || '').includes('ทดลองรัน')), tc = tb.cloneNode(true);
          tb.replaceWith(tc);
          tc.addEventListener('click', () => { const [x] = sanitizeMacros([{ ...draft, name: draft.name }]); if (x) runMacro(x); });
          // เลือก Macro อื่นจากรายการ = บันทึกอันนี้แล้วเปิดอันนั้น
          $('.mc-list', modal).addEventListener('click', e => { const it = e.target.closest('[data-mc]'); if (!it || it.dataset.mc === draft.id) return; switchTo = it.dataset.mc; close('switch'); });
          const box = $('.msteps', modal);
          const paint = () => { box.innerHTML = draft.steps.map(rowHtml).join('') || '<p class="note">ยังไม่มีขั้นตอน</p>'; };
          paint();
          box.addEventListener('change', e => {
            const row = e.target.closest('.mstep'), st = row && draft.steps[+row.dataset.i];
            if (!st) return;
            if (e.target.dataset.k === 'a') { st.a = e.target.value; st.v = st.a === 'wait' ? 1 : ''; paint(); }
            else st.v = e.target.type === 'number' ? +e.target.value : e.target.value;
          });
          box.addEventListener('click', e => {
            const row = e.target.closest('.mstep');
            if (!row) return;
            const i = +row.dataset.i;
            if (e.target.closest('[data-rm]')) { draft.steps.splice(i, 1); paint(); }
            const mv = e.target.closest('[data-mv]');
            if (mv) { const j = i + +mv.dataset.mv; if (j >= 0 && j < draft.steps.length) { [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]]; paint(); } }
          });
          $('.mstep-add', modal).addEventListener('click', () => { if (draft.steps.length < 60) { draft.steps.push({ a: 'wait', v: 2 }); paint(); } });
          let dragI = -1;
          box.addEventListener('dragstart', e => { const row = e.target.closest('.mstep'); if (!row) return; dragI = +row.dataset.i; row.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; });
          box.addEventListener('dragover', e => { if (dragI < 0) return; e.preventDefault(); $$('.mstep', box).forEach(r => r.classList.toggle('is-over', r === e.target.closest('.mstep'))); });
          box.addEventListener('drop', e => {
            e.preventDefault();
            const row = e.target.closest('.mstep');
            if (row && dragI >= 0) { const [st] = draft.steps.splice(dragI, 1); draft.steps.splice(+row.dataset.i, 0, st); }
            dragI = -1; paint();
          });
          box.addEventListener('dragend', () => { dragI = -1; $$('.mstep', box).forEach(r => r.classList.remove('is-drag', 'is-over')); });
          // ชื่อในรายการตามที่พิมพ์
          $('[name=mname]', modal).addEventListener('input', e => { const it = $(`.mc-item[data-mc="${draft.id}"] b`, modal); if (it) it.textContent = e.target.value || draft.name; });
        }
      });
      if (r?.value === 'delete') {
        if (macroRun.id === m.id) macroRun.cancel = true;
        macros.splice(macros.indexOf(m), 1);
        renderMacros();
        toast(`ลบ Macro “${m.name}” แล้ว`);
        return;
      }
      if (r?.value !== 'save' && r?.value !== 'switch') return;
      const f = r.form;
      if (f.mkey.value && macros.some(x => x.id !== draft.id && x.key === f.mkey.value)) { toast(`ปุ่ม ${f.mkey.value} ใช้กับ Macro อื่นแล้ว`, 'warn'); return; }
      const [clean] = sanitizeMacros([{ ...draft, name: f.mname.value.trim() || draft.name, key: f.mkey.value, at: f.mat.value }]);
      if (m) Object.assign(m, clean); else macros.push(clean);
      renderMacros();
      ctx.show.autosave(true);
      if (r.value === 'switch') openMacroDialog(macros.find(x => x.id === switchTo) || null);
    }

    return { bindMacroPane, macroClock, macroRun, macros, renderMacros, runMacro, sanitizeMacros };
  };
})(window.WebMix = window.WebMix || {});
