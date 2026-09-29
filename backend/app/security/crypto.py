"""Context-bound AES-GCM fields with explicit, versioned key rotation."""
import base64
import hashlib
import hmac
import json
import logging
import os
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import String, Text
from sqlalchemy.types import TypeDecorator

log = logging.getLogger("tibex.crypto")


class DecryptionError(ValueError):
    """Ciphertext cannot be authenticated/decrypted with configured keys."""


def _load_key(b64: str) -> bytes:
    try:
        key = base64.b64decode(b64, validate=True)
    except Exception as exc:
        raise ValueError("Kalit base64 formatida emas") from exc
    if len(key) != 32:
        raise ValueError("Kalit 32 bayt bo'lishi shart (AES-256)")
    return key


class _KeyRing:
    def __init__(self) -> None:
        self.active_id = "1"
        self._keys: dict[str, bytes] | None = None

    def _ensure(self) -> None:
        if self._keys is not None:
            return
        from ..config import get_settings

        settings = get_settings()
        keys_file = getattr(settings, "master_keys_file", None)
        if keys_file:
            try:
                with open(keys_file, "r", encoding="utf-8") as f:
                    raw_keys = json.load(f)
            except (OSError, json.JSONDecodeError) as exc:
                raise RuntimeError("Master kalitlar faylini o'qib bo'lmadi") from exc
            if not isinstance(raw_keys, dict) or not raw_keys:
                raise ValueError("Master kalitlar fayli bo'sh yoki noto'g'ri")
            keys = {str(k): _load_key(v) for k, v in raw_keys.items()}
        else:
            # Eski sozlamalar bilan moslik: master_key_b64 = ID "1".
            keys = {"1": _load_key(settings.master_key_b64)}
            old = (getattr(settings, "master_key_b64_old", "") or "").strip()
            if old:
                for index, encoded in enumerate(old.split(","), start=2):
                    if encoded.strip():
                        keys[str(index)] = _load_key(encoded.strip())
            log.warning("Eskirgan master_key_b64 sozlamasi ishlatilmoqda; master_keys_file ga o'ting")
        active_id = str(getattr(settings, "master_active_key_id", "1"))
        if active_id not in keys:
            raise ValueError("Faol master kalit ID'si kalitlar faylida topilmadi")
        if len(set(keys.values())) != len(keys):
            raise ValueError("Master kalitlar takrorlanmas bo'lishi kerak")
        self._keys = keys
        self.active_id = active_id

    def encrypt(self, plaintext: str, context: str = "") -> str:
        self._ensure()
        assert self._keys is not None
        nonce = os.urandom(12)
        aad = f"{self.active_id}|{context}".encode("utf-8")
        ciphertext = AESGCM(self._keys[self.active_id]).encrypt(
            nonce, plaintext.encode("utf-8"), aad
        )
        return f"{self.active_id}:{base64.b64encode(nonce + ciphertext).decode('ascii')}"

    def decrypt(self, token: str, context: str = "") -> str:
        self._ensure()
        assert self._keys is not None
        try:
            key_id, encoded = token.split(":", 1)
            key = self._keys.get(key_id)
            blob = base64.b64decode(encoded, validate=True)
            if key is None or len(blob) < 12 + 16:
                raise DecryptionError("Shifrlangan qiymat yoki kalit ID yaroqsiz")
            aad = f"{key_id}|{context}".encode("utf-8")
            return AESGCM(key).decrypt(blob[:12], blob[12:], aad).decode("utf-8")
        except DecryptionError:
            raise
        except (ValueError, UnicodeError, InvalidTag) as exc:
            raise DecryptionError("Shifrlangan qiymatni tekshirib bo'lmadi") from exc

    def decrypt_legacy_aad(self, token: str, context: str = "") -> str:
        """Explicit legacy AAD reader used only by the controlled re-encryption tool."""
        self._ensure()
        assert self._keys is not None
        try:
            key_id, encoded = token.split(":", 1)
            key = self._keys.get(key_id)
            blob = base64.b64decode(encoded, validate=True)
            if key is None or len(blob) < 28:
                raise DecryptionError("Eski shifrlangan qiymat yaroqsiz")
            return AESGCM(key).decrypt(
                blob[:12], blob[12:], key_id.encode("utf-8")
            ).decode("utf-8")
        except DecryptionError:
            raise
        except (ValueError, UnicodeError, InvalidTag) as exc:
            raise DecryptionError("Eski AAD qiymatini o'qib bo'lmadi") from exc


_ring = _KeyRing()


def _blind_key() -> bytes:
    from ..config import get_settings

    return _load_key(get_settings().blind_index_key_b64)


def blind_index(value: str | None, context: str) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().lower().encode("utf-8")
    return hmac.new(_blind_key(), context.encode("utf-8") + b":" + normalized, hashlib.sha256).hexdigest()


def _decrypt_or_raise(value: str, context: str) -> str:
    try:
        return _ring.decrypt(value, context)
    except DecryptionError:
        log.critical("Shifrlangan DB qiymati o'qilmadi (context=%s)", context)
        try:
            from ..routers.monitoring import record_alert
            record_alert("critical", "DB shifrlangan qiymati o'qilmadi", f"context={context}", source="crypto")
        except Exception:
            log.exception("Shifrlash xatosi uchun alert yozilmadi")
        raise


class _EncryptedBase(TypeDecorator):
    cache_ok = True

    def __init__(self, context: str = "", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.context = context

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return _ring.encrypt(self._serialize(value), self.context)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return self._deserialize(_decrypt_or_raise(value, self.context))

    def _serialize(self, value: Any) -> str:
        return str(value)

    def _deserialize(self, value: str) -> Any:
        return value


class EncryptedString(_EncryptedBase):
    impl = String


class EncryptedText(_EncryptedBase):
    """Uzoq matnlar uchun AES-GCM."""
    impl = Text


class EncryptedJSON(_EncryptedBase):
    """JSON qiymatlarini context-bound AES-GCM bilan saqlash."""
    impl = Text

    def _serialize(self, value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def _deserialize(self, value: str) -> Any:
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise DecryptionError("Shifrlangan JSON qiymati noto'g'ri") from exc


class BlindIndexString(TypeDecorator):
    impl = String(64)
    cache_ok = True

    def __init__(self, context: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.context = context

    def process_bind_param(self, value, dialect):
        return blind_index(value, self.context)

    def process_result_value(self, value, dialect):
        return value
