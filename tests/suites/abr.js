// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ใช้ได้ทั้ง Gateway Node และ Rust: GATEWAY_BIN)
// ปรับบิตเรตอัตโนมัติ: ตรรกะลด/เพิ่ม/เสนอคืนค่า · ปลายทางรับไม่ทัน (Gateway รายงาน lag) → ลดบิตเรตแล้วเชื่อมต่อใหม่ที่ค่าใหม่
const { listenRtmp } = require('../lib');
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);

  // ตรรกะ
  const logic = await p.evaluate(() => {
    const A = window.webmix.abr, s = A.state, set = window.webmix.settings;
    set.videoKbps = 4500;
    const reset = () => Object.assign(s, { kbps: 0, high: 0, lastChange: 0, clearSince: 0, offered: false });
    const out = {};
    reset();
    out.one = A.decide({ upLag: 3000, destLag: 0 }, 100000, false);
    out.two = A.decide({ upLag: 0, destLag: 3000 }, 102000, false);
    reset();
    out.spike = A.decide({ upLag: 7000, destLag: 0 }, 100000, false);
    reset(); s.lastChange = 90000;
    A.decide({ upLag: 3000, destLag: 0 }, 100000, false);
    out.tooSoon = A.decide({ upLag: 3000, destLag: 0 }, 102000, false);
    reset(); s.kbps = 1600;
    A.decide({ upLag: 9000, destLag: 0 }, 100000, false);
    out.floor = A.decide({ upLag: 9000, destLag: 0 }, 102000, false);
    // เพิ่มกลับ: WebCodecs ทีละ 15% หลังเน็ตดี 30 วินาที · ทางอื่นเสนอปุ่มหลัง 60 วินาที ครั้งเดียว
    reset(); s.kbps = 3200; s.lastChange = 1;
    A.decide({ upLag: 100, destLag: 0 }, 100000, true);
    out.upEarly = A.decide({ upLag: 100, destLag: 0 }, 120000, true);
    out.up = A.decide({ upLag: 100, destLag: 0 }, 131000, true);
    reset(); s.kbps = 3200; s.lastChange = 1;
    A.decide({ upLag: 100, destLag: 0 }, 100000, false);
    out.offerEarly = A.decide({ upLag: 100, destLag: 0 }, 131000, false);
    out.offer = A.decide({ upLag: 100, destLag: 0 }, 161000, false);
    reset();
    return out;
  });
  ok('one slow sample is ignored', logic.one === null, JSON.stringify(logic.one));
  ok('two slow samples (upload or destination) step down 30%', logic.two && logic.two.dir === 'down' && logic.two.kbps === 3200, JSON.stringify(logic.two));
  ok('a very large backlog steps down at once', logic.spike && logic.spike.kbps === 3200);
  ok('no second reconnect-change within 30 s', logic.tooSoon === null);
  ok('never below the floor (35% / 800 kbps)', logic.floor === null, JSON.stringify(logic.floor));
  ok('WebCodecs: steps back up 15% after 30 s clear', logic.upEarly === null && logic.up && logic.up.dir === 'up' && logic.up.kbps === 3700, JSON.stringify(logic.up));
  ok('other encoders: offers full quality after 60 s clear', logic.offerEarly === null && logic.offer && logic.offer.dir === 'offer', JSON.stringify(logic.offer));
  // WebCodecs: เปลี่ยนบิตเรตระหว่างเข้ารหัสได้โดยไม่หยุด
  const wc = await p.evaluate(() => new Promise(res => {
    const W = window.WebMix.wcrec; if (!W.hasApi()) return res({ skip: true });
    const r = W.recorder({ canvas: document.querySelector('#pgm-canvas'), audioNode: null, fps: 30, videoBitsPerSecond: 4e6, audioBitsPerSecond: 128000, preferAvc: false });
    let bytes = 0, after = 0, changed = false;
    r.ondataavailable = e => { bytes += e.data.size; if (changed) after += e.data.size; };
    r.start(250);
    setTimeout(() => { changed = r.setBitrate(1e6); setTimeout(() => { r.stop(); res({ changed, bytes, after, err: r.state }); }, 1500); }, 1500);
  }));
  ok('WebCodecs encoder changes bitrate while running', wc.skip || (wc.changed && wc.after > 0), JSON.stringify(wc));
  ok('setting is on by default', await p.evaluate(() => window.webmix.settings.abr === true));

  // ปลายทางรับไม่ทัน: หยุดตัวรับ RTMP ไว้ (SIGSTOP) → ข้อมูลค้างใน Gateway → แอปลดบิตเรต
  const rx = listenRtmp(1994, 'slow', `${S}/abr.flv`);
  await p.evaluate(() => { const s = window.webmix.settings; s.gateway = 'ws://127.0.0.1:8089/?token=abc'; s.videoKbps = 8000;
    s.destinations.splice(0, s.destinations.length, { id: 'slow', platform: 'custom', server: 'rtmp://127.0.0.1:1994/live', key: 'slow', passphrase: '', latency: 500, enabled: true, orient: 'h' }); });
  await p.click('#btn-stream'); await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]');
  let live = false;
  for (let i = 0; i < 60 && !live; i++) { await p.waitForTimeout(500); live = await p.evaluate(() => window.webmix.streamer.dests.get('slow')?.state === 'live'); }
  ok('stream goes live at 8000 kbps', live && await p.evaluate(() => /vb=8000/.test(window.webmix.streamer.ws.url)));
  await p.waitForTimeout(3000);
  process.kill(rx.pid, 'SIGSTOP');
  let maxLag = 0, log = [];
  for (let i = 0; i < 90 && !log.length; i++) {
    await p.waitForTimeout(1000);
    const st = await p.evaluate(() => ({ lag: window.webmix.streamer.dests.get('slow')?.lag || 0, log: window.webmix.abr.state.log }));
    maxLag = Math.max(maxLag, st.lag); log = st.log;
  }
  ok('gateway reports a growing backlog for the stalled destination', maxLag > 2500, `${maxLag} ms`);
  ok('app steps the bitrate down by reconnecting', log.length >= 1 && log[0].dir === 'down' && log[0].kbps === 5600 && log[0].how === 'reconnect', JSON.stringify(log));
  let url = '';
  for (let i = 0; i < 20 && !/vb=5600/.test(url); i++) { await p.waitForTimeout(500); url = await p.evaluate(() => window.webmix.streamer.ws?.url || ''); }
  ok('new gateway connection uses the lower bitrate', /vb=5600/.test(url), url);
  ok('status bar shows the reduced bitrate', /ลดบิตเรต 5600\/8000/.test(await p.textContent('#st-stream')), await p.textContent('#st-stream'));
  ok('no “connection lost” toast for a planned switch', !(await p.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /หลุด/.test(t.textContent)))));
  process.kill(rx.pid, 'SIGCONT'); rx.kill('SIGKILL');
  await p.click('#btn-stream').catch(() => {}); await p.waitForTimeout(300);
  await p.evaluate(() => window.webmix.streamer.ws && window.webmix.streamer.ws.close(1000));
  await p.waitForTimeout(500);
  ok('stopping resets the bitrate for the next stream', await p.evaluate(() => window.webmix.abr.state.kbps === 0));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
