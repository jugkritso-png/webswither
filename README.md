# WebMix Broadcast Pro

ระบบสลับภาพและเสียง (live production switcher) ที่ทำงานบนเว็บเบราว์เซอร์ ใช้ได้ทั้งคอมพิวเตอร์ แท็บเล็ต และมือถือ
รองรับความละเอียดสูงสุด **4K (3840 × 2160)** ทั้งระบบ — กล้อง, Program, กราฟิก, การบันทึก, การสตรีม และกล้องมือถือ

- จอ Preview / Program, ปุ่ม CUT / AUTO / FTB และ T-Bar (เอฟเฟกต์ MIX, DIP, WIPE เลือกเวลาได้)
- Input: กล้อง/แคปเจอร์การ์ด (เลือกอุปกรณ์และความละเอียด), แชร์หน้าจอ, ไฟล์วิดีโอ (เล่น/หยุด/วนซ้ำ), ภาพนิ่ง,
  Color Bars, Slate ข้อความ, นาฬิกา, Black และกล้องมือถือไร้สายผ่าน QR Code (มีไฟ Tally บนมือถือ)
- กราฟิก: ป้ายชื่อ Lower Third พร้อมแอนิเมชัน, ภาพซ้อน PIP, Chroma Key ฉากเขียว/ฟ้า
- มิกเซอร์เสียง: มิเตอร์ dBFS จริง, เฟดเดอร์, Mute, Audio Follow Video, ฟังเสียงผ่านหูฟัง (MON),
  ลิมิตเตอร์ที่ Master และ FX ต่อช่อง (หน่วงเสียง, EQ 3 ย่าน, คอมเพรสเซอร์)
- บันทึกวิดีโอ, **สตรีมสดหลายช่องทางพร้อมกัน** (YouTube / Facebook / Twitch / **SRT** / RTMP อื่น ๆ สูงสุด 6 ปลายทาง),
  ภาพนิ่ง, หน้าต่าง Program Output แยก, เต็มจอ
- คู่มือในแอป (ปุ่ม ?) และดาวน์โหลดคู่มือเป็นไฟล์ Word

โครงสร้างไฟล์: `index.html` (หน้าเว็บ), `assets/app.css` (ดีไซน์), `assets/app.js` (การทำงาน), `server/` (Stream Gateway),

## ดาวน์โหลด

- **เว็บ (ไม่ต้องติดตั้ง):** https://jugkritso-png.github.io/webswither/
- **แอป Windows / macOS / Linux / Android:** [Releases](https://github.com/jugkritso-png/webswither/releases/latest)
- **เซิร์ฟเวอร์ของตัวเอง (ส่งไลฟ์หลายปลายทาง, กล้องมือถือผ่าน 4G):** ในแอป → ตั้งค่า → การสตรีม → “ตั้งเซิร์ฟเวอร์ของฉัน” — ไม่ต้องพิมพ์คำสั่ง ([รายละเอียด](docs/streaming-and-server.md))

## เอกสาร

| เรื่อง | เอกสาร |
|---|---|
| ติดตั้งแอปเดสก์ท็อป, Android และเปิดผ่าน GitHub Pages | [docs/apps.md](docs/apps.md) |
| ฟีเจอร์ของสตูดิโอ (Overlay, CG Studio, GPU, แขกรับเชิญ, Multiview, Playlist, กราฟิกข้อมูล, การบันทึก, โชว์, 4K) | [docs/features.md](docs/features.md) |
| สตรีมหลายปลายทาง, ติดตั้ง Stream Gateway บนเซิร์ฟเวอร์, ผู้ใช้หลายคน, หน้าผู้ดูแล, SRT / NDI | [docs/streaming-and-server.md](docs/streaming-and-server.md) |
| โครงสร้างโค้ด, คำสั่งที่ใช้พัฒนา, การทดสอบ | [docs/development.md](docs/development.md) |
| แนวทางการส่งโค้ด | [CONTRIBUTING.md](CONTRIBUTING.md) |

## โครงสร้าง repo

```
index.html, cg-studio.html, launch.html   หน้าเว็บ (ไม่ต้อง build)
assets/          สตูดิโอ: app.js + โมดูลใน assets/js/, CSS, ไอคอน, ไลบรารีที่ฝังไว้ (vendor/)
server/          Stream Gateway (Node.js) + หน้าผู้ดูแล + ชุดติดตั้งเซิร์ฟเวอร์ (deploy/)
desktop/         แอปเดสก์ท็อป/Android (Tauri) + Stream Gateway เวอร์ชัน Rust (gateway/)
tests/           ชุดทดสอบอัตโนมัติ (Playwright + ffmpeg)
docs/            เอกสาร
```
