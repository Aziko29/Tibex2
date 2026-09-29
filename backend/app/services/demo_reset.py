"""TIBEX_FULL_DEMO_RESET_v1 — tizimni "0" demo holatiga qaytaruvchi umumiy mantiq.

Bitta joyda yozilgan va ikki yerdan ishlatiladi:
  1. `scripts/full_demo_reset.py`  — terminaldan qo'lda ishga tushirish uchun
  2. `app/routers/admin_danger.py` — admin panelidan (2 bosqichli himoya bilan)

Nima o'chiriladi (har doim):
  - Appointment, LabOrder, Refund, Payment, Patient — demo/test davomida
    to'plangan BIZNES ma'lumotlar
  - Shift — eski smenalar, o'rniga darhol yangi ochiq smena yaratiladi
  - Session, LoginAttempt, OTPCode, TelegramLinkToken — testdan qolgan
    sessiya/urinish/token "axlati" (SEED LEFTOVER)
  - (audit jurnali append-only — tegilmaydi)

Nima o'chirilmaydi (standart holatda):
  - Role — tizim rollari (superadmin/admin/doctor/reception/cashier/lab/patient)
  - Doctor, Service, Equipment, Reagent, Integration, SystemSetting —
    demo uchun kerak bo'lgan katalog/sozlamalar
  - User (xodimlar) — aks holda hech kim tizimga kira olmay qoladi

`wipe_staff=True` berilsa, qo'shimcha ravishda:
  - role_key == "patient" bo'lgan barcha User'lar o'chiriladi (chunki
    ularning Patient yozuvi allaqachon o'chirilgan — egasiz akkaunt qoladi)
  - `keep_logins` ro'yxatida YO'Q va roli superadmin/admin BO'LMAGAN barcha
    xodim User'lari o'chiriladi (test uchun ochilgan qo'shimcha akkauntlar)

Redis berilsa, `rl:*` (rate-limit) kalitlari ham tozalanadi — aks holda
testda tegib ketilgan IP/user limitlar demo paytida to'sqinlik qilishi mumkin.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import (
    Appointment,
    LabOrder,
    LoginAttempt,
    OTPCode,
    Patient,
    Payment,
    Refund,
    Session as SessionModel,
    Shift,
    TelegramLinkToken,
    User,
)

# Har doim tozalanadigan jadvallar — (Model, hisobot nomi)
_ALWAYS_CLEAR: list[tuple[Any, str]] = [
    (Appointment, "appointments"),
    (LabOrder, "lab_orders"),
    (Refund, "refunds"),
    (Payment, "payments"),
    (Patient, "patients"),
    (SessionModel, "sessions"),
    (LoginAttempt, "login_attempts"),
    (OTPCode, "otp_codes"),
    (TelegramLinkToken, "telegram_link_tokens"),
]


async def _count(db: AsyncSession, model: Any) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar() or 0


async def run_full_reset(
    db: AsyncSession,
    *,
    performed_by: str,
    wipe_staff: bool = False,
    keep_logins: list[str] | None = None,
    redis=None,
    dry_run: bool = False,
) -> dict:
    """Butun tizimni demo/0 holatiga qaytaradi. `dry_run=True` bo'lsa hech
    narsa o'chirmaydi, faqat nechta yozuv o'chirilishini qaytaradi."""

    if get_settings().is_prod:
        raise RuntimeError("Demo reset production muhitida taqiqlangan")

    keep_logins_set = {l.strip().lower() for l in (keep_logins or []) if l.strip()}

    counts: dict[str, int] = {}
    for model, name in _ALWAYS_CLEAR:
        counts[name] = await _count(db, model)

    staff_to_delete_count = 0
    if wipe_staff:
        # patient-portal akkauntlari — Patient o'chirilgach egasiz qoladi
        patient_users_q = select(func.count()).select_from(User).where(User.role_key == "patient")
        staff_to_delete_count += (await db.execute(patient_users_q)).scalar() or 0

        # test uchun ochilgan qo'shimcha xodim akkauntlari
        extra_staff_q = select(func.count()).select_from(User).where(
            User.role_key.notin_(["superadmin", "admin", "patient"])
        )
        if keep_logins_set:
            extra_staff_q = extra_staff_q.where(func.lower(User.login).notin_(keep_logins_set))
        staff_to_delete_count += (await db.execute(extra_staff_q)).scalar() or 0
        counts["staff_users"] = staff_to_delete_count

    if dry_run:
        counts["_dry_run"] = True
        return counts

    # ─── O'CHIRISH (FK tartibi muhim) ───
    await db.execute(delete(Appointment))
    await db.execute(delete(LabOrder))
    await db.execute(delete(Refund))
    await db.execute(delete(Payment))
    await db.execute(delete(Patient))
    await db.execute(delete(Shift))
    await db.execute(delete(SessionModel))
    await db.execute(delete(LoginAttempt))
    await db.execute(delete(OTPCode))
    await db.execute(delete(TelegramLinkToken))
    # Audit jurnali append-only: demo reset unga tegmaydi.

    if wipe_staff:
        await db.execute(delete(User).where(User.role_key == "patient"))
        extra_del = delete(User).where(User.role_key.notin_(["superadmin", "admin", "patient"]))
        if keep_logins_set:
            extra_del = extra_del.where(func.lower(User.login).notin_(keep_logins_set))
        await db.execute(extra_del)

    # Har doim kamida bitta ochiq smena bo'lishi kerak, aks holda kassa
    # sahifasi "smena yo'q" holatida qotib qoladi.
    db.add(Shift(open=True, opened_by=performed_by, opening_balance=0))

    await db.commit()

    if redis is not None:
        cleared_keys = 0
        try:
            async for key in redis.scan_iter(match="rl:*"):
                await redis.delete(key)
                cleared_keys += 1
        except Exception:
            pass
        counts["redis_rate_limit_keys"] = cleared_keys

    return counts
