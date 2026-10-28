// คัดลอกหน้า WebMix (index.html + assets) จากโฟลเดอร์หลักของ repo มาเป็น frontend ของแอปเดสก์ท็อป
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(here, '..', 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'index.html'), join(dist, 'index.html'));
// ภาพของหน้าเปิดตัว (launch.html บน GitHub Pages) ไม่ต้องอยู่ในแอป
cpSync(join(root, 'assets'), join(dist, 'assets'), { recursive: true, filter: src => !src.includes(join('assets', 'launch')) });
console.log('web UI copied to', dist);
