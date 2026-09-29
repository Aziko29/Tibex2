"""Eskirgan audit yozuvlarini eksport qilish (superuser DB rol bilan).

Audit jadvallarida UPDATE/DELETE trigger bilan taqiqlangan. Bu skript faqat
DB superuser/egasi tomonidan, rejalashtirilgan saqlash muddati o'tgan
yozuvlarni EKSPORT qiladi (JSONL). O'chirish — qo'lda, quyidagi tartibda:

    1) python -m scripts.audit_archive --older-than-days 730 --out /var/backups/tibex/audit-YYYY.jsonl
    2) fayl SHA256 va offsite nusxasini tekshiring
    3) superuser sifatida: ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_mod;
       DELETE FROM audit_logs WHERE id <= <chiqarilgan max id>;  ALTER TABLE ... ENABLE TRIGGER ...;
       (zanjir uzilmasligi uchun eng eski qatorlarni olib tashlashdan oldin
       verify_audit --from-id <keyingi id> ishlatiladi)

Muddat siyosati: docs/SECURITY.md (audit_logs kamida 2 yil, arxiv 5 yil).
Env: TIBEX_ADMIN_DATABASE_URL (superuser) — bo'lmasa TIBEX_DATABASE_URL.
"""
import argparse
import asyncio
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


async def main(days: int, out: str) -> None:
    url = os.environ.get("TIBEX_ADMIN_DATABASE_URL") or os.environ["TIBEX_DATABASE_URL"]
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    engine = create_async_engine(url)
    n, max_id = 0, 0
    h = hashlib.sha256()
    try:
        async with engine.connect() as conn, open(out, "w", encoding="utf-8") as f:
            res = await conn.stream(
                text("SELECT * FROM audit_logs WHERE created_at < :c ORDER BY id"), {"c": cutoff}
            )
            async for row in res:
                line = json.dumps(dict(row._mapping), default=str, ensure_ascii=False) + "\n"
                f.write(line)
                h.update(line.encode())
                n += 1
                max_id = row._mapping["id"]
    finally:
        await engine.dispose()
    os.chmod(out, 0o600)
    print(f"{n} qator eksport qilindi; max_id={max_id}; sha256={h.hexdigest()}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--older-than-days", type=int, default=730)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    asyncio.run(main(a.older_than_days, a.out))
