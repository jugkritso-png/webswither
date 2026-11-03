/* ตั้งเซิร์ฟเวอร์ของฉัน: เช่าเซิร์ฟเวอร์ → วางข้อความในช่อง User data ตอนสร้าง → ใส่ IP แล้วแอปเชื่อมต่อให้เอง
   ไม่ต้องพิมพ์คำสั่งบนเซิร์ฟเวอร์ — เซิร์ฟเวอร์รัน install.sh เองตอนเปิดเครื่องครั้งแรก (cloud-init)
   รหัสผู้ดูแล (STREAM_TOKEN) สุ่มในเครื่องนี้ ใส่ไว้ในข้อความนั้น แล้วแอปใช้รหัสเดียวกันเชื่อมต่อ (ตรวจด้วย /ice ที่ต้องใช้รหัส)
   ใช้โดเมน <IP>.sslip.io ให้อัตโนมัติ (ไม่ต้องมีโดเมน) หรือโดเมนของตัวเอง */
(function (WM) {
  'use strict';
  const { $, esc, store, toast, desktop } = WM;
  const INSTALL = 'https://raw.githubusercontent.com/jugkritso-png/webswither/HEAD/server/deploy/install.sh';

  // ผู้ให้บริการ: ลิงก์สร้างเครื่อง · ช่อง User data อยู่ตรงไหน · ไฟร์วอลล์
  const PROVIDERS = {
    digitalocean: { name: 'DigitalOcean', url: 'https://cloud.digitalocean.com/droplets/new',
      where: 'หน้า Create Droplet → Advanced Options → ติ๊ก “Add Initialization scripts” แล้ววางข้อความ', fw: '' },
    vultr: { name: 'Vultr', url: 'https://my.vultr.com/deploy/',
      where: 'หน้า Deploy → Additional Features → ติ๊ก “Cloud-Init User-Data” แล้ววางข้อความ', fw: '' },
    linode: { name: 'Linode (Akamai)', url: 'https://cloud.linode.com/linodes/create',
      where: 'หน้า Create Linode → Add User Data แล้ววางข้อความ (เลือกภูมิภาคที่รองรับ Metadata)', fw: '' },
    lightsail: { name: 'AWS Lightsail', url: 'https://lightsail.aws.amazon.com/ls/webapp/create/instance',
      where: 'หน้า Create instance → Add launch script แล้ววางข้อความ',
      fw: 'Lightsail ปิดพอร์ตไว้ — หลังสร้างเครื่อง ไปที่แท็บ Networking เปิด TCP 80, 443, 3478 และ UDP 3478, 9000–9009, 49160–49250' },
    other: { name: 'ผู้ให้บริการอื่น', url: '',
      where: 'มองหาช่อง “User data”, “Cloud-init” หรือ “Startup script” ตอนสร้างเครื่อง แล้ววางข้อความ',
      fw: 'ถ้าผู้ให้บริการมีไฟร์วอลล์ เปิด TCP 80, 443, 3478 และ UDP 3478, 9000–9009, 49160–49250' }
  };

  const newToken = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
  // ที่อยู่ของเซิร์ฟเวอร์: IPv4 → <IP>.sslip.io · ไม่อย่างนั้นถือเป็นโดเมน
  function hostOf(text) {
    const t = String(text || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#:].*$/, '').toLowerCase();
    // ตัวเลขกับจุดล้วน = ตั้งใจใส่ IP — ต้องเป็น IPv4 ที่ถูกต้อง (ไม่ใช่ถือว่าเป็นโดเมน)
    if (/^[\d.]+$/.test(t)) return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(t) && t.split('.').every(n => +n <= 255) ? t.replace(/\./g, '-') + '.sslip.io' : '';
    // โดเมน: ส่วนท้าย (TLD) ต้องมีตัวอักษร
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z][a-z0-9-]*[a-z0-9]$/.test(t) ? t : '';
  }
  // ข้อความที่วางในช่อง User data (cloud-init รันเป็น root ตอนเปิดเครื่องครั้งแรก)
  function userData(job) {
    const env = [`STREAM_TOKEN=${job.token}`, job.uplink ? `UPLINK_MBPS=${job.uplink}` : '', job.domain ? `DOMAIN=${job.domain}` : ''].filter(Boolean).join(' ');
    // คอมเมนต์ในสคริปต์เป็นภาษาอังกฤษ — เป็นข้อความที่วางในหน้าเว็บของผู้ให้บริการ ไม่ใช่หน้าจอของแอป
    return `#!/bin/bash\n# WebMix Stream Gateway: installs itself on first boot (about 5-8 minutes)\ncurl -fsSL ${INSTALL} | ${env} bash\n`;
  }

  WM.createServerSetup = function (studio) {
    const { dialog, saveSettings, updateStatus } = studio;

    // รอให้เซิร์ฟเวอร์ติดตั้งเสร็จ: /ice ตอบ 200 = HTTPS พร้อม และรหัสถูกต้อง
    async function waitReady(host, token, onTick, signal) {
      const t0 = Date.now(), LIMIT = 20 * 60 * 1000;
      while (!signal.stopped) {
        try {
          const r = await fetch(`https://${host}/ice?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
          if (r.ok) return 'ok';
          if (r.status === 403) return 'token';
        } catch (e) { /* ยังติดตั้งไม่เสร็จ / HTTPS ยังไม่พร้อม */ }
        if (Date.now() - t0 > LIMIT) return 'timeout';
        onTick(Math.round((Date.now() - t0) / 1000));
        await new Promise(r => setTimeout(r, WM.serverSetupPollMs || 10000)); // ชุดทดสอบตั้งให้สั้นลงได้
      }
      return 'stopped';
    }

    // onDone(url): ให้หน้าตั้งค่าที่เปิดค้างอยู่ได้ค่าใหม่ด้วย (ไม่อย่างนั้นกดบันทึกแล้วค่าเดิมทับ)
    async function openServerSetup({ onDone } = {}) {
      // รหัสคงเดิมจนกว่าจะเชื่อมต่อสำเร็จ — ปิดหน้าต่างแล้วกลับมาทำต่อได้ ข้อความใน User data ยังใช้ได้
      const job = { token: '', provider: 'digitalocean', uplink: '', domain: '', ...store.get('server-setup', {}) };
      if (!/^[0-9a-f]{48}$/.test(job.token)) job.token = newToken();
      store.set('server-setup', job);
      const signal = { stopped: false };
      const tiles = Object.entries(PROVIDERS).map(([k, p]) => `<button type="button" class="ss-prov" data-prov="${k}" aria-pressed="${k === job.provider}">${esc(p.name)}</button>`).join('');
      await dialog({
        title: 'ตั้งเซิร์ฟเวอร์ของฉัน',
        wide: true,
        body: `<div class="ss">
          <p class="note">ไม่ต้องพิมพ์คำสั่ง — 3 ขั้นตอน ราว 10 นาที · เซิร์ฟเวอร์ของคุณเอง ส่งไลฟ์ไปหลายปลายทาง ทำงานต่อแม้ปิดเครื่องนี้</p>
          <section class="ss-step"><h3><b>1</b> เช่าเซิร์ฟเวอร์</h3>
            <div class="ss-provs" role="group" aria-label="ผู้ให้บริการ">${tiles}</div>
            <p class="ss-spec">เลือก <b>Ubuntu 24.04</b> · แนะนำ <b>2 vCPU / RAM 2 GB</b> ขึ้นไป (ไลฟ์ 1080p ได้ราว 1 รายการต่อ 2 vCPU) · เลือกภูมิภาคใกล้ผู้ชม เช่น สิงคโปร์</p>
            <p class="ss-open"></p>
          </section>
          <section class="ss-step"><h3><b>2</b> วางข้อความนี้ในช่อง User data ตอนสร้างเครื่อง</h3>
            <p class="ss-where note"></p>
            <div class="field-row">
              <label class="field"><span>ความเร็วอัปโหลดของเซิร์ฟเวอร์ (ไม่บังคับ)</span><select name="uplink" class="select">
                ${[['', 'ไม่ทราบ'], ['100', '100 Mbps'], ['1000', '1 Gbps'], ['10000', '10 Gbps']].map(([v, l]) => `<option value="${v}" ${v === job.uplink ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="field"><span>โดเมนของตัวเอง (ไม่บังคับ — ไม่ใส่ก็ใช้ได้)</span><input name="domain" class="input mono" placeholder="live.example.com" value="${esc(job.domain)}"></label>
            </div>
            <textarea class="input mono ss-data" rows="4" readonly aria-label="ข้อความสำหรับช่อง User data"></textarea>
            <div class="ss-row"><button type="button" class="btn btn-primary" data-ss="copy">คัดลอกข้อความ</button>
              <small class="muted">มีรหัสผู้ดูแลของเซิร์ฟเวอร์อยู่ในนี้ — วางที่ผู้ให้บริการเท่านั้น อย่าส่งให้คนอื่น</small></div>
            <p class="ss-fw warn-note" hidden></p>
          </section>
          <section class="ss-step"><h3><b>3</b> ใส่ IP ของเซิร์ฟเวอร์ แล้วรอให้ติดตั้งเสร็จ</h3>
            <div class="ss-row"><input name="ip" class="input mono" placeholder="เช่น 203.0.113.7" inputmode="decimal" autocomplete="off">
              <button type="button" class="btn btn-primary" data-ss="connect">เชื่อมต่อ</button></div>
            <p class="ss-status" role="status"></p>
          </section>
        </div>`,
        actions: [{ label: 'ปิด' }],
        onOpen(modal) {
          const f = n => $(`[name=${n}]`, modal);
          const draw = () => {
            const p = PROVIDERS[job.provider];
            modal.querySelectorAll('.ss-prov').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.prov === job.provider)));
            $('.ss-open', modal).innerHTML = p.url ? `<a href="${p.url}" target="_blank" rel="noopener">เปิดหน้าสร้างเซิร์ฟเวอร์ของ ${esc(p.name)} ↗</a>` : '';
            $('.ss-where', modal).textContent = p.where;
            const fw = $('.ss-fw', modal); fw.hidden = !p.fw; fw.textContent = p.fw;
            $('.ss-data', modal).value = userData(job);
          };
          modal.addEventListener('click', async e => {
            const pb = e.target.closest('[data-prov]');
            if (pb) { job.provider = pb.dataset.prov; store.set('server-setup', job); draw(); return; }
            const b = e.target.closest('[data-ss]');
            if (!b) return;
            if (b.dataset.ss === 'copy') {
              const ta = $('.ss-data', modal);
              try { await navigator.clipboard.writeText(ta.value); toast('คัดลอกแล้ว — วางในช่อง User data ตอนสร้างเครื่อง', 'success'); }
              catch (err) { ta.select(); toast('เลือกข้อความไว้แล้ว — กด Ctrl+C / ⌘C เพื่อคัดลอก', 'info'); }
              return;
            }
            // เชื่อมต่อ: รอจน /ice ตอบ แล้วตั้ง Gateway ให้
            const st = $('.ss-status', modal);
            const host = job.domain ? hostOf(job.domain) : hostOf(f('ip').value);
            if (!host) { st.textContent = job.domain ? 'โดเมนไม่ถูกต้อง' : 'ใส่ IP ของเซิร์ฟเวอร์ (ตัวเลข 4 ชุด เช่น 203.0.113.7)'; f('ip').focus(); return; }
            b.disabled = true;
            st.textContent = `กำลังรอเซิร์ฟเวอร์ ${host} ติดตั้ง…`;
            const r = await waitReady(host, job.token, sec => { if (modal.isConnected) st.textContent = `กำลังรอเซิร์ฟเวอร์ติดตั้ง (${Math.floor(sec / 60)} นาที ${sec % 60} วินาที) — ปกติ 5–8 นาที ปิดหน้าต่างนี้แล้วกลับมากดใหม่ได้`; }, signal);
            b.disabled = false;
            if (r === 'stopped') return;
            if (r === 'token') { st.textContent = 'เซิร์ฟเวอร์นี้ใช้รหัสอื่น — ถ้าเคยติดตั้งไว้แล้ว ใส่ค่าจาก gateway-url.txt บนเซิร์ฟเวอร์ในช่อง Stream Gateway เอง'; return; }
            if (r === 'timeout') { st.textContent = `ยังติดต่อ ${host} ไม่ได้หลังรอ 20 นาที — ตรวจว่าวางข้อความในช่อง User data แล้ว และเปิดพอร์ต 80 / 443 ในไฟร์วอลล์ของผู้ให้บริการ`; return; }
            const url = `wss://${host}/?token=${job.token}`;
            studio.settings.gateway = url;
            if (desktop) studio.settings.localGateway = false;
            saveSettings(); updateStatus();
            onDone?.(url);
            store.set('server-setup', {});
            st.innerHTML = `<b>เชื่อมต่อแล้ว</b> — ไลฟ์ผ่านเซิร์ฟเวอร์ ${esc(host)} ได้เลย · <a href="https://${host}/admin#token=${job.token}" target="_blank" rel="noopener">เปิดหน้าจัดการเซิร์ฟเวอร์ ↗</a> (เพิ่มคน · ดูไลฟ์ · อัปเดตเองทุกคืน)`;
            toast(`ตั้งเซิร์ฟเวอร์ ${host} เรียบร้อย`, 'success', 6000);
          });
          modal.addEventListener('input', e => {
            if (e.target.name === 'uplink') job.uplink = e.target.value;
            else if (e.target.name === 'domain') job.domain = hostOf(e.target.value) || '';
            else return;
            store.set('server-setup', job); draw();
          });
          modal.addEventListener('change', e => { if (e.target.name === 'uplink') { job.uplink = e.target.value; store.set('server-setup', job); draw(); } });
          draw();
        }
      });
      signal.stopped = true;
    }

    return { openServerSetup, hostOf, userData };
  };
})(window.WebMix = window.WebMix || {});
