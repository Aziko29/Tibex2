import asyncio
import app.db as db
from sqlalchemy import text, select
from app.models import Patient


async def main():
    db._init()
    SessionLocal = db._SessionLocal
    if SessionLocal is None:
        print("XATO: _SessionLocal None")
        return
    async with SessionLocal() as s:
        # Bitta bemorni o'qib ko'ramiz
        p = (await s.execute(select(Patient).limit(1))).scalar_one_or_none()
        if p is None:
            print("Bemor topilmadi")
            return
        print("=== BEMOR MA'LUMOTLARI ===")
        print(f"ID:        {p.id}")
        try:
            print(f"fullname:  {p.fullname}")
        except Exception as e:
            print(f"fullname:  XATO: {type(e).__name__}: {str(e)[:100]}")
        try:
            print(f"phone_enc: {p.phone_enc}")
        except Exception as e:
            print(f"phone_enc: XATO: {type(e).__name__}: {str(e)[:100]}")
        try:
            print(f"address:   {p.address}")
        except Exception as e:
            print(f"address:   XATO: {type(e).__name__}: {str(e)[:100]}")
        try:
            print(f"age:       {p.age}")
        except Exception as e:
            print(f"age:       XATO: {type(e).__name__}: {str(e)[:100]}")


asyncio.run(main())