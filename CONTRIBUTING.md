# แนวทางการส่งโค้ด

## ก่อนเริ่ม

- อ่าน [docs/development.md](docs/development.md) — โครงสร้างโค้ด, คำสั่งที่ใช้ และวิธีรันชุดทดสอบ
- ติดตั้งเครื่องมือ: `npm ci` (root) · `cd server && npm ci` · `cd tests && npm ci && npx playwright install chromium`
- ต้องมี Node.js 22 และ ffmpeg (พร้อม libsrt) สำหรับชุดทดสอบ

## หลักการเขียนโค้ด

- **ไม่มีขั้นตอน build** — หน้าเว็บโหลดไฟล์ใน `assets/` ตรง ๆ โมดูลแชร์กันผ่าน `window.WebMix`
  ฟีเจอร์ใหม่ที่ทำงานแยกได้ ให้เขียนเป็นไฟล์ใน `assets/js/` แทนการเพิ่มใน `assets/app.js`
- ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย และต้องมีคำแปลใน `assets/js/i18n-en.js` (ชุดทดสอบ `i18ncover` ตรวจให้)
- **ห้ามเก็บหรือ commit รหัสใด ๆ** — Stream key, token ของ Gateway, รหัสผ่านกล้อง, คีย์ API
  ไฟล์ผู้ใช้ของ Gateway เก็บเฉพาะ hash ของ token และหน้า /admin ไม่แสดง Stream key ของใคร
- ใช้รูปแบบตาม `.editorconfig` (เว้นวรรค 2 ช่อง, LF, UTF-8) และให้ `npm run lint` ผ่าน
- ทุกการเปลี่ยนแปลงที่ผู้ใช้เห็นต้องมีชุดทดสอบใน `tests/suites/` และลงทะเบียนในรายการ `ALL` ของ `tests/run.js`

## ก่อน push

```bash
npm run lint
npm test -- <ชุดทดสอบที่เกี่ยวข้อง>
```

CI (GitHub Actions) รัน lint, ชุดทดสอบทั้งหมด, build แอปทุกระบบ และทดสอบแอป Android บน emulator ทุกครั้งที่ push

## ออกเวอร์ชัน

1. เปลี่ยนเลขเวอร์ชันใน `desktop/Cargo.toml`, `desktop/package.json`, `desktop/package-lock.json`,
   `desktop/src-tauri/tauri.conf.json` และ `desktop/Cargo.lock` (แพ็กเกจ `webmix-desktop` และ `webmix-gateway`)
2. เขียน `desktop/RELEASE_NOTES.md` (ภาษาไทย)
3. Actions → **Desktop app** → Run workflow โดยติ๊ก `release`
