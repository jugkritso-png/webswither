#!/usr/bin/env bash
# ทดสอบแอป Android บน emulator: ติดตั้ง APK → เปิดแอปในโหมดทดสอบตัวเอง → แอปสตรีมภาพทดสอบผ่าน Gateway ในแอป
# (ffmpeg ของแอป) มาที่เครื่องรับ RTMP บนเครื่อง CI → ตรวจว่าได้วิดีโอ H.264 + เสียง AAC จริง
#
#   desktop/android/emulator-test.sh APP.apk OUTDIR
set -euo pipefail
APK=${1:?APK}
OUT=$(mkdir -p "${2:?OUTDIR}" && cd "$2" && pwd)
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

# ปลายทางต้องได้สตรีมที่ถอดรหัสได้จริง
PROBE=$(ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration -of compact=p=0 "$OUT/android-stream.flv" || true)
echo "RTMP ที่ได้รับ: $PROBE"
echo "$PROBE" | grep -q 'codec_name=h264|width=1280|height=720' || { echo "ไม่ได้วิดีโอ H.264 720p"; exit 1; }
echo "$PROBE" | grep -q 'codec_name=aac' || { echo "ไม่ได้เสียง AAC"; exit 1; }
FRAMES=$(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$OUT/android-stream.flv")
echo "ถอดรหัสได้ $FRAMES เฟรม"
[ "${FRAMES:-0}" -ge 150 ] || { echo "สตรีมที่ได้สั้นหรือถอดรหัสไม่ได้"; exit 1; }
echo "Android: สตรีมผ่าน Gateway ในแอปสำเร็จ"
