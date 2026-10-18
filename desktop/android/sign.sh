#!/usr/bin/env bash
# เซ็น APK ที่ tauri android build สร้าง แล้วตั้งชื่อสำหรับแจก: WebMix-Pro_<เวอร์ชัน>_android-<abi>.apk
#
#   desktop/android/sign.sh OUTDIR
#
# กุญแจเซ็น: secrets ANDROID_KEYSTORE_BASE64 + ANDROID_KEYSTORE_PASSWORD (alias webmix)
# ถ้าไม่ได้ตั้ง จะสร้างกุญแจชั่วคราว — ติดตั้งได้ แต่อัปเดตทับเวอร์ชันเก่าไม่ได้ (ต้องถอนแอปเดิมก่อน)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(mkdir -p "${1:?OUTDIR}" && cd "$1" && pwd)
VERSION=$(node -p "require('$HERE/../src-tauri/tauri.conf.json').version")
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
KS=$RUNNER_TEMP/webmix.keystore

if [ -n "${KEYSTORE_B64:-}" ] && [ -n "${KEYSTORE_PASSWORD:-}" ]; then
  echo "$KEYSTORE_B64" | base64 -d > "$KS"
  PASS=$KEYSTORE_PASSWORD
else
  echo "::warning::ไม่ได้ตั้ง ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD — เซ็น APK ด้วยกุญแจชั่วคราว (อัปเดตทับเวอร์ชันก่อนไม่ได้)"
  PASS=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
  keytool -genkeypair -keystore "$KS" -storepass "$PASS" -keypass "$PASS" -alias webmix -keyalg RSA -keysize 3072 -validity 10000 \
    -dname "CN=WebMix Pro" >/dev/null 2>&1
fi

found=0
while IFS= read -r apk; do
  case "$apk" in *arm64*) abi=arm64 ;; *x86_64*) abi=x86_64 ;; *armeabi*|*arm-*) abi=armv7 ;; *x86*) abi=x86 ;; *) abi=universal ;; esac
  dest="$OUT/WebMix-Pro_${VERSION}_android-$abi.apk"
  # ffmpeg ต้องอยู่ใน APK และไม่ถูกบีบอัด/ตัด — ไม่งั้น Gateway ในแอปใช้ไม่ได้
  unzip -l "$apk" | grep -q 'lib/.*/libffmpeg.so' || { echo "ไม่พบ libffmpeg.so ใน $apk" >&2; exit 1; }
  "$BT/zipalign" -f -p 4 "$apk" "$dest.aligned"
  "$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$PASS" --ks-key-alias webmix --out "$dest" "$dest.aligned"
  rm -f "$dest.aligned" "$dest.idsig"
  "$BT/apksigner" verify "$dest"
  ls -la "$dest"
  found=$((found + 1))
done < <(find "$HERE/../src-tauri/gen/android/app/build/outputs/apk" -name '*-release*.apk')
[ "$found" -gt 0 ] || { echo "ไม่พบ APK" >&2; exit 1; }
