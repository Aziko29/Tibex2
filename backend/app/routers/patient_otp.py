"""Telegram yoki admin bergan bir martalik kod bilan bemor kirishi."""
import secrets
import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import client_ip, get_current_user, require_csrf
from ..models import LoginAttempt, OTPCode, Patient, Session as DBSession, User
from ..security.audit import log_action
from ..security.csrf import issue_csrf
from ..security.passwords import hash_password_async
from ..security.otp import (
    OTP_MAX_ATTEMPTS,
    OTP_TTL_SECONDS,
    generate_code,
    hash_code,
    normalize_phone,
    verify_code,
)
from ..security.rate_limit import hit, observe
from ..security.sessions import create_token
from ..security.session_cookie import set_session_cookie
from ..security.telegram import send_telegram_code

router = APIRouter()


def _masked_phone(phone: str) -> str:
    return f"***{phone[-2:]}" if len(phone) >= 2 else "***"


class OTPRequest(BaseModel):
    phone: str = Field(..., min_length=9, max_length=20)


class OTPVerify(BaseModel):
    phone: str = Field(..., min_length=9, max_length=20)
    code: str = Field(..., min_length=4, max_length=8)


@router.post("/request")
async def request_otp(
    body: OTPRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Bemor raqami Telegramga ulangan bo'lsa, kod faqat botga yuboriladi."""
    phone = normalize_phone(body.phone)
    if len(phone) != 13 or not phone.startswith("+998"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Telefon raqam xato")

    ip = client_ip(request) or "unknown"

    phone_tag = hashlib.sha256(phone.encode("utf-8")).hexdigest()
    # Har telefon uchun limit manzilga bog'langan; telefonning global
    # hisoblagichi bloklamaydi va faqat shubhali hajmda alert qayd etadi.
    await hit(f"rl:otp:request:{phone_tag}:{ip}", limit=3, window=900)
    await hit(f"rl:otp:ip:{ip}", limit=10, window=900)
    if await observe(f"rl:otp:phone-observe:{phone_tag}", window=3600) == 30:
        from .monitoring import record_alert
        record_alert(
            level="warn",
            title="Bemor OTP so'rovlari ko'paydi",
            detail="Bitta telefon identifikatoriga bir soat ichida ko'p urinish qayd etildi.",
            source="patient-otp",
        )

    # Foydalanuvchini topamiz
    user = (
        await db.execute(select(User).where(User.login == phone))
    ).scalar_one_or_none()

    # Xavfsizlik: telefon bazada bo'lmasa ham xuddi shu javob (bir xil
    # matn, bir xil maydonlar) qaytariladi — javobning shakli o'zgarmasligi
    # SHART, aks holda account enumeration mumkin bo'lib qoladi.
    generic_response = {
        "ok": True,
        "message": "Agar raqam tizimda mavjud bo'lsa, so'rov qayta ishlanadi.",
        "ttl_seconds": OTP_TTL_SECONDS,
        "channel": "telegram",
    }

    if user is None or not user.active:
        # Log qilamiz (audit uchun)
        db.add(LoginAttempt(username=phone, ip=ip, success=False))
        await log_action(
            db, user="?", role="?", action="otp_request",
            detail=f"OTP so'rovi mavjud bo'lmagan telefon: {_masked_phone(phone)}",
            ip=ip,
        )
        return generic_response

    # Bemor emasmi?
    if user.role_key != "patient" or user.patient_id is None:
        db.add(LoginAttempt(username=phone, ip=ip, success=False))
        await log_action(
            db, user=user.fullname, role=user.role_key, action="otp_request",
            detail=f"OTP faqat bemorlar uchun: {_masked_phone(phone)}",
            ip=ip,
        )
        return generic_response

    # Eski kodlarni bekor qilamiz
    old_codes = (
        await db.execute(
            select(OTPCode).where(
                OTPCode.phone == phone,
                OTPCode.used == False,  # noqa: E712
            )
        )
    ).scalars().all()
    for old in old_codes:
        old.used = True

    # Yangi kod
    code = generate_code()
    otp = OTPCode(
        phone=phone,
        code_hash=hash_code(code, phone),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS),
        ip=ip,
    )
    db.add(otp)
    await db.flush()

    # SMS umuman ishlatilmaydi: Telegram bog'lanmagan yoki bot yetkazolmagan
    # bo'lsa, kod yaroqsiz qilinadi va foydalanuvchi botni avval ulashi kerak.
    sent = bool(user.telegram_chat_id) and await send_telegram_code(user.telegram_chat_id, code)

    if not sent:
        # An undelivered code must not remain valid, and provider failures
        # must not leave the API claiming that a code was sent.
        otp.used = True
        await log_action(
            db, user=user.fullname, role=user.role_key, action="otp_request",
            detail="OTP provayderi muvaffaqiyatsiz", ip=ip,
        )
        return generic_response

    await log_action(
        db, user=user.fullname, role=user.role_key, action="otp_request",
            detail=f"OTP yuborildi (telegram): {_masked_phone(phone)}", ip=ip,
    )

    # Matn (message) ATAYLAB o'zgarmaydi — faqat "channel" maydoni farqlanadi,
    # frontend shu asosda ikonka/matn ko'rsatadi (yuqoridagi izohga qarang).
    return generic_response


class AdminCodeIssue(BaseModel):
    patient_id: int = Field(..., gt=0)


@router.post("/admin-issue", dependencies=[Depends(require_csrf)])
async def issue_admin_code(
    body: AdminCodeIssue,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_user),
):
    """Admin bemorga bir marta ishlatiladigan, 5 daqiqalik kod chiqaradi."""
    if admin.role_key not in {"admin", "superadmin"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Faqat administrator kod bera oladi")
    await hit(f"rl:patient_admin_code:{admin.id}", limit=10, window=900)
    patient_record = (await db.execute(select(Patient).where(Patient.id == body.patient_id).with_for_update())).scalar_one_or_none()
    if patient_record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")
    phone = normalize_phone(patient_record.phone_enc)
    if len(phone) != 13 or not phone.startswith("+998"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bemor telefon raqami noto'g'ri")
    await hit(f"rl:patient_admin_code:patient:{patient_record.id}", limit=5, window=900)
    patient = (await db.execute(select(User).where(User.patient_id == patient_record.id))).scalar_one_or_none()
    if patient is None:
        patient = (await db.execute(select(User).where(User.login == phone))).scalar_one_or_none()
        if patient is not None and (patient.role_key != "patient" or patient.patient_id != patient_record.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Bu telefon boshqa akkauntga bog'langan")
    if patient is None:
        patient = User(
            fullname=patient_record.fullname,
            login=phone,
            password_hash=await hash_password_async(secrets.token_urlsafe(32)),
            role_key="patient",
            phone=phone,
            patient_id=patient_record.id,
            active=True,
        )
        db.add(patient)
        await db.flush()
    if not patient.active or patient.role_key != "patient":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bemor akkaunti faol emas")
    old_codes = (await db.execute(select(OTPCode).where(OTPCode.phone == phone, OTPCode.used == False))).scalars().all()  # noqa: E712
    for old in old_codes:
        old.used = True

    code = generate_code()
    now = datetime.now(timezone.utc)
    db.add(OTPCode(
        phone=phone,
        code_hash=hash_code(code, phone),
        user_id=patient.id,
        expires_at=now + timedelta(seconds=OTP_TTL_SECONDS),
        ip=client_ip(request) or "admin-issued",
    ))
    await db.flush()
    await log_action(
        db, user=admin.fullname, role=admin.role_key, action="patient_login_code_issue",
        detail=f"Bemor #{patient_record.id} uchun bir martalik kirish kodi berildi", ip=client_ip(request),
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return {"ok": True, "patient": patient.fullname, "phone": _masked_phone(phone), "code": code, "ttl_seconds": OTP_TTL_SECONDS}


@router.post("/verify")
async def verify_otp(
    body: OTPVerify,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Kodni tekshiradi, muvaffaqiyatli bo'lsa sessiya yaratadi."""
    phone = normalize_phone(body.phone)
    if len(phone) != 13 or not phone.startswith("+998"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Telefon raqam xato")

    ip = client_ip(request) or "unknown"

    phone_tag = hashlib.sha256(phone.encode("utf-8")).hexdigest()
    await hit(f"rl:otp_verify:ip:{ip}", limit=20, window=900)
    await hit(f"rl:otp_verify:pair:{phone_tag}:{ip}", limit=5, window=900)
    if await observe(f"rl:otp:verify-observe:{phone_tag}", window=3600) == 30:
        from .monitoring import record_alert
        record_alert(
            level="warn",
            title="Bemor OTP tekshiruvlari ko'paydi",
            detail="Bitta telefon identifikatoriga bir soat ichida ko'p tekshiruv qayd etildi.",
            source="patient-otp",
        )

    # Eng oxirgi aktiv kod
    otp = (
        await db.execute(
            select(OTPCode)
            .where(OTPCode.phone == phone, OTPCode.used == False)  # noqa: E712
            .order_by(OTPCode.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if otp is None:
        db.add(LoginAttempt(username=phone, ip=ip, success=False))
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kod topilmadi yoki muddati o'tgan")

    now = datetime.now(timezone.utc)
    expires = otp.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        otp.used = True
        db.add(LoginAttempt(username=phone, ip=ip, success=False))
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kod muddati o'tgan")

    if otp.attempts >= OTP_MAX_ATTEMPTS:
        otp.used = True
        db.add(LoginAttempt(username=phone, ip=ip, success=False))
        await db.commit()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Urinishlar tugadi. Yangi kod so'rang.")

    # Tekshirish
    if not verify_code(body.code, phone, otp.code_hash):
        otp.attempts += 1
        db.add(LoginAttempt(username=phone, ip=ip, success=False))
        await log_action(
            db, user="?", role="patient", action="otp_verify",
            detail=f"Kod xato: {_masked_phone(phone)} (urinish {otp.attempts}/{OTP_MAX_ATTEMPTS})",
            ip=ip,
        )
        remaining = OTP_MAX_ATTEMPTS - otp.attempts
        await db.commit()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Kod xato. Qolgan urinishlar: {remaining}",
        )

    # Muvaffaqiyat
    otp.used = True

    user = (
        await db.execute(select(User).where(User.id == otp.user_id))
    ).scalar_one_or_none()
    if user is None or not user.active:
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Foydalanuvchi aktiv emas")

    db.add(LoginAttempt(username=phone, ip=ip, success=True))

    # Eski sessiyalarni bekor qilamiz (bir qurilma)
    old_sessions = (
        await db.execute(
            select(DBSession).where(
                DBSession.user_id == user.id,
                DBSession.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    for s in old_sessions:
        s.revoked_at = now

    # Yangi sessiya
    s_settings = get_settings()
    ttl = s_settings.session_ttl_minutes * 60
    token, jti, expires_at = create_token(user.id, ttl, kind="patient")

    db.add(DBSession(
        jti=jti,
        user_id=user.id,
        expires_at=expires_at,
        ip=ip,
        user_agent=(request.headers.get("user-agent") or "")[:500],
    ))

    set_session_cookie(response, token, ttl, "strict")

    await log_action(
        db, user=user.fullname, role="patient", action="login",
        detail=f"OTP orqali kirdi: {_masked_phone(phone)}", ip=ip,
    )

    return {
        "user": {
            "id": user.id,
            "fullname": user.fullname,
            "login": user.login,
            "role": user.role_key,
            "patient_id": user.patient_id,
        },
        "csrf_token": issue_csrf(jti),
    }
