# WebMix Broadcast Pro

ระบบสลับภาพและเสียง (live production switcher) ที่ทำงานบนเว็บเบราว์เซอร์ ใช้ได้ทั้งคอมพิวเตอร์ แท็บเล็ต และมือถือ

- จอ Preview / Program, ปุ่ม CUT / AUTO / FTB และ T-Bar (เอฟเฟกต์ MIX, DIP, WIPE เลือกเวลาได้)
- Input: กล้อง/แคปเจอร์การ์ด (เลือกอุปกรณ์และความละเอียด), แชร์หน้าจอ, ไฟล์วิดีโอ (เล่น/หยุด/วนซ้ำ), ภาพนิ่ง,
  Color Bars, Slate ข้อความ, นาฬิกา, Black และกล้องมือถือไร้สายผ่าน QR Code (มีไฟ Tally บนมือถือ)
- กราฟิก: ป้ายชื่อ Lower Third พร้อมแอนิเมชัน, ภาพซ้อน PIP, Chroma Key ฉากเขียว/ฟ้า
- มิกเซอร์เสียง: มิเตอร์ dBFS จริง, เฟดเดอร์, Mute, Audio Follow Video, ฟังเสียงผ่านหูฟัง (MON)
- บันทึกวิดีโอ, สตรีมสด RTMP (YouTube / Facebook / Twitch / อื่น ๆ), ภาพนิ่ง, หน้าต่าง Program Output แยก, เต็มจอ
- คู่มือในแอป (ปุ่ม ?) และดาวน์โหลดคู่มือเป็นไฟล์ Word

โครงสร้างไฟล์: `index.html` (หน้าเว็บ), `assets/app.css` (ดีไซน์), `assets/app.js` (การทำงาน), `server/` (Stream Gateway)

## เปิดใช้งานผ่าน GitHub Pages (HTTPS)

กล้องมือถือไร้สายต้องเปิดผ่าน **HTTPS** เท่านั้น (ถ้าเปิดไฟล์จากเครื่องตรง ๆ มือถือจะเปิดลิงก์ใน QR ไม่ได้)

1. ไปที่ **Settings → Pages** ของ repo นี้
2. ที่ **Build and deployment → Source** เลือก **GitHub Actions**
3. push ขึ้น branch หลัก (default branch) — workflow `.github/workflows/pages.yml` จะ deploy ให้อัตโนมัติ
   หรือกด **Actions → Deploy to GitHub Pages → Run workflow**
4. เปิดใช้งานที่ `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/`

ลิงก์/QR ของกล้องมือถือจะคงเดิมแม้รีเฟรชหน้า และมือถือจะเชื่อมต่อกลับเข้ามาเองเมื่อสตูดิโอออนไลน์อีกครั้ง

## สตรีมสด (RTMP)

เบราว์เซอร์ส่ง RTMP เองไม่ได้ จึงต้องมี **Stream Gateway** เล็ก ๆ คั่นกลาง:
เบราว์เซอร์ → (WebSocket) → Gateway → FFmpeg → RTMP (YouTube / Facebook / ฯลฯ)

```bash
# ต้องมี Node.js 18+ และ ffmpeg ติดตั้งในเครื่องที่รัน Gateway
cd server
npm install
STREAM_TOKEN=รหัสลับของคุณ PORT=8080 npm start
```

ในหน้า WebMix กดปุ่มตั้งค่า (ไอคอนแถบเลื่อน) → แท็บ **การสตรีม**:

- Stream Gateway ใส่ `wss://โดเมนของคุณ:8080/?token=รหัสลับของคุณ`
- เลือกแพลตฟอร์ม (YouTube / Facebook / Twitch / กำหนดเอง) แล้วใส่ Stream Key
- กด **STREAM** ที่แถบด้านบน — ความละเอียด เฟรมเรต และบิตเรตตั้งได้ในแท็บ **เอาต์พุต**

หมายเหตุ

- หน้าเว็บที่เปิดผ่าน HTTPS (เช่น GitHub Pages) ต้องใช้ `wss://` ดังนั้นควรวาง Gateway ไว้หลัง reverse proxy ที่มี TLS
  (เช่น Caddy / Nginx) — ถ้าทดสอบในเครื่องตัวเองผ่าน `http://localhost` ใช้ `ws://localhost:8080` ได้
- ควรตั้ง `STREAM_TOKEN` ทุกครั้งที่เปิด Gateway ให้เข้าถึงจากอินเทอร์เน็ต ไม่เช่นนั้นใครก็ใช้เครื่องคุณส่งสตรีมได้

## บันทึกวิดีโอ

ปุ่ม **● REC** เลือกฟอร์แมตที่เบราว์เซอร์รองรับให้อัตโนมัติ (Chrome/Firefox ได้ `.webm`, Safari ได้ `.mp4`)
