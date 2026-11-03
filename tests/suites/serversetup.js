// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// ตั้งเซิร์ฟเวอร์ของฉัน: ข้อความสำหรับช่อง User data (รหัสสุ่มในเครื่อง · ความเร็ว · โดเมน) · ผู้ให้บริการ + ไฟร์วอลล์
// ใส่ IP → รอจน /ice ตอบด้วยรหัสนั้น → ตั้ง Stream Gateway ให้ (ช่องในหน้าตั้งค่าที่เปิดค้างได้ค่าใหม่ด้วย) · รหัสผิด / IP ผิดบอกชัด
const { chromium } = require('playwright');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // เซิร์ฟเวอร์จำลอง: 2 ครั้งแรกยังติดตั้งไม่เสร็จ (ต่อไม่ได้) แล้วตอบ /ice เมื่อรหัสถูก
  let calls = 0, good = '';
  await ctx.route(/203-0-113-7\.sslip\.io\/ice/, r => {
    calls++;
    if (calls <= 2) return r.abort('connectionrefused');
    const t = new URL(r.request().url()).searchParams.get('token');
    r.fulfill({ status: t === good ? 200 : 403, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: t === good ? '{"iceServers":[]}' : '{"error":"invalid token"}' });
  });
  await ctx.route(/198-51-100-9\.sslip\.io\/ice/, r => r.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('webmix:onboarded', '1'); });
  await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => { window.WebMix.serverSetupPollMs = 150; });

  await p.click('[data-action=settings]');
  await p.click('.modal [data-tab=stream], .modal [data-mtab=stream]').catch(() => {});
  const btn = p.locator('[data-srv-setup]');
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  ok('settings offer “set up my server” next to the gateway field', await btn.isVisible(), await btn.count());
  await btn.click();
  ok('wizard opens with 3 steps', await until(() => p.locator('.ss-step').count().then(n => n === 3)));

  const data = async () => (await p.inputValue('.ss-data'));
  const d = await data();
  const token = (/STREAM_TOKEN=([0-9a-f]+)/.exec(d) || [])[1] || '';
  ok('user data runs the installer with a token made on this device', /^#!\/bin\/bash/.test(d) && /curl -fsSL https:\/\/raw\.githubusercontent\.com\/jugkritso-png\/webswither\/HEAD\/server\/deploy\/install\.sh \| STREAM_TOKEN=[0-9a-f]{48} bash/.test(d) && token.length === 48, d);
  await p.selectOption('.modal [name=uplink]', '1000');
  ok('upload speed goes into the user data', /UPLINK_MBPS=1000/.test(await data()));
  await p.click('[data-prov=lightsail]');
  ok('Lightsail: where to paste + which ports to open', /launch script/.test(await p.textContent('.ss-where')) && await p.isVisible('.ss-fw') && /443/.test(await p.textContent('.ss-fw')));
  await p.click('[data-prov=digitalocean]');
  ok('DigitalOcean: link to create a droplet, no firewall note', /digitalocean\.com/.test(await p.getAttribute('.ss-open a', 'href')) && !(await p.isVisible('.ss-fw')));

  // ปิดแล้วเปิดใหม่ก่อนเชื่อมต่อ = รหัสเดิม (ข้อความที่วางไว้ที่ผู้ให้บริการยังใช้ได้)
  await p.locator('.modal').last().locator('.modal-foot button').first().click();
  await btn.click(); await until(() => p.isVisible('.ss-data'));
  ok('reopening keeps the same token', (await data()).includes(`STREAM_TOKEN=${token}`));

  // ใส่ค่าผิด
  await p.fill('.modal [name=ip]', '999.1.1');
  await p.click('[data-ss=connect]');
  ok('bad IP explained', /ใส่ IP ของเซิร์ฟเวอร์/.test(await p.textContent('.ss-status')));
  // เซิร์ฟเวอร์ที่ใช้รหัสอื่น
  await p.fill('.modal [name=ip]', '198.51.100.9');
  await p.click('[data-ss=connect]');
  ok('server with another token explained', await until(async () => /ใช้รหัสอื่น/.test(await p.textContent('.ss-status'))));

  // เซิร์ฟเวอร์ใหม่: รอติดตั้งเสร็จแล้วเชื่อมต่อ
  good = token;
  await p.fill('.modal [name=ip]', '203.0.113.7');
  await p.click('[data-ss=connect]');
  ok('waits while the server installs', await until(async () => /กำลังรอเซิร์ฟเวอร์/.test(await p.textContent('.ss-status')), 3000));
  ok('connects once /ice answers with the token', await until(async () => /เชื่อมต่อแล้ว/.test(await p.textContent('.ss-status'))) && calls >= 3, `${calls} calls`);
  const url = `wss://203-0-113-7.sslip.io/?token=${token}`;
  ok('Stream Gateway set and saved', await p.evaluate(u => window.webmix.settings.gateway === u && JSON.parse(localStorage.getItem('webmix:settings')).gateway === u, url));
  ok('admin link signs in with the token after #', (await p.getAttribute('.ss-status a', 'href')) === `https://203-0-113-7.sslip.io/admin#token=${token}`);
  ok('pending setup cleared', await p.evaluate(() => !JSON.parse(localStorage.getItem('webmix:server-setup') || '{}').token));
  // ปิดตัวช่วย แล้วกดบันทึกในหน้าตั้งค่าที่เปิดค้าง — ค่าใหม่ต้องไม่ถูกทับ
  await p.locator('.modal').last().locator('.modal-foot button').first().click();
  ok('open settings form got the new gateway', (await p.inputValue('.modal [name=gateway]')) === url);
  await p.locator('.modal').last().locator('.modal-foot button:has-text("บันทึก")').click();
  ok('saving settings keeps it', await p.evaluate(u => window.webmix.settings.gateway === u, url));

  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
