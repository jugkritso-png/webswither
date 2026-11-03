/* วิดเจ็ตข้อมูลสด (สภาพอากาศ / คริปโต / อัตราแลกเปลี่ยน / JSON จาก API ใดก็ได้)
   ดึงข้อมูลจากบริการฟรีที่ไม่ต้องใช้ key (Open-Meteo, CoinGecko, open.er-api) ตามรอบเวลา แล้ววาดเป็นป้ายพื้นโปร่งใส ซ้อนบน Overlay ได้ */
(function (WM) {
  'use strict';
  const { $, FONT, clamp, esc, fitFont } = WM;

  // ctx = สิ่งที่ใช้จากสตูดิโอ (app.js): addInput, cardSub, dialog, refreshSourceSelects, renderInputs, setInputStatus, inputs, okHex, show
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน ctx.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createWidgets = function (ctx) {
    const { addInput, cardSub, dialog, refreshSourceSelects, renderInputs, setInputStatus } = ctx;
    const WIDGET_KINDS = { weather: 'สภาพอากาศ', crypto: 'ราคาคริปโต', fx: 'อัตราแลกเปลี่ยน', json: 'ข้อมูลจาก API (JSON)' };
    const WIDGET_PLACES = { tr: 'มุมขวาบน', tl: 'มุมซ้ายบน', br: 'มุมขวาล่าง', bl: 'มุมซ้ายล่าง', center: 'กลางจอ' };
    const WMO = c => c === 0 ? ['☀️', 'แจ่มใส'] : c <= 3 ? ['⛅', 'มีเมฆบางส่วน'] : c <= 48 ? ['🌫️', 'หมอก'] : c <= 67 ? ['🌧️', 'ฝนตก'] : c <= 77 ? ['❄️', 'หิมะ'] : c <= 82 ? ['🌧️', 'ฝนตกหนัก'] : ['⛈️', 'พายุฝนฟ้าคะนอง'];
    const fmtNum = (v, d = 2) => Number(v).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: v >= 1000 ? 0 : Math.min(d, 2) });
    const jsonPath = (o, p) => String(p || '').split(/[.[\]]+/).filter(Boolean).reduce((a, k) => (a == null ? a : a[k]), o);
    function sanitizeWidget(w) {
      w = w || {};
      return { kind: WIDGET_KINDS[w.kind] ? w.kind : 'weather', place: String(w.place || 'กรุงเทพมหานคร').slice(0, 60), lat: +w.lat || 13.7563, lon: +w.lon || 100.5018,
        coin: String(w.coin || 'bitcoin').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'bitcoin', vs: String(w.vs || 'thb').replace(/[^a-z]/g, '').slice(0, 6) || 'thb',
        from: String(w.from || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD', to: String(w.to || 'THB').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'THB',
        url: String(w.url || '').slice(0, 500), path: String(w.path || '').slice(0, 120), label: String(w.label || '').slice(0, 40), unit: String(w.unit || '').slice(0, 12),
        pos: WIDGET_PLACES[w.pos] ? w.pos : 'tr', every: clamp(+w.every || 0, 0, 3600), accent: ctx.okHex(w.accent) ? w.accent : '#f5a524' };
    }
    const widgetEvery = w => w.every || { weather: 600, crypto: 60, fx: 1800, json: 30 }[w.kind];
    async function fetchWidget(inp) {
      const w = inp.widget, st = inp.wd || (inp.wd = {});
      st.busy = true;
      try {
        const get = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
        if (w.kind === 'weather') {
          const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=auto`);
          const c = d.current || {}, [ic, txt] = WMO(+c.weather_code || 0);
          Object.assign(st, { label: w.place, value: `${Math.round(c.temperature_2m)}°C`, sub: `${txt} · ความชื้น ${Math.round(c.relative_humidity_2m)}%`, icon: ic, trend: 0 });
        } else if (w.kind === 'crypto') {
          const d = await get(`https://api.coingecko.com/api/v3/simple/price?ids=${w.coin}&vs_currencies=${w.vs}&include_24hr_change=true`);
          const c = d[w.coin]; if (!c || c[w.vs] == null) throw new Error('ไม่พบเหรียญนี้');
          const ch = +c[`${w.vs}_24h_change`] || 0;
          Object.assign(st, { label: `${w.coin.toUpperCase()} / ${w.vs.toUpperCase()}`, value: `${fmtNum(c[w.vs])} ${w.vs === 'thb' ? '฿' : w.vs === 'usd' ? '$' : w.vs.toUpperCase()}`, sub: `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}% ใน 24 ชม.`, icon: '', trend: Math.sign(ch) });
        } else if (w.kind === 'fx') {
          const d = await get(`https://open.er-api.com/v6/latest/${w.from}`);
          const v = d.rates && d.rates[w.to]; if (v == null) throw new Error('ไม่พบสกุลเงินนี้');
          Object.assign(st, { label: `1 ${w.from} = ? ${w.to}`, value: `${fmtNum(v, 4)} ${w.to}`, sub: 'อัตราอ้างอิง', icon: '💱', trend: 0 });
        } else {
          if (!/^https?:\/\//i.test(w.url)) throw new Error('ยังไม่ได้ใส่ลิงก์ API');
          const d = await get(w.url), v = jsonPath(d, w.path);
          if (v == null || typeof v === 'object') throw new Error('ไม่พบค่าตามเส้นทางที่ระบุ');
          Object.assign(st, { label: w.label || w.path, value: `${typeof v === 'number' ? fmtNum(v) : String(v).slice(0, 40)}${w.unit ? ' ' + w.unit : ''}`, sub: '', icon: '', trend: 0 });
        }
        st.error = ''; st.at = Date.now();
        if (inp.status !== 'live') setInputStatus(inp, 'live');
      } catch (e) {
        st.error = e.message || 'ดึงข้อมูลไม่ได้'; st.at = Date.now();
        if (!st.value) setInputStatus(inp, 'nosignal');
      } finally {
        st.busy = false; st.stamp = (st.stamp || 0) + 1;
        const sub = $(`#inputs-grid .card[data-id="${inp.id}"] .card-sub`); if (sub) sub.textContent = cardSub(inp);
      }
    }
    function stepWidgets() {
      const now = Date.now();
      for (const inp of ctx.inputs) {
        if (inp.type !== 'widget') continue;
        const st = inp.wd || (inp.wd = {});
        if (!st.busy && (!st.at || now - st.at >= (st.error ? 30 : widgetEvery(inp.widget)) * 1000)) fetchWidget(inp);
      }
    }
    setInterval(stepWidgets, 1000);
    function drawWidget(ctx, inp, w, h) {
      const st = inp.wd || {}, wd = inp.widget;
      const bw = Math.round(w * 0.24), bh = Math.round(h * 0.13), m = Math.round(h * 0.045);
      const x = wd.pos === 'center' ? (w - bw) / 2 : wd.pos[1] === 'l' ? m : w - bw - m, y = wd.pos === 'center' ? (h - bh) / 2 : wd.pos[0] === 't' ? m : h - bh - m;
      ctx.save();
      ctx.fillStyle = 'rgba(10,14,22,.84)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, bh, bh * 0.14) : ctx.rect(x, y, bw, bh); ctx.fill();
      ctx.fillStyle = wd.accent; ctx.fillRect(x, y, Math.max(3, bw * 0.018), bh);
      const pad = bw * 0.06, ix = st.icon ? bh * 0.62 : 0;
      if (st.icon) { ctx.font = `${Math.round(bh * 0.5)}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillText(st.icon, x + pad, y + bh / 2); }
      const tx = x + pad + ix, tw = bw - pad * 2 - ix;
      ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'rgba(255,255,255,.75)';
      fitFont(ctx, st.error && !st.value ? WIDGET_KINDS[wd.kind] : (st.label || ''), 600, Math.round(bh * 0.17), FONT, tw); ctx.fillText(st.error && !st.value ? WIDGET_KINDS[wd.kind] : (st.label || ''), tx, y + bh * 0.3);
      ctx.fillStyle = '#fff'; fitFont(ctx, st.value || (st.error ? 'ไม่มีข้อมูล' : 'กำลังโหลด…'), 800, Math.round(bh * 0.36), FONT, tw); ctx.fillText(st.value || (st.error ? 'ไม่มีข้อมูล' : 'กำลังโหลด…'), tx, y + bh * 0.66);
      const sub = st.error && st.value ? 'ข้อมูลล่าสุด (เชื่อมต่อไม่ได้)' : st.sub || '';
      ctx.fillStyle = st.trend > 0 ? '#4ade80' : st.trend < 0 ? '#f87171' : 'rgba(255,255,255,.7)';
      fitFont(ctx, sub, 600, Math.round(bh * 0.15), FONT, tw); ctx.fillText(sub, tx, y + bh * 0.88);
      ctx.restore();
    }
    async function openWidgetDialog(inp) {
      const w = sanitizeWidget(inp ? inp.widget : { kind: 'weather' }), geo = { lat: w.lat, lon: w.lon };
      const r = await dialog({
        title: inp ? `วิดเจ็ตข้อมูลสด — ${inp.name}` : 'เพิ่มวิดเจ็ตข้อมูลสด',
        body: `
          <div class="grid-2">
            <label class="field"><span>ชนิดข้อมูล</span><select name="kind" class="select">${Object.entries(WIDGET_KINDS).map(([k, l]) => `<option value="${k}" ${k === w.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="40" value="${esc(inp ? inp.name : 'WIDGET')}"></label>
          </div>
          <div data-k="weather"><label class="field"><span>เมือง / จังหวัด</span><div class="link-row"><input name="place" class="input" value="${esc(w.place)}"><button type="button" class="btn" data-wd="geo">ค้นหา</button></div></label><small class="note wd-geo">${w.lat.toFixed(3)}, ${w.lon.toFixed(3)}</small></div>
          <div data-k="crypto" class="grid-2"><label class="field"><span>เหรียญ (รหัส CoinGecko)</span><input name="coin" class="input mono" value="${esc(w.coin)}" placeholder="bitcoin, ethereum, tether"></label><label class="field"><span>เทียบกับ</span><select name="vs" class="select">${['thb', 'usd'].map(v => `<option value="${v}" ${v === w.vs ? 'selected' : ''}>${v.toUpperCase()}</option>`).join('')}</select></label></div>
          <div data-k="fx" class="grid-2"><label class="field"><span>จาก</span><input name="from" class="input mono" maxlength="3" value="${esc(w.from)}"></label><label class="field"><span>เป็น</span><input name="to" class="input mono" maxlength="3" value="${esc(w.to)}"></label></div>
          <div data-k="json">
            <label class="field"><span>ลิงก์ API (คืนค่า JSON และเปิด CORS)</span><input name="url" class="input mono" value="${esc(w.url)}" placeholder="https://…"></label>
            <div class="grid-3"><label class="field"><span>เส้นทางของค่า</span><input name="path" class="input mono" value="${esc(w.path)}" placeholder="data.price หรือ items.0.score"></label><label class="field"><span>ป้ายชื่อ</span><input name="label" class="input" value="${esc(w.label)}"></label><label class="field"><span>หน่วย</span><input name="unit" class="input" value="${esc(w.unit)}"></label></div>
          </div>
          <div class="grid-3">
            <label class="field"><span>ตำแหน่ง</span><select name="pos" class="select">${Object.entries(WIDGET_PLACES).map(([k, l]) => `<option value="${k}" ${k === w.pos ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>ดึงใหม่ทุก (วินาที, 0 = อัตโนมัติ)</span><input name="every" class="input mono" type="number" min="0" max="3600" value="${w.every}"></label>
            <label class="field"><span>สีแถบ</span><input name="accent" type="color" value="${w.accent}"></label>
          </div>
          <p class="note">ข้อมูลจากบริการฟรี: สภาพอากาศ Open-Meteo · คริปโต CoinGecko · อัตราแลกเปลี่ยน open.er-api.com · ผลบอล / หุ้น ใช้ “ข้อมูลจาก API” กับบริการที่คุณมี key</p>`,
        wide: true,
        actions: [{ label: 'ยกเลิก' }, { label: inp ? 'บันทึก' : 'เพิ่ม', primary: true, value: 'ok' }],
        onOpen(modal) {
          const fm = $('form', modal);
          const show = () => modal.querySelectorAll('[data-k]').forEach(el => { el.hidden = el.dataset.k !== fm.kind.value; });
          fm.kind.addEventListener('change', show); show();
          $('[data-wd="geo"]', modal).addEventListener('click', async () => {
            const q = fm.place.value.trim(); if (!q) return;
            try {
              const d = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=th`)).json();
              const g = d.results && d.results[0]; if (!g) throw new Error();
              fm.place.value = g.name; geo.lat = +g.latitude; geo.lon = +g.longitude;
              $('.wd-geo', modal).textContent = `${g.name}${g.admin1 ? ', ' + g.admin1 : ''} · ${(+g.latitude).toFixed(3)}, ${(+g.longitude).toFixed(3)}`;
            } catch (e) { $('.wd-geo', modal).textContent = 'ไม่พบสถานที่นี้'; }
          });
        }
      });
      if (!r || r.value !== 'ok') return null;
      const f = r.form;
      const nw = sanitizeWidget({ kind: f.kind.value, place: f.place.value, lat: geo.lat, lon: geo.lon, coin: f.coin.value.trim().toLowerCase(), vs: f.vs.value,
        from: f.from.value, to: f.to.value, url: f.url.value.trim(), path: f.path.value.trim(), label: f.label.value.trim(), unit: f.unit.value.trim(), pos: f.pos.value, every: f.every.value, accent: f.accent.value });
      const name = f.name.value.trim().slice(0, 40) || 'WIDGET';
      if (!inp) inp = addInput({ type: 'widget', name: name === 'WIDGET' ? WIDGET_KINDS[nw.kind].toUpperCase() : name, status: 'nosignal', widget: nw, wd: {} });
      else { inp.name = name; inp.widget = nw; inp.wd = {}; }
      fetchWidget(inp);
      renderInputs(); refreshSourceSelects(); ctx.show.autosave();
      return inp;
    }

    return { WIDGET_KINDS, drawWidget, openWidgetDialog, sanitizeWidget };
  };
})(window.WebMix = window.WebMix || {});
