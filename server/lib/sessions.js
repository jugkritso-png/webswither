// การเชื่อมต่อที่ทำงานอยู่ (สตรีม / SRT ขาเข้า), โหมดพักรับงาน (drain), แจ้งเตือนสตรีมหลุด
const monitor = require('../monitor');
const users = require('../users');

// การเชื่อมต่อทั้งหมด (สตรีมและ SRT ขาเข้า) — ใช้ตรวจโควตาและแสดงในหน้าผู้ดูแล
const sessions = new Map();
const sessionList = () => [...sessions.values()].map(s => s.snapshot());
// โหมดพักรับงาน (drain): มีไฟล์ drain ข้างไฟล์ผู้ใช้ = ไม่รับสตรีม / SRT ใหม่ แต่ไลฟ์ที่ออกอากาศอยู่ไปต่อได้
// (รวมถึงไลฟ์ที่หลุดแล้วต่อกลับภายใน 2 นาที) — install.sh เปิดโหมดนี้ก่อนอัปเดต แล้วรอจนไม่มีใครไลฟ์ค่อยสลับ
// Gateway ที่เพิ่งเปิดลบไฟล์นี้เอง (เปิดใหม่ = อัปเดตเสร็จแล้ว)
const path = require('path'), fs = require('fs');
const DRAIN_FILE = path.join(path.dirname(users.USERS_FILE), 'drain');
try { fs.unlinkSync(DRAIN_FILE); } catch (e) {}
const draining = () => { try { return fs.existsSync(DRAIN_FILE); } catch (e) { return false; } };
const DRAIN_MSG = 'เซิร์ฟเวอร์กำลังอัปเดต — ยังไม่รับไลฟ์ใหม่ชั่วคราว ลองใหม่ในอีกไม่กี่นาที (ไลฟ์ที่ออกอากาศอยู่ไม่ถูกตัด)';
const recentlyLive = new Map();   // ชื่อผู้ใช้ → เวลาที่สตรีมล่าสุดจบ/หลุด (ให้ต่อกลับได้ระหว่าง drain)
const countFor = (kind, name, pred = () => true) => [...sessions.values()].filter(s => s.kind === kind && (name == null || s.user.name === name) && pred(s)).length;

// เมื่อสตรีมที่กำลังไลฟ์หลุดโดยไม่ได้กดหยุด และไม่กลับมาภายใน 30 วินาที → แจ้งเตือน
const dropTimers = new Map();
function streamDropped(name, ip) {
  clearTimeout(dropTimers.get(name));
  dropTimers.set(name, setTimeout(() => {
    dropTimers.delete(name);
    monitor.notify(`drop:${name}`, `สตรีมของ ${name} (${ip}) ขาดการเชื่อมต่อจาก WebMix และยังไม่กลับมา — ตรวจอินเทอร์เน็ตของเครื่องที่ไลฟ์`);
  }, 30000));
}
function streamBack(name) {
  if (dropTimers.has(name)) { clearTimeout(dropTimers.get(name)); dropTimers.delete(name); return true; }
  return false;
}

module.exports = { DRAIN_FILE, DRAIN_MSG, countFor, draining, recentlyLive, sessionList, sessions, streamBack, streamDropped };
