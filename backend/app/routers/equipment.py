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
from ..models import Equipment, Role, User
from ..realtime import publish
from ..security.audit import log_action

router = APIRouter()


class EquipmentIn(BaseModel):
    name: str
    category: str = "Analizator"
    department: str = "Laboratoriya"
    manufacturer: str = ""
    model: str = ""
    serial: str = ""
    location: str = ""
    status: str = "working"
    purchase_date: str = ""
    warranty: str = ""
    last_service: str = ""
    next_service: str = ""
    notes: str = ""


class EquipmentPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    department: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    serial: str | None = None
    location: str | None = None
    status: str | None = None
    purchase_date: str | None = None
    warranty: str | None = None
    last_service: str | None = None
    next_service: str | None = None
    notes: str | None = None


def _to_dict(e: Equipment) -> dict:
    return {
        "id": e.id,
        "name": e.name,
        "category": e.category,
        "department": e.department,
        "manufacturer": e.manufacturer,
        "model": e.model,
        "serial": e.serial,
        "location": e.location,
        "status": e.status,
        "purchase_date": e.purchase_date,
        "warranty": e.warranty,
        "last_service": e.last_service,
        "next_service": e.next_service,
        "notes": e.notes,
    }


@router.get("")
async def list_equipment(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("equipment", "view")),
):
    rows = (await db.execute(select(Equipment).order_by(Equipment.id))).scalars().all()
    return [_to_dict(e) for e in rows]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_equipment(
    body: EquipmentIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("equipment", "create")),
):
    e = Equipment(**body.model_dump())
    db.add(e)
    await db.flush()
    await db.refresh(e)
    after = _to_dict(e)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="create",
        detail=f"Yangi uskuna: {e.name} ({e.department})",
        ip=client_ip(request), after=after,
    )
    await publish("equipment.created", after)
    return after


@router.patch("/{equipment_id}", dependencies=[Depends(require_csrf)])
async def update_equipment(
    equipment_id: int,
    body: EquipmentPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("equipment", "edit")),
):
    e = (
        await db.execute(select(Equipment).where(Equipment.id == equipment_id))
    ).scalar_one_or_none()
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Uskuna topilmadi")
    before = _to_dict(e)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    await db.flush()
    after = _to_dict(e)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail=f"Uskuna tahrirlandi: {e.name}",
        ip=client_ip(request), before=before, after=after,
    )
    await publish("equipment.updated", after)
    return after


@router.delete("/{equipment_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_equipment(
    equipment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("equipment", "delete")),
):
    e = (
        await db.execute(select(Equipment).where(Equipment.id == equipment_id))
    ).scalar_one_or_none()
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Uskuna topilmadi")
    before = _to_dict(e)
    await db.delete(e)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="delete",
        detail=f"Uskuna o'chirildi: {e.name}",
        ip=client_ip(request), before=before,
    )
    await publish("equipment.deleted", {"id": equipment_id})
