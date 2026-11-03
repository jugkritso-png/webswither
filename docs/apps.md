# แอปเดสก์ท็อป, Android และเว็บ

วิธีติดตั้งและเปิดใช้ WebMix Pro แต่ละแบบ — กลับไปที่ [README](../README.md)

## แอปเดสก์ท็อป (Windows / macOS / Linux)

แอป WebMix Pro สำหรับคอมพิวเตอร์ สร้างด้วย **Rust + [Tauri](https://tauri.app)** ใช้หน้าตาและความสามารถเดียวกับหน้าเว็บทุกอย่าง และเพิ่มสิ่งที่เบราว์เซอร์ทำเองไม่ได้:

- **Stream Gateway ในตัว** (เขียนใหม่ด้วย Rust) — สตรีมไป YouTube / Facebook / Twitch / SRT จากเครื่องนี้ได้ทันที ไม่ต้องเช่าเซิร์ฟเวอร์
  (การตั้งค่า → การสตรีม → “ใช้ Stream Gateway ในแอปนี้” ติ๊กไว้เป็นค่าเริ่มต้น) — ภายในเครื่องเท่านั้น (127.0.0.1) และใช้รหัสสุ่มใหม่ทุกครั้งที่เปิดแอป
- **บันทึกวิดีโอลงโฟลเดอร์โดยตรง** ทุกระบบปฏิบัติการ (ค่าเริ่มต้น `วิดีโอ/WebMix` เปลี่ยนได้ด้วยหน้าต่างเลือกโฟลเดอร์ของระบบ) ไฟล์ WebM เลื่อนหาตำแหน่งได้เหมือนเดิม
- หน้าต่าง Program Output และ Multiview เป็นหน้าต่างจริงของแอป ย้ายไปจอที่สอง/โปรเจกเตอร์ได้

**ดาวน์โหลด:** หน้า **[Releases](https://github.com/jugkritso-png/webswither/releases/latest)** —
Windows (.msi / -setup.exe) · macOS (.dmg) · Linux (.deb / .rpm / .AppImage) ดาวน์โหลดได้โดยไม่ต้องล็อกอิน
(รุ่นทดลองจากทุก commit อยู่ใน **Actions → Desktop app → Artifacts** ต้องล็อกอิน GitHub และหมดอายุใน 30 วัน)

**ออกเวอร์ชันใหม่:** แก้ `version` ใน `desktop/src-tauri/tauri.conf.json` (และ `desktop/Cargo.toml`) แล้ว push tag ที่ตรงกัน
เช่น `git tag v1.0.1 && git push origin v1.0.1` — หรือกด **Actions → Desktop app → Run workflow** แล้วติ๊ก *release*
workflow จะ build ทุกระบบ ทดสอบ แล้วสร้าง Release (และ tag) ให้อัตโนมัติ

**ต้องติดตั้ง ffmpeg** (ตัวเข้ารหัสวิดีโอสำหรับการสตรีม — การบันทึกไม่ต้องใช้):

| ระบบ | คำสั่ง |
|---|---|
| Windows | `winget install ffmpeg` |
| macOS | `brew install ffmpeg` |
| Ubuntu / Debian | ติดตั้งให้อัตโนมัติพร้อมไฟล์ .deb (`ffmpeg` และปลั๊กอิน GStreamer) |

แอปหา ffmpeg จาก PATH และตำแหน่งที่ติดตั้งบ่อย (Homebrew, WinGet, `C:\ffmpeg\bin`) หรือกำหนดเองด้วยตัวแปร `WEBMIX_FFMPEG`
ใช้การ์ดจอเข้ารหัสได้ด้วย `WEBMIX_VIDEO_ENCODER` (`h264_nvenc`, `h264_qsv`, `h264_videotoolbox`, `h264_amf`)

ข้อจำกัดที่ควรรู้:

- **macOS:** ตัวติดตั้งยังไม่ได้ลงนาม (unsigned) — ครั้งแรกให้คลิกขวาที่แอป → Open แล้วกด Open อีกครั้ง
- **Linux:** MediaRecorder ของ WebKitGTK สร้างไฟล์ MP4 ที่เสีย แอปจึงเข้ารหัสด้วย WebCodecs และเขียนไฟล์ WebM เอง
  (`assets/js/wcrec.js` — ต้องมี WebKitGTK 2.44 ขึ้นไป) บันทึกและสตรีมได้ตามปกติ · WebKitGTK ไม่มี WebRTC
  จึง**ใช้กล้องมือถือไร้สายและแขกรับเชิญไม่ได้** — ถ้าต้องใช้ ให้เปิดหน้าเว็บใน Chrome แทน
- Gateway ในแอปยังไม่รับสัญญาณ SRT เป็น Input และไม่มี TURN สำหรับมือถือเน็ต 4G/5G — ใช้ Gateway บนเซิร์ฟเวอร์ (ช่องด้านล่างในการตั้งค่าเดียวกัน)
- ลิงก์/QR ของกล้องมือถือและแขกรับเชิญจากแอปชี้ไปที่หน้าเว็บ GitHub Pages ของโปรเจกต์ (มือถือเปิดหน้าภายในแอปไม่ได้)
- การสตรีมจากแอปใช้อินเทอร์เน็ตขาขึ้นของเครื่องนี้ = บิตเรต × จำนวนปลายทาง

### Android (มี Gateway และ ffmpeg ในตัว)

ไฟล์ `WebMix-Pro_<เวอร์ชัน>_android-arm64.apk` ในหน้า Releases — ติดตั้งบนมือถือ/แท็บเล็ต Android 7 ขึ้นไป
(เปิด “อนุญาตให้ติดตั้งแอปจากแหล่งนี้” ให้เบราว์เซอร์หรือแอปไฟล์ที่ใช้เปิด APK)

- **สตรีมจากมือถือได้เลยโดยไม่ต้องมีเซิร์ฟเวอร์** — ffmpeg (x264 + RTMPS + SRT) ฝังมาในแอป
  และใช้ตัวเข้ารหัสฮาร์ดแวร์ของเครื่อง (MediaCodec) อัตโนมัติ ถ้าใช้ไม่ได้จะใช้ x264 แทน
- บันทึกลง `Movies/WebMix` ของเครื่อง (เห็นในแกลเลอรี/ตัวจัดการไฟล์) · จอไม่ดับระหว่างเปิดแอป
- ข้อจำกัด: ต้องเปิดแอปค้างไว้บนหน้าจอระหว่างไลฟ์ (สลับแอปหรือปิดจอแล้ว Android หยุดกล้องและสตรีม) ·
  ไม่มีหน้าต่าง Output/Multiview แยก · แนะนำ 720p–1080p และ Input ไม่เกิน 3–4 ช่อง (เครื่องร้อนได้ถ้าไลฟ์นาน) ·
  ยังไม่มีไฟล์สำหรับมือถือ ARM 32 บิตรุ่นเก่า
- กุญแจเซ็น APK: ตั้ง secrets `ANDROID_KEYSTORE_BASE64` และ `ANDROID_KEYSTORE_PASSWORD` (alias `webmix`) เพื่อให้อัปเดตทับเวอร์ชันเก่าได้
  — ถ้าไม่ตั้ง CI เซ็นด้วยกุญแจชั่วคราว ต้องถอนแอปเดิมก่อนติดตั้งเวอร์ชันใหม่
- อัปเดตอัตโนมัติ (Windows / macOS / Linux AppImage): ตั้ง secrets `TAURI_SIGNING_PRIVATE_KEY` และ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (สร้างด้วย `npx @tauri-apps/cli signer generate`; กุญแจสาธารณะอยู่ใน `desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`) — Release จะมี `latest.json` และไฟล์ `.sig` ให้แอปที่ติดตั้งแล้วอัปเดตตัวเอง · ไม่มี secret ก็ build ได้ตามปกติแต่ไม่มีไฟล์อัปเดต · Android แอปแจ้งเมื่อมีเวอร์ชันใหม่จาก GitHub
- CI คอมไพล์ ffmpeg สำหรับ Android (`desktop/android/build-ffmpeg.sh`) แล้วเปิดแอปบน emulator ให้สตรีม RTMP ออกมาจริงทุกครั้ง
- ไลเซนส์: ffmpeg และ x264 เป็น GPL — ซอร์สอยู่ในเวอร์ชันที่ระบุใน `build-ffmpeg.sh`

**Build เอง:** ต้องมี [Rust](https://rustup.rs) และ Node.js (Linux ต้องมี `libwebkit2gtk-4.1-dev` ตาม[คู่มือ Tauri](https://tauri.app/start/prerequisites/))

```bash
cd desktop
npx @tauri-apps/cli@2 build      # ตัวติดตั้งอยู่ใน desktop/target/release/bundle/
npx @tauri-apps/cli@2 dev        # รันแบบพัฒนา
cargo run -p webmix-gateway -- --port 8080 --token รหัส   # รันเฉพาะ Gateway (Rust) แทนเวอร์ชัน Node ได้
WEBMIX_SELFTEST=1 ./target/release/webmix-desktop          # ทดสอบตัวเอง: ตรวจ Gateway/ไฟล์/หน้าต่าง/การบันทึก แล้วปิดแอป
```

## เปิดใช้งานผ่าน GitHub Pages (HTTPS)

กล้องมือถือไร้สายต้องเปิดผ่าน **HTTPS** เท่านั้น (ถ้าเปิดไฟล์จากเครื่องตรง ๆ มือถือจะเปิดลิงก์ใน QR ไม่ได้)

1. ไปที่ **Settings → Pages** ของ repo นี้
2. ที่ **Build and deployment → Source** เลือก **GitHub Actions**
3. push ขึ้น branch หลัก (default branch) — workflow `.github/workflows/pages.yml` จะ deploy ให้อัตโนมัติ
   หรือกด **Actions → Deploy to GitHub Pages → Run workflow**
4. เปิดใช้งานที่ `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/`

ลิงก์/QR ของกล้องมือถือจะคงเดิมแม้รีเฟรชหน้า และมือถือจะเชื่อมต่อกลับเข้ามาเองเมื่อสตูดิโอออนไลน์อีกครั้ง

เมื่อตั้งค่า Stream Gateway แล้ว กล้องมือถือจะเชื่อมต่อผ่าน **PeerJS และ TURN server ของ Gateway เอง** (แถบสถานะขึ้น `WIRELESS READY · TURN`)
มือถือที่ใช้ 4G/5G หรือ Wi-Fi ที่ปิดกั้น WebRTC จึงส่งภาพได้ — ลิงก์/QR มีรหัส TURN ชั่วคราว (7 วัน) แต่ไม่มี token ของ Gateway
ถ้ายังไม่ได้ตั้ง Gateway จะใช้เซิร์ฟเวอร์ PeerJS สาธารณะแทน ซึ่งมือถือบางเครือข่ายอาจเชื่อมต่อไม่ได้
