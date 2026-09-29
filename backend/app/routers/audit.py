"""Audit router — o'zgarmas (append-only) jurnal."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip, get_current_user, require_csrf, require_permission
from ..models import AuditLog, Role, User
from ..security.audit import log_action, verify_audit_chain

router = APIRouter()


class AuditIn(BaseModel):
    """Faqat frontend telemetriyasi uchun; user/role sessiyadan olinadi."""
    action: Literal["view", "export", "print", "create", "update", "delete", "login"]
    detail: str = Field(..., max_length=500)


def _to_dict(a: AuditLog) -> dict:
    return {
        "id": a.id,
        "user": a.user,
        "role": a.role,
        "action": a.action,
        "detail": a.detail,
        "ts": int(a.created_at.timestamp() * 1000) if a.created_at else None,
    }


@router.get("")
async def list_audit(
    action: str | None = Query(None, max_length=32),
    limit: int = Query(300, ge=1, le=500),
    offset: int = Query(0, ge=0, le=100000),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit).offset(offset)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_dict(a) for a in rows]


@router.get("/verify")
async def verify_audit(
    from_id: int | None = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    res = await verify_audit_chain(db, from_id)
    return res


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_audit_entry(
    body: AuditIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("audit", "write")),
):
    await log_action(
        db, user=user.fullname, role=user.role_key,
        action=body.action, detail=body.detail, ip=client_ip(request),
    )
    return {"ok": True}


@router.post("/clear", dependencies=[Depends(require_csrf)])
async def clear_audit():
    """Audit jurnali o'chirilmaydi. Arxivlash: scripts/audit_archive.py (superuser)."""
    raise HTTPException(410, "Audit jurnalini tozalash o'chirilgan (append-only)")
