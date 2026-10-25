// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const { spawn } = require('child_process');
  const srtRx = (args, file) => spawn('ffmpeg', ['-loglevel', 'error', ...args, '-c', 'copy', '-y', file], { stdio: 'ignore' });
  const rxs = [
    srtRx(['-passphrase', 'p@ss word!&x=1', '-pbkeylen', '16', '-i', 'srt://127.0.0.1:9000?mode=listener&latency=200000'], S + '/srt_ok.ts'),
    srtRx(['-passphrase', 'correctpassword', '-i', 'srt://127.0.0.1:9001?mode=listener'], S + '/srt_bad.ts'),
    listenRtmp(1935, 'k1', S + '/srt_rtmp.flv')
  ];
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]');
  await p.fill('.modal input[name=gateway]', 'ws://127.0.0.1:8089/?token=abc');
  const row = n => p.locator('.dest-row').nth(n);
  // row 0: SRT encrypted
  await row(0).locator('[data-f=platform]').selectOption('srt');
  ok('SRT fields appear', await row(0).locator('.dest-srt').isVisible() && (await row(0).locator('[data-f=key]').getAttribute('placeholder')).includes('Stream ID'));
  await row(0).locator('[data-f=server]').fill('srt://127.0.0.1:9000');
  await row(0).locator('[data-f=key]').fill('#!::r=live/cam1,m=publish');
  await row(0).locator('[data-f=passphrase]').fill('p@ss word!&x=1');
  await row(0).locator('[data-f=latency]').selectOption('200');
  // row 1: RTMP at the same time
  await p.click('.dest-add'); await row(1).locator('[data-f=platform]').selectOption('custom');
  await row(1).locator('[data-f=server]').fill('rtmp://127.0.0.1:1935/live'); await row(1).locator('[data-f=key]').fill('k1');
  // row 2: SRT with the wrong passphrase
  await p.click('.dest-add'); await row(2).locator('[data-f=platform]').selectOption('srt');
  await row(2).locator('[data-f=server]').fill('srt://127.0.0.1:9001'); await row(2).locator('[data-f=passphrase]').fill('wrongpassword');
  // validation: short passphrase
  await p.screenshot({ path: S + '/srt-settings.png' });
  await p.click('.modal-foot .btn-primary');
  const url = await p.evaluate(() => { const d = window.webmix.settings.destinations[0]; return d; });
  ok('saved SRT destination', url.platform === 'srt' && url.latency === 200 && url.passphrase === 'p@ss word!&x=1', JSON.stringify(url));
  await p.click('[data-action=stream]'); await p.waitForSelector('.dest-live-row');
  const rowText = async n => (await p.locator('.dest-live-row').nth(n).textContent()).replace(/\s+/g, ' ').trim();
  ok('panel shows SRT label + masked details', (await rowText(0)).includes('SRT 127.0.0.1') && (await rowText(0)).includes('200 ms') && !(await rowText(0)).includes('p@ss'), await rowText(0));
  await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]'); await p.waitForTimeout(9000);
  ok('SRT encrypted live', (await rowText(0)).includes('LIVE'), await rowText(0));
  ok('RTMP live alongside', (await rowText(1)).includes('LIVE'), await rowText(1));
  ok('wrong passphrase → error', /หลุด|กำลังเชื่อมต่อ/.test(await rowText(2)), await rowText(2));
  ok('button shows 2 live of 3', (await p.textContent('#btn-stream')).includes('ON AIR 2/3'), (await p.textContent('#btn-stream')).trim());
  await p.waitForTimeout(3000);
  await p.click('.dest-stop-all'); await p.locator('.modal-foot .btn-danger').last().click(); await p.waitForTimeout(1500);
  ok('stopped', (await p.textContent('#btn-stream')).trim() === 'STREAM');
  ok('passphrase not persisted', await p.evaluate(() => JSON.parse(localStorage.getItem('webmix:settings')).destinations.every(d => !d.passphrase && !d.key)));
  // validation of short passphrase
  await p.keyboard.press('Escape');
  await p.evaluate(() => { const d = window.webmix.settings.destinations[0]; d.passphrase = 'short'; });
  await p.click('[data-action=stream]'); await p.locator('.dest-live-row').nth(0).locator('[data-dest-toggle]').click(); await p.waitForTimeout(300);
  ok('short passphrase rejected', await p.isVisible('.modal [data-mpane=stream].is-active') && /10–64/.test(await p.textContent('#toasts')), await p.textContent('#toasts'));
  const got = probe(S + '/srt_ok.ts');
  ok('encrypted SRT receiver got H.264 + AAC', /h264/.test(got) && /aac/.test(got), got);
  ok('wrong passphrase receiver got nothing', !require('fs').existsSync(S + '/srt_bad.ts'));
  ok('RTMP alongside received video', /h264/.test(probe(S + '/srt_rtmp.flv')));
  rxs.forEach(x => x.kill('SIGKILL'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
