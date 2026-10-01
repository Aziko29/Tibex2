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
        # TIBEX_ERROR_TRACKER_QUIET_v1: har bir 401/403/404 ni WebSocket'ga
        # tarqatish keraksiz shovqin — muddati o'tgan cookie, noto'g'ri URL,
        # begona bot urinishlari — bu NORMAL ish jarayonining bir qismi.
        # Ilgari 100 ta admin ochiq bo'lsa, har 401 sabab har biriga xabar
        # yuborilardi (WS flood va ekran pirpirashi). Endi faqat 5xx va 429
        # (rate-limit) tarqatiladi. Xatolar buferi (xotirada) baribir TO'LIQ
        # saqlanadi — /api/monitoring/errors orqali ko'rish mumkin.
        if response.status_code >= 500 or response.status_code == 429:
            try:
                from ..realtime import publish
                level = "critical" if response.status_code >= 500 else "warn"
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
