"""TIBEX Camera Fortress — backend xavfsizlik routeri.

Barcha camera amallarini himoyalaydi:
  • Token generatsiya (300s, multi-use)
  • Session binding (user+IP+UA)
  • HMAC signed audit
  • Auto-disable (20 fail / 60s)
  • Admin alerts via WebSocket
"""
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip, get_current_user, require_csrf, require_permission
from ..models import AuditLog, Role, User
from ..realtime import publish
from ..security.audit import log_action
from ..security.keys import derive

router = APIRouter()

# ─── In-memory camera sessions (production'da Redis bo'lishi kerak) ───
_SESSIONS: dict[str, dict[str, Any]] = {}
_FAILURES: dict[str, list[float]] = {}

TOKEN_TTL_SECONDS = 300
MAX_FAILURES_WINDOW = 60
MAX_FAILURES = 20
FAIL_COOLDOWN = 3
_DISABLED_UNTIL: dict[int, float] = {}


def _cleanup():
    """Eskirganlarni tozalash."""
    now = time.time()
    expired = [t for t, s in _SESSIONS.items() if s["expires_at"] < now]
    for t in expired:
        del _SESSIONS[t]
    for uid in list(_DISABLED_UNTIL.keys()):
        if _DISABLED_UNTIL[uid] < now:
            del _DISABLED_UNTIL[uid]


def _fingerprint(request: Request) -> str:
    """Session binding fingerprint."""
    ip = client_ip(request) or "?"
    ua = request.headers.get("user-agent", "")
    raw = f"{ip}|{ua}"
    return hmac.new(
        derive("camera"),
        raw.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]


def _sign_event(payload: str) -> str:
    """HMAC event signature."""
    return hmac.new(
        derive("camera"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _is_disabled(user_id: int) -> tuple[bool, int]:
    """Foydalanuvchi disable qilinganmi?"""
    now = time.time()
    if user_id in _DISABLED_UNTIL:
        until = _DISABLED_UNTIL[user_id]
        if until > now:
            return True, int(until - now)
    return False, 0


def _record_failure(user_id: int) -> int:
    """Failure yozish. Qaytaradi: qolgan urinishlar."""
    now = time.time()
    arr = _FAILURES.setdefault(user_id, [])
    arr = [t for t in arr if now - t < MAX_FAILURES_WINDOW]
    arr.append(now)
    _FAILURES[user_id] = arr
    return max(0, MAX_FAILURES - len(arr))


# ═══════════════════════════════════════════════════════════════
# SCHEMAS
# ═══════════════════════════════════════════════════════════════
class CameraSessionIn(BaseModel):
    action: str = Field(default="open", max_length=32)


class CameraSessionOut(BaseModel):
    ok: bool
    token: str
    ttl: int
    signature: str
    message: str


class CameraVerifyIn(BaseModel):
    token: str = Field(..., min_length=16, max_length=128)
    barcode: str = Field(..., min_length=1, max_length=256)


class CameraVerifyOut(BaseModel):
    ok: bool
    message: str
    next_action: str | None = None


class CameraAlertIn(BaseModel):
    kind: str = Field(..., max_length=64)
    detail: str = Field(default="", max_length=512)


class CameraAdminDisableIn(BaseModel):
    user_id: int
    minutes: int = Field(default=30, ge=1, le=1440)
    reason: str = Field(default="", max_length=256)


# ═══════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════
@router.post("/session", response_model=CameraSessionOut,
             dependencies=[Depends(require_csrf)])
async def create_camera_session(
    body: CameraSessionIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("lab", "edit")),
):
    """Kamera sessiyasi uchun token generatsiya qiladi."""
    _cleanup()

    dis, remain = _is_disabled(user.id)
    if dis:
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Kamera vaqtincha bloklangan. {remain} sekund kuting.",
        )

    token = secrets.token_urlsafe(32)
    fp = _fingerprint(request)
    now = time.time()

    _SESSIONS[token] = {
        "user_id": user.id,
        "ip": client_ip(request) or "?",
        "ua_hash": fp,
        "expires_at": now + TOKEN_TTL_SECONDS,
        "used": False,
        "created_at": now,
        "action": body.action,
    }

    payload = f"{token}|{user.id}|{fp}|{int(now)}"
    signature = _sign_event(payload)

    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="login",
        detail=f"📷 Kamera sessiyasi ochildi (action={body.action})",
        ip=client_ip(request),
    )

    return CameraSessionOut(
        ok=True,
        token=token,
        ttl=TOKEN_TTL_SECONDS,
        signature=signature,
        message="Kamera sessiyasi tayyor",
    )


@router.post("/verify", response_model=CameraVerifyOut,
             dependencies=[Depends(require_csrf)])
async def verify_camera_scan(
    body: CameraVerifyIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("lab", "edit")),
):
    """Barcode o'qilganda tokenni tekshiradi."""
    _cleanup()

    session = _SESSIONS.get(body.token)
    if session is None:
        remaining = _record_failure(user.id)
        await _alert_admin(db, user, "camera.token_invalid",
                           f"Yaroqsiz camera token (user={user.id}, code={body.barcode[:20]})")
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"Camera token yaroqsiz. Qolgan urinish: {remaining}",
        )

    if session["expires_at"] < time.time():
        remaining = _record_failure(user.id)
        await _alert_admin(db, user, "camera.token_expired",
                           f"Camera token muddati o'tdi (user={user.id})")
        raise HTTPException(
            status.HTTP_410_GONE,
            "Camera token muddati o'tgan",
        )

    if session["user_id"] != user.id:
        remaining = _record_failure(user.id)
        await _alert_admin(db, user, "camera.user_mismatch",
                           f"Camera token boshqa user (owner={session['user_id']}, caller={user.id})")
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Camera token boshqa foydalanuvchiga tegishli",
        )

    fp = _fingerprint(request)
    if session["ua_hash"] != fp:
        remaining = _record_failure(user.id)
        await _alert_admin(db, user, "camera.fingerprint_mismatch",
                           f"Camera fingerprint farq qiladi (user={user.id})")
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Sessiya xavfsizlik tekshiruvidan o'tmadi",
        )

    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="update",
        detail=f"📷 Barcode skanerlandi: {body.barcode[:64]}",
        ip=client_ip(request),
    )

    _FAILURES.pop(user.id, None)

    return CameraVerifyOut(
        ok=True,
        message="Skanerlandi",
        next_action="fetch_lab_order",
    )


# ═══════════════════════════════════════════════════════════════
# FIX: /alert endpoint — require_permission Depends() ichida
# ═══════════════════════════════════════════════════════════════
@router.post("/alert", dependencies=[
    Depends(require_csrf),
    Depends(require_permission("camera", "alert")),
])
async def report_camera_alert(
    body: CameraAlertIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Frontend camera muammo haqida xabar yuboradi → admin'ga WS."""
    await _alert_admin(db, user, body.kind, body.detail)
    return {"ok": True}


async def _alert_admin(db: AsyncSession, user: User, kind: str, detail: str):
    """Admin'ga alert yuborish (WebSocket)."""
    alert = {
        "ts": int(time.time() * 1000),
        "level": "warn",
        "title": f"📷 Camera: {kind}",
        "detail": f"{user.fullname}: {detail}",
        "source": "camera",
        "user_id": user.id,
        "user_name": user.fullname,
    }
    try:
        await publish("camera.alert", alert)
        await publish("alert.created", alert)
    except Exception:
        pass


@router.get("/status")
async def camera_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("lab", "edit")),
):
    """Joriy foydalanuvchi camera holati."""
    _cleanup()
    dis, remain = _is_disabled(user.id)
    failures = len([t for t in _FAILURES.get(user.id, [])
                    if time.time() - t < MAX_FAILURES_WINDOW])
    active = sum(1 for s in _SESSIONS.values()
                 if s["user_id"] == user.id and not s["used"]
                 and s["expires_at"] > time.time())
    return {
        "ok": True,
        "disabled": dis,
        "disabled_for": remain,
        "failures_last_minute": failures,
        "max_failures": MAX_FAILURES,
        "active_sessions": active,
    }


# ═══════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════
@router.post("/admin/disable", dependencies=[Depends(require_csrf)])
async def admin_disable_camera(
    body: CameraAdminDisableIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("settings", "edit")),
):
    """Admin foydalanuvchi uchun kamerani vaqtincha bloklaydi."""
    until = time.time() + body.minutes * 60
    _DISABLED_UNTIL[body.user_id] = until

    for t, s in list(_SESSIONS.items()):
        if s["user_id"] == body.user_id:
            del _SESSIONS[t]

    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="update",
        detail=f"📷 Kamera bloklandi: user_id={body.user_id} ({body.minutes} daqiqa) — {body.reason}",
        ip=client_ip(request),
    )

    await _alert_admin(db, actor, "camera.admin_disable",
                       f"user_id={body.user_id} bloklandi ({body.minutes} daq)")

    return {
        "ok": True,
        "user_id": body.user_id,
        "until_ts": int(until),
        "minutes": body.minutes,
    }


@router.post("/admin/enable", dependencies=[Depends(require_csrf)])
async def admin_enable_camera(
    body: CameraAdminDisableIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("settings", "edit")),
):
    """Admin blokni olib tashlaydi."""
    _DISABLED_UNTIL.pop(body.user_id, None)
    _FAILURES.pop(body.user_id, None)

    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="update",
        detail=f"📷 Kamera blokdan chiqarildi: user_id={body.user_id}",
        ip=client_ip(request),
    )

    return {"ok": True, "user_id": body.user_id}


@router.get("/admin/audit")
async def admin_camera_audit(
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    """Admin: barcha camera urinishlari."""
    rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.detail.like("%📷%"))
            .order_by(AuditLog.id.desc())
            .limit(min(limit, 500))
        )
    ).scalars().all()

    return [
        {
            "id": r.id,
            "ts": int(r.created_at.timestamp() * 1000) if r.created_at else None,
            "user": r.user,
            "role": r.role,
            "action": r.action,
            "detail": r.detail,
            "ip": r.ip,
        }
        for r in rows
    ]