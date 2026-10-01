#!/usr/bin/env bash
# deploy/nginx.conf ni `nginx -t` bilan tekshiradi va 3 ta CSP nusxasi bir xilligini kafolatlaydi.
#
# nginx.conf http{} kontekstiga include qilinadigan fayl, shuning uchun uni to'liq nginx.conf ichiga
# o'rab tekshiramiz. TLS sertifikatlari (/etc/letsencrypt/...) CI'da yo'q: vaqtinchalik self-signed
# sertifikat yaratiladi. Docker bo'lsa nginx konteynerda, bo'lmasa lokal `nginx` binarysi ishlatiladi.
#
# Ishlatish (repo ildizidan):  bash backend/deploy/check_nginx.sh
# Muhit:  NGINX_IMAGE (default nginx:1.27-alpine)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$HERE/nginx.conf"
IMAGE="${NGINX_IMAGE:-nginx:1.27-alpine}"
DOMAIN="tibex.uz"

[ -f "$CONF" ] || { echo "nginx.conf topilmadi: $CONF" >&2; exit 1; }

# ── 1) CSP nusxalari bir xil bo'lishi shart (3 joyda takrorlangan; biri o'zgarib qolsa, sahifa ishlamay qoladi)
mapfile -t CSPS < <(grep -oE 'add_header Content-Security-Policy "[^"]*"' "$CONF" | sort -u)
COUNT="$(grep -cE 'add_header Content-Security-Policy ' "$CONF" || true)"
if [ "$COUNT" -lt 1 ]; then
  echo "FAIL: nginx.conf da Content-Security-Policy yo'q" >&2; exit 1
fi
if [ "${#CSPS[@]}" -ne 1 ]; then
  echo "FAIL: $COUNT ta CSP sarlavhasi ${#CSPS[@]} xil qiymatga ega (kutilgan: 1):" >&2
  printf '  %s\n' "${CSPS[@]}" >&2
  exit 1
fi
echo "OK: $COUNT ta CSP nusxasi bir xil"

# ── 2) nginx -t
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$DOMAIN" \
  -keyout "$TMP/certs/privkey.pem" -out "$TMP/certs/fullchain.pem" >/dev/null 2>&1
chmod 644 "$TMP/certs/"*.pem   # konteyner ichidagi nginx (boshqa uid) o'qiy olishi uchun

cat > "$TMP/nginx.wrapper.conf" <<'EOF'
pid /tmp/nginx-test.pid;
error_log /dev/stderr warn;
events { worker_connections 64; }
http {
    include /etc/nginx/mime.types;
    include /etc/nginx/tibex.conf;
}
EOF

if command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$CONF:/etc/nginx/tibex.conf:ro" \
    -v "$TMP/nginx.wrapper.conf:/etc/nginx/nginx.wrapper.conf:ro" \
    -v "$TMP/certs:/etc/letsencrypt/live/$DOMAIN:ro" \
    "$IMAGE" nginx -t -c /etc/nginx/nginx.wrapper.conf
elif command -v nginx >/dev/null 2>&1; then
  # Lokal nginx: sertifikat yo'li nginx.conf da qat'iy (/etc/letsencrypt/live/...), shuning uchun
  # konfigning nusxasida yo'llarni vaqtinchalik sertifikatga almashtiramiz.
  sed -e "s#/etc/letsencrypt/live/$DOMAIN/fullchain.pem#$TMP/certs/fullchain.pem#" \
      -e "s#/etc/letsencrypt/live/$DOMAIN/privkey.pem#$TMP/certs/privkey.pem#" "$CONF" > "$TMP/tibex.conf"
  MIME="$(nginx -V 2>&1 | grep -o -- '--conf-path=[^ ]*' | cut -d= -f2 | xargs dirname 2>/dev/null || echo /etc/nginx)/mime.types"
  sed -e "s#/etc/nginx/tibex.conf#$TMP/tibex.conf#" -e "s#/etc/nginx/mime.types#$MIME#" \
      "$TMP/nginx.wrapper.conf" > "$TMP/wrapper.local.conf"
  nginx -t -c "$TMP/wrapper.local.conf"
else
  echo "FAIL: na docker, na nginx topildi. Ulardan birini o'rnating." >&2
  exit 2
fi
echo "OK: nginx -t"
