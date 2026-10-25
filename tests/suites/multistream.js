// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js (ตั้งค่า WORK, เซิร์ฟเวอร์ทดสอบ และ fixtures ให้อัตโนมัติ)
const { fixture, out, listenRtmp, probe, ROOT } = require('../lib');
const { chromium, devices } = require('playwright');
const fs = require('fs'); const S = process.env.WORK;
const peerLib = fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js'), 'utf8') + `;(function(){const P=window.Peer;window.Peer=function(id,o){if(typeof id==='object'||id===undefined){o=id;id=undefined;}o=Object.assign({host:'127.0.0.1',port:9900,path:'/',secure:false},o||{});return id?new P(id,o):new P(o);};})();`;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
async function setup(ctx) {
  await ctx.route('**/peerjs.min.js', r => r.fulfill({ contentType: 'application/javascript', body: peerLib }));
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode/, r => r.fulfill({ contentType: 'text/css', body: '' }));
}
(async () => {
  const rxs = [1, 2, 3].map(n => listenRtmp(1934 + n, 'k' + n, `${S}/o${n}.flv`));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); await setup(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  // migration from the old single-destination settings
  await p.goto('http://localhost:8765/index.html');
  await p.evaluate(() => localStorage.setItem('webmix:settings', JSON.stringify({ platform: 'custom', server: 'rtmp://127.0.0.1:1935/live', streamKey: '', gateway: 'ws://127.0.0.1:8089/?token=abc' })));
  await p.reload(); await p.waitForTimeout(800);
  const mig = await p.evaluate(() => window.webmix.settings.destinations);
  ok('migrates old settings', mig.length === 1 && mig[0].server === 'rtmp://127.0.0.1:1935/live' && mig[0].platform === 'custom', JSON.stringify(mig));

  // configure destinations via the settings UI
  await p.click('[data-action=settings]'); await p.click('[data-mtab=stream]');
  await p.fill('.dest-row >> nth=0 >> [data-f=key]', 'k1');
  await p.click('.dest-add'); await p.selectOption('.dest-row >> nth=1 >> [data-f=platform]', 'custom');
  await p.fill('.dest-row >> nth=1 >> [data-f=server]', 'rtmp://127.0.0.1:1936/live'); await p.fill('.dest-row >> nth=1 >> [data-f=key]', 'k2');
  await p.click('.dest-add'); await p.selectOption('.dest-row >> nth=2 >> [data-f=platform]', 'custom');
  await p.fill('.dest-row >> nth=2 >> [data-f=server]', 'rtmp://127.0.0.1:1937/live'); await p.fill('.dest-row >> nth=2 >> [data-f=key]', 'k3');
  await p.uncheck('.dest-row >> nth=2 >> [data-f=enabled]');
  await p.click('.dest-add'); await p.selectOption('.dest-row >> nth=3 >> [data-f=platform]', 'youtube');
  ok('youtube preset fills server', (await p.inputValue('.dest-row >> nth=3 >> [data-f=server]')) === 'rtmp://a.rtmp.youtube.com/live2');
  await p.click('.dest-row >> nth=3 >> .dest-remove');
  await p.screenshot({ path: S + '/ms-settings.png' });
  await p.click('.modal-foot .btn-primary');
  const dests = await p.evaluate(() => window.webmix.settings.destinations.map(d => `${d.enabled ? '+' : '-'}${d.server}/${d.key}`));
  ok('saved 3 destinations', dests.length === 3, JSON.stringify(dests));
  ok('status shows ready count', (await p.textContent('#st-stream')).includes('2 ปลายทาง'), await p.textContent('#st-stream'));

  const { spawn } = require('child_process');
  const listen = (port, key, out) => spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/${key}`, '-c', 'copy', '-y', `${S}/${out}.flv`], { stdio: 'ignore' });
  const row = n => p.locator('.dest-live-row').nth(n);
  const rowText = async n => (await row(n).textContent()).replace(/\s+/g, ' ').trim();

  // start ONLY destination #2 from the panel
  await p.click('[data-action=stream]'); await p.waitForSelector('.dest-live-row');
  ok('panel lists 3 destinations, all ready', (await p.locator('.dest-live-row').count()) === 3 && (await rowText(0)).includes('พร้อม'));
  await row(1).locator('[data-dest-toggle]').click(); await p.waitForTimeout(7000);
  ok('only #2 live', (await rowText(1)).includes('LIVE') && (await rowText(0)).includes('พร้อม') && (await rowText(2)).includes('พร้อม'), `${await rowText(0)} | ${await rowText(1)}`);
  ok('button ON AIR 1/1', (await p.textContent('#btn-stream')).includes('ON AIR 1/1'), (await p.textContent('#btn-stream')).trim());
  // add #1 then the unticked #3, one at a time
  await row(0).locator('[data-dest-toggle]').click(); await p.waitForTimeout(6500);
  await row(2).locator('[data-dest-toggle]').click(); await p.waitForTimeout(6500);
  ok('all three live individually', (await p.textContent('#btn-stream')).includes('ON AIR 3/3'), (await p.textContent('#btn-stream')).trim());
  ok('start-all disabled when ticked ones running', await p.isDisabled('.dest-start-all'));
  await p.screenshot({ path: S + '/ms-live.png' });
  // stop #2 only
  await row(1).locator('[data-dest-toggle]').click(); await p.waitForTimeout(2500);
  ok('#2 stopped, others still live', (await rowText(1)).includes('หยุดแล้ว') && (await p.textContent('#btn-stream')).includes('ON AIR 2/2'), (await p.textContent('#btn-stream')).trim());
  // stop the remaining ones individually → connection closes by itself
  await row(0).locator('[data-dest-toggle]').click(); await row(2).locator('[data-dest-toggle]').click(); await p.waitForTimeout(2500);
  ok('auto-disconnect after last stop', (await p.textContent('#btn-stream')).trim() === 'STREAM' && (await p.textContent('#tally-lamp')).includes('OFF AIR') && (await rowText(0)).includes('พร้อม'), (await p.textContent('#btn-stream')).trim());
  // start all (ticked #1 and #2) then stop all
  const l1 = listen(1935, 'k1', 'o1b'), l2 = listen(1936, 'k2', 'o2b'); await p.waitForTimeout(800);
  await p.click('.dest-start-all'); await p.click('.pf-desk [data-cd="0"]'); await p.click('.pf-desk [data-pf=go]'); await p.waitForTimeout(7000);
  ok('start all → ticked ones live', (await p.textContent('#btn-stream')).includes('ON AIR 2/2') && (await rowText(2)).includes('พร้อม'), (await p.textContent('#btn-stream')).trim());
  await p.click('.dest-stop-all'); await p.waitForSelector('.modal-text:has-text("ทุกปลายทาง")');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Esc closes only the confirm box', (await p.locator('.modal-backdrop').count()) === 1 && (await p.textContent('#btn-stream')).includes('ON AIR'));
  await p.click('.dest-stop-all'); await p.waitForSelector('.modal-text:has-text("ทุกปลายทาง")'); await p.locator('.modal-foot .btn-danger').last().click(); await p.waitForTimeout(1500);
  ok('stop all', (await p.textContent('#btn-stream')).trim() === 'STREAM' && (await p.textContent('#tally-lamp')).includes('OFF AIR'));
  await p.keyboard.press('Escape');
  ok('keys not persisted', await p.evaluate(() => JSON.parse(localStorage.getItem('webmix:settings')).destinations.every(d => d.key === '')));

  // mobile layout of the settings dialog
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await setup(m.context()); await m.goto('http://localhost:8765/index.html'); await m.waitForTimeout(800);
  await m.tap('[data-action=settings]'); await m.tap('[data-mtab=stream]'); await m.tap('.dest-add');
  ok('mobile no overflow', await m.evaluate(() => document.querySelector('.modal').scrollWidth <= document.querySelector('.modal').clientWidth + 1));
  await m.screenshot({ path: S + '/ms-mobile.png' });
  for (const f of ['o1', 'o2', 'o3', 'o1b', 'o2b']) { const got = probe(`${S}/${f}.flv`); ok(`destination ${f} received video`, /h264/.test(got), got); }
  rxs.forEach(x => x.kill('SIGKILL'));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
