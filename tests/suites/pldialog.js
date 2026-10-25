// สร้างโดยชุดทดสอบ WebMix — รันผ่าน tests/run.js
// หน้าแก้ Playlist (แบบใหม่): สถานะ กำลังเล่น / ถัดไป · ความยาวไฟล์ · รวมเวลา · ลากเรียง · ปุ่มถัดไป · สุ่ม · จบแล้วตัดกลับ · บันทึกกับโชว์
const { chromium } = require('playwright');
const S = process.env.WORK;
const results = []; const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)|qrcode|peerjs/, r => r.fulfill({ body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  const fc = p.waitForEvent('filechooser'); await p.click('[data-action=add-menu]'); await p.click('.menu button:has-text("Playlist")');
  await (await fc).setFiles([S + '/logo.png', S + '/clip.webm', S + '/green.png']);
  await p.waitForTimeout(800);
  const id = await p.evaluate(() => window.webmix.inputs.find(i => i.type === 'playlist').id);
  const card = p.locator(`#inputs-grid .card[data-id="${id}"]`);
  await card.hover(); await card.locator('[data-card=rename]').click(); await p.waitForSelector('.pl-modal');
  ok('current item marked “playing”', await p.isVisible('.pl-row[data-i="0"] .pl-chip.now'));
  ok('next item marked', await p.isVisible('.pl-row[data-i="1"] .pl-chip.next'));
  await p.waitForFunction(() => /0:0[34]/.test(document.querySelector('.pl-row[data-i="1"] .pl-dur')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
  ok('video length read from the file', /00:00:0[34]/.test(await p.textContent('.pl-row[data-i="1"] .pl-dur')), await p.textContent('.pl-row[data-i="1"] .pl-dur'));
  ok('total time shown', /00:00:1[34]/.test(await p.textContent('[data-pl-total]')), await p.textContent('[data-pl-total]'));
  ok('now-playing preview + controls', await p.isVisible('.pl-now canvas') && await p.isVisible('[data-pl=next]'));
  await p.locator('.pl-row[data-i="2"]').dragTo(p.locator('.pl-row[data-i="0"]'));
  await p.waitForTimeout(300);
  const names = await p.evaluate(id => window.webmix.inputs.find(i => i.id === id).list.items.map(x => x.name).join(','), id);
  ok('drag to reorder', names === 'green.png,logo.png,clip.webm', names);
  ok('current item follows the reorder', await p.evaluate(id => { const l = window.webmix.inputs.find(i => i.id === id).list; return l.items[l.index].name === 'logo.png'; }, id));
  await p.click('[data-pl=next]'); await p.waitForTimeout(500);
  ok('“next” plays the next file', await p.evaluate(id => { const l = window.webmix.inputs.find(i => i.id === id).list; return l.items[l.index].name === 'clip.webm'; }, id));
  await p.click('.pl-modal [name=shuffle]'); await p.click('.pl-modal [name=loop]'); await p.click('.pl-modal [name=endCut]');
  await p.click('.pl-modal .modal-foot .btn-primary');
  ok('options saved', await p.evaluate(id => { const l = window.webmix.inputs.find(i => i.id === id).list; return l.shuffle && !l.loop && l.endCut; }, id));
  ok('saved with the show', await p.evaluate(() => { const l = window.webmix.show.serialize().inputs.find(i => i.type === 'playlist').list; return l.shuffle && l.endCut && l.items.some(x => x.dur > 3); }));
  // จบรายการ (ไม่วน + ตัดกลับ) ขณะอยู่บน Program → AUTO ไปภาพใน Preview
  await p.evaluate(id => { const w = window.webmix, i = w.inputs.find(x => x.id === id); i.list.shuffle = false; w.state.previewId = w.inputs[0].id; w.state.programId = id; i.list.index = i.list.items.length - 1; w.playlist.next(i); }, id);
  await p.waitForTimeout(1800);
  ok('end of list cuts back to Preview', await p.evaluate(id => window.webmix.state.programId !== id, id));
  ok('no page errors', errs.length === 0, JSON.stringify(errs));
  console.log(results.join('\n')); await b.close();
})().catch(e => { console.log(results.join('\n')); console.error('CRASH', e.message); process.exit(1); });
