// ตัวช่วยร่วมของชุดทดสอบ WebMix
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORK = process.env.WORK || path.join(__dirname, '.work');

// รับสัญญาณ RTMP หนึ่งครั้งแล้วบันทึกเป็นไฟล์ (จำลองปลายทางอย่าง YouTube)
function listenRtmp(port, key, file) {
  return spawn('ffmpeg', ['-loglevel', 'error', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live/${key}`, '-c', 'copy', '-y', file], { stdio: 'ignore' });
}

// สรุปสตรีมในไฟล์ (codec, ความกว้าง) — คืนค่าว่างถ้าไฟล์ไม่มี/อ่านไม่ได้
function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width', '-of', 'compact=p=0', file], { encoding: 'utf8' });
  return (r.stdout || '').trim().replace(/\n/g, ' ');
}

const fixture = name => path.join(WORK, name);
const out = name => path.join(WORK, name);

module.exports = { ROOT, WORK, listenRtmp, probe, fixture, out };
