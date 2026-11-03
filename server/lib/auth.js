// ตรวจ token, IP จริงหลัง proxy, กันเดารหัส (บล็อก IP)
const monitor = require('../monitor');
const users = require('../users');
const { TRUST_PROXY } = require('./config');

/* ==========================================================================
   ผู้ใช้, โควตา และการกันเดารหัส
   ========================================================================== */
// IP ของผู้ใช้จริง — หลัง reverse proxy ใช้ค่าขวาสุดของ X-Forwarded-For (ค่าที่ proxy ของเราใส่เอง ปลอมไม่ได้)
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',').pop().trim();
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
// ใส่ token ผิดเกิน 10 ครั้งใน 5 นาที → บล็อก IP นั้น 15 นาที
const failures = new Map();
const FAIL_LIMIT = 10, FAIL_WINDOW = 5 * 60 * 1000, BLOCK_MS = 15 * 60 * 1000;
function isBlocked(ip) {
  const f = failures.get(ip);
  return !!(f && f.blockedUntil > Date.now());
}
function authFailed(ip) {
  monitor.counters.authFailures++;
  const now = Date.now();
  let f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW) { f = { first: now, count: 0, blockedUntil: 0 }; failures.set(ip, f); }
  if (++f.count >= FAIL_LIMIT && !f.blockedUntil) {
    f.blockedUntil = now + BLOCK_MS;
    monitor.notify(`block:${ip}`, `บล็อก IP ${ip} 15 นาที — ใส่ token ผิด ${f.count} ครั้ง (อาจมีคนพยายามเดารหัส)`);
  }
}
setInterval(() => { const now = Date.now(); for (const [ip, f] of failures) if (now - f.first > FAIL_WINDOW && f.blockedUntil < now) failures.delete(ip); }, 60000).unref();

function authorize(req, token) {
  const ip = clientIp(req);
  if (isBlocked(ip)) return { error: 'too many attempts' };
  const user = users.authenticate(token);
  if (!user) { authFailed(ip); return { error: 'invalid token' }; }
  return { user, ip };
}

module.exports = { authorize };
