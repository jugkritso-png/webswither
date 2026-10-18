// ผู้ใช้ของ Stream Gateway — แต่ละคนมี token ของตัวเองและโควตาของตัวเอง
//
// ไฟล์ผู้ใช้ (USERS_FILE, ค่าเริ่มต้น ./data/users.json) เก็บเฉพาะค่า hash ของ token ไม่เก็บ token จริง
// แก้ไฟล์หรือใช้คำสั่งด้านล่างได้ระหว่างที่ Gateway ทำงาน — Gateway อ่านไฟล์ใหม่ให้เอง
//
//   node stream-gateway.js user add <ชื่อ> [--streams 1] [--destinations 6] [--srt 2]   สร้างผู้ใช้ (แสดง token ครั้งเดียว)
//   node stream-gateway.js user list                                                  รายชื่อและโควตา
//   node stream-gateway.js user token <ชื่อ>                                          ออก token ใหม่ (token เดิมใช้ไม่ได้ทันที)
//   node stream-gateway.js user limit <ชื่อ> [--streams n] [--destinations n] [--srt n]
//   node stream-gateway.js user disable|enable <ชื่อ>
//   node stream-gateway.js user remove <ชื่อ>
//
// STREAM_TOKEN (ถ้าตั้งไว้) คือผู้ดูแลระบบ: ไม่จำกัดโควตาต่อผู้ใช้ และเปิดหน้า /admin ได้
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'data', 'users.json');
const ADMIN_TOKEN = process.env.STREAM_TOKEN || '';
const DEFAULT_LIMITS = { streams: 1, destinations: 6, srt: 2 };
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function sameSecret(a, b) {
  const x = Buffer.from(sha256(a)), y = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(x, y);
}

let cache = { mtime: -1, users: [] };
function load() {
  let st;
  try { st = fs.statSync(USERS_FILE); } catch (e) { cache = { mtime: 0, users: [] }; return cache.users; }
  if (st.mtimeMs === cache.mtime) return cache.users;
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    cache = { mtime: st.mtimeMs, users: Array.isArray(data.users) ? data.users.filter(u => u && NAME_RE.test(u.name) && /^[0-9a-f]{64}$/.test(u.tokenHash)) : [] };
  } catch (e) {
    console.error(`อ่านไฟล์ผู้ใช้ ${USERS_FILE} ไม่ได้: ${e.message} — ใช้รายชื่อเดิมไปก่อน`);
    cache.mtime = st.mtimeMs;
  }
  return cache.users;
}
function save(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}

const limitsOf = u => ({
  streams: Number.isInteger(u.limits?.streams) ? u.limits.streams : DEFAULT_LIMITS.streams,
  destinations: Number.isInteger(u.limits?.destinations) ? u.limits.destinations : DEFAULT_LIMITS.destinations,
  srt: Number.isInteger(u.limits?.srt) ? u.limits.srt : DEFAULT_LIMITS.srt
});

// ตรวจ token → { name, admin, limits } หรือ null
// ถ้าไม่ได้ตั้งทั้ง STREAM_TOKEN และไฟล์ผู้ใช้ ถือว่าเปิดให้ใช้โดยไม่ต้องมี token (เหมาะกับเครื่องในวงแลนเท่านั้น)
function authenticate(token) {
  token = String(token || '');
  const users = load();
  if (!ADMIN_TOKEN && !users.length) return { name: 'open', admin: true, limits: null };
  if (!token) return null;
  if (ADMIN_TOKEN && sameSecret(token, ADMIN_TOKEN)) return { name: 'admin', admin: true, limits: null };
  const hash = sha256(token);
  const u = users.find(x => crypto.timingSafeEqual(Buffer.from(x.tokenHash), Buffer.from(hash)));
  if (!u || u.disabled) return null;
  return { name: u.name, admin: false, limits: limitsOf(u) };
}
const authRequired = () => !!ADMIN_TOKEN || load().length > 0;

/* ------------------------------------------------------------- CLI */
function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const m = /^--(streams|destinations|srt)$/.exec(args[i]);
    if (m) {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`--${m[1]} ต้องเป็นจำนวนเต็ม 0–100`);
      out[m[1]] = n;
    }
  }
  return out;
}

function cli(args) {
  const [cmd, name, ...rest] = args;
  const users = load().map(u => ({ ...u }));
  const find = () => {
    const u = users.find(x => x.name === name);
    if (!u) throw new Error(`ไม่พบผู้ใช้ "${name}"`);
    return u;
  };
  const newToken = () => crypto.randomBytes(24).toString('base64url');
  const showToken = (u, token) => {
    console.log(`\nผู้ใช้: ${u.name}\nToken: ${token}`);
    console.log('\nให้ผู้ใช้ใส่ Gateway URL ในหน้าตั้งค่าของ WebMix เป็น');
    console.log(`  wss://<โดเมน>/?token=${token}`);
    console.log('\n(token นี้แสดงครั้งเดียว — ถ้าหาย ให้ออกใหม่ด้วย: user token ' + u.name + ')\n');
  };
  switch (cmd) {
    case 'add': {
      if (!NAME_RE.test(name || '')) throw new Error('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - (ไม่เกิน 32 ตัว)');
      if (users.some(x => x.name === name)) throw new Error(`มีผู้ใช้ "${name}" อยู่แล้ว`);
      const token = newToken();
      const u = { name, tokenHash: sha256(token), limits: { ...DEFAULT_LIMITS, ...parseFlags(rest) }, created: new Date().toISOString() };
      users.push(u);
      save(users);
      showToken(u, token);
      break;
    }
    case 'token': {
      const u = find();
      const token = newToken();
      u.tokenHash = sha256(token);
      save(users);
      showToken(u, token);
      break;
    }
    case 'limit': {
      const u = find();
      u.limits = { ...limitsOf(u), ...parseFlags(rest) };
      save(users);
      console.log(`${u.name}: ${JSON.stringify(u.limits)}`);
      break;
    }
    case 'disable': case 'enable': {
      const u = find();
      u.disabled = cmd === 'disable';
      save(users);
      console.log(`${u.name}: ${u.disabled ? 'ปิดการใช้งานแล้ว' : 'เปิดการใช้งานแล้ว'}`);
      break;
    }
    case 'remove': {
      find();
      save(users.filter(x => x.name !== name));
      console.log(`ลบผู้ใช้ ${name} แล้ว`);
      break;
    }
    case 'list': case undefined: {
      if (!users.length) { console.log(`ยังไม่มีผู้ใช้ (${USERS_FILE}) — สร้างด้วย: user add <ชื่อ>`); break; }
      console.log('ชื่อ'.padEnd(20) + 'สตรีม  ปลายทาง  SRT  สถานะ');
      for (const u of users) {
        const l = limitsOf(u);
        console.log(u.name.padEnd(20) + String(l.streams).padEnd(7) + String(l.destinations).padEnd(9) + String(l.srt).padEnd(5) + (u.disabled ? 'ปิด' : 'ใช้งาน'));
      }
      break;
    }
    default:
      throw new Error('คำสั่ง: user add|list|token|limit|disable|enable|remove');
  }
}

module.exports = { authenticate, authRequired, cli, USERS_FILE, DEFAULT_LIMITS };
