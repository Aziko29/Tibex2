#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mavjud parollarni yangi pepper bilan qayta xeshlaydi."""
from __future__ import annotations

import asyncio
import getpass
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

import app.db as _db  # auto-fix: _SessionLocal snapshot bug'ini tuzatadi
from app.models import User
from app.security.passwords import hash_password
from app.config import get_settings


async def reset_all(new_password: str) -> int:
    _db._init()
    SessionLocal = _db._SessionLocal
    if SessionLocal is None:
        raise RuntimeError("DB session yaratilmadi - .env ni tekshiring")

    count = 0
    now = datetime.now(timezone.utc)
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
        for u in users:
            u.password_hash = hash_password(new_password)
            u.session_valid_after = now
            count += 1
        await s.commit()
    return count


def main() -> int:
    if get_settings().is_prod:
        print("[XATO] Barcha parollarni ommaviy almashtirish production muhitida taqiqlangan.")
        return 2
    print("=" * 60)
    print("  Barcha foydalanuvchilar parolini qayta xeshlash")
    print("=" * 60)
    print("  [!] Bu barcha parollarni bir xil vaqtinchalik parolga o'zgartiradi")
    print("  [!] Har bir xodim keyin o'z parolini yangilashi kerak")
    print()
    pwd = getpass.getpass("  Vaqtinchalik parol (>= 8 belgi): ").strip()
    if len(pwd) < 8:
        print("[XATO] Kamida 8 belgi")
        return 1
    pwd2 = getpass.getpass("  Tasdiqlang: ").strip()
    if pwd != pwd2:
        print("[XATO] Parollar mos kelmadi")
        return 1
    n = asyncio.run(reset_all(pwd))
    print()
    print("=" * 60)
    print(f"  [OK] {n} ta foydalanuvchi paroli yangilandi")
    print("  Barcha eski sessiyalar bekor qilindi (session_valid_after)")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
