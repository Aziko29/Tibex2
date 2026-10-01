from datetime import datetime, timedelta, timezone
import logging

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import Role, Session as DBSession, User
from .security.csrf import verify_csrf
from .security.rbac import has_permission
from .security.session_binding import verify_session_binding
from .security.sessions import parse_token
from .security.netutil import client_ip  # noqa: F401  (boshqa routerlar deps orqali import qiladi)
from .security.session_cookie import COOKIE_NAME
from .security.session_state import (
    EXPIRED, INACTIVE, REVOKED, SESSION_RENEWED, USER_DISABLED,
    session_row_problem, user_problem,
)

_dbg = logging.getLogger("tibex.debug")

# TIBEX_SECRET_SAFE_LOGGING_v1: bu debug logger HECH QACHON cookie, token
# yoki boshqa maxfiy qiymatni o'z ichiga olmaydi — faqat sabab kodi va
# hech kimni identifikatsiya qilmaydigan meta-ma'lumot (masalan jti'ning
# so'nggi 6 belgisi, user_id). Bu ham faqat quyidagi ikkala shart bajarilsa
# yoqiladi: (1) production EMAS va (2) TIBEX_DEBUG_AUTH_LOGGING=true aniq
# o'rnatilgan. Production'da hech qanday sharoitda yoqilmaydi — hatto
# kimdir .env'da yoqib qo'yishga urinsa ham (pastga qarang).
def _auth_debug_enabled() -> bool:
    s = get_settings()
    if s.is_prod:
        return False
    return bool(getattr(s, "debug_auth_logging", False))


def _short_jti(jti: str | None) -> str:
    """Jti'ning faqat oxirgi belgilarini ko'rsatadi — token emas, shunchaki
    log satrlarini bir-biridan ajratish uchun (sessiyani tiklab bo'lmaydi)."""
    if not jti:
        return "?"
    return f"...{jti[-6:]}"


def _dbg_auth(reason: str, **safe_fields: object) -> None:
    if not _auth_debug_enabled():
        return
    extras = " ".join(f"{k}={v}" for k, v in safe_fields.items())
    _dbg.debug("[auth] %s %s", reason, extras)


async def get_current_session(
    request: Request,
    cf_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cookie'dan tokenni tekshirib, sessiya ma'lumotini qaytaradi.

    XAVFSIZLIK: bu funksiya (va u chaqiradigan yordamchilar) hech qachon
    ``cf_session``, ``request.headers.get("cookie")`` yoki boshqa xom
    token/sirni logga yozmaydi — chunki bular amalda parolga teng: kim
    logni o'qisa, sessiyani o'g'irlab, foydalanuvchi sifatida kirishi
    mumkin. Faqat _dbg_auth() orqali, faqat local/dev muhitda va faqat
    xavfsiz (token bo'lmagan) qiymatlar chiqariladi.
    """
    if not cf_session:
        _dbg_auth("401 cookie yo'q", path=request.url.path)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Avtorizatsiya yo'q")
    info = parse_token(cf_session, expected_kind="staff")
    if not info:
        _dbg_auth("401 token yaroqsiz", path=request.url.path)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token yaroqsiz")

    # ─── Session binding (IP + UA + fingerprint) ───
    try:
        await verify_session_binding(request, info["jti"], db)
    except HTTPException:
        _dbg_auth("401 fingerprint mos kelmadi", jti=_short_jti(info["jti"]))
        raise

    row = (
        await db.execute(select(DBSession).where(DBSession.jti == info["jti"]))
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    problem = session_row_problem(row, now, get_settings().inactivity_minutes)
    if problem == REVOKED:
        _dbg_auth("401 sessiya topilmadi/bekor", jti=_short_jti(info["jti"]))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessiya bekor qilingan")
    if problem == EXPIRED:
        _dbg_auth("401 muddati o'tgan", jti=_short_jti(info["jti"]))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessiya muddati o'tgan")
    if problem == INACTIVE:
        row.revoked_at = now
        await db.commit()
        _dbg_auth("401 harakatsizlik", jti=_short_jti(info["jti"]))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Harakatsizlik tufayli chiqarildi")

    _dbg_auth("OK", user_id=info["user_id"], jti=_short_jti(info["jti"]))
    row.last_seen_at = now
    request.state.authenticated = True
    return {"jti": info["jti"], "user_id": info["user_id"], "iat": info["iat"]}


async def get_current_user(
    sess: dict = Depends(get_current_session),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = (
        await db.execute(select(User).where(User.id == sess["user_id"]))
    ).scalar_one_or_none()
    problem = user_problem(user, sess["iat"])
    if problem == USER_DISABLED:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Foydalanuvchi aktiv emas")
    if problem == SESSION_RENEWED:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessiya yangilangan")
    return user


async def get_current_role(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Role:
    """TIBEX_ROLE_FORTRESS_v1: rol har safar DB dan o'qiladi (live)."""
    role = (
        await db.execute(select(Role).where(Role.key == user.role_key))
    ).scalar_one_or_none()
    if role is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Rol topilmadi — administrator bilan bog'laning",
        )
    if not role.active:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Rol aktiv emas — administrator bilan bog'laning",
        )
    return role


async def require_csrf(
    request: Request,
    sess: dict = Depends(get_current_session),
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> None:
    """POST/PUT/PATCH/DELETE uchun CSRF tokenini tekshiradi."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if not verify_csrf(x_csrf_token, sess["jti"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token yaroqsiz")


async def get_patient_session(
    request: Request,
    cf_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Faqat bemor tokeni bo'lgan, aktiv va inactivity muddati o'tmagan sessiya."""
    if not cf_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Avtorizatsiya yo'q")
    info = parse_token(cf_session, expected_kind="patient")
    if not info:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Faqat bemorlar")
    row = (await db.execute(
        select(DBSession).where(DBSession.jti == info["jti"])
    )).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessiya bekor qilingan")
    now = datetime.now(timezone.utc)
    if row.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessiya muddati o'tgan")
    last_seen = row.last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if last_seen + timedelta(minutes=get_settings().inactivity_minutes) < now:
        row.revoked_at = now
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Harakatsizlik tufayli chiqarildi")
    await verify_session_binding(request, info["jti"], db)
    row.last_seen_at = now
    request.state.authenticated = True
    return {"jti": info["jti"], "user_id": info["user_id"], "iat": info["iat"]}


async def get_current_patient_user(
    sess: dict = Depends(get_patient_session),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = (await db.execute(select(User).where(User.id == sess["user_id"]))).scalar_one_or_none()
    if user is None or not user.active or user.role_key != "patient" or user.patient_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bemor akkaunti aktiv emas")
    if user.session_valid_after is not None:
        sva = user.session_valid_after
        if sva.tzinfo is None:
            sva = sva.replace(tzinfo=timezone.utc)
        if sess["iat"] < int(sva.timestamp()):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessiya yangilangan")
    return user


async def require_patient(
    user: User = Depends(get_current_patient_user),
) -> User:
    """Faqat kabinetga kirgan bemor (portal routerlari uchun umumiy dependency)."""
    if user.role_key != "patient" or user.patient_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Faqat bemorlar uchun")
    return user


async def require_patient_csrf(
    request: Request,
    sess: dict = Depends(get_patient_session),
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> None:
    """Bemor portalining o'z patient tokeniga bog'langan CSRF himoyasi."""
    if request.method not in ("GET", "HEAD", "OPTIONS") and not verify_csrf(x_csrf_token, sess["jti"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token yaroqsiz")


def require_permission(module: str, action: str):
    """TIBEX_ROLE_FORTRESS_v1: markazlashtirilgan ruxsat tekshiruvi."""

    async def _check(role: Role = Depends(get_current_role)) -> Role:
        if not has_permission(role.permissions, module, action):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Ruxsat yo'q: {module}.{action} (rol: {role.key})",
            )
        return role

    return _check


