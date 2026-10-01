from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
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
from ..models import Doctor, Role, User
from ..realtime import publish
from ..security.audit import log_action

router = APIRouter()


def _strip_required(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Bo'sh bo'lmasligi kerak")
    return value


class DoctorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    specialty: str = Field(min_length=1, max_length=128)
    phone: str = Field(default="", max_length=32)
    price: int = Field(default=0, ge=0)
    room: str = Field(default="", max_length=32)

    @field_validator("name", "specialty")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return _strip_required(value)


class DoctorPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    specialty: str | None = Field(default=None, min_length=1, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    price: int | None = Field(default=None, ge=0)
    room: str | None = Field(default=None, max_length=32)
    active: bool | None = None

    @field_validator("name", "specialty")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return _strip_required(value)


def _to_dict(d: Doctor) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "specialty": d.specialty,
        "phone": d.phone,
        "price": d.price,
        "room": d.room,
        "active": d.active,
    }


@router.get("")
async def list_doctors(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("doctors", "view")),
):
    rows = (await db.execute(select(Doctor).order_by(Doctor.id))).scalars().all()
    return [_to_dict(d) for d in rows]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_doctor(
    body: DoctorIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("doctors", "create")),
):
    d = Doctor(
        name=body.name,
        specialty=body.specialty,
        phone=body.phone or None,
        price=body.price,
        room=body.room or None,
        active=True,
    )
    db.add(d)
    await db.flush()
    await db.refresh(d)

    after = _to_dict(d)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="create",
        detail=f"Yangi shifokor: {d.name} ({d.specialty})",
        ip=client_ip(request),
        after=after,
    )
    await publish("doctor.created", after)
    return after


@router.patch("/{doctor_id}", dependencies=[Depends(require_csrf)])
async def update_doctor(
    doctor_id: int,
    body: DoctorPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("doctors", "edit")),
):
    d = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shifokor topilmadi")

    before = _to_dict(d)
    data = body.model_dump(exclude_unset=True)
    for key in ("name", "specialty", "price", "active"):
        if key in data and data[key] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{key} bo'sh bo'lishi mumkin emas")
    for key in ("phone", "room"):
        if key in data:
            data[key] = (data[key] or "").strip() or None
    for k, v in data.items():
        setattr(d, k, v)
    await db.flush()

    after = _to_dict(d)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="update",
        detail=f"Shifokor tahrirlandi: {d.name}",
        ip=client_ip(request),
        before=before,
        after=after,
    )
    await publish("doctor.updated", after)
    return after


@router.delete("/{doctor_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_doctor(
    doctor_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("doctors", "delete")),
):
    d = (await db.execute(select(Doctor).where(Doctor.id == doctor_id))).scalar_one_or_none()
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shifokor topilmadi")
    linked = (
        await db.execute(select(func.count()).select_from(User).where(User.doctor_id == doctor_id))
    ).scalar_one()
    if linked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Shifokorga login akkaunt bog'langan — avval Xodimlar bo'limida akkauntni o'chiring yoki shifokorni nofaol qiling",
        )
    before = _to_dict(d)
    await db.delete(d)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Shifokorning qabullari bor — o'chirish o'rniga nofaol qiling",
        ) from exc
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="delete",
        detail=f"Shifokor o'chirildi: {d.name}",
        ip=client_ip(request),
        before=before,
    )
    await publish("doctor.deleted", {"id": doctor_id})
