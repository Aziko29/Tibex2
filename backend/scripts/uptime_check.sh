#!/usr/bin/env bash
# Uptime tekshiruv (cron: */2 * * * *). Xatoda admin Telegram chatiga xabar yuboradi.
# Env: TIBEX_HEALTH_URL (default https://tibex.uz/api/health), ALERT_BOT_TOKEN_FILE, ALERT_CHAT_ID
set -u
URL="${TIBEX_HEALTH_URL:-https://tibex.uz/api/health}"
STATE=/tmp/tibex_uptime_state
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL" || echo 000)
if [ "$code" = "200" ]; then
  [ -f "$STATE" ] && rm -f "$STATE" && MSG="TIBEX tiklandi ($URL)" || exit 0
else
  [ -f "$STATE" ] && exit 0
  touch "$STATE"; MSG="TIBEX ISHLAMAYAPTI: HTTP $code ($URL)"
fi
if [ -n "${ALERT_BOT_TOKEN_FILE:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
  curl -s -m 10 "https://api.telegram.org/bot$(cat "$ALERT_BOT_TOKEN_FILE")/sendMessage" \
    --data-urlencode "chat_id=$ALERT_CHAT_ID" --data-urlencode "text=$MSG" >/dev/null
fi
echo "$MSG"
