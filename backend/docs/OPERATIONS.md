# TIBEX — Operatsiyalar

## Kuzatuv
- **Log:** strukturaviy JSON (`TIBEX_LOG_JSON=true`), har qatorda `request_id`; javobda `X-Request-ID`.
  `journalctl -u tibex -o cat | jq 'select(.request_id=="...")'`. Fayl log bo'lsa `deploy/tibex-logrotate` (`/etc/logrotate.d/`).
- **Metrikalar:** `GET /metrics` (Prometheus matni) faqat `TIBEX_METRICS_TOKEN` bilan (Bearer); bo'sh bo'lsa 404.
  Nginx `/metrics` ni tashqariga proksi qilmaydi — faqat `127.0.0.1:8000` dan skreyp qiling.
- **Sentry (ixtiyoriy):** `pip install sentry-sdk` va `TIBEX_SENTRY_DSN`. `send_default_pii=False`.
- Xotiradagi xato buferi (`/api/monitoring/errors`) qayta ishga tushganda tozalanadi — doimiy kuzatuv uchun Sentry/log ishlating.

## Uptime va alert
`scripts/uptime_check.sh` — cron `*/2 * * * *`, env: `ALERT_BOT_TOKEN_FILE` (alohida alert boti tokeni fayli, 0600),
`ALERT_CHAT_ID` (admin chat). Holat o'zgarganda (tushdi/tiklandi) bitta xabar yuboradi.

## Incident javobi
1. `curl -i https://tibex.uz/api/health` (503 = DB yoki Redis).  2. `journalctl -u tibex -n 200`.
3. Shubhali kirish: `GET /api/audit/verify`, sessiyalarni bekor qilish (SECRET_KEY rotatsiyasi — `ROTATION.md`).
4. Ma'lumot buzilsa: `docs/BACKUP.md` bo'yicha tiklash; audit zanjirini `python -m scripts.verify_audit` bilan tekshiring.

## Kalit yo'qolsa
Master kalit yo'qolsa shifrlangan PHI ustunlari **qaytarilmaydi**. Shuning uchun kalitlar zaxira nusxadan alohida saqlanadi (`BACKUP.md`, escrow).

## Rejalashtirilgan ishlar
`tibex-cleanup.timer` (kunlik, `scripts/cleanup.py`), `tibex-restore-drill.timer` (oylik).
```
cp deploy/tibex-cleanup.* /etc/systemd/system/ && systemctl enable --now tibex-cleanup.timer
```
