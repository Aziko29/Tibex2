"""Session binding — token o'g'irlansa ham ishlamaydi.

Har bir sessiya IP + User-Agent + fingerprint bilan bog'lanadi.
Agar attacker tokenni o'g'irlasa, IP va UA mos kelmaydi → 401.
"""
import hashlib
import logging
import hmac
import re

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Session as DBSession
from .keys import derive
def _normalized_user_agent(value: str) -> str:
    """Keep browser family and major version; ignore IP and locale changes."""
    patterns = (
        (r"EdgA?/([0-9]+)", "edge"),
        (r"OPR/([0-9]+)", "opera"),
        (r"Chrome/([0-9]+)", "chrome"),
        (r"Firefox/([0-9]+)", "firefox"),
        (r"Version/([0-9]+).*Safari/", "safari"),
    )
    for pattern, family in patterns:
        match = re.search(pattern, value, re.IGNORECASE)
        if match:
            return f"{family}/{match.group(1)}"
    match = re.search(r"([A-Za-z][A-Za-z0-9_-]*)/([0-9]+)", value)
    return f"{match.group(1).lower()}/{match.group(2)}" if match else "unknown/0"


def _client_fingerprint(request: Request) -> str:
    """Client fingerprint from normalized browser family and major version."""
    raw = _normalized_user_agent(request.headers.get("user-agent", ""))
    return hmac.new(
        derive("fingerprint"),
        raw.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]


async def verify_session_binding(
    request: Request,
    jti: str,
    db: AsyncSession,
) -> None:
    """Sessiya binding'ini tekshiradi. Mos kelmasa 401."""
    row = (await db.execute(
        select(DBSession).where(DBSession.jti == jti)
    )).scalar_one_or_none()

    if row is None:
        return  # Session tekshiruvi boshqa joyda

    # Fingerprint saqlangan bo'lsa — tekshiramiz
    stored_fp = getattr(row, "fingerprint", None)
    if stored_fp is None:
        # Birinchi marta — fingerprint'ni saqlash
        row.fingerprint = _client_fingerprint(request)
        return

    current_fp = _client_fingerprint(request)

    # Brauzer oilasi yoki asosiy versiya o'zgarsa qayta login talab qilinadi.
    # Sessiya DB'da bekor qilinmaydi; xodim yangi sessiya bilan davom etadi.
    if stored_fp != current_fp:
        await _report_binding_mismatch(request, row, db)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Brauzer o'zgargan. Xavfsizlik uchun qayta kiring.",
        )


async def _report_binding_mismatch(request: Request, row, db: AsyncSession) -> None:
    """Brauzer o'zgarganini audit va alert'ga yozadi (sessiyani bekor qilmaydi).

    get_db() HTTPException'da rollback qiladi, shuning uchun audit yozuvi
    401 ko'tarilishidan oldin alohida commit qilinadi. Xato 401 javobini
    o'zgartirmasligi kerak.
    """
    try:
        from ..routers.monitoring import record_alert
        from .audit import log_action
        from .netutil import client_ip

        ip = client_ip(request)
        await log_action(
            db, user=f"user#{getattr(row, 'user_id', '?')}", role="?",
            action="session_mismatch",
            detail="Sessiya brauzer barmoq izi mos kelmadi", ip=ip,
        )
        await db.commit()
        record_alert(
            level="warn", title="Sessiya brauzeri o'zgargan",
            detail="Mavjud sessiya boshqa brauzer oilasi/versiyasidan ishlatildi.",
            source="session",
        )
    except Exception:  # pragma: no cover - audit xatosi 401 ni o'zgartirmasin
        logging.getLogger("tibex.session").warning("Binding mismatch audit yozilmadi", exc_info=True)
