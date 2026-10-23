/* WebMix — คอมเมนต์ผู้ชม: ดึงแชตสดจาก YouTube / Twitch และวาดการ์ดคอมเมนต์บนจอ */
(function (WM) {
  'use strict';
  const { FONT, fitFont, easeOut } = WM;

  const PLATFORMS = {
    youtube: { label: 'YouTube', color: '#ff0033' },
    twitch: { label: 'Twitch', color: '#9146ff' },
    manual: { label: 'ผู้ชม', color: '#3b82f6' }
  };
  const CHAT_STYLES = { lower: 'การ์ดล่างซ้าย', center: 'คำถามเด่นกลางจอ', top: 'แถบบนจอ' };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // รับลิงก์ YouTube ได้หลายแบบ: watch?v= · youtu.be/ · /live/ · /shorts/ หรือรหัสวิดีโอ 11 ตัว
  function youtubeId(s) {
    s = String(s || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = /(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(s);
    return m ? m[1] : '';
  }

  // YouTube Data API v3 ด้วย API key ของผู้ใช้เอง — หาแชตของไลฟ์ แล้วดึงข้อความใหม่ตามรอบที่ YouTube กำหนด (อย่างน้อย 5 วินาที เพื่อประหยัดโควตา)
  function connectYouTube({ video, key }, on) {
    const id = youtubeId(video);
    let stopped = false;
    const api = (path, q) => fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...q, key })}`).then(async r => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const reason = body.error?.errors?.[0]?.reason || '';
        const e = new Error(/quota/i.test(reason) ? 'โควตา YouTube API ของวันนี้หมดแล้ว (เริ่มใหม่หลังเที่ยงคืนเวลาแปซิฟิก)'
          : /keyInvalid|badRequest|API_KEY|forbidden/i.test(reason + (body.error?.message || '')) && r.status !== 404 ? 'API key ไม่ถูกต้อง หรือยังไม่ได้เปิด YouTube Data API v3'
          : /liveChatEnded|liveChatNotFound/.test(reason) ? 'ไลฟ์จบแล้ว หรือปิดแชตอยู่' : `YouTube ตอบกลับ ${r.status}`);
        e.fatal = r.status === 400 || r.status === 403 || r.status === 404;
        throw e;
      }
      return body;
    });
    (async () => {
      if (!id) { on.status('error', 'ลิงก์ YouTube ไม่ถูกต้อง'); return; }
      if (!key) { on.status('error', 'ยังไม่ได้ใส่ API key'); return; }
      on.status('connecting', 'กำลังหาแชตของไลฟ์…');
      let chatId = '';
      for (let tries = 0; !stopped && !chatId; tries++) {
        try {
          const v = await api('videos', { part: 'liveStreamingDetails,snippet', id });
          if (!v.items?.length) { on.status('error', 'ไม่พบวิดีโอนี้ (ตรวจลิงก์ หรือวิดีโอเป็นส่วนตัว)'); return; }
          chatId = v.items[0].liveStreamingDetails?.activeLiveChatId || '';
          if (!chatId) { on.status('connecting', 'ไลฟ์ยังไม่เริ่ม หรือปิดแชตอยู่ — จะลองใหม่ทุก 30 วินาที'); await sleep(30000); }
        } catch (e) { on.status('error', e.message); if (e.fatal) return; await sleep(15000); }
      }
      let page = '', first = true;
      while (!stopped) {
        let wait = 6000;
        try {
          const r = await api('liveChat/messages', { liveChatId: chatId, part: 'snippet,authorDetails', maxResults: 200, ...(page ? { pageToken: page } : {}) });
          if (stopped) return;
          page = r.nextPageToken || page;
          wait = Math.max(5000, +r.pollingIntervalMillis || 0);
          const items = (r.items || []).filter(it => it.snippet?.displayMessage || it.snippet?.superChatDetails);
          // รอบแรกเอาเฉพาะ 20 ข้อความล่าสุด ไม่ท่วมรายการ
          for (const it of first ? items.slice(-20) : items) {
            const a = it.authorDetails || {}, sn = it.snippet || {};
            on.message({ id: 'yt-' + it.id, platform: 'youtube', name: a.displayName || 'ผู้ชม', text: sn.displayMessage || sn.superChatDetails?.userComment || '',
              amount: sn.superChatDetails?.amountDisplayString || '', role: a.isChatOwner ? 'owner' : a.isChatModerator ? 'mod' : a.isChatSponsor ? 'member' : '',
              at: Date.parse(sn.publishedAt) || Date.now() });
          }
          first = false;
          on.status('live', 'เชื่อมต่อแล้ว');
        } catch (e) {
          on.status('error', e.message);
          if (e.fatal) return;
          wait = 15000;
        }
        await sleep(wait);
      }
    })();
    return { stop() { stopped = true; } };
  }

  // Twitch: อ่านแชตแบบไม่ต้องล็อกอิน (ผู้ใช้นิรนาม justinfan) ผ่าน IRC WebSocket — ไม่ต้องมี key
  function connectTwitch(channel, on) {
    const ch = String(channel || '').trim().replace(/^.*twitch\.tv\//i, '').replace(/[^\w]/g, '').toLowerCase();
    let ws = null, stopped = false, retry = 0, timer = 0;
    const open = () => {
      if (stopped) return;
      on.status('connecting', 'กำลังเชื่อมต่อ…');
      try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch (e) { on.status('error', e.message); return; }
      ws.onopen = () => {
        ws.send('CAP REQ :twitch.tv/tags');
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
        ws.send(`JOIN #${ch}`);
      };
      ws.onmessage = e => {
        for (const line of String(e.data).split('\r\n')) {
          if (!line) continue;
          if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue; }
          if (/ 366 /.test(line) || / JOIN #/.test(line)) { retry = 0; on.status('live', 'เชื่อมต่อแล้ว'); continue; }
          const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/.exec(line);
          if (!m) continue;
          const tags = Object.fromEntries((m[1] || '').split(';').map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1).replace(/\\s/g, ' ')]; }));
          const badges = tags.badges || '';
          on.message({ id: 'tw-' + (tags.id || Math.random().toString(36).slice(2)), platform: 'twitch', name: tags['display-name'] || m[2], text: m[3].replace(/^\u0001ACTION (.*)\u0001$/, '$1'),
            amount: tags.bits ? `${tags.bits} bits` : '', role: /broadcaster/.test(badges) ? 'owner' : /moderator/.test(badges) ? 'mod' : /subscriber/.test(badges) ? 'member' : '', at: +tags['tmi-sent-ts'] || Date.now() });
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        on.status('connecting', 'การเชื่อมต่อหลุด — กำลังต่อใหม่…');
        timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
      };
    };
    if (!ch) on.status('error', 'ยังไม่ได้ใส่ชื่อช่อง Twitch');
    else open();
    return { stop() { stopped = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) {} } };
  }

  // ตัดบรรทัดตามคำ — ภาษาไทยไม่มีช่องว่าง จึงใช้ Intl.Segmenter แยกคำ (ถ้ามี)
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  function wrapLines(ctx, text, maxW, maxLines) {
    const parts = seg ? Array.from(seg.segment(text), s => s.segment) : text.split(/(\s+)/);
    const lines = [];
    let cur = '';
    for (const p of parts) {
      if (ctx.measureText(cur + p).width <= maxW || !cur) { cur += p; continue; }
      lines.push(cur.trim());
      cur = p.trimStart();
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
    else if (lines.length === maxLines && cur.trim()) {
      let last = lines[maxLines - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    // คำเดียวที่ยาวเกินบรรทัด: ตัดเป็นตัวอักษร
    return lines.map(l => { let x = l; while (x.length > 1 && ctx.measureText(x).width > maxW) x = x.slice(0, -2) + '…'; return x; });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // a: 0 → 1 ตอนขึ้นจอ (และ 1 → 0 ตอนลง) · msg: { name, text, platform, amount, role }
  function drawChat(ctx, w, h, msg, style, a) {
    if (!msg || a <= 0) return;
    const s = h / 720, e = easeOut(Math.min(1, a));
    const P = PLATFORMS[msg.platform] || PLATFORMS.manual;
    const center = style === 'center', top = style === 'top';
    const pad = 22 * s, av = (center ? 64 : 52) * s;
    const nameSize = (center ? 28 : 24) * s, textSize = (center ? 42 : 33) * s, lineH = textSize * 1.35;
    const maxW = (center ? 0.72 : top ? 0.9 : 0.6) * w;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `500 ${textSize}px ${FONT}`;
    const lines = wrapLines(ctx, msg.text || '', maxW - av - pad * 3, top ? 1 : center ? 4 : 3);
    const textW = Math.max(...lines.map(l => ctx.measureText(l).width), 0);
    ctx.font = `700 ${nameSize}px ${FONT}`;
    const nameW = ctx.measureText(msg.name || '').width + (msg.amount ? ctx.measureText(msg.amount).width + 40 * s : 0) + 90 * s;
    const boxW = Math.min(maxW, Math.max(textW, nameW) + av + pad * 3);
    const boxH = top ? Math.max(av, nameSize + lineH) + pad * 1.2 : pad * 2 + nameSize * 1.5 + lines.length * lineH;
    const x = center ? (w - boxW) / 2 : top ? (w - boxW) / 2 : w * 0.05;
    const y = center ? (h - boxH) / 2 : top ? h * 0.05 : h * 0.9 - boxH;
    // เลื่อนเข้าจากซ้าย (การ์ดล่าง) หรือขยายจากกลาง
    ctx.globalAlpha = Math.min(1, a * 1.5);
    if (center) { ctx.translate(w / 2, h / 2); ctx.scale(0.92 + 0.08 * e, 0.92 + 0.08 * e); ctx.translate(-w / 2, -h / 2); }
    else if (top) ctx.translate(0, -(1 - e) * (boxH + y));
    else ctx.translate(-(1 - e) * (boxW + x), 0);
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24 * s; ctx.shadowOffsetY = 6 * s;
    roundRect(ctx, x, y, boxW, boxH, 14 * s);
    ctx.fillStyle = 'rgba(12,15,22,.92)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save(); ctx.clip();
    ctx.fillStyle = msg.amount ? '#f5a524' : P.color;
    ctx.fillRect(x, y, 6 * s, boxH);
    ctx.restore();
    // วงกลมตัวอักษรแรกของชื่อ (ไม่โหลดรูปโปรไฟล์จากภายนอก — รูปข้ามโดเมนทำให้ภาพส่งออกใช้ไม่ได้)
    const cx = x + pad + av / 2 + 4 * s, cy = top ? y + boxH / 2 : y + pad + av / 2;
    ctx.fillStyle = P.color;
    ctx.beginPath(); ctx.arc(cx, cy, av / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = `800 ${av * 0.46}px ${FONT}`;
    ctx.fillText(Array.from((msg.name || '?').trim())[0]?.toUpperCase() || '?', cx, cy + 1 * s);
    ctx.textAlign = 'left';
    const tx = x + pad * 2 + av;
    const ny = top ? y + boxH / 2 - lineH / 2 : y + pad + nameSize * 0.6;
    ctx.font = `700 ${nameSize}px ${FONT}`;
    ctx.fillStyle = msg.role === 'owner' ? '#fde68a' : msg.role === 'mod' ? '#93c5fd' : '#c9cfdb';
    fitFont(ctx, msg.name || '', 700, nameSize, FONT, boxW - av - pad * 3 - 120 * s);
    ctx.fillText(msg.name || '', tx, ny);
    let bx = tx + ctx.measureText(msg.name || '').width + 12 * s;
    ctx.font = `600 ${nameSize * 0.62}px ${FONT}`;
    const tag = msg.amount || P.label, tw = ctx.measureText(tag).width + 14 * s;
    ctx.fillStyle = msg.amount ? '#f5a524' : P.color;
    roundRect(ctx, bx, ny - nameSize * 0.42, tw, nameSize * 0.84, 5 * s); ctx.fill();
    ctx.fillStyle = msg.amount ? '#1a1305' : '#fff';
    ctx.fillText(tag, bx + 7 * s, ny + 1 * s);
    ctx.fillStyle = '#fff';
    ctx.font = `500 ${textSize}px ${FONT}`;
    lines.forEach((l, i) => ctx.fillText(l, tx, (top ? ny + lineH : y + pad + nameSize * 1.5 + lineH / 2) + i * lineH));
    ctx.restore();
  }

  WM.chat = { PLATFORMS, CHAT_STYLES, youtubeId, connectYouTube, connectTwitch, drawChat, wrapLines };
})(window.WebMix);
