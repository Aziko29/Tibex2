import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone

from .keys import derive


def _sign(payload: str) -> str:
    return hmac.new(
        derive("session"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


# TIBEX_HARDENING: SESSION_KIND_v1
def create_token(user_id: int, ttl_seconds: int, kind: str = "staff") -> tuple[str, str, datetime]:
    jti = secrets.token_urlsafe(16)
    now = int(time.time())
    exp = now + ttl_seconds
    payload = f"{kind}:{user_id}:{jti}:{now}:{exp}"
    token = f"{payload}:{_sign(payload)}"
    return token, jti, datetime.fromtimestamp(exp, tz=timezone.utc)


def parse_token(token: str, expected_kind: str | None = None) -> dict | None:
    try:
        kind, uid, jti, iat, exp, sig = token.split(":")
    except ValueError:
        return None
    payload = f"{kind}:{uid}:{jti}:{iat}:{exp}"
    expected = _sign(payload)
    if not hmac.compare_digest(expected, sig):
        return None
    if int(exp) < int(time.time()):
        return None
    if expected_kind is not None and kind != expected_kind:
        return None
    return {"kind": kind, "user_id": int(uid), "jti": jti, "iat": int(iat), "exp": int(exp)}
