"""Sessiya/foydalanuvchi holatini tekshirishning yagona mantiqi.

HTTP (`deps.get_current_session`/`get_current_user`) va WebSocket
(`routers/ws.py`) bir xil qoidalarni shu yerdan oladi, shunda ikki joydagi
tekshiruv bir-biridan uzoqlashib ketmaydi.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

# Sabab kodlari
REVOKED = "revoked"
EXPIRED = "expired"
INACTIVE = "inactive"
USER_DISABLED = "user_disabled"
SESSION_RENEWED = "session_renewed"


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def session_row_problem(
    row, now: datetime, inactivity_minutes: int
) -> str | None:
    """Sessiya qatori yaroqsiz bo'lsa sabab kodini qaytaradi, aks holda None."""
    if row is None or row.revoked_at is not None:
        return REVOKED
    if as_utc(row.expires_at) <= now:
        return EXPIRED
    if as_utc(row.last_seen_at) + timedelta(minutes=inactivity_minutes) < now:
        return INACTIVE
    return None


def user_problem(user, iat: int, *, allow_patient: bool = True) -> str | None:
    """Foydalanuvchi faol emas yoki sessiya `session_valid_after` dan eski bo'lsa sabab qaytaradi."""
    if user is None or not user.active:
        return USER_DISABLED
    if not allow_patient and user.role_key == "patient":
        return USER_DISABLED
    valid_after = getattr(user, "session_valid_after", None)
    if valid_after is not None and iat < int(as_utc(valid_after).timestamp()):
        return SESSION_RENEWED
    return None
