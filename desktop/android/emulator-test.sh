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
  echo "แอปไม่ส่งผลทดสอบภายใน 180 วินาที"; grep -vE "glBindAttrib|s_gl|Non-monotonic|backward in time" "$OUT/logcat.txt" | tail -60; exit 1
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
BG_PORT=$PORT  # พอร์ตเดียวกับรอบแรก (เครื่องรับรอบแรกปิดไปแล้ว)
adb shell am force-stop "$PKG"
# เครื่องรับเปิดรอรับใหม่ทุกครั้งที่การเชื่อมต่อจบ (ไฟล์ละการเชื่อมต่อ android-bg-N.flv): แอปต่อใหม่เองได้เมื่อหลุดสั้น ๆ
# จึงต้องรับการเชื่อมต่อถัดไปด้วย ไม่อย่างนั้นสตรีมที่ต่อกลับมาแล้วจะหายไปจากผลทดสอบ · จบเมื่อมีไฟล์ bg-stop
# (การเชื่อมต่อที่จับมือ RTMP ไม่สำเร็จ ไม่ได้ข้อมูล = ไม่นับ)
rm -f "$OUT"/android-bg-*.flv "$OUT/android-bg-ends.txt" "$OUT/bg-stop"
( end=$((SECONDS + 420)); n=0
  while [ ! -e "$OUT/bg-stop" ] && [ $SECONDS -lt $end ]; do
    f="$OUT/android-bg-$n.flv"
    timeout 400 ffmpeg -nostdin -hide_banner -loglevel error -listen 1 -i "rtmp://0.0.0.0:$BG_PORT/live/bg" -c copy -y "$f" || true
    if [ -s "$f" ]; then echo "$n $(date +%s.%N)" >> "$OUT/android-bg-ends.txt"; n=$((n + 1)); else sleep 0.2; fi
  done ) &
RECV=$!
# จบสคริปต์ทางไหนก็ตาม ปิดเครื่องรับด้วย (ไม่ให้ขั้นตอนของ CI ค้าง)
trap 'rc=$?; pkill -f "0.0.0.0:[0-9]*/live/bg" 2>/dev/null || true; kill $RECV 2>/dev/null || true; exit $rc' EXIT
sleep 1
adb shell setprop debug.webmix.selftest "rtmp://10.0.2.2:$BG_PORT/live/bg#hold=45"
# เปิดแอปแล้วรอให้สตรีมมาถึง — ถ้าไม่มาภายใน 100 วินาที (emulator บางรอบตัวเข้ารหัสค้างหลัง force-stop) ปิดแล้วเปิดใหม่อีกครั้ง
for attempt in 1 2; do
  adb logcat -c
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
  for _ in $(seq 1 100); do [ -s "$OUT/android-bg-0.flv" ] && break; sleep 1; done
  [ -s "$OUT/android-bg-0.flv" ] && break
  echo "ไลฟ์เบื้องหลัง: สตรีมยังไม่มา (ครั้งที่ $attempt)"
  adb logcat -d -s WebMix:* WebMixGateway:* | grep -vE "glBindAttrib|s_gl|Non-monotonic|backward in time" | tail -25
  adb shell am force-stop "$PKG"
  sleep 3
done
[ -s "$OUT/android-bg-0.flv" ] || { echo "ไลฟ์เบื้องหลัง: สตรีมไม่เริ่ม"; exit 1; }
# กดโฮมหลังจากบริการเบื้องหน้าเริ่มแล้วเท่านั้น (Android ไม่ให้เริ่มบริการกล้อง/ไมค์จากเบื้องหลัง)
for _ in $(seq 1 20); do adb logcat -d -s WebMix:I | grep -q "LiveService started" && break; sleep 1; done
adb logcat -d -s WebMix:I | grep -q "LiveService started" || { echo "ไลฟ์เบื้องหลัง: LiveService ไม่เริ่มภายใน 20 วินาที"; adb logcat -d -s WebMix:* | tail -20; exit 1; }
sleep 2
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
adb logcat -d -v time > "$OUT/logcat-bg-all.txt" || true
grep -E 'WebMix|LiveService|chromium|AndroidRuntime' "$OUT/logcat-bg-all.txt" | tail -300 > "$OUT/logcat-bg.txt" || true
adb logcat -d -v brief -s WebMix:* > "$OUT/logcat-bg-webmix.txt" || true
adb logcat -d -v time -s WebMixGateway:* > "$OUT/logcat-bg-gateway.txt" || true
sleep 3
touch "$OUT/bg-stop"
pkill -INT -f "0.0.0.0:[0-9]*/live/bg" 2>/dev/null || true
wait "$RECV" 2>/dev/null || true
grep -q "LiveService started" "$OUT/logcat-bg-webmix.txt" || { echo "ไลฟ์เบื้องหลัง: LiveService ไม่เริ่ม"; grep -iE "LiveService|set_live|Exception" "$OUT/logcat-bg.txt" "$OUT/logcat-bg-webmix.txt" | tail -20; exit 1; }
# แต่ละการเชื่อมต่อ: ความยาว + เวลาของทุกเฟรม → รวมความยาว · ช่วงขาดในสตรีม · ช่วงขาดตอนต่อใหม่ (เวลาจริง)
: > "$OUT/android-bg-segs.txt"
while read -r n t_end; do
  f="$OUT/android-bg-$n.flv"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" || echo 0)
  ffprobe -v error -select_streams v -show_entries packet=pts_time -of csv=p=0 "$f" > "$OUT/android-bg-$n-pts.txt" || true
  echo "$n $t_end ${d:-0}" >> "$OUT/android-bg-segs.txt"
done < "$OUT/android-bg-ends.txt"
node -e '
  const fs = require("fs"), dir = process.argv[1];
  const segs = fs.readFileSync(dir + "/android-bg-segs.txt", "utf8").trim().split("\n").filter(Boolean).map(l => { const [n, end, dur] = l.split(" ").map(Number); return { n, end, dur }; });
  let total = 0, frames = 0, gap = 0, reGap = 0;
  segs.forEach((s, i) => {
    const t = fs.readFileSync(`${dir}/android-bg-${s.n}-pts.txt`, "utf8").split("\n").map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    for (let k = 1; k < t.length; k++) gap = Math.max(gap, t[k] - t[k - 1]);
    total += s.dur; frames += t.length;
    if (i) reGap = Math.max(reGap, (s.end - s.dur) - segs[i - 1].end);
  });
  const fps = total ? frames / total : 0, re = Math.max(0, segs.length - 1);
  console.log(`ไลฟ์เบื้องหลัง: ${total.toFixed(1)} วินาที · ${frames} เฟรม (${fps.toFixed(1)} fps) · ช่วงขาดนานสุด ${gap.toFixed(2)} วินาที · ต่อใหม่ ${re} ครั้ง${re ? ` (ขาดไป ${reGap.toFixed(1)} วินาที)` : ""}`);
  if (re) { console.log(`::warning::ไลฟ์เบื้องหลัง: การเชื่อมต่อ RTMP หลุดแล้วต่อใหม่ ${re} ครั้ง ระหว่างกดโฮม/ปิดจอ`); fs.writeFileSync(dir + "/bg-reconnected", String(re)); }
  if (total < 35) { console.log("สตรีมหยุดก่อนเวลา (ปิดจอแล้วสตรีมหลุด และไม่ต่อกลับมา)"); process.exit(1); }
  if (re > 1 || reGap > 8) { console.log("สตรีมหลุดหลายครั้ง หรือต่อกลับช้าเกิน 8 วินาที"); process.exit(1); }
  if (fps < 20 || gap > 1) { console.log("ภาพค้าง/เฟรมหายระหว่างปิดจอ"); process.exit(1); }
' "$OUT" || {
  # ไม่ผ่าน: พิมพ์สิ่งที่ต้องใช้หาสาเหตุลง log ของงานเลย (ไฟล์ artifact ดาวน์โหลดไม่ได้ทุกที่)
  # (set -e ปิดในส่วนนี้ — grep ที่ไม่เจออะไรต้องไม่ตัดการพิมพ์ส่วนที่เหลือทิ้ง)
  set +e
  echo "--- ผลทดสอบในแอป (สตรีม + เหตุการณ์ระหว่างค้าง)"
  adb logcat -d -v raw -s WebMix:I | awk '/^WEBMIX_SELFTEST /{f=1} f' | tr -d '\n' | grep -o '"stream"[^}]*}' | head -c 4000; echo
  echo "--- Gateway ในแอป (ตัวเข้ารหัส / ปลายทาง)"
  grep -E "encoder|✕|✓|→|restart|libx264|exited" "$OUT/logcat-bg-gateway.txt" | tail -30
  echo "--- logcat ของแอป (WebMix)"
  grep -vE "glBindAttrib|s_gl|Non-monotonic|backward in time" "$OUT/logcat-bg-webmix.txt" | tail -40
  echo "--- logcat ที่เกี่ยวข้อง"
  grep -iE "webmix|gateway|ffmpeg|LiveService|ActivityManager.*(kill|died|Process)|lowmemory|chromium.*(crash|renderer|gone)|freez|cached app" "$OUT/logcat-bg-all.txt" | grep -vE "glBindAttrib|s_gl|Non-monotonic|backward in time" | tail -80
  exit 1
}
# หลุดแล้วต่อใหม่แต่ยังผ่าน: แสดงว่าฝั่งไหนหลุด (ตัวเข้ารหัสล่ม = Gateway เริ่มใหม่เอง · ปลายทางหลุด = ลองใหม่หลัง 1 วินาที)
if [ -s "$OUT/bg-reconnected" ]; then
  echo "--- Gateway ในแอประหว่างหลุด"
  grep -E "encoder|✕|✓|→|restart|libx264|exited" "$OUT/logcat-bg-gateway.txt" | tail -30
fi

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
