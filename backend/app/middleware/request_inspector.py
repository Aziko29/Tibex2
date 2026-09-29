"""Request Inspector — barcha himoya qatlamlarini birlashtiruvchi middleware.

Hech qanday modul ishlamasa ham — asosiy himoya ishlaydi.
Redis/DB bo'lmasa — xotirada ishlaydi.
"""
import logging
import time
from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("tibex.inspector")


# Optional imports (fail-safe)
try:
    from ..security.threat_detector import detector
    _THREAT_OK = True
except Exception as e:
    log.warning("Threat detector yuklanmadi: %s", e)
    detector = None
    _THREAT_OK = False

try:
    from ..security.advanced_rate_limit import limiter
    _RL_OK = True
except Exception as e:
    log.warning("Rate limiter yuklanmadi: %s", e)
    limiter = None
    _RL_OK = False

try:
    from ..security.input_fortress import fortress_validate
    _INPUT_OK = True
except Exception as e:
    log.warning("Input fortress yuklanmadi: %s", e)
    fortress_validate = None
    _INPUT_OK = False

try:
    from ..security.circuit_breaker import breaker
    _CB_OK = True
except Exception as e:
    log.warning("Circuit breaker yuklanmadi: %s", e)
    breaker = None
    _CB_OK = False


# Endpoint'lar (skip qilinadi)
SKIP_PATHS = {
    "/api/health",
    "/api/monitoring/health",
    "/api/ws",
    "/favicon.ico",
}


def _client_ip(request: Request) -> str:
    # Never trust a caller-supplied X-Forwarded-For. The shared helper only
    # reads it when request.client is in the configured trusted proxy ranges.
    from ..deps import client_ip
    return client_ip(request) or "?"


async def request_inspector_middleware(request: Request, call_next):
    """Aqlli so'rov inspektori. Hech qachon crash qilmaydi."""
    t0 = time.time()
    path = request.url.path
    
    # ─── Skip statik va health ───
    if path in SKIP_PATHS or path.startswith("/static/"):
        return await call_next(request)
    
    ip = _client_ip(request)
    
    # ─── QATLAM 1: Blacklist tekshiruvi ───
    if _THREAT_OK and detector:
        try:
            is_bl, remaining = detector.is_blacklisted(ip)
            if is_bl:
                return JSONResponse(
                    status_code=403,
                    content={
                        "detail": "Kirish bloklangan. Keyinroq urinib ko'ring.",
                        "retry_in": int(remaining),
                    },
                )
        except Exception as e:
            log.warning("Blacklist tekshiruvi xatosi: %s", e)
    
    # ─── QATLAM 2: Rate limit ───
    if _RL_OK and limiter:
        try:
            # User ID olishga harakat (cookie'dan emas — header'dan)
            # Sabab: bu middleware deps.dan oldin ishlaydi
            user_id = None
            role = "default"
            # State'ga oldindan yozilgan bo'lsa ishlatamiz
            if hasattr(request.state, "user_id"):
                user_id = request.state.user_id
            if hasattr(request.state, "role"):
                role = request.state.role
            
            await limiter.check(request, user_id=user_id, role=role)
        except Exception as e:
            # HTTPException bo'lsa — o'sha qaytadi
            from fastapi import HTTPException
            if isinstance(e, HTTPException):
                return JSONResponse(
                    status_code=e.status_code,
                    content={"detail": e.detail},
                )
            log.warning("Rate limit xatosi: %s", e)
            # Production'da fail-closed (rate_limit.py kabi); boshqa muhitda fail-open.
            from ..config import get_settings
            if get_settings().is_prod:
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Xavfsizlik xizmati vaqtincha mavjud emas."},
                    headers={"Retry-After": "30"},
                )
    
    # ─── QATLAM 3: Input validatsiya ───
    body_sample = ""
    if _INPUT_OK and fortress_validate:
        try:
            body_data = await fortress_validate(request)
            if body_data:
                body_sample = str(body_data)[:500]
        except Exception as e:
            from fastapi import HTTPException
            if isinstance(e, HTTPException):
                return JSONResponse(
                    status_code=e.status_code,
                    content={"detail": e.detail},
                )
            log.warning("Input validation xatosi: %s", e)
    
    # ─── So'rovni bajarish ───
    try:
        response = await call_next(request)
    except Exception as e:
        # Threat detector'ga xato sifatida yozish
        if _THREAT_OK and detector:
            try:
                detector.record_request(
                    ip=ip,
                    path=path,
                    method=request.method,
                    status_code=500,
                    user_agent=request.headers.get("user-agent", ""),
                    body_sample=body_sample,
                    authenticated=bool(getattr(request.state, "authenticated", False)),
                )
            except Exception:
                pass
        raise
    
    # ─── QATLAM 4: Threat detector'ga yozish ───
    if _THREAT_OK and detector:
        try:
            detector.record_request(
                ip=ip,
                path=path,
                method=request.method,
                status_code=response.status_code,
                user_agent=request.headers.get("user-agent", ""),
                body_sample=body_sample,
                authenticated=bool(getattr(request.state, "authenticated", False)),
            )
        except Exception as e:
            log.warning("Threat record xatosi: %s", e)
    
    # ─── Response headers (safety) ───
    try:
        response.headers["X-Response-Time"] = f"{(time.time() - t0) * 1000:.1f}ms"
    except Exception:
        pass
    
    return response
