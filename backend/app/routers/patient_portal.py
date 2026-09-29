"""Bemor kabineti (patient portal)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip, get_current_patient_user, require_patient_csrf
from ..models import (
    Appointment,
    LabOrder,
    Patient,
    Payment,
    Role,
    TelegramLinkToken,
    User,
    Session as DBSession,
)
from ..security.audit import audit_view, log_action
from ..security.rate_limit import hit
from ..security.telegram import (
    LINK_TOKEN_TTL_SECONDS,
    bot_configured,
    build_deeplink,
    generate_link_token,
)

router = APIRouter()


async def _require_patient(
    user: User = Depends(get_current_patient_user),
) -> User:
    """Faqat patient roli uchun."""
    if user.role_key != "patient" or user.patient_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Faqat bemorlar uchun")
    return user


async def _get_patient(db: AsyncSession, user: User) -> Patient:
    p = (
        await db.execute(select(Patient).where(Patient.id == user.patient_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")
    return p


def _patient_dict(p: Patient, user: User) -> dict:
    return {
        "id": p.id,
        "fullname": p.fullname,
        "phone": p.phone_enc,
        "age": p.age,
        "gender": p.gender,
        "blood": p.blood,
        "address": p.address,
        "allergies": p.allergies or [],
        "chronic": p.chronic or [],
        "login": user.login,
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
        "completed_at": int(a.completed_at.timestamp() * 1000) if a.completed_at else None,
        "created_at": int(a.created_at.timestamp() * 1000) if a.created_at else None,
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
        "verified_at": int(o.verified_at.timestamp() * 1000) if o.verified_at else None,
        "verified_by": o.verified_by,
        "created_at": int(o.created_at.timestamp() * 1000) if o.created_at else None,
    }


def _payment_dict(p: Payment) -> dict:
    return {
        "id": p.id,
        "appointment_id": p.appointment_id,
        "amount": p.amount,
        "method": p.method,
        "services": p.services or [],
        "status": p.status,
        "created_at": int(p.created_at.timestamp() * 1000) if p.created_at else None,
    }


# ═══════════════════ PROFILE ═══════════════════
@router.get("/me")
async def get_me(
    request: Request,
    user: User = Depends(_require_patient),
    db: AsyncSession = Depends(get_db),
):
    p = await _get_patient(db, user)
    await audit_view(db, user, request, f"portal me patient #{user.patient_id}")
    return _patient_dict(p, user)


class ProfileUpdate(BaseModel):
    address: str | None = None
    phone: str | None = None


@router.patch("/me", dependencies=[Depends(require_patient_csrf)])
async def update_me(
    body: ProfileUpdate,
    request: Request,
    user: User = Depends(_require_patient),
    db: AsyncSession = Depends(get_db),
):
    p = await _get_patient(db, user)
    before = _patient_dict(p, user)

    if body.address is not None:
        p.address = body.address

    if body.phone is not None:
        # Telefon o'zgarsa — login ham o'zgaradi (lekin faqat valid bo'lsa)
        from ..security.otp import normalize_phone
        new_phone = normalize_phone(body.phone)
        if not new_phone:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Telefon raqam xato")
        # Boshqa user band emasligini tekshiramiz
        existing = (
            await db.execute(select(User).where(User.login == new_phone, User.id != user.id))
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Bu telefon boshqa bemorga tegishli")
        p.phone_enc = new_phone
        p.phone_bidx = new_phone
        user.login = new_phone
        user.phone = new_phone

    await db.flush()

    await log_action(
        db, user=user.fullname, role="patient", action="update",
        detail="Bemor profilini tahrirladi",
        ip=client_ip(request),
        before=before,
        after=_patient_dict(p, user),
    )

    return _patient_dict(p, user)


@router.post("/change-password", dependencies=[Depends(require_patient_csrf)])
async def change_password(
    user: User = Depends(_require_patient),
):
    # Patient sign-in is OTP-only. Keep a clear response for stale clients,
    # but never modify a password that cannot be used for patient sign-in.
    raise HTTPException(
        status.HTTP_410_GONE,
        "Bemorlar kabinetiga Telegram yoki administrator bergan bir martalik kod bilan kiradi.",
    )


# ═══════════════════ TELEGRAM ═══════════════════
# TIBEX_TELEGRAM_LOGIN_v1: bemor allaqachon (SMS-OTP orqali) login qilgan
# holatda, shu yerdan bir martalik havola so'raydi va botga /start bosadi.
# Login qilinmagan hech kim bu endpointlarga yeta olmaydi (_require_patient).

@router.get("/telegram/status")
async def telegram_status(
    user: User = Depends(_require_patient),
):
    return {
        "linked": bool(user.telegram_chat_id),
        "available": bot_configured(),
    }


@router.post("/telegram/link-token", dependencies=[Depends(require_patient_csrf)])
async def telegram_link_token(
    request: Request,
    user: User = Depends(_require_patient),
    db: AsyncSession = Depends(get_db),
):
    if not bot_configured():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Telegram bot hozircha sozlanmagan. Administrator bilan bog'laning.",
        )

    ip = client_ip(request) or "unknown"
    await hit(f"rl:tg:link:user:{user.id}", limit=5, window=900)

    # Eski, hali ishlatilmagan tokenlarni bekor qilamiz — bir vaqtda faqat
    # bitta aktiv havola bo'lishi kerak.
    old = (
        await db.execute(
            select(TelegramLinkToken).where(
                TelegramLinkToken.user_id == user.id,
                TelegramLinkToken.used == False,  # noqa: E712
            )
        )
    ).scalars().all()
    for t in old:
        t.used = True

    token_str = generate_link_token()
    row = TelegramLinkToken(
        token=token_str,
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=LINK_TOKEN_TTL_SECONDS),
        ip=ip,
    )
    db.add(row)
    await db.flush()

    await log_action(
        db, user=user.fullname, role="patient", action="update",
        detail="Bemor Telegram ulash havolasini so'radi",
        ip=ip,
    )

    return {
        "link": build_deeplink(token_str),
        "ttl_seconds": LINK_TOKEN_TTL_SECONDS,
        "expires_at": int(row.expires_at.timestamp() * 1000),
    }


@router.post("/telegram/unlink", dependencies=[Depends(require_patient_csrf)])
async def telegram_unlink(
    request: Request,
    user: User = Depends(_require_patient),
    db: AsyncSession = Depends(get_db),
):
    user.telegram_chat_id = None
    await db.flush()

    await log_action(
        db, user=user.fullname, role="patient", action="update",
        detail="Bemor Telegram ulanishini uzdi",
        ip=client_ip(request),
    )

    return {"ok": True}


# ═══════════════════ APPOINTMENTS ═══════════════════
@router.get("/appointments")
async def list_appointments(
    request: Request,
    user: User = Depends(_require_patient),
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


# ═══════════════════ LAB ═══════════════════
@router.get("/lab-orders")
async def list_lab_orders(
    request: Request,
    user: User = Depends(_require_patient),
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


# ═══════════════════ PAYMENTS ═══════════════════
@router.get("/payments")
async def list_payments(
    request: Request,
    user: User = Depends(_require_patient),
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


# ═══════════════════ SUMMARY ═══════════════════
@router.get("/summary")
async def get_summary(
    request: Request,
    user: User = Depends(_require_patient),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard uchun umumiy statistika."""
    from sqlalchemy import func

    appt_count = (
        await db.execute(
            select(func.count()).select_from(Appointment).where(Appointment.patient_id == user.patient_id)
        )
    ).scalar_one()
    lab_count = (
        await db.execute(
            select(func.count()).select_from(LabOrder).where(LabOrder.patient_id == user.patient_id)
        )
    ).scalar_one()
    total_paid = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.patient_id == user.patient_id)
        )
    ).scalar_one()
    total_debt = (
        await db.execute(
            select(func.coalesce(func.sum(Appointment.debt), 0)).where(Appointment.patient_id == user.patient_id)
        )
    ).scalar_one()

    await audit_view(db, user, request, f"portal summary patient #{user.patient_id}")
    return {
        "appointments_count": appt_count,
        "lab_orders_count": lab_count,
        "total_paid": int(total_paid),
        "total_debt": int(total_debt),
    }
