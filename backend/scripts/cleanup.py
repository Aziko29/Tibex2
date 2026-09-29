"""Eski yozuvlarni tozalash (kunlik). AUDIT jadvallariga TEGMAYDI.

    python -m scripts.cleanup [--dry-run]

sessions: muddati > 7 kun o'tgan yoki bekor qilingan (7 kundan eski)
login_attempts: > 30 kun · otp_codes: > 1 kun
"""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config import get_settings
from app.models import LoginAttempt, OTPCode, Session

now = lambda: datetime.now(timezone.utc)  # noqa: E731


def _rules():
    d = lambda n: now() - timedelta(days=n)  # noqa: E731
    return [
        (Session, (Session.expires_at < d(7)) | (Session.revoked_at < d(7))),
        (LoginAttempt, LoginAttempt.created_at < d(30)),
        (OTPCode, OTPCode.created_at < d(1)),
    ]


async def main(dry: bool) -> None:
    engine = create_async_engine(get_settings().database_url)
    try:
        async with AsyncSession(engine) as db:
            for model, cond in _rules():
                if dry:
                    n = (await db.execute(select(func.count()).select_from(model).where(cond))).scalar_one()
                else:
                    n = (await db.execute(delete(model).where(cond))).rowcount
                print(f"{model.__tablename__}: {n} {'topildi' if dry else 'o`chirildi'}")
            await db.commit()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    asyncio.run(main(ap.parse_args().dry_run))
