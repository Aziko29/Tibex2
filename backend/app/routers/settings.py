"""Tizim sozlamalari routeri."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip, get_current_user, require_csrf, require_permission
from ..models import Role, SystemSetting, User
from ..realtime import publish
from ..security.audit import log_action

router = APIRouter()


DEFAULT_SETTINGS: dict[str, Any] = {
    "vat": True,
    "sms": False,
    "equipService": True,
    "reagentAlert": True,
    "medicalLock": True,
    "audit": True,
    "discount_limit": 20,
    "clinic_name": "TIBEX Klinika",
    "clinic_phone": "+998 71 200 00 00",
    "clinic_address": "Toshkent sh., Chilonzor tumani",
    "backup_hour": 6,
}


class SettingsPatch(BaseModel):
    model_config = {"extra": "allow"}


# TIBEX_SETTINGS_VALIDATION_FIX_v1: faqat ma'lum kalitlarga ruxsat
# beriladi, har birining turi/oralig'i tekshiriladi — aks holda
# noto'g'ri qiymat (masalan, matn discount_limit) keyinchalik
# payments.py da int(...) xatosiga va to'lov qabul qilish
# to'xtab qolishiga olib kelardi.
def _validate_setting_value(key: str, value: Any) -> Any:
    if key not in DEFAULT_SETTINGS:
        raise ValueError(f"Noma'lum sozlama: {key}")
    default = DEFAULT_SETTINGS[key]
    if isinstance(default, bool):
        if not isinstance(value, bool):
            raise ValueError(f"{key} mantiqiy (true/false) qiymat bo'lishi kerak")
        return value
    if key == "discount_limit":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError("discount_limit son bo'lishi kerak")
        ivalue = int(value)
        if not (0 <= ivalue <= 100):
            raise ValueError("discount_limit 0 dan 100 gacha bo'lishi kerak")
        return ivalue
    if key == "backup_hour":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError("backup_hour son bo'lishi kerak")
        ivalue = int(value)
        if not (0 <= ivalue <= 23):
            raise ValueError("backup_hour 0 dan 23 gacha bo'lishi kerak")
        return ivalue
    if isinstance(default, str):
        if not isinstance(value, str):
            raise ValueError(f"{key} matn bo'lishi kerak")
        return value.strip()
    return value


def _unwrap(v: Any) -> Any:
    if isinstance(v, dict) and "value" in v and len(v) == 1:
        return v["value"]
    return v


async def get_setting_value(db: AsyncSession, key: str, default: Any = None) -> Any:
    """Bitta sozlama qiymatini o'qiydi (boshqa routerlar uchun umumiy yordamchi).

    Agar DB'da yozuv bo'lmasa, DEFAULT_SETTINGS'dagi (yoki berilgan) default qaytadi.
    """
    row = await db.get(SystemSetting, key)
    if row is None:
        return DEFAULT_SETTINGS.get(key, default)
    return _unwrap(row.value)


@router.get("")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("settings", "view")),
):
    rows = (await db.execute(select(SystemSetting))).scalars().all()
    stored = {r.key: r.value for r in rows}
    out = {}
    for k, default_v in DEFAULT_SETTINGS.items():
        out[k] = False if k == "sms" else _unwrap(stored.get(k, default_v))
    return out


@router.patch("", dependencies=[Depends(require_csrf)])
async def update_settings(
    body: SettingsPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("settings", "edit")),
):
    data = body.model_dump(exclude_unset=True)
    if data.get("sms") is True:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "SMS xizmati o'chirilgan; bu sozlamani yoqib bo'lmaydi")
    if not data:
        return {"ok": True, "updated": []}

    # TIBEX_SETTINGS_VALIDATION_FIX_v1: har bir kalit/qiymatni tekshirish —
    # noma'lum kalitlar yoki noto'g'ri turdagi qiymatlar rad etiladi.
    validated: dict[str, Any] = {}
    for k, v in data.items():
        try:
            validated[k] = _validate_setting_value(k, v)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    updated_keys = []
    for k, v in validated.items():
        row = await db.get(SystemSetting, k)
        if row is None:
            db.add(SystemSetting(key=k, value=v, updated_by=user.fullname))
        else:
            row.value = v
            row.updated_by = user.fullname
        updated_keys.append(k)

    await db.flush()
    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail=f"Sozlamalar yangilandi: {', '.join(updated_keys)}",
        ip=client_ip(request),
    )
    await publish("settings.updated", validated)

    # Yangi holatni qaytaramiz (GET bilan bir xil formatda — {"value": X}
    # o'rovi har doim yechilgan holda)
    rows = (await db.execute(select(SystemSetting))).scalars().all()
    stored = {r.key: r.value for r in rows}
    out = {}
    for k, default_v in DEFAULT_SETTINGS.items():
        out[k] = _unwrap(stored.get(k, default_v))
    return out
