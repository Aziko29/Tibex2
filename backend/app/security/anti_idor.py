"""Anti-IDOR/BOLA — har bir resource'ga egalik tekshiruvi.

OWASP Top 10 #1 (Broken Access Control) — eng ko'p ishlatiladigan hujum.
Har bir ID bo'yicha so'rovda foydalanuvchi egasimi yoki yo'qmi tekshiriladi.
"""
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import (
    Appointment,
    Equipment,
    Integration,
    LabOrder,
    Patient,
    Payment,
    Reagent,
    User,
)


# ═══════════════════════════════════════════════════════════
# ROLE-BASED ACCESS RULES
# ═══════════════════════════════════════════════════════════
STAFF_ROLES = {"admin", "doctor", "reception", "cashier", "lab", "superadmin"}


async def _is_staff(user: User) -> bool:
    """Foydalanuvchi xodimmi?"""
    return user.role_key in STAFF_ROLES


# ═══════════════════════════════════════════════════════════
# PATIENT OWNERSHIP
# ═══════════════════════════════════════════════════════════
async def require_patient_access(
    patient_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Patient:
    """Bemorga kirish huquqini tekshiradi.
    
    • Xodimlar: barcha bemorlarga kirish
    • Bemorlar: faqat o'zlariga
    """
    p = (await db.execute(
        select(Patient).where(Patient.id == patient_id)
    )).scalar_one_or_none()

    if p is None:
        # 404 qaytaramiz — 403 emas (resource enumeration oldini olish)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")

    # TIBEX_STRICT_IDOR_v1: rolga mos ruxsat
    # admin/superadmin/reception/cashier — keng ruxsat (vazifa talab)
    if user.role_key in ("admin", "superadmin", "reception", "cashier"):
        return p

    # Bemor — faqat o'zini
    if user.role_key == "patient" and user.patient_id == patient_id:
        return p

    # Shifokor — faqat o'z qabuliga ega bemorlar
    if user.role_key == "doctor" and user.doctor_id:
        _has = await db.scalar(
            select(Appointment.id).where(
                Appointment.patient_id == patient_id,
                Appointment.doctor_id == user.doctor_id,
            ).limit(1)
        )
        if _has:
            return p

    # Laborant — faqat lab so'rovi bor bemorlar
    if user.role_key == "lab":
        _has = await db.scalar(
            select(LabOrder.id).where(
                LabOrder.patient_id == patient_id,
            ).limit(1)
        )
        if _has:
            return p

    # Boshqa hollarda — 404
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")


# ═══════════════════════════════════════════════════════════
# APPOINTMENT OWNERSHIP
# ═══════════════════════════════════════════════════════════
async def require_appointment_access(
    appointment_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Appointment:
    """Qabulga kirish huquqini tekshiradi."""
    a = (await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )).scalar_one_or_none()

    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Qabul topilmadi")

    # TIBEX_STRICT_IDOR_v1: rolga mos ruxsat
    # admin/superadmin/reception/cashier — keng (navbat/kassa vazifasi)
    if user.role_key in ("admin", "superadmin", "reception", "cashier"):
        return a

    # Shifokor — faqat o'z qabullari
    if user.role_key == "doctor" and user.doctor_id == a.doctor_id:
        return a

    # Laborant — faqat lab so'rovi bor qabullar
    if user.role_key == "lab":
        _has = await db.scalar(
            select(LabOrder.id).where(
                LabOrder.appointment_id == appointment_id,
            ).limit(1)
        )
        if _has:
            return a

    # Bemor — faqat o'ziniki
    if user.role_key == "patient" and user.patient_id == a.patient_id:
        return a

    raise HTTPException(status.HTTP_404_NOT_FOUND, "Qabul topilmadi")


# ═══════════════════════════════════════════════════════════
# LAB ORDER ACCESS
# ═══════════════════════════════════════════════════════════
async def require_lab_access(
    lab_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LabOrder:
    """Lab so'roviga kirish huquqini tekshiradi."""
    o = (await db.execute(
        select(LabOrder).where(LabOrder.id == lab_id)
    )).scalar_one_or_none()

    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lab so'rov topilmadi")

    # TIBEX_STRICT_IDOR_v1: rolga mos ruxsat
    # admin/superadmin/lab/reception — keng (lab ishchi vazifasi)
    if user.role_key in ("admin", "superadmin", "lab", "reception"):
        return o

    # Shifokor — faqat o'z qabuliga bog'liq lab so'rovlar
    if user.role_key == "doctor" and user.doctor_id and o.appointment_id:
        _has = await db.scalar(
            select(Appointment.id).where(
                Appointment.id == o.appointment_id,
                Appointment.doctor_id == user.doctor_id,
            ).limit(1)
        )
        if _has:
            return o

    # Bemor — faqat o'ziniki
    if user.role_key == "patient" and user.patient_id == o.patient_id:
        return o

    raise HTTPException(status.HTTP_404_NOT_FOUND, "Lab so'rov topilmadi")


# ═══════════════════════════════════════════════════════════
# PAYMENT ACCESS
# ═══════════════════════════════════════════════════════════
async def require_payment_access(
    payment_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Payment:
    """To'lovga kirish huquqini tekshiradi."""
    p = (await db.execute(
        select(Payment).where(Payment.id == payment_id)
    )).scalar_one_or_none()

    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "To'lov topilmadi")

    if user.role_key in ("admin", "superadmin", "cashier", "reception"):
        return p

    if user.role_key == "patient" and user.patient_id == p.patient_id:
        return p

    raise HTTPException(status.HTTP_404_NOT_FOUND, "To'lov topilmadi")


# ═══════════════════════════════════════════════════════════
# ADMIN-ONLY
# ═══════════════════════════════════════════════════════════
async def require_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Faqat admin va superadmin."""
    if user.role_key not in ("admin", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ruxsat yo'q")
    return user
