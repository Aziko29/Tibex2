"""Bemor kabineti (patient portal): profil va bemorning o'z yozuvlari.

Telegram ulanishi -> portal_telegram.py, kod bilan kirish -> patient_otp.py.
Umumiy qoidalar (telefon o'zgartirish, serializatsiya) -> services/patient_service.py.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip, get_patient_session, require_patient, require_patient_csrf
from ..models import Appointment, LabOrder, Patient, Payment, User, Session as DBSession
from ..realtime import publish_session_revoked
from ..security.audit import audit_view, log_action
from ..security.csrf import issue_csrf
from ..security.session_cookie import clear_session_cookie
from ..security.telegram import bot_configured
from ..services.patient_service import change_patient_phone, patient_to_dict

router = APIRouter()


async def _get_patient(db: AsyncSession, user: User) -> Patient:
    p = (
        await db.execute(select(Patient).where(Patient.id == user.patient_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")
    return p


def _ms(dt: datetime | None) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


def _profile_dict(p: Patient, user: User) -> dict:
    """Kabinet profili: bemor ma'lumoti + Telegram holati (frontend bitta so'rov bilan oladi)."""
    return {
        **patient_to_dict(p, user),
        "telegram_linked": bool(user.telegram_chat_id),
        "telegram_available": bot_configured(),
    }


def _appointment_dict(a: Appointment) -> dict:
    return {
        "id": a.id,
        "doctor_name": a.doctor_name,
        "scheduled_time": a.scheduled_time,
        "date": a.date,
        "status": a.status,
        "priority": a.priority,
        "service": a.service,
        "complaint": a.complaint,
        "vitals": a.vitals,
        "prelim_dx": a.prelim_dx,
        "final_dx": a.final_dx,
        "prescriptions": a.prescriptions or [],
        "paid": a.paid,
        "debt": a.debt,
        "completed_at": _ms(a.completed_at),
        "created_at": _ms(a.created_at),
    }


def _lab_dict(o: LabOrder) -> dict:
    return {
        "id": o.id,
        "test_name": o.test_name,
        "priority": o.priority,
        "status": o.status,
        "ordered_by": o.ordered_by,
        "result_summary": o.result_summary,
        "result_data": o.result_data,
        "verified_at": _ms(o.verified_at),
        "verified_by": o.verified_by,
        "created_at": _ms(o.created_at),
    }


def _payment_dict(p: Payment) -> dict:
    return {
        "id": p.id,
        "appointment_id": p.appointment_id,
        "amount": p.amount,
        "method": p.method,
        "services": p.services or [],
        "status": p.status,
        "created_at": _ms(p.created_at),
    }


# ═══════════════════ SESSIYA ═══════════════════
@router.get("/csrf")
async def get_portal_csrf(sess: dict = Depends(get_patient_session)):
    """Bemor sessiyasiga bog'langan CSRF token (PATCH/POST so'rovlar uchun)."""
    return {"csrf_token": issue_csrf(sess["jti"])}


@router.post("/logout")
async def portal_logout(
    response: Response,
    sess: dict = Depends(get_patient_session),
    db: AsyncSession = Depends(get_db),
):
    """Bemor o'z sessiyasini yopadi va cookie o'chiriladi."""
    row = (await db.execute(select(DBSession).where(DBSession.jti == sess["jti"]))).scalar_one_or_none()
    if row is not None:
        row.revoked_at = datetime.now(timezone.utc)
        await db.commit()
        await publish_session_revoked(row.jti)
    clear_session_cookie(response, "strict")
    return {"ok": True}


# ═══════════════════ PROFIL ═══════════════════
@router.get("/me")
async def get_me(
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    p = await _get_patient(db, user)
    await audit_view(db, user, request, f"portal me patient #{user.patient_id}")
    return _profile_dict(p, user)


class ProfileUpdate(BaseModel):
    # TIBEX_PORTAL_PROFILE_LIMITS_v1: bemor o'z profilini tahrirlaganda
    # katta matn yuborib DB'ni shishirishi mumkin edi. Limitlar
    # xodim tomonidagi PatientIn/PatientPatch bilan bir xil.
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=32)


@router.patch("/me", dependencies=[Depends(require_patient_csrf)])
async def update_me(
    body: ProfileUpdate,
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    p = await _get_patient(db, user)
    before = patient_to_dict(p, user)

    if body.address is not None:
        p.address = body.address
    if body.phone is not None:
        # Telefon o'zgarsa login ham o'zgaradi (qoidalar servisda: format, takror, band login).
        await change_patient_phone(db, p, body.phone, strict=True, reveal_owner=False)

    await db.flush()
    await log_action(
        db, user=user.fullname, role="patient", action="update",
        detail="Bemor profilini tahrirladi",
        ip=client_ip(request),
        before=before,
        after=patient_to_dict(p, user),
    )
    return _profile_dict(p, user)


# ═══════════════════ QABULLAR ═══════════════════
@router.get("/appointments")
async def list_appointments(
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Appointment)
            .where(Appointment.patient_id == user.patient_id)
            .order_by(Appointment.id.desc())
        )
    ).scalars().all()
    await audit_view(db, user, request, f"portal appointments patient #{user.patient_id}")
    return [_appointment_dict(a) for a in rows]


# ═══════════════════ LABORATORIYA ═══════════════════
@router.get("/lab-orders")
async def list_lab_orders(
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(LabOrder)
            .where(LabOrder.patient_id == user.patient_id)
            .order_by(LabOrder.created_at.desc())
        )
    ).scalars().all()
    await audit_view(db, user, request, f"portal lab patient #{user.patient_id}")
    return [_lab_dict(o) for o in rows]


# ═══════════════════ TO'LOVLAR ═══════════════════
@router.get("/payments")
async def list_payments(
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Payment)
            .where(Payment.patient_id == user.patient_id)
            .order_by(Payment.created_at.desc())
        )
    ).scalars().all()
    await audit_view(db, user, request, f"portal payments patient #{user.patient_id}")
    return [_payment_dict(p) for p in rows]


# ═══════════════════ UMUMIY KO'RSATKICHLAR ═══════════════════
@router.get("/summary")
async def get_summary(
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard uchun umumiy statistika."""
    pid = user.patient_id
    appt_count = (
        await db.execute(select(func.count()).select_from(Appointment).where(Appointment.patient_id == pid))
    ).scalar_one()
    lab_count = (
        await db.execute(select(func.count()).select_from(LabOrder).where(LabOrder.patient_id == pid))
    ).scalar_one()
    total_paid = (
        await db.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.patient_id == pid))
    ).scalar_one()
    total_debt = (
        await db.execute(select(func.coalesce(func.sum(Appointment.debt), 0)).where(Appointment.patient_id == pid))
    ).scalar_one()

    await audit_view(db, user, request, f"portal summary patient #{pid}")
    return {
        "appointments_count": appt_count,
        "lab_orders_count": lab_count,
        "total_paid": int(total_paid),
        "total_debt": int(total_debt),
    }
