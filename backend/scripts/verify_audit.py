"""Audit zanjirini boshidan qayta hisoblaydi.

    python -m scripts.verify_audit [--from-id N]

Chiqish kodi: 0 — zanjir yaroqli, 1 — buzilgan (birinchi buzilgan id chop etiladi).
"""
import argparse
import asyncio
import sys

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config import get_settings
from app.security.audit import verify_audit_chain


async def main(from_id: int | None) -> int:
    engine = create_async_engine(get_settings().database_url)
    try:
        async with AsyncSession(engine) as db:
            res = await verify_audit_chain(db, from_id)
    finally:
        await engine.dispose()
    print(res)
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-id", type=int, default=None)
    sys.exit(asyncio.run(main(ap.parse_args().from_id)))
