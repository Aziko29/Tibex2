import hashlib
import hmac
import secrets

from .keys import derive


def issue_csrf(session_jti: str) -> str:
    nonce = secrets.token_urlsafe(16)
    mac = hmac.new(
        derive("csrf"),
        f"{session_jti}:{nonce}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{nonce}.{mac}"


def verify_csrf(token: str | None, session_jti: str) -> bool:
    if not token or "." not in token:
        return False
    try:
        nonce, mac = token.split(".", 1)
    except ValueError:
        return False
    expected = hmac.new(
        derive("csrf"),
        f"{session_jti}:{nonce}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, mac)
