import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime, timezone

from sqlalchemy import delete as sa_delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import (
    client_ip,
    get_current_user,
    require_csrf,
    require_permission,
)
from ..models import Appointment, LabOrder, Patient, Role, Session as DBSession, User
from ..realtime import publish
from ..security.anti_idor import require_patient_access
from ..security.audit import audit_view, log_action
from ..security.otp import normalize_phone
from ..security.passwords import check_password_strength, hash_password_async
from ..services.patient_service import build_patient_user, change_patient_phone, patient_to_dict

router = APIRouter()


def _validate_patient_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if not 9 <= len(digits) <= 15:
        raise ValueError("Telefon raqam to'liq emas (kamida 9 ta raqam)")
    return value.strip()


def _validate_patient_name(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("F.I.Sh bo'sh bo'lmasligi kerak")
    return value


class PatientIn(BaseModel):
    fullname: str = Field(min_length=1, max_length=200)
    phone: str = Field(max_length=32)
    age: int = Field(default=0, ge=0, le=150)
    gender: str = Field(default="Erkak", max_length=16)
    blood: str = Field(default="Noma'lum", max_length=8)
    address: str = Field(default="", max_length=500)
    allergies: list[str] = []
    chronic: list[str] = []

    @field_validator("fullname")
    @classmethod
    def check_fullname(cls, value: str) -> str:
        return _validate_patient_name(value)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, value: str) -> str:
        return _validate_patient_phone(value)

    # Bemor kabineti uchun (ixtiyoriy)
    create_account: bool = False
    account_password: str | None = Field(default=None, min_length=10, max_length=256)

    @model_validator(mode="after")
    def validate_patient_account(self):
        if not self.create_account:
            return self
        if not self.account_password:
            raise ValueError("Bemor akkaunti uchun kuchli parol majburiy")
        strong, message = check_password_strength(self.account_password)
        if not strong:
            raise ValueError(message)
        if not re.fullmatch(r"\+998\d{9}", normalize_phone(self.phone)):
            raise ValueError("Bemor akkaunti uchun +998 bilan boshlanuvchi to'g'ri telefon kerak")
        return self


class PatientPatch(BaseModel):
    fullname: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    age: int | None = Field(default=None, ge=0, le=150)
    gender: str | None = Field(default=None, max_length=16)
    blood: str | None = Field(default=None, max_length=8)
    address: str | None = Field(default=None, max_length=500)
    allergies: list[str] | None = None
    chronic: list[str] | None = None

    @field_validator("fullname")
    @classmethod
    def check_fullname(cls, value: str | None) -> str | None:
        return _validate_patient_name(value)

    @field_validator("phone")
    @classmethod
    def check_phone(cls, value: str | None) -> str | None:
        return value if value is None else _validate_patient_phone(value)


_to_dict = patient_to_dict  # xodimlar ko'rinishi: "login" maydonisiz


def _like_escape(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("")
async def list_patients(
    request: Request,
    q: str | None = Query(None, max_length=100),
    limit: int = Query(200, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("patients", "view")),
):
    stmt = select(Patient).order_by(Patient.id.desc()).limit(limit).offset(offset)
    if user.role_key == "doctor":
        if user.doctor_id:
            stmt = stmt.where(Patient.id.in_(select(Appointment.patient_id).where(Appointment.doctor_id == user.doctor_id)))
        else:
            stmt = stmt.where(Patient.id == -1)
    elif user.role_key == "lab":
        stmt = stmt.where(Patient.id.in_(select(LabOrder.patient_id)))
    elif user.role_key == "patient":
        stmt = stmt.where(Patient.id == (user.patient_id or -1))
    elif user.role_key not in {"admin", "superadmin", "reception", "cashier"}:
        stmt = stmt.where(Patient.id == -1)
    q = q.replace("\x00", "").strip() if q else q  # NUL bayt PostgreSQL'da 500 beradi
    if q:
        conds = [Patient.fullname.ilike(f"%{_like_escape(q)}%", escape="\\")]
        # Telefon shifrlangan: faqat blind-index orqali to'liq raqam bo'yicha qidiriladi
        digits = re.sub(r"\D", "", q)
        if len(digits) >= 9:
            phone = normalize_phone(q)
            if phone:
                conds.append(Patient.phone_bidx == phone)
        if digits and len(digits) <= 9 and q.strip().lstrip("#").isdigit():
            conds.append(Patient.id == int(digits))
        stmt = stmt.where(or_(*conds))
    rows = (await db.execute(stmt)).scalars().all()
    await audit_view(db, user, request, f"patients list count={len(rows)}")
    return [_to_dict(p) for p in rows]


@router.get("/{patient_id}")
async def get_patient(
    request: Request,
    patient_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("patients", "view")),
    _own: Patient = Depends(require_patient_access),
):
    p = (
        await db.execute(select(Patient).where(Patient.id == patient_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")
    await audit_view(db, user, request, f"patient #{patient_id}")
    return _to_dict(p)


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
async def create_patient(
    body: PatientIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("patients", "create")),
):
    phone_norm = normalize_phone(body.phone)

    # Telefon takrorlanmasligi tekshiruvi
    if phone_norm:
        existing = (
            await db.execute(select(Patient).where(Patient.phone_bidx == phone_norm))
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Bu telefon allaqachon mavjud: {existing.fullname} (#{existing.id})",
            )

    p = Patient(
        fullname=body.fullname,
        phone_enc=phone_norm or body.phone,
        phone_bidx=phone_norm or body.phone,
        age=body.age,
        gender=body.gender,
        blood=body.blood,
        address=body.address,
        allergies=body.allergies,
        chronic=body.chronic,
    )
    db.add(p)
    try:
        await db.flush()
    except IntegrityError as exc:
        # TIBEX_PATIENT_PHONE_RACE_FIX_v1: avval `phone_bidx` ustunida
        # unique constraint yo'q, lekin app-level check bor. Ikki parallel
        # so'rov bir vaqtda bir xil telefon bilan bemor yaratishga urinsa,
        # ikkinchisi IntegrityError bilan 500 olardi (yashirin xato).
        # Endi to'g'ri 409 qaytaramiz.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu telefon bilan bemor allaqachon mavjud (parallel so'rov)",
        ) from exc
    await db.refresh(p)

    # ─── Ixtiyoriy: bemor kabineti uchun account ───
    account_created = False
    if body.create_account:
        # Bu telefon band emasligini tekshiramiz
        existing_user = (
            await db.execute(select(User).where(User.login == phone_norm))
        ).scalar_one_or_none()
        if existing_user is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Bu telefon uchun login allaqachon band",
            )

        # Validated by PatientIn.validate_patient_account; never issue a known default credential.
        assert body.account_password is not None
        db.add(await build_patient_user(p, phone_norm, body.account_password))
        account_created = True

    await db.flush()

    after = _to_dict(p)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="create",
        detail=(
            f"Yangi bemor: {p.fullname} (#{p.id})"
            + (" [+account]" if account_created else "")
        ),
        ip=client_ip(request),
        after=after,
    )
    await publish("patient.created", after)

    result = {**after, "account_created": account_created}
    return result


@router.patch("/{patient_id}", dependencies=[Depends(require_csrf)])
async def update_patient(
    patient_id: int,
    body: PatientPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("patients", "edit")),
    _own: Patient = Depends(require_patient_access),
):
    p = (
        await db.execute(select(Patient).where(Patient.id == patient_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")

    before = _to_dict(p)
    data = body.model_dump(exclude_unset=True)
    for key in ("fullname", "phone", "age", "gender", "blood"):
        if key in data and data[key] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{key} bo'sh bo'lishi mumkin emas")
    for key in ("address", "allergies", "chronic"):
        if key in data and data[key] is None:
            data[key] = "" if key == "address" else []

    if "phone" in data:
        # Bemor + kabinet logini sinxron o'zgaradi (qoidalar servisda).
        await change_patient_phone(db, p, data.pop("phone"), strict=False, reveal_owner=True)

    for k, v in data.items():
        setattr(p, k, v)

    await db.flush()
    after = _to_dict(p)
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="update",
        detail=f"Bemor tahrirlandi: {p.fullname} (#{p.id})",
        ip=client_ip(request),
        before=before,
        after=after,
    )
    await publish("patient.updated", after)
    return after


@router.delete("/{patient_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_patient(
    patient_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("patients", "delete")),
    _own: Patient = Depends(require_patient_access),
):
    p = (
        await db.execute(select(Patient).where(Patient.id == patient_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")

    # Bog'langan user'ni bloklaymiz (o'chirmaymiz, tarix uchun)
    linked_user = (
        await db.execute(select(User).where(User.patient_id == patient_id))
    ).scalar_one_or_none()
    if linked_user is not None:
        linked_user.active = False
        linked_user.patient_id = None
        # TIBEX_PATIENT_DELETE_REVOKE_SESSIONS_v1: `active=False` ni
        # `user_problem()` ushlaydi, lekin DB'da osilib qolgan sessiya
        # qatorlari (audit chalkashligi, xotira) qolib ketardi.
        from datetime import datetime as _dt, timezone as _tz
        from sqlalchemy import update as _sa_update
        _now = _dt.now(_tz.utc)
        linked_user.session_valid_after = _now
        _revoked_jtis = (await db.execute(
            select(DBSession.jti).where(
                DBSession.user_id == linked_user.id,
                DBSession.revoked_at.is_(None),
            )
        )).scalars().all()
        await db.execute(
            _sa_update(DBSession)
            .where(DBSession.user_id == linked_user.id, DBSession.revoked_at.is_(None))
            .values(revoked_at=_now)
        )
        await db.flush()
        if _revoked_jtis:
            try:
                from ..realtime import publish_session_revoked as _psr
                for _j in _revoked_jtis:
                    await _psr(_j)
            except Exception:
                pass

    before = _to_dict(p)
    # 25-band: yumshoq o'chirish. Payment/Refund va tarix saqlanadi.
    p.deleted_at = datetime.now(timezone.utc)
    p.deleted_by = user.fullname
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bemorni o'chirib bo'lmadi (bog'liq yozuvlar)") from exc
    await log_action(
        db,
        user=user.fullname,
        role=user.role_key,
        action="delete",
        detail=f"Bemor o'chirildi: {p.fullname} (#{p.id})",
        ip=client_ip(request),
        before=before,
    )
    await publish("patient.deleted", {"id": patient_id})


# ═══════════════════ ACCOUNT MANAGEMENT ═══════════════════
class CreateAccountIn(BaseModel):
    password: str = Field(..., min_length=10, max_length=256)


@router.post("/{patient_id}/create-account", dependencies=[Depends(require_csrf)])
async def create_account(
    patient_id: int,
    body: CreateAccountIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("patients", "edit")),
):
    """Mavjud bemor uchun kabinet account'ini yaratadi."""
    strong, message = check_password_strength(body.password)
    if not strong:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, message)
    p = (
        await db.execute(select(Patient).where(Patient.id == patient_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bemor topilmadi")

    if not p.phone_bidx:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Bemorda telefon raqam yo'q — avval qo'shing",
        )

    existing = (
        await db.execute(select(User).where(User.patient_id == patient_id))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu bemorda account allaqachon bor",
        )

    login_band = (
        await db.execute(select(User).where(User.login == p.phone_bidx))
    ).scalar_one_or_none()
    if login_band is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu telefon boshqa user uchun band",
        )

    acc = await build_patient_user(p, p.phone_enc, body.password)
    db.add(acc)
    await db.flush()

    await log_action(
        db, user=user.fullname, role=user.role_key, action="create",
        detail=f"Bemor uchun account yaratildi: {p.fullname} (login={p.phone_bidx})",
        ip=client_ip(request),
    )

    return {
        "ok": True,
        "login": p.phone_bidx,
        "patient_id": p.id,
        "message": "Account yaratildi. Bemorga login/parolni bering.",
    }


@router.post("/{patient_id}/reset-password", dependencies=[Depends(require_csrf)])
async def reset_account_password(
    patient_id: int,
    body: CreateAccountIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("patients", "edit")),
):
    """Bemor account parolini yangilaydi va barcha sessiyalarni bekor qiladi."""
    from datetime import datetime, timezone

    strong, message = check_password_strength(body.password)
    if not strong:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, message)

    acc = (
        await db.execute(select(User).where(User.patient_id == patient_id))
    ).scalar_one_or_none()
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account topilmadi")

    acc.password_hash = await hash_password_async(body.password)
    changed_at = datetime.now(timezone.utc)
    acc.session_valid_after = changed_at
    await db.execute(sa_delete(DBSession).where(DBSession.user_id == acc.id))
    await db.flush()

    await log_action(
        db, user=user.fullname, role=user.role_key, action="update",
        detail=f"Bemor paroli tiklandi: {acc.fullname}",
        ip=client_ip(request),
    )

    return {"ok": True, "login": acc.login}
