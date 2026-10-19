#!/usr/bin/env bash
# ทดสอบแอป Android บน emulator: ติดตั้ง APK → เปิดแอปในโหมดทดสอบตัวเอง → แอปสตรีมภาพทดสอบผ่าน Gateway ในแอป
# (ffmpeg ของแอป) มาที่เครื่องรับ RTMP บนเครื่อง CI → ตรวจว่าได้วิดีโอ H.264 + เสียง AAC จริง
#
#   desktop/android/emulator-test.sh APP.apk OUTDIR
set -euo pipefail
APK=${1:?APK}
OUT=$(mkdir -p "${2:?OUTDIR}" && cd "$2" && pwd)
FFMPEG=${3:-}   # ffmpeg สำหรับ Android (x86_64) — ถ้าให้มา จะทดสอบ DNS + RTMPS ไป Facebook จริงด้วย
PKG=io.github.jugkritsopng.webmix
PORT=1935

adb wait-for-device
adb install -r -g "$APK"

# เครื่องรับ RTMP บนเครื่อง CI — emulator มองเห็นเครื่อง CI ที่ 10.0.2.2
ffmpeg -hide_banner -loglevel error -listen 1 -i "rtmp://0.0.0.0:$PORT/live/selftest" -c copy -y "$OUT/android-stream.flv" &
RECV=$!
sleep 1

adb shell setprop debug.webmix.selftest "rtmp://10.0.2.2:$PORT/live/selftest"
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null

# รายงานยาวถูกแบ่งเป็นหลายบรรทัดใน logcat (บรรทัดละ ≤3000 ไบต์) — ต่อกันจนได้ JSON ที่สมบูรณ์
REPORT=""
for _ in $(seq 1 180); do
  RAW=$(adb logcat -d -v raw -s WebMix:I | awk '/^WEBMIX_SELFTEST /{f=1} f' | tr -d '\n' || true)
  if [ -n "$RAW" ] && node -e 'JSON.parse(process.argv[1].replace(/^WEBMIX_SELFTEST /, ""))' "$RAW" 2>/dev/null; then
    REPORT=$RAW; break
  fi
  sleep 1
done
adb logcat -d -v brief | grep -E 'WebMix|chromium|AndroidRuntime|DEBUG' | tail -200 > "$OUT/logcat.txt" || true
adb shell screencap -p /sdcard/screen.png && adb pull /sdcard/screen.png "$OUT/android-screen.png" >/dev/null || true
adb shell setprop debug.webmix.selftest 0

sleep 3
kill "$RECV" 2>/dev/null || true
wait "$RECV" 2>/dev/null || true

if [ -z "$REPORT" ]; then
  echo "แอปไม่ส่งผลทดสอบภายใน 180 วินาที"; tail -60 "$OUT/logcat.txt"; exit 1
fi
echo "${REPORT#WEBMIX_SELFTEST }" > "$OUT/android-selftest.json"
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(r.ua || "");
  for (const c of r.checks || []) console.log(`${c.ok ? "✓" : c.required ? "✗" : "·"} ${c.name.padEnd(16)} ${c.detail}`);
  if (r.error) console.log("error:", r.error);
  process.exit(r.ok ? 0 : 1);
' "$OUT/android-selftest.json"

# emulator มี MediaCodec ที่ใช้ได้ — แอปต้องเลือกตัวเข้ารหัสฮาร์ดแวร์ ไม่ใช่ถอยไปใช้ libx264
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const c = (r.checks || []).find(c => c.name === "encoder");
  if (!c || !/^h264_mediacodec/.test(c.detail)) { console.log("ไม่ได้ใช้ตัวเข้ารหัสฮาร์ดแวร์:", c && c.detail); process.exit(1); }
' "$OUT/android-selftest.json"

# ปลายทางต้องได้สตรีมที่ถอดรหัสได้จริง
PROBE=$(ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration -of compact=p=0 "$OUT/android-stream.flv" || true)
echo "RTMP ที่ได้รับ: $PROBE"
echo "$PROBE" | grep -q 'codec_name=h264|width=1280|height=720' || { echo "ไม่ได้วิดีโอ H.264 720p"; exit 1; }
echo "$PROBE" | grep -q 'codec_name=aac' || { echo "ไม่ได้เสียง AAC"; exit 1; }
FRAMES=$(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$OUT/android-stream.flv")
echo "ถอดรหัสได้ $FRAMES เฟรม"
[ "${FRAMES:-0}" -ge 150 ] || { echo "สตรีมที่ได้สั้นหรือถอดรหัสไม่ได้"; exit 1; }
echo "Android: สตรีมผ่าน Gateway ในแอปสำเร็จ"

# ---- ไลฟ์เบื้องหลัง: ระหว่างสตรีม กดปุ่มโฮมแล้วปิดจอ — สตรีมต้องไม่หยุดและภาพต้องไม่ค้าง (LiveService) ----
BG_PORT=1936
adb shell am force-stop "$PKG"
# ถ้ามีการเชื่อมต่อที่จับมือ RTMP ไม่สำเร็จเข้ามาก่อน (RTMP Handshake C2 Error) ffmpeg จะออก — เปิดรอรับใหม่จนกว่าจะได้ข้อมูล
( while [ ! -s "$OUT/android-bg.flv" ]; do
    ffmpeg -hide_banner -loglevel error -listen 1 -i "rtmp://0.0.0.0:$BG_PORT/live/bg" -c copy -y "$OUT/android-bg.flv" || sleep 0.2
  done ) &
RECV=$!
sleep 1
adb shell setprop debug.webmix.selftest "rtmp://10.0.2.2:$BG_PORT/live/bg"
adb shell setprop debug.webmix.selftest_hold 45
adb logcat -c
adb shell input keyevent KEYCODE_WAKEUP
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
for _ in $(seq 1 150); do [ -s "$OUT/android-bg.flv" ] && break; sleep 1; done
[ -s "$OUT/android-bg.flv" ] || { echo "ไลฟ์เบื้องหลัง: สตรีมไม่เริ่ม"; adb logcat -d -s WebMix:* WebMixGateway:* | tail -40; exit 1; }
sleep 4
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell input keyevent KEYCODE_SLEEP
sleep 3
echo "--- บริการเบื้องหน้าระหว่างปิดจอ"
adb shell dumpsys activity services "$PKG" | grep -E "LiveService|isForeground|foregroundServiceType" | head -5 || true
sleep 22
adb shell input keyevent KEYCODE_WAKEUP
for _ in $(seq 1 60); do
  adb logcat -d -v raw -s WebMix:I | grep -q '^WEBMIX_SELFTEST ' && break
  sleep 1
done
adb shell setprop debug.webmix.selftest 0
adb shell setprop debug.webmix.selftest_hold 0
adb logcat -d -v brief | grep -E 'WebMix|LiveService|chromium|AndroidRuntime' | tail -300 > "$OUT/logcat-bg.txt" || true
adb logcat -d -v brief -s WebMix:* > "$OUT/logcat-bg-webmix.txt" || true
sleep 3
pkill -INT -f "live/bg" 2>/dev/null || true
wait "$RECV" 2>/dev/null || true
grep -q "LiveService started" "$OUT/logcat-bg-webmix.txt" || { echo "ไลฟ์เบื้องหลัง: LiveService ไม่เริ่ม"; grep -iE "LiveService|set_live|Exception" "$OUT/logcat-bg.txt" "$OUT/logcat-bg-webmix.txt" | tail -20; exit 1; }
BG_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/android-bg.flv")
ffprobe -v error -select_streams v -show_entries packet=pts_time -of csv=p=0 "$OUT/android-bg.flv" > "$OUT/android-bg-pts.txt"
node -e '
  const t = require("fs").readFileSync(process.argv[1], "utf8").split("\n").map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const dur = +process.argv[2];
  let gap = 0; for (let i = 1; i < t.length; i++) gap = Math.max(gap, t[i] - t[i - 1]);
  const fps = t.length / dur;
  console.log(`ไลฟ์เบื้องหลัง: ${dur.toFixed(1)} วินาที · ${t.length} เฟรม (${fps.toFixed(1)} fps) · ช่วงขาดนานสุด ${gap.toFixed(2)} วินาที`);
  if (dur < 35) { console.log("สตรีมหยุดก่อนเวลา (ปิดจอแล้วสตรีมหลุด)"); process.exit(1); }
  if (fps < 20 || gap > 1) { console.log("ภาพค้าง/เฟรมหายระหว่างปิดจอ"); process.exit(1); }
' "$OUT/android-bg-pts.txt" "$BG_DUR"

# RTMPS ไปเซิร์ฟเวอร์จริงของ Facebook ด้วย ffmpeg ตัวเดียวกับในแอป (คีย์ปลอม): ต้องผ่าน DNS และ TLS
# แล้วไปติดที่ Facebook ปฏิเสธคีย์ — ถ้าติดที่ DNS หรือ TLS แปลว่าการสตรีมไป Facebook/YouTube จากมือถือจะใช้ไม่ได้
if [ -n "$FFMPEG" ]; then
  FB=rtmps://live-api-s.facebook.com:443/rbtmp/webmix-ci-invalid-key
  # TLS ผ่านแล้ว = ไม่มีข้อผิดพลาดจากชั้น tls และเปิดการเชื่อมต่อ tls ได้ (หลังจากนั้นค่อยติดที่คีย์)
  tls_failed() { grep -qiE "resolve hostname|name or service|\[tls @[^]]*\] .*(error|returned|reset|fail|alert)|Cannot open connection tls" "$1"; }
  # เทียบกับ ffmpeg ของเครื่อง CI (OpenSSL/GnuTLS ของ Ubuntu) — ถ้าตัวนี้ก็ไม่ผ่าน แปลว่าเครือข่ายของ CI ไปไม่ถึง Facebook
  timeout 30 ffmpeg -hide_banner -loglevel verbose -re -f lavfi -i color=c=blue:s=640x360:r=30 -t 6 -c:v libx264 -preset ultrafast -g 60 -f flv "$FB" > "$OUT/rtmps-host.txt" 2>&1 || true
  adb push "$FFMPEG" /data/local/tmp/webmix-ffmpeg >/dev/null
  adb shell chmod 755 /data/local/tmp/webmix-ffmpeg
  # ตัวเข้ารหัสฮาร์ดแวร์ (MediaCodec) ของ emulator — แสดงผลไว้ดูสาเหตุ ไม่ทำให้การทดสอบล้ม
  for pf in nv12 yuv420p; do
    echo "--- h264_mediacodec ($pf)"
    adb shell /data/local/tmp/webmix-ffmpeg -hide_banner -loglevel info -f lavfi -i color=c=black:s=1280x720:r=30 -frames:v 30 \
      -c:v h264_mediacodec -ndk_codec 1 -pix_fmt $pf -b:v 2000k -g 60 -f null - 2>&1 | grep -viE "^ *(Stream|Metadata|encoder|Input|Output|Duration)" | tail -8 || true
  done
  adb shell /data/local/tmp/webmix-ffmpeg -hide_banner -loglevel verbose -re -f lavfi -i color=c=blue:s=640x360:r=30 -t 6 \
    -c:v libx264 -preset ultrafast -g 60 -f flv "$FB" > "$OUT/rtmps.txt" 2>&1 || true
  echo "--- ffmpeg ของเครื่อง CI"; grep -iE "tls|rtmp|resolve|error|connect" "$OUT/rtmps-host.txt" | grep -v "^ *Stream" | tail -8
  echo "--- ffmpeg ในแอป (Android)"; grep -iE "tls|rtmp|resolve|error|connect" "$OUT/rtmps.txt" | grep -v "^ *Stream" | tail -15
  if tls_failed "$OUT/rtmps.txt"; then
    if tls_failed "$OUT/rtmps-host.txt"; then echo "::warning::RTMPS: เครื่อง CI ก็ต่อ Facebook ไม่ได้ — ข้ามการตรวจนี้"; exit 0; fi
    echo "RTMPS: ffmpeg ในแอปต่อ Facebook ไม่สำเร็จ (DNS/TLS) ขณะที่ ffmpeg ของเครื่อง CI ต่อได้"; exit 1
  fi
  echo "RTMPS: ผ่าน DNS + TLS ไปถึงเซิร์ฟเวอร์ Facebook แล้ว (คีย์ปลอมถูกปฏิเสธตามคาด)"
fi
