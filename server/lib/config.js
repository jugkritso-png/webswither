// ค่าตั้งจากตัวแปรแวดล้อม (ดูรายการทั้งหมดที่หัวไฟล์ stream-gateway.js)

const PORT = Number(process.env.PORT) || 8080;
const MAX_STREAMS = Number(process.env.MAX_STREAMS) || 0;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_DESTINATIONS = Number(process.env.MAX_DESTINATIONS) || 6;
const VIDEO_ENCODER = process.env.VIDEO_ENCODER || 'libx264';
const X264_PRESET = process.env.X264_PRESET || '';
const MAX_KBPS = 51000; // เพดานของ YouTube สำหรับ 4K60

module.exports = { FFMPEG, MAX_DESTINATIONS, MAX_KBPS, MAX_STREAMS, PORT, TRUST_PROXY, VIDEO_ENCODER, X264_PRESET };
