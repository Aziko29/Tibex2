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
from ..integration_access import filter_for_role, serialize_integration
from ..inventory_validation import validate_integration
from ..models import Integration, Role, User
from ..realtime import publish
from ..security.audit import log_action
from ..security.ssrf import check_connectivity, validate_integration_url

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


def _to_dict(i: Integration) -> dict:
    """Yagona serializator (bootstrap bilan bir xil). api_key hech qachon qaytmaydi."""
    return serialize_integration(i)


async def _check_endpoint(endpoint: str, type_: str) -> None:
    try:
        await validate_integration_url(endpoint, type_)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("")
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("integrations", "view")),
):
    rows = (await db.execute(select(Integration).order_by(Integration.id))).scalars().all()
    return [serialize_integration(i, user.role_key) for i in filter_for_role(rows, user.role_key)]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_integration(
    body: IntegrationIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("integrations", "create")),
):
    if body.type.strip().lower() == "sms":
        raise HTTPException(status.HTTP_410_GONE, "SMS integratsiyasi o'chirilgan")
    data = validate_integration(body.model_dump())
    if data["type"] == "sms":
        raise HTTPException(status.HTTP_410_GONE, "SMS integratsiyasi o'chirilgan")
    if data["endpoint"]:
        await _check_endpoint(data["endpoint"], data["type"])

    i = Integration(
        name=data["name"],
        type=data["type"],
        provider=data["provider"] or None,
        version=data["version"] or None,
        endpoint=data["endpoint"] or None,
        api_key=data["api_key"] or None,
        status=data["status"],
        notes=data["notes"] or None,
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

    raw = body.model_dump(exclude_unset=True)
    if (i.type or "").lower() == "sms" or str(raw.get("type") or "").strip().lower() == "sms":
        raise HTTPException(status.HTTP_410_GONE, "SMS integratsiyasi o'chirilgan")
    data = validate_integration(raw, partial=True)
    if "endpoint" in data or "type" in data:
        endpoint = data["endpoint"] if "endpoint" in data else (i.endpoint or "")
        if endpoint:
            await _check_endpoint(endpoint, data.get("type", i.type))
    # Bo'sh api_key = saqlangan kalitni o'chirish
    if "api_key" in data and not data["api_key"]:
        data["api_key"] = None
    for key in ("provider", "version", "endpoint", "notes"):
        if key in data and not data[key]:
            data[key] = None

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
    """Haqiqiy ulanish tekshiruvi: tekshirilgan IP ga TCP (https bo'lsa TLS).
    HL7 darajasidagi muloqot emas."""
    i = (
        await db.execute(select(Integration).where(Integration.id == integration_id))
    ).scalar_one_or_none()
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Integratsiya topilmadi")
    if (i.type or "").lower() == "sms":
        raise HTTPException(status.HTTP_410_GONE, "SMS integratsiyasi o'chirilgan")

    if not i.endpoint:
        ok, reason = False, "Endpoint ko'rsatilmagan"
    else:
        ok, reason = await check_connectivity(i.endpoint, i.type)
    if ok:
        i.last_sync = datetime.now(timezone.utc)
        i.status = "connected"
    else:
        i.status = "error"
    await db.flush()
    after = _to_dict(i)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail=(
            f"Integratsiya sinxronlandi: {i.name}" if ok
            else f"Integratsiya ulanishi muvaffaqiyatsiz: {i.name} — {reason}"
        ),
        ip=client_ip(request), after=after,
    )
    await publish("integration.updated", after)
    return {**after, "sync_ok": ok, "sync_error": reason}


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
