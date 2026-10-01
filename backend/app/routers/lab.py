from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import (
    client_ip,
    get_current_user,
    require_csrf,
    require_permission,
)
from ..models import Appointment, LabOrder, Role, User
from ..security.rbac import has_permission
from ..realtime import publish
from ..security.anti_idor import require_lab_access
from ..state_machine import (
    is_final_lab_status,
    raise_if_invalid_lab,
)
from ..security.audit import audit_view, log_action

router = APIRouter()


class LabOrderIn(BaseModel):
    appointment_id: int | None = None
    patient_id: int
    test_key: str
    test_name: str
    priority: str = "normal"
    ordered_by: str = ""
    status: str = "new"


class LabOrderPatch(BaseModel):
    status: str | None = None
    priority: str | None = None
    analyzer: str | None = None
    result_data: dict | None = None
    result_summary: str | None = None
    result_note: str | None = None
    received_by: str | None = None
    completed_by: str | None = None
    verified_by: str | None = None


def _to_dict(o: LabOrder) -> dict:
    return {
        "id": o.id,
        "appointment_id": o.appointment_id,
        "patient_id": o.patient_id,
        "test_key": o.test_key,
        "test_name": o.test_name,
        "priority": o.priority,
        "status": o.status,
        "ordered_by": o.ordered_by,
        "received_by": o.received_by,
        "received_at": int(o.received_at.timestamp() * 1000) if o.received_at else None,
        "started_at": int(o.started_at.timestamp() * 1000) if o.started_at else None,
        "analyzer": o.analyzer,
        "result_data": o.result_data,
        "result_summary": o.result_summary,
        "result_note": o.result_note,
        "completed_at": int(o.completed_at.timestamp() * 1000) if o.completed_at else None,
        "completed_by": o.completed_by,
        "verified_at": int(o.verified_at.timestamp() * 1000) if o.verified_at else None,
        "verified_by": o.verified_by,
        "created_at": int(o.created_at.timestamp() * 1000) if o.created_at else None,
    }


def _appt_dict(a: Appointment) -> dict:
    return {
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
    }


async def _next_lab_id(db: AsyncSession) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"LAB-{year}-"
    result = await db.execute(
        select(func.max(LabOrder.id)).where(LabOrder.id.like(f"{prefix}%"))
    )
    last = result.scalar_one_or_none()
    if last is None:
        seq = 1
    else:
        try:
            seq = int(last.split("-")[-1]) + 1
        except (ValueError, IndexError):
            seq = 1
    return f"{prefix}{seq:04d}"


@router.get("")
async def list_lab_orders(
    request: Request,
    status_filter: str | None = None,
    patient_id: int | None = None,
    appointment_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("lab", "view")),
):
    stmt = select(LabOrder).order_by(LabOrder.created_at.desc())
    if status_filter:
        stmt = stmt.where(LabOrder.status == status_filter)
    if patient_id:
        stmt = stmt.where(LabOrder.patient_id == patient_id)
    if appointment_id:
        stmt = stmt.where(LabOrder.appointment_id == appointment_id)
    if user.role_key == "doctor":
        if user.doctor_id:
            stmt = stmt.where(LabOrder.appointment_id.in_(
                select(Appointment.id).where(Appointment.doctor_id == user.doctor_id)
            ))
        else:
            stmt = stmt.where(LabOrder.id == "__no_access__")
    elif user.role_key == "patient":
        stmt = stmt.where(LabOrder.patient_id == (user.patient_id or -1))
    elif user.role_key not in {"admin", "superadmin", "lab", "reception"}:
        stmt = stmt.where(LabOrder.id == "__no_access__")
    rows = (await db.execute(stmt)).scalars().all()
    await audit_view(db, user, request, f"lab list count={len(rows)}")
    return [_to_dict(o) for o in rows]


@router.get("/{lab_id}")
async def get_lab_order(
    request: Request,
    lab_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("lab", "view")),
    _own: LabOrder = Depends(require_lab_access),
):
    o = (
        await db.execute(select(LabOrder).where(LabOrder.id == lab_id))
    ).scalar_one_or_none()
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lab so'rov topilmadi")
    await audit_view(db, user, request, f"lab order {lab_id}")
    return _to_dict(o)


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_lab_order(
    body: LabOrderIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("lab", "create")),
):
    # TIBEX_LAB_STATUS_FIX_v1: yangi lab so'rov FAQAT "new" statusida yaratiladi.
    # Sabab: state-machine `new -> received -> processing -> ready -> verified`.
    # Agar klient `status="verified"` yuborsa, tasdiqlash bosqichi butunlay chetlab
    # o'tilardi (lab.verify ruxsatisiz). Server tomonda majburlaymiz.
    # TIBEX_LAB_ID_RACE_FIX_v1: `_next_lab_id()` read-modify-write — parallel
    # so'rovlar bir xil ID generatsiya qilishi mumkin. 5 marta retry qilamiz.
    o = None
    for _attempt in range(5):
        new_id = await _next_lab_id(db)
        candidate = LabOrder(
            id=new_id,
            appointment_id=body.appointment_id,
            patient_id=body.patient_id,
            test_key=body.test_key,
            test_name=body.test_name,
            priority=body.priority,
            status="new",
            ordered_by=body.ordered_by or user.fullname,
        )
        try:
            db.add(candidate)
            await db.flush()
            o = candidate
            break
        except IntegrityError:
            try:
                await db.rollback()
            except Exception:
                pass
            continue
    if o is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Lab so'rov ID generatsiyasida to'qnashuv. Qayta urinib ko'ring.",
        )
    await db.refresh(o)

    after = _to_dict(o)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="create",
        detail=f"Lab so'rov: {o.id} — {o.test_name}",
        ip=client_ip(request),
        after=after,
    )
    await publish("lab.created", after)

    # TIBEX_DOCTOR_SYNC_v1: appointment.status = lab_waiting
    if o.appointment_id:
        appt = (
            await db.execute(select(Appointment).where(Appointment.id == o.appointment_id))
        ).scalar_one_or_none()
        if appt is not None and appt.status in ("arrived", "in_progress"):
            old_status = appt.status
            appt.status = "lab_waiting"
            await db.flush()
            await log_action(
                db,
                user=user.fullname,
                role=user.role_key,
                action="update",
                detail=f"Qabul #{appt.id} status: {old_status} → lab_waiting (lab so'rov)",
                ip=client_ip(request),
            )
            await publish("appointment.updated", _appt_dict(appt))

    return after


@router.patch("/{lab_id}", dependencies=[Depends(require_csrf)])
async def update_lab_order(
    lab_id: str,
    body: LabOrderPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    role: Role = Depends(require_permission("lab", "edit")),
    _own: LabOrder = Depends(require_lab_access),
):
    o = (
        await db.execute(select(LabOrder).where(LabOrder.id == lab_id))
    ).scalar_one_or_none()
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lab so'rov topilmadi")

    before = _to_dict(o)
    data = body.model_dump(exclude_unset=True)
    new_status = data.get("status")

    # ─── TIBEX_LAB_VERIFY_GUARD: "verified" holatiga faqat lab.verify huquqi bilan ───
    if new_status == "verified" and not has_permission(role.permissions, "lab", "verify"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Ruxsat yo'q: lab.verify (rol: {role.key})",
        )

    # ─── STATE MACHINE: lab status o'tish tekshiruvi ───
    if new_status and new_status != o.status:
        # Yakuniy holat tekshiruvi
        if is_final_lab_status(o.status):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"'{o.status}' yakuniy holat",
            )
        # Validatsiya
        raise_if_invalid_lab(
            current=o.status,
            target=new_status,
            lab_order=o,
        )
        # Audit
        await log_action(
            db,
            user=user.fullname,
            role=user.role_key,
            action="update",
            detail=f"Lab #{o.id} status: {o.status} → {new_status}",
            ip=client_ip(request),
        )

    if new_status == "verified":
        data["verified_at"] = datetime.now(timezone.utc)
        if not data.get("verified_by"):
            data["verified_by"] = user.fullname
    elif new_status == "ready":
        data["completed_at"] = datetime.now(timezone.utc)
        if not data.get("completed_by"):
            data["completed_by"] = user.fullname
    elif new_status == "processing" and o.started_at is None:
        data["started_at"] = datetime.now(timezone.utc)
    elif new_status == "received" and o.received_at is None:
        data["received_at"] = datetime.now(timezone.utc)
        if not data.get("received_by"):
            data["received_by"] = user.fullname

    for k, v in data.items():
        setattr(o, k, v)

    await db.flush()
    after = _to_dict(o)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="update",
        detail=f"Lab so'rov tahrirlandi: {o.id} ({o.status})",
        ip=client_ip(request),
        before=before,
        after=after,
    )
    await publish("lab.updated", after)

    # TIBEX_DOCTOR_SYNC_v1_LAB_READY: Qabul statusini sinxronlash (audit bilan)
    if o.appointment_id:
        appt = (
            await db.execute(select(Appointment).where(Appointment.id == o.appointment_id))
        ).scalar_one_or_none()
        if appt is not None:
            all_orders = (
                await db.execute(
                    select(LabOrder).where(LabOrder.appointment_id == o.appointment_id)
                )
            ).scalars().all()

            old_status = appt.status
            if all_orders and all(x.status == "verified" for x in all_orders):
                new_status = "lab_ready"
            elif any(x.status in ("new", "received", "processing", "ready") for x in all_orders):
                new_status = "lab_waiting"
            else:
                new_status = None

            if new_status and new_status != old_status:
                appt.status = new_status
                await db.flush()
                await log_action(
                    db,
                    user=user.fullname,
                    role=user.role_key,
                    action="update",
                    detail=f"Qabul #{appt.id} status: {old_status} → {new_status} (lab)",
                    ip=client_ip(request),
                )
                await publish("appointment.updated", _appt_dict(appt))
            elif new_status:
                await publish("appointment.updated", _appt_dict(appt))

    return after
