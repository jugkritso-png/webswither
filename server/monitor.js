// การเฝ้าระวังของ Stream Gateway: แจ้งเตือน, ข้อมูลของหน้าผู้ดูแล (/admin — หน้าเว็บอยู่ใน admin.html) และ metrics สำหรับ Prometheus (/metrics)
//
// แจ้งเตือน (ตั้งอย่างใดอย่างหนึ่งหรือทั้งสองแบบ):
//   ALERT_WEBHOOK       URL ของ Discord / Slack / Google Chat / webhook อื่น (ส่ง JSON { text, content })
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   ส่งเข้า Telegram
//   ALERT_NAME          ชื่อเซิร์ฟเวอร์ที่แสดงในข้อความ (ค่าเริ่มต้น: hostname)
//   ALERT_AFTER         แจ้งเมื่อปัญหาค้างนานกี่วินาที (ค่าเริ่มต้น 20) — กันแจ้งเตือนจากการสะดุดชั่วครู่
//   METRICS_TOKEN       token สำหรับ /metrics (ถ้าไม่ตั้ง ใช้ STREAM_TOKEN ของผู้ดูแล)
const os = require('os');

const NAME = process.env.ALERT_NAME || os.hostname();
const WEBHOOK = process.env.ALERT_WEBHOOK || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const ALERT_AFTER = (Number(process.env.ALERT_AFTER) || 20) * 1000;
const COOLDOWN = 5 * 60 * 1000;
const startedAt = Date.now();

const alertsEnabled = () => !!(WEBHOOK || (TG_TOKEN && TG_CHAT));
const recent = [];          // ประวัติแจ้งเตือนล่าสุด (แสดงในหน้า /admin)
const lastSent = new Map(); // key → เวลา (กันส่งซ้ำถี่เกินไป)
const counters = { authFailures: 0, alerts: 0, streamsStarted: 0, destinationErrors: 0 };

async function deliver(text) {
  const jobs = [];
  if (WEBHOOK) {
    jobs.push(fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }) }));
  }
  if (TG_TOKEN && TG_CHAT) {
    jobs.push(fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true })
    }));
  }
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'rejected') console.error('ส่งแจ้งเตือนไม่สำเร็จ:', r.reason?.message || r.reason);
    else if (!r.value.ok) console.error('ส่งแจ้งเตือนไม่สำเร็จ: HTTP', r.value.status);
  }
}

// level: alert (ปัญหา) | ok (กลับมาปกติ) | info
function notify(key, text, level = 'alert') {
  const now = Date.now();
  if (level === 'alert' && lastSent.has(key) && now - lastSent.get(key) < COOLDOWN) return;
  if (level === 'alert') lastSent.set(key, now);
  const icon = level === 'alert' ? '🔴' : level === 'ok' ? '🟢' : 'ℹ️';
  const line = `${icon} [${NAME}] ${text}`;
  console.log('ALERT', line);
  recent.unshift({ at: new Date(now).toISOString(), level, text });
  recent.length = Math.min(recent.length, 50);
  counters.alerts++;
  if (alertsEnabled()) deliver(line).catch(() => {});
}

// เฝ้าเงื่อนไขที่เป็นปัญหาต่อเนื่อง: แจ้งเมื่อเป็นนานเกิน after และแจ้งอีกครั้งเมื่อกลับมาปกติ
const watches = new Map();
function condition(key, bad, text, okText, after = ALERT_AFTER) {
  let w = watches.get(key);
  if (!w) { w = { since: 0, alerted: false }; watches.set(key, w); }
  const now = Date.now();
  if (bad) {
    if (!w.since) w.since = now;
    if (!w.alerted && now - w.since >= after) { w.alerted = true; w.text = typeof text === 'function' ? text() : text; notify(key, w.text); }
  } else {
    if (w.alerted && okText) notify(key, okText, 'ok');
    w.since = 0;
    w.alerted = false;
  }
}
// เหตุการณ์ทั่วไป (เริ่ม/หยุดไลฟ์ งานของผู้ดูแล) — แสดงในหน้า /admin เท่านั้น ไม่ส่งแจ้งเตือน
function log(text) {
  recent.unshift({ at: new Date().toISOString(), level: 'info', text });
  recent.length = Math.min(recent.length, 50);
}
// ปัญหาที่ยังค้างอยู่ตอนนี้ (แจ้งเตือนไปแล้วและยังไม่หาย)
const active = () => [...watches.entries()].filter(([, w]) => w.alerted).map(([key, w]) => ({ key: key.split(':')[0], text: w.text || '' }));
function forget(prefix) {
  for (const k of watches.keys()) if (k.startsWith(prefix)) watches.delete(k);
}

/* ---- ทรัพยากรของเครื่อง ---- */
let cpuPrev = os.cpus().map(c => c.times);
let cpuNow = 0;
function sampleCpu() {
  const cur = os.cpus().map(c => c.times);
  let idle = 0, total = 0;
  cur.forEach((t, i) => {
    const p = cpuPrev[i] || t;
    const d = k => t[k] - p[k];
    const tot = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
    idle += d('idle'); total += tot;
  });
  cpuPrev = cur;
  cpuNow = total > 0 ? 1 - idle / total : 0;
  return cpuNow;
}
function system() {
  return {
    cpu: +cpuNow.toFixed(3), cores: os.cpus().length, load: os.loadavg().map(v => +v.toFixed(2)),
    memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(), uptime: Math.round((Date.now() - startedAt) / 1000)
  };
}

/* ---- ตัวเฝ้าระวังหลัก (เรียกทุก 5 วินาทีจาก gateway) ---- */
function check(sessions) {
  sampleCpu();
  condition('cpu', cpuNow > 0.92, () => `CPU ของเซิร์ฟเวอร์สูง ${Math.round(cpuNow * 100)}% ต่อเนื่อง — ภาพที่สตรีมอาจกระตุก (ลดความละเอียด/บิตเรต หรือใช้ VIDEO_ENCODER การ์ดจอ)`,
    'CPU ของเซิร์ฟเวอร์กลับมาปกติ', 60000);
  const memFree = os.freemem() / os.totalmem();
  condition('mem', memFree < 0.05, () => `หน่วยความจำเหลือน้อย (${Math.round(memFree * 100)}%)`, 'หน่วยความจำกลับมาปกติ', 30000);
  for (const s of sessions) {
    if (s.kind === 'stream') {
      const who = s.user;
      const sp = s.encoder?.speed;
      condition(`enc:${s.id}`, typeof sp === 'number' && sp > 0 && sp < 0.9,
        () => `เข้ารหัสไม่ทันเวลาจริง (${sp}x) ในสตรีมของ ${who} — ผู้ชมจะเห็นภาพกระตุก ลดความละเอียด/บิตเรตใน WebMix หรือใช้เครื่องที่แรงขึ้น`,
        `การเข้ารหัสของ ${who} กลับมาทันเวลาจริงแล้ว`);
      for (const d of s.destinations) {
        // ผู้ใช้กดหยุดปลายทางเอง — ไม่ต้องแจ้ง "กลับมาออนไลน์"
        if (!d.wanted) { watches.delete(`dest:${s.id}:${d.id}`); continue; }
        condition(`dest:${s.id}:${d.id}`, d.wanted && d.failing,
          () => `ปลายทาง ${d.name} ของ ${who} หลุด: ${d.message || 'ไม่ทราบสาเหตุ'} (Gateway กำลังเชื่อมต่อใหม่อัตโนมัติ)`,
          `ปลายทาง ${d.name} ของ ${who} กลับมาออนไลน์แล้ว`);
      }
    } else if (s.kind === 'srt-in') {
      condition(`srt:${s.id}`, s.wasLive && s.state === 'error',
        () => `สัญญาณ SRT ขาเข้า ${s.label} ของ ${s.user} หายไป`, `สัญญาณ SRT ขาเข้า ${s.label} ของ ${s.user} กลับมาแล้ว`);
    }
  }
}

/* ---- Prometheus metrics ---- */
function metrics(sessions) {
  const sys = system();
  const streams = sessions.filter(s => s.kind === 'stream');
  const dests = streams.flatMap(s => s.destinations.filter(d => d.wanted || d.state !== 'stopped'));
  const by = st => dests.filter(d => d.state === st).length;
  const lines = [
    '# HELP webmix_up Gateway is running', '# TYPE webmix_up gauge', 'webmix_up 1',
    '# TYPE webmix_uptime_seconds gauge', `webmix_uptime_seconds ${sys.uptime}`,
    '# HELP webmix_streams Active stream sessions (encoders)', '# TYPE webmix_streams gauge', `webmix_streams ${streams.filter(s => s.encoding).length}`,
    '# HELP webmix_destinations Destinations by state', '# TYPE webmix_destinations gauge',
    ...['connecting', 'live', 'error'].map(st => `webmix_destinations{state="${st}"} ${by(st)}`),
    '# TYPE webmix_srt_inputs gauge', `webmix_srt_inputs ${sessions.filter(s => s.kind === 'srt-in').length}`,
    '# HELP webmix_encoder_speed Encoder speed (1 = real time)', '# TYPE webmix_encoder_speed gauge',
    ...streams.filter(s => s.encoder).map(s => `webmix_encoder_speed{user="${s.user}",session="${s.id}"} ${s.encoder.speed}`),
    '# TYPE webmix_cpu_ratio gauge', `webmix_cpu_ratio ${sys.cpu}`,
    '# TYPE webmix_memory_used_bytes gauge', `webmix_memory_used_bytes ${sys.memUsed}`,
    '# TYPE webmix_auth_failures_total counter', `webmix_auth_failures_total ${counters.authFailures}`,
    '# TYPE webmix_alerts_total counter', `webmix_alerts_total ${counters.alerts}`,
    '# TYPE webmix_streams_started_total counter', `webmix_streams_started_total ${counters.streamsStarted}`,
    '# TYPE webmix_destination_errors_total counter', `webmix_destination_errors_total ${counters.destinationErrors}`
  ];
  return lines.join('\n') + '\n';
}

function status(sessions) {
  return { server: NAME, alerts: alertsEnabled(), system: system(), sessions, recent, problems: active() };
}

module.exports = { notify, log, condition, forget, check, metrics, status, counters, alertsEnabled };
