// กล้องมือถือ: PeerJS ของเราเอง + ค่า ICE / TURN แบบรหัสชั่วคราว
const crypto = require('crypto');

/* ==========================================================================
   กล้องมือถือ: PeerJS ของเราเอง + TURN (coturn)
   - PeerServer (สัญญาณ WebRTC) ที่ PEER_PORT — ผ่าน Caddy ที่ https://โดเมน/peerjs
   - /ice?token=…  ให้ค่า ICE (STUN/TURN) แบบรหัสชั่วคราว (HMAC ตามมาตรฐาน TURN REST API)
     มือถือที่ใช้ 4G/5G หรือ Wi-Fi ที่ปิดกั้น WebRTC จะส่งภาพผ่าน TURN ได้
   ========================================================================== */
const PEER_PORT = Number(process.env.PEER_PORT) || 0;
const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_HOST = process.env.TURN_HOST || '';
const TURN_PORT = Number(process.env.TURN_PORT) || 3478;
const ICE_TTL = 7 * 24 * 3600; // ลิงก์/QR กล้องมือถือใช้ TURN ได้ 7 วัน (เปิดหน้าต่าง QR ใหม่เพื่อต่ออายุ)
if (PEER_PORT) {
  const { PeerServer } = require('peer');
  PeerServer({ port: PEER_PORT, host: process.env.PEER_HOST || '0.0.0.0', path: '/peerjs', proxied: true, allow_discovery: false });
}

function iceConfig(req) {
  const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/:\d+$/, '');
  const host = TURN_HOST || reqHost;
  const iceServers = [];
  let expires = 0;
  if (TURN_SECRET && host) {
    expires = Math.floor(Date.now() / 1000) + ICE_TTL;
    const username = `${expires}:webmix`;
    const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
    iceServers.push({ urls: `stun:${host}:${TURN_PORT}` });
    iceServers.push({ urls: [`turn:${host}:${TURN_PORT}?transport=udp`, `turn:${host}:${TURN_PORT}?transport=tcp`], username, credential });
  }
  iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
  const https = req.headers['x-forwarded-proto'] === 'https';
  const peer = !PEER_PORT ? null : https
    ? { host: reqHost, port: 443, path: '/peerjs', secure: true }
    : { host: reqHost, port: PEER_PORT, path: '/peerjs', secure: false };
  const turn = TURN_SECRET && host ? { host, port: TURN_PORT, username: iceServers[1].username, credential: iceServers[1].credential } : null;
  return { iceServers, peer, turn, expires };
}

module.exports = { PEER_PORT, TURN_SECRET, iceConfig };
