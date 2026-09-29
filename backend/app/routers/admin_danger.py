"""Xavfli admin amallari — 2-bosqichli himoya."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import client_ip, get_current_user, require_csrf, require_permission
from ..models import Role, User
from ..redis_client import get_redis
from ..security.audit import log_action
from ..security.passwords import verify_password_async
from ..services.demo_reset import run_full_reset

router = APIRouter()


class DemoResetIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)
    reset_code: str = Field(..., min_length=1, max_length=128)
    # TIBEX_FULL_DEMO_RESET_v1: standart holatda xodim akkauntlari
    # tegilmaydi (aks holda hech kim kira olmay qoladi). Chinakam "0"
    # holatga qaytarish uchun ataylab True yuborish kerak.
    wipe_staff: bool = False
    # wipe_staff=True bo'lganda ham ushbu login'lar (kichik harf, vergul
    # bilan emas — ro'yxat) o'chirilmaydi, masalan joriy foydalanuvchi.
    keep_logins: list[str] = Field(default_factory=list)


@router.post("/demo-reset", dependencies=[Depends(require_csrf)])
async def demo_reset(
    body: DemoResetIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("settings", "edit")),
):
    """Demo reset — 2 bosqichli himoya.

    1-bosqich: foydalanuvchining o'z paroli
    2-bosqich: TIBEX_DEMO_RESET_CODE (faqat superadmin biladi)
    """
    s = get_settings()

    # ─── Himoya 0: kod sozlanganmi? ───
    if not s.demo_reset_code or len(s.demo_reset_code) < 16:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Demo reset o'chirilgan. TIBEX_DEMO_RESET_CODE .env da o'rnatilmagan.",
        )

    # ─── Himoya 1: foydalanuvchining o'z paroli ───
    ok, _ = await verify_password_async(user.password_hash, body.password)
    if not ok:
        await log_action(
            db, user=user.fullname, role=user.role_key, action="delete",
            detail="DEMO RESET urinishi — parol xato",
            ip=client_ip(request),
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Parol xato")

    # ─── Himoya 2: maxsus reset kodi (constant-time) ───
    import hmac
    if not hmac.compare_digest(body.reset_code, s.demo_reset_code):
        await log_action(
            db, user=user.fullname, role=user.role_key, action="delete",
            detail="DEMO RESET urinishi — reset kodi xato",
            ip=client_ip(request),
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Reset kodi xato")

    # ─── Himoya 3: superadmin ekanligini qayta tekshirish ───
    if user.role_key not in ("admin", "superadmin"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Faqat admin bu amalni bajara oladi",
        )

    # ─── TO'LIQ RESET (biznes ma'lumotlar + sessiya/audit "axlati") ───
    counts = await run_full_reset(
        db,
        performed_by=user.fullname,
        wipe_staff=body.wipe_staff,
        keep_logins=body.keep_logins,
        redis=get_redis(),
    )

    # ─── Audit (reset'dan KEYIN yoziladi — audit_logs ham tozalangan edi) ───
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="delete",
        detail=(
            f"⚠️ DEMO RESET bajarildi (wipe_staff={body.wipe_staff}). O'chirilgan: "
            + ", ".join(f"{k}={v}" for k, v in counts.items())
        ),
        ip=client_ip(request),
    )
    await db.commit()

    return {
        "ok": True,
        "deleted": counts,
        "message": "Demo reset bajarildi. Tizim '0' holatiga qaytarildi.",
        "ts": datetime.now(timezone.utc).isoformat(),
    }
