from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import (
    client_ip,
    get_current_user,
    require_csrf,
    require_permission,
)
from ..models import Appointment, Doctor, LabOrder, Patient, Role, Service, User
from ..realtime import publish
from ..security.anti_idor import require_appointment_access
from ..security.rbac import has_permission
from ..state_machine import (
    is_final_appointment_status,
    raise_if_invalid_appointment,
)
from ..security.audit import audit_view, log_action
from .settings import get_setting_value

router = APIRouter()


class ServiceItem(BaseModel):
    code: str = ""
    name: str = ""
    price: int = 0


class AppointmentIn(BaseModel):
    patient_id: int
    doctor_id: int | None = None
    doctor_name: str = ""
    scheduled_time: str
    date: str
    priority: str = "normal"
    service: ServiceItem = ServiceItem()
    paid: int = 0
    debt: int = 0
    complaint: str | None = None

    # TIBEX_APPT_FORMAT_VALIDATION_v1: avval `scheduled_time` va `date`
    # hech qanday format tekshiruvisiz saqlanardi — "99:99" yoki
    # "garbage" DB'ga tushib, keyingi so'rovlarni buzardi.
    @field_validator("scheduled_time")
    @classmethod
    def _check_scheduled_time(cls, v: str) -> str:
        import re
        v = (v or "").strip()
        if not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", v):
            raise ValueError("scheduled_time 'HH:MM' formatida bo'lishi kerak")
        # Kunlik vaqtni bir xil ko'rinishga keltiramiz: "9:00" -> "09:00"
        hh, mm = v.split(":")
        return f"{int(hh):02d}:{mm}"

    @field_validator("date")
    @classmethod
    def _check_date(cls, v: str) -> str:
        from datetime import date as _date
        v = (v or "").strip()
        try:
            _date.fromisoformat(v)
        except ValueError:
            raise ValueError("date 'YYYY-MM-DD' formatida bo'lishi kerak") from None
        return v


class AppointmentPatch(BaseModel):
    status: str | None = None
    priority: str | None = None
    paid: int | None = None
    debt: int | None = None
    payment_method: str | None = None
    complaint: str | None = None
    cancel_reason: str | None = Field(default=None, max_length=500)
    vitals: dict | None = None
    prelim_dx: str | None = None
    final_dx: str | None = None
    prescriptions: list | None = None
    draft: dict | None = None
    lab_orders: list | None = None
    doctor_id: int | None = None
    doctor_name: str | None = None


def _to_dict(a: Appointment, user: User | None = None) -> dict:
    """TIBEX_MEDICAL_PRIVACY_v1: tibbiy maydonlar faqat tegishli rollarga."""
    base = {
        "id": a.id,
        "patient_id": a.patient_id,
        "doctor_id": a.doctor_id,
        "doctor_name": a.doctor_name,
        "scheduled_time": a.scheduled_time,
        "date": a.date,
        "status": a.status,
        "priority": a.priority,
        "service": a.service,
        "paid": a.paid,
        "debt": a.debt,
        "payment_method": a.payment_method,
        "completed_at": int(a.completed_at.timestamp() * 1000) if a.completed_at else None,
        "completed_by": a.completed_by,
        "created_at": int(a.created_at.timestamp() * 1000) if a.created_at else None,
        "arrived_at": int(a.arrived_at.timestamp() * 1000) if a.arrived_at else None,
        "status_changed_at": int(a.status_changed_at.timestamp() * 1000) if a.status_changed_at else None,
        "cancel_reason": a.cancel_reason,
    }
    _MEDICAL_ROLES = {"admin", "superadmin", "doctor", "lab", "patient"}
    if user is None or user.role_key in _MEDICAL_ROLES:
        base.update({
            "complaint": a.complaint,
            "vitals": a.vitals,
            "prelim_dx": a.prelim_dx,
            "final_dx": a.final_dx,
            "prescriptions": a.prescriptions or [],
            "draft": a.draft,
            "lab_orders": a.lab_orders or [],
        })
    return base


@router.get("")
async def list_appointments(
    request: Request,
    date: str | None = None,
    status_filter: str | None = None,
    doctor_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("appointments", "view")),
):
    # TIBEX_DOCTOR_SYNC_v1_FILTER: doctor faqat o'z qabullarini ko'radi
    stmt = select(Appointment).order_by(Appointment.scheduled_time)
    if date:
        stmt = stmt.where(Appointment.date == date)
    if status_filter:
        stmt = stmt.where(Appointment.status == status_filter)
    if doctor_id:
        stmt = stmt.where(Appointment.doctor_id == doctor_id)
    if user.role_key == "doctor":
        if user.doctor_id:
            stmt = stmt.where(Appointment.doctor_id == user.doctor_id)
        else:
            stmt = stmt.where(Appointment.id == -1)
    elif user.role_key == "patient":
        stmt = stmt.where(Appointment.patient_id == (user.patient_id or -1))
    elif user.role_key == "lab":
        stmt = stmt.where(Appointment.id.in_(select(LabOrder.appointment_id).where(LabOrder.appointment_id.is_not(None))))
    elif user.role_key not in {"admin", "superadmin", "reception", "cashier"}:
        stmt = stmt.where(Appointment.id == -1)
    rows = (await db.execute(stmt)).scalars().all()
    await audit_view(db, user, request, f"appointments list count={len(rows)}")
    return [_to_dict(a, user=user) for a in rows]


@router.get("/{appointment_id}")
async def get_appointment(
    request: Request,
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("appointments", "view")),
    _own: Appointment = Depends(require_appointment_access),
):
    a = (
        await db.execute(select(Appointment).where(Appointment.id == appointment_id))
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Qabul topilmadi")
    await audit_view(db, user, request, f"appointment #{appointment_id}")
    return _to_dict(a, user=user)


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_appointment(
    body: AppointmentIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("appointments", "create")),
):
    service = None
    if body.service.code:
        service = (
            await db.execute(select(Service).where(Service.code == body.service.code))
        ).scalar_one_or_none()
        if service is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Noma'lum xizmat kodi")

    # TIBEX_APPT_FK_CHECK_v1: bemor va shifokor MAVJUDLIGINI tekshirish.
    # Avval bu yo'q edi: yaroqsiz `patient_id` yoki `doctor_id` bilan FK
    # constraint buzilib, foydalanuvchi 500 olardi va log'da "Internal Server Error"
    # yozilardi. Endi to'g'ri 404 qaytaramiz.
    _patient_exists = (
        await db.execute(select(Patient.id).where(Patient.id == body.patient_id))
    ).scalar_one_or_none()
    if _patient_exists is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Bemor topilmadi (id={body.patient_id})",
        )
    if body.doctor_id is not None:
        _doctor_exists = (
            await db.execute(select(Doctor.id).where(Doctor.id == body.doctor_id))
        ).scalar_one_or_none()
        if _doctor_exists is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                f"Shifokor topilmadi (id={body.doctor_id})",
            )

    # Bir shifokorga bir vaqtga ikki navbat yozilmasin (ikki qabulxona xodimi
    # bir vaqtda band qilsa ham). Shifokor qatori qulflanadi — so'rovlar ketma-ket.
    if body.doctor_id is not None:
        await db.execute(select(Doctor.id).where(Doctor.id == body.doctor_id).with_for_update())
        clash = (
            await db.execute(
                select(Appointment.id).where(
                    Appointment.doctor_id == body.doctor_id,
                    Appointment.date == body.date,
                    Appointment.scheduled_time == body.scheduled_time,
                    Appointment.status.notin_(("cancelled", "no_show")),
                )
            )
        ).first()
        if clash is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Bu vaqt ({body.scheduled_time}) shifokor uchun band. Boshqa vaqt tanlang",
            )

    a = Appointment(
        patient_id=body.patient_id,
        doctor_id=body.doctor_id,
        doctor_name=body.doctor_name,
        scheduled_time=body.scheduled_time,
        date=body.date,
        status="waiting",
        priority=body.priority or "normal",
        service=(
            {"code": service.code, "name": service.name, "price": service.price}
            if service else {"code": "", "name": "", "price": 0}
        ),
        paid=0,
        debt=service.price if service else 0,
        complaint=body.complaint,
        prescriptions=[],
        lab_orders=[],
        status_changed_at=datetime.now(timezone.utc),
    )
    db.add(a)
    await db.flush()
    await db.refresh(a)

    after = _to_dict(a, user=user)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="create",
        detail=f"Yangi qabul: #{a.id} — bemor #{a.patient_id}",
        ip=client_ip(request),
        after=after,
    )
    await publish("appointment.created", after)
    return after


@router.patch("/{appointment_id}", dependencies=[Depends(require_csrf)])
async def update_appointment(
    appointment_id: int,
    body: AppointmentPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    role: Role = Depends(require_permission("appointments", "edit")),
    _own: Appointment = Depends(require_appointment_access),
):
    a = (
        await db.execute(select(Appointment).where(Appointment.id == appointment_id))
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Qabul topilmadi")

    before = _to_dict(a, user=user)
    data = body.model_dump(exclude_unset=True)

    if {"paid", "debt", "payment_method"} & data.keys():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Moliyaviy maydonlarni qabul tahrirlash orqali o'zgartirib bo'lmaydi",
        )

    # ─── TIBEX_MEDICAL_GUARD: tashxis/retsept — alohida ruxsat va medicalLock ───
    dx_fields = {"prelim_dx", "final_dx", "vitals", "complaint"}
    rx_fields = {"prescriptions"}
    touches_dx = any(f in data for f in dx_fields)
    touches_rx = any(f in data for f in rx_fields)

    if touches_dx or touches_rx:
        medical_lock = await get_setting_value(db, "medicalLock", True)
        # medicalLock yoqilgan bo'lsa, admin/superadmin tashxis-retseptni o'zgartira olmaydi
        if medical_lock and user.role_key in ("admin", "superadmin"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Tibbiy yozuvlar himoyalangan: admin tashxis/retseptni o'zgartira olmaydi "
                "(Sozlamalar → 'Tibbiy yozuvlarni himoyalash' yoqilgan)",
            )
        if touches_dx and not has_permission(role.permissions, "medical", "edit_diagnosis"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Ruxsat yo'q: medical.edit_diagnosis (rol: {role.key})",
            )
        if touches_rx and not has_permission(role.permissions, "medical", "edit_prescription"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Ruxsat yo'q: medical.edit_prescription (rol: {role.key})",
            )

    # ─── STATE MACHINE: status o'tish tekshiruvi ───
    if "status" in data and data["status"] and data["status"] != a.status:
        target = data["status"]
        # Qabulxona: bekor/kelmadi sababi majburiy (kamida 3 belgi)
        if target in ("cancelled", "no_show") and user.role_key == "reception":
            reason = (data.get("cancel_reason") or "").strip()
            if len(reason) < 3:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "Sabab kamida 3 belgidan iborat bo'lsin",
                )
            data["cancel_reason"] = reason
        # Yakuniy holatdan o'zgartirish mumkin emas
        if is_final_appointment_status(a.status):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"'{a.status}' yakuniy holat — o'zgartirib bo'lmaydi",
            )
        # Validatsiya
        raise_if_invalid_appointment(
            current=a.status,
            target=target,
            appointment=a,
            actor_role=user.role_key,
        )
        # Audit — status o'zgarishi
        await log_action(
            db,
            user=user.fullname,
            role=user.role_key,
            action="update",
            detail=f"Qabul #{a.id} status: {a.status} → {target}",
            ip=client_ip(request),
        )
        # Yakunlash vaqtini belgilash
        if target == "completed" and a.completed_at is None:
            a.completed_at = datetime.now(timezone.utc)
            a.completed_by = user.fullname
        now = datetime.now(timezone.utc)
        if target == "arrived" and a.arrived_at is None:
            a.arrived_at = now
        a.status_changed_at = now
        a.status = target
        del data["status"]

    for k, v in data.items():
        setattr(a, k, v)

    await db.flush()
    after = _to_dict(a, user=user)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="update",
        detail=f"Qabul tahrirlandi: #{a.id}",
        ip=client_ip(request),
        before=before,
        after=after,
    )
    await publish("appointment.updated", after)
    return after


@router.delete("/{appointment_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_appointment(
    appointment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("appointments", "delete")),
    _own: Appointment = Depends(require_appointment_access),
):
    a = (
        await db.execute(select(Appointment).where(Appointment.id == appointment_id))
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Qabul topilmadi")

    before = _to_dict(a, user=user)
    await db.delete(a)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="delete",
        detail=f"Qabul o'chirildi: #{a.id}",
        ip=client_ip(request),
        before=before,
    )
    await publish("appointment.deleted", {"id": appointment_id})
