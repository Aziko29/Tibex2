from datetime import datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..config import get_settings
from ..deps import (
    client_ip,
    get_current_user,
    require_csrf,
    require_permission,
)
from ..models import Appointment, Payment, Refund, Role, Service, Shift, User
from ..realtime import publish
from ..security.audit import audit_view, log_action
from .settings import get_setting_value

router = APIRouter()

# TIBEX_VAT_v1: chekda ko'rsatiladigan QQS stavkasi (foiz). Narxlar
# QQS bilan (ichida) ko'rsatilgan deb hisoblanadi — Settings > "vat"
# yoqilgan bo'lsa chekda ajratib ko'rsatiladi, narxning o'ziga ta'sir
# qilmaydi.
VAT_RATE_PERCENT = 12


class ServiceLine(BaseModel):
    code: str = ""
    name: str = ""
    price: int = 0


class PaymentIn(BaseModel):
    appointment_id: int
    patient_id: int
    # TIBEX_FIN_INTEGRITY_FIX_v1: manfiy/nol summalar taqiqlanadi —
    # aks holda manfiy amount yuborib appt.paid/debt ni buzish mumkin edi.
    amount: int = Field(..., gt=0, le=10**12)
    method: Literal["cash", "card", "online"] = "cash"
    services: list[ServiceLine] = []
    discount_percent: int = Field(default=0, ge=0, le=100)


class RefundIn(BaseModel):
    payment_id: int
    patient_id: int
    amount: int = Field(..., gt=0, le=10**12)
    reason: str = Field(..., min_length=3, max_length=500)
    method: Literal["cash", "card", "online"] = "cash"

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Qaytarish sababi kamida 3 belgidan iborat bo‘lsin")
        return value


class ShiftCloseIn(BaseModel):
    actual_cash: int
    note: str = ""


def _vat_breakdown(amount: int) -> dict:
    """Narx QQS bilan (ichida) deb hisoblab, QQS ulushini ajratib beradi."""
    base = round(amount / (1 + VAT_RATE_PERCENT / 100))
    return {"rate": VAT_RATE_PERCENT, "amount": amount - base, "base": base}


def _payment_dict(p: Payment) -> dict:
    return {
        "id": p.id,
        "appointment_id": p.appointment_id,
        "patient_id": p.patient_id,
        "amount": p.amount,
        "method": p.method,
        "cashier": p.cashier,
        "services": p.services or [],
        "status": p.status,
        "discount_percent": p.discount_percent or 0,
        "vat": _vat_breakdown(p.amount),
        "created_at": int(p.created_at.timestamp() * 1000) if p.created_at else None,
    }


def _refund_dict(r: Refund) -> dict:
    return {
        "id": r.id,
        "payment_id": r.payment_id,
        "patient_id": r.patient_id,
        "amount": r.amount,
        "reason": r.reason,
        "method": r.method,
        "cashier": r.cashier,
        "created_at": int(r.created_at.timestamp() * 1000) if r.created_at else None,
    }


def _shift_dict(s: Shift | None) -> dict | None:
    if s is None:
        return None
    return {
        "open": s.open,
        "opened_at": int(s.opened_at.timestamp() * 1000) if s.opened_at else None,
        "opened_by": s.opened_by,
        "opening_balance": s.opening_balance,
        "closed_at": int(s.closed_at.timestamp() * 1000) if s.closed_at else None,
        "closed_by": s.closed_by,
        "close_record": s.close_record,
    }


# ═══════════════════════ PAYMENTS ═══════════════════════
@router.get("/payments")
async def list_payments(
    request: Request,
    today: bool = False,
    appointment_id: int | None = None,
    patient_id: int | None = None,
    limit: int = Query(500, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("payments", "view")),
):
    stmt = select(Payment).order_by(Payment.created_at.desc()).limit(limit)
    if today:
        _tz = ZoneInfo(get_settings().clinic_timezone)
        _today_local = datetime.now(_tz).date()
        today_start = datetime.combine(_today_local, time.min, tzinfo=_tz).astimezone(timezone.utc)
        stmt = stmt.where(Payment.created_at >= today_start)
    if appointment_id:
        stmt = stmt.where(Payment.appointment_id == appointment_id)
    if patient_id:
        stmt = stmt.where(Payment.patient_id == patient_id)
    if user.role_key == "patient":
        stmt = stmt.where(Payment.patient_id == (user.patient_id or -1))
    elif user.role_key not in {"admin", "superadmin", "cashier", "reception"}:
        stmt = stmt.where(Payment.id == -1)
    rows = (await db.execute(stmt)).scalars().all()
    await audit_view(db, user, request, f"payments list count={len(rows)}")
    return [_payment_dict(p) for p in rows]


@router.post("/payments", status_code=201, dependencies=[Depends(require_csrf)])
async def create_payment(
    body: PaymentIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("payments", "create")),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", min_length=8, max_length=64),
):
    appt = (
        await db.execute(
            select(Appointment)
            .where(Appointment.id == body.appointment_id)
            .with_for_update()   # TIBEX_PAYMENT_LOCK_v1
        )
    ).scalar_one_or_none()
    if appt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Qabul topilmadi")
    # 26-band: Idempotency-Key — qabul qatori qulflangan, shuning uchun poyga yo'q
    if idempotency_key:
        prev = (
            await db.execute(select(Payment).where(Payment.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if prev is not None:
            if prev.appointment_id != body.appointment_id or prev.amount != body.amount:
                raise HTTPException(status.HTTP_409_CONFLICT, "Idempotency-Key boshqa so'rov uchun ishlatilgan")
            return _payment_dict(prev)
    # TIBEX_PATIENT_MATCH_v1: patient_id mos kelishi shart
    if appt.patient_id != body.patient_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Qabul va bemor mos kelmaydi",
        )

    # TIBEX_DISCOUNT_LIMIT_v1: kassir Settings > "Chegirma limiti"dan
    # oshiradigan chegirma kirita olmaydi — front-end tekshiruvi
    # aylanib o'tilsa ham backend qat'iy chegara qo'yadi.
    discount_percent = max(0, int(body.discount_percent or 0))
    discount_limit = int(await get_setting_value(db, "discount_limit", 20))
    if discount_percent > discount_limit:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Chegirma limiti {discount_limit}% — kiritilgan {discount_percent}% ruxsat etilmagan",
        )

    # TIBEX_TRUSTED_PRICE_FIX_v1: xizmat narxi endi mijozdan (frontend)
    # emas, serverdagi xizmatlar katalogidan (`services` jadvali, kod
    # bo'yicha) olinadi. Avval `services[].price` to'g'ridan-to'g'ri
    # klientdan qabul qilinardi — bu kassirga chek/jami summani xohlagan
    # tomonga (haqiqiy narxdan yuqori yoki past) soxtalashtirish imkonini
    # berardi, chunki chegirma va to'lov summasi solishtirilishi mumkin
    # bo'lgan "haqiqiy" jami umuman bo'lmagan.
    requested_services = body.services
    if not requested_services:
        appointment_service = appt.service or {}
        service_code = appointment_service.get("code") if isinstance(appointment_service, dict) else None
        if service_code:
            requested_services = [ServiceLine(code=service_code)]
    if not requested_services or any(not line.code for line in requested_services):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "To'lov uchun xizmat katalogidagi xizmat kodi talab qilinadi",
        )

    resolved_services: list[dict] = []
    for line in requested_services:
        svc = (
            await db.execute(select(Service).where(Service.code == line.code))
        ).scalar_one_or_none()
        if svc is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Noma'lum xizmat kodi",
            )
        resolved_services.append({"code": svc.code, "name": svc.name, "price": svc.price})

    # TIBEX_AMOUNT_CONSISTENCY_FIX_v1: kodli xizmatlar mavjud bo'lsa,
    # to'lov summasi (+ avval to'langanlar) katalog narxi va chegirmadan
    # hisoblangan haqiqiy jamidan oshib ketishi mumkin emas. Qisman
    # to'lov (haqiqiy jamidan kam summa, qolgani qarz sifatida qoladi)
    # — bu qonuniy holat, shuning uchun taqiqlanmaydi; faqat ORTIQCHA
    # (haqiqiy jamidan katta) to'lov rad etiladi.
    coded_subtotal = sum(
        s["price"] for s in resolved_services
    )
    expected_total = coded_subtotal - round(coded_subtotal * discount_percent / 100)
    already_paid = appt.paid or 0
    max_allowed = max(0, expected_total - already_paid)
    if body.amount > max_allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "To'lov summasi hisoblangan jamidan katta "
            f"(xizmatlar: {coded_subtotal:,}, chegirma: {discount_percent}%, "
            f"avval to'langan: {already_paid:,}, ruxsat etilgan maksimum: {max_allowed:,}, "
            f"yuborilgan: {body.amount:,})",
        )

    p = Payment(
        appointment_id=body.appointment_id,
        patient_id=body.patient_id,
        amount=body.amount,
        method=body.method,
        cashier=user.fullname,
        services=resolved_services,
        status="completed",
        discount_percent=discount_percent,
        idempotency_key=idempotency_key,
    )
    db.add(p)

    # Qabulning to'langan/qarz qiymatlarini yangilash
    appt.paid = (appt.paid or 0) + body.amount
    appt.debt = max(0, (appt.debt or 0) - body.amount)
    appt.payment_method = body.method

    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Takroriy to'lov so'rovi") from exc
    await db.refresh(p)

    after = _payment_dict(p)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="payment",
        detail=f"To'lov qabul qilindi: {body.amount:,} so'm ({body.method})",
        ip=client_ip(request),
        after=after,
    )
    await publish("payment.created", after)

    # Qabulni ham yangilangan holda e'lon qilamiz
    await publish(
        "appointment.updated",
        {"id": appt.id, "paid": appt.paid, "debt": appt.debt, "payment_method": appt.payment_method},
    )
    return after


# ═══════════════════════ REFUNDS ═══════════════════════
@router.get("/refunds")
async def list_refunds(
    request: Request,
    limit: int = Query(200, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("payments", "view")),
):
    stmt = select(Refund).order_by(Refund.created_at.desc()).limit(limit)
    if user.role_key == "patient":
        stmt = stmt.where(Refund.patient_id == (user.patient_id or -1))
    elif user.role_key not in {"admin", "superadmin", "cashier", "reception"}:
        stmt = stmt.where(Refund.id == -1)
    rows = (await db.execute(stmt)).scalars().all()
    await audit_view(db, user, request, f"refunds list count={len(rows)}")
    return [_refund_dict(r) for r in rows]


@router.post("/refunds", status_code=201, dependencies=[Depends(require_csrf)])
async def create_refund(
    body: RefundIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("payments", "refund")),
):
    pay = (
        await db.execute(
            select(Payment).where(Payment.id == body.payment_id).with_for_update()
        )
    ).scalar_one_or_none()
    if pay is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "To'lov topilmadi")
    if pay.patient_id != body.patient_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "To'lov va bemor mos kelmaydi")

    # TIBEX_FIN_INTEGRITY_FIX_v1: shu to'lov bo'yicha oldin qilingan
    # barcha qaytarishlar yig'indisini hisobga olish — aks holda bitta
    # to'lovga bir necha marta to'liq summa qaytarib olish mumkin edi.
    already_refunded = (
        await db.execute(
            select(func.coalesce(func.sum(Refund.amount), 0)).where(
                Refund.payment_id == body.payment_id
            )
        )
    ).scalar_one()
    if already_refunded + body.amount > pay.amount:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Qaytarish summasi to'lov summasidan katta "
            f"(to'lov: {pay.amount:,}, avval qaytarilgan: {already_refunded:,}, "
            f"so'ralgan: {body.amount:,})",
        )

    r = Refund(
        payment_id=body.payment_id,
        patient_id=body.patient_id,
        amount=body.amount,
        reason=body.reason,
        method=body.method,
        cashier=user.fullname,
    )
    db.add(r)
    await db.flush()
    await db.refresh(r)

    # TIBEX_REFUND_APPT_SYNC_v1: qabul hisobini yangilash
    if pay.appointment_id:
        _appt = (await db.execute(
            select(Appointment)
            .where(Appointment.id == pay.appointment_id)
            .with_for_update()
        )).scalar_one_or_none()
        if _appt is not None:
            _appt.paid = max(0, (_appt.paid or 0) - body.amount)
            _appt.debt = (_appt.debt or 0) + body.amount
            await publish(
                "appointment.updated",
                {"id": _appt.id, "paid": _appt.paid, "debt": _appt.debt},
            )

    after = _refund_dict(r)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="refund",
        detail=f"Qaytarish: {body.amount:,} so'm — {body.reason}",
        ip=client_ip(request),
        after=after,
    )
    await publish("refund.created", after)
    return after


# ═══════════════════════ SHIFT ═══════════════════════
@router.get("/shift")
async def get_shift(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("payments", "view")),
):
    s = (
        await db.execute(select(Shift).order_by(Shift.id.desc()).limit(1))
    ).scalar_one_or_none()
    return _shift_dict(s)


@router.patch("/shift", dependencies=[Depends(require_csrf)])
async def update_shift(
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("payments", "create")),
):
    s = (
        await db.execute(select(Shift).order_by(Shift.id.desc()).limit(1))
    ).scalar_one_or_none()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Smena topilmadi")

    # TIBEX_FIN_INTEGRITY_FIX_v1: faqat aniq ruxsat berilgan maydonlarga
    # yozish mumkin — avval `hasattr` orqali istalgan maydonga (masalan
    # close_record, opened_by, opening_balance) yozib bo'lardi.
    _ALLOWED_SHIFT_PATCH_FIELDS = {"opening_balance"}
    unknown = set(body.keys()) - _ALLOWED_SHIFT_PATCH_FIELDS
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Ruxsat etilmagan maydon(lar): {', '.join(sorted(unknown))}",
        )
    for k, v in body.items():
        setattr(s, k, v)
    await db.flush()
    return _shift_dict(s)


@router.post("/shift/close", dependencies=[Depends(require_csrf)])
async def close_shift(
    body: ShiftCloseIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("payments", "close_shift")),
):
    shift = (
        await db.execute(
            select(Shift)
            .order_by(Shift.id.desc())
            .limit(1)
            .with_for_update()   # TIBEX_SHIFT_LOCK_v1
        )
    ).scalar_one_or_none()
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Smena topilmadi")
    if not shift.open:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Smena allaqachon yopilgan")

    _tz = ZoneInfo(get_settings().clinic_timezone)
    _today_local = datetime.now(_tz).date()
    today_start = datetime.combine(_today_local, time.min, tzinfo=_tz).astimezone(timezone.utc)

    payments = (
        await db.execute(select(Payment).where(Payment.created_at >= today_start))
    ).scalars().all()
    refunds = (
        await db.execute(select(Refund).where(Refund.created_at >= today_start))
    ).scalars().all()

    cash_in = sum(p.amount for p in payments if p.method == "cash")
    card_in = sum(p.amount for p in payments if p.method == "card")
    online_in = sum(p.amount for p in payments if p.method == "online")
    refund_out = sum(r.amount for r in refunds)

    expected_cash = (shift.opening_balance or 0) + cash_in - refund_out
    difference = body.actual_cash - expected_cash

    close_record = {
        "closed_at": datetime.now(timezone.utc).isoformat(),
        "closed_by": user.fullname,
        "opening_balance": shift.opening_balance or 0,
        "expected_cash": expected_cash,
        "actual_cash": body.actual_cash,
        "difference": difference,
        "cash_income": cash_in,
        "card_income": card_in,
        "online_income": online_in,
        "refunds_total": refund_out,
        "total_revenue": cash_in + card_in + online_in,
        "payments_count": len(payments),
        "note": body.note,
    }

    shift.open = False
    shift.closed_at = datetime.now(timezone.utc)
    shift.closed_by = user.fullname
    shift.close_record = close_record
    await db.flush()

    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="shift",
        detail=(
            f"Smena yopildi. Kutilgan: {expected_cash:,}, "
            f"Haqiqiy: {body.actual_cash:,}, Farq: {difference:,}"
        ),
        ip=client_ip(request),
        after=close_record,
    )
    await publish("shift.closed", close_record)
    return close_record
