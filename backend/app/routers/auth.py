import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import client_ip, get_current_session, get_current_user, require_csrf
from ..models import LoginAttempt, User
from ..models import Session as DBSession
from ..security.audit import log_action
from ..security.csrf import issue_csrf
from ..security.passwords import (
    DUMMY_HASH,
    check_password_strength,
    hash_password_async,
    verify_password_async,
)
from ..security.rate_limit import hit, observe, reset
from ..security.sessions import create_token
from ..security.session_cookie import clear_session_cookie, set_session_cookie
from ..realtime import publish_session_revoked

router = APIRouter()


class LoginIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class LoginOut(BaseModel):
    user: dict
    csrf_token: str


@router.post("/login", response_model=LoginOut)
async def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    s = get_settings()
    ip = client_ip(request) or "unknown"
    login_name = body.username.strip().lower()

    # IP va (IP, login) chegaralari hujumchini cheklaydi, bitta loginni
    # barcha klinika foydalanuvchilari uchun global bloklamaydi.
    await hit(f"rl:login:ip:{ip}", limit=20, window=300)
    login_tag = hashlib.sha256(login_name.encode("utf-8")).hexdigest()
    await hit(f"rl:login:ipuser:{ip}:{login_tag}", limit=5, window=900)
    observations = await observe(f"rl:login:observe:{login_tag}", window=3600)
    # TIBEX_LOGIN_ALERT_THRESHOLD_v1: avval faqat ANIQ 100 da ishlardi.
    # 99 va 101 hech qanday signal bermasdi. Endi bir necha chegarada ishlaydi.
    if observations in (50, 100, 200, 500):
        from .monitoring import record_alert
        record_alert(
            level="warn",
            title="Login urinishlari ko'paydi",
            detail="Bitta login identifikatoriga bir soat ichida ko'p urinish qayd etildi.",
            source="auth",
        )

    user = (
        await db.execute(select(User).where(User.login == login_name))
    ).scalar_one_or_none()

    # Bloklangan hisob uchun ham Argon2 tekshiruvi bajariladi, shunda holat
    # vaqti login/parol xato holatidan farq qilmaydi.
    locked = False
    if user and user.locked_until:
        lu = user.locked_until
        if lu.tzinfo is None:
            lu = lu.replace(tzinfo=timezone.utc)
        if lu > datetime.now(timezone.utc):
            locked = True
            await verify_password_async(user.password_hash, body.password)
            await log_action(
                db, user="?", role="?", action="login",
                detail="Lockout urinishi", ip=ip,
            )

    ok = False
    needs_rehash = False
    # Bemor akkauntlari hech qachon parol endpointi bilan kirmaydi; ular
    # faqat Telegram OTP yoki admin bergan bir martalik koddan foydalanadi.
    if locked:
        ok = False
    elif user and user.active and user.role_key != "patient":
        ok, needs_rehash = await verify_password_async(user.password_hash, body.password)
        if ok and needs_rehash:
            user.password_hash = await hash_password_async(body.password)
    else:
        # Noma'lum, inactive yoki bemor akkauntlari uchun yaroqli dummy Argon2 hash.
        await verify_password_async(DUMMY_HASH, body.password)

    db.add(LoginAttempt(username=login_name, ip=ip, success=ok))

    if not ok:
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= s.max_login_attempts:
                user.locked_until = datetime.now(timezone.utc) + timedelta(
                    minutes=s.login_lockout_minutes
                )
                user.failed_attempts = 0
        await log_action(
            db, user=login_name, role="?", action="login",
            detail="Login muvaffaqiyatsiz", ip=ip,
        )
        # get_db() rolls back when HTTPException escapes; persist the failed
        # attempt, lockout counter and audit record before returning 401.
        await db.commit()
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Login yoki parol xato",
        )

    # ─── Muvaffaqiyat ───
    user.failed_attempts = 0
    user.locked_until = None

    ttl = s.session_ttl_minutes * 60
    token, jti, expires_at = create_token(user.id, ttl, kind="staff")

    db.add(
        DBSession(
            jti=jti,
            user_id=user.id,
            expires_at=expires_at,
            ip=ip,
            user_agent=(request.headers.get("user-agent") or "")[:500],
        )
    )

    await log_action(
        db, user=user.fullname, role=user.role_key,
        action="login", detail="Tizimga kirdi", ip=ip,
    )

    set_session_cookie(response, token, ttl, s.cookie_samesite)

    csrf = issue_csrf(jti)

    # Rate limit counterlarini tozalash
    await reset(f"rl:login:ipuser:{ip}:{login_tag}")

    return {
        "user": {
            "id": user.id,
            "fullname": user.fullname,
            "login": user.login,
            "role": user.role_key,
            "doctor_id": user.doctor_id,
        },
        "csrf_token": csrf,
    }


@router.post("/logout")
async def logout(
    response: Response,
    sess: dict = Depends(get_current_session),
    db: AsyncSession = Depends(get_db),
):
    # TIBEX_LOGOUT_RELIABILITY_FIX_v1: logout CSRF talabidan ozod qilindi.
    # Sabab: agar CSRF token biror sababdan eskirgan/yo'q bo'lsa, avvalgi
    # holatda require_csrf 403 qaytarardi va frontend buni jim yutib
    # yuborardi (logout so'rovining status kodi tekshirilmasdi) — natijada
    # sessiya serverda hech qachon bekor qilinmasdi va cookie o'chmasdi,
    # foydalanuvchi login sahifasiga chiqib, 0.1 soniyada avtomatik yana
    # profiliga qaytarilardi. Logout faqat foydalanuvchining O'Z sessiyasini
    # yopadi (hech qanday ma'lumot o'zgartirmaydi/oshkor qilmaydi), shuning
    # uchun CSRF himoyasisiz ham xavfsiz — cookie SameSite=Lax bo'lgani
    # uchun cross-site so'rov bilan chaqirib bo'lmaydi.
    row = (
        await db.execute(select(DBSession).where(DBSession.jti == sess["jti"]))
    ).scalar_one_or_none()
    if row is not None:
        row.revoked_at = datetime.now(timezone.utc)
        await publish_session_revoked(row.jti)
    s = get_settings()
    # delete_cookie ham set_cookie bilan bir xil domain/samesite/secure
    # attributlariga ega bo'lishi kerak, aks holda ba'zi brauzerlar
    # cookie'ni o'chirmaydi (mos kelmagan attribut = boshqa cookie deb hisoblaydi).
    clear_session_cookie(response, s.cookie_samesite)
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "fullname": user.fullname,
        "login": user.login,
        "role": user.role_key,
        "doctor_id": user.doctor_id,
    }



PASSWORD_CHANGES_PER_HOUR = 5


class ChangePasswordIn(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=10, max_length=256)


class ChangePasswordOut(BaseModel):
    ok: bool
    remaining: int
    message: str


@router.post(
    "/change-password",
    response_model=ChangePasswordOut,
    dependencies=[Depends(require_csrf)],
)
async def change_password(
    body: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Xodim parolini soatiga ko'pi bilan 5 marta almashtira oladi."""
    changes_this_hour = await hit(
        f"rl:pwchange:{user.id}", limit=PASSWORD_CHANGES_PER_HOUR, window=3600
    )

    # Eski parolni tekshirish
    ok, _ = await verify_password_async(user.password_hash, body.old_password)
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Eski parol xato")

    # Yangi parol eski bilan bir xil emasligi
    if body.old_password == body.new_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Yangi parol eski parol bilan bir xil bo'lmasligi kerak",
        )

    # Kuchlilik tekshiruvi
    strength_ok, strength_msg = check_password_strength(
        body.new_password, login=user.login, fullname=user.fullname
    )
    if not strength_ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, strength_msg)

    # Saqlash
    user.password_hash = await hash_password_async(body.new_password)
    user.password_change_count += 1
    user.password_changed_at = datetime.now(timezone.utc)
    # TIBEX_SESSION_INVALIDATE_v1: barcha eski sessiyalarni bekor qilish
    user.session_valid_after = datetime.now(timezone.utc)
    # Sessiya jadvalidan ham o'chirish
    from ..models import Session as _DBSession
    from sqlalchemy import update as _sa_update
    session_ids = (await db.execute(
        select(_DBSession.jti).where(
            _DBSession.user_id == user.id,
            _DBSession.revoked_at.is_(None),
        )
    )).scalars().all()
    await db.execute(
        _sa_update(_DBSession)
        .where(_DBSession.user_id == user.id,
               _DBSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await db.flush()
    for session_id in session_ids:
        await publish_session_revoked(session_id)

    remaining = max(0, PASSWORD_CHANGES_PER_HOUR - changes_this_hour)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail="Parol almashtirildi",
    )

    return {
        "ok": True,
        "remaining": remaining,
        "message": (
            f"Parol muvaffaqiyatli o'zgartirildi. "
            f"Shu soatdagi qolgan almashtirish: {remaining}/{PASSWORD_CHANGES_PER_HOUR}"
            if remaining > 0
            else "Parol o'zgartirildi. Soatlik limitga yetdi."
        ),
    }
