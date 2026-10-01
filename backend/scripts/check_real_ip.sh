#!/usr/bin/env bash
# Backend nginx ko'rgan HAQIQIY klient IP'ni ko'rayotganini tekshiradi.
#
# Usul: soxta `X-Forwarded-For: 1.2.3.4` bilan noyob "marker" login urinishi
# yuboriladi. So'ng
#   (a) nginx access log'dan shu marker uchun remote addr,
#   (b) backend yozgan `login_attempts.ip`
# olinadi. Ikkalasi bir xil va 1.2.3.4 dan farqli bo'lishi shart.
#
# Ishlatish (serverda, tibex foydalanuvchisi yoki sudo bilan):
#   BASE_URL=https://tibex.uz ./scripts/check_real_ip.sh
# Talab: curl, psql (~/.pgpass 0600 orqali parol), nginx log'ni o'qish huquqi.
# Skript hech qanday sirni chop etmaydi.
set -euo pipefail

BASE_URL="${BASE_URL:-https://tibex.uz}"
NGINX_LOG="${NGINX_LOG:-/var/log/nginx/access.log}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-tibex}"
PGDATABASE="${PGDATABASE:-tibex}"
SPOOF="1.2.3.4"
MARK="ipcheck$(date +%s)$RANDOM"

fail() { echo "[XATO] $*" >&2; exit 1; }
command -v curl >/dev/null || fail "curl topilmadi"
command -v psql >/dev/null || fail "psql topilmadi"
[ -r "$NGINX_LOG" ] || fail "nginx log o'qilmaydi: $NGINX_LOG (NGINX_LOG ni belgilang yoki sudo ishlating)"

echo "[>] Soxta XFF=$SPOOF bilan marker so'rov yuborilmoqda ($MARK)"
curl -sS -o /dev/null -X POST "$BASE_URL/api/auth/login?ipcheck=$MARK" \
  -H "X-Forwarded-For: $SPOOF" -H "Content-Type: application/json" \
  -d "{\"username\":\"$MARK\",\"password\":\"x\"}" || true
sleep 1

NGINX_IP="$(grep -F "ipcheck=$MARK" "$NGINX_LOG" | tail -n1 | awk '{print $1}')"
[ -n "$NGINX_IP" ] || fail "nginx logida marker topilmadi"

BACKEND_IP="$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc \
  "SELECT ip FROM login_attempts WHERE username = '$MARK' ORDER BY id DESC LIMIT 1")"
[ -n "$BACKEND_IP" ] || fail "backend login_attempts da marker topilmadi"

echo "    nginx ko'rgan IP : $NGINX_IP"
echo "    backend yozgan IP: $BACKEND_IP"

[ "$BACKEND_IP" != "$SPOOF" ] || fail "backend soxta XFF ($SPOOF) ga ishondi — trusted_proxy_ips/tarmoqni tekshiring"
[ "$BACKEND_IP" = "$NGINX_IP" ] || fail "backend IP nginx IP'siga mos emas (hamma foydalanuvchi bitta proxy IP bo'lib qolgan bo'lishi mumkin)"

# Tozalash: marker qatorini o'chiramiz (audit jadvaliga tegmaymiz).
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -qc "DELETE FROM login_attempts WHERE username = '$MARK'" || true
echo "[OK] Backend haqiqiy klient IP'ni ko'ryapti."
