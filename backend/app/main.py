"""TIBEX — FastAPI app yadrosi."""
import logging
import os
import stat
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import dispose as db_dispose
from .realtime import start_redis_listener, stop_redis_listener
from .redis_client import close_redis
from .security.csp import build_csp, make_nonce
from .security.local_only import LocalOnlyMiddleware, announce_once as _local_only_announce

from .routers import admin_danger
from .middleware.error_tracker import error_tracker_middleware
from .middleware.request_inspector import request_inspector_middleware
from .middleware.error_sanitize import sanitize_errors_middleware
from .routers import appointments
from .routers import audit as audit_router
from .routers import auth
from .routers import bootstrap as bootstrap_router
from .routers import doctors
from .routers import equipment
from .routers import export as export_router
from .routers import settings as settings_router
from .routers import integrations
from .routers import lab
from .routers import monitoring
from .routers import patient_otp
from .routers import patient_portal
from .routers import portal_telegram
from .routers import patients
from .routers import payments
from .routers import reagents
from .routers import roles
from .routers import services
from .routers import telegram as telegram_router
from .routers import users
from .routers import camera_security
from .routers import csp_reports
from .routers import ws
from . import observability
from .observability import request_id_middleware, setup_logging, setup_sentry

setup_logging()
setup_sentry()
log = logging.getLogger("tibex")


# TIBEX_ENV_PERMS_v1: .env fayli (agar mavjud bo'lsa — masalan Docker'siz
# lokal ishga tushirishda) faqat egasi tomonidan o'qilishi kerak. Agar u
# guruh/boshqalarga ham o'qilishi mumkin bo'lsa, bu — bir xil serverda
# ishlaydigan boshqa jarayon/foydalanuvchi barcha maxfiy kalitlarni
# (SECRET_KEY, PASSWORD_PEPPER va h.k.) o'qiy olishi mumkinligini bildiradi.
# Bloklamaymiz (ishlab chiqishda ba'zan umask sozlanmagan bo'lishi mumkin),
# lekin baland ovozda ogohlantiramiz.
def _warn_if_env_file_too_open() -> None:
    env_path = Path(".env")
    if not env_path.is_file():
        return
    if os.name != "posix":
        return  # Windows'da POSIX ruxsat bitlari ma'noga ega emas
    mode = stat.S_IMODE(env_path.stat().st_mode)
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        log.warning(
            "XAVFSIZLIK: .env fayli boshqa foydalanuvchilar uchun ham "
            "o'qilishi mumkin (huquq=%o). Tavsiya: chmod 600 .env",
            mode,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if int(os.getenv("WEB_CONCURRENCY", "1")) > 1:
        raise RuntimeError("Ko'p worker uchun holat Redis'ga ko'chirilishi kerak")
    # Validate the complete versioned key ring before accepting requests.
    from .security.crypto import _ring
    _ring._ensure()
    if s.is_prod and not s.redis_url:
        raise RuntimeError("TIBEX_REDIS_URL production muhitida majburiy")
    if s.is_prod and not s.secure_cookie:
        raise RuntimeError("Secure cookie production muhitida majburiy")
    if s.is_prod and s.telegram_bot_token and not s.telegram_webhook_secret:
        raise RuntimeError("Telegram bot yoqilganda production webhook secret majburiy")
    if s.is_prod and s.debug_auth_logging:
        # Amalda hech qanday ta'siri yo'q (deps.py is_prod'ni alohida
        # tekshiradi), lekin noto'g'ri sozlama haqida ochiq ogohlantiramiz.
        log.warning(
            "TIBEX_DEBUG_AUTH_LOGGING=true production'da o'rnatilgan — e'tiborsiz "
            "qoldiriladi (auth debug loglari faqat local/dev muhitda ishlaydi)."
        )

    _warn_if_env_file_too_open()
    _local_only_announce()  # TIBEX_LOCAL_ONLY_v1: joriy rejimni bir marta log qiladi
    log.info("TIBEX ishga tushmoqda. env=%s", s.env)
    start_redis_listener()
    try:
        yield
    finally:
        log.info("TIBEX to'xtatilmoqda...")
        await stop_redis_listener()
        await db_dispose()
        await close_redis()


app = FastAPI(
    title="TIBEX API",
    version="0.2.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_settings = get_settings()
if _settings.is_prod and _settings.serve_frontend:
    raise RuntimeError("TIBEX_SERVE_FRONTEND production muhitida o'chirilishi shart")

# TIBEX_CORS_DEV_FIX: dev muhitida local portlarga ruxsat
_cors_origins = list(_settings.allowed_origins or [])
if not _settings.is_prod:
    for _port in ["5500", "3000", "5173", "8080", "4200", "8001"]:
        for _host in ["localhost", "127.0.0.1"]:
            _o = "http://" + _host + ":" + _port
            if _o not in _cors_origins:
                _cors_origins.append(_o)

# ───────────────────────────────────────────────────────────
# Middleware registratsiya tartibi (Starlette LIFO)
#
# Har bir `add_middleware` chaqiruvi ro'yxatning BOSHIGA qo'shadi; oxirgi
# ro'yxatdan o'tgan middleware ENG TASHQI qatlam bo'ladi va HAR QANDAY
# javobga (jumladan boshqa middleware'lar tomonidan qaytarilgan xato
# javoblariga ham) o'zgartirish kirita oladi.
#
# Execution tartibi (tashqaridan ichkariga):
#   security_headers → LocalOnly → CORS → request_id → sanitize_errors
#     → request_inspector → error_tracker → app
#
# Nima uchun bu tartib:
#   • security_headers eng tashqi — LocalOnly qaytargan 404 ham CSP/HSTS/
#     nosniff oladi (aks holda brauzer konsolida xavfsizlik ogohlantirishi
#     chiqadi).
#   • LocalOnly CORS'dan TASHQARIDA — rad etilgan so'rov CORS/rate-limit/
#     threat detector'ga YETIB BORMAYDI (arzon, tez).
#   • CORS request_id/sanitize'dan tashqarida — 500 javoblarga ham CORS
#     header qo'shiladi (mavjud xatti-harakat saqlanadi).
# ───────────────────────────────────────────────────────────


# TIBEX_MW_ORDER_FIX_v1: decorator olib tashlandi.
# Barcha middleware'lar ro'yxatdan o'tgach, ENG TASHQI qatlam
# sifatida ro'yxatdan o'tadi (pastda).
async def security_headers(request: Request, call_next):
    # STATIC_HEADERS_FIX: barcha fayllar uchun (API + static)
    nonce = make_nonce()
    request.state.csp_nonce = nonce
    resp = await call_next(request)
    # Headerlar barcha javoblarga (API + HTML + JS + CSS)
    resp.headers["Content-Security-Policy"] = build_csp(nonce, _settings.is_prod)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # TIBEX_CAMERA_FIX_v3: camera ruxsat (kamera skaner uchun)
    resp.headers["Permissions-Policy"] = (
        "geolocation=(self), microphone=(self), camera=(self), "
        "payment=(self), usb=(self), magnetometer=(), gyroscope=()"
    )
    resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    resp.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    resp.headers["X-Download-Options"] = "noopen"
    if request.url.path.startswith("/api/"):
        # Clinical and account responses must never be stored by shared or
        # browser HTTP caches; offline access needs a separate encrypted design.
        resp.headers["Cache-Control"] = "no-store, private"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    if _settings.is_prod:
        resp.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )
    # TIBEX_MW_ORDER_FIX_v1: uvicorn bannerini yashirish
    resp.headers["Server"] = "TIBEX"
    return resp



# Error tracker — 4xx/5xx ushlash
app.middleware("http")(error_tracker_middleware)
app.middleware("http")(request_inspector_middleware)
app.middleware("http")(sanitize_errors_middleware)
app.middleware("http")(request_id_middleware)

# CORSMiddleware — request_id/sanitize/request_inspector'dan KEYIN, lekin
# LocalOnly va security_headers'dan OLDIN ro'yxatdan o'tadi.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
    max_age=600,
)

# TIBEX_LOCAL_ONLY_v1: default-deny middleware. CORS'dan keyin, lekin
# security_headers'dan oldin ro'yxatdan o'tadi. Natijada:
#   • security_headers UNDAN TASHQARIDA — LocalOnly qaytargan 404 ham
#     CSP/nosniff oladi.
#   • LocalOnly CORS va request_inspector'dan TASHQARIDA — rad etilgan
#     so'rov rate-limit/threat-detector'ga yetib bormaydi.
app.add_middleware(LocalOnlyMiddleware)

# TIBEX_MW_ORDER_FIX_v1: security_headers ENG TASHQI qatlam.
# Sababi: request_inspector rate-limit/blacklist bo'lsa JSONResponse
# qaytarib, call_next() ni chaqirmaydi. Eski holatda security_headers
# (ichki) ishlamay qolardi va headerlar qo'shilmasdi.
# Endi security_headers HAR QANDAY javobga header qo'shadi (LocalOnly
# 404 ham shu jumladan).
app.middleware("http")(security_headers)


# ═══════════════════ Global xato handler ═══════════════════
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": [
            {"type": item.get("type"), "loc": item.get("loc"), "msg": item.get("msg")}
            for item in exc.errors()
        ]},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.exception("[UNHANDLED] %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Server xatosi. Iltimos, keyinroq urinib ko'ring."},
    )
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Favicon route (bo'sh)."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse("/favicon.svg", status_code=301)



@app.get("/api/health")
async def health():
    """DB va sozlangan Redis ishlashini tekshiradi; ichki tafsilotlarni oshkor qilmaydi."""
    from sqlalchemy import text
    from .db import get_db
    try:
        async for session in get_db():
            await session.execute(text("SELECT 1"))
            break
        if _settings.redis_url:
            from .redis_client import get_redis
            redis = get_redis()
            if redis is None or not await redis.ping():
                raise RuntimeError("Redis tekshiruvi bajarilmadi")
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False})
    return {"ok": True}

# ═══════════════════ Routerlar ═══════════════════
# Auth (xodimlar uchun login/parol)
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# Bemor uchun bir martalik login kodlari (Telegram yoki admin tomonidan)
app.include_router(patient_otp.router, prefix="/api/otp", tags=["patient-otp"])

# Bemor kabineti
app.include_router(patient_portal.router, prefix="/api/portal", tags=["patient-portal"])
app.include_router(portal_telegram.router, prefix="/api/portal/telegram", tags=["patient-portal"])

# Telegram bot webhook (bemor akkauntini ulash va kod yuborish)
app.include_router(telegram_router.router, prefix="/api/telegram", tags=["telegram"])

# Bootstrap (rolga qarab)
app.include_router(bootstrap_router.router, prefix="/api", tags=["bootstrap"])

# Biznes routerlar
app.include_router(patients.router, prefix="/api/patients", tags=["patients"])
app.include_router(appointments.router, prefix="/api/appointments", tags=["appointments"])
app.include_router(lab.router, prefix="/api/lab-orders", tags=["lab"])
app.include_router(payments.router, prefix="/api", tags=["payments"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(doctors.router, prefix="/api/doctors", tags=["doctors"])
app.include_router(services.router, prefix="/api/services", tags=["services"])
app.include_router(equipment.router, prefix="/api/equipment", tags=["equipment"])
app.include_router(reagents.router, prefix="/api/reagents", tags=["reagents"])
app.include_router(roles.router, prefix="/api/roles", tags=["roles"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["integrations"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(export_router.router, prefix="/api", tags=["export"])
app.include_router(audit_router.router, prefix="/api/audit", tags=["audit"])

# Monitoring (xato tracking + health)
app.include_router(monitoring.router, prefix="/api/monitoring", tags=["monitoring"])
app.include_router(observability.router)  # /metrics (token bilan)
app.include_router(csp_reports.router, prefix="/api/security", tags=["security-reports"])

# Xavfli admin amallari (2-bosqichli himoya)
if not _settings.is_prod:
    app.include_router(admin_danger.router, prefix="/api/admin", tags=["admin-danger"])

# WebSocket
app.include_router(camera_security.router, prefix="/api/camera", tags=["camera-security"])
app.include_router(ws.router, prefix="/api/ws", tags=["ws"])


# ═══════════════ Static frontend (ATAYLAB O'CHIRILGAN — default) ═══════════════
# Frontend endi backenddan ALOHIDA ilova: backend faqat /api/* beradi.
# Frontendni serve qilish uchun frontend/README.md ga qarang (nginx/static host).
# Faqat bitta-jarayonli lokal tekshiruv uchun TIBEX_SERVE_FRONTEND=true qiling —
# bu holatda ham /api/* bloklanmasligi uchun mount eng oxirida turishi shart.
#
# TIBEX_FRONTEND_MOUNT_FIX_v1:
#   Eski kod `Path(__file__).resolve().parent.parent.parent / "frontend"`
#   yozardi. Host'da (repo) bu <repo_root>/frontend ni beradi, lekin Docker
#   konteynerida __file__=/app/app/main.py bo'lgani uchun natija /frontend
#   bo'lib qolardi — papka esa compose tomonidan /app/frontend ga mount
#   qilinadi. Natijada mount umuman ishlamay, barcha static URL'lar
#   FastAPI'dan 404 olardi (jumladan /login.html). Endi bir nechta
#   nomzodni tekshiramiz.
if _settings.serve_frontend:
    _here = Path(__file__).resolve()
    _frontend_candidates = [
        _here.parent.parent / "frontend",          # /app/frontend           (Docker)
        _here.parent.parent.parent / "frontend",   # <repo_root>/frontend    (host)
        Path("/app/frontend"),                     # explicit zaxira
    ]
    _frontend_dir = next((p for p in _frontend_candidates if p.is_dir()), None)

    if _frontend_dir is not None:
        log.warning(
            "TIBEX_SERVE_FRONTEND=true — frontend backend jarayoni ichida serve "
            "qilinmoqda (%s). Bu FAQAT lokal tekshiruv uchun; productionda o'chiring.",
            _frontend_dir,
        )
        app.mount(
            "/",
            StaticFiles(directory=str(_frontend_dir), html=True),
            name="frontend",
        )
    else:
        log.warning(
            "Frontend papkasi topilmadi. Tekshirilgan yo'llar: %s",
            ", ".join(str(p) for p in _frontend_candidates),
        )