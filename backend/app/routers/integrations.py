from datetime import datetime, timezone

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
from ..models import Integration, Role, User
from ..realtime import publish
from ..security.audit import log_action
from ..security.ssrf import validate_https_url

router = APIRouter()


class IntegrationIn(BaseModel):
    name: str
    type: str = "other"
    provider: str = ""
    version: str = ""
    endpoint: str = ""
    api_key: str = ""
    status: str = "pending"
    notes: str = ""


class IntegrationPatch(BaseModel):
    name: str | None = None
    type: str | None = None
    provider: str | None = None
    version: str | None = None
    endpoint: str | None = None
    api_key: str | None = None
    status: str | None = None
    notes: str | None = None


def _to_dict(i: Integration, mask_key: bool = True) -> dict:
    """api_key ni mask qilamiz — xavfsizlik uchun. Haqiqiy kalit faqat
    PATCH orqali yuboriladi, list/GET da hech qachon ko'rinmaydi."""
    sms_disabled = str(i.type or "").lower() == "sms"
    return {
        "id": i.id,
        "name": i.name,
        "type": i.type,
        "provider": i.provider,
        "version": i.version,
        "endpoint": i.endpoint,
        "api_key": None if mask_key or sms_disabled else i.api_key,
        "has_api_key": False if sms_disabled else bool(i.api_key),
        "status": "disabled" if sms_disabled else i.status,
        "notes": i.notes,
        "last_sync": int(i.last_sync.timestamp() * 1000) if i.last_sync else None,
    }


@router.get("")
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("integrations", "view")),
):
    rows = (await db.execute(select(Integration).order_by(Integration.id))).scalars().all()
    return [_to_dict(i) for i in rows]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_integration(
    body: IntegrationIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("integrations", "create")),
):
    if body.type.lower() == "sms":
        raise HTTPException(status.HTTP_410_GONE, "SMS integratsiyasi o'chirilgan")
    if body.endpoint:
        try:
            await validate_https_url(body.endpoint)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    i = Integration(
        name=body.name,
        type=body.type,
        provider=body.provider or None,
        version=body.version or None,
        endpoint=body.endpoint or None,
        api_key=body.api_key or None,
        status=body.status,
        notes=body.notes or None,
    )
    db.add(i)
    await db.flush()
    await db.refresh(i)
    after = _to_dict(i)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="create",
        detail=f"Yangi integratsiya: {i.name} ({i.type})",
        ip=client_ip(request), after=after,
    )
    await publish("integration.created", after)
    return after


@router.patch("/{integration_id}", dependencies=[Depends(require_csrf)])
async def update_integration(
    integration_id: int,
    body: IntegrationPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("integrations", "edit")),
):
    i = (
        await db.execute(select(Integration).where(Integration.id == integration_id))
    ).scalar_one_or_none()
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Integratsiya topilmadi")

    data = body.model_dump(exclude_unset=True)
    if (i.type or "").lower() == "sms" or str(data.get("type", "")).lower() == "sms":
        raise HTTPException(status.HTTP_410_GONE, "SMS integratsiyasi o'chirilgan")
    if "endpoint" in data and data["endpoint"]:
        try:
            await validate_https_url(data["endpoint"])
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    before = _to_dict(i)
    for k, v in data.items():
        setattr(i, k, v)
    await db.flush()
    after = _to_dict(i)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail=f"Integratsiya tahrirlandi: {i.name}",
        ip=client_ip(request), before=before, after=after,
    )
    await publish("integration.updated", after)
    return after


@router.post("/{integration_id}/sync", dependencies=[Depends(require_csrf)])
async def sync_integration(
    integration_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("integrations", "edit")),
):
    i = (
        await db.execute(select(Integration).where(Integration.id == integration_id))
    ).scalar_one_or_none()
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Integratsiya topilmadi")
    i.last_sync = datetime.now(timezone.utc)
    i.status = "connected"
    await db.flush()
    after = _to_dict(i)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail=f"Integratsiya sinxronlandi: {i.name}",
        ip=client_ip(request), after=after,
    )
    await publish("integration.updated", after)
    return after


@router.delete("/{integration_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_integration(
    integration_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("integrations", "delete")),
):
    i = (
        await db.execute(select(Integration).where(Integration.id == integration_id))
    ).scalar_one_or_none()
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Integratsiya topilmadi")
    before = _to_dict(i)
    await db.delete(i)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="delete",
        detail=f"Integratsiya o'chirildi: {i.name}",
        ip=client_ip(request), before=before,
    )
    await publish("integration.deleted", {"id": integration_id})
