// หน้าผู้ดูแล (/admin): ข้อมูลสถานะและคำสั่งจัดการผู้ใช้ / ไลฟ์ / drain
const fs = require('fs');
const monitor = require('../monitor');
const path = require('path');
const users = require('../users');
const { MAX_STREAMS } = require('./config');
const { DRAIN_FILE, draining, sessionList, sessions } = require('./sessions');

/* ---- หน้าผู้ดูแล (/admin) ---- */
const ADMIN_HTML = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
// UPLINK_MBPS: ความเร็วอัปโหลดของเซิร์ฟเวอร์ (Mbps) — ใช้แสดงว่าเน็ตขาออกเหลือเท่าไร · STUDIO_URL: หน้า WebMix ในลิงก์เชิญ
const UPLINK_MBPS = Number(process.env.UPLINK_MBPS) || 0;
const STUDIO_URL = process.env.STUDIO_URL || 'https://jugkritso-png.github.io/webswither/';
function adminStatus(me) {
  return {
    ...monitor.status(sessionList()), draining: draining(), me: me.name, maxStreams: MAX_STREAMS, uplinkMbps: UPLINK_MBPS, studioUrl: STUDIO_URL,
    users: users.list(), plans: users.PLANS, defaults: users.DEFAULT_LIMITS
  };
}
function adminAction(route, msg, me) {
  const parts = route.split('/').map(decodeURIComponent);
  const by = me.admin ? '' : ` (โดย ${me.name})`;
  if (parts[0] === 'users' && parts.length === 1) {
    const r = users.create(msg.name, msg.limits, { manage: !!msg.manage });
    monitor.log(`เพิ่มผู้ใช้ ${r.user.name}${by}`);
    return r;
  }
  if (parts[0] === 'users' && parts.length === 3) {
    const [, name, op] = parts;
    if (op === 'token') { const r = users.rotate(name); monitor.log(`ทำรหัสใหม่ให้ ${name}${by}`); return r; }
    if (op === 'update') {
      if (name === me.name && (msg.disabled || msg.manage === false)) throw new Error('ปิดสิทธิ์ของตัวเองไม่ได้');
      const r = users.update(name, msg);
      monitor.log(msg.disabled === true ? `พักการใช้งาน ${name}${by}` : msg.disabled === false ? `เปิดใช้งาน ${name} อีกครั้ง${by}` : `แก้แพ็กเกจของ ${name}${by}`);
      return { user: r };
    }
    if (op === 'remove') {
      if (name === me.name) throw new Error('ลบตัวเองไม่ได้');
      users.remove(name); monitor.log(`ลบผู้ใช้ ${name}${by}`);
      return { ok: true };
    }
  }
  if (parts[0] === 'sessions' && parts[2] === 'stop' && parts.length === 3) {
    const sess = sessions.get(parts[1]);
    if (!sess) throw new Error('ไลฟ์นี้จบไปแล้ว');
    sess.stop();
    return { ok: true };
  }
  if (route === 'drain') {
    if (msg.on) fs.writeFileSync(DRAIN_FILE, '');
    else try { fs.unlinkSync(DRAIN_FILE); } catch (e) {}
    monitor.log(msg.on ? `พักรับไลฟ์ใหม่${by} — ไลฟ์ที่ออกอากาศอยู่ไปต่อได้` : `เปิดรับไลฟ์ใหม่อีกครั้ง${by}`);
    return { draining: draining() };
  }
  throw new Error('ไม่รู้จักคำสั่งนี้');
}

module.exports = { ADMIN_HTML, adminAction, adminStatus };
