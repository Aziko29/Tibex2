"""Re-encrypt versioned encrypted columns in bounded transactions.

Examples:
    python -m scripts.reencrypt --dry-run
    python -m scripts.reencrypt --batch 500

Run during a maintenance window after backing up the database and installing
all old and new master keys in TIBEX_MASTER_KEYS_FILE.
"""
import argparse
import asyncio
import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db import Base
from app import models  # noqa: F401 - register ORM metadata
from app.security.crypto import DecryptionError, EncryptedJSON, EncryptedString, EncryptedText, _ring

log = logging.getLogger("tibex.reencrypt")


def encrypted_columns():
    encrypted_types = (EncryptedString, EncryptedText, EncryptedJSON)
    for table in Base.metadata.sorted_tables:
        primary_keys = list(table.primary_key.columns)
        if len(primary_keys) != 1:
            continue
        pk = primary_keys[0]
        for column in table.columns:
            if isinstance(column.type, encrypted_types):
                yield table, pk, column


async def run(dry_run: bool, batch_size: int) -> int:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    total_changed = 0
    try:
        _ring._ensure()
        assert _ring._keys is not None
        for table, pk, column in encrypted_columns():
            table_name, pk_name, col_name = table.name, pk.name, column.name
            last_pk = None
            changed = 0
            while True:
                where = f"WHERE {pk_name} > :last_pk" if last_pk is not None else ""
                select_sql = text(
                    f'SELECT "{pk_name}", "{col_name}" FROM "{table_name}" '
                    f'{where} ORDER BY "{pk_name}" LIMIT :batch_size'
                )
                async with engine.connect() as conn:
                    rows = (await conn.execute(select_sql, {
                        "last_pk": last_pk, "batch_size": batch_size,
                    } if last_pk is not None else {"batch_size": batch_size})).all()
                if not rows:
                    break
                updates = []
                for row in rows:
                    row_id, token = row[0], row[1]
                    last_pk = row_id
                    if token is None:
                        continue
                    try:
                        key_id = str(token).split(":", 1)[0]
                        needs_reencrypt = key_id != _ring.active_id
                        try:
                            plaintext = _ring.decrypt(token, column.type.context)
                        except DecryptionError:
                            plaintext = _ring.decrypt_legacy_aad(token, column.type.context)
                            needs_reencrypt = True
                        if needs_reencrypt:
                            updates.append({"new_value": _ring.encrypt(plaintext, column.type.context), "row_id": row_id})
                    except DecryptionError:
                        log.critical("Qayta shifrlash to'xtadi: %s.%s id=%s o'qilmadi", table_name, col_name, row_id)
                        raise
                if updates:
                    changed += len(updates)
                    if not dry_run:
                        async with engine.begin() as conn:
                            await conn.execute(
                                text(f'UPDATE "{table_name}" SET "{col_name}" = :new_value WHERE "{pk_name}" = :row_id'),
                                updates,
                            )
            total_changed += changed
            print(f"{table_name}.{col_name}: {changed} yozuv {'tekshiriladi' if dry_run else 'qayta shifrlanadi'}")
        print(f"Jami: {total_changed} yozuv {'qayta shifrlashga tayyor' if dry_run else 'qayta shifrlandi'}")
        return total_changed
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Shifrlangan DB ustunlarini kalit halqasi bilan yangilash")
    parser.add_argument("--dry-run", action="store_true", help="Faqat tekshiradi, DB'ga yozmaydi")
    parser.add_argument("--batch", type=int, default=500, help="Har batchdagi maksimal qator (1-5000)")
    args = parser.parse_args()
    if not 1 <= args.batch <= 5000:
        parser.error("--batch 1 dan 5000 gacha bo'lishi kerak")
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run(args.dry_run, args.batch))


if __name__ == "__main__":
    main()
