#!/usr/bin/env python3
"""Empty every TIBEX application table, preserving schema/migrations.

Run from backend/: python -m scripts.factory_reset --dry-run
Then, after reviewing the target and counts: python -m scripts.factory_reset
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db import Base
import app.models  # noqa: F401 — register every mapped application table.


def _target_label(url) -> str:
    host = url.host or "local socket"
    port = f":{url.port}" if url.port else ""
    return f"{host}{port}/{url.database or '(no database name)'}"


async def _run(dry_run: bool) -> int:
    settings = get_settings()
    if settings.is_prod:
        print("[X] Zavod reseti production muhitida taqiqlangan; hech narsa o'chirilmadi.")
        return 2
    url = make_url(settings.database_url)
    if url.get_backend_name() != "postgresql":
        print("[X] Zavod sozlamasiga qaytarish faqat PostgreSQL uchun yoqilgan.")
        return 2
    if not url.database:
        print("[X] Database nomi aniqlanmadi; hech narsa o'chirilmadi.")
        return 2

    tables = sorted(Base.metadata.tables.values(), key=lambda table: table.fullname)
    if not tables:
        print("[X] Ilova jadvallari topilmadi; hech narsa o'chirilmadi.")
        return 2

    engine = create_async_engine(settings.database_url, echo=False)
    try:
        async with engine.connect() as conn:
            counts = {}
            for table in tables:
                counts[table.fullname] = (
                    await conn.execute(select(func.count()).select_from(table))
                ).scalar_one()

            print("TIBEX zavod sozlamasiga qaytarish")
            print(f"Database: {_target_label(url)}")
            print(f"Ilova jadvallari: {len(tables)}")
            print("Topilgan yozuvlar:")
            for name, count in counts.items():
                print(f"  {name}: {count}")

            if dry_run:
                print("DRY RUN: ma'lumot o'chirilmadi.")
                return 0

            confirmation = f"DELETE ALL TIBEX DATA FROM {url.database}"
            print("\nDIQQAT: barcha ilova ma'lumotlari, sozlamalar, rollar va foydalanuvchilar o'chadi.")
            print("Zaxira nusxangiz borligini va yuqoridagi database to'g'ri ekanini tekshiring.")
            answer = input(f"Davom etish uchun aynan '{confirmation}' deb yozing: ").strip()
            if answer != confirmation:
                print("Bekor qilindi. Hech narsa o'chirilmadi.")
                return 1

            preparer = conn.dialect.identifier_preparer
            quoted_tables = []
            for table in tables:
                table_name = preparer.quote(table.name)
                if table.schema:
                    table_name = f"{preparer.quote_schema(table.schema)}.{table_name}"
                quoted_tables.append(table_name)

            async with engine.begin() as txn:
                await txn.execute(text(
                    "TRUNCATE TABLE " + ", ".join(quoted_tables)
                    + " RESTART IDENTITY CASCADE"
                ))

        print("\nIlova jadvallari tozalandi. Migration sxemasi saqlandi.")
        print("Yangi standart rollar va smenani yaratish uchun:")
        print("  python -m scripts.init_db")
        print("So'ng yangi administrator yarating:")
        print('  python -m scripts.create_admin --login admin --password "YANGI_KUCHLI_PAROL" --name "Administrator"')
        return 0
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="jadval va yozuvlar sonini ko'rsatadi, hech narsa o'chirmaydi",
    )
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(_run(args.dry_run)))


if __name__ == "__main__":
    main()
