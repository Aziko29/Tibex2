from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
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


class DoctorIn(BaseModel):
    name: str
    specialty: str
    phone: str = ""
    price: int = 0
    room: str = ""


class DoctorPatch(BaseModel):
    name: str | None = None
    specialty: str | None = None
    phone: str | None = None
    price: int | None = None
    room: str | None = None
    active: bool | None = None


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
    for k, v in body.model_dump(exclude_unset=True).items():
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
    before = _to_dict(d)
    await db.delete(d)
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
