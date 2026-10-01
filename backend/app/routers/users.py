import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import (
    client_ip,
    get_current_user,
    require_csrf,
    require_permission,
)
from ..models import Doctor, Role, Session as DBSession, User
from sqlalchemy import delete as sa_delete
from ..realtime import publish
from ..security.audit import log_action
from ..security.passwords import (
    check_password_strength,
    hash_password_async,
    generate_random_password,
    verify_password_async,
)
from ..realtime import publish_session_revoked

router = APIRouter()


async def _delete_user_sessions(db: AsyncSession, user_id: int) -> list[str]:
    session_ids = (await db.execute(
        select(DBSession.jti).where(DBSession.user_id == user_id)
    )).scalars().all()
    await db.execute(sa_delete(DBSession).where(DBSession.user_id == user_id))
    return session_ids


async def _publish_revoked_sessions(session_ids: list[str]) -> None:
    for session_id in session_ids:
        await publish_session_revoked(session_id)


# ═══════════════════════════════════════════════════════════
# PRIVILEGE ESCALATION HIMOYASI
# ═══════════════════════════════════════════════════════════
from fastapi import status as _status


async def _check_user_modification(
    db: AsyncSession,
    actor: User,
    target: User,
    action: str = "edit",
):
    """Boshqa userni tahrirlash/o'chirish himoyasi.

    Qoidalar:
      1. O'zini tahrirlash — mumkin (faqat o'z ma'lumotlari)
      2. Admin boshqa adminni — faqat superadmin
      3. Oddiy xodim boshqa xodimni — faqat admin
      4. O'z rolini o'zgartirish — mumkin emas
      5. Oxirgi aktiv adminni o'chirish — mumkin emas
    """
    if actor.id == target.id:
        # O'zini — mumkin (lekin rol o'zgartira olmaydi, pastda tekshiriladi)
        return

    is_actor_admin = actor.role_key in ("admin", "superadmin")
    is_actor_super = actor.role_key == "superadmin"
    is_target_admin = target.role_key in ("admin", "superadmin")
    is_target_super = target.role_key == "superadmin"

    # Admin boshqa adminni faqat superadmin bo'lsa tahrirlay oladi
    if is_target_admin and not is_actor_super:
        raise HTTPException(
            _status.HTTP_403_FORBIDDEN,
            "Boshqa adminni faqat superadmin boshqara oladi",
        )

    # Superadmin boshqa superadminni tahrirlay olmaydi
    if is_target_super and not is_actor_super:
        raise HTTPException(
            _status.HTTP_403_FORBIDDEN,
            "Superadminni faqat superadmin boshqara oladi",
        )

    # Oddiy xodim boshqa xodimni tahrirlay olmaydi (admin bo'lishi shart)
    if not is_actor_admin:
        raise HTTPException(
            _status.HTTP_403_FORBIDDEN,
            "Faqat admin xodimlarni boshqara oladi",
        )


async def _check_delete_protection(
    db: AsyncSession,
    actor: User,
    target: User,
):
    """O'chirishdan oldin qo'shimcha himoya."""
    # O'zini o'chirish — mumkin emas
    if actor.id == target.id:
        raise HTTPException(
            _status.HTTP_400_BAD_REQUEST,
            "O'zingizni o'chira olmaysiz",
        )

    # Boshqa adminni o'chirish — faqat superadmin
    if target.role_key in ("admin", "superadmin") and actor.role_key != "superadmin":
        raise HTTPException(
            _status.HTTP_403_FORBIDDEN,
            "Boshqa adminni faqat superadmin o'chira oladi",
        )

    # Oxirgi aktiv adminni o'chirish — mumkin emas
    if target.role_key == "admin" and target.active:
        count = (await db.execute(
            select(func.count()).select_from(User).where(
                User.role_key == "admin",
                User.active == True,  # noqa: E712
                User.id != target.id,
            )
        )).scalar() or 0
        if count == 0:
            raise HTTPException(
                _status.HTTP_400_BAD_REQUEST,
                "Oxirgi aktiv adminni o'chirish mumkin emas",
            )


async def _assert_other_active_admin(db: AsyncSession, target: User, message: str) -> None:
    """Oxirgi aktiv adminni bloklash/rolini almashtirishga yo'l qo'ymaydi."""
    if target.role_key != "admin" or not target.active:
        return
    count = (await db.execute(
        select(func.count()).select_from(User).where(
            User.role_key == "admin",
            User.active == True,  # noqa: E712
            User.id != target.id,
        )
    )).scalar() or 0
    if count == 0:
        raise HTTPException(_status.HTTP_400_BAD_REQUEST, message)


class UserIn(BaseModel):
    fullname: str = Field(..., min_length=1, max_length=200)
    login: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=10, max_length=256)
    role: str
    phone: str | None = ""
    doctor_id: int | None = None
    active: bool = True
    # Rol = doctor bo'lsa: shifokor kartochkasi (Doctor) ham shu bilan yaratiladi
    specialty: str | None = Field(default=None, max_length=128)
    room: str | None = Field(default=None, max_length=32)
    price: int = Field(default=0, ge=0)

    @field_validator("fullname")
    @classmethod
    def validate_fullname(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("F.I.Sh bo'sh bo'lmasligi kerak")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return _clean_phone(value)


class UserPatch(BaseModel):
    fullname: str | None = Field(default=None, min_length=1, max_length=200)
    password: str | None = Field(default=None, min_length=10, max_length=256)
    role: str | None = None
    phone: str | None = None
    doctor_id: int | None = None
    specialty: str | None = Field(default=None, max_length=200)
    active: bool | None = None

    @field_validator("fullname")
    @classmethod
    def validate_fullname(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("F.I.Sh bo'sh bo'lmasligi kerak")
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return _clean_phone(value)


def _clean_phone(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip()
    # Faqat mamlakat kodi ("+998") — telefon kiritilmagan hisoblanadi
    if re.sub(r"\D", "", value) in ("", "998"):
        return None
    if not re.fullmatch(r"\+?[0-9 ()().-]{7,32}", value):
        raise ValueError("Telefon raqam formati noto'g'ri")
    digits = re.sub(r"\D", "", value)
    if not 7 <= len(digits) <= 15:
        raise ValueError("Telefon raqam 7–15 ta raqamdan iborat bo'lishi kerak")
    return ("+" if value.startswith("+") else "") + digits


PATIENT_ROLE_KEY = "patient"


def _assert_not_patient_role(role_key: str | None) -> None:
    """Bemor roli Xodimlar orqali berilmaydi: bemor akkauntlari 'Bemorlar' bo'limida yaratiladi."""
    if role_key == PATIENT_ROLE_KEY:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Bemor rolini Xodimlar orqali berib bo'lmaydi — bemor akkaunti \"Bemorlar\" bo'limida yaratiladi",
        )


def _assert_role_assignable(actor: User, role: Role, actor_permissions: list[str] | str) -> None:
    from .roles import _SUPERADMIN_ONLY_PERMISSIONS

    if actor.role_key == "superadmin":
        return
    permissions = role.permissions
    if permissions == "*" or not isinstance(permissions, list):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu rolni faqat superadmin biriktira oladi")
    if any(p in _SUPERADMIN_ONLY_PERMISSIONS for p in permissions):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Yuqori vakolatli rolni faqat superadmin biriktira oladi")
    if actor_permissions != "*" and not set(permissions).issubset(set(actor_permissions or [])):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sizda mavjud bo'lmagan ruxsatli rolni bera olmaysiz")


def _to_dict(u: User) -> dict:
    """TIBEX_ROLE_FORTRESS_v1: permissions role orqali"""
    return {
        "id": u.id,
        "fullname": u.fullname,
        "login": u.login,
        "role": u.role_key,
        "phone": u.phone,
        "patient_id": u.patient_id,
        "doctor_id": u.doctor_id,
        "active": u.active,
    }


@router.get("")
async def list_users(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("users", "view")),
):
    # Xodimlar ro'yxati faqat xodim rollarini o'z ichiga oladi. Bemor portal akkauntlari
    # (role_key == "patient") "Bemorlar" bo'limiga tegishli va bu yerga aralashmaydi.
    rows = (
        await db.execute(
            select(User).where(User.role_key != PATIENT_ROLE_KEY).order_by(User.id)
        )
    ).scalars().all()
    return [_to_dict(u) for u in rows]


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_user(
    body: UserIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("users", "create")),
):
    # TIBEX_ROLE_FORTRESS_v1: rol shabloni majburiy
    _assert_not_patient_role(body.role)
    # ─── Rol mavjud va aktiv bo'lishi shart ───
    role_obj = (
        await db.execute(select(Role).where(Role.key == body.role))
    ).scalar_one_or_none()
    if role_obj is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Rol topilmadi: {body.role}. Faqat mavjud rollar biriktirilishi mumkin.",
        )
    if not role_obj.active:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Rol aktiv emas: {role_obj.name}. Aktiv rolni tanlang.",
        )
    _assert_role_assignable(actor, role_obj, _perm.permissions)

    # ─── Privilege escalation: o'z darajasidan yuqori rol biriktirmaslik ───
    if body.role in ("admin", "superadmin") and actor.role_key != "superadmin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Admin rolini faqat superadmin bera oladi",
        )

    # TIBEX_USER_CRUD_v1: create_user mustahkamlash
    # ─── Login normalizatsiya ───
    login_clean = body.login.strip().lower()
    if not login_clean or len(login_clean) < 3:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Login kamida 3 belgi bo'lishi kerak",
        )
    if not re.match(r"^[a-z0-9_.\-]+$", login_clean):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Login faqat kichik harf, raqam, _ . - belgilaridan iborat bo'lsin",
        )

    # ─── Parol kuchini tekshirish ───
    strength_ok, strength_msg = check_password_strength(
        body.password, login=login_clean, fullname=body.fullname
    )
    if not strength_ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, strength_msg)

    # ─── Login bandligini tekshirish (case-insensitive) ───
    existing = (
        await db.execute(select(User).where(func.lower(User.login) == login_clean))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Bu login band: {existing.fullname}",
        )

    # ─── Shifokor roli: Doctor kartochkasini yaratib, akkauntga bog'lash ───
    doctor_id = body.doctor_id
    new_doctor = None
    if body.role == "doctor" and doctor_id is None:
        specialty = (body.specialty or "").strip()
        if not specialty:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Shifokor uchun mutaxassislik majburiy",
            )
        new_doctor = Doctor(
            name=body.fullname.strip(),
            specialty=specialty,
            phone=body.phone or None,
            price=body.price,
            room=(body.room or "").strip() or None,
            active=body.active,
        )
        db.add(new_doctor)
        await db.flush()
        doctor_id = new_doctor.id

    # TIBEX_DOCTOR_ID_FK_FIX_v1: User.doctor_id — oddiy BigInteger (FK constraint yo'q).
    # Shu sabab yaroqsiz doctor_id jimgina yozib qo'yilardi. `update_user` buni
    # tekshiradi, lekin `create_user` tekshirmas edi. Endi bu yerda ham tekshiramiz.
    if doctor_id is not None:
        _card = (await db.execute(
            select(Doctor).where(Doctor.id == doctor_id)
        )).scalar_one_or_none()
        if _card is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Shifokor kartochkasi topilmadi (id={doctor_id})",
            )

    u = User(
        fullname=body.fullname.strip(),
        login=login_clean,
        password_hash=await hash_password_async(body.password),
        role_key=body.role,
        phone=body.phone,
        doctor_id=doctor_id,
        active=body.active,
    )
    db.add(u)
    await db.flush()
    await db.refresh(u)

    after = _to_dict(u)
    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="create",
        detail=f"Yangi xodim: {u.fullname} ({u.role_key})",
        ip=client_ip(request),
        after=after,
    )
    await publish("user.created", after)
    if new_doctor is not None:
        await publish(
            "doctor.created",
            {
                "id": new_doctor.id,
                "name": new_doctor.name,
                "specialty": new_doctor.specialty,
                "phone": new_doctor.phone,
                "price": new_doctor.price,
                "room": new_doctor.room,
                "active": new_doctor.active,
            },
        )
    return after


@router.patch("/{user_id}", dependencies=[Depends(require_csrf)])
async def update_user(
    user_id: int,
    body: UserPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("users", "edit")),
):
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Xodim topilmadi")

    # ─── Privilege escalation himoyasi ───
    await _check_user_modification(db, actor, u, action="edit")

    data = body.model_dump(exclude_unset=True)

    # ─── O'z rolini o'zgartirish mumkin emas ───
    if actor.id == u.id and "role" in data:
        if data["role"] != u.role_key:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "O'z rolingizni o'zgartira olmaysiz",
            )

    if data.get("active") is False and u.active:
        if actor.id == u.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "O'zingizni bloklay olmaysiz")
        await _assert_other_active_admin(db, u, "Oxirgi aktiv adminni bloklash mumkin emas")
    if "role" in data and data["role"] != u.role_key:
        await _assert_other_active_admin(db, u, "Oxirgi aktiv adminning rolini o'zgartirib bo'lmaydi")

    before = _to_dict(u)
    revoked_jtis: list[str] = []
    role_changed_to_doctor = False
    specialty = (data.pop("specialty", None) or "").strip()

    if "password" in data:
        pw = data.pop("password")
        if pw:
            strength_ok, strength_msg = check_password_strength(
                pw, login=u.login, fullname=data.get("fullname") or u.fullname
            )
            if not strength_ok:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, strength_msg)
            u.password_hash = await hash_password_async(pw)
            u.password_changed_at = datetime.now(timezone.utc)
            u.session_valid_after = datetime.now(timezone.utc)
            revoked_jtis.extend(await _delete_user_sessions(db, user_id))

    if "role" in data:
        # TIBEX_ROLE_FORTRESS_v1: rol tekshiruvi
        _assert_not_patient_role(data["role"])
        role = (
            await db.execute(select(Role).where(Role.key == data["role"]))
        ).scalar_one_or_none()
        if role is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Rol topilmadi")
        if not role.active:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Rol aktiv emas: {role.name}",
            )
        _assert_role_assignable(actor, role, _perm.permissions)
        # Privilege escalation
        if data["role"] in ("admin", "superadmin") and actor.role_key != "superadmin":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Admin rolini faqat superadmin bera oladi",
            )
        old_role = u.role_key
        role_changed_to_doctor = data["role"] == "doctor" and old_role != "doctor"
        u.role_key = data.pop("role")
        # Rol o'zgarsa — sessiyalarni bekor qilish (yangi ruxsatlar bilan qayta kirish)
        if old_role != u.role_key:
            u.session_valid_after = datetime.now(timezone.utc)
            # Eski sessiyalarni ham o'chirish
            revoked_jtis.extend(await _delete_user_sessions(db, user_id))

    # ─── Shifokor roli: kartochka majburiy, bitta kartochka — bitta akkaunt ───
    if u.role_key == "doctor" and (role_changed_to_doctor or "doctor_id" in data or specialty):
        new_did = data.get("doctor_id", u.doctor_id)
        if new_did is None:
            if not specialty:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Shifokor uchun mutaxassislik majburiy",
                )
            card = Doctor(
                name=(data.get("fullname") or u.fullname).strip(),
                specialty=specialty,
                phone=data.get("phone", u.phone) or None,
                active=data.get("active", u.active),
            )
            db.add(card)
            await db.flush()
            data["doctor_id"] = card.id
        else:
            card = (
                await db.execute(select(Doctor).where(Doctor.id == new_did))
            ).scalar_one_or_none()
            if card is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "Shifokor kartochkasi topilmadi"
                )
            taken = (
                await db.execute(
                    select(User.id).where(User.doctor_id == new_did, User.id != u.id)
                )
            ).first()
            if taken is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Bu kartochka boshqa xodimga bog'langan",
                )

    for k, v in data.items():
        setattr(u, k, v)

    if data.get("active") is False:
        u.session_valid_after = datetime.now(timezone.utc)
        revoked_jtis.extend(await _delete_user_sessions(db, user_id))

    await db.flush()
    await _publish_revoked_sessions(list(dict.fromkeys(revoked_jtis)))
    after = _to_dict(u)
    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="update",
        detail=f"Xodim tahrirlandi: {u.fullname}",
        ip=client_ip(request),
        before=before,
        after=after,
    )
    await publish("user.updated", after)
    return after


@router.delete("/{user_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("users", "delete")),
):
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Xodim topilmadi")

    # ─── Kuchaytirilgan himoya ───
    await _check_delete_protection(db, actor, u)

    # TIBEX_FIX_FK_v1: avval sessiyalarni o'chirish (FK constraint)
    revoked_jtis = await _delete_user_sessions(db, user_id)
    await db.flush()
    await _publish_revoked_sessions(revoked_jtis)

    before = _to_dict(u)
    await db.delete(u)
    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="delete",
        detail=f"Xodim o'chirildi: {u.fullname}",
        ip=client_ip(request),
        before=before,
    )
    await publish("user.deleted", {"id": user_id})



# TIBEX_PWD_SYSTEM: admin_reset
class AdminResetOut(BaseModel):
    ok: bool
    new_password: str
    user: dict
    message: str


# TIBEX_ADMIN_RESET_AUTH_FIX_v1: endi actorning o'z paroli talab qilinadi —
# aks holda sessiyasi ochiq qolgan har qanday "users edit" huquqiga ega
# xodim boshqa birovning parolini hech qanday tasdiqsiz almashtira olardi.
class AdminResetPasswordIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)


@router.post("/{user_id}/admin-reset-password", dependencies=[Depends(require_csrf)])
async def admin_reset_password(
    user_id: int,
    body: AdminResetPasswordIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("users", "edit")),
):
    """Admin xodimning parolini random generatsiya qiladi va counter'ni reset qiladi.

    TIBEX_ADMIN_RESET_AUTH_FIX_v1: chaqiruvchi (actor) shu amalni bajarishdan
    oldin o'z joriy parolini kiritishi shart — sessiya o'g'irlansa yoki
    qulflanmagan kompyuterdan foydalanilsa ham begona kishi boshqa xodimning
    parolini tasdiqsiz almashtira olmasligi uchun.
    """
    ok, _ = await verify_password_async(actor.password_hash, body.password)
    if not ok:
        await log_action(
            db, user=actor.fullname, role=actor.role_key, action="update",
            detail=f"ADMIN RESET urinishi — actor paroli xato (target #{user_id})",
            ip=client_ip(request),
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Parolingiz xato")

    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foydalanuvchi topilmadi")

    # ─── Boshqa adminning parolini faqat superadmin reset qiladi ───
    if u.role_key in ("admin", "superadmin") and actor.id != u.id:
        if actor.role_key != "superadmin":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Boshqa adminning parolini faqat superadmin reset qila oladi",
            )

    # 16 belgili tasodifiy parol (CSPRNG, adashtiriladigan belgilarsiz)
    new_pwd = generate_random_password(16)
    u.password_hash = await hash_password_async(new_pwd)
    u.password_changed_at = datetime.now(timezone.utc)
    u.session_valid_after = datetime.now(timezone.utc)  # Barcha sessiyalarni bekor qilish
    revoked_jtis = await _delete_user_sessions(db, user_id)
    u.failed_attempts = 0
    u.locked_until = None
    await db.flush()
    await _publish_revoked_sessions(revoked_jtis)

    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="update",
        detail=f"Admin tomonidan parol reset qilindi: {u.fullname} ({u.login})",
        ip=client_ip(request),
    )

    return {
        "ok": True,
        "new_password": new_pwd,
        "user": {
            "id": u.id,
            "fullname": u.fullname,
            "login": u.login,
            "role": u.role_key,
        },
        "message": "Yangi parol generatsiya qilindi. Uni xodimga xavfsiz kanal orqali yetkazing.",
    }


@router.post("/{user_id}/unlock", dependencies=[Depends(require_csrf)])
async def unlock_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("users", "edit")),
):
    """Administrator hisob qulfini ochadi; parol va sessiyalar o'zgarmaydi."""
    target = (
        await db.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Xodim topilmadi")
    await _check_user_modification(db, actor, target)
    target.failed_attempts = 0
    target.locked_until = None
    await db.flush()
    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="update",
        detail=f"Xodim akkaunti qulfdan chiqarildi: #{target.id}",
        ip=client_ip(request),
    )
    return {"ok": True}



# ═══════════════════════════════════════════════════════════════════════
# TIBEX_SUPER_FIX_v2.1: /reset-password alias endpoint
# ═══════════════════════════════════════════════════════════════════════
class ResetPasswordIn(BaseModel):
    new_password: str = Field(..., min_length=10, max_length=256)
    current_password: str = Field(..., min_length=1, max_length=256)


@router.post("/{user_id}/reset-password", dependencies=[Depends(require_csrf)])
async def reset_password_alias(
    user_id: int,
    body: ResetPasswordIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("users", "edit")),
):
    """Admin xodimning parolini tiklaydi (alias)."""
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foydalanuvchi topilmadi")
    ok, _ = await verify_password_async(actor.password_hash, body.current_password)
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Joriy parolingiz xato")
    strength_ok, strength_msg = check_password_strength(
        body.new_password, login=u.login, fullname=u.fullname
    )
    if not strength_ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, strength_msg)
    await _check_user_modification(db, actor, u)
    if u.role_key in ("admin", "superadmin") and actor.id != u.id:
        if actor.role_key != "superadmin":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Boshqa adminning parolini faqat superadmin o'zgartira oladi",
            )
    u.password_hash = await hash_password_async(body.new_password)
    u.password_changed_at = datetime.now(timezone.utc)
    u.session_valid_after = datetime.now(timezone.utc)
    u.failed_attempts = 0
    u.locked_until = None
    revoked_jtis = await _delete_user_sessions(db, user_id)
    await db.flush()
    await _publish_revoked_sessions(revoked_jtis)
    await log_action(
        db, user=actor.fullname, role=actor.role_key, action="update",
        detail=f"Parol tiklandi (admin): {u.fullname} ({u.login})",
        ip=client_ip(request),
    )
    return {"ok": True, "login": u.login, "message": "Parol muvaffaqiyatli yangilandi"}



# ═══════════════════════════════════════════════════════════════════════
# TIBEX_SECURE_DELETE_v1: /secure-delete endpoint (2FA)
# ═══════════════════════════════════════════════════════════════════════
class SecureDeleteIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)
    confirm_word: str = Field(..., min_length=1, max_length=64)


@router.post("/{user_id}/secure-delete", dependencies=[Depends(require_csrf)])
async def secure_delete_user(
    user_id: int,
    body: SecureDeleteIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("users", "delete")),
):
    """Xodimni 2FA bilan o'chirish: parol + tasdiq matni.

    Himoyalar:
      1. CSRF token
      2. Actor joriy paroli
      3. Tasdiq matni: O'CHIRISH
      4. Privilege escalation
      5. Oxirgi admin himoyasi
    """
    # 1) Tasdiq matni
    # TIBEX_APOSTROPHE_NORMALIZE_FIX_v1: "O'CHIRISH" so'zidagi apostrof
    # klaviatura/tizimga qarab turlicha belgi bilan kiritilishi mumkin
    # (', ʻ, ʼ, ’, `) — foydalanuvchi so'zni to'g'ri yozsa ham noto'g'ri
    # belgi tufayli rad etilmasligi uchun barcha variantlar bitta shaklga
    # keltiriladi.
    _APOSTROPHE_VARIANTS = "'\u02bb\u02bc\u2018\u2019\u0060\u00b4"
    def _normalize_apostrophes(s: str) -> str:
        for ch in _APOSTROPHE_VARIANTS:
            s = s.replace(ch, "'")
        return s

    if _normalize_apostrophes(body.confirm_word.strip().upper()) != "O'CHIRISH":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Tasdiq matni noto'g'ri. Aynan O'CHIRISH yozing.",
        )

    # 2) Parol
    ok, _ = await verify_password_async(actor.password_hash, body.password)
    if not ok:
        await log_action(
            db, user=actor.fullname, role=actor.role_key, action="delete",
            detail=f"XODIM O'CHIRISH URINISHI — parol xato (target #{user_id})",
            ip=client_ip(request),
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Parol xato")

    # 3) Target
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Xodim topilmadi")

    # 4) Privilege escalation + oxirgi admin
    await _check_delete_protection(db, actor, u)

    # 5) Sessiyalarni o'chirish (FK constraint)
    revoked_jtis = await _delete_user_sessions(db, user_id)
    await db.flush()
    await _publish_revoked_sessions(revoked_jtis)

    # 6) O'chirish
    before = _to_dict(u)
    await db.delete(u)
    await log_action(
        db,
        user=actor.fullname,
        role=actor.role_key,
        action="delete",
        detail=f"⚠️ XODIM 2FA BILAN O'CHIRILDI: {u.fullname} ({u.login})",
        ip=client_ip(request),
        before=before,
    )
    await publish("user.deleted", {"id": user_id, "secure": True})

    return {
        "ok": True,
        "deleted_id": user_id,
        "message": f"{u.fullname} tizimdan o'chirildi",
    }