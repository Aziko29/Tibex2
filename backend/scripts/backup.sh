#!/usr/bin/env bash
# TIBEX zaxira: pg_dump -Fc -> age (alohida backup kaliti) -> SHA256 -> local + offsite -> saqlash muddati.
# Sozlamalar /etc/tibex/backup.env (0600) yoki muhitdan:
#   TIBEX_BACKUP_PUBKEY   (majburiy)  age public key (age1...) — master kalit/pepper'dan HOSIL QILINMAGAN
#   TIBEX_BACKUP_DIR      (/var/backups/tibex)   TIBEX_BACKUP_KEEP_DAYS (30)
#   TIBEX_OFFSITE         (ixtiyoriy) masalan  rclone:remote:tibex  yoki  rsync:user@host:/backups/tibex
#   PGHOST(127.0.0.1) PGUSER(tibex) PGDATABASE(tibex)  — parol ~/.pgpass (0600) dan olinadi
set -euo pipefail
[ -r /etc/tibex/backup.env ] && . /etc/tibex/backup.env
: "${TIBEX_BACKUP_PUBKEY:?TIBEX_BACKUP_PUBKEY kerak (age public key)}"
DIR="${TIBEX_BACKUP_DIR:-/var/backups/tibex}"; KEEP="${TIBEX_BACKUP_KEEP_DAYS:-30}"
export PGHOST="${PGHOST:-127.0.0.1}" PGUSER="${PGUSER:-tibex}" PGDATABASE="${PGDATABASE:-tibex}"
umask 077; mkdir -p "$DIR"; chmod 700 "$DIR"
OUT="$DIR/tibex_$(date +%Y-%m-%d_%H%M).dump.age"
pg_dump -Fc | age -r "$TIBEX_BACKUP_PUBKEY" -o "$OUT"
( cd "$DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
case "${TIBEX_OFFSITE:-}" in
  rclone:*) rclone copy "$OUT" "${TIBEX_OFFSITE#rclone:}" && rclone copy "$OUT.sha256" "${TIBEX_OFFSITE#rclone:}" ;;
  rsync:*)  rsync -a "$OUT" "$OUT.sha256" "${TIBEX_OFFSITE#rsync:}/" ;;
  "")       echo "[tibex-backup] OGOHLANTIRISH: TIBEX_OFFSITE sozlanmagan — faqat mahalliy nusxa" >&2 ;;
  *)        echo "[tibex-backup] noma'lum TIBEX_OFFSITE" >&2; exit 1 ;;
esac
find "$DIR" -name 'tibex_*.dump.age*' -mtime +"$KEEP" -delete
echo "[$(date)] Backup tugadi: $OUT" >> /var/log/tibex-backup.log
