/* live captions */
(function (WM) {
  'use strict';
  const { $, $$, FONT, chat: chatLib, clamp, downloadBlob, esc, fmtDuration, pad2, toast } = WM;

  // studio = สิ่งที่ใช้จากสตูดิโอ (app.js): addInput, dialog, refreshSourceSelects, renderInputs, setChannel, toggleInputOverlay, audio, audioChanOptions, chanByKey, inputs, onOverlay, ovl, state
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน studio.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createCaptions = function (studio) {
    const { addInput, dialog, refreshSourceSelects, renderInputs, setChannel, toggleInputOverlay } = studio;
    // คำบรรยายสด: ระบบรู้จำเสียงของเบราว์เซอร์ (Web Speech API — Chrome / Edge / Safari ส่งเสียงไปประมวลผลบนเซิร์ฟเวอร์ของผู้ผลิตเบราว์เซอร์)
    // ฟังจากไมค์หลักของเครื่อง หรือช่องเสียงในมิกเซอร์ (เบราว์เซอร์รุ่นใหม่รับ MediaStreamTrack ได้ — รุ่นเก่าใช้ไมค์หลักแทน)
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const CAP_LANGS = { 'th-TH': 'ไทย', 'en-US': 'English (US)', 'en-GB': 'English (UK)', 'zh-CN': '中文', 'ja-JP': '日本語', 'ko-KR': '한국어', 'lo-LA': 'ລາວ', 'my-MM': 'မြန်မာ', 'vi-VN': 'Tiếng Việt' };
    const CAP_SIZES = { s: ['เล็ก', 28], m: ['กลาง', 36], l: ['ใหญ่', 46] };
    const CAP_POS = { bottom: 'ล่างจอ', top: 'บนจอ' };
    // แปลภาษา (แบบ 69): ตัวแปลภาษาในตัวของ Chrome (Translator API — แปลในเครื่อง) · ไม่มีตัวแปล = แสดงเฉพาะต้นฉบับ
    const CAP_TR = { '': 'ไม่แปล', en: 'English', th: 'ไทย', zh: '中文', ja: '日本語', ko: '한국어', vi: 'Tiếng Việt', fr: 'Français', de: 'Deutsch', es: 'Español' };
    const CAP_SHOW = { both: 'ต้นฉบับ + คำแปล', tr: 'คำแปลอย่างเดียว', orig: 'ต้นฉบับอย่างเดียว' };
    function sanitizeCap(c) {
      c = c || {};
      const lang = CAP_LANGS[c.lang] ? c.lang : 'th-TH';
      const tr = CAP_TR[c.tr] && c.tr !== lang.split('-')[0] ? c.tr : '';
      return { lang, source: typeof c.source === 'string' && c.source ? c.source.slice(0, 80) : 'mic', size: CAP_SIZES[c.size] ? c.size : 'm',
        pos: CAP_POS[c.pos] ? c.pos : 'bottom', lines: clamp(+c.lines || 2, 1, 3), clearSec: clamp(+c.clearSec || 5, 2, 30), tr, show: CAP_SHOW[c.show] ? c.show : 'both' };
    }
    // ตัวแปลต่อคู่ภาษา: state = checking | none (ไม่มี API) | unavailable | downloadable | downloading | available | error
    const capTr = {};
    function capTrEntry(lang, tr) {
      const src = String(lang || '').split('-')[0];
      if (!tr || tr === src) return null;
      return capTr[src + '>' + tr] || (capTr[src + '>' + tr] = { src, dst: tr, state: 'checking', progress: 0 });
    }
    // activate = มาจากการกดของผู้ใช้ (Chrome ต้องการเพื่อดาวน์โหลดภาษาครั้งแรก)
    function capTranslator(lang, tr, activate) {
      const e = capTrEntry(lang, tr);
      if (!e) return Promise.resolve(null);
      if (e.t) return Promise.resolve(e.t);
      const T = window.Translator;
      if (!T?.availability || !T.create) { e.state = 'none'; return Promise.resolve(null); }
      if (e.p) return e.p;
      e.p = (async () => {
        // บางเบราว์เซอร์มี API แต่ไม่ตอบ (เช่น headless) — รอไม่เกิน 5 วินาทีแล้วถือว่าใช้ไม่ได้
        try { e.state = await Promise.race([T.availability({ sourceLanguage: e.src, targetLanguage: e.dst }), new Promise(r => setTimeout(() => r('unavailable'), 5000))]); } catch (err) { e.state = 'unavailable'; }
        if (e.state === 'unavailable' || e.state !== 'available' && !activate) return null;
        if (e.state !== 'available') e.state = 'downloading';
        e.t = await T.create({ sourceLanguage: e.src, targetLanguage: e.dst, monitor(m) { m.addEventListener('downloadprogress', ev => { e.progress = ev.loaded || 0; }); } });
        e.state = 'available';
        return e.t;
      })().catch(err => { e.state = 'error'; e.err = err?.message || String(err); return null; }).finally(() => { e.p = null; });
      return e.p;
    }
    const capTrState = c => capTrEntry(c.lang, c.tr)?.state || '';
    function capTranslate(inp, entry) {
      const c = inp.cap;
      capTranslator(c.lang, c.tr).then(t => t && t.translate(entry.text)).then(out => {
        const r = inp.capRun;
        if (!out || !r || inp.cap.tr !== c.tr) return;
        entry.tr = String(out).trim(); entry.trLang = c.tr;
        r.trLines.push(entry.tr); if (r.trLines.length > 20) r.trLines.shift();
        r.lastAt = performance.now();
      }).catch(() => {});
    }
    function addCaptionsInput() {
      const n = studio.inputs.filter(i => i.type === 'captions').length + 1;
      const inp = addInput({ type: 'captions', name: n > 1 ? `CAPTIONS ${n}` : 'CAPTIONS', cap: sanitizeCap({}) });
      openCaptionsDialog(inp, true);
      return inp;
    }
    // เสียงจากมิกเซอร์ → MediaStreamTrack ให้ตัวรู้จำเสียง (Master = เสียงรวมที่ออกอากาศ)
    function captionTrack(inp) {
      const src = inp.cap.source;
      if (src === 'mic' || !studio.audio.ensure()) return null;
      const r = inp.capRun;
      if (!r.dest) r.dest = studio.audio.ctx.createMediaStreamDestination();
      const node = src === 'master' ? studio.audio.post : studio.chanByKey(src)?.afvGain;
      if (!node) return null;
      try { node.connect(r.dest); } catch (e) { return null; }
      r.tapped = node;
      return r.dest.stream.getAudioTracks()[0] || null;
    }
    function captionStart(inp) {
      if (!SpeechRec) {
        toast('เบราว์เซอร์/แอปนี้ไม่มีระบบแปลงเสียงเป็นข้อความ — ใช้หน้าเว็บ WebMix ใน Chrome, Edge หรือ Safari', 'error', 8000);
        return;
      }
      const r = inp.capRun || (inp.capRun = { lines: [], interim: '', lastAt: 0, log: [] });
      if (!r.trLines) r.trLines = [];
      if (r.on) return;
      r.on = true; r.error = ''; r.fails = 0;
      if (inp.cap.tr) capTranslator(inp.cap.lang, inp.cap.tr, true);
      const go = () => {
        if (!r.on || inp.removed) return;
        const rec = new SpeechRec();
        rec.lang = inp.cap.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
        rec.onresult = e => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = String(e.results[i][0].transcript || '').trim();
            if (!t) continue;
            if (e.results[i].isFinal) {
              const entry = { text: t, at: Date.now() };
              r.lines.push(t); r.log.push(entry); if (r.lines.length > 20) r.lines.shift();
              if (inp.cap.tr) capTranslate(inp, entry);
            }
            else interim += (interim ? ' ' : '') + t;
          }
          r.interim = interim;
          r.lastAt = performance.now();
          r.fails = 0;
        };
        rec.onerror = e => {
          const fatal = { 'not-allowed': 'ไม่ได้รับอนุญาตให้ใช้ไมค์', 'service-not-allowed': 'เบราว์เซอร์/แอปนี้ไม่อนุญาตบริการแปลงเสียง — ใช้หน้าเว็บใน Chrome / Edge', 'language-not-supported': 'ไม่รองรับภาษานี้', 'audio-capture': 'เปิดไมค์ไม่ได้' }[e.error];
          if (fatal) { r.on = false; r.error = fatal; toast(`คำบรรยายสด: ${fatal}`, 'error', 7000); renderInputs(); }
          else if (e.error === 'network') r.error = 'ต่อบริการแปลงเสียงไม่ได้ (ต้องต่ออินเทอร์เน็ต) — กำลังลองใหม่';
        };
        // Chrome หยุดฟังเองเมื่อเงียบนาน/ครบเวลา — เริ่มใหม่ทันทีระหว่างที่ยังเปิดอยู่ (ล้มติดกันหลายครั้ง = รอนานขึ้น)
        rec.onend = () => { if (r.rec === rec && r.on) setTimeout(go, Math.min(5000, 250 * 2 ** (r.fails++))); };
        r.rec = rec;
        const track = captionTrack(inp);
        try { track ? rec.start(track) : rec.start(); }
        catch (err) { try { rec.start(); } catch (err2) { r.on = false; r.error = err2.message; toast(`คำบรรยายสด: ${err2.message}`, 'error'); } }
      };
      go();
    }
    function captionStop(inp) {
      const r = inp.capRun;
      if (!r) return;
      r.on = false;
      try { r.rec?.stop(); } catch (e) {}
      try { r.tapped?.disconnect(r.dest); } catch (e) {}
      r.tapped = null;
      r.interim = '';
    }
    // ข้อความที่ขึ้นจอ: ประโยคล่าสุด + ส่วนที่กำลังพูด — เงียบเกินเวลาที่ตั้งแล้วหายไป
    function captionText(inp) {
      const r = inp.capRun;
      if (!r || (!r.lines.length && !r.interim)) return '';
      if (performance.now() - r.lastAt > inp.cap.clearSec * 1000) return '';
      return [...r.lines.slice(-3), r.interim].filter(Boolean).join(' ');
    }
    // คำแปลที่ขึ้นจอ (ช้ากว่าต้นฉบับเล็กน้อย) — ว่างเมื่อไม่แปล/ตัวแปลใช้ไม่ได้
    function captionTr(inp) {
      const r = inp.capRun, c = inp.cap;
      if (!c.tr || c.show === 'orig' || !r?.trLines?.length) return '';
      if (performance.now() - r.lastAt > c.clearSec * 1000) return '';
      return r.trLines.slice(-2).join(' ');
    }
    function drawCaptions(ctx, w, h, inp) {
      const orig = captionText(inp), tr = captionTr(inp), c = inp.cap;
      // คำแปลอย่างเดียว: ระหว่างรอคำแปลแรก/ตัวแปลใช้ไม่ได้ แสดงต้นฉบับแทน
      const trWorks = c.tr && ['available', 'downloading'].includes(capTrState(c));
      const main = c.show === 'tr' && trWorks ? tr : tr || orig;
      if (!main) return;
      const sub = tr && c.show === 'both' ? orig : '';
      const s = h / 720, size = CAP_SIZES[c.size][1] * s, lineH = size * 1.32, subSize = size * 0.72, subH = subSize * 1.35;
      ctx.save();
      const maxW = w * 0.84;
      // ตัดบรรทัดทั้งหมด แล้วแสดงเฉพาะบรรทัดท้าย ๆ (ข้อความใหม่อยู่ล่างสุด) · ต้นฉบับ (ตัวเล็ก สีเทา) อยู่เหนือคำแปล
      ctx.font = `500 ${subSize}px ${FONT}`;
      const subLines = sub ? chatLib.wrapLines(ctx, sub, maxW - 40 * s, 50).slice(-1) : [];
      const subW = subLines.length ? ctx.measureText(subLines[0]).width : 0;
      ctx.font = `600 ${size}px ${FONT}`;
      const lines = chatLib.wrapLines(ctx, main, maxW - 40 * s, 50).slice(-c.lines);
      const boxW = Math.min(maxW, Math.max(subW, ...lines.map(l => ctx.measureText(l).width)) + 40 * s), boxH = lines.length * lineH + subLines.length * subH + 20 * s;
      const x = (w - boxW) / 2, y = c.pos === 'top' ? h * 0.06 : h * 0.93 - boxH;
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 8 * s); else ctx.rect(x, y, boxW, boxH);
      ctx.fill();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let ty = y + 10 * s;
      if (subLines.length) { ctx.font = `500 ${subSize}px ${FONT}`; ctx.fillStyle = '#c9d1db'; ctx.fillText(subLines[0], w / 2, ty + subH / 2); ty += subH; ctx.font = `600 ${size}px ${FONT}`; }
      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, w / 2, ty + lineH * (i + 0.5)));
      ctx.restore();
    }
    // ไฟล์คำบรรยาย .srt (เวลาเทียบกับประโยคแรก) สำหรับใส่ในคลิปที่บันทึกไว้
    function captionSrt(log, field = 'text') {
      log = field === 'text' ? log : log.filter(e => e[field]);
      if (!log.length) return '';
      const t0 = log[0].at - 2500;
      const ts = ms => { ms = Math.max(0, ms); const hh = Math.floor(ms / 3600000), mm = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60; return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)},${String(ms % 1000).padStart(3, '0')}`; };
      return log.map((e, i) => {
        const start = (i ? log[i - 1].at : t0 + 500) - t0, end = Math.min(e.at - t0 + 2000, log[i + 1] ? log[i + 1].at - t0 : Infinity);
        return `${i + 1}\n${ts(start)} --> ${ts(Math.max(end, start + 800))}\n${e[field]}\n`;
      }).join('\n');
    }
    // ปุ่ม “แสดงบน Program / ซ่อนจาก Program” ในหน้าต่างแก้ไข — ใช้ช่อง Overlay ว่าง ไม่ปิดหน้าต่าง
    const onAirLabel = inp => studio.ovl.some(c => c.inputId === inp.id && c.on) ? 'ซ่อนจาก Program' : 'แสดงบน Program';
    function bindOnAirButton(modal, inp) {
      const btn = [...$$('.modal-foot .btn', modal)].find(b => b.dataset.label === 'แสดงบน Program' || b.dataset.label === 'ซ่อนจาก Program');
      if (!btn) return;
      const clone = btn.cloneNode(true);
      btn.replaceWith(clone);
      clone.addEventListener('click', () => {
        const on = studio.ovl.findIndex(c => c.inputId === inp.id && c.on);
        if (on >= 0) setChannel(on, false);
        else {
          const free = studio.ovl.findIndex(o => !o.on && (!o.inputId || o.inputId === inp.id));
          studio.audio.ensure();
          toggleInputOverlay(inp.id, free >= 0 ? free : 0);
        }
        clone.textContent = onAirLabel(inp);
      });
    }

    // คำบรรยายสด: ตัวอย่างบนภาพ Program · ข้อความล่าสุดพร้อมเวลา · ฟังจาก · การแสดงผล · ไฟล์ .srt / .txt
    async function openCaptionsDialog(inp, fresh) {
      const before = { ...inp.cap }, c = inp.cap;
      const chans = studio.audioChanOptions();
      const log = () => inp.capRun?.log || [];
      const t0 = () => log()[0]?.at || Date.now();
      const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const r = await dialog({
        title: 'คำบรรยายสด',
        wide: true,
        body: `<div class="cp-wrap">
          <div class="cp-left">
            ${SpeechRec ? '' : '<p class="note warn">เบราว์เซอร์/แอปนี้ไม่มีระบบแปลงเสียงเป็นข้อความ — เปิดหน้าเว็บ WebMix ใน Chrome, Edge หรือ Safari</p>'}
            <div class="cp-prev"><canvas width="960" height="540" aria-label="ตัวอย่างคำบรรยายบนภาพ Program"></canvas></div>
            <section class="cp-card"><div class="cp-h"><h3>ข้อความล่าสุด</h3><span class="cp-state"></span></div><div class="cp-log"></div></section>
          </div>
          <div class="cp-right">
            <section class="cp-card"><div class="cp-h"><h3>ฟังจาก</h3></div>
              <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
              <div class="cp-two">
                <label class="field"><span>ภาษาที่พูด</span><select name="lang" class="select">${Object.entries(CAP_LANGS).map(([k, l]) => `<option value="${k}" ${k === c.lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label class="field"><span>แหล่งเสียง</span><select name="source" class="select">
                  <option value="mic">ไมค์หลักของเครื่อง</option><option value="master" ${c.source === 'master' ? 'selected' : ''}>Master (เสียงรวมที่ออกอากาศ)</option>
                  ${chans.map(([k, n]) => `<option value="${esc(k)}" ${k === c.source ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
              </div></section>
            <section class="cp-card"><div class="cp-h"><h3>แปลภาษา</h3></div>
              <label class="field"><span>แปลเป็น</span><select name="tr" class="select">${Object.entries(CAP_TR).map(([k, l]) => `<option value="${k}" ${k === c.tr ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <div class="cp-seg cp-show" role="radiogroup" aria-label="แสดงบนจอ">${Object.entries(CAP_SHOW).map(([k, l]) => `<label><input type="radio" name="show" value="${k}" ${k === c.show ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
              <div class="cp-tr" aria-live="polite"></div>
              <p class="note">คำแปลขึ้นช้ากว่าต้นฉบับราว 1 วินาที · เบราว์เซอร์ที่ไม่มีตัวแปลในตัว (Safari, Firefox, แอป Linux) แสดงเฉพาะต้นฉบับ</p></section>
            <section class="cp-card"><div class="cp-h"><h3>การแสดงผล</h3></div>
              <div class="cp-seg" role="radiogroup" aria-label="จำนวนบรรทัด">${[1, 2, 3].map(n => `<label><input type="radio" name="lines" value="${n}" ${n === c.lines ? 'checked' : ''}><span>${n} บรรทัด</span></label>`).join('')}</div>
              <div class="cp-two">
                <label class="field"><span>ขนาดตัวอักษร</span><select name="size" class="select">${Object.entries(CAP_SIZES).map(([k, [l]]) => `<option value="${k}" ${k === c.size ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label class="field"><span>ตำแหน่ง</span><select name="pos" class="select">${Object.entries(CAP_POS).map(([k, l]) => `<option value="${k}" ${k === c.pos ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              </div>
              <label class="field"><span>หายไปเมื่อเงียบ</span><select name="clearSec" class="select">${[3, 5, 8, 15].map(n => `<option value="${n}" ${n === c.clearSec ? 'selected' : ''}>${n} วินาที</option>`).join('')}</select></label></section>
            <section class="cp-card"><div class="cp-h"><h3>ไฟล์คำบรรยาย</h3><span class="cp-count"></span></div>
              <div class="cp-btns"><button type="button" class="btn btn-sm cap-srt">ดาวน์โหลด .srt</button><button type="button" class="btn btn-sm cap-srt-tr" hidden>ดาวน์โหลด .srt (คำแปล)</button><button type="button" class="btn btn-sm cap-txt">ดาวน์โหลด .txt</button><button type="button" class="btn btn-sm cap-clear">ล้าง</button></div>
              <p class="note">เก็บทุกประโยคที่ฟังได้ เอาไปใส่คลิปที่บันทึกไว้ได้ · ต้องต่ออินเทอร์เน็ต · ความแม่นยำขึ้นกับไมค์และเสียงรบกวน</p></section>
          </div>
        </div>`,
        actions: [{ label: inp.capRun?.on ? 'หยุดฟัง' : 'เริ่มฟัง', value: 'run' }, { label: onAirLabel(inp), value: 'pgm', danger: true }, { label: 'ยกเลิก' }, { label: fresh ? 'บันทึกแล้วเริ่มฟัง' : 'บันทึก', primary: true, value: 'save' }],
        onOpen(modal) {
          modal.classList.add('cp-modal');
          const f = $('form', modal).elements;
          const live = () => sanitizeCap({ lang: f.lang.value, source: f.source.value, size: f.size.value, pos: f.pos.value, lines: f.lines.value, clearSec: f.clearSec.value, tr: f.tr.value, show: f.show.value });
          // เปลี่ยนรูปแบบแล้วเห็นผลทันที (ยกเลิก = คืนค่า)
          modal.addEventListener('change', e => {
            if (['size', 'pos', 'lines', 'clearSec', 'show'].includes(e.target.name)) Object.assign(inp.cap, { size: live().size, pos: live().pos, lines: live().lines, clearSec: live().clearSec, show: live().show });
            if (e.target.name === 'tr' || e.target.name === 'lang') {
              if (e.target.name === 'tr') { inp.cap.tr = live().tr; if (inp.capRun) inp.capRun.trLines = []; }
              capTranslator(f.lang.value, f.tr.value, false).then(() => { sig = ''; });
              sig = '';
            }
          });
          // สถานะตัวแปล: พร้อม / ต้องดาวน์โหลด / กำลังดาวน์โหลด / ไม่มีในเบราว์เซอร์นี้
          const trStatus = () => {
            const l = live(), e = capTrEntry(l.lang, l.tr), name = CAP_TR[l.tr];
            if (!l.tr) return ['off', 'ไม่แปล — แสดงเฉพาะต้นฉบับ', ''];
            if (!e || e.state === 'checking') return ['wait', 'กำลังตรวจตัวแปลภาษาในเครื่อง…', ''];
            return {
              none: ['bad', 'เบราว์เซอร์นี้ไม่มีตัวแปลภาษาในตัว — แสดงเฉพาะต้นฉบับ (ใช้ Chrome รุ่นใหม่บนคอมพิวเตอร์)', ''],
              unavailable: ['bad', `แปล ${CAP_LANGS[l.lang]} → ${name} ในเครื่องนี้ไม่ได้ — แสดงเฉพาะต้นฉบับ`, ''],
              error: ['bad', `เปิดตัวแปลไม่ได้: ${e.err || ''} — แสดงเฉพาะต้นฉบับ`, ''],
              downloadable: ['wait', `ต้องดาวน์โหลดภาษา ${name} ครั้งแรก (ทำครั้งเดียว)`, '<button type="button" class="btn btn-sm" data-cap="dl">ดาวน์โหลดภาษา</button>'],
              downloading: ['wait', `กำลังดาวน์โหลดภาษา ${name}… ${Math.round(e.progress * 100)}%`, ''],
              available: ['ok', `แปลในเครื่องนี้ · ใช้ตัวแปลภาษาในตัวของ Chrome · ไม่ส่งข้อความออกนอกเครื่อง · ภาษา ${name} พร้อมใช้`, '']
            }[e.state] || ['wait', '', ''];
          };
          modal.addEventListener('click', e => {
            if (e.target.closest('[data-cap=dl]')) { const l = live(); capTranslator(l.lang, l.tr, true).then(() => { sig = ''; }); setTimeout(() => { sig = ''; }, 50); }
          });
          capTranslator(c.lang, c.tr, false).then(() => { sig = ''; });
          const pc = $('.cp-prev canvas', modal).getContext('2d');
          let sig = '';
          const tick = () => {
            if (!modal.isConnected) return;
            pc.fillStyle = '#23324a'; pc.fillRect(0, 0, 960, 540);
            try { const src = $('#pgm-canvas'); if (src) pc.drawImage(src, 0, 0, 960, 540); } catch (e) {}
            if (!studio.onOverlay(inp.id) && inp.id !== studio.state.programId) {
              const demo = !inp.capRun?.lines?.length && !inp.capRun?.interim;
              drawCaptions(pc, 960, 540, demo ? { ...inp, capRun: { lines: ['ตัวอย่างคำบรรยายสดบนจอ', 'แสดงตามขนาดและตำแหน่งที่เลือก'], trLines: inp.cap.tr ? ['Sample live captions on screen, in the size and position you chose'] : [], interim: '', lastAt: performance.now() } } : inp);
            }
            const L = log(), run = inp.capRun?.on;
            const ts = trStatus();
            const now = `${L.length}|${L.filter(e => e.tr).length}|${run}|${inp.capRun?.interim || ''}|${ts[1]}`;
            if (now !== sig) {
              sig = now;
              $('.cp-tr', modal).innerHTML = `<span class="cp-tr-ic is-${ts[0]}" aria-hidden="true">${ts[0] === 'ok' ? 'OK' : ts[0] === 'bad' ? '!' : ts[0] === 'off' ? '–' : '…'}</span><span class="cp-tr-t">${esc(ts[1])}</span>${ts[2]}`;
              $('.cap-srt-tr', modal).hidden = !L.some(e => e.tr);
              $('.cp-state', modal).innerHTML = run ? '<span class="cp-on">กำลังฟัง</span>' : '<span class="cp-off">หยุดอยู่</span>';
              $('.cp-count', modal).textContent = L.length ? `${L.length} ประโยค` : '';
              const t = t0();
              $('.cp-log', modal).innerHTML = (L.slice(-6).map(e => `<div><span class="mono">${fmtDuration(e.at - t)}</span> ${esc(e.text)}${e.tr ? `<span class="cp-tr-line">${esc(e.tr)}</span>` : ''}</div>`).join('')
                + (inp.capRun?.interim ? `<div class="cp-interim">${esc(inp.capRun.interim)}…</div>` : '')) || '<p class="note">กด “เริ่มฟัง” แล้วพูดเพื่อทดลอง</p>';
            }
            setTimeout(tick, 150);
          };
          tick();
          $('.cap-srt', modal).addEventListener('click', () => { if (!log().length) return toast('ยังไม่มีข้อความ', 'warn'); downloadBlob(new Blob([captionSrt(log())], { type: 'text/plain' }), `webmix-captions-${stamp()}.srt`); });
          $('.cap-srt-tr', modal).addEventListener('click', () => downloadBlob(new Blob([captionSrt(log(), 'tr')], { type: 'text/plain' }), `webmix-captions-${log().find(e => e.tr)?.trLang || 'tr'}-${stamp()}.srt`));
          $('.cap-txt', modal).addEventListener('click', () => { if (!log().length) return toast('ยังไม่มีข้อความ', 'warn'); downloadBlob(new Blob([log().map(e => `[${new Date(e.at).toLocaleTimeString('th-TH')}] ${e.text}`).join('\n')], { type: 'text/plain' }), `webmix-captions-${stamp()}.txt`); });
          $('.cap-clear', modal).addEventListener('click', () => { log().length = 0; sig = ''; });
          bindOnAirButton(modal, inp);
          const rb = [...$$('.modal-foot .btn', modal)].find(b => b.dataset.label === 'เริ่มฟัง' || b.dataset.label === 'หยุดฟัง');
          const rc = rb.cloneNode(true); rb.replaceWith(rc);
          rc.addEventListener('click', () => {
            if (inp.capRun?.on) captionStop(inp);
            else { Object.assign(inp.cap, live()); captionStart(inp); }
            rc.textContent = inp.capRun?.on ? 'หยุดฟัง' : 'เริ่มฟัง';
            renderInputs();
          });
        }
      });
      if (r?.value !== 'save') { inp.cap = before; return; }
      const f = r.form;
      inp.name = String(f.name.value || '').trim().slice(0, 40) || inp.name;
      inp.cap = sanitizeCap({ lang: f.lang.value, source: f.source.value, size: f.size.value, pos: f.pos.value, lines: f.lines.value, clearSec: f.clearSec.value, tr: f.tr.value, show: f.show.value });
      if (inp.cap.tr && inp.capRun?.on) capTranslator(inp.cap.lang, inp.cap.tr, true);
      // ภาษา/ช่องเสียงเปลี่ยน → เริ่มฟังใหม่ด้วยค่าใหม่
      const restart = inp.capRun?.on && (before.lang !== inp.cap.lang || before.source !== inp.cap.source);
      if (restart) captionStop(inp);
      if ((fresh && !inp.capRun?.on) || restart) captionStart(inp);
      renderInputs(); refreshSourceSelects();
    }

    return { addCaptionsInput, captionSrt, captionStart, captionStop, captionText, captionTr, drawCaptions, openCaptionsDialog, sanitizeCap };
  };
})(window.WebMix = window.WebMix || {});
