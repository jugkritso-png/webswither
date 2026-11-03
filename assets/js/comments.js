/* คอมเมนต์ผู้ชม: เชื่อม Facebook, แหล่งภาพคอมเมนต์ และแผงคอมเมนต์ */
(function (WM) {
  'use strict';
  const { $, $$, chat: chatLib, esc, store, uid } = WM;

  // ctx = สิ่งที่ใช้จากสตูดิโอ (app.js): addInput, chatAdd, chatAnim, chatHide, chatShow, dialog, fbConnect, fbDisconnect, fbLogin, fbUseUserToken, openChatConnectDialog, refreshSourceSelects, renderChat, renderChatConn, renderInputs, CHAT_AUTOHIDE, chatFeed, defText, fb, inputs, onOverlay, state
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน ctx.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createComments = function (ctx) {
    const { addInput, chatAdd, chatAnim, chatHide, chatShow, dialog, fbConnect, fbDisconnect, fbLogin, fbUseUserToken, openChatConnectDialog, refreshSourceSelects, renderChat, renderChatConn, renderInputs } = ctx;
    async function openFacebookDialog() {
      const STEPS = ['เข้าสู่ระบบ Facebook', 'เลือกเพจ', 'ดึงคอมเมนต์'];
      await dialog({
        title: 'เชื่อมคอมเมนต์ Facebook', wide: true,
        body: `<div class="fb-grid">
          <div class="fb-main">
            <ol class="fb-steps" aria-label="ขั้นตอน"></ol>
            <section class="fb-acct" aria-label="บัญชี"><span class="fb-av" aria-hidden="true"></span><span class="fb-acct-t"><b></b><small></small></span><button type="button" class="btn" data-fb="login"></button></section>
            <details class="fb-adv" ${store.get('fb-appid', '') ? '' : 'open'}><summary>ตั้งค่าแอป Facebook</summary>
              <label class="field"><span>Facebook App ID (สร้างฟรีที่ developers.facebook.com → My Apps → Create App)</span><input name="appid" class="input mono" inputmode="numeric" autocomplete="off" placeholder="เช่น 1234567890123456" value="${esc(store.get('fb-appid', '') || '')}"></label>
              <p class="note">App ID ไม่ใช่รหัสลับ · เพิ่มโดเมนของหน้านี้ (${esc(location.host || 'localhost')}) ใน Facebook Login → Allowed Domains · ใช้แอปเดสก์ท็อปแล้วหน้าต่าง Facebook ไม่ขึ้น ให้วางโทเคนของเพจแทน (ใช้เฉพาะรอบนี้ ไม่บันทึก)</p>
              <label class="field"><span>หรือวางโทเคนของเพจ</span><span class="fb-tok"><input name="ptoken" class="input mono" type="password" autocomplete="off" placeholder="EAAG…"><button type="button" class="btn" data-fb="token">ใช้โทเคนนี้</button></span></label>
            </details>
            <section class="fb-pages" aria-label="เลือกเพจ"><b class="fb-h">เพจที่ไลฟ์</b><div class="fb-plist"></div></section>
            <section aria-label="ไลฟ์ที่ดึงคอมเมนต์"><b class="fb-h">ดึงคอมเมนต์จาก</b>
              <div class="fb-mode" role="group" aria-label="แหล่งคอมเมนต์"><button type="button" data-mode="auto">ไลฟ์ที่กำลังออกอากาศของเพจนี้ (อัตโนมัติ)</button><button type="button" data-mode="link">วางลิงก์วิดีโอไลฟ์</button></div>
              <input name="fbvideo" class="input mono fb-video" placeholder="https://www.facebook.com/…/videos/1234567890" value="${esc(ctx.fb.video)}" hidden>
            </section>
            <p class="fb-note">WebMix ขอสิทธิ์อ่านอย่างเดียว ไม่โพสต์หรือตอบแทนคุณ · Facebook ไม่ให้แอปอ่านคอมเมนต์ของไลฟ์จากโปรไฟล์ส่วนตัว ใช้ได้กับเพจเท่านั้น · ถอนสิทธิ์ได้ที่ ตั้งค่า Facebook → ธุรกิจที่เชื่อม</p>
            <p class="fb-err" role="alert" hidden></p>
          </div>
          <aside class="fb-side" aria-label="ตัวอย่างคอมเมนต์">
            <div class="fb-side-h"><b>คอมเมนต์ที่เข้ามา</b><span class="fb-poll"></span></div>
            <div class="fb-list"></div>
            <button type="button" class="btn btn-primary fb-go" data-fb="go">เริ่มดึงคอมเมนต์</button>
          </aside>
        </div>`,
        actions: [{ label: 'ตัดการเชื่อม Facebook', value: 'off' }, { label: 'เสร็จ', primary: true, value: 'ok' }],
        onOpen(modal, close) {
          modal.classList.add('fb-modal');
          const f = $('form', modal).elements, err = $('.fb-err', modal);
          const foot = $('.modal-foot', modal);
          const fn = document.createElement('span'); fn.className = 'fb-foot-note'; foot.insertBefore(fn, foot.lastElementChild);
          // ตัดการเชื่อมไม่ปิดหน้าต่าง
          const ob = foot.firstElementChild, off = ob.cloneNode(true); ob.replaceWith(off);
          off.addEventListener('click', () => { fbDisconnect(true); paint(); });
          let busy = '';
          const showErr = m => { err.textContent = m || ''; err.hidden = !m; };
          const paint = () => {
            const [st, text] = ctx.chatFeed.status.facebook;
            const on = st !== 'off', signed = !!ctx.fb.user;
            const step = on ? 2 : signed ? 1 : 0;
            $('.fb-steps', modal).innerHTML = STEPS.map((n, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-on' : ''}"><span>${i < step ? '✓' : i + 1}</span>${n}</li>`).join('');
            $('.fb-av', modal).textContent = signed ? ctx.fb.user.name.slice(0, 1) : 'f';
            $('.fb-acct-t b', modal).textContent = signed ? ctx.fb.user.name : 'ยังไม่ได้เข้าสู่ระบบ';
            $('.fb-acct-t small', modal).textContent = busy === 'login' ? 'กำลังรอหน้าต่าง Facebook…' : signed ? 'เข้าสู่ระบบแล้ว · สิทธิ์อ่านคอมเมนต์ของเพจ' : 'เปิดหน้าต่าง Facebook ให้เข้าสู่ระบบและอนุญาต';
            const lb = $('[data-fb=login]', modal);
            lb.textContent = signed ? 'เปลี่ยนบัญชี' : 'เข้าสู่ระบบด้วย Facebook';
            lb.className = `btn ${signed ? '' : 'btn-fb'}`; lb.disabled = !!busy;
            $('.fb-plist', modal).innerHTML = signed ? ctx.fb.pages.map(p => `<label class="fb-page ${p.id === ctx.fb.pageId ? 'is-on' : ''}"><input type="radio" name="fbpage" value="${esc(p.id)}" ${p.id === ctx.fb.pageId ? 'checked' : ''}>
                <span><b>${esc(p.name)}</b><small>${esc(p.meta || '')}</small></span>${p.live ? '<em>กำลังไลฟ์</em>' : ''}</label>`).join('')
              : '<p class="note">เข้าสู่ระบบก่อน แล้วรายชื่อเพจที่คุณดูแลจะขึ้นที่นี่</p>';
            $$('.fb-mode [data-mode]', modal).forEach(b => b.classList.toggle('is-on', b.dataset.mode === ctx.fb.mode));
            $('.fb-video', modal).hidden = ctx.fb.mode !== 'link';
            const ms = ctx.chatFeed.list.filter(m => m.platform === 'facebook').slice(-8).reverse();
            $('.fb-list', modal).innerHTML = ms.map(m => `<div class="fb-c"><span class="fb-tag">FB</span><span translate="no"><b>${esc(m.name)}</b><span>${esc(m.text)}</span></span><small>${esc(fbAgo(m.at))}</small></div>`).join('')
              || `<p class="note">${on ? 'รอคอมเมนต์แรก…' : 'ยังไม่เชื่อม — คอมเมนต์จะขึ้นที่นี่และในแชท'}</p>`;
            const poll = $('.fb-poll', modal);
            poll.textContent = on ? (st === 'error' ? 'ผิดพลาด' : text) : 'ยังไม่เชื่อม';
            poll.className = `fb-poll is-${st}`;
            if (st === 'error') showErr(text);
            const go = $('[data-fb=go]', modal);
            go.hidden = !signed; go.textContent = on ? 'ดึงใหม่จากเพจที่เลือก' : 'เริ่มดึงคอมเมนต์';
            off.disabled = !on && !signed;
            fn.textContent = on ? 'คอมเมนต์ Facebook เข้าแชทพร้อมแพลตฟอร์มอื่นแล้ว' : 'ยังไม่ได้เชื่อม — คอมเมนต์ Facebook จะยังไม่เข้าแชท';
          };
          const run = async (what, job) => {
            busy = what; showErr(''); paint();
            try { await job(); } catch (e) { showErr(e.message || String(e)); }
            busy = ''; if (modal.isConnected) paint();
          };
          modal.addEventListener('click', e => {
            const a = e.target.closest('[data-fb]')?.dataset.fb;
            const m = e.target.closest('[data-mode]')?.dataset.mode;
            if (m) { ctx.fb.mode = m; paint(); if (m === 'link') f.fbvideo.focus(); return; }
            if (a === 'login') {
              const appId = f.appid.value.trim();
              if (!/^\d{5,20}$/.test(appId)) { $('.fb-adv', modal).open = true; f.appid.focus(); showErr('ใส่ Facebook App ID ก่อน (ตัวเลข)'); return; }
              store.set('fb-appid', appId);
              if (ctx.fb.user) fbDisconnect(true);
              run('login', () => fbLogin(appId));
            } else if (a === 'token') {
              const t = f.ptoken.value.trim();
              if (!t) { f.ptoken.focus(); return; }
              f.ptoken.value = '';
              run('login', () => fbUseUserToken(t));
            } else if (a === 'go') {
              if (ctx.fb.mode === 'link') {
                ctx.fb.video = f.fbvideo.value.trim();
                if (!chatLib.facebookVideoId(ctx.fb.video)) { f.fbvideo.focus(); showErr('ลิงก์วิดีโอ Facebook ไม่ถูกต้อง — ใช้ลิงก์ที่มี /videos/ ตามด้วยตัวเลข'); return; }
              }
              showErr(''); fbConnect(); paint();
            }
          });
          modal.addEventListener('change', e => {
            if (e.target.name === 'fbpage') { ctx.fb.pageId = e.target.value; paint(); }
          });
          let sig = '';
          const tick = () => {
            if (!modal.isConnected) return;
            const now = `${ctx.chatFeed.list.length}|${JSON.stringify(ctx.chatFeed.status.facebook)}`;
            if (now !== sig) { sig = now; paint(); }
            setTimeout(tick, 400);
          };
          tick();
        }
      });
    }
    const fbAgo = at => { const s = Math.max(0, Math.round((Date.now() - (at || Date.now())) / 1000)); return s < 60 ? `${s} วิ` : s < 3600 ? `${Math.floor(s / 60)} นาที` : `${Math.floor(s / 3600)} ชม.`; };
    function addChatInput(silent) {
      const n = ctx.inputs.filter(i => i.type === 'chat').length + 1;
      const inp = addInput({ type: 'chat', name: n > 1 ? `COMMENTS ${n}` : 'COMMENTS', chat: { style: 'lower' } });
      if (!silent) {
        openChatInputDialog(inp);
        $('.tab[data-tab="chat"]')?.click();
      }
      return inp;
    }
    // หน้าต่างคอมเมนต์ไลฟ์: กรอง (ทั้งหมด / คำถาม / แพลตฟอร์ม) · หยุดเลื่อน · แสดงขึ้นจอ · บัญชีที่เชื่อม · ตัวอย่างการ์ด · กรองคำหยาบ
    const isQuestion = t => /[?？]|ไหม|มั้ย|ยังไง|อย่างไร|เท่าไร|เท่าไหร่|ทำไม|ที่ไหน|เมื่อไร|เมื่อไหร่|อะไร/.test(t || '');
    async function openChatInputDialog(inp) {
      const before = inp.chat.style;
      const demo = !ctx.chatFeed.shown;
      if (demo) { ctx.chatFeed.shown = { id: 'demo', platform: 'youtube', name: ctx.defText('ตัวอย่างผู้ชม'), text: ctx.defText('สวัสดีครับ ติดตามรายการทุกสัปดาห์เลย') }; ctx.chatFeed.at = performance.now() - 400; ctx.chatFeed.hideAt = 0; }
      const view = { filter: 'all', paused: false, frozen: null };
      const LABEL = { live: 'เชื่อมแล้ว', connecting: 'กำลังเชื่อมต่อ…', error: 'ผิดพลาด', off: 'ยังไม่เชื่อม' };
      const r = await dialog({
        title: 'คอมเมนต์ไลฟ์',
        wide: true,
        body: `<div class="ct-wrap">
          <div class="ct-left">
            <div class="ct-bar">
              ${[['all', 'ทั้งหมด'], ['q', 'คำถาม'], ['youtube', 'YouTube'], ['twitch', 'Twitch'], ['manual', 'พิมพ์เอง']].map(([k, n]) => `<button type="button" class="btn btn-sm ct-f ${k === 'all' ? 'is-on' : ''}" data-f="${k}">${n}</button>`).join('')}
              <span class="ml-auto"></span><button type="button" class="btn btn-sm" data-ct="pause">หยุดเลื่อน</button>
            </div>
            <div class="ct-list" role="list"></div>
            <form class="ct-manual" data-ct-form><input class="input" name="ctName" maxlength="40" placeholder="ชื่อ" aria-label="ชื่อผู้ชม"><input class="input" name="ctText" maxlength="300" placeholder="วางคอมเมนต์จาก Facebook / LINE / TikTok แล้วกดเพิ่ม" aria-label="ข้อความ"><button type="button" class="btn btn-sm" data-ct="add">เพิ่ม</button></form>
          </div>
          <div class="ct-right">
            <section class="ct-card"><div class="ct-h"><h3>บัญชีที่เชื่อม</h3></div><div class="ct-conns"></div>
              <button type="button" class="btn btn-sm" data-ct="connect">+ เชื่อมบัญชี / ตั้งค่า</button></section>
            <section class="ct-card"><div class="ct-h"><h3>ตัวอย่างบนจอ</h3></div>
              <div class="ct-prev"><canvas width="960" height="540" aria-label="ตัวอย่างการ์ดคอมเมนต์"></canvas></div>
              <div class="ct-two">
                <label class="field"><span>รูปแบบ</span><select name="style" class="select">${Object.entries(chatLib.CHAT_STYLES).map(([k, t]) => `<option value="${k}" ${k === inp.chat.style ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
                <label class="field"><span>ซ่อนหลัง</span><select name="autohide" class="select">${ctx.CHAT_AUTOHIDE.map(v => `<option value="${v}" ${v === ctx.chatFeed.autoHide ? 'selected' : ''}>${v ? `${v} วินาที` : 'ไม่ซ่อนเอง'}</option>`).join('')}</select></label>
              </div>
              <label class="check"><input type="checkbox" name="clean" ${ctx.chatFeed.clean ? 'checked' : ''}> กรองคำหยาบอัตโนมัติ (แทนด้วย ***)</label>
            </section>
            <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp.name)}"></label>
          </div>
        </div>`,
        actions: [{ label: 'ซ่อนคอมเมนต์จากจอ', value: 'hide' }, { label: 'ยกเลิก' }, { label: 'บันทึก', primary: true, value: 'save' }],
        onOpen(modal) {
          modal.classList.add('ct-modal');
          const list = $('.ct-list', modal), conns = $('.ct-conns', modal), f = $('form', modal).elements;
          const pv = $('.ct-prev canvas', modal), px = pv.getContext('2d');
          const paintConns = () => {
            conns.innerHTML = ['youtube', 'twitch', 'facebook'].map(k => { const [st, text] = ctx.chatFeed.status[k] || ['off', '']; return `<div class="ct-conn is-${st}"><i style="background:${chatLib.PLATFORMS[k].color}"></i><b>${chatLib.PLATFORMS[k].label}</b><span title="${esc(text)}">${esc(st === 'error' ? text : LABEL[st])}</span>${k === 'facebook' ? `<button type="button" class="btn btn-sm" data-ct="fb">${st === 'off' ? 'เชื่อม' : 'จัดการ'}</button>` : ''}</div>`; }).join('');
          };
          const paintList = () => {
            const src = view.paused ? view.frozen : ctx.chatFeed.list;
            const sh = ctx.chatFeed.shown && !ctx.chatFeed.hideAt && ctx.chatFeed.shown.id !== 'demo' ? ctx.chatFeed.shown : null;
            const items = src.filter(m => view.filter === 'all' || (view.filter === 'q' ? isQuestion(m.text) : (m.platform || 'manual') === view.filter)).slice(-120).reverse();
            list.innerHTML = items.map(m => `<div class="ct-item ${sh && sh.id === m.id ? 'is-on' : ''}" role="listitem">
                <span class="ct-pf" style="background:${(chatLib.PLATFORMS[m.platform] || chatLib.PLATFORMS.manual).color}">${esc((chatLib.PLATFORMS[m.platform] || chatLib.PLATFORMS.manual).label.slice(0, 2).toUpperCase())}</span>
                <div><b translate="no">${esc(m.name)}</b>${m.amount ? `<em>${esc(m.amount)}</em>` : ''}${isQuestion(m.text) ? '<small class="ct-q">คำถาม</small>' : ''}<p translate="no">${esc(m.text)}</p></div>
                ${sh && sh.id === m.id ? '<span class="ct-on">บนจอ</span>' : `<button type="button" class="btn btn-sm" data-show="${esc(m.id)}">แสดง</button>`}</div>`).join('')
              || '<p class="note">ยังไม่มีคอมเมนต์ — เชื่อม YouTube / Twitch หรือพิมพ์เองด้านล่าง</p>';
            const newer = view.paused ? ctx.chatFeed.list.length - view.frozen.length : 0;
            $('[data-ct=pause]', modal).textContent = view.paused ? `เลื่อนต่อ${newer > 0 ? ` (ใหม่ ${newer})` : ''}` : 'หยุดเลื่อน';
          };
          let sig = '';
          const tick = () => {
            if (!modal.isConnected) return;
            const now = `${ctx.chatFeed.list.length}|${ctx.chatFeed.shown?.id}|${ctx.chatFeed.hideAt}|${JSON.stringify(ctx.chatFeed.status)}|${view.filter}|${view.paused}`;
            if (now !== sig) { sig = now; paintList(); paintConns(); }
            px.fillStyle = '#23324a'; px.fillRect(0, 0, 960, 540);
            try { const src = $('#pgm-canvas'); if (src) px.drawImage(src, 0, 0, 960, 540); } catch (e) {}
            if (!ctx.onOverlay(inp.id) && inp.id !== ctx.state.programId) chatLib.drawChat(px, 960, 540, ctx.chatFeed.shown, inp.chat.style, chatAnim());
            setTimeout(tick, 120);
          };
          tick();
          modal.addEventListener('change', e => {
            if (e.target.name === 'style') inp.chat.style = e.target.value;
            if (e.target.name === 'autohide') { ctx.chatFeed.autoHide = ctx.CHAT_AUTOHIDE.includes(+e.target.value) ? +e.target.value : 0; store.set('chat-autohide', ctx.chatFeed.autoHide); }
            if (e.target.name === 'clean') { ctx.chatFeed.clean = e.target.checked; store.set('chat-clean', ctx.chatFeed.clean); }
          });
          const addManual = () => {
            const text = f.ctText.value.trim();
            if (!text) return;
            chatAdd({ id: 'm' + uid(), platform: 'manual', name: f.ctName.value.trim() || ctx.defText('ผู้ชม'), text });
            f.ctText.value = ''; f.ctText.focus();
          };
          f.ctText.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addManual(); } });
          modal.addEventListener('click', e => {
            const fb = e.target.closest('[data-f]');
            if (fb) { view.filter = fb.dataset.f; $$('.ct-f', modal).forEach(b => b.classList.toggle('is-on', b === fb)); return; }
            const show = e.target.closest('[data-show]');
            if (show) { const m = ctx.chatFeed.list.find(x => x.id === show.dataset.show); if (m) chatShow(m); return; }
            const act = e.target.closest('[data-ct]')?.dataset.ct;
            if (act === 'pause') { view.paused = !view.paused; view.frozen = view.paused ? ctx.chatFeed.list.slice() : null; paintList(); }
            else if (act === 'connect') openChatConnectDialog();
            else if (act === 'fb') openFacebookDialog();
            else if (act === 'add') addManual();
          });
          // “ซ่อนคอมเมนต์จากจอ” ไม่ปิดหน้าต่าง
          const hb = [...$$('.modal-foot .btn', modal)].find(b => b.dataset.label === 'ซ่อนคอมเมนต์จากจอ');
          const clone = hb.cloneNode(true); hb.replaceWith(clone);
          clone.addEventListener('click', () => chatHide());
        }
      });
      if (demo && ctx.chatFeed.shown?.id === 'demo') ctx.chatFeed.shown = null;
      if (r?.value !== 'save') { inp.chat.style = before; return; }
      inp.name = String(r.form.name.value || '').trim().slice(0, 40) || inp.name;
      renderInputs(); refreshSourceSelects();
    }
    function bindChatPane() {
      const pane = $('[data-pane="chat"]');
      pane.addEventListener('click', e => {
        const b = e.target.closest('[data-chat]');
        if (b?.dataset.chat === 'hide') chatHide();
        else if (b?.dataset.chat === 'connect') openChatConnectDialog();
        const item = e.target.closest('.chat-item');
        if (!item) return;
        const m = ctx.chatFeed.list.find(x => x.id === item.dataset.id);
        if (!m) return;
        if (ctx.chatFeed.shown?.id === m.id && !ctx.chatFeed.hideAt) chatHide();
        else chatShow(m);
      });
      $('#chat-manual').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target, text = f.text.value.trim();
        if (!text) return;
        chatAdd({ id: 'm-' + uid(), platform: 'manual', name: f.who.value.trim() || ctx.defText('ผู้ชม'), text, at: Date.now() });
        f.text.value = '';
      });
      setInterval(() => {
        if (ctx.chatFeed.autoHide && ctx.chatFeed.shown && !ctx.chatFeed.hideAt && performance.now() - ctx.chatFeed.at > ctx.chatFeed.autoHide * 1000) chatHide();
      }, 250);
      renderChatConn();
      renderChat();
    }

    return { addChatInput, bindChatPane, openChatInputDialog, openFacebookDialog };
  };
})(window.WebMix = window.WebMix || {});
