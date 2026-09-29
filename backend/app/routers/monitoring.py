"""TIBEX Monitoring — real-time system health + error tracking."""
import asyncio
import json
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from .. import __version__
from ..deps import get_current_user, require_permission, require_csrf
from ..models import AuditLog, Integration, Role, Session as DBSession, User
from ..redis_client import get_redis
from ..realtime import manager, publish
from ..security.netutil import client_ip
from ..security.rate_limit import hit

router = APIRouter()

# ─── In-memory error ring buffer ───
_ERROR_BUFFER: deque = deque(maxlen=200)
_ALERT_BUFFER: deque = deque(maxlen=100)
_START_TIME = time.time()

# Error rate uchun
_REQUEST_STATS = {"total": 0, "errors": 0, "last_minute_errors": deque(maxlen=200)}


def record_error(exc: Exception, method: str, path: str, status_code: int = 500, user: str = "?", ip: str = "?"):
    """Xatoni buferga yozish + WebSocket orqali yuborish."""
    entry = {
        "ts": int(time.time() * 1000),
        "method": method,
        "path": path,
        "status": status_code,
        "type": type(exc).__name__ if exc else "Unknown",
        # Exception text can contain SQL parameters, provider URLs, or patient data.
        "message": "Request failed" if exc else "",
        "user": user,
        "ip": ip,
    }
    _ERROR_BUFFER.append(entry)
    _REQUEST_STATS["errors"] += 1
    _REQUEST_STATS["last_minute_errors"].append(time.time())
    return entry


def record_frontend_error(item: dict, ip: str = "?") -> dict:
    """Brauzerdan kelgan JS xatosini buferga yozish (TIBEX_FRONTEND_ERROR_REPORT_v1)."""
    entry = {
        "ts": item.get("ts") or int(time.time() * 1000),
        "method": "FRONTEND",
        "path": str(item.get("url", ""))[:200],
        "status": 0,
        "type": f"JS:{item.get('type', 'error')}",
        "message": str(item.get("message", ""))[:500],
        "user": "?",
        "ip": ip,
    }
    _ERROR_BUFFER.append(entry)
    _REQUEST_STATS["errors"] += 1
    _REQUEST_STATS["last_minute_errors"].append(time.time())
    return entry


def record_alert(level: str, title: str, detail: str, source: str = "system"):
    """Alert yozish (info/warn/critical)."""
    entry = {
        "ts": int(time.time() * 1000),
        "level": level,
        "title": title,
        "detail": detail,
        "source": source,
    }
    _ALERT_BUFFER.append(entry)
    return entry


# ═══════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════
@router.get("/health")
async def health_detail(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("settings", "view")),
):
    """To'liq tizim holati."""
    result = {
        "ts": int(time.time() * 1000),
        "uptime_seconds": int(time.time() - _START_TIME),
        "db": {"status": "down"},
        "redis": {"status": "down"},
        "websocket": {"clients": len(manager._clients)},
        "sessions": {"active": 0, "total_today": 0},
        "users": {"total": 0, "active": 0},
        "requests": {
            "total": _REQUEST_STATS["total"],
            "errors": _REQUEST_STATS["errors"],
            "errors_last_minute": len([
                t for t in _REQUEST_STATS["last_minute_errors"]
                if time.time() - t < 60
            ]),
        },
    }

    # DB
    try:
        t0 = time.time()
        await db.execute(text("SELECT 1"))
        result["db"] = {
            "status": "up",
            "latency_ms": round((time.time() - t0) * 1000, 2),
        }
    except Exception as e:
        result["db"] = {"status": "down", "error": str(e)[:200]}

    # Redis
    try:
        r = get_redis()
        if r is not None:
            t0 = time.time()
            await r.ping()
            result["redis"] = {
                "status": "up",
                "latency_ms": round((time.time() - t0) * 1000, 2),
            }
    except Exception as e:
        result["redis"] = {"status": "down", "error": str(e)[:200]}

    # Sessions + Users
    try:
        now = datetime.now(timezone.utc)
        active = (await db.execute(
            select(func.count()).select_from(DBSession).where(
                DBSession.revoked_at.is_(None),
                DBSession.expires_at > now,
            )
        )).scalar() or 0
        result["sessions"]["active"] = active

        total_users = (await db.execute(
            select(func.count()).select_from(User)
        )).scalar() or 0
        active_users = (await db.execute(
            select(func.count()).select_from(User).where(User.active == True)  # noqa
        )).scalar() or 0
        result["users"] = {"total": total_users, "active": active_users}
    except Exception:
        pass

    # Umumiy holat
    all_ok = (
        result["db"]["status"] == "up" and
        (result["redis"]["status"] in ("up", "down")) and
        result["requests"]["errors_last_minute"] < 10
    )
    result["overall"] = "healthy" if all_ok else "degraded"


    # TIBEX_FIX: sysVersion ko'rsatishi uchun
    result["version"] = __version__
    return result


@router.get("/errors")
async def get_errors(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    """Oxirgi xatolar."""
    items = list(_ERROR_BUFFER)[-limit:]
    items.reverse()
    return {"count": len(items), "items": items}


@router.post("/frontend-errors")
async def report_frontend_errors(request: Request):
    """Brauzerdagi (frontend) JS xatolarini qabul qilib, buferga yozadi.

    Ataylab autentifikatsiya/CSRF talab qilinmaydi: bu bir tomonlama
    telemetriya bo'lib, login sahifasida ham (sessiya ochilmasdan turib)
    ishlashi kerak va hech qanday holatni o'zgartirmaydi — faqat
    xotiradagi xato buferiga yozadi.
    """
    ip = client_ip(request) or "?"
    await hit(f"rl:fe:{ip}", 30, 60)
    try:
        from ..security.input_fortress import read_body_limited
        raw = await read_body_limited(request, 16 * 1024)
        payload = json.loads(raw)
    except HTTPException:
        raise
    except Exception:
        return {"ok": False, "received": 0}

    errors = payload.get("errors") if isinstance(payload, dict) else None
    if not isinstance(errors, list):
        return {"ok": False, "received": 0}

    n = 0
    for item in errors[:10]:
        if isinstance(item, dict):
            record_frontend_error(item, ip=ip)
            n += 1
    return {"ok": True, "received": n}


@router.get("/alerts")
async def get_alerts(
    limit: int = Query(30, ge=1, le=200),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    """Oxirgi alertlar."""
    items = list(_ALERT_BUFFER)[-limit:]
    items.reverse()
    return {"count": len(items), "items": items}


@router.post(
    "/alerts/test",
    dependencies=[Depends(require_csrf)],
)
async def test_alert(
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("settings", "edit")),
):
    """Test alert yuborish."""
    a = record_alert("info", "Test alert", f"Test xabari ({user.fullname})", source="manual")
    await publish("alert.created", a)
    return a


@router.get("/integrations")
async def integration_health(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("integrations", "view")),
):
    """Barcha integratsiyalar holati."""
    rows = (await db.execute(select(Integration))).scalars().all()
    items = []
    for i in rows:
        last = i.last_sync
        if last and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        hours_ago = None
        if last:
            hours_ago = round((datetime.now(timezone.utc) - last).total_seconds() / 3600, 1)
        items.append({
            "id": i.id,
            "name": i.name,
            "type": i.type,
            "provider": i.provider,
            "status": i.status,
            "last_sync_hours_ago": hours_ago,
            "healthy": i.status == "connected" and (hours_ago is None or hours_ago < 24),
        })
    return {"count": len(items), "items": items}


@router.get("/activity")
async def recent_activity(
    limit: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    """Oxirgi harakatlar (audit)."""
    rows = (await db.execute(
        select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    )).scalars().all()
    return [
        {
            "id": a.id,
            "user": a.user,
            "role": a.role,
            "action": a.action,
            "detail": a.detail,
            "ts": int(a.created_at.timestamp() * 1000) if a.created_at else None,
        }
        for a in rows
    ]


@router.post(
    "/clear-errors",
    dependencies=[Depends(require_csrf)],
)
async def clear_errors(
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("audit", "clear")),
):
    """Xato buferini tozalash."""
    n = len(_ERROR_BUFFER)
    _ERROR_BUFFER.clear()
    return {"ok": True, "cleared": n}


# ═══════════════════════════════════════════════════════════
# SECURITY STATUS (yangi)
# ═══════════════════════════════════════════════════════════
@router.get("/security-status")
async def security_status(
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("settings", "view")),
):
    """Barcha himoya qatlamlari holati."""
    result = {"ts": int(time.time() * 1000)}

    # Threat detector
    try:
        from ..security.threat_detector import detector
        result["threat_detector"] = detector.stats()
    except Exception as e:
        result["threat_detector"] = {"error": str(e)[:100]}

    # Rate limiter
    try:
        from ..security.advanced_rate_limit import limiter
        result["rate_limiter"] = limiter.stats()
    except Exception as e:
        result["rate_limiter"] = {"error": str(e)[:100]}

    # Circuit breaker
    try:
        from ..security.circuit_breaker import breaker
        result["circuit_breaker"] = breaker.status()
    except Exception as e:
        result["circuit_breaker"] = {"error": str(e)[:100]}

    return result


@router.get("/threat-map")
async def threat_map(
    limit: int = Query(20, ge=1, le=200),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    """Eng xavfli IP'lar."""
    try:
        from ..security.threat_detector import detector
        profiles = sorted(
            detector._profiles.items(),
            key=lambda x: x[1].risk_score,
            reverse=True,
        )[:limit]
        now = time.time()
        return [
            {
                "ip": ip[:20] + "***" if len(ip) > 20 else ip,
                "risk_score": round(p.risk_score, 1),
                "requests": p.requests,
                "failed_logins": p.failed_logins,
                "suspicious_hits": p.suspicious_hits,
                "blacklisted": p.blacklisted_until > now,
                "blacklist_remaining": max(0, int(p.blacklisted_until - now)),
            }
            for ip, p in profiles
        ]
    except Exception as e:
        return {"error": str(e)[:200]}
