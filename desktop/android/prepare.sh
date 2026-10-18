#!/usr/bin/env bash
# เตรียมโปรเจกต์ Android ของแอป (desktop/src-tauri/gen/android ที่ `tauri android init` สร้าง) ก่อน build
#
#   desktop/android/prepare.sh FFMPEG_DIR
#     FFMPEG_DIR/arm64-v8a/ffmpeg, FFMPEG_DIR/x86_64/ffmpeg  จาก build-ffmpeg.sh
#
# - ใส่ ffmpeg เป็น jniLibs/<abi>/libffmpeg.so: Android ให้แอปรันโปรแกรมได้เฉพาะไฟล์ในโฟลเดอร์ native library
#   และต้องให้ระบบแตกไฟล์ออกมาตอนติดตั้ง (useLegacyPackaging / extractNativeLibs)
# - สิทธิ์กล้อง ไมค์ และบันทึกไฟล์ลง Movies
set -euo pipefail
FF=$(cd "${1:?FFMPEG_DIR}" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$HERE/../src-tauri/gen/android/app
[ -d "$APP" ] || { echo "ไม่พบ $APP — รัน tauri android init ก่อน" >&2; exit 1; }

for abi in arm64-v8a x86_64; do
  if [ -f "$FF/$abi/ffmpeg" ]; then
    mkdir -p "$APP/src/main/jniLibs/$abi"
    cp "$FF/$abi/ffmpeg" "$APP/src/main/jniLibs/$abi/libffmpeg.so"
    chmod 755 "$APP/src/main/jniLibs/$abi/libffmpeg.so"
  fi
done

python3 - "$APP" <<'PY'
import re, sys, pathlib
app = pathlib.Path(sys.argv[1])

gradle = app / 'build.gradle.kts'
g = gradle.read_text()
if 'useLegacyPackaging' not in g:
    g = re.sub(r'(\nandroid\s*\{\n)', r'\1    packaging { jniLibs { useLegacyPackaging = true } }\n', g, count=1)
    assert 'useLegacyPackaging' in g, 'android { } block not found in build.gradle.kts'
gradle.write_text(g)

manifest = app / 'src/main/AndroidManifest.xml'
m = manifest.read_text()
perms = [
    'android.permission.INTERNET',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.WAKE_LOCK',
]
for p in perms:
    if f'"{p}"' not in m:
        m = m.replace('<application', f'<uses-permission android:name="{p}" />\n    <application', 1)
if 'WRITE_EXTERNAL_STORAGE' not in m:
    m = m.replace('<application', '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />\n    <application', 1)
for feat in ['android.hardware.camera', 'android.hardware.microphone']:
    if feat + '"' not in m:
        m = m.replace('<application', f'<uses-feature android:name="{feat}" android:required="false" />\n    <application', 1)
# Android 10: เขียน Movies/WebMix ตรง ๆ ได้ · แตก native library (ffmpeg) ออกมาตอนติดตั้ง
for attr in ['android:requestLegacyExternalStorage="true"', 'android:extractNativeLibs="true"']:
    if attr.split('=')[0] not in m:
        m = m.replace('<application', '<application ' + attr, 1)
manifest.write_text(m)
print(m)
PY
