#!/usr/bin/env bash
# ==========================================================================
#  WebMix Stream Gateway — ติดตั้งด้วยคำสั่งเดียว (Ubuntu / Debian)
#
#  ใช้งานบนเซิร์ฟเวอร์:
#    curl -fsSL https://raw.githubusercontent.com/jugkritso-png/webswither/HEAD/server/deploy/install.sh | sudo bash
#
#  ตัวเลือก (ใส่หน้า bash):
#    DOMAIN=live.example.com   ใช้โดเมนของตัวเอง (ต้องชี้ A record มาที่ IP เซิร์ฟเวอร์ก่อน)
#                              ถ้าไม่ใส่ จะใช้ <IP>.sslip.io ให้อัตโนมัติ — ไม่ต้องมีโดเมน
#    MAX_DESTINATIONS=6        จำนวนปลายทางสูงสุดต่อการสตรีม
#    VIDEO_ENCODER=h264_nvenc  ใช้การ์ดจอ NVIDIA เข้ารหัส (ต้องติดตั้ง NVIDIA Container Toolkit เอง)
#    X264_PRESET=superfast     ปรับความเร็ว/คุณภาพของการเข้ารหัสด้วย CPU
#    BRANCH=...                branch ของโค้ด (ค่าเริ่มต้น = branch หลักของ repo)
#
#  รันซ้ำเมื่อไหร่ก็ได้เพื่ออัปเดตเป็นเวอร์ชันล่าสุด — รหัส (token) และโดเมนเดิมจะถูกเก็บไว้
# ==========================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/jugkritso-png/webswither.git}"
BRANCH="${BRANCH:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/webmix-gateway}"
REQ_DOMAIN="${DOMAIN:-}"
REQ_MAX="${MAX_DESTINATIONS:-}"
REQ_ENCODER="${VIDEO_ENCODER:-}"
REQ_PRESET="${X264_PRESET:-}"
REQ_SRT_PORTS="${SRT_PORTS:-}"

say()  { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m ✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "กรุณารันด้วยสิทธิ์ root เช่น: curl -fsSL ... | sudo bash"
command -v apt-get >/dev/null || fail "สคริปต์นี้รองรับ Ubuntu / Debian เท่านั้น"

# ---------------------------------------------------------------- 1. Docker
say "ตรวจสอบเครื่องมือที่จำเป็น"
export DEBIAN_FRONTEND=noninteractive
if ! command -v curl >/dev/null || ! command -v git >/dev/null || ! command -v openssl >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq curl git openssl ca-certificates >/dev/null
fi
if ! command -v docker >/dev/null; then
  say "ติดตั้ง Docker (ใช้เวลาประมาณ 1–2 นาที)"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# ------------------------------------------------------------------ 2. Code
if [ -d "$INSTALL_DIR/.git" ]; then
  say "อัปเดตโค้ดใน $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch -q --depth 1 origin "${BRANCH:-HEAD}"
  git -C "$INSTALL_DIR" reset -q --hard FETCH_HEAD
else
  say "ดาวน์โหลดโค้ดไปที่ $INSTALL_DIR"
  git clone -q --depth 1 ${BRANCH:+--branch "$BRANCH"} "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR/server/deploy"

# ---------------------------------------------------------------- 3. Config
DOMAIN="" STREAM_TOKEN="" MAX_DESTINATIONS="" VIDEO_ENCODER="" X264_PRESET="" SRT_PORTS="" TURN_SECRET="" PUBLIC_IP=""
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
DOMAIN="${REQ_DOMAIN:-$DOMAIN}"
MAX_DESTINATIONS="${REQ_MAX:-${MAX_DESTINATIONS:-6}}"
VIDEO_ENCODER="${REQ_ENCODER:-${VIDEO_ENCODER:-libx264}}"
X264_PRESET="${REQ_PRESET:-$X264_PRESET}"
SRT_PORTS="${REQ_SRT_PORTS:-${SRT_PORTS:-9000-9009}}"

PUBLIC_IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me || true)"
if [ -z "$DOMAIN" ]; then
  [ -n "$PUBLIC_IP" ] || fail "หา IP สาธารณะของเซิร์ฟเวอร์ไม่ได้ — ระบุโดเมนเองด้วย DOMAIN=โดเมน"
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
STREAM_TOKEN="${STREAM_TOKEN:-$(openssl rand -hex 16)}"
TURN_SECRET="${TURN_SECRET:-$(openssl rand -hex 24)}"

umask 077
cat > .env <<EOF
DOMAIN=$DOMAIN
STREAM_TOKEN=$STREAM_TOKEN
MAX_DESTINATIONS=$MAX_DESTINATIONS
VIDEO_ENCODER=$VIDEO_ENCODER
X264_PRESET=$X264_PRESET
SRT_PORTS=$SRT_PORTS
TURN_SECRET=$TURN_SECRET
PUBLIC_IP=$PUBLIC_IP
EOF
ok "โดเมน: $DOMAIN"

# ------------------------------------------------------------- 4. Firewall
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow "${SRT_PORTS/-/:}/udp" >/dev/null
  ufw allow 3478 >/dev/null && ufw allow 49160:49250/udp >/dev/null
  ok "เปิดพอร์ต 80, 443 (TCP), $SRT_PORTS (UDP รับ SRT), 3478 และ 49160–49250/UDP (TURN) ใน ufw แล้ว"
fi

# ---------------------------------------------------------------- 5. Start
say "สร้างและเปิด Gateway (ครั้งแรกใช้เวลาประมาณ 2–4 นาที)"
docker compose up -d --build --remove-orphans

say "รอใบรับรอง HTTPS"
READY=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/" 2>/dev/null | grep -q "OK"; then READY=1; break; fi
  sleep 3
done

GATEWAY_URL="wss://$DOMAIN/?token=$STREAM_TOKEN"
echo "$GATEWAY_URL" > gateway-url.txt

echo
if [ -n "$READY" ]; then
  printf '\033[1;32m%s\033[0m\n' "════════════════  ติดตั้งสำเร็จ  ════════════════"
else
  printf '\033[1;33m%s\033[0m\n' "═══  Gateway เปิดแล้ว แต่ HTTPS ยังไม่พร้อม  ═══"
  echo "ตรวจสอบว่า:"
  echo "  • ไฟร์วอลล์ของผู้ให้บริการ (Security Group / Firewall) เปิดพอร์ต 80 และ 443 แล้ว"
  [ -n "$REQ_DOMAIN" ] && echo "  • โดเมน $DOMAIN ชี้ A record มาที่ IP ${PUBLIC_IP:-ของเซิร์ฟเวอร์} แล้ว"
  echo "  • ดู log ได้ด้วย: cd $INSTALL_DIR/server/deploy && docker compose logs caddy"
fi
echo
echo "นำค่านี้ไปใส่ช่อง Stream Gateway ใน WebMix (ปุ่มตั้งค่า → แท็บการสตรีม):"
echo
printf '    \033[1;36m%s\033[0m\n' "$GATEWAY_URL"
echo
echo "พอร์ตที่ต้องเปิดในไฟร์วอลล์ของผู้ให้บริการ: TCP 80, 443, 3478 · UDP 3478, 49160-49250, $SRT_PORTS"
echo "รับสัญญาณ SRT:          srt://$DOMAIN:<พอร์ต $SRT_PORTS> (เปิด UDP $SRT_PORTS ในไฟร์วอลล์ของผู้ให้บริการด้วย)"
echo "ตรวจสถานะในเบราว์เซอร์:  https://$DOMAIN/"
echo "ดูค่านี้อีกครั้ง:         cat $INSTALL_DIR/server/deploy/gateway-url.txt"
echo "ดู log:                  cd $INSTALL_DIR/server/deploy && docker compose logs -f gateway"
echo "อัปเดตเวอร์ชัน:           รันคำสั่งติดตั้งเดิมซ้ำ"
