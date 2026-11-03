# การพัฒนา

โครงสร้างโค้ด, คำสั่งที่ใช้ระหว่างพัฒนา และการทดสอบ — กลับไปที่ [README](../README.md) · ดูแนวทางการส่งโค้ดที่ [CONTRIBUTING](../CONTRIBUTING.md)

## คำสั่งที่ใช้บ่อย

```bash
npm ci                       # ติดตั้งเครื่องมือตรวจโค้ด (ESLint) ที่ root
npm run lint                 # ตรวจโค้ดทั้ง repo — CI รันทุกครั้งที่ push
npm run lint:fix             # แก้ส่วนที่แก้อัตโนมัติได้
npm run serve                # เปิดสตูดิโอที่ http://localhost:8765
npm test                     # รันชุดทดสอบทั้งหมด (ดูหัวข้อการทดสอบอัตโนมัติ)
npm test -- switcher admin-ui   # เฉพาะบางชุด
```

## โครงสร้างโค้ด

ไม่ต้อง build — เปิด `index.html` ได้ตรง ๆ ไฟล์ JavaScript ทั้งหมดเป็นสคริปต์ธรรมดาที่โหลดตามลำดับและใช้ `window.WebMix` ร่วมกัน

| ไฟล์ | หน้าที่ |
|---|---|
| `assets/js/core.js` | ตัวช่วยทั่วไป, localStorage, toast, กันจอดับ, ค่าการเชื่อมต่อ WebRTC |
| `assets/js/draw.js` | วาดแหล่งภาพที่สร้างเอง (Bars, Slate, นาฬิกา, NO SIGNAL, ป้ายชื่อ, Title) |
| `assets/js/keyer.js` · `assets/js/gpu.js` | คีย์ฉากเขียวด้วย GPU · ระบบวาดภาพด้วยการ์ดจอ (WebGL) |
| `assets/js/storage.js` | IndexedDB และ OPFS (ไฟล์ของโชว์) |
| `assets/js/caller.js` | หน้ากล้องมือถือและหน้าแขกรับเชิญ |
| `assets/js/graphics.js` | กราฟิกข้อมูล (นาฬิกา, ป้ายคะแนน, ตัววิ่ง) และตัวอ่าน Google Sheets/CSV |
| `assets/js/multiview.js` · `assets/js/manual.js` | Multiview · คู่มือและคีย์ลัดในแอป |
| `assets/js/sources.js` | แหล่งภาพ: ป้ายกลุ่ม, ค้นหา/กรอง, ลากเรียงลำดับ, เลือกหลายแหล่งเพื่อติดป้าย |
| `assets/js/i18n.js` · `assets/js/i18n-en.js` | สลับภาษาไทย / English · พจนานุกรมภาษาอังกฤษ |
| `assets/webm-seek.js` | ทำให้ไฟล์ WebM ที่บันทึกมีความยาวและเลื่อนหาตำแหน่งได้ |
| `assets/app.js` | สตูดิโอ: Input, การสลับภาพ, Overlay, เสียง, บันทึก, สตรีม, โชว์ |
| `assets/js/playlist.js` · `assets/js/highlight.js` | Playlist (เล่นวิดีโอ/รูปต่อกัน) · คลิปไฮไลต์ 9:16 — รับสิ่งที่ต้องใช้จาก app.js ผ่าน `ctx` (แบบเดียวกันกับโมดูลที่จะแยกต่อไป) |
| `assets/js/wcrec.js` | บันทึก/สตรีมด้วย WebCodecs + ตัวเขียน WebM (ใช้แทน MediaRecorder ที่เสียใน WebKitGTK/Linux) |
| `assets/js/desktop.js` | เชื่อมกับแอปเดสก์ท็อป (Gateway ในแอป, บันทึกลงโฟลเดอร์, ทดสอบตัวเอง) — ในเบราว์เซอร์ไม่ทำอะไร |
| `server/stream-gateway.js` | Stream Gateway: จุดเริ่ม — เส้นทาง HTTP (`/`, `/ice`, `/admin`, `/metrics`) และ WebSocket |
| `server/lib/` | `config` ค่าตั้ง · `ffmpeg` คำสั่ง ffmpeg · `auth` token/กันเดารหัส · `sessions` การเชื่อมต่อและ drain · `stream` สตรีมออกหลายปลายทาง · `ingest` SRT/RTSP/RTMP ขาเข้า · `ice` PeerJS/TURN · `admin` หน้าผู้ดูแล |
| `server/` (อื่น ๆ) | ผู้ใช้ (`users.js`), การเฝ้าระวัง (`monitor.js`), หน้าผู้ดูแล (`admin.html`), ชุดติดตั้ง (`deploy/`) |
| `desktop/gateway/` | Stream Gateway เวอร์ชัน Rust (โปรโตคอลเดียวกับเวอร์ชัน Node) |
| `desktop/src-tauri/` | แอปเดสก์ท็อป (Tauri): Gateway ในตัว, เขียนไฟล์บันทึก, หน้าต่าง Output |

## การทดสอบอัตโนมัติ

ชุดทดสอบอยู่ในโฟลเดอร์ `tests/` (สตูดิโอ, multistream, กล้องมือถือ, SRT ขาเข้า/ขาออก, 4K, การเชื่อมต่อใหม่, การบันทึก, เสียง, บันทึกโชว์, Gateway หลายผู้ใช้, Overlay)
และรันอัตโนมัติบน GitHub Actions ทุกครั้งที่ push (รวมถึงการ build Docker image ของ Gateway)
workflow **Desktop app** build แอปบน Windows / macOS / Linux แล้วเปิดแอปจริงในโหมดทดสอบตัวเอง และรันชุดทดสอบการสตรีมกับ Gateway เวอร์ชัน Rust
(`GATEWAY_BIN=desktop/target/release/webmix-gateway npm test -- multistream`)

```bash
# ต้องมี Node.js 22 และ ffmpeg (พร้อม libsrt)
cd server && npm ci && cd ../tests && npm ci && npx playwright install chromium
npm test                     # ทุกชุด
npm test -- switcher srt-input   # เฉพาะบางชุด
```
