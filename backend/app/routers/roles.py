from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import (
    client_ip,
    get_current_user,
    require_csrf,
    require_permission,
)
from ..models import Role, Session as DBSession, User
from ..realtime import publish, publish_session_revoked
from ..security.audit import log_action

router = APIRouter()


# ═══════════════════════════════════════════════════════════
# TIBEX_ROLE_ESCALATION_FIX_v1: rol darajasidagi himoya
# ═══════════════════════════════════════════════════════════
# Bu modullar/amallar "admin darajasidagi" ruxsatlar hisoblanadi:
# ularni faqat superadmin bera oladi (aks holda har qanday
# "roles.create"/"roles.edit" huquqiga ega xodim o'ziga yoki
# boshqalarga cheksiz huquq berib, tizimni to'liq egallab olishi
# mumkin edi).
_SUPERADMIN_ONLY_PERMISSIONS = {
    "users.create", "users.edit", "users.delete",
    "roles.create", "roles.edit", "roles.delete",
    "settings.edit",
}
_RESERVED_ROLE_KEYS = {"admin", "superadmin", "doctor", "reception", "cashier", "lab", "patient"}

_KNOWN_PERMISSIONS = {
    f"{module}.{action}"
    for module, actions in {
        "patients": ("view", "create", "edit", "delete"),
        "appointments": ("view", "create", "edit", "delete"),
        "users": ("view", "create", "edit", "delete"),
        "roles": ("view", "create", "edit", "delete"),
        "doctors": ("view", "create", "edit", "delete"),
        "services": ("view", "create", "edit", "delete"),
        "equipment": ("view", "create", "edit", "delete"),
        "reagents": ("view", "create", "edit", "delete"),
        "integrations": ("view", "create", "edit", "delete"),
        "lab": ("view", "create", "edit", "verify"),
        "payments": ("view", "create", "refund", "close_shift"),
        "medical": ("view", "edit_diagnosis", "edit_prescription"),
        "reports": ("view", "export"),
        "audit": ("view", "clear", "write"),
        "settings": ("view", "edit"),
        "camera": ("alert",),
        "portal": ("view", "edit_profile", "change_password", "view_appointments", "view_lab", "view_payments"),
    }.items()
    for action in actions
}


def _permissions_require_superadmin(permissions: list[str] | str) -> bool:
    """Berilgan ruxsatlar to'plami admin darajasidagi kuchni beradimi?"""
    if permissions == "*":
        return True
    if not isinstance(permissions, list):
        return False
    return any(p in _SUPERADMIN_ONLY_PERMISSIONS for p in permissions)


def _assert_role_permissions_allowed(
    actor: User,
    permissions: list[str] | str,
    actor_permissions: list[str] | str,
) -> None:
    if permissions == "*":
        if actor.role_key == "superadmin":
            return
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Cheklanmagan ruxsatni faqat superadmin bera oladi",
        )
    if not isinstance(permissions, list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ruxsatlar ro'yxati noto'g'ri")
    unknown = sorted(set(permissions) - _KNOWN_PERMISSIONS)
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Noma'lum ruxsat: {unknown[0]}")
    if actor.role_key == "superadmin":
        return
    if _permissions_require_superadmin(permissions):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Xodimlar/rollarni boshqarish va sozlamalarni o'zgartirish huquqlarini faqat superadmin bera oladi",
        )
    if actor_permissions != "*" and not set(permissions).issubset(set(actor_permissions or [])):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Sizda mavjud bo'lmagan ruxsatni boshqa rolga bera olmaysiz",
        )
    permission_set = set(permissions)
    missing_view = sorted(
        f"{item.split('.', 1)[0]}.view"
        for item in permission_set
        if "." in item
        and item.split(".", 1)[1] != "view"
        and item.split(".", 1)[0] != "camera"
        and f"{item.split('.', 1)[0]}.view" not in permission_set
    )
    if missing_view:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Amal ruxsati uchun avval sahifani ko'rish ruxsati kerak: {missing_view[0]}",
        )


class RoleIn(BaseModel):
    key: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9_]+$")
    name: str = Field(min_length=1, max_length=128)
    icon: str = Field(default="👤", max_length=8)
    color: str = Field(default="lab", max_length=32)
    description: str = ""
    permissions: list[str] | str = Field(default_factory=list)

    @field_validator("name", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class RolePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    icon: str | None = Field(default=None, max_length=8)
    color: str | None = Field(default=None, max_length=32)
    description: str | None = None
    permissions: list[str] | str | None = None
    active: bool | None = None

    @field_validator("name", "description")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value


def _to_dict(r: Role) -> dict:
    return {
        "id": r.id,
        "key": r.key,
        "name": r.name,
        "icon": r.icon,
        "color": r.color,
        "description": r.description,
        "permissions": r.permissions if r.permissions == "*" else (r.permissions or []),
        "active": r.active,
        "system": r.system,
    }


@router.get("")
async def list_roles(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("roles", "view")),
):
    rows = (await db.execute(select(Role).order_by(Role.id))).scalars().all()
    return [_to_dict(r) for r in rows]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_role(
    body: RoleIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("roles", "create")),
):
    if body.key in _RESERVED_ROLE_KEYS and user.role_key != "superadmin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tizim rollari nomini faqat superadmin ishlata oladi")
    existing = (
        await db.execute(select(Role).where(Role.key == body.key))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu kalit band")

    # TIBEX_ROLE_ESCALATION_FIX_v1: admin darajasidagi ruxsatlarni
    # faqat superadmin bera oladi — aks holda "admin"/"superadmin"
    # kalitidan tashqari nom bilan cheksiz huquqli rol yaratib,
    # himoyani chetlab o'tish mumkin edi.
    _assert_role_permissions_allowed(user, body.permissions, _perm.permissions)

    r = Role(
        key=body.key,
        name=body.name,
        icon=body.icon,
        color=body.color,
        description=body.description,
        permissions=body.permissions,
        active=True,
        system=False,
    )
    db.add(r)
    await db.flush()
    await db.refresh(r)
    after = _to_dict(r)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="create",
        detail=f"Yangi rol: {r.name} ({r.key})",
        ip=client_ip(request), after=after,
    )
    await publish("role.created", after)
    return after


@router.patch("/{role_id}", dependencies=[Depends(require_csrf)])
async def update_role(
    role_id: int,
    body: RolePatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("roles", "edit")),
):
    r = (await db.execute(select(Role).where(Role.id == role_id))).scalar_one_or_none()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rol topilmadi")

    # TIBEX_ROLE_ESCALATION_FIX_v1: tizim rollarini (admin, superadmin, ...)
    # faqat superadmin tahrirlay oladi — aks holda oddiy "roles.edit"
    # huquqiga ega xodim admin rolining o'ziga to'liq huquq ("*") yozib
    # qo'yishi mumkin edi.
    if r.system and user.role_key != "superadmin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Tizim rolini faqat superadmin tahrirlay oladi",
        )

    before = _to_dict(r)
    data = body.model_dump(exclude_unset=True)
    for key in ("name", "icon", "color", "description", "permissions", "active"):
        if key in data and data[key] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{key} bo'sh bo'lishi mumkin emas")
    if "name" in data and not data["name"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Rol nomi bo'sh bo'lmasligi kerak")
    old_perms = before.get("permissions")
    old_active = before.get("active")

    # TIBEX_ROLE_ESCALATION_FIX_v1: admin darajasidagi ruxsatlar faqat
    # superadmin tomonidan berilishi mumkin (yangi ro'yxatda ham eskisida
    # ham — chunki mavjud kuchli ruxsatni saqlab, ustiga yana qo'shish
    # ham xavfli).
    if "permissions" in data:
        _assert_role_permissions_allowed(user, data["permissions"], _perm.permissions)
        _assert_role_permissions_allowed(user, old_perms, _perm.permissions)

    for k, v in data.items():
        setattr(r, k, v)
    await db.flush()
    after = _to_dict(r)

    # TIBEX_ROLE_FORTRESS_v1: ruxsatlar o'zgargan → barcha userlar sessiyasi bekor
    permissions_changed = ("permissions" in data and data["permissions"] != old_perms)
    active_changed = ("active" in data and data["active"] != old_active)

    if permissions_changed or active_changed:
        affected_users = (
            await db.execute(select(User).where(User.role_key == r.key))
        ).scalars().all()
        now = datetime.now(timezone.utc)
        for u in affected_users:
            u.session_valid_after = now

        if affected_users:
            user_ids = [u.id for u in affected_users]
            revoked_jtis = (await db.execute(
                select(DBSession.jti).where(DBSession.user_id.in_(user_ids))
            )).scalars().all()
            await db.execute(sa_delete(DBSession).where(DBSession.user_id.in_(user_ids)))
            await db.flush()
            # Close active WebSockets immediately, not on the next 60s tick.
            for jti in revoked_jtis:
                await publish_session_revoked(jti)

        await log_action(
            db, user=user.fullname, role=user.role_key, action="update",
            detail=f"Rol ruxsatlari o'zgardi: {r.name} ({len(affected_users)} ta xodim sessiyasi bekor)",
            ip=client_ip(request), before=before, after=after,
        )
    else:
        await log_action(
            db, user=user.fullname, role=user.role_key, action="update",
            detail=f"Rol tahrirlandi: {r.name}",
            ip=client_ip(request), before=before, after=after,
        )

    await publish("role.updated", after)
    return after


@router.delete("/{role_id}", dependencies=[Depends(require_csrf)])
async def delete_role(
    role_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("roles", "delete")),
):
    r = (await db.execute(select(Role).where(Role.id == role_id))).scalar_one_or_none()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rol topilmadi")
    if r.system:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Tizim rolini o'chirish mumkin emas",
        )
    # TIBEX_ROLE_FORTRESS_v1: aktiv yoki bloklangan userlar bo'lsa o'chirilmaydi
    used = (
        await db.execute(select(func.count()).select_from(User).where(User.role_key == r.key))
    ).scalar_one()
    if used > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Bu rolni {used} ta xodim ishlatmoqda. Avval ularni boshqa rolga o'tkazing.",
        )

    # Rol aktiv userlar bo'lsa ham — rol.active=False qilishni taklif qilamiz
    if r.active:
        # Auto-deactivate
        r.active = False
        await db.flush()
        await publish("role.updated", _to_dict(r))
    before = _to_dict(r)
    await db.delete(r)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="delete",
        detail=f"Rol o'chirildi: {r.name}",
        ip=client_ip(request), before=before,
    )
    await publish("role.deleted", {"id": role_id})
    return {"ok": True}
