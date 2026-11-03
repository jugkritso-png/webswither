/* สร้างไลฟ์ล่วงหน้าบน YouTube / Facebook จากในแอป: ตั้งชื่อ คำอธิบาย เวลาเริ่ม ความเป็นส่วนตัว
   แล้วได้ Server + Stream key ใส่ปลายทางให้เอง (ไม่ต้องคัดลอกจากหน้าเว็บของแพลตฟอร์ม)
   YouTube: OAuth Client ID ของผู้ใช้เอง (Google Cloud → YouTube Data API v3) · Facebook: App ID เดียวกับคอมเมนต์ + สิทธิ์ publish_video
   โทเคนอยู่ในหน่วยความจำเท่านั้น ไม่บันทึกลงเครื่อง */
(function (WM) {
  'use strict';
  const { $, $$, chat: chatLib, esc, store, toast } = WM;

  // ctx = สิ่งที่ใช้จากสตูดิโอ (app.js): destLabel, dialog, fbLogin, saveSettings, MAX_DESTINATIONS, fb, newDest, settings, show
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน ctx.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createSchedule = function (ctx) {
    const { destLabel, dialog, fbLogin, saveSettings } = ctx;
    const YT_API = 'https://www.googleapis.com/youtube/v3/';
    const yt = { token: '', exp: 0, gis: null };
    function ytLoadGis() {
      if (yt.gis) return yt.gis;
      yt.gis = new Promise((resolve, reject) => {
        if (window.google?.accounts?.oauth2) { resolve(window.google); return; }
        const sc = document.createElement('script');
        sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
        sc.onload = () => window.google?.accounts?.oauth2 ? resolve(window.google) : reject(new Error('โหลดระบบเข้าสู่ระบบ Google ไม่สำเร็จ'));
        sc.onerror = () => reject(new Error('โหลดระบบเข้าสู่ระบบ Google ไม่ได้ (ตรวจอินเทอร์เน็ต)'));
        document.head.appendChild(sc);
      });
      yt.gis.catch(() => { yt.gis = null; });
      return yt.gis;
    }
    async function ytLogin(clientId) {
      const g = await ytLoadGis();
      const r = await new Promise(resolve => {
        const tc = g.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/youtube', callback: resolve, error_callback: e => resolve({ error: e?.type || 'popup' }) });
        tc.requestAccessToken();
      });
      if (!r?.access_token) throw new Error(r?.error === 'popup_closed' ? 'ปิดหน้าต่างเข้าสู่ระบบก่อนอนุญาต' : 'ยังไม่ได้อนุญาตให้จัดการ YouTube');
      yt.token = r.access_token; yt.exp = Date.now() + (+r.expires_in || 3600) * 1000;
    }
    async function ytCall(method, path, q, body) {
      if (!yt.token || Date.now() > yt.exp - 30000) throw new Error('เข้าสู่ระบบ Google ใหม่ (สิทธิ์หมดอายุ)');
      const r = await fetch(`${YT_API}${path}?${new URLSearchParams(q)}`, { method, headers: { Authorization: `Bearer ${yt.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const why = j.error?.errors?.[0]?.reason || '';
        throw new Error(/liveStreamingNotEnabled/.test(why) ? 'ช่องนี้ยังไม่ได้เปิดใช้การไลฟ์ — เปิดที่ YouTube Studio → ไลฟ์ (ครั้งแรกรอ 24 ชั่วโมง)'
          : /quota/i.test(why) ? 'โควตา YouTube API ของวันนี้หมดแล้ว' : r.status === 401 ? 'เข้าสู่ระบบ Google ใหม่ (สิทธิ์หมดอายุ)' : `YouTube: ${j.error?.message || r.status}`);
      }
      return j;
    }
    // สร้าง broadcast + stream แล้วผูกกัน → ได้ ingestion address + stream name
    async function ytSchedule({ title, description, start, privacy }) {
      const b = await ytCall('POST', 'liveBroadcasts', { part: 'snippet,status,contentDetails' }, {
        snippet: { title, description, scheduledStartTime: new Date(start || Date.now() + 60000).toISOString() },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: 'low' }
      });
      const st = await ytCall('POST', 'liveStreams', { part: 'snippet,cdn,contentDetails' }, {
        snippet: { title: `WebMix · ${title}`.slice(0, 120) }, cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' }, contentDetails: { isReusable: false }
      });
      await ytCall('POST', 'liveBroadcasts/bind', { part: 'id,contentDetails', id: b.id, streamId: st.id });
      const ing = st.cdn?.ingestionInfo || {};
      if (!ing.ingestionAddress || !ing.streamName) throw new Error('YouTube ไม่ได้ส่ง Stream key กลับมา');
      return { platform: 'youtube', server: ing.ingestionAddress, key: ing.streamName, url: `https://www.youtube.com/watch?v=${b.id}`, id: b.id };
    }
    async function fbSchedule({ title, description, start, pageId }) {
      const pg = ctx.fb.pages.find(p => p.id === pageId);
      if (!pg) throw new Error('เลือกเพจก่อน');
      const q = { title, description, status: start ? 'SCHEDULED_UNPUBLISHED' : 'UNPUBLISHED', ...(start ? { planned_start_time: String(Math.floor(start / 1000)) } : {}) };
      const r = await fetch(`${chatLib.FB_GRAPH}${pg.id}/live_videos`, { method: 'POST', body: new URLSearchParams({ ...q, access_token: pg.token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error?.code === 200 || /permission/i.test(j.error?.message || '') ? 'ยังไม่มีสิทธิ์สร้างไลฟ์ของเพจนี้ — เข้าสู่ระบบใหม่และอนุญาต “publish_video” (แอปต้องเป็นของคุณ หรือผ่านการตรวจของ Meta)' : `Facebook: ${j.error?.message || r.status}`);
      const url = j.secure_stream_url || j.stream_url || '';
      const m = /^(rtmps?:\/\/[^/]+\/[^/]+)\/(.+)$/.exec(url);
      if (!m) throw new Error('Facebook ไม่ได้ส่ง Stream key กลับมา');
      return { platform: 'facebook', server: m[1], key: m[2], url: `https://www.facebook.com/${pg.id}/videos/${j.id}`, id: j.id };
    }
    // ใส่ปลายทาง: ใช้ช่องของแพลตฟอร์มเดียวกันที่ยังไม่มีคีย์ ไม่มีก็เพิ่มช่องใหม่ (ไม่ทับช่องที่มีคีย์อยู่แล้ว)
    function applyScheduled(res) {
      let d = ctx.settings.destinations.find(x => x.platform === res.platform && !x.key.trim());
      if (!d) {
        if (ctx.settings.destinations.length >= ctx.MAX_DESTINATIONS) throw new Error(`ปลายทางเต็ม ${ctx.MAX_DESTINATIONS} ช่องแล้ว — ลบช่องที่ไม่ใช้ก่อน`);
        d = ctx.newDest(res.platform); ctx.settings.destinations.push(d);
      }
      d.server = res.server; d.key = res.key; d.enabled = true;
      saveSettings();
      return d;
    }
    async function openScheduleDialog() {
      const now = new Date(Date.now() + 15 * 60000); now.setSeconds(0, 0);
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      let busy = false;
      await dialog({
        title: 'สร้างไลฟ์บน YouTube / Facebook',
        body: `
          <div class="seg sch-plat"><button type="button" data-plat="youtube" class="is-active">YouTube</button><button type="button" data-plat="facebook">Facebook (เพจ)</button></div>
          <div class="sch-auth"></div>
          <label class="field"><span>ชื่อไลฟ์</span><input name="title" class="input" maxlength="100" value="${esc(ctx.show.name || '')}" placeholder="เช่น ถ่ายทอดสดงานบวช 12 พ.ย."></label>
          <label class="field"><span>คำอธิบาย</span><textarea name="desc" class="input" rows="3" maxlength="4000"></textarea></label>
          <div class="grid-2">
            <label class="field"><span>เริ่ม</span><select name="when" class="select"><option value="now">ทันทีที่กดเริ่มสตรีม</option><option value="at">ตั้งเวลา</option></select></label>
            <label class="field sch-at" hidden><span>วัน เวลา</span><input name="at" type="datetime-local" class="input" value="${local}"></label>
          </div>
          <label class="field sch-yt"><span>ใครดูได้</span><select name="privacy" class="select"><option value="public">สาธารณะ</option><option value="unlisted">ไม่เป็นสาธารณะ (มีลิงก์ดูได้)</option><option value="private">ส่วนตัว</option></select></label>
          <p class="note sch-err warn" hidden></p>
          <div class="sch-done" hidden></div>`,
        actions: [{ label: 'ปิด' }],
        onOpen(modal) {
          const f = $('form', modal).elements;
          let plat = 'youtube';
          const foot = $('.modal-foot', modal);
          foot.insertAdjacentHTML('afterbegin', `<button type="button" class="btn btn-primary sch-go">สร้างไลฟ์และใส่ปลายทาง</button><span class="ml-auto"></span>`);
          const err = t => { const e = $('.sch-err', modal); e.hidden = !t; e.textContent = t || ''; };
          const authed = () => plat === 'youtube' ? !!yt.token && Date.now() < yt.exp - 30000 : ctx.fb.pages.length > 0 && ctx.fb.publish;
          const paint = () => {
            $$('.sch-plat button', modal).forEach(b => b.classList.toggle('is-active', b.dataset.plat === plat));
            $('.sch-yt', modal).hidden = plat !== 'youtube';
            $('.sch-at', modal).hidden = f.when.value !== 'at';
            const box = $('.sch-auth', modal), sig = `${plat}|${authed()}|${ctx.fb.pages.length}`;
            if (box.dataset.sig === sig) { $('.sch-go', modal).disabled = busy || !authed(); return; }
            box.dataset.sig = sig;
            if (plat === 'youtube') {
              box.innerHTML = yt.token && Date.now() < yt.exp - 30000 ? `<p class="note ok">เข้าสู่ระบบ Google แล้ว — สร้างไลฟ์ในช่องของบัญชีนี้</p>` : `
                <div class="link-row"><input name="ytclient" class="input mono" placeholder="OAuth Client ID (….apps.googleusercontent.com)" value="${esc(store.get('yt-client', ''))}"><button type="button" class="btn" data-sch="ytlogin">เข้าสู่ระบบ Google</button></div>
                <details class="sch-help"><summary>ขอ Client ID / ใช้แอปเดสก์ท็อปแล้วเปิดหน้าต่าง Google ไม่ได้</summary>
                  <p class="note">Google Cloud Console → สร้างโปรเจกต์ → เปิด “YouTube Data API v3” → Credentials → OAuth client ID ชนิด Web application → ใส่ ${esc(location.origin)} ใน Authorized JavaScript origins · ช่องต้องเปิดใช้การไลฟ์แล้ว</p>
                  <div class="link-row"><input name="yttoken" class="input mono" placeholder="หรือวาง Access token (จาก OAuth Playground)"><button type="button" class="btn" data-sch="yttoken">ใช้โทเคน</button></div>
                </details>`;
            } else {
              box.innerHTML = ctx.fb.pages.length && ctx.fb.publish ? `<label class="field"><span>เพจ</span><select name="page" class="select">${ctx.fb.pages.map(p => `<option value="${p.id}" ${p.id === ctx.fb.pageId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : `
                <div class="link-row"><input name="fbapp" class="input mono" placeholder="Facebook App ID" value="${esc(store.get('fb-appid', ''))}"><button type="button" class="btn" data-sch="fblogin">เข้าสู่ระบบ Facebook</button></div>
                <p class="note">ใช้ App ID เดียวกับคอมเมนต์ Facebook · ต้องอนุญาตสิทธิ์ “publish_video” ของเพจ (แอปที่ยังไม่ผ่านการตรวจของ Meta ใช้ได้กับแอดมินของแอปเท่านั้น)</p>`;
            }
            $('.sch-go', modal).disabled = busy || !authed();
          };
          const run = async job => { busy = true; err(''); paint(); try { await job(); } catch (e) { err(e.message || String(e)); } busy = false; if (modal.isConnected) paint(); };
          modal.addEventListener('change', e => { if (e.target.name === 'when' || e.target.name === 'page') paint(); });
          modal.addEventListener('click', e => {
            const pb = e.target.closest('[data-plat]'); if (pb) { plat = pb.dataset.plat; err(''); paint(); return; }
            const a = e.target.closest('[data-sch]')?.dataset.sch;
            if (a === 'ytlogin') {
              const id = f.ytclient.value.trim();
              if (!/\.apps\.googleusercontent\.com$/.test(id)) { err('ใส่ OAuth Client ID (ลงท้าย .apps.googleusercontent.com)'); return; }
              store.set('yt-client', id); run(() => ytLogin(id));
            } else if (a === 'yttoken') {
              const t = f.yttoken.value.trim(); if (!t) return; f.yttoken.value = '';
              yt.token = t; yt.exp = Date.now() + 3500 * 1000; paint();
            } else if (a === 'fblogin') {
              const id = f.fbapp.value.trim();
              if (!/^\d{5,20}$/.test(id)) { err('ใส่ Facebook App ID (ตัวเลข)'); return; }
              store.set('fb-appid', id); run(async () => { await fbLogin(id, ',publish_video'); ctx.fb.publish = true; });
            }
            if (e.target.closest('.sch-go')) {
              const title = f.title.value.trim();
              if (!title) { err('ตั้งชื่อไลฟ์ก่อน'); f.title.focus(); return; }
              const start = f.when.value === 'at' ? new Date(f.at.value).getTime() : 0;
              if (start && !(start > Date.now())) { err('เวลาเริ่มต้องเป็นเวลาในอนาคต'); return; }
              if (plat === 'facebook' && start && (start - Date.now() < 10 * 60000 || start - Date.now() > 7 * 86400000)) { err('Facebook ตั้งเวลาได้ตั้งแต่ 10 นาทีถึง 7 วันข้างหน้า'); return; }
              run(async () => {
                const res = plat === 'youtube' ? await ytSchedule({ title, description: f.desc.value, start, privacy: f.privacy.value })
                  : await fbSchedule({ title, description: f.desc.value, start, pageId: f.page.value });
                const d = applyScheduled(res);
                const done = $('.sch-done', modal);
                done.hidden = false;
                done.innerHTML = `<p class="note ok">สร้างไลฟ์แล้ว — ใส่ Server และ Stream key ในปลายทาง “${esc(destLabel(d))}” ให้แล้ว (ติ๊กเริ่มพร้อมกัน)</p>
                  <div class="link-row"><input class="input mono" readonly value="${esc(res.url)}"><button type="button" class="btn" data-copy="${esc(res.url)}">คัดลอกลิงก์ผู้ชม</button></div>`;
                toast(`สร้างไลฟ์ ${res.platform === 'youtube' ? 'YouTube' : 'Facebook'} แล้ว — กด STREAM เพื่อเริ่มได้เลย`, 'success', 6000);
              });
            }
            const cp = e.target.closest('[data-copy]');
            if (cp) (navigator.clipboard ? navigator.clipboard.writeText(cp.dataset.copy) : Promise.reject()).then(() => toast('คัดลอกลิงก์แล้ว', 'success'), () => {});
          });
          paint();
        }
      });
    }

    return { openScheduleDialog, yt };
  };
})(window.WebMix = window.WebMix || {});
