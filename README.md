# WebMix Broadcast Pro

ระบบสลับภาพและเสียง (live production switcher) ที่ทำงานบนเว็บเบราว์เซอร์ ใช้ได้ทั้งคอมพิวเตอร์ แท็บเล็ต และมือถือ

- จอ Preview / Program, ปุ่ม CUT / AUTO / FTB และ T-Bar (เอฟเฟกต์ MIX, DIP, WIPE เลือกเวลาได้)
- Input: กล้อง/แคปเจอร์การ์ด (เลือกอุปกรณ์และความละเอียด), แชร์หน้าจอ, ไฟล์วิดีโอ (เล่น/หยุด/วนซ้ำ), ภาพนิ่ง,
  Color Bars, Slate ข้อความ, นาฬิกา, Black และกล้องมือถือไร้สายผ่าน QR Code (มีไฟ Tally บนมือถือ)
- กราฟิก: ป้ายชื่อ Lower Third พร้อมแอนิเมชัน, ภาพซ้อน PIP, Chroma Key ฉากเขียว/ฟ้า
- มิกเซอร์เสียง: มิเตอร์ dBFS จริง, เฟดเดอร์, Mute, Audio Follow Video, ฟังเสียงผ่านหูฟัง (MON)
- บันทึกวิดีโอ, **สตรีมสดหลายช่องทางพร้อมกัน** (YouTube / Facebook / Twitch / RTMP อื่น ๆ สูงสุด 6 ปลายทาง),
  ภาพนิ่ง, หน้าต่าง Program Output แยก, เต็มจอ
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

## สตรีมสด (RTMP) — หลายช่องทางพร้อมกัน

เบราว์เซอร์ส่ง RTMP เองไม่ได้ จึงต้องมี **Stream Gateway** เล็ก ๆ คั่นกลาง:

```
เบราว์เซอร์ ──(WebSocket ครั้งเดียว)──▶ Gateway: FFmpeg เข้ารหัส H.264/AAC ครั้งเดียว
                                          ├──▶ YouTube
                                          ├──▶ Facebook
                                          └──▶ Twitch / RTMP อื่น ๆ
```

- อินเทอร์เน็ตขาขึ้นของเครื่องที่เปิด WebMix ใช้เท่ากับสตรีมช่องเดียว ไม่ว่าจะส่งกี่ปลายทาง
  (Gateway ต้องมีขาขึ้นพอสำหรับทุกปลายทาง เช่น 3 ปลายทาง × 4.5 Mbps ≈ 14 Mbps)
- แต่ละปลายทางเริ่ม/หยุดได้อิสระระหว่างไลฟ์ ปลายทางที่หลุดจะเชื่อมต่อใหม่เองทุก 5 วินาที โดยไม่กระทบช่องอื่น
- จำนวนปลายทางสูงสุดต่อการเชื่อมต่อตั้งได้ด้วยตัวแปร `MAX_DESTINATIONS` (ค่าเริ่มต้น 6)

### ติดตั้ง Gateway บนเซิร์ฟเวอร์ด้วยคำสั่งเดียว (แนะนำ)

ต้องมี VPS ที่ใช้ **Ubuntu 22.04 / 24.04** หรือ **Debian 12** (เช่น DigitalOcean, Vultr, Linode, AWS Lightsail, Google Cloud)

| ใช้งาน | CPU / RAM ขั้นต่ำ |
|---|---|
| 720p30 | 2 vCPU / 2 GB |
| 1080p30 – 1080p60 | 4 vCPU / 4 GB |

1. เปิดพอร์ต **80** และ **443** (TCP) ในไฟร์วอลล์ของผู้ให้บริการ (Security Group / Firewall rules)
2. SSH เข้าเซิร์ฟเวอร์แล้วรัน:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/jugkritso-png/webswither/HEAD/server/deploy/install.sh | sudo bash
   ```

3. เมื่อเสร็จ สคริปต์จะแสดงค่า `wss://…/?token=…` — นำไปใส่ช่อง **Stream Gateway** ใน WebMix
   (ปุ่มตั้งค่า → แท็บการสตรีม) แล้วกด STREAM ได้เลย

สคริปต์จะติดตั้ง Docker, สร้างรหัสลับ (token) แบบสุ่ม และใช้ **Caddy** ขอใบรับรอง HTTPS ให้อัตโนมัติ
ถ้าไม่มีโดเมน จะใช้ `<IP>.sslip.io` ให้เอง ถ้ามีโดเมนของตัวเอง ให้ชี้ A record มาที่ IP ของเซิร์ฟเวอร์แล้วรัน:

```bash
curl -fsSL https://raw.githubusercontent.com/jugkritso-png/webswither/HEAD/server/deploy/install.sh | sudo DOMAIN=live.example.com bash
```

การดูแลหลังติดตั้ง (ไฟล์อยู่ที่ `/opt/webmix-gateway/server/deploy`):

| ต้องการ | คำสั่ง |
|---|---|
| ดูค่า Gateway URL อีกครั้ง | `sudo cat /opt/webmix-gateway/server/deploy/gateway-url.txt` |
| ตรวจสถานะ | เปิด `https://โดเมน/` ในเบราว์เซอร์ ต้องเห็น `WebMix Stream Gateway: OK` |
| ดู log | `cd /opt/webmix-gateway/server/deploy && sudo docker compose logs -f gateway` |
| อัปเดตเป็นเวอร์ชันล่าสุด | รันคำสั่งติดตั้งเดิมซ้ำ (token และโดเมนเดิมยังอยู่) |
| เปลี่ยน token | ลบบรรทัด `STREAM_TOKEN=` ใน `.env` แล้วรันคำสั่งติดตั้งซ้ำ |
| ถอนการติดตั้ง | `cd /opt/webmix-gateway/server/deploy && sudo docker compose down -v && sudo rm -rf /opt/webmix-gateway` |

### รันเองแบบไม่ใช้ Docker

```bash
# ต้องมี Node.js 18+ และ ffmpeg ติดตั้งในเครื่องที่รัน Gateway
cd server
npm install
STREAM_TOKEN=รหัสลับของคุณ PORT=8080 npm start
```

ในหน้า WebMix กดปุ่มตั้งค่า (ไอคอนแถบเลื่อน) → แท็บ **การสตรีม**:

- Stream Gateway ใส่ `wss://โดเมนของคุณ:8080/?token=รหัสลับของคุณ`
- กด **เพิ่มปลายทาง** ตามจำนวนช่องที่ต้องการ เลือกแพลตฟอร์ม (YouTube / Facebook / Twitch / RTMP อื่น ๆ)
  แล้วใส่ Stream Key ของแต่ละช่อง (ช่องที่ติ๊กไว้คือช่องที่จะเริ่มเมื่อกด “เริ่มทั้งหมด”)
- กด **STREAM** ที่แถบด้านบน (หรือแถบสถานะ STREAM ด้านล่าง) เพื่อเปิดแผงปลายทาง:
  - กด **เริ่ม** ที่ช่องใดก็ได้ เพื่อไลฟ์เฉพาะช่องนั้น แล้วค่อยเริ่มช่องอื่นเพิ่มทีหลังได้
  - กด **เริ่มทั้งหมด** เพื่อเริ่มทุกช่องที่ติ๊กไว้พร้อมกัน
  - กด **หยุด** ทีละช่อง หรือ **หยุดทั้งหมด** — เมื่อหยุดช่องสุดท้าย ระบบจะตัดการเชื่อมต่อ Gateway ให้เอง
- ความละเอียด เฟรมเรต และบิตเรตตั้งได้ในแท็บ **เอาต์พุต**

หมายเหตุ

- หน้าเว็บที่เปิดผ่าน HTTPS (เช่น GitHub Pages) ต้องใช้ `wss://` ดังนั้นควรวาง Gateway ไว้หลัง reverse proxy ที่มี TLS
  (เช่น Caddy / Nginx) — ถ้าทดสอบในเครื่องตัวเองผ่าน `http://localhost` ใช้ `ws://localhost:8080` ได้
- ควรตั้ง `STREAM_TOKEN` ทุกครั้งที่เปิด Gateway ให้เข้าถึงจากอินเทอร์เน็ต ไม่เช่นนั้นใครก็ใช้เครื่องคุณส่งสตรีมได้

## บันทึกวิดีโอ

ปุ่ม **● REC** เลือกฟอร์แมตที่เบราว์เซอร์รองรับให้อัตโนมัติ (Chrome/Firefox ได้ `.webm`, Safari ได้ `.mp4`)
