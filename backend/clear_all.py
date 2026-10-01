import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.config import get_settings

TABLES = [
    "users", "sessions", "login_attempts", "doctors", "services",
    "patients", "appointments", "lab_orders", "payments", "refunds",
    "shifts", "equipment", "reagents", "integrations",
    "otp_codes", "telegram_link_tokens", "system_settings",
]


async def main():
    engine = create_async_engine(get_settings().database_url)
    async with engine.begin() as conn:
        print("Hozirgi yozuvlar soni:")
        for t in TABLES:
            n = (await conn.execute(text(f"SELECT count(*) FROM {t}"))).scalar_one()
            print(f"  {t}: {n}")
        if input("\nBUTUN ma'lumotni o'chirish uchun DA deb yozing: ").strip() != "DA":
            print("Bekor qilindi. Hech narsa o'chirilmadi.")
            return
        await conn.execute(
            text("TRUNCATE TABLE " + ", ".join(TABLES) + " RESTART IDENTITY CASCADE")
        )
        print("Tayyor: barcha ma'lumotlar tozalandi.")
    await engine.dispose()


asyncio.run(main())