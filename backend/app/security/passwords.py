"""Parol hashlash va kuch tekshiruvi - Argon2id + HMAC-SHA256 pepper.

``users.password_hash`` (VARCHAR(256)) da saqlanadigan formatlar:

* ``$argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>``  - joriy format (~97 belgi)
* ``$pbkdf2-sha256$<iter>$<salt>$<hash>``           - eski; muvaffaqiyatli kirishda
  avtomatik Argon2id ga ko'chiriladi (``verify_password`` ikkinchi qiymati True)

Pepper almashtirish: yangi pepper ``TIBEX_PASSWORD_PEPPER`` ga, eskisi
``TIBEX_PASSWORD_PEPPER_OLD`` ga (vergul bilan ajratilgan) qo'yiladi. Eski pepper bilan
tasdiqlangan parol kirish paytida yangi pepper bilan qayta hashlanadi, shuning uchun
hech kim parolsiz qolmaydi.
"""
import asyncio
import hashlib
import hmac
import re
import secrets as _secrets
import string as _string
import weakref

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from ..config import get_settings

# Argon2id parametrlari (OWASP minimumidan yuqori: m>=19 MiB, t>=2, p=1).
# O'zgartirsangiz, mavjud hashlar kirishda avtomatik yangilanadi (check_needs_rehash).
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

# users.password_hash ustuni uzunligi (models.User, alembic initial) - audit skripti ham ishlatadi.
DB_HASH_COLUMN_LENGTH = 256
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 256  # API sxemalaridagi max_length bilan bir xil


def _argon2_slots() -> asyncio.Semaphore:
    """Har bir event loop uchun alohida semaphore (loop'lar orasida bog'lanib qolmasligi uchun)."""
    loop = asyncio.get_running_loop()
    slots = _slots_by_loop.get(loop)
    if slots is None:
        slots = _slots_by_loop[loop] = asyncio.Semaphore(_ARGON2_MAX_PARALLEL)
    return slots


def _peppers() -> list[bytes]:
    """[joriy pepper, *eski peppers]. Joriy pepper HAR DOIM birinchi va o'zgarmagan holda."""
    s = get_settings()
    out = [s.password_pepper.encode("utf-8")]
    for item in (getattr(s, "password_pepper_old", "") or "").split(","):
        item = item.strip()
        if item and item.encode("utf-8") not in out:
            out.append(item.encode("utf-8"))
    return out


def _apply_pepper(password: str, pepper: bytes | None = None) -> bytes:
    """Parol + pepper -> HMAC-SHA256 pre-hash (32 bayt)."""
    key = pepper if pepper is not None else get_settings().password_pepper.encode("utf-8")
    return hmac.new(key, password.encode("utf-8"), hashlib.sha256).digest()


# A valid Argon2 hash keeps unknown/inactive-account login attempts on the
# same expensive verification path as real accounts. Computed once per worker.
DUMMY_HASH = _ph.hash(_apply_pepper("TIBEX-login-enumeration-dummy"))


def hash_password(password: str) -> str:
    """Argon2id(HMAC-SHA256(parol, joriy pepper))."""
    return _ph.hash(_apply_pepper(password))


# TIBEX_HARDENING: PBKDF2_FALLBACK_v1
def _verify_pbkdf2(stored: str, provided: str, pepper: bytes | None = None) -> bool:
    import base64 as _b
    try:
        parts = stored.split("$")
        if len(parts) != 5 or parts[1] != "pbkdf2-sha256":
            return False
        _, _, iters, salt_b64, hash_b64 = parts
        salt = _b.b64decode(salt_b64)
        exp = _b.b64decode(hash_b64)
        got = hashlib.pbkdf2_hmac("sha256", _apply_pepper(provided, pepper), salt, int(iters))
        return hmac.compare_digest(got, exp)
    except Exception:
        return False


def verify_password(stored: str, provided: str) -> tuple[bool, bool]:
    """(muvaffaqiyat, rehash kerakmi).

    Rehash kerak: Argon2 parametrlari eskirgan, hash PBKDF2 bo'lgan yoki parol ESKI pepper
    bilan tasdiqlangan holat. Noma'lum/dummy hashlar ham xuddi shu halqadan o'tadi, shuning
    uchun vaqt farqi orqali akkaunt borligini aniqlab bo'lmaydi.
    """
    if not stored or not isinstance(provided, str):
        return False, False
    is_argon = stored.startswith("$argon2")
    if not is_argon and not stored.startswith("$pbkdf2"):
        return False, False
    for index, pepper in enumerate(_peppers()):
        if is_argon:
            try:
                _ph.verify(stored, _apply_pepper(provided, pepper))
            except InvalidHashError:
                return False, False
            except (VerifyMismatchError, VerificationError):
                continue
            return True, index > 0 or _ph.check_needs_rehash(stored)
        if _verify_pbkdf2(stored, provided, pepper):
            return True, True
    return False, False


async def hash_password_async(password: str) -> str:
    """Argon2 hisobini event loop'dan tashqarida, xotira limiti bilan bajaradi."""
    async with _argon2_slots():
        return await asyncio.to_thread(hash_password, password)


async def verify_password_async(stored: str, provided: str) -> tuple[bool, bool]:
    """Parol tekshiruvini event loop'dan tashqarida, xotira limiti bilan bajaradi."""
    async with _argon2_slots():
        return await asyncio.to_thread(verify_password, stored, provided)


# ─────────────────────────── Parol kuchi ───────────────────────────
# Umumiy/taxmin qilinadigan parollar: kichik harfga o'tkazilib, oxiridagi raqam/belgilar
# olib tashlanib va leet (p@ssw0rd) yozuvi tuzatilgandan keyin TO'LIQ moslik bo'yicha
# solishtiriladi (substring emas: "Str0ng!Passw0rd#42" kabi uzun iboralar o'tadi).
_COMMON_BASES = frozenset(
    """
    password pass passwd parol parolim parolingiz mypassword newpassword adminpassword
    qwerty qwertyuiop qwertyui asdfgh asdfghjkl zxcvbn zxcvbnm azerty qazwsx
    admin administrator adminadmin root toor user username test tester testing guest demo
    login welcome letmein changeme change default temp temporary secret
    hello hellothere iloveyou monkey dragon master sunshine princess football baseball
    superman batman starwars shadow freedom whatever trustno abc abcdef abcd
    tibex tibexuz klinika clinic shifokor doctor qabulxona reception kassa cashier
    laboratoriya lab bemor patient tibbiyot hospital
    salom ozbek ozbekiston uzbek uzbekistan toshkent tashkent samarqand
    """.split()
)
_LEET = str.maketrans({"@": "a", "4": "a", "0": "o", "3": "e", "$": "s", "5": "s", "1": "i", "7": "t"})
_KEYBOARD_RUNS = (
    "qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "0987654321",
    "poiuytrewq", "lkjhgfdsa", "mnbvcxz",
)
_SEQ_LEN = 5
_TRAILING = _string.digits + _string.punctuation + " "


def _is_common(password: str) -> bool:
    core = password.lower().rstrip(_TRAILING)
    for cand in (core, core.lstrip(_string.digits)):
        letters = re.sub(r"[^a-z]", "", cand.translate(_LEET))
        if letters in _COMMON_BASES:
            return True
        raw = re.sub(r"[^a-z]", "", cand)
        if raw in _COMMON_BASES:
            return True
    return False


def _has_sequence(password: str) -> bool:
    low = password.lower()
    for run in _KEYBOARD_RUNS:
        for i in range(len(run) - _SEQ_LEN + 1):
            if run[i:i + _SEQ_LEN] in low:
                return True
    streak, direction = 1, 0
    for a, b in zip(low, low[1:]):
        step = ord(b) - ord(a)
        if a.isalnum() and b.isalnum() and step in (1, -1):
            streak = streak + 1 if step == direction else 2
            direction = step
        else:
            streak, direction = 1, 0
        if streak >= _SEQ_LEN:
            return True
    return False


def _contains_identity(password: str, login: str | None, fullname: str | None) -> bool:
    low = password.lower()
    if login and len(login.strip()) >= 4 and login.strip().lower() in low:
        return True
    if fullname:
        for token in re.split(r"[^\w]+", fullname.lower()):
            if len(token) >= 4 and token in low:
                return True
    return False


def check_password_strength(
    password: str, *, login: str | None = None, fullname: str | None = None
) -> tuple[bool, str]:
    """Parol kuchini tekshiradi. (ok, xabar).

    ``login`` / ``fullname`` berilsa, parol ularni o'z ichiga olmasligi ham tekshiriladi.
    """
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        return False, "Parol kamida 10 belgidan iborat bo'lishi shart"
    if len(password) > MAX_PASSWORD_LENGTH:
        return False, f"Parol {MAX_PASSWORD_LENGTH} belgidan oshmasligi kerak"
    if any(ord(c) < 32 or ord(c) == 127 for c in password):
        return False, "Parolda boshqaruv belgilari (Enter, Tab va h.k.) bo'lmasligi kerak"
    missing = []
    if not any(c.islower() for c in password):
        missing.append("kichik harf")
    if not any(c.isupper() for c in password):
        missing.append("katta harf")
    if not any(c.isdigit() for c in password):
        missing.append("raqam")
    if not any(c in _string.punctuation for c in password):
        missing.append("belgi (!@#$%...)")
    if missing:
        return False, "Parolda quyidagilar bo'lishi shart: " + ", ".join(missing)
    if len({c.lower() for c in password}) < 5:
        return False, "Parolda kamida 5 xil belgi bo'lishi kerak"
    if re.search(r"(.)\1{3,}", password):
        return False, "Bir xil belgi 3 martadan ko'p ketma-ket takrorlanmasin"
    if _has_sequence(password):
        return False, "Parolda oson taxmin qilinadigan ketma-ketlik bor (12345, abcde, qwert...)"
    if _is_common(password):
        return False, "Bu parol juda keng tarqalgan — boshqa, noyob parol tanlang"
    if _contains_identity(password, login, fullname):
        return False, "Parolda login yoki F.I.Sh bo'lmasligi kerak"
    return True, ""


# TIBEX_PWD_SYSTEM: generator
# O'qishda adashtiriladigan belgilar (0 O 1 l I) chiqarib tashlangan.
_GEN_LOWER = "".join(c for c in _string.ascii_lowercase if c != "l")
_GEN_UPPER = "".join(c for c in _string.ascii_uppercase if c not in "IO")
_GEN_DIGITS = "".join(c for c in _string.digits if c not in "01")
_GEN_SYMBOLS = "!@#$%^&*-_+=?"


def generate_random_password(length: int = 16) -> str:
    """Kuchli tasodifiy parol (secrets, CSPRNG). Uzunlik 12..128 oralig'iga keltiriladi.

    Kafolatlangan: 1 kichik harf + 1 katta harf + 1 raqam + 1 belgi, va natija
    ``check_password_strength`` dan o'tadi (aks holda qayta generatsiya qilinadi).
    """
    length = max(12, min(int(length), 128))
    pools = (_GEN_LOWER, _GEN_UPPER, _GEN_DIGITS, _GEN_SYMBOLS)
    all_chars = "".join(pools)
    for _ in range(100):
        chars = [_secrets.choice(p) for p in pools]
        chars += [_secrets.choice(all_chars) for _ in range(length - len(chars))]
        _secrets.SystemRandom().shuffle(chars)
        candidate = "".join(chars)
        if check_password_strength(candidate)[0]:
            return candidate
    raise RuntimeError("Kuchli parol generatsiya qilib bo'lmadi")
