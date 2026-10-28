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

python3 - "$APP" "$HERE/LiveService.kt" <<'PY'
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
    # ไลฟ์เบื้องหลัง (LiveService)
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_CAMERA',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.ACCESS_WIFI_STATE',
]
for p in perms:
    if f'"{p}"' not in m:
        m = m.replace('<application', f'<uses-permission android:name="{p}" />\n    <application', 1)
if 'WRITE_EXTERNAL_STORAGE' not in m:
    m = m.replace('<application', '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />\n    <application', 1)
for feat in ['android.hardware.camera', 'android.hardware.microphone']:
    if feat + '"' not in m:
        m = m.replace('<application', f'<uses-feature android:name="{feat}" android:required="false" />\n    <application', 1)
# หน้าเว็บในแอปต่อ Gateway ในเครื่องผ่าน ws://127.0.0.1 — Android บล็อกการเชื่อมต่อแบบไม่เข้ารหัสเป็นค่าเริ่มต้น
# จึงอนุญาตเฉพาะ localhost (การสตรีมออกอินเทอร์เน็ตทำโดย ffmpeg ไม่ผ่าน WebView)
xml = app / 'src/main/res/xml'
xml.mkdir(parents=True, exist_ok=True)
(xml / 'network_security_config.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="true">tauri.localhost</domain>
    </domain-config>
</network-security-config>
''')
m = re.sub(r'\s*android:usesCleartextTraffic="[^"]*"', '', m)
if 'networkSecurityConfig' not in m:
    m = m.replace('<application', '<application android:networkSecurityConfig="@xml/network_security_config"', 1)
# Android 10: เขียน Movies/WebMix ตรง ๆ ได้ · แตก native library (ffmpeg) ออกมาตอนติดตั้ง
for attr in ['android:requestLegacyExternalStorage="true"', 'android:extractNativeLibs="true"']:
    if attr.split('=')[0] not in m:
        m = m.replace('<application', '<application ' + attr, 1)
# บริการเบื้องหน้าระหว่างไลฟ์/บันทึก
if 'LiveService' not in m:
    m = m.replace('</application>', '    <service android:name=".LiveService" android:exported="false"\n'
                  '            android:foregroundServiceType="camera|microphone|mediaPlayback" />\n    </application>', 1)
manifest.write_text(m)
print(m)

# R8 (release) ลบ/เปลี่ยนชื่อเมธอดที่เรียกจาก Rust ผ่าน JNI เท่านั้น — เก็บ LiveService ไว้ทั้งคลาส
rules = app / 'proguard-rules.pro'
r = rules.read_text() if rules.exists() else ''
if 'LiveService' not in r:
    rules.write_text(r.rstrip() + '\n\n# WebMix: LiveService.start/stop ถูกเรียกผ่าน JNI\n-keep class **.LiveService { *; }\n')

# LiveService.kt ไว้ข้าง MainActivity.kt (package เดียวกัน) และให้ MainActivity ไม่หยุด WebView ระหว่างไลฟ์
main = next((app / 'src/main/java').rglob('MainActivity.kt'))
src = main.read_text()
pkg = re.search(r'^package\s+([\w.`]+)', src, re.M).group(1)
(main.parent / 'LiveService.kt').write_text(pathlib.Path(sys.argv[2]).read_text().replace('__PACKAGE__', pkg))
if 'ACTION_STOP' not in src:
    if not re.search(r'class MainActivity\s*:\s*TauriActivity\(\)\s*\{', src):
        src = re.sub(r'(class MainActivity\s*:\s*TauriActivity\(\))', r'\1 {\n}', src, count=1)
    body = (
        '\n'
        '  // WryActivity หยุด WebView ตอน onPause (ปิดจอ/สลับแอป) — ระหว่างไลฟ์เปิดกลับทันที ให้หน้าเว็บสตรีมต่อได้\n'
        '  private var liveWebView: android.webkit.WebView? = null\n'
        '\n'
        '  override fun onWebViewCreate(webView: android.webkit.WebView) {\n'
        '    super.onWebViewCreate(webView)\n'
        '    liveWebView = webView\n'
        '    // Android 15 ขึ้นไปบังคับให้แอปวาดเต็มจอ (edge-to-edge) — หน้าเว็บจะโดนแถบสถานะ/รอยบากกล้อง/แถบนำทางบัง\n'
        '    // เว้นขอบตามแถบระบบ (และแป้นพิมพ์ตอนพิมพ์) ให้เหมือนหน้าเว็บ · พื้นหลังสีเดียวกับแอป · ไอคอนแถบสถานะสีขาว\n'
        '    val root = window.decorView.findViewById<android.view.View>(android.R.id.content)\n'
        '    root.setBackgroundColor(android.graphics.Color.parseColor("#090B0F"))\n'
        '    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->\n'
        '      val t = androidx.core.view.WindowInsetsCompat.Type.systemBars() or\n'
        '        androidx.core.view.WindowInsetsCompat.Type.displayCutout() or androidx.core.view.WindowInsetsCompat.Type.ime()\n'
        '      val b = insets.getInsets(t)\n'
        '      v.setPadding(b.left, b.top, b.right, b.bottom)\n'
        '      androidx.core.view.WindowInsetsCompat.CONSUMED\n'
        '    }\n'
        '    androidx.core.view.WindowCompat.getInsetsController(window, root).apply {\n'
        '      isAppearanceLightStatusBars = false\n'
        '      isAppearanceLightNavigationBars = false\n'
        '    }\n'
        '    root.requestApplyInsets()\n'
        '    // ตัวเรนเดอร์ของ WebView ปกติลดความสำคัญลงเมื่อมองไม่เห็น (ปิดจอ/สลับแอป) แล้วอาจถูกชะลอหรือถูกปิด\n'
        '    // ให้คงความสำคัญไว้ตลอด — ระหว่างไม่ได้ไลฟ์ WryActivity ยังหยุด WebView ตามปกติ\n'
        '    if (android.os.Build.VERSION.SDK_INT >= 26) {\n'
        '      webView.setRendererPriorityPolicy(android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT, false)\n'
        '    }\n'
        '  }\n'
        '\n'
        '  private fun keepLive() {\n'
        '    if (!LiveService.running) return\n'
        '    liveWebView?.onResume()\n'
        '    liveWebView?.resumeTimers()\n'
        '  }\n'
        '\n'
        '  override fun onPause() {\n'
        '    super.onPause()\n'
        '    keepLive()\n'
        '  }\n'
        '\n'
        '  override fun onStop() {\n'
        '    super.onStop()\n'
        '    keepLive()\n'
        '  }\n'
        '\n'
        '  // ปุ่ม "หยุดไลฟ์…" บนแจ้งเตือน → เปิดหน้ายืนยันในหน้าเว็บ\n'
        '  override fun onNewIntent(intent: android.content.Intent) {\n'
        '    super.onNewIntent(intent)\n'
        '    if (intent.action == LiveService.ACTION_STOP) {\n'
        '      liveWebView?.evaluateJavascript("window.WebMix && WebMix.nativeAction && WebMix.nativeAction(\'stop\')", null)\n'
        '    }\n'
        '  }\n'
        '}\n'
    )
    i = src.rstrip().rfind('}')
    src = src[:i].rstrip() + '\n' + body
    main.write_text(src)
print(main.read_text())
PY
