"""Bemor kabinetidagi Telegram ulanishi (status / havola / uzish).

Prefiks: /api/portal/telegram. Botning o'zi (webhook) -> telegram.py.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip, require_patient, require_patient_csrf
from ..models import TelegramLinkToken, User
from ..security.audit import log_action
from ..security.rate_limit import hit
from ..security.telegram import (
    LINK_TOKEN_TTL_SECONDS,
    bot_configured,
    build_deeplink,
    generate_link_token,
)
from ..services.patient_service import unlink_telegram

router = APIRouter()


@router.get("/status")
async def telegram_status(user: User = Depends(require_patient)):
    return {"linked": bool(user.telegram_chat_id), "available": bot_configured()}


@router.post("/link-token", dependencies=[Depends(require_patient_csrf)])
async def telegram_link_token(
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    """Kirgan bemor uchun bir martalik /start havolasini beradi."""
    if not bot_configured():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Telegram bot hozircha sozlanmagan. Administrator bilan bog'laning.",
        )

    ip = client_ip(request) or "unknown"
    await hit(f"rl:tg:link:user:{user.id}", limit=5, window=900)

    # Bir vaqtda faqat bitta faol havola bo'lsin.
    old = (
        await db.execute(
            select(TelegramLinkToken).where(
                TelegramLinkToken.user_id == user.id,
                TelegramLinkToken.used == False,  # noqa: E712
            )
        )
    ).scalars().all()
    for t in old:
        t.used = True

    row = TelegramLinkToken(
        token=generate_link_token(),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=LINK_TOKEN_TTL_SECONDS),
        ip=ip,
    )
    db.add(row)
    await db.flush()

    await log_action(
        db, user=user.fullname, role="patient", action="update",
        detail="Bemor Telegram ulash havolasini so'radi", ip=ip,
    )
    return {
        "link": build_deeplink(row.token),
        "ttl_seconds": LINK_TOKEN_TTL_SECONDS,
        "expires_at": int(row.expires_at.timestamp() * 1000),
    }


@router.post("/unlink", dependencies=[Depends(require_patient_csrf)])
async def telegram_unlink(
    request: Request,
    user: User = Depends(require_patient),
    db: AsyncSession = Depends(get_db),
):
    await unlink_telegram(db, user, client_ip(request), via="kabinet")
    return {"ok": True}
