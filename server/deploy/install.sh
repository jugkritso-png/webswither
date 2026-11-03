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
#    MAX_STREAMS=2             จำนวนสตรีมพร้อมกันทั้งเซิร์ฟเวอร์ (ค่าเริ่มต้น = จำนวนคอร์ ÷ 2)
#    ALERT_WEBHOOK=https://...  ส่งแจ้งเตือนเข้า Discord / Slack / Google Chat (webhook URL)
#    TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...   ส่งแจ้งเตือนเข้า Telegram
#    BRANCH=...                branch ของโค้ด (ค่าเริ่มต้น = branch หลักของ repo)
#    UPLINK_MBPS=1000          ความเร็วอัปโหลดของเซิร์ฟเวอร์ (Mbps) — หน้า /admin แสดงว่าเน็ตขาออกเหลือเท่าไร
#
#    STREAM_TOKEN=...          รหัสผู้ดูแลที่สร้างไว้เอง (ตัวช่วยตั้งเซิร์ฟเวอร์ในแอป WebMix ใส่ให้) — ไม่ใส่ = สุ่มให้
#    AUTO_UPDATE=0             ปิดการอัปเดตอัตโนมัติ (ค่าเริ่มต้น: เปิด — ตรวจเวอร์ชันใหม่ทุกคืนตี 4 ไม่ตัดไลฟ์)
#
#  ไม่อยากพิมพ์คำสั่งเลย: ในแอป WebMix → ตั้งค่า → การสตรีม → “ตั้งเซิร์ฟเวอร์ของฉัน”
#  ได้ข้อความไปวางในช่อง User data ตอนสร้างเซิร์ฟเวอร์ (DigitalOcean / Vultr / Linode / AWS Lightsail) — ติดตั้งเองตอนเปิดเครื่อง
#
#    WAIT_MINUTES=120          ตอนอัปเดต: รอให้ไลฟ์ที่ออกอากาศอยู่จบได้นานสุดกี่นาที (ระหว่างรอไม่รับไลฟ์ใหม่)
#    FORCE=1                   อัปเดตทันทีโดยไม่รอ (ไลฟ์ที่ออกอากาศอยู่จะหลุดแล้วต่อใหม่เอง)
#
#  รันซ้ำเมื่อไหร่ก็ได้เพื่ออัปเดตเป็นเวอร์ชันล่าสุด — รหัส (token) และโดเมนเดิมจะถูกเก็บไว้
#  และไม่ตัดไลฟ์ที่ออกอากาศอยู่: สร้างเวอร์ชันใหม่ไว้ก่อน หยุดรับไลฟ์ใหม่ รอไลฟ์เดิมจบ แล้วค่อยสลับ
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
REQ_MAX_STREAMS="${MAX_STREAMS:-}"
REQ_WEBHOOK="${ALERT_WEBHOOK:-}"
REQ_TG_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
REQ_TG_CHAT="${TELEGRAM_CHAT_ID:-}"
REQ_UPLINK="${UPLINK_MBPS:-}"
REQ_TOKEN="${STREAM_TOKEN:-}"
REQ_AUTO="${AUTO_UPDATE:-}"
# AUTO_RUN=1 = เรียกจากตัวอัปเดตอัตโนมัติ (systemd) — ไม่มีเวอร์ชันใหม่ก็จบเลย
AUTO_RUN="${AUTO_RUN:-}"
WAIT_MINUTES="${WAIT_MINUTES:-120}"
FORCE="${FORCE:-}"

say()  { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m ✗ %s\033[0m\n' "$*" >&2; exit 1; }

if [ -n "$REQ_TOKEN" ] && ! printf '%s' "$REQ_TOKEN" | grep -Eq '^[A-Za-z0-9_-]{24,128}$'; then
  echo "STREAM_TOKEN ต้องเป็นตัวอักษรอังกฤษ ตัวเลข _ หรือ - ยาว 24–128 ตัว" >&2; exit 1
fi
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
  if [ -n "$AUTO_RUN" ] && [ "$(git -C "$INSTALL_DIR" rev-parse HEAD)" = "$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)" ] \
     && [ -n "$(cd "$INSTALL_DIR/server/deploy" && docker compose ps -q gateway 2>/dev/null)" ]; then
    ok "ไม่มีเวอร์ชันใหม่ — ไม่ต้องอัปเดต"; exit 0
  fi
  git -C "$INSTALL_DIR" reset -q --hard FETCH_HEAD
else
  say "ดาวน์โหลดโค้ดไปที่ $INSTALL_DIR"
  git clone -q --depth 1 ${BRANCH:+--branch "$BRANCH"} "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR/server/deploy"

# ---------------------------------------------------------------- 3. Config
DOMAIN="" STREAM_TOKEN="" MAX_DESTINATIONS="" VIDEO_ENCODER="" X264_PRESET="" SRT_PORTS="" TURN_SECRET="" PUBLIC_IP=""
MAX_STREAMS="" ALERT_WEBHOOK="" TELEGRAM_BOT_TOKEN="" TELEGRAM_CHAT_ID="" UPLINK_MBPS="" AUTO_UPDATE=""
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
DOMAIN="${REQ_DOMAIN:-$DOMAIN}"
MAX_DESTINATIONS="${REQ_MAX:-${MAX_DESTINATIONS:-6}}"
VIDEO_ENCODER="${REQ_ENCODER:-${VIDEO_ENCODER:-libx264}}"
X264_PRESET="${REQ_PRESET:-$X264_PRESET}"
SRT_PORTS="${REQ_SRT_PORTS:-${SRT_PORTS:-9000-9009}}"
CORES="$(nproc 2>/dev/null || echo 2)"
MAX_STREAMS="${REQ_MAX_STREAMS:-${MAX_STREAMS:-$(( CORES / 2 > 0 ? CORES / 2 : 1 ))}}"
ALERT_WEBHOOK="${REQ_WEBHOOK:-$ALERT_WEBHOOK}"
TELEGRAM_BOT_TOKEN="${REQ_TG_TOKEN:-$TELEGRAM_BOT_TOKEN}"
TELEGRAM_CHAT_ID="${REQ_TG_CHAT:-$TELEGRAM_CHAT_ID}"
UPLINK_MBPS="${REQ_UPLINK:-$UPLINK_MBPS}"
AUTO_UPDATE="${REQ_AUTO:-${AUTO_UPDATE:-1}}"
case "$UPLINK_MBPS" in ""|*[!0-9]*) UPLINK_MBPS=0 ;; esac

PUBLIC_IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me || true)"
if [ -z "$DOMAIN" ]; then
  [ -n "$PUBLIC_IP" ] || fail "หา IP สาธารณะของเซิร์ฟเวอร์ไม่ได้ — ระบุโดเมนเองด้วย DOMAIN=โดเมน"
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
STREAM_TOKEN="${REQ_TOKEN:-${STREAM_TOKEN:-$(openssl rand -hex 16)}}"
TURN_SECRET="${TURN_SECRET:-$(openssl rand -hex 24)}"

# ไลฟ์ส่งข้อมูลต่อเนื่องเป็นชั่วโมง: BBR ส่ง RTMP ไป YouTube / Facebook ได้เต็มเส้นแม้มีแพ็กเก็ตหาย
# บัฟเฟอร์ UDP ใหญ่ขึ้นให้ SRT รับภาพบิตเรตสูงไม่หลุด · ไม่ลดความเร็วส่งหลังช่วงเงียบ · เปิดไฟล์/การเชื่อมต่อได้มาก
say "ปรับเครือข่ายของเครื่องสำหรับไลฟ์"
modprobe tcp_bbr 2>/dev/null || true
TCP_CC=cubic
if grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
  TCP_CC=bbr
  echo tcp_bbr > /etc/modules-load.d/webmix.conf
fi
cat > /etc/sysctl.d/90-webmix.conf <<SYSCTL
# WebMix Stream Gateway (install.sh) — ลบไฟล์นี้แล้วรีบูตเพื่อกลับเป็นค่าเดิม
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = $TCP_CC
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.core.rmem_max = 33554432
net.core.wmem_max = 33554432
net.core.netdev_max_backlog = 16384
fs.file-max = 1048576
SYSCTL
sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/90-webmix.conf >/dev/null 2>&1 || true
ok "TCP $TCP_CC · บัฟเฟอร์ UDP 32 MB (SRT) · เปิดการเชื่อมต่อได้ 65536"

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
MAX_STREAMS=$MAX_STREAMS
ALERT_WEBHOOK='$ALERT_WEBHOOK'
TELEGRAM_BOT_TOKEN='$TELEGRAM_BOT_TOKEN'
TELEGRAM_CHAT_ID='$TELEGRAM_CHAT_ID'
TCP_CC=$TCP_CC
UPLINK_MBPS=$UPLINK_MBPS
AUTO_UPDATE=$AUTO_UPDATE
EOF
ok "โดเมน: $DOMAIN"

# ------------------------------------------------------------- 4. Firewall
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow "${SRT_PORTS/-/:}/udp" >/dev/null
  ufw allow 3478 >/dev/null && ufw allow 49160:49250/udp >/dev/null
  ok "เปิดพอร์ต 80, 443 (TCP), $SRT_PORTS (UDP รับ SRT), 3478 และ 49160–49250/UDP (TURN) ใน ufw แล้ว"
fi

# ------------------------------------------------------- 4b. Auto-update
# ทุกคืนตี 4 (สุ่มเวลาภายใน 40 นาที): ดึงโค้ดล่าสุด ไม่มีอะไรใหม่ก็จบ · มีใหม่ = ขั้นตอนเดียวกับการรันเอง (รอไลฟ์จบก่อนสลับ)
if [ "$AUTO_UPDATE" = 1 ] && command -v systemctl >/dev/null; then
  cat > /etc/systemd/system/webmix-update.service <<UNIT
[Unit]
Description=WebMix Stream Gateway — อัปเดตอัตโนมัติ (ไม่ตัดไลฟ์)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=AUTO_RUN=1 WAIT_MINUTES=360 INSTALL_DIR=$INSTALL_DIR REPO_URL=$REPO_URL${BRANCH:+ BRANCH=$BRANCH}
ExecStart=/bin/bash $INSTALL_DIR/server/deploy/install.sh
UNIT
  cat > /etc/systemd/system/webmix-update.timer <<UNIT
[Unit]
Description=WebMix Stream Gateway — ตรวจเวอร์ชันใหม่ทุกคืน

[Timer]
OnCalendar=*-*-* 04:00
RandomizedDelaySec=40min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload && systemctl enable --now webmix-update.timer >/dev/null 2>&1 \
    && ok "อัปเดตอัตโนมัติทุกคืน (ตี 4) — ปิดได้ด้วย AUTO_UPDATE=0" || true
elif [ "$AUTO_UPDATE" != 1 ] && [ -f /etc/systemd/system/webmix-update.timer ]; then
  systemctl disable --now webmix-update.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/webmix-update.service /etc/systemd/system/webmix-update.timer
  systemctl daemon-reload || true
  ok "ปิดการอัปเดตอัตโนมัติแล้ว"
fi

# ---------------------------------------------------------------- 5. Start
say "สร้าง Gateway เวอร์ชันนี้ (ครั้งแรกใช้เวลาประมาณ 2–4 นาที — ไลฟ์ที่ออกอากาศอยู่ไม่สะดุด)"
docker compose build -q

# อัปเดตเครื่องที่มี Gateway ทำงานอยู่: หยุดรับไลฟ์ใหม่ (drain) แล้วรอไลฟ์เดิมจบก่อนสลับ
health() { docker compose exec -T gateway node -e "require('http').get('http://127.0.0.1:'+process.env.PORT,r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>process.stdout.write(b))}).on('error',()=>{})" 2>/dev/null || true; }
if [ -n "$(docker compose ps -q gateway 2>/dev/null)" ] && [ -z "$FORCE" ]; then
  docker compose exec -T gateway sh -c 'touch "$(dirname "$USERS_FILE")/drain"' 2>/dev/null || true
  END=$(( $(date +%s) + WAIT_MINUTES * 60 )); SHOWN=""
  while :; do
    LIVE="$(health | sed -n 's/.*OK (\([0-9]*\) streams, \([0-9]*\) SRT inputs).*/\1 \2/p')"
    [ -z "$LIVE" ] && break                                  # Gateway เดิมไม่ตอบ — สลับได้เลย
    STREAMS="${LIVE% *}"; INPUTS="${LIVE#* }"
    [ "$STREAMS" = 0 ] && [ "$INPUTS" = 0 ] && break
    if [ "$(date +%s)" -ge "$END" ]; then
      say "รอครบ $WAIT_MINUTES นาทีแล้วยังมีไลฟ์ — สลับเลย (ไลฟ์จะหลุดแล้วต่อใหม่เองในไม่กี่วินาที)"; break
    fi
    if [ -z "$SHOWN" ]; then
      say "มีไลฟ์ออกอากาศอยู่ $STREAMS รายการ · รับ SRT $INPUTS สัญญาณ — หยุดรับไลฟ์ใหม่แล้ว รอให้จบก่อนอัปเดต (สูงสุด $WAIT_MINUTES นาที · FORCE=1 = ไม่รอ)"
      SHOWN=1
    fi
    sleep 30
  done
fi
say "เปิด Gateway เวอร์ชันใหม่"
docker compose up -d --remove-orphans

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
echo "หน้าผู้ดูแล:             https://$DOMAIN/admin#token=$STREAM_TOKEN"
echo "                         (เปิดลิงก์นี้แล้วเข้าได้เลย · รหัสอยู่หลัง # จึงไม่ถูกส่งไปที่เซิร์ฟเวอร์ · ดูรหัสอีกครั้ง: grep STREAM_TOKEN $INSTALL_DIR/server/deploy/.env)"
echo "                         ดูไลฟ์ทุกคน · เพิ่มคนพร้อมลิงก์เชิญ · แก้แพ็กเกจ · หยุดไลฟ์ · พักรับไลฟ์ใหม่"
[ -n "$ALERT_WEBHOOK$TELEGRAM_BOT_TOKEN" ] && echo "แจ้งเตือน:                เปิดแล้ว" || echo "แจ้งเตือน:                ยังไม่ได้ตั้ง (รันซ้ำพร้อม ALERT_WEBHOOK=... หรือ TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...)"
echo "ดู log:                  cd $INSTALL_DIR/server/deploy && docker compose logs -f gateway"
[ "$AUTO_UPDATE" = 1 ] && echo "อัปเดตเวอร์ชัน:           อัตโนมัติทุกคืน (หรือรันคำสั่งติดตั้งเดิมซ้ำเพื่ออัปเดตทันที)" || echo "อัปเดตเวอร์ชัน:           รันคำสั่งติดตั้งเดิมซ้ำ"
