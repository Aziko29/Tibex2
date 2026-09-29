#!/usr/bin/env python3
"""Admin yaratish (argument orqali, interaktiv emas).

Ishlatish (kuchli, noyob parol bilan):
    python -m scripts.create_admin --login admin --password "<kuchli-parol>" --name "Admin"
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from app import db
from app.models import Role, User
from app.security.passwords import check_password_strength, hash_password


async def create(login: str, password: str, fullname: str, phone: str = ""):
    strong, reason = check_password_strength(password)
    if not strong:
        print(f"  [X] {reason}")
        return False

    db._init()
    assert db._SessionLocal is not None
    async with db._SessionLocal() as session:
        role = (await session.execute(select(Role).where(Role.key == "admin"))).scalar_one_or_none()
        if role is None:
            print("  [X] 'admin' roli topilmadi - avval init_db ishga tushiring")
            return False

        existing = (await session.execute(select(User).where(User.login == login))).scalar_one_or_none()
        if existing is not None:
            existing.password_hash = hash_password(password)
            existing.fullname = fullname
            existing.active = True
            await session.commit()
            print(f"  [+] '{login}' paroli yangilandi")
            return True

        session.add(User(
            fullname=fullname,
            login=login,
            password_hash=hash_password(password),
            role_key="admin",
            phone=phone or None,
            active=True,
        ))
        await session.commit()
        print(f"  [+] Admin yaratildi: {login} / {fullname}")
        return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--login",    required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name",     default="Administrator")
    ap.add_argument("--phone",    default="")
    args = ap.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    ok = asyncio.run(create(args.login, args.password, args.name, args.phone))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
