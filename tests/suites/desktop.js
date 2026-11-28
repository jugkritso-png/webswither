// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// แอปเดสก์ท็อป (Tauri): จำลอง window.__TAURI__ แล้วตรวจว่าหน้า WebMix ใช้ Gateway ในแอป, บันทึกลงโฟลเดอร์ผ่าน Rust,
// ลิงก์มือถือชี้ไปหน้าเว็บสาธารณะ และตั้งค่าในหน้าต่างการตั้งค่าได้ — ส่วน Rust จริงทดสอบด้วยโหมด WEBMIX_SELFTEST ใน CI
const { listenRtmp, probe } = require('../lib');
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const { spawnSync } = require('child_process');
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };

// แทน Rust: เก็บไฟล์ไว้ในหน้า (window.__files) และนับการเรียกแต่ละคำสั่ง
const MOCK = () => {
  const files = {}; const calls = {}; let next = 0;
  window.__files = files; window.__calls = calls;
  const bytes = a => a instanceof Uint8Array ? a : new Uint8Array(a);
  const cmds = {
    desktop_info: () => ({ version: '1.0.0', os: 'linux', arch: 'x86_64', gateway: { url: 'ws://localhost:8089/?token=abc', srt: true }, gatewayError: null,
      ffmpeg: { path: '/usr/bin/ffmpeg', version: 'ffmpeg version 6.1-test' }, recDir: '/home/u/Videos/WebMix', tempDir: '/tmp', selftest: false }),
    pick_folder: () => '/media/usb/Shows',
    rec_open: ({ name, dir }) => { const id = ++next; files[id] = { name, dir: dir || '/home/u/Videos/WebMix', data: new Uint8Array(0), closed: false }; return { id, path: `${files[id].dir}/${name}`, dir: files[id].dir }; },
    rec_write: (body, h) => { const f = files[h['x-rec-id']]; const b = bytes(body); const n = new Uint8Array(f.data.length + b.length); n.set(f.data); n.set(b, f.data.length); f.data = n; return f.data.length; },
    rec_patch: (body, h) => { const f = files[h['x-rec-id']]; const pos = +h['x-position']; const b = bytes(body); if (pos + b.length > f.data.length) throw new Error('ตำแหน่งเกินขนาดไฟล์'); f.data.set(b, pos); return null; },
    rec_close: ({ id }) => { files[id].closed = true; return { path: files[id].name, bytes: files[id].data.length }; },
    save_as: (body, h) => { const r = { name: decodeURIComponent(h['x-name']), dir: h['x-dir'] ? decodeURIComponent(h['x-dir']) : '', bytes: bytes(body).length, text: new TextDecoder().decode(bytes(body)) }; (window.__saves = window.__saves || []).push(r); if (window.__saveCancel) return null; return { path: `/Users/u/Shows/${r.name}`, dir: '/Users/u/Shows' }; },
    monitors: () => [{ index: 0, name: 'Built-in Retina Display', width: 3024, height: 1964, x: 0, y: 0, scale: 2, primary: true },
      { index: 1, name: 'HDMI TV', width: 1920, height: 1080, x: 1512, y: 0, scale: 1, primary: false }],
    window_fullscreen: ({ title, on, monitor }) => { (window.__fs = window.__fs || []).push({ title, on, monitor }); window.__fsOn = on; window.__fsMon = monitor == null ? window.__fsMon : monitor; return on; },
    window_state: ({ title }) => title === 'WebMix — Program Output' ? [!!window.__fsOn, window.__fsMon === 1 ? 'HDMI TV' : 'Built-in Retina Display'] : null
  };
  window.__TAURI__ = { core: { invoke: async (cmd, args, opts) => {
    calls[cmd] = (calls[cmd] || 0) + 1;
    if (!cmds[cmd]) throw new Error('unknown command ' + cmd);
    return cmds[cmd](args, (opts && opts.headers) || {});
  } } };
};

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  // หน้าเว็บปกติ (ไม่มี Tauri) ต้องไม่เปลี่ยนพฤติกรรม
  const plain = await ctx.newPage();
  await plain.goto('http://localhost:8765/index.html'); await plain.waitForTimeout(500);
  ok('browser page: desktop mode off', await plain.evaluate(() => window.WebMix.desktop === null));
  await plain.close();

  await ctx.addInitScript(MOCK);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let downloaded = false; p.on('download', () => { downloaded = true; });
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => localStorage.setItem('webmix:settings', JSON.stringify({ gateway: 'wss://remote.example.com/?token=x', destinations: [{ id: 'd1', platform: 'custom', server: 'rtmp://127.0.0.1:1946/live', key: 'dk', enabled: true }], rememberKey: true })));
  await p.reload(); await p.waitForTimeout(1000);
  ok('desktop mode detected', await p.evaluate(() => !!window.WebMix.desktop && !!window.WebMix.desktop.info));

  // ---- Gateway ในแอป ----
  ok('status bar ready without typing a gateway', (await p.textContent('#st-stream')).includes('READY'), await p.textContent('#st-stream'));
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]');
  await p.evaluate(() => document.querySelectorAll('.modal details.adv').forEach(d => { d.open = true; }));
  ok('settings: local gateway ticked by default', await p.isChecked('[name=localGateway]'));
  const pane = await p.textContent('[data-mpane=stream]');
  ok('settings: shows ffmpeg version', pane.includes('ffmpeg version 6.1-test'));
  ok('settings: shows local gateway ready', pane.includes('Gateway ในแอปพร้อม') && !pane.includes('token=abc'), 'token must not be shown');
  ok('settings: server gateway field hidden while local is on', await p.locator('.gateway-remote').isHidden());
  await p.uncheck('[name=localGateway]');
  ok('unticking shows the server gateway field (value kept)', await p.locator('.gateway-remote').isVisible() && (await p.inputValue('[name=gateway]')) === 'wss://remote.example.com/?token=x');
  await p.check('[name=localGateway]');
  await p.screenshot({ path: S + '/desktop-settings.png' });
  await p.click('.modal-foot .btn-primary'); await p.waitForTimeout(300);
  const savedGw = await p.evaluate(() => JSON.parse(localStorage.getItem('webmix:settings')).gateway);
  ok('saved settings keep the server gateway, not the local token', savedGw === 'wss://remote.example.com/?token=x', savedGw);

  // สตรีมจริงผ่าน Gateway ในแอป (ในชุดทดสอบใช้ Gateway ที่ :8089) ไปยังเครื่องรับ RTMP
  const rtmp = listenRtmp(1946, 'dk', S + '/desktop-stream.flv');
  await p.waitForTimeout(800);
  await p.click('[data-action=stream]'); await p.waitForSelector('.dest-live-row');
  await p.locator('.dest-live-row').nth(0).locator('[data-dest-toggle]').click(); await p.waitForTimeout(8000);
  const wsUrl = await p.evaluate(() => window.webmix.streamer.ws && window.webmix.streamer.ws.url);
  ok('stream connects to the in-app gateway', /^ws:\/\/localhost:8089\//.test(wsUrl || ''), (wsUrl || '').replace(/token=[^&]+/, 'token=…'));
  ok('destination goes LIVE', (await p.textContent('#btn-stream')).includes('ON AIR 1/1'), (await p.textContent('#btn-stream')).trim());
  await p.locator('.dest-live-row').nth(0).locator('[data-dest-toggle]').click(); await p.waitForTimeout(2500);
  rtmp.kill('SIGINT'); await new Promise(r => setTimeout(r, 1500));
  const pr = probe(S + '/desktop-stream.flv');
  ok('RTMP receiver got H.264 video', /h264/.test(pr), pr);
  await p.keyboard.press('Escape');

  // ---- ลิงก์มือถือ / แขกรับเชิญ ชี้ไปหน้าเว็บสาธารณะ (หน้าในแอปเปิดจากมือถือไม่ได้) ----
  const link = await p.evaluate(() => { const w = window.webmix.wireless; w.peerId = w.peerId || 'webmix-test'; w.buildLink(); return w.link; });
  ok('phone link uses the public page', link.startsWith('https://jugkritso-png.github.io/webswither/?call='), link);
  ok('phone link has no gateway token', !/token|abc/.test(link));

  // ---- บันทึกลงโฟลเดอร์ผ่าน Rust (ค่าเริ่มต้น: วิดีโอ/WebMix) ----
  await p.click('#btn-rec'); await p.waitForTimeout(4000);
  ok('status shows the videos folder', (await p.textContent('#st-rec')).includes('Videos/WebMix'), await p.textContent('#st-rec'));
  await p.click('#btn-rec'); await p.waitForTimeout(1500);
  const f1 = await p.evaluate(() => {
    const f = window.__files[1]; if (!f) return null;
    let bin = ''; for (let i = 0; i < f.data.length; i += 0x8000) bin += String.fromCharCode.apply(null, f.data.subarray(i, i + 0x8000));
    return { name: f.name, dir: f.dir, closed: f.closed, size: f.data.length, b64: btoa(bin), patches: window.__calls.rec_patch || 0 };
  });
  ok('file written through native commands', f1 && f1.closed && f1.size > 10000 && /^WebMix-.*\.webm$/.test(f1.name) && f1.dir === '/home/u/Videos/WebMix', f1 && `${f1.dir}/${f1.name} ${f1.size} bytes`);
  ok('WebM header patched in place at stop (seekable)', f1 && f1.patches > 0, f1 && `${f1.patches} patches`);
  ok('no browser download', !downloaded);
  if (f1) {
    fs.writeFileSync(S + '/desktop-rec.webm', Buffer.from(f1.b64, 'base64'));
    const dur = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', S + '/desktop-rec.webm'], { encoding: 'utf8' }).stdout);
    ok('saved file has a duration', dur > 2 && dur < 8, `${dur}s`);
  }

  // เลือกโฟลเดอร์ด้วยหน้าต่างของระบบ → จำไว้ → ปุ่มล้างกลับไปโฟลเดอร์เริ่มต้น
  await p.click('[data-action=settings]');
  await p.click('.rec-folder-pick'); await p.waitForTimeout(300);
  ok('picked folder shown', (await p.inputValue('.rec-folder-name')) === '/media/usb/Shows');
  await p.click('.modal-foot .btn-primary'); await p.reload(); await p.waitForTimeout(1000);
  await p.click('#btn-rec'); await p.waitForTimeout(2000); await p.click('#btn-rec'); await p.waitForTimeout(1200);
  ok('picked folder remembered after restart', await p.evaluate(() => Object.values(window.__files).some(f => f.dir === '/media/usb/Shows' && f.closed)));
  await p.click('[data-action=settings]'); await p.click('.rec-folder-clear'); await p.waitForTimeout(200);
  ok('clear returns to the default folder', (await p.inputValue('.rec-folder-name')) === '/home/u/Videos/WebMix');
  await p.keyboard.press('Escape');

  // บันทึกไฟล์ (โชว์ / ภาพนิ่ง ฯลฯ): แอปเปิดหน้าต่าง Save As ของระบบ ไม่ใช่ดาวน์โหลดแบบเบราว์เซอร์ · จำโฟลเดอร์ครั้งก่อน
  {
    await p.evaluate(() => { window.__saves = []; try { localStorage.removeItem('webmix:save-dir'); } catch (e) { /* */ } });
    await p.evaluate(() => window.webmix.show.exportFile());
    const s1 = await p.evaluate(() => window.__saves[0]);
    ok('show file goes through the native Save As dialog', s1 && /\.webmix\.json$/.test(s1.name) && s1.dir === '' && JSON.parse(s1.text).app === 'webmix', JSON.stringify(s1 && { name: s1.name, dir: s1.dir }));
    ok('…and says where it was saved', await until(async () => /บันทึกไฟล์โชว์ .*\.webmix\.json/.test(await p.textContent('#toasts')), 3000), await p.textContent('#toasts'));
    await p.evaluate(() => window.webmix.show.exportFile());
    ok('next save starts in the folder used last time', await p.evaluate(() => window.__saves[1] && window.__saves[1].dir === '/Users/u/Shows'));
    await p.evaluate(() => { window.__saveCancel = true; document.querySelector('#toasts').innerHTML = ''; });
    const r = await p.evaluate(() => window.webmix.show.exportFile());
    await p.waitForTimeout(300);
    ok('cancelling Save As saves nothing and shows no success toast', r === null && !/บันทึกไฟล์โชว์/.test(await p.textContent('#toasts')));
    await p.evaluate(() => { window.__saveCancel = false; });
  }
  // หน้าต่าง Program Output: เลือกจอแล้วแอปสั่งหน้าต่างเต็มจอบนจอนั้น (WebView บน Mac เต็มจอเองไม่ได้) · จำจอไว้ เปิดครั้งหน้าเต็มจอเอง
  {
    const [win] = await Promise.all([p.waitForEvent('popup'), p.evaluate(() => window.webmix.openOutputWindow())]);
    await win.waitForTimeout(500);
    await win.click('#pick');
    const items = await win.$$eval('#menu [data-i]', bs => bs.map(x => x.textContent));
    ok('output window lists the monitors from the app', items.length === 2 && /HDMI TV/.test(items[1]) && /1512×982/.test(items[0]), JSON.stringify(items));
    await win.click('#menu [data-i="1"]'); await win.waitForTimeout(300);
    ok('picking a monitor goes native fullscreen on it', await p.evaluate(() => { const f = window.__fs.at(-1); return f.on === true && f.monitor === 1 && f.title === 'WebMix — Program Output'; }), JSON.stringify(await p.evaluate(() => window.__fs)));
    await win.waitForTimeout(700);
    ok('status shows fullscreen on that monitor', /HDMI TV · เต็มจอ/.test(await win.textContent('#scr')) && /ออกจากเต็มจอ/.test(await win.textContent('#fs')), await win.textContent('#scr'));
    await win.click('#fs'); await win.waitForTimeout(300);
    ok('fullscreen button leaves native fullscreen', await p.evaluate(() => window.__fs.at(-1).on === false));
    await win.close();
    await p.evaluate(() => { window.__fs = []; window.__fsOn = false; });
    const [win2] = await Promise.all([p.waitForEvent('popup'), p.evaluate(() => window.webmix.openOutputWindow())]);
    ok('reopened window goes fullscreen on the remembered monitor', await (async () => { for (let i = 0; i < 20; i++) { if (await p.evaluate(() => (window.__fs || []).some(f => f.on && f.monitor === 1))) return true; await win2.waitForTimeout(200); } return false; })());
    await win2.close();
  }
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
