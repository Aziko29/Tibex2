"""Bemorni o'z Telegram kontakti bilan ulaydigan bot webhook'i.

Bu router HECH QANDAY cookie/CSRF talab qilmaydi — Telegram serveri
to'g'ridan-to'g'ri chaqiradi. O'rniga so'rov haqiqiyligi
`X-Telegram-Bot-Api-Secret-Token` headeri orqali tekshiriladi
(security/telegram.py -> verify_webhook_secret).

Xavfsizlik: faqat private chatda Telegramning contact.user_id qiymati
xabar yuboruvchining Telegram ID'siga teng bo'lsa, telefon DB bilan
solishtiriladi. Login OTP faqat shu chatga yuboriladi.
"""
import json
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip
from ..models import Patient, TelegramLinkToken, User
from ..security.audit import log_action
from ..security.rate_limit import hit
from ..security.otp import normalize_phone
from ..security.telegram import (
    request_telegram_contact,
    send_telegram_code,
    send_telegram_text,
    verify_webhook_secret,
)
from ..services.patient_service import (
    PatientAccountConflict,
    get_or_create_patient_user,
    issue_login_code,
    unlink_telegram,
)

router = APIRouter()
log = logging.getLogger("tibex.telegram")


# Telegram serveri webhook ishlamay turgan paytda xabarlarni to'plab qo'yadi va
# server qayta ishga tushganda hammasini birdan yuboradi. Eski /code
# buyruqlaridan kod yuborilmasligi uchun faqat yangi xabarlar qabul qilinadi.
CODE_REQUEST_MAX_AGE_SECONDS = 90
CODE_REQUEST_COOLDOWN_SECONDS = 30


def _parse_command(text: str, bot_username: str = "") -> tuple[str, str]:
    """Xabar matnidan (buyruq, argument) ajratadi.

    Faqat matn aynan `/buyruq` yoki `/buyruq@shu_bot` bilan boshlansa buyruq
    hisoblanadi. `/codexyz` yoki boshqa botga mo'ljallangan `/code@boshqa_bot`
    buyruq emas ("", "") qaytadi.
    """
    text = (text or "").strip()
    if not text.startswith("/"):
        return "", ""
    parts = text.split(maxsplit=1)
    head = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""
    if "@" in head:
        head, _, target = head.partition("@")
        if not bot_username or target != bot_username.lower().lstrip("@"):
            return "", ""
    return head, arg


def _deliverable_patient(user: User | None) -> bool:
    return bool(
        user is not None
        and user.active
        and user.role_key == "patient"
        and user.patient_id is not None
        and user.telegram_chat_id
    )


async def _send_login_code(db: AsyncSession, user: User, ip: str) -> bool:
    """Bir martalik kodni faqat ulangan Telegram chatiga yuboradi.

    FAQAT bemor o'zi so'raganda chaqirilishi kerak (botdagi /code buyrug'i).
    Ulanish, /start, /status kabi jarayonlar bu funksiyani chaqirmaydi.
    """
    if not _deliverable_patient(user):
        return False
    chat_id = str(user.telegram_chat_id)
    phone = normalize_phone(user.login)
    try:
        await hit(f"rl:otp:phone:{phone}", limit=3, window=900)
        await hit(f"rl:tg:otp:chat:{chat_id}", limit=3, window=900)
    except HTTPException:
        return False
    code, otp = await issue_login_code(db, user, phone, ip)
    # Kod bazaga saqlanganidan KEYIN yuboriladi: aks holda keyingi xatoda
    # rollback bo'lib, bemorga bazada yo'q (ishlamaydigan) kod ketib qolardi.
    await db.commit()
    if not await send_telegram_code(chat_id, code):
        otp.used = True
        await db.flush()
        return False
    await log_action(db, user=user.fullname, role="patient", action="otp_request", detail="Kirish kodi Telegram bot orqali yuborildi (/code)", ip=ip)
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

    # TIBEX_TG_BODY_LIMIT_v1: Telegram serveri har bir update uchun
    # odatda <10 KB yuboradi. 64 KB chegara bilan olamiz —
    # katta payload (DoS urinishi yoki soxta so'rov) rad etiladi.
    from ..security.input_fortress import read_body_limited
    try:
        raw = await read_body_limited(request, 64 * 1024)
        body = json.loads(raw) if raw else {}
    except HTTPException:
        return {"ok": True}
    except Exception:
        return {"ok": True}

    # Tahrirlangan xabarlar (edited_message) e'tiborga olinmaydi: eski /code
    # xabarini tahrirlash orqali kod qayta yuborilib ketmasligi kerak.
    message = body.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    text = (message.get("text") or "").strip()
    from ..config import get_settings
    cmd, cmd_arg = _parse_command(text, get_settings().telegram_bot_username or "")

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
        # Akkaunt yo'q bo'lsa — faqat Telegram Contact orqali telefon egaligi isbotlangach
        # yaratiladi (parol tasodifiy; bemor faqat Telegram OTP yoki admin kodi bilan kiradi).
        try:
            user = await get_or_create_patient_user(db, patient, phone)
        except PatientAccountConflict:
            await send_telegram_text(chat_id, "Bu raqam bemor akkauntiga xavfsiz bog'lanmadi. Klinikaga murojaat qiling.")
            return {"ok": True}
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
        # Kod bu yerda YUBORILMAYDI: faqat bemor /code yuborgandagina boradi.
        await send_telegram_text(chat_id, f"✅ Telegram ulandi, {user.fullname}. Kirish kodini olish uchun /code yuboring.")
        return {"ok": True}

    if cmd == "/start" and not cmd_arg:
        linked = (await db.execute(select(User).where(User.telegram_chat_id == chat_id))).scalar_one_or_none()
        if linked and linked.active:
            await send_telegram_text(chat_id, f"✅ Telegram {linked.fullname} profiliga ulangan. Kirish kodi uchun /code yuboring.")
        else:
            await request_telegram_contact(chat_id)
        return {"ok": True}

    if cmd == "/help":
        await send_telegram_text(chat_id, HELP_TEXT)
        return {"ok": True}

    if cmd == "/status":
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

    if cmd == "/unlink":
        linked_user = (
            await db.execute(select(User).where(User.telegram_chat_id == chat_id))
        ).scalar_one_or_none()
        if linked_user is None:
            await send_telegram_text(
                chat_id, "❌ Bu Telegram hech qanday profilga ulanmagan."
            )
            return {"ok": True}
        await unlink_telegram(db, linked_user, ip, via="bot /unlink")
        await send_telegram_text(chat_id, "🔌 Telegram profilidan uzildi.")
        return {"ok": True}

    if cmd == "/code":
        # Kod faqat quyidagi barcha shartlar bajarilganda yuboriladi.
        # 1) Faqat shaxsiy (private) chat, yuboruvchi = chat egasi.
        if str(chat.get("type") or "") != "private" or not sender_id or str(sender_id) != chat_id:
            return {"ok": True}
        # 2) Eski (server o'chiq paytida to'planib qolgan) xabarlar e'tiborsiz.
        msg_date = message.get("date")
        if not isinstance(msg_date, int) or time.time() - msg_date > CODE_REQUEST_MAX_AGE_SECONDS:
            log.info("Telegram /code: eski yoki sanasiz xabar e'tiborsiz qoldirildi")
            return {"ok": True}
        # 3) Telegram bir xil update'ni qayta yuborsa, ikkinchi marta ishlamaydi.
        update_id = body.get("update_id")
        if update_id is not None:
            try:
                await hit(f"tg:code:update:{update_id}", limit=1, window=3600)
            except HTTPException:
                return {"ok": True}
        # 4) Ketma-ket bosishdan himoya (double-tap).
        try:
            await hit(f"tg:code:cooldown:{chat_id}", limit=1, window=CODE_REQUEST_COOLDOWN_SECONDS)
        except HTTPException:
            await send_telegram_text(chat_id, "Kod hozirgina yuborilgan. Bir necha soniyadan keyin qayta urinib ko'ring.")
            return {"ok": True}
        # 5) Chat faol bemor profiliga ulangan bo'lishi shart.
        linked_user = (await db.execute(select(User).where(User.telegram_chat_id == chat_id))).scalar_one_or_none()
        if not linked_user or not linked_user.active or linked_user.role_key != "patient" or linked_user.patient_id is None:
            await request_telegram_contact(chat_id)
            return {"ok": True}
        if await _send_login_code(db, linked_user, ip):
            await send_telegram_text(chat_id, "Yangi kirish kodi yuborildi. Kod 5 daqiqa amal qiladi.")
        else:
            await send_telegram_text(chat_id, "Kodni hozir yubora olmadik yoki urinishlar chekloviga yetdingiz. Keyinroq qayta urinib ko'ring.")
        return {"ok": True}

    if cmd != "/start":
        await send_telegram_text(chat_id, "Noma'lum buyruq. Yordam uchun /help ni yuboring.")
        return {"ok": True}

    # Eski, qisqa muddatli portal tokenlari bilan yaratilgan havolalarni
    # yangilash zarur emas: ular oldingi ulash usuli uchun qo'llab-quvvatlanadi.
    token_str = cmd_arg
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
