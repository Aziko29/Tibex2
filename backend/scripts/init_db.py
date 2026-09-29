"""System rollarini va boshlang'ich smenani yaratadi.

Ishga tushirish:
    python -m scripts.init_db
"""
import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import Role, Shift


SYSTEM_ROLES = [
    {
        "key": "superadmin",
        "name": "Super Administrator",
        "icon": "👑",
        "color": "admin",
        "description": "Tizimning eng yuqori darajali administratori.",
        "permissions": "*",
        "system": True,
    },
    {
        "key": "admin",
        "name": "Administrator",
        "icon": "🛡",
        "color": "admin",
        "description": "Tizimning to'liq nazoratchisi.",
        "permissions": "*",
        "system": True,
    },
    {
        "key": "doctor",
        "name": "Shifokor",
        "icon": "👨‍⚕️",
        "color": "doctor",
        "description": "Qabul o'tkazadi, tashxis qo'yadi, retsept yozadi.",
        "permissions": [
            "patients.view",
            "appointments.view", "appointments.edit",
            "medical.view", "medical.edit_diagnosis", "medical.edit_prescription",
            "lab.view", "lab.create",
            "services.view", "equipment.view", "reagents.view",
        ],
        "system": True,
    },
    {
        "key": "reception",
        "name": "Qabulxona xodimi",
        "icon": "🏥",
        "color": "reception",
        "description": "Bemorlarni ro'yxatga oladi, qabul band qiladi.",
        "permissions": [
            "patients.view", "patients.create", "patients.edit",
            "appointments.view", "appointments.create", "appointments.edit",
            "doctors.view", "services.view",
            "payments.view", "payments.create",
            "audit.view",
        ],
        "system": True,
    },
    {
        "key": "cashier",
        "name": "Kassir",
        "icon": "💰",
        "color": "cashier",
        "description": "To'lovlarni qabul qiladi, chek chiqaradi.",
        "permissions": [
            "patients.view", "appointments.view",
            "payments.view", "payments.create", "payments.refund", "payments.close_shift",
            "services.view", "reports.view", "audit.view",
        ],
        "system": True,
    },
    {
        "key": "lab",
        "name": "Laborant",
        "icon": "🔬",
        "color": "lab",
        "description": "Lab so'rovlarni bajaradi, natija kiritadi.",
        "permissions": [
            "patients.view", "appointments.view",
            "lab.view", "lab.create", "lab.edit", "lab.verify",
            "equipment.view", "equipment.edit",
            "reagents.view", "reagents.edit",
        ],
        "system": True,
    },
    {
        "key": "patient",
        "name": "Bemor",
        "icon": "👤",
        "color": "patient",
        "description": "O'z tibbiy yozuvlarini ko'radi va profilini tahrirlaydi.",
        "permissions": [
            "portal.view",
            "portal.edit_profile",
            "portal.change_password",
            "portal.view_appointments",
            "portal.view_lab",
            "portal.view_payments",
        ],
        "system": True,
    },
]


async def init_db():
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    async with SessionLocal() as db:
        print("Rollar tekshirilmoqda...")
        created_roles = 0
        for r in SYSTEM_ROLES:
            existing = (
                await db.execute(select(Role).where(Role.key == r["key"]))
            ).scalar_one_or_none()
            if existing is None:
                db.add(Role(**r, active=True))
                created_roles += 1
                print(f"  + {r['key']:<12} ({r['name']})")
            else:
                print(f"  = {r['key']:<12} (mavjud)")
        await db.flush()

        shift = (
            await db.execute(select(Shift).order_by(Shift.id.desc()).limit(1))
        ).scalar_one_or_none()
        if shift is None:
            db.add(Shift(open=True, opened_by="System", opening_balance=0))
            print("  + Smena ochildi")
        else:
            print(f"  = Smena mavjud (open={shift.open})")

        await db.commit()

        role_count = (
            await db.execute(select(func.count()).select_from(Role))
        ).scalar_one()

        print()
        print("=" * 60)
        print("  Natija")
        print("=" * 60)
        print(f"  Rollar:              {role_count}")
        print(f"  Yangi qo'shilgan:    {created_roles}")
        print()
        print("  Endi admin yaratish uchun:")
        print("    python -m scripts.create_admin --login admin --password '<kuchli-parol>' --name Administrator")
        print("=" * 60)

    await engine.dispose()


def main():
    asyncio.run(init_db())


if __name__ == "__main__":
    main()
