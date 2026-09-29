"""Kalitlarni ajratish (32-band): SECRET_KEY'dan HKDF-SHA256 bilan maqsadga xos kalitlar.

Bitta kalit sizib chiqsa ham, boshqa maqsadlar (sessiya/CSRF/OTP/...) buzilmaydi.
"""
import functools

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from ..config import get_settings

PURPOSES = ("session", "csrf", "otp", "fingerprint", "camera")


@functools.lru_cache(maxsize=32)
def _derive(secret: str, purpose: str) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"tibex-key-derivation-v1",
        info=f"tibex:{purpose}".encode("utf-8"),
    ).derive(secret.encode("utf-8"))


def derive(purpose: str) -> bytes:
    if purpose not in PURPOSES:
        raise ValueError(f"Noma'lum kalit maqsadi: {purpose}")
    return _derive(get_settings().secret_key, purpose)
