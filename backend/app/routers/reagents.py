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
from ..models import Reagent, Role, User
from ..realtime import publish
from ..security.audit import log_action

router = APIRouter()


class ReagentIn(BaseModel):
    name: str
    category: str = "Gematologiya"
    unit: str = "ml"
    stock: float = 0
    min_stock: float = 0
    lot: str = ""
    expiry: str = ""
    supplier: str = ""
    notes: str = ""


class ReagentPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    unit: str | None = None
    stock: float | None = None
    min_stock: float | None = None
    lot: str | None = None
    expiry: str | None = None
    supplier: str | None = None
    notes: str | None = None


def _to_dict(r: Reagent) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "category": r.category,
        "unit": r.unit,
        "stock": r.stock,
        "min_stock": r.min_stock,
        "lot": r.lot,
        "expiry": r.expiry,
        "supplier": r.supplier,
        "notes": r.notes,
    }


@router.get("")
async def list_reagents(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("reagents", "view")),
):
    rows = (await db.execute(select(Reagent).order_by(Reagent.id))).scalars().all()
    return [_to_dict(r) for r in rows]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_reagent(
    body: ReagentIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("reagents", "create")),
):
    r = Reagent(**body.model_dump())
    db.add(r)
    await db.flush()
    await db.refresh(r)
    after = _to_dict(r)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="create",
        detail=f"Yangi reagent: {r.name} ({r.stock} {r.unit})",
        ip=client_ip(request), after=after,
    )
    await publish("reagent.created", after)
    return after


@router.patch("/{reagent_id}", dependencies=[Depends(require_csrf)])
async def update_reagent(
    reagent_id: int,
    body: ReagentPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("reagents", "edit")),
):
    r = (
        await db.execute(select(Reagent).where(Reagent.id == reagent_id))
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reagent topilmadi")
    before = _to_dict(r)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    await db.flush()
    after = _to_dict(r)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail=f"Reagent tahrirlandi: {r.name}",
        ip=client_ip(request), before=before, after=after,
    )
    await publish("reagent.updated", after)
    return after


@router.delete("/{reagent_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_reagent(
    reagent_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("reagents", "delete")),
):
    r = (
        await db.execute(select(Reagent).where(Reagent.id == reagent_id))
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reagent topilmadi")
    before = _to_dict(r)
    await db.delete(r)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="delete",
        detail=f"Reagent o'chirildi: {r.name}",
        ip=client_ip(request), before=before,
    )
    await publish("reagent.deleted", {"id": reagent_id})
