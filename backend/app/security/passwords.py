"""Parol hashlash - Argon2id + HMAC pepper."""
import asyncio
import weakref
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from ..config import get_settings

# Argon2id parametrlari (OWASP 2024 tavsiyasi)
_ph = PasswordHasher(
    time_cost=3,            # 3 iteratsiya
    memory_cost=64 * 1024,  # 64 MB
    parallelism=2,          # 2 parallel oqim
    hash_len=32,
    salt_len=16,
)
_ARGON2_MAX_PARALLEL = 4
_slots_by_loop: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _argon2_slots() -> asyncio.Semaphore:
    """Har bir event loop uchun alohida semaphore (loop'lar orasida bog'lanib qolmasligi uchun)."""
    loop = asyncio.get_running_loop()
    slots = _slots_by_loop.get(loop)
    if slots is None:
        slots = _slots_by_loop[loop] = asyncio.Semaphore(_ARGON2_MAX_PARALLEL)
    return slots


def _apply_pepper(password: str) -> bytes:
    """Parol + pepper -> HMAC-SHA256 pre-hash (32 bayt)."""
    import hashlib
    import hmac
    key = get_settings().password_pepper.encode("utf-8")
    return hmac.new(key, password.encode("utf-8"), hashlib.sha256).digest()


# A valid Argon2 hash keeps unknown/inactive-account login attempts on the
# same expensive verification path as real accounts. Computed once per worker.
DUMMY_HASH = _ph.hash(_apply_pepper("TIBEX-login-enumeration-dummy"))


def hash_password(password: str) -> str:
    """Argon2id(HMAC-SHA256(parol, pepper))."""
    return _ph.hash(_apply_pepper(password))


# TIBEX_HARDENING: PBKDF2_FALLBACK_v1
def _verify_pbkdf2(stored: str, provided: str) -> bool:
    import base64 as _b, hashlib as _h, hmac as _m
    try:
        parts = stored.split("$")
        if len(parts) != 5 or parts[1] != "pbkdf2-sha256":
            return False
        _, _, iters, salt_b64, hash_b64 = parts
        salt = _b.b64decode(salt_b64)
        exp = _b.b64decode(hash_b64)
        got = _h.pbkdf2_hmac("sha256", _apply_pepper(provided), salt, int(iters))
        return _m.compare_digest(got, exp)
    except Exception:
        return False


def verify_password(stored: str, provided: str) -> tuple[bool, bool]:
    """(muvaffaqiyat, rehash kerakmi)."""
    if not stored:
        return False, False
    if stored.startswith("$argon2"):
        try:
            _ph.verify(stored, _apply_pepper(provided))
            return True, _ph.check_needs_rehash(stored)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False, False
    if stored.startswith("$pbkdf2"):
        if _verify_pbkdf2(stored, provided):
            return True, True
        return False, False
    return False, False


async def hash_password_async(password: str) -> str:
    """Argon2 hisobini event loop'dan tashqarida, xotira limiti bilan bajaradi."""
    async with _argon2_slots():
        return await asyncio.to_thread(hash_password, password)


async def verify_password_async(stored: str, provided: str) -> tuple[bool, bool]:
    """Parol tekshiruvini event loop'dan tashqarida, xotira limiti bilan bajaradi."""
    async with _argon2_slots():
        return await asyncio.to_thread(verify_password, stored, provided)


# TIBEX_PWD_SYSTEM: generator
import secrets as _secrets
import string as _string


def generate_random_password(length: int = 12) -> str:
    """Kuchli tasodifiy parol. Kamida 10 belgi.
    
    Kafolatlangan: 1 kichik harf + 1 katta harf + 1 raqam + 1 belgi.
    """
    if length < 10:
        length = 10
    lower = _string.ascii_lowercase
    upper = _string.ascii_uppercase
    digits = _string.digits
    symbols = "!@#$%^&*"
    all_chars = lower + upper + digits + symbols
    chars = [
        _secrets.choice(lower),
        _secrets.choice(upper),
        _secrets.choice(digits),
        _secrets.choice(symbols),
    ]
    for _ in range(length - 4):
        chars.append(_secrets.choice(all_chars))
    _secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def check_password_strength(password: str) -> tuple[bool, str]:
    """Parol kuchini tekshiradi. (ok, xabar)."""
    if len(password) < 10:
        return False, "Parol kamida 10 belgidan iborat bo'lishi shart"
    has_lower = any(c.islower() for c in password)
    has_upper = any(c.isupper() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_symbol = any(c in _string.punctuation for c in password)
    missing = []
    if not has_lower:
        missing.append("kichik harf")
    if not has_upper:
        missing.append("katta harf")
    if not has_digit:
        missing.append("raqam")
    if not has_symbol:
        missing.append("belgi (!@#$%...)")
    if missing:
        return False, "Parolda quyidagilar bo'lishi shart: " + ", ".join(missing)
    return True, ""
