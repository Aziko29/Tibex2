import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, model_validator
from datetime import datetime, timezone

from sqlalchemy import delete as sa_delete, select
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

router = APIRouter()


class PatientIn(BaseModel):
    fullname: str
    phone: str
    age: int = 0
    gender: str = "Erkak"
    blood: str = "Noma'lum"
    address: str = ""
    allergies: list[str] = []
    chronic: list[str] = []

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
    fullname: str | None = None
    phone: str | None = None
    age: int | None = None
    gender: str | None = None
    blood: str | None = None
    address: str | None = None
    allergies: list[str] | None = None
    chronic: list[str] | None = None


def _to_dict(p: Patient) -> dict:
    return {
        "id": p.id,
        "fullname": p.fullname,
        "phone": p.phone_enc,
        "age": p.age,
        "gender": p.gender,
        "blood": p.blood,
        "address": p.address,
        "allergies": p.allergies or [],
        "chronic": p.chronic or [],
    }


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
    if q:
        stmt = stmt.where(Patient.fullname.ilike(f"%{_like_escape(q)}%", escape="\\"))
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
    await db.flush()
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
        password = body.account_password
        db.add(User(
            fullname=body.fullname,
            login=phone_norm,
            password_hash=await hash_password_async(password),
            role_key="patient",
            phone=phone_norm,
            patient_id=p.id,
            active=True,
        ))
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

    if "phone" in data:
        phone = data.pop("phone")
        phone_norm = normalize_phone(phone)
        if phone_norm:
            # Boshqa bemorda bunday telefon bormi?
            existing = (
                await db.execute(
                    select(Patient).where(
                        Patient.phone_bidx == phone_norm,
                        Patient.id != patient_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"Bu telefon boshqa bemorga tegishli: {existing.fullname}",
                )
            p.phone_enc = phone_norm
            p.phone_bidx = phone_norm

            # Agar bemorning user yozuvi bo'lsa — login'ni ham yangilaymiz
            linked_user = (
                await db.execute(select(User).where(User.patient_id == patient_id))
            ).scalar_one_or_none()
            if linked_user is not None:
                linked_user.login = phone_norm
                linked_user.phone = phone_norm
        else:
            p.phone_enc = phone
            p.phone_bidx = phone

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

    acc = User(
        fullname=p.fullname,
        login=p.phone_enc,
        password_hash=await hash_password_async(body.password),
        role_key="patient",
        phone=p.phone_enc,
        patient_id=p.id,
        active=True,
    )
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
