"""Bemor profili va bemor akkaunti bilan ishlaydigan YAGONA joy.

Avval bu mantiq 4 ta routerda (patient_portal, patients, patient_otp, telegram)
nusxalanib yurgan edi. Endi routerlar faqat HTTP qatlamini ushlaydi, qoidalar
shu yerda:

* patient_to_dict          — bemorni JSON ko'rinishga o'tkazish (bitta format)
* change_patient_phone     — telefonni o'zgartirish (bemor + login sinxron)
* find_patient_user / get_or_create_patient_user / build_patient_user
                           — bemorning kabinet akkaunti
* issue_login_code         — bir martalik kirish kodini yaratish
* unlink_telegram          — Telegram ulanishini uzish
* masked_phone             — loglar uchun maskalangan telefon
"""
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OTPCode, Patient, Session as DBSession, User
from ..security.audit import log_action
from ..security.otp import OTP_TTL_SECONDS, generate_code, hash_code, normalize_phone
from ..security.passwords import hash_password_async

_UZ_PHONE_RE = re.compile(r"\+998\d{9}")


class PatientAccountConflict(Exception):
    """Telefon (login) boshqa akkauntga tegishli — bemorga xavfsiz bog'lab bo'lmaydi."""


def masked_phone(phone: str) -> str:
    return f"***{phone[-2:]}" if len(phone) >= 2 else "***"


def patient_to_dict(p: Patient, user: User | None = None) -> dict:
    data = {
        "id": p.id,
        "fullname": p.fullname,
        "phone": p.phone_enc,
        "age": p.age,
        "gender": p.gender,
        "blood": p.blood,
        "address": p.address,
        "allergies": p.allergies or [],
        "chronic": p.chronic or [],
    }
    if user is not None:
        data["login"] = user.login
    return data


# ───────────────────────── Telefon ─────────────────────────
async def change_patient_phone(
    db: AsyncSession,
    patient: Patient,
    raw_phone: str,
    *,
    strict: bool,
    reveal_owner: bool = False,
) -> str:
    """Bemor telefonini o'zgartiradi; kabinet akkaunti bo'lsa login ham o'zgaradi.

    strict=True  — bemorning o'zi (kabinet): faqat to'g'ri +998XXXXXXXXX qabul qilinadi.
    strict=False — xodim (registratura/admin): normallashtirib bo'lmasa xom qiymat saqlanadi.
    reveal_owner — takror telefon egasining ismini xabarda ko'rsatish (faqat xodimga!).
    """
    phone = normalize_phone(raw_phone)
    if not phone:
        if strict:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Telefon raqam xato")
        patient.phone_enc = raw_phone
        patient.phone_bidx = raw_phone
        return raw_phone
    if strict and not _UZ_PHONE_RE.fullmatch(phone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Telefon raqam xato")

    other_patient = (
        await db.execute(
            select(Patient).where(Patient.phone_bidx == phone, Patient.id != patient.id)
        )
    ).scalar_one_or_none()
    if other_patient is not None:
        detail = "Bu telefon boshqa bemorga tegishli"
        if reveal_owner:
            detail += f": {other_patient.fullname}"
        raise HTTPException(status.HTTP_409_CONFLICT, detail)

    taken = (
        await db.execute(select(User).where(User.login == phone))
    ).scalar_one_or_none()
    if taken is not None and taken.patient_id != patient.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu telefon boshqa akkauntga band")

    patient.phone_enc = phone
    patient.phone_bidx = phone
    account = (
        await db.execute(select(User).where(User.patient_id == patient.id))
    ).scalar_one_or_none()
    if account is not None:
        account.login = phone
        account.phone = phone
        # TIBEX_PHONE_CHANGE_SESSION_REVOKE_v1: telefon = login. Agar login
        # o'zgargan bo'lsa, eski sessiyalar (ehtimol o'g'irlangan qurilma
        # yoki eski raqam egasi tomonidan qolgan) bekor qilinishi shart.
        # `session_valid_after` — barcha jti'lar uchun `iat < sva` bo'lganlarni
        # bekor qiladi (deps.py::user_problem orqali). Bu mavjud WS'larni
        # ham yopadi.
        from datetime import datetime as _dt, timezone as _tz
        from sqlalchemy import delete as _sa_delete, update as _sa_update
        _now = _dt.now(_tz.utc)
        account.session_valid_after = _now
        _revoked_jtis = (await db.execute(
            select(DBSession.jti).where(
                DBSession.user_id == account.id,
                DBSession.revoked_at.is_(None),
            )
        )).scalars().all()
        await db.execute(
            _sa_update(DBSession)
            .where(DBSession.user_id == account.id, DBSession.revoked_at.is_(None))
            .values(revoked_at=_now)
        )
        await db.flush()
        if _revoked_jtis:
            try:
                from ..realtime import publish_session_revoked as _psr
                for _j in _revoked_jtis:
                    await _psr(_j)
            except Exception:
                # WS xatosi telefon o'zgarishini buzmasin (audit va DB yozuvi
                # muhimroq)
                pass
    return phone


# ───────────────────────── Kabinet akkaunti ─────────────────────────
async def build_patient_user(patient: Patient, phone: str, password: str | None = None) -> User:
    """Yangi bemor akkauntini QURADI (bazaga qo'shmaydi).

    Bemorlar OTP (Telegram / admin kodi) bilan kiradi, shuning uchun parol
    berilmasa tasodifiy, hech kimga ma'lum bo'lmagan parol qo'yiladi.
    """
    return User(
        fullname=patient.fullname,
        login=phone,
        password_hash=await hash_password_async(password or secrets.token_urlsafe(32)),
        role_key="patient",
        phone=phone,
        patient_id=patient.id,
        active=True,
    )


async def find_patient_user(db: AsyncSession, patient: Patient, phone: str) -> User | None:
    """Bemorning akkauntini topadi. Telefon boshqa akkauntga tegishli bo'lsa —
    PatientAccountConflict."""
    user = (
        await db.execute(select(User).where(User.patient_id == patient.id))
    ).scalar_one_or_none()
    if user is None:
        user = (
            await db.execute(select(User).where(User.login == phone))
        ).scalar_one_or_none()
        if user is not None and (user.role_key != "patient" or user.patient_id != patient.id):
            raise PatientAccountConflict(phone)
    return user


async def get_or_create_patient_user(db: AsyncSession, patient: Patient, phone: str) -> User:
    user = await find_patient_user(db, patient, phone)
    if user is None:
        user = await build_patient_user(patient, phone)
        db.add(user)
        await db.flush()
    return user


# ───────────────────────── Bir martalik kod ─────────────────────────
async def issue_login_code(
    db: AsyncSession, user: User, phone: str, ip: str
) -> tuple[str, OTPCode]:
    """Eski faol kodlarni bekor qilib, yangi kod yaratadi (bazaga flush qiladi).

    Kodni YUBORISH chaqiruvchining ishi: yetkazilmasa `otp.used = True` qilinsin.
    """
    old_codes = (
        await db.execute(
            select(OTPCode).where(OTPCode.phone == phone, OTPCode.used == False)  # noqa: E712
        )
    ).scalars().all()
    for old in old_codes:
        old.used = True
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
    return code, otp


# ───────────────────────── Telegram ─────────────────────────
async def unlink_telegram(db: AsyncSession, user: User, ip: str, via: str) -> None:
    user.telegram_chat_id = None
    await db.flush()
    await log_action(
        db, user=user.fullname, role="patient", action="update",
        detail=f"Bemor Telegram ulanishini uzdi ({via})", ip=ip,
    )
