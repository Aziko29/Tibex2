"""Bemorni o'z Telegram kontakti bilan ulaydigan bot webhook'i.

Bu router HECH QANDAY cookie/CSRF talab qilmaydi — Telegram serveri
to'g'ridan-to'g'ri chaqiradi. O'rniga so'rov haqiqiyligi
`X-Telegram-Bot-Api-Secret-Token` headeri orqali tekshiriladi
(security/telegram.py -> verify_webhook_secret).

Xavfsizlik: faqat private chatda Telegramning contact.user_id qiymati
xabar yuboruvchining Telegram ID'siga teng bo'lsa, telefon DB bilan
solishtiriladi. Login OTP faqat shu chatga yuboriladi.
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip
from ..models import OTPCode, Patient, TelegramLinkToken, User
from ..security.audit import log_action
from ..security.rate_limit import hit
from ..security.passwords import hash_password_async
from ..security.otp import normalize_phone
from ..security.otp import OTP_TTL_SECONDS, generate_code, hash_code
from ..security.telegram import (
    request_telegram_contact,
    send_telegram_code,
    send_telegram_text,
    verify_webhook_secret,
)

router = APIRouter()
log = logging.getLogger("tibex.telegram")


async def _send_login_code(db: AsyncSession, user: User, ip: str) -> bool:
    """Bir martalik kodni faqat ulangan Telegram chatiga yuboradi."""
    phone = normalize_phone(user.login)
    try:
        await hit(f"rl:otp:phone:{phone}", limit=3, window=900)
        await hit(f"rl:tg:otp:chat:{user.telegram_chat_id}", limit=3, window=900)
    except HTTPException:
        return False
    old_codes = (await db.execute(select(OTPCode).where(OTPCode.phone == phone, OTPCode.used == False))).scalars().all()  # noqa: E712
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
    if not await send_telegram_code(user.telegram_chat_id, code):
        otp.used = True
        await db.flush()
        return False
    await log_action(db, user=user.fullname, role="patient", action="otp_request", detail="Kirish kodi Telegram bot orqali yuborildi", ip=ip)
    return True


@router.get("/bot-info")
async def telegram_bot_info():
    from ..config import get_settings

    settings = get_settings()
    return {
        "configured": bool(settings.telegram_bot_token and settings.telegram_bot_username),
        "username": settings.telegram_bot_username or "",
    }


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(
        default=None, alias="X-Telegram-Bot-Api-Secret-Token"
    ),
):
    # Telegram serveri qayta-qayta urinishini oldini olish uchun har doim
    # 200 qaytaramiz (xato bo'lsa ham) — lekin himoyasiz so'rovni bajarmaymiz.
    if not verify_webhook_secret(x_telegram_bot_api_secret_token):
        log.warning("Telegram webhook: secret token mos kelmadi")
        return {"ok": True}

    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    message = body.get("message") or body.get("edited_message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    text = (message.get("text") or "").strip()

    if not chat_id:
        return {"ok": True}

    chat_id = str(chat_id)
    ip = client_ip(request) or "telegram"

    # Bir chat_id juda tez-tez urinishlarini cheklaymiz (token bruteforce
    # amalda imkonsiz — token 24 baytli tasodifiy — lekin qo'shimcha himoya).
    try:
        await hit(f"rl:tg:webhook:{chat_id}", limit=20, window=300)
    except Exception:
        return {"ok": True}

    HELP_TEXT = (
        "🏥 TIBEX bot — bemor kabinetiga Telegram orqali kirish.\n\n"
        "/start — botni boshlash va telefonni ulash\n"
        "/code — kirish kodi olish\n"
        "/help — shu yordam xabari\n"
        "/status — akkaunt ulanganligini tekshirish\n"
        "/unlink — Telegramni profildan uzish\n\n"
        "Ulash uchun /start yuboring va Telegram taklif qilgan "
        "\"Telefon raqamimni yuborish\" tugmasini bosing."
    )

    # Telegram kontaktini faqat akkaunt egasining o'zi yubora oladi:
    # contact.user_id chat egasining Telegram ID'siga teng bo'lishi shart.
    contact = message.get("contact")
    sender_id = (message.get("from") or {}).get("id")
    if contact is not None:
        if str(chat.get("type") or "") != "private" or not sender_id or str(contact.get("user_id")) != str(sender_id):
            await send_telegram_text(chat_id, "Xavfsizlik uchun faqat o'zingizning Telegram kontakt raqamingizni yuboring.")
            return {"ok": True}
        phone = normalize_phone(contact.get("phone_number") or "")
        if len(phone) != 13 or not phone.startswith("+998"):
            await send_telegram_text(chat_id, "Telefon raqamini aniqlab bo'lmadi. Qaytadan urinib ko'ring.")
            return {"ok": True}
        patient = (await db.execute(select(Patient).where(Patient.phone_bidx == phone).with_for_update())).scalar_one_or_none()
        if patient is None:
            await send_telegram_text(chat_id, "Bu telefon raqami bilan bemor kabineti topilmadi. Klinikaga murojaat qiling.")
            return {"ok": True}
        user = (await db.execute(select(User).where(User.patient_id == patient.id))).scalar_one_or_none()
        if user is None:
            user = (await db.execute(select(User).where(User.login == phone))).scalar_one_or_none()
            if user is not None and (user.role_key != "patient" or user.patient_id != patient.id):
                await send_telegram_text(chat_id, "Bu raqam bemor akkauntiga xavfsiz bog'lanmadi. Klinikaga murojaat qiling.")
                return {"ok": True}
        if user is None:
            # Faqat Telegram Contact orqali telefon egaligi isbotlangach
            # akkaunt yaratiladi. Parol tasodifiy va foydalanuvchiga berilmaydi;
            # bemor faqat Telegram OTP yoki admin kodi bilan kira oladi.
            user = User(
                fullname=patient.fullname,
                login=phone,
                password_hash=await hash_password_async(secrets.token_urlsafe(32)),
                role_key="patient",
                phone=phone,
                patient_id=patient.id,
                active=True,
            )
            db.add(user)
            await db.flush()
        if not user.active or user.role_key != "patient" or user.patient_id != patient.id:
            await send_telegram_text(chat_id, "Bu bemor akkaunti hozir faol emas. Klinikaga murojaat qiling.")
            return {"ok": True}
        attached = (await db.execute(select(User).where(User.telegram_chat_id == chat_id))).scalar_one_or_none()
        if attached is not None and attached.id != user.id:
            await send_telegram_text(chat_id, "Bu Telegram akkaunti boshqa bemor profiliga ulangan. Avval /unlink yuboring.")
            return {"ok": True}
        if user.telegram_chat_id and user.telegram_chat_id != chat_id:
            await send_telegram_text(chat_id, "Bu bemor profiliga boshqa Telegram ulangan. Avval eski bot chatida /unlink yuboring.")
            return {"ok": True}
        user.telegram_chat_id = chat_id
        await db.flush()
        await log_action(db, user=user.fullname, role="patient", action="update", detail="Bemor Telegram kontaktini self-service orqali uladi", ip=ip)
        if await _send_login_code(db, user, ip):
            await send_telegram_text(chat_id, f"✅ Telegram ulandi, {user.fullname}. Birinchi kirish kodi yuborildi. Kod 5 daqiqa amal qiladi.")
        else:
            await send_telegram_text(chat_id, f"✅ Telegram ulandi, {user.fullname}. Kodni keyinroq olish uchun /code yuboring.")
        return {"ok": True}

    if text.startswith("/start") and len(text.split(maxsplit=1)) == 1:
        linked = (await db.execute(select(User).where(User.telegram_chat_id == chat_id))).scalar_one_or_none()
        if linked and linked.active:
            await send_telegram_text(chat_id, f"✅ Telegram {linked.fullname} profiliga ulangan. Kirish kodi uchun /code yuboring.")
        else:
            await request_telegram_contact(chat_id)
        return {"ok": True}

    if text.startswith("/help"):
        await send_telegram_text(chat_id, HELP_TEXT)
        return {"ok": True}

    if text.startswith("/status"):
        linked_user = (
            await db.execute(select(User).where(User.telegram_chat_id == chat_id))
        ).scalar_one_or_none()
        if linked_user and linked_user.active:
            await send_telegram_text(
                chat_id, f"✅ Ulangan: {linked_user.fullname}."
            )
        else:
            await send_telegram_text(
                chat_id,
                "❌ Bu Telegram hech qanday bemor profiliga ulanmagan. "
                "/help buyrug'i bilan ko'rsatma oling.",
            )
        return {"ok": True}

    if text.startswith("/unlink"):
        linked_user = (
            await db.execute(select(User).where(User.telegram_chat_id == chat_id))
        ).scalar_one_or_none()
        if linked_user is None:
            await send_telegram_text(
                chat_id, "❌ Bu Telegram hech qanday profilga ulanmagan."
            )
            return {"ok": True}
        linked_user.telegram_chat_id = None
        await db.flush()
        await log_action(
            db,
            user=linked_user.fullname,
            role="patient",
            action="update",
            detail="Bemor Telegram ulanishini uzdi (/unlink)",
            ip=ip,
        )
        await send_telegram_text(chat_id, "🔌 Telegram profilidan uzildi.")
        return {"ok": True}

    if text.startswith("/code"):
        linked_user = (await db.execute(select(User).where(User.telegram_chat_id == chat_id))).scalar_one_or_none()
        if not linked_user or not linked_user.active or linked_user.role_key != "patient":
            await request_telegram_contact(chat_id)
            return {"ok": True}
        if await _send_login_code(db, linked_user, ip):
            await send_telegram_text(chat_id, "Yangi kirish kodi yuborildi. Kod 5 daqiqa amal qiladi.")
        else:
            await send_telegram_text(chat_id, "Kodni hozir yubora olmadik yoki urinishlar chekloviga yetdingiz. Keyinroq qayta urinib ko'ring.")
        return {"ok": True}

    if not text.startswith("/start"):
        await send_telegram_text(chat_id, "Noma'lum buyruq. Yordam uchun /help ni yuboring.")
        return {"ok": True}

    # Eski, qisqa muddatli portal tokenlari bilan yaratilgan havolalarni
    # yangilash zarur emas: ular oldingi ulash usuli uchun qo'llab-quvvatlanadi.
    parts = text.split(maxsplit=1)
    token_str = parts[1].strip() if len(parts) > 1 else ""
    if not token_str:
        await request_telegram_contact(chat_id)
        return {"ok": True}

    token_row = (
        await db.execute(
            select(TelegramLinkToken).where(TelegramLinkToken.token == token_str)
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    expires_at = token_row.expires_at if token_row else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if (
        token_row is None
        or token_row.used
        or expires_at is None
        or expires_at < now
    ):
        await send_telegram_text(
            chat_id,
            "❌ Havola yaroqsiz yoki muddati tugagan. Bemor kabinetidan "
            "qaytadan \"Telegram ulash\" tugmasini bosing.",
        )
        return {"ok": True}

    user = (
        await db.execute(select(User).where(User.id == token_row.user_id))
    ).scalar_one_or_none()

    if user is None or not user.active or user.role_key != "patient":
        token_row.used = True
        token_row.used_at = now
        await db.flush()
        await send_telegram_text(chat_id, "❌ Bemor profili topilmadi.")
        return {"ok": True}

    # Shu chat_id boshqa bemorga allaqachon ulangan bo'lsa — jim o'tkazib
    # yubormaymiz, foydalanuvchiga aniq tushuntiramiz (avval uzishi kerak).
    other = (
        await db.execute(
            select(User).where(
                User.telegram_chat_id == chat_id, User.id != user.id
            )
        )
    ).scalar_one_or_none()
    if other is not None:
        token_row.used = True
        token_row.used_at = now
        await db.flush()
        await send_telegram_text(
            chat_id,
            "⚠️ Bu Telegram akkaunt allaqachon boshqa bemor profiliga "
            "ulangan. Avval o'sha profildan uzing, so'ng qayta urinib "
            "ko'ring.",
        )
        return {"ok": True}

    token_row.used = True
    token_row.used_at = now
    user.telegram_chat_id = chat_id
    await db.flush()

    await log_action(
        db,
        user=user.fullname,
        role="patient",
        action="update",
        detail="Bemor Telegram orqali kirishni ulandi",
        ip=ip,
    )

    await send_telegram_text(
        chat_id,
        f"✅ Telegram ulandi, {user.fullname}! Endi TIBEX kirish kodlari "
        "shu botga keladi.",
    )

    return {"ok": True}
