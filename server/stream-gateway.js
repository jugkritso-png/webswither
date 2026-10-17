// WebMix Stream Gateway
// รับวิดีโอ (WebM/MP4 จาก MediaRecorder) ผ่าน WebSocket แล้วใช้ FFmpeg แปลงเป็น RTMP ส่งต่อไปยังแพลตฟอร์มไลฟ์
//
// ใช้งาน:  cd server && npm install && npm start
// ตัวแปรแวดล้อม:
//   PORT          พอร์ตที่ให้บริการ (ค่าเริ่มต้น 8080)
//   STREAM_TOKEN  ถ้าตั้งไว้ ไคลเอนต์ต้องส่ง ?token=... มาด้วย (แนะนำให้ตั้งเสมอเมื่อเปิดให้เข้าถึงจากอินเทอร์เน็ต)
//   FFMPEG_PATH   path ของ ffmpeg (ค่าเริ่มต้น "ffmpeg")

const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
const TOKEN = process.env.STREAM_TOKEN || '';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const rtmp = params.get('rtmp') || '';

  if (TOKEN && params.get('token') !== TOKEN) return ws.close(1008, 'invalid token');
  if (!/^rtmps?:\/\/[^\s]+$/i.test(rtmp)) return ws.close(1008, 'invalid rtmp url');

  // ค่าที่ส่งมาจากหน้าตั้งค่า (มีค่าเริ่มต้นและจำกัดช่วงไว้เสมอ)
  const fps = [24, 25, 30, 50, 60].includes(Number(params.get('fps'))) ? Number(params.get('fps')) : 30;
  const kbps = Math.min(12000, Math.max(500, Number(params.get('vb')) || 4500));

  const ffmpeg = spawn(FFMPEG, [
    '-loglevel', 'warning',
    '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2),
    '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
    '-c:a', 'aac', '-ar', '44100', '-b:a', '128k',
    '-f', 'flv', rtmp
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  const tag = `[${req.socket.remoteAddress}]`;
  console.log(`${tag} start → ${rtmp.replace(/[^/]+$/, '***')}`);

  ffmpeg.stderr.on('data', d => process.stderr.write(`${tag} ffmpeg: ${d}`));
  ffmpeg.stdin.on('error', () => {});
  ffmpeg.on('error', err => ws.close(1011, 'ffmpeg not available: ' + err.message));
  ffmpeg.on('close', code => {
    console.log(`${tag} ffmpeg exited (${code})`);
    if (ws.readyState === ws.OPEN) ws.close(1011, `ffmpeg exited (${code})`);
  });

  ws.on('message', data => { if (ffmpeg.stdin.writable) ffmpeg.stdin.write(data); });
  ws.on('close', () => { ffmpeg.stdin.end(); setTimeout(() => ffmpeg.kill('SIGINT'), 5000).unref(); });
});

console.log(`WebMix Stream Gateway listening on ws://0.0.0.0:${PORT}${TOKEN ? ' (token required)' : ''}`);
