"""TIBEX Error Tracker — barcha 4xx/5xx javoblarni ushlaydi."""
import time
import logging
from fastapi import Request

from ..routers.monitoring import record_error, record_alert
from ..security.netutil import client_ip

log = logging.getLogger("tibex.error-tracker")


async def error_tracker_middleware(request: Request, call_next):
    """Har bir so'rovni kuzatadi, xato bo'lsa buferga yozadi + WebSocket orqali yuboradi."""
    from ..routers import monitoring

    t0 = time.time()
    try:
        response = await call_next(request)
    except Exception as exc:
        # Kutilmagan xato — 500
        entry = record_error(
            exc=exc,
            method=request.method,
            path=str(request.url.path),
            status_code=500,
            ip=client_ip(request) or "?",
        )
        try:
            from ..realtime import publish
            await publish("error.critical", entry)
            await publish("alert.created", record_alert(
                level="critical",
                title="Server xatosi (500)",
                detail=f"{request.method} {request.url.path} — {type(exc).__name__}",
                source="backend",
            ))
        except Exception:
            pass
        raise

    # 4xx/5xx ushlash
    monitoring._REQUEST_STATS["total"] += 1
    if response.status_code >= 400:
        entry = record_error(
            exc=None,
            method=request.method,
            path=str(request.url.path),
            status_code=response.status_code,
            ip=client_ip(request) or "?",
        )
        try:
            from ..realtime import publish
            # 5xx — critical, 401/403 — warn, boshqa — info
            if response.status_code >= 500:
                level = "critical"
            elif response.status_code in (401, 403):
                level = "warn"
            else:
                level = "info"
            await publish("error.created", entry)
            if response.status_code >= 500:
                await publish("alert.created", record_alert(
                    level=level,
                    title=f"Server xatosi ({response.status_code})",
                    detail=f"{request.method} {request.url.path}",
                    source="backend",
                ))
        except Exception:
            pass

    return response
