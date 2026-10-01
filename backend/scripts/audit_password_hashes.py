#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Parol hashlarini ma'lumotlar bazasi bilan solishtirib tekshiradi (FAQAT O'QISH, hech narsa o'zgartirmaydi).

Tekshiradi:
  1. users.password_hash ustunining HAQIQIY uzunligi >= joriy Argon2id hash uzunligi;
  2. har bir akkaunt hashi formati: argon2id / pbkdf2 (eski) / yaroqsiz (kirib bo'lmaydi);
  3. Argon2 parametrlari joriy sozlamaga mosmi (mos bo'lmasa kirishda avtomatik yangilanadi).

Parol, hash va pepper chop etilmaydi - faqat login va holat.

    python -m scripts.audit_password_hashes
Chiqish kodi: 0 - hammasi joyida; 1 - kirib bo'lmaydigan hash yoki ustun juda tor.
"""
from __future__ import annotations

import asyncio
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, select

import app.db as _db
from app.models import User
from app.security import passwords as P


def classify(stored: str | None) -> str:
    """'argon2id' | 'argon2-old-params' | 'pbkdf2' | 'invalid'."""
    if not stored:
        return "invalid"
    if stored.startswith("$argon2id$"):
        try:
            return "argon2-old-params" if P._ph.check_needs_rehash(stored) else "argon2id"
        except Exception:
            return "invalid"
    if stored.startswith("$argon2"):  # argon2i/argon2d - tavsiya etilmaydi, kirishda Argon2id ga o'tadi
        return "argon2-old-params"
    if stored.startswith("$pbkdf2-sha256$") and len(stored.split("$")) == 5:
        return "pbkdf2"
    return "invalid"


async def audit() -> int:
    _db._init()
    engine, SessionLocal = _db._engine, _db._SessionLocal
    if engine is None or SessionLocal is None:
        raise RuntimeError("DB ulanishi yaratilmadi - .env ni tekshiring")

    problems = 0
    sample = P.hash_password("Audit#Sample-2026x")
    need = len(sample)

    async with engine.connect() as conn:
        cols = await conn.run_sync(lambda c: inspect(c).get_columns("users"))
    col = next((c for c in cols if c["name"] == "password_hash"), None)
    real_len = getattr(col["type"], "length", None) if col else None
    print(f"users.password_hash: haqiqiy turi = {col['type'] if col else 'TOPILMADI'}")
    print(f"  model uzunligi = {P.DB_HASH_COLUMN_LENGTH}, joriy Argon2id hash = {need} belgi")
    if col is None:
        print("  [X] ustun topilmadi - alembic upgrade head bajarilganmi?")
        problems += 1
    elif real_len is not None and real_len < need:
        print(f"  [X] ustun juda tor ({real_len} < {need}): hash kesilib qoladi. ALTER ... TYPE VARCHAR({P.DB_HASH_COLUMN_LENGTH})")
        problems += 1
    elif real_len is not None and real_len != P.DB_HASH_COLUMN_LENGTH:
        print(f"  [!] ustun uzunligi modeldan farq qiladi ({real_len} != {P.DB_HASH_COLUMN_LENGTH}) - alembic holatini tekshiring")
    else:
        print("  [OK] ustun hashga yetarli")

    async with SessionLocal() as s:
        rows = (await s.execute(select(User.id, User.login, User.role_key, User.active, User.password_hash))).all()

    kinds: Counter[str] = Counter()
    longest = 0
    for uid, login, role, active, stored in rows:
        kind = classify(stored)
        kinds[kind] += 1
        longest = max(longest, len(stored or ""))
        if kind == "invalid":
            # Bemor akkauntlari parol bilan kirmaydi (OTP) - ular uchun bu xato emas.
            if role != "patient":
                problems += 1
                print(f"  [X] #{uid} {login} ({role}{'' if active else ', nofaol'}): hash yaroqsiz - parolni tiklang")
        elif kind != "argon2id":
            print(f"  [i] #{uid} {login}: {kind} - keyingi muvaffaqiyatli kirishda avtomatik yangilanadi")

    print()
    print(f"Jami akkaunt: {len(rows)}; eng uzun hash: {longest} belgi")
    for k in ("argon2id", "argon2-old-params", "pbkdf2", "invalid"):
        print(f"  {k:18s} {kinds.get(k, 0)}")
    peppers = len(P._peppers())
    print(f"Pepper: joriy + {peppers - 1} ta eski")
    if peppers > 1:
        print("  [i] Barcha akkaunt yangi pepperga ko'chgach TIBEX_PASSWORD_PEPPER_OLD ni olib tashlang")
    print("NATIJA:", "[OK]" if not problems else f"[X] {problems} ta muammo")
    await engine.dispose()
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(audit()))
