"""Bir martalik bemor kodi — generatsiya, hash va tekshirish."""
import hashlib
import hmac
import logging
import re
import secrets

from .keys import derive

log = logging.getLogger("tibex.otp")

OTP_TTL_SECONDS = 300        # 5 daqiqa
OTP_MAX_ATTEMPTS = 5
OTP_CODE_LENGTH = 6


def normalize_phone(phone: str) -> str:
    """Telefon raqamini yagona formatga keltiradi: +998XXXXXXXXX."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("998") and len(digits) == 12:
        return "+" + digits
    if len(digits) == 9:
        return "+998" + digits
    return "+" + digits if digits else ""


def generate_code() -> str:
    """6 xonali tasodifiy kod."""
    return "".join(str(secrets.randbelow(10)) for _ in range(OTP_CODE_LENGTH))


def hash_code(code: str, phone: str) -> str:
    """Kodni HMAC-SHA256 bilan xeshlaydi (telefon — tuz)."""
    key = derive("otp")
    msg = f"{phone}:{code}".encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def verify_code(code: str, phone: str, stored_hash: str) -> bool:
    """Kodni xesh bilan solishtiradi (constant-time)."""
    expected = hash_code(code, phone)
    return hmac.compare_digest(expected, stored_hash)


async def send_sms(phone: str, code: str) -> bool:
    """SMS butunlay o'chirilgan; tasodifiy chaqiruv ham hech narsa yubormaydi."""
    log.warning("SMS xizmati o'chirilgan; xabar yuborilmadi")
    return False
