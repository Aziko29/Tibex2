"""Telegram botga xabar va bir martalik kirish kodi yuborish."""
import hmac
import logging
import secrets

from ..config import get_settings

log = logging.getLogger("tibex.telegram")

LINK_TOKEN_TTL_SECONDS = 600  # 10 daqiqa


def bot_configured() -> bool:
    s = get_settings()
    return bool(getattr(s, "telegram_bot_token", "") and getattr(s, "telegram_bot_username", ""))


def generate_link_token() -> str:
    """Eski, avval login qilingan bemorlar uchun qisqa muddatli ulash tokeni."""
    return secrets.token_urlsafe(24)


def build_deeplink(token: str) -> str | None:
    s = get_settings()
    username = getattr(s, "telegram_bot_username", "") or ""
    if not username:
        return None
    return f"https://t.me/{username}?start={token}"


def verify_webhook_secret(header_value: str | None) -> bool:
    """Telegramning `X-Telegram-Bot-Api-Secret-Token` headerini tekshiradi.

    Agar TIBEX_TELEGRAM_WEBHOOK_SECRET sozlanmagan bo'lsa (dev muhit) —
    tekshiruv o'tkazib yuboriladi (True), lekin bu FAQAT dev uchun mo'ljallangan.
    """
    s = get_settings()
    secret = getattr(s, "telegram_webhook_secret", "") or ""
    if not secret:
        return not s.is_prod
    if not header_value:
        return False
    return hmac.compare_digest(header_value, secret)


async def _send_message(chat_id: str, text: str) -> bool:
    s = get_settings()
    token = getattr(s, "telegram_bot_token", "") or ""

    if not token:
        log.error("Telegram xabari yuborilmadi: bot token sozlanmagan")
        return False
    try:
        import httpx

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {"chat_id": chat_id, "text": text}
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, json=payload)
            if r.status_code == 200:
                log.info("Telegram xabar yuborildi")
                return True
            log.error("Telegram provayderi xatosi (HTTP %s)", r.status_code)
            return False
    except Exception:
        # The bot token is part of the request URL; never log exception text.
        log.error("Telegram provayderiga ulanishda xato")
        return False


async def request_telegram_contact(chat_id: str) -> bool:
    """Telegramning o'z Contact ulash tugmasini ko'rsatadi."""
    s = get_settings()
    token = getattr(s, "telegram_bot_token", "") or ""
    if not token:
        return False
    try:
        import httpx

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": "Bemor akkauntingizni ulash uchun pastdagi tugmani bosib, Telegram kontakt raqamingizni yuboring.",
            "reply_markup": {
                "keyboard": [[{"text": "📱 Telefon raqamimni yuborish", "request_contact": True}]],
                "resize_keyboard": True,
                "one_time_keyboard": True,
            },
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            return response.status_code == 200
    except Exception:
        log.error("Telegram contact tugmasini yuborishda xato")
        return False

async def send_telegram_code(chat_id: str, code: str) -> bool:
    """OTP kirish kodini Telegram orqali yuboradi."""
    text = f"TIBEX: kirish kodi {code}. Kod 5 daqiqa amal qiladi."
    return await _send_message(chat_id, text)


async def send_telegram_text(chat_id: str, text: str) -> bool:
    """Ixtiyoriy matnli xabar (masalan, ulash tasdiqlash javobi)."""
    return await _send_message(chat_id, text)
