#!/usr/bin/env bash
# Tiklash mashqi: vaqtinchalik bazaga tiklaydi, qatorlar sonini solishtiradi,
# bitta shifrlangan qatorni master kalit bilan deshifrlaydi va audit zanjirini tekshiradi.
# Foydalanish: TIBEX_BACKUP_IDENTITY=... scripts/restore_drill.sh [backup.dump.age]  (backend/ ildizidan)
set -euo pipefail
DIR="${TIBEX_BACKUP_DIR:-/var/backups/tibex}"
FILE="${1:-$(ls -1t "$DIR"/tibex_*.dump.age | head -1)}"
export PGHOST="${PGHOST:-127.0.0.1}" PGUSER="${PGUSER:-tibex}"
LIVE="${PRODUCTION_DB:-tibex}"; TMP="tibex_drill_$(date +%s)"
trap 'dropdb --if-exists "$TMP" || true' EXIT
createdb "$TMP"
bash "$(dirname "$0")/restore.sh" "$FILE" "$TMP"
FAIL=0
for t in users patients appointments lab_orders payments audit_logs; do
  a=$(psql -Atc "SELECT count(*) FROM $t" "$LIVE"); b=$(psql -Atc "SELECT count(*) FROM $t" "$TMP")
  # zaxira eskiroq bo'lgani uchun tiklangan son jonli sondan KO'P bo'lmasligi va > 0 bo'lishi kerak
  echo "$t: jonli=$a tiklangan=$b"
  if [ "$b" -gt "$a" ]; then echo "XATO: $t tiklangan > jonli"; FAIL=1; fi
done
[ "$(psql -Atc 'SELECT count(*) FROM patients' "$TMP")" -gt 0 ] || { echo "XATO: bemorlar 0"; FAIL=1; }
unset TIBEX_DATABASE_URL_FILE  # _FILE env URL ni bosib ketadi
export TIBEX_DATABASE_URL="postgresql+asyncpg://${PGUSER}@${PGHOST}/${TMP}"
python - <<'PY' || FAIL=1
import asyncio, os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.security.crypto import _ring
async def main():
    e = create_async_engine(os.environ["TIBEX_DATABASE_URL"])
    async with e.connect() as c:
        r = (await c.execute(text("SELECT phone_enc FROM patients WHERE phone_enc IS NOT NULL LIMIT 1"))).first()
    await e.dispose()
    if r is None: print("shifrlangan qator yo'q (o'tkazib yuborildi)"); return
    _ring.decrypt(r[0], "patients.phone_enc"); print("shifrlangan qator deshifrlandi: OK")
asyncio.run(main())
PY
python -m scripts.verify_audit || FAIL=1
[ "$FAIL" = 0 ] && echo "RESTORE DRILL: MUVAFFAQIYATLI" || { echo "RESTORE DRILL: XATO"; exit 1; }
