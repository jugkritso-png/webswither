/* NDI / OMT: Gateway ในแอปเดสก์ท็อปค้นหาแหล่งในวง LAN แล้วรับเข้ามาเป็นแหล่งภาพ (ทางเดียวกับ SRT) */
(function (WM) {
  'use strict';
  const { $, $$, esc, icon, store, toast } = WM;

  // studio = สิ่งที่ใช้จากสตูดิโอ (app.js): connectSrtInput, createSrtInput, dialog, gatewayEndpoint, gatewayProblem, openRtmpInputDialog, openRtspDialog, openSettings, openSrtInputDialog, refreshSourceSelects, renderInputs, saveSrtInputs, stopSrtPlayer, inputs
  // ค่า (ไม่ใช่ฟังก์ชัน) อ่านผ่าน studio.ชื่อ เสมอ — ได้ค่าล่าสุด และสร้างโมดูลได้ก่อนที่ app.js จะประกาศค่านั้น
  WM.createNetSources = function (studio) {
    const { connectSrtInput, createSrtInput, dialog, gatewayEndpoint, gatewayProblem, openRtmpInputDialog, openRtspDialog, openSettings, openSrtInputDialog, refreshSourceSelects, renderInputs, saveSrtInputs, stopSrtPlayer } = studio;
    const NET_PROTOS = { ndi: 'NDI®', omt: 'OMT' };
    // ถาม Gateway ว่ามีแหล่งอะไรบ้าง (ใช้ช่องควบคุมเดียวกับ SRT แค่ไม่ส่ง open)
    function listNetSources(proto) {
      return new Promise(resolve => {
        let ws;
        try { ws = new WebSocket(gatewayEndpoint('/srt-in')); } catch (e) { resolve({ list: [], error: e.message }); return; }
        const done = r => { clearTimeout(t); try { ws.close(); } catch (e) {} resolve(r); };
        const t = setTimeout(() => done({ list: [], error: 'Gateway ไม่ตอบ (Gateway บนเซิร์ฟเวอร์ไม่รองรับ NDI / OMT — ใช้แอปเดสก์ท็อป)' }), 8000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'sources', proto }));
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.type === 'sources') done({ list: Array.isArray(m.list) ? m.list.map(String) : [], error: m.error || '', version: m.version ? String(m.version) : '' });
          else if (m.type === 'error') done({ list: [], error: m.message || 'Gateway ปฏิเสธ' });
        };
        ws.onerror = () => done({ list: [], error: 'เชื่อมต่อ Gateway ไม่ได้' });
      });
    }
    // แท็บสลับชนิดแหล่งภาพเครือข่าย (ตอนเพิ่มใหม่): NDI / OMT · SRT · RTMP · RTSP
    const NET_TABS = [['ndi', 'NDI / OMT'], ['srt', 'SRT'], ['rtmp', 'RTMP (รับเข้า)'], ['rtsp', 'RTSP (กล้อง IP)']];
    const netTabsHtml = cur => `<nav class="dg-tabs net-tabs" role="tablist">${NET_TABS.map(([k, n]) => `<button type="button" role="tab" class="dg-tab ${k === cur ? 'is-on' : ''}" aria-selected="${k === cur}" data-net-tab="${k}">${n}</button>`).join('')}</nav>`;
    function bindNetTabs(modal, close, cur) {
      modal.classList.add('net-modal');
      $('.net-tabs', modal)?.addEventListener('click', e => {
        const k = e.target.closest('[data-net-tab]')?.dataset.netTab;
        if (!k || k === cur) return;
        close();
        setTimeout(() => ({ ndi: () => openNetVideoDialog(), srt: openSrtInputDialog, rtmp: openRtmpInputDialog, rtsp: () => openRtspDialog() })[k](), 0);
      });
    }

    // หน้าตั้งค่า → แท็บ NDI / OMT: ค้นหาแหล่งทั้งสองแบบในวง LAN พร้อมกัน · สถานะไลบรารี · เพิ่มเป็นแหล่งภาพได้ทันที
    const NET_SCAN_HELP = {
      ndi: 'ต้องติดตั้ง NDI Tools (ฟรี) จาก ndi.video/tools · เครื่องส่ง: vMix, OBS + DistroAV, กล้อง PTZ NDI',
      omt: 'ไลบรารีมากับแอปแล้ว · เครื่องส่ง: vMix 29 ขึ้นไป (Output → OMT)'
    };
    const netScanPaneHtml = () => `<div class="modal-pane" data-mpane="netvideo">
        <div class="nv-head"><p class="note">ค้นหาแหล่งภาพ NDI® และ OMT ที่เปิดอยู่ในวง LAN เดียวกับเครื่องนี้ แล้วกดเพิ่มเป็นแหล่งภาพได้เลย · ใช้ Stream Gateway ในแอปเดสก์ท็อป</p>
          <button type="button" class="btn" data-nv="scan">${icon('search')}ค้นหาใหม่</button></div>
        <label class="check"><input type="checkbox" data-nv="auto" ${store.get('nv-auto', true) ? 'checked' : ''}> ค้นหาซ้ำอัตโนมัติทุก 10 วินาทีระหว่างเปิดหน้านี้</label>
        <p class="note warn nv-gw" hidden></p>
        <div class="nv-grid">${Object.entries(NET_PROTOS).map(([k, l]) => `<section class="nv-col" data-proto="${k}" aria-label="แหล่ง ${l}">
            <div class="nv-col-h"><b>${l}</b><span class="nv-st is-wait">ยังไม่ได้ค้นหา</span></div>
            <div class="nv-list" role="list"></div>
            <p class="note">${NET_SCAN_HELP[k]}</p></section>`).join('')}</div>
      </div>`;
    function bindNetScanPane(modal, now) {
      const pane = $('[data-mpane=netvideo]', modal);
      if (!pane) return;
      const found = { ndi: null, omt: null };
      let busy = false, timer = 0, started = false;
      const used = (proto, src) => studio.inputs.find(i => i.type === 'srt' && i.srt?.mode === proto && i.srt.source === src);
      const paint = (proto, r) => {
        const col = $(`.nv-col[data-proto=${proto}]`, pane), st = $('.nv-st', col), list = $('.nv-list', col);
        if (!r) { st.className = 'nv-st is-wait'; st.textContent = 'กำลังค้นหา…'; return; }
        if (r.error) {
          st.className = 'nv-st is-bad'; st.textContent = /ไม่พบ|not found/i.test(r.error) ? 'ไม่พบไลบรารี' : 'ค้นหาไม่ได้';
          list.innerHTML = `<p class="note net-err">${esc(r.error)}</p>`;
          return;
        }
        st.className = `nv-st ${r.list.length ? 'is-ok' : 'is-idle'}`;
        st.textContent = `${r.list.length ? `พบ ${r.list.length} แหล่ง` : 'ยังไม่พบแหล่ง'}${r.version ? ` · ${r.version}` : ''}`;
        list.innerHTML = r.list.map(n => {
          const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(n) || [null, '', n], u = used(proto, n);
          return `<div class="nv-src" role="listitem"><span class="net-thumb">${icon('monitor')}</span><span class="nv-src-t"><b>${esc(m[2])}</b><small>${esc(m[1] || 'เครื่องนี้')}</small></span>
            ${u ? `<span class="nv-used">ใช้อยู่ · ${esc(u.name)}</span>` : `<button type="button" class="btn btn-sm" data-nv-add="${esc(n)}">เพิ่มเป็นแหล่งภาพ</button>`}</div>`;
        }).join('') || '<p class="note">ยังไม่พบแหล่งในวง LAN — ตรวจว่าเครื่องส่งเปิดอยู่ อยู่วงเดียวกัน และไฟร์วอลล์ไม่บล็อก</p>';
      };
      const scan = async () => {
        if (busy || !pane.isConnected) return;
        const gwErr = gatewayProblem();
        $('.nv-gw', pane).hidden = !gwErr;
        if (gwErr) { $('.nv-gw', pane).textContent = `${gwErr} — ตั้งค่าในแท็บ สตรีมและปลายทาง (แอปเดสก์ท็อปตั้งให้เอง)`; return; }
        busy = true;
        $('[data-nv=scan]', pane).disabled = true;
        await Promise.all(Object.keys(NET_PROTOS).map(async k => {
          if (!found[k]) paint(k, null);
          found[k] = await listNetSources(k);
          if (pane.isConnected) paint(k, found[k]);
        }));
        busy = false;
        if (pane.isConnected) $('[data-nv=scan]', pane).disabled = false;
      };
      const loop = () => {
        clearTimeout(timer);
        if (!pane.isConnected || !$('[data-nv=auto]', pane).checked) return;
        timer = setTimeout(async () => { if (pane.classList.contains('is-active')) await scan(); loop(); }, 10000);
      };
      const start = () => { if (started) return; started = true; scan(); loop(); };
      pane.addEventListener('click', e => {
        if (e.target.closest('[data-nv=scan]')) { scan(); return; }
        const add = e.target.closest('[data-nv-add]');
        if (!add) return;
        const col = add.closest('.nv-col'), proto = col.dataset.proto, source = add.dataset.nvAdd;
        if (used(proto, source)) return;
        const name = (/\(([^)]+)\)\s*$/.exec(source) || [null, source])[1].slice(0, 32);
        createSrtInput({ mode: proto, source, port: 0, latency: 500 }, name);
        saveSrtInputs();
        store.set('net-proto', proto);
        toast(`เพิ่ม “${name}” (${NET_PROTOS[proto]}) เป็นแหล่งภาพแล้ว`, 'success');
        paint(proto, found[proto]);
      });
      $('[data-nv=auto]', pane).addEventListener('change', e => { store.set('nv-auto', e.target.checked); loop(); });
      $('[data-mtab=netvideo]', modal)?.addEventListener('click', start);
      if (now) start();
    }

    async function openNetVideoDialog(proto = store.get('net-proto', 'ndi'), inp = null) {
      const gwErr = gatewayProblem();
      if (gwErr) { toast(`${gwErr} — NDI / OMT ต้องใช้ Stream Gateway ในแอปเดสก์ท็อป`, 'warn'); openSettings('stream'); return; }
      if (!NET_PROTOS[proto]) proto = 'ndi';
      const cur = inp ? inp.srt.source : '';
      const r = await dialog({
        title: inp ? `แหล่งสัญญาณ — ${inp.name}` : 'รับภาพ NDI® / OMT',
        body: `${!inp ? netTabsHtml('ndi') : ''}
          <div class="seg net-proto">${Object.entries(NET_PROTOS).map(([k, l]) => `<button type="button" data-value="${k}" class="${k === proto ? 'is-active' : ''}">${l}</button>`).join('')}</div>
          <div class="field"><span>แหล่งในวง LAN <button type="button" class="btn btn-sm net-refresh">ค้นหาใหม่</button></span>
            <div class="net-list" role="listbox"><p class="note">กำลังค้นหา…</p></div></div>
          <label class="field"><span>หรือพิมพ์ชื่อแหล่งเอง (เช่น PC-VMIX (vMix - Output 1))</span><input name="source" class="input mono" value="${esc(cur)}" maxlength="200"></label>
          <label class="field"><span>ชื่อแหล่งภาพ</span><input name="name" class="input" maxlength="32" value="${esc(inp ? inp.name : '')}" placeholder="ตั้งจากชื่อแหล่งให้อัตโนมัติ"></label>
          <p class="note net-help"></p>`,
        actions: [{ label: 'ยกเลิก' }, { label: inp ? 'บันทึก' : 'เพิ่มแหล่งภาพ', primary: true, value: 'ok' }],
        onOpen(modal, close) {
          bindNetTabs(modal, close, 'ndi');
          const f = $('form', modal), box = $('.net-list', modal), help = $('.net-help', modal);
          modal.dataset.proto = proto;
          const HELP = {
            ndi: 'ต้องติดตั้ง NDI Tools (ฟรี) จาก ndi.video/tools ในเครื่องนี้ก่อน · เครื่องส่ง (vMix, OBS + DistroAV, กล้อง PTZ NDI) ต้องอยู่ในวง LAN เดียวกัน · ภาพจะช้ากว่าต้นทางราว 0.2–0.5 วินาที',
            omt: 'Open Media Transport ของ vMix (ฟรี โอเพนซอร์ส) — vMix 29 ขึ้นไปส่ง OMT ได้ · เครื่องส่งต้องอยู่ในวง LAN เดียวกัน · ภาพจะช้ากว่าต้นทางราว 0.2–0.5 วินาที'
          };
          let seq = 0;
          const scan = async () => {
            const my = ++seq;
            help.textContent = HELP[modal.dataset.proto];
            box.innerHTML = '<p class="note">กำลังค้นหา…</p>';
            const { list, error } = await listNetSources(modal.dataset.proto);
            if (my !== seq || !box.isConnected) return;
            if (error) { box.innerHTML = `<p class="note net-err">${esc(error)}</p>`; return; }
            // "เครื่อง (ชื่อ)" → แสดงชื่อแหล่งตัวใหญ่ และชื่อเครื่องตัวเล็ก
            box.innerHTML = list.length ? list.map(n => { const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(n) || [null, '', n]; return `<button type="button" class="net-src ${n === f.source.value ? 'is-active' : ''}" data-src="${esc(n)}"><span class="net-thumb">${icon('monitor')}</span><span class="net-txt"><b>${esc(m[2])}</b><small>${esc(m[1] || 'ในวง LAN')}</small></span><em class="net-chip">${esc(NET_PROTOS[modal.dataset.proto] || '')}</em></button>`; }).join('')
              : '<p class="note">ยังไม่พบแหล่งในวง LAN — ตรวจว่าเครื่องส่งเปิดอยู่และอยู่วงเดียวกัน แล้วกด “ค้นหาใหม่”</p>';
          };
          $('.net-proto', modal).addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            modal.dataset.proto = b.dataset.value;
            $$('.net-proto button', modal).forEach(x => x.classList.toggle('is-active', x === b));
            scan();
          });
          $('.net-refresh', modal).addEventListener('click', scan);
          box.addEventListener('click', e => {
            const b = e.target.closest('.net-src');
            if (!b) return;
            f.source.value = b.dataset.src;
            $$('.net-src', box).forEach(x => x.classList.toggle('is-active', x === b));
          });
          scan();
        }
      });
      if (r?.value !== 'ok') return;
      const source = r.form.source.value.trim();
      const chosen = r.form.source.closest('.modal')?.dataset.proto || proto;
      if (!source) { toast('ยังไม่ได้เลือกแหล่งสัญญาณ', 'warn'); return; }
      store.set('net-proto', chosen);
      // "เครื่อง (ชื่อ)" → ใช้ชื่อในวงเล็บเป็นชื่อการ์ด
      const auto = (/\(([^)]+)\)\s*$/.exec(source) || [null, source])[1].slice(0, 32);
      const name = r.form.name.value.trim() || auto;
      if (inp) {
        inp.srt = { ...inp.srt, mode: chosen, source };
        inp.name = name;
        if (inp.srtCtl) { const ws = inp.srtCtl; inp.srtCtl = null; ws.close(1000, 'changed'); }
        stopSrtPlayer(inp);
        connectSrtInput(inp);
        renderInputs(); refreshSourceSelects();
      } else {
        createSrtInput({ mode: chosen, source, port: 0, latency: 500 }, name);
      }
      saveSrtInputs();
    }

    return { bindNetScanPane, bindNetTabs, netScanPaneHtml, netTabsHtml, openNetVideoDialog };
  };
})(window.WebMix = window.WebMix || {});
