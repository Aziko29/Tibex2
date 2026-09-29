#!/usr/bin/env bash
# Foydalanish: TIBEX_BACKUP_IDENTITY=/path/age-key.txt scripts/restore.sh <file.dump.age> <maqsad_baza>
# MAQSAD BAZA bo'sh/vaqtinchalik bo'lishi shart (mavjud bazani ustiga yozmaydi).
set -euo pipefail
FILE="${1:?fayl}"; TARGET="${2:?maqsad baza nomi}"
: "${TIBEX_BACKUP_IDENTITY:?age maxfiy kalit fayli kerak}"
export PGHOST="${PGHOST:-127.0.0.1}" PGUSER="${PGUSER:-tibex}"
[ "$TARGET" = "${PRODUCTION_DB:-tibex}" ] && { echo "Ishlab turgan bazaga tiklash taqiqlangan" >&2; exit 2; }
[ -f "$FILE.sha256" ] && ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" )
age -d -i "$TIBEX_BACKUP_IDENTITY" "$FILE" | pg_restore --no-owner --exit-on-error -d "$TARGET"
echo "Tiklandi: $TARGET"
