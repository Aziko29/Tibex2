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
from ..models import Role, Service, User
from ..realtime import publish
from ..security.audit import log_action

router = APIRouter()


class ServiceIn(BaseModel):
    code: str
    name: str
    category: str
    price: int = 0


class ServicePatch(BaseModel):
    code: str | None = None
    name: str | None = None
    category: str | None = None
    price: int | None = None
    active: bool | None = None


def _to_dict(s: Service) -> dict:
    return {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "category": s.category,
        "price": s.price,
        "active": s.active,
    }


@router.get("")
async def list_services(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("services", "view")),
):
    rows = (await db.execute(select(Service).order_by(Service.code))).scalars().all()
    return [_to_dict(s) for s in rows]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_service(
    body: ServiceIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("services", "create")),
):
    existing = (
        await db.execute(select(Service).where(Service.code == body.code))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu kod band")

    s = Service(
        code=body.code,
        name=body.name,
        category=body.category,
        price=body.price,
        active=True,
    )
    db.add(s)
    await db.flush()
    await db.refresh(s)

    after = _to_dict(s)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="create",
        detail=f"Yangi xizmat: {s.name} ({s.price:,} so'm)",
        ip=client_ip(request),
        after=after,
    )
    await publish("service.created", after)
    return after


@router.patch("/{service_id}", dependencies=[Depends(require_csrf)])
async def update_service(
    service_id: int,
    body: ServicePatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("services", "edit")),
):
    s = (
        await db.execute(select(Service).where(Service.id == service_id))
    ).scalar_one_or_none()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Xizmat topilmadi")

    before = _to_dict(s)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    await db.flush()

    after = _to_dict(s)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="update",
        detail=f"Xizmat tahrirlandi: {s.name}",
        ip=client_ip(request),
        before=before,
        after=after,
    )
    await publish("service.updated", after)
    return after


@router.delete("/{service_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_service(
    service_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("services", "delete")),
):
    s = (
        await db.execute(select(Service).where(Service.id == service_id))
    ).scalar_one_or_none()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Xizmat topilmadi")
    before = _to_dict(s)
    await db.delete(s)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="delete",
        detail=f"Xizmat o'chirildi: {s.name}",
        ip=client_ip(request),
        before=before,
    )
    await publish("service.deleted", {"id": service_id})
