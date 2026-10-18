// การเฝ้าระวังของ Stream Gateway: แจ้งเตือน, หน้าสถานะผู้ดูแล (/admin) และ metrics สำหรับ Prometheus (/metrics)
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
    if (!w.alerted && now - w.since >= after) { w.alerted = true; notify(key, typeof text === 'function' ? text() : text); }
  } else {
    if (w.alerted && okText) notify(key, okText, 'ok');
    w.since = 0;
    w.alerted = false;
  }
}
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
  return { server: NAME, alerts: alertsEnabled(), system: system(), sessions, recent };
}

/* ---- หน้าสถานะผู้ดูแล ---- */
const ADMIN_HTML = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebMix Gateway</title><meta name="referrer" content="no-referrer"><style>
:root{color-scheme:dark;--bg:#0b0d12;--panel:#151922;--line:#262c38;--text:#e7eaf0;--muted:#8b94a7;--red:#f87171;--green:#4ade80;--amber:#f5a524}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,"IBM Plex Sans Thai",sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 12px}h2{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:20px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.k{color:var(--muted);font-size:12px}.v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
td,th{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
.live{color:var(--green)}.error{color:var(--red)}.connecting,.waiting{color:var(--amber)}.muted{color:var(--muted)}.wrap{overflow-x:auto}
</style></head><body><h1>WebMix Stream Gateway <span id="name" class="muted"></span></h1>
<div class="grid" id="sys"></div><h2>สตรีมและสัญญาณขาเข้า</h2><div class="wrap"><table><thead><tr><th>ผู้ใช้</th><th>ประเภท</th><th>รายละเอียด</th><th>เริ่มเมื่อ</th></tr></thead><tbody id="sessions"></tbody></table></div>
<h2>แจ้งเตือนล่าสุด <span id="alerts" class="muted"></span></h2><div class="wrap"><table><tbody id="recent"></tbody></table></div>
<script>
const q=new URLSearchParams(location.search);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gb=b=>(b/1073741824).toFixed(1)+' GB';const t=s=>new Date(s).toLocaleTimeString('th-TH',{hour12:false});
async function load(){try{const r=await fetch('/admin/status.json?token='+encodeURIComponent(q.get('token')||''),{cache:'no-store'});if(!r.ok){document.body.innerHTML='<h1>ต้องใช้ token ของผู้ดูแล</h1>';return}
const d=await r.json();document.getElementById('name').textContent='· '+d.server;const s=d.system;
document.getElementById('sys').innerHTML=[['CPU',Math.round(s.cpu*100)+'%'],['Load',s.load.join(' / ')],['หน่วยความจำ',gb(s.memUsed)+' / '+gb(s.memTotal)],['สตรีม',d.sessions.filter(x=>x.kind==='stream'&&x.encoding).length],['SRT ขาเข้า',d.sessions.filter(x=>x.kind==='srt-in').length],['ทำงานมา',Math.floor(s.uptime/3600)+' ชม. '+Math.floor(s.uptime%3600/60)+' นาที']].map(([k,v])=>'<div class="card"><div class="k">'+k+'</div><div class="v">'+esc(v)+'</div></div>').join('');
document.getElementById('sessions').innerHTML=d.sessions.map(x=>'<tr><td>'+esc(x.user)+'<div class="muted">'+esc(x.ip)+'</div></td><td>'+(x.kind==='stream'?'สตรีม':'SRT ขาเข้า')+'</td><td>'+(x.kind==='stream'?(x.encoder?'<div class="muted">'+esc(x.format)+' · speed '+esc(x.encoder.speed)+'x</div>':'<div class="muted">'+esc(x.format)+'</div>')+x.destinations.map(p=>'<div><span class="'+esc(p.state)+'">●</span> '+esc(p.name)+' <span class="muted">'+esc(p.state)+(p.kbps?' · '+p.kbps+' kbps':'')+(p.message?' · '+esc(p.message):'')+'</span></div>').join(''):'<span class="'+esc(x.state)+'">●</span> '+esc(x.label)+' <span class="muted">'+esc(x.state)+(x.info?' · '+esc(x.info.codec)+' '+esc(x.info.width)+'×'+esc(x.info.height):'')+'</span>')+'</td><td>'+t(x.startedAt)+'</td></tr>').join('')||'<tr><td colspan="4" class="muted">ไม่มี</td></tr>';
document.getElementById('alerts').textContent=d.alerts?'':'(ยังไม่ได้ตั้งช่องทางแจ้งเตือน — ALERT_WEBHOOK หรือ TELEGRAM_BOT_TOKEN)';
document.getElementById('recent').innerHTML=d.recent.map(a=>'<tr><td class="muted" style="white-space:nowrap">'+t(a.at)+'</td><td class="'+(a.level==='alert'?'error':a.level==='ok'?'live':'')+'">'+esc(a.text)+'</td></tr>').join('')||'<tr><td class="muted">ไม่มี</td></tr>'}catch(e){}}
load();setInterval(load,3000);
</script></body></html>`;

module.exports = { notify, condition, forget, check, metrics, status, counters, alertsEnabled, ADMIN_HTML };
