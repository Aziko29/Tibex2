"""Frontend uchun bootstrap snapshot — har bir rol uchun mos ma'lumot."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_role, get_current_session, get_current_user
from ..integration_access import filter_for_role, serialize_integration
from ..security.rbac import has_permission
from ..security.audit import audit_view
from ..models import (
    Appointment,
    AuditLog,
    Doctor,
    Equipment,
    Integration,
    LabOrder,
    Patient,
    Payment,
    Reagent,
    Refund,
    Role,
    Service,
    Shift,
    SystemSetting,
    User,
)
from ..security.csrf import issue_csrf

router = APIRouter()


# ═══════════════════ Yordamchi konvertorlar ═══════════════════
def _patient_dict(p: Patient) -> dict:
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
        "created_at": int(p.created_at.timestamp() * 1000) if p.created_at else None,
    }


def _appointment_dict(a: Appointment) -> dict:
    return {
        "id": a.id,
        "patient_id": a.patient_id,
        "doctor_id": a.doctor_id,
        "doctor_name": a.doctor_name,
        "scheduled_time": a.scheduled_time,
        "date": a.date,
        "status": a.status,
        "priority": a.priority,
        "service": a.service,
        "paid": a.paid,
        "debt": a.debt,
        "payment_method": a.payment_method,
        "complaint": a.complaint,
        "vitals": a.vitals,
        "prelim_dx": a.prelim_dx,
        "final_dx": a.final_dx,
        "prescriptions": a.prescriptions or [],
        "lab_orders": a.lab_orders or [],
        "completed_at": int(a.completed_at.timestamp() * 1000) if a.completed_at else None,
        "completed_by": a.completed_by,
        "created_at": int(a.created_at.timestamp() * 1000) if a.created_at else None,
        "arrived_at": int(a.arrived_at.timestamp() * 1000) if a.arrived_at else None,
        "status_changed_at": int(a.status_changed_at.timestamp() * 1000) if a.status_changed_at else None,
        "cancel_reason": a.cancel_reason,
    }


def _lab_dict(o: LabOrder) -> dict:
    return {
        "id": o.id,
        "appointment_id": o.appointment_id,
        "patient_id": o.patient_id,
        "test_key": o.test_key,
        "test_name": o.test_name,
        "priority": o.priority,
        "status": o.status,
        "ordered_by": o.ordered_by,
        "received_by": o.received_by,
        "received_at": int(o.received_at.timestamp() * 1000) if o.received_at else None,
        "started_at": int(o.started_at.timestamp() * 1000) if o.started_at else None,
        "analyzer": o.analyzer,
        "result_data": o.result_data,
        "result_summary": o.result_summary,
        "result_note": o.result_note,
        "completed_at": int(o.completed_at.timestamp() * 1000) if o.completed_at else None,
        "completed_by": o.completed_by,
        "verified_at": int(o.verified_at.timestamp() * 1000) if o.verified_at else None,
        "verified_by": o.verified_by,
        "created_at": int(o.created_at.timestamp() * 1000) if o.created_at else None,
    }


VAT_RATE_PERCENT = 12


def _vat_breakdown(amount: int) -> dict:
    base = round(amount / (1 + VAT_RATE_PERCENT / 100))
    return {"rate": VAT_RATE_PERCENT, "amount": amount - base, "base": base}


def _payment_dict(p: Payment) -> dict:
    return {
        "id": p.id,
        "appointment_id": p.appointment_id,
        "patient_id": p.patient_id,
        "amount": p.amount,
        "method": p.method,
        "cashier": p.cashier,
        "services": p.services or [],
        "status": p.status,
        "discount_percent": p.discount_percent or 0,
        "vat": _vat_breakdown(p.amount),
        "created_at": int(p.created_at.timestamp() * 1000) if p.created_at else None,
    }


def _refund_dict(r: Refund) -> dict:
    return {
        "id": r.id,
        "payment_id": r.payment_id,
        "patient_id": r.patient_id,
        "amount": r.amount,
        "reason": r.reason,
        "method": r.method,
        "cashier": r.cashier,
        "created_at": int(r.created_at.timestamp() * 1000) if r.created_at else None,
    }


def _user_dict(u: User) -> dict:
    return {
        "id": u.id,
        "fullname": u.fullname,
        "login": u.login,
        "role": u.role_key,
        "phone": u.phone,
        "doctor_id": u.doctor_id,
        "patient_id": u.patient_id,
        "active": u.active,
    }


def _doctor_dict(d: Doctor) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "specialty": d.specialty,
        "phone": d.phone,
        "price": d.price,
        "room": d.room,
        "active": d.active,
    }


def _service_dict(s: Service) -> dict:
    return {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "category": s.category,
        "price": s.price,
        "active": s.active,
    }


def _role_dict(r: Role) -> dict:
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


def _equipment_dict(e: Equipment) -> dict:
    return {
        "id": e.id,
        "name": e.name,
        "category": e.category,
        "department": e.department,
        "manufacturer": e.manufacturer,
        "model": e.model,
        "serial": e.serial,
        "location": e.location,
        "status": e.status,
        "purchase_date": e.purchase_date,
        "warranty": e.warranty,
        "last_service": e.last_service,
        "next_service": e.next_service,
        "notes": e.notes,
    }


def _reagent_dict(r: Reagent) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "category": r.category,
        "unit": r.unit,
        "stock": r.stock,
        "min_stock": r.min_stock,
        "lot": r.lot,
        "expiry": r.expiry,
        "supplier": r.supplier,
        "notes": r.notes,
    }


def _integration_dict(i: Integration, role_key: str | None = None) -> dict:
    # /api/integrations bilan bir xil serializator (holat va maskalash farq qilmaydi).
    return serialize_integration(i, role_key)


async def _system_info_dict(db: AsyncSession) -> dict:
    """Tizim haqida umumiy ma'lumot."""
    from sqlalchemy import text
    from .. import __version__

    db_size_bytes = 0
    try:
        db_size_bytes = int(await db.scalar(
            text("SELECT pg_database_size(current_database())")
        ) or 0)
    except Exception:
        pass

    # Zaxira vaqti — audit jurnalidan
    backup_log = (await db.execute(
        select(AuditLog).where(AuditLog.action == "backup")
        .order_by(AuditLog.id.desc()).limit(1)
    )).scalar_one_or_none()

    # Sozlamalar
    stored = {}
    try:
        for row in (await db.execute(select(SystemSetting))).scalars().all():
            v = row.value
            if isinstance(v, dict) and "value" in v and len(v) == 1:
                v = v["value"]
            stored[row.key] = v
    except Exception:
        pass

    return {
        "version": __version__,
        "db_size_bytes": db_size_bytes,
        "db_size_human": _human_size(db_size_bytes),
        "last_backup_at": int(backup_log.created_at.timestamp() * 1000) if backup_log and backup_log.created_at else None,
        "finance": {
            # TIBEX_VAT_v1 / TIBEX_DISCOUNT_LIMIT_v1: kassa (va boshqa
            # konsollar) uchun — bu qiymatlar to'lov qabul qilishda
            # zarur, lekin kassir/qabulxona xodimida "settings.view"
            # ruxsati yo'q, shuning uchun GET /api/settings chaqira
            # olmaydi. Bootstrap orqali (clinic{} kabi) hamma rolga
            # yetkaziladi.
            "vat": bool(stored.get("vat", True)),
            "vat_rate": 12,
            "discount_limit": int(stored.get("discount_limit", 20) or 0),
        },
        "clinic": {
            "name": stored.get("clinic_name", "TIBEX Klinika"),
            "phone": stored.get("clinic_phone", "+998 71 200 00 00"),
            "address": stored.get("clinic_address", "Toshkent sh., Chilonzor tumani"),
        },
    }


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _shift_dict(s: Shift | None) -> dict | None:
    if s is None:
        return None
    return {
        "open": s.open,
        "opened_at": int(s.opened_at.timestamp() * 1000) if s.opened_at else None,
        "opened_by": s.opened_by,
        "opening_balance": s.opening_balance,
        "closed_at": int(s.closed_at.timestamp() * 1000) if s.closed_at else None,
        "closed_by": s.closed_by,
        "close_record": s.close_record,
    }


def _audit_dict(a: AuditLog) -> dict:
    return {
        "id": a.id,
        "user": a.user,
        "role": a.role,
        "action": a.action,
        "detail": a.detail,
        "ts": int(a.created_at.timestamp() * 1000) if a.created_at else None,
    }


# ═══════════════════ BEMOR UCHUN SNAPSHOT ═══════════════════
async def _bootstrap_patient(
    db: AsyncSession, user: User, csrf_token: str
) -> dict:
    """Faqat shu bemorga tegishli ma'lumotlar."""
    p = (
        await db.execute(select(Patient).where(Patient.id == user.patient_id))
    ).scalar_one_or_none()
    if p is None:
        return {
            "data": {
                "patients": {},
                "appointments": [],
                "lab_orders": [],
                "payments": [],
                "refunds": [],
                "doctors": [],
                "services": [],
                "roles": [],
                "users": [],
                "equipment": [],
                "reagents": [],
                "integrations": [],
                "shift": None,
                "audit": [],
            },
            "current_user": {
                "id": user.id,
                "fullname": user.fullname,
                "login": user.login,
                "role": "patient",
                "patient_id": user.patient_id,
            },
            "csrf_token": csrf_token,
            "role": "patient",
        }

    appts = (
        await db.execute(
            select(Appointment)
            .where(Appointment.patient_id == user.patient_id)
            .order_by(Appointment.id.desc())
        )
    ).scalars().all()

    labs = (
        await db.execute(
            select(LabOrder)
            .where(LabOrder.patient_id == user.patient_id)
            .order_by(LabOrder.created_at.desc())
        )
    ).scalars().all()

    pays = (
        await db.execute(
            select(Payment)
            .where(Payment.patient_id == user.patient_id)
            .order_by(Payment.created_at.desc())
        )
    ).scalars().all()

    refunds = (
        await db.execute(
            select(Refund)
            .where(Refund.patient_id == user.patient_id)
            .order_by(Refund.created_at.desc())
        )
    ).scalars().all()

    doctors = (await db.execute(select(Doctor).where(Doctor.active == True))).scalars().all()  # noqa: E712
    services = (await db.execute(select(Service).where(Service.active == True))).scalars().all()  # noqa: E712

    return {
        "data": {
            "patients": {str(p.id): _patient_dict(p)},
            "appointments": [_appointment_dict(a) for a in appts],
            "lab_orders": [_lab_dict(o) for o in labs],
            "payments": [_payment_dict(x) for x in pays],
            "refunds": [_refund_dict(r) for r in refunds],
            "doctors": [_doctor_dict(d) for d in doctors],
            "services": [_service_dict(s) for s in services],
            "roles": [],
            "users": [],
            "equipment": [],
            "reagents": [],
            "integrations": [],
            "shift": None,
            "audit": [],
        },
        "current_user": {
            "id": user.id,
            "fullname": user.fullname,
            "login": user.login,
            "role": "patient",
            "patient_id": user.patient_id,
        },
        "csrf_token": csrf_token,
        "role": "patient",
    }


# ═══════════════════ XODIMLAR UCHUN TO'LIQ SNAPSHOT ═══════════════════
async def _bootstrap_staff(
    db: AsyncSession, user: User, role: Role, csrf_token: str
) -> dict:
    s = get_settings()

    # TIBEX_BOOTSTRAP_RBAC_v1: har bir bo'lim faqat shu rolda mos
    # `<module>.view` ruxsati bo'lsagina snapshotga qo'shiladi — jonli
    # endpointlar (masalan GET /api/users, GET /api/audit) bilan bir xil
    # ruxsat matritsasi. Bu shifokor/laborant kabi rollarga boshqa
    # xodimlarning ro'yxati, moliyaviy yozuvlar yoki audit jurnali kabi
    # ularga tegishli bo'lmagan ma'lumotlar kelishining oldini oladi.
    def _can(module: str) -> bool:
        return has_permission(role.permissions, module, "view")

    can_users = _can("users")
    can_roles = _can("roles")
    can_audit = _can("audit")
    can_payments = _can("payments")
    can_integrations = _can("integrations")
    can_patients = _can("patients")
    can_appointments = _can("appointments")
    can_lab = _can("lab")
    can_doctors = _can("doctors")
    can_services = _can("services")
    can_equipment = _can("equipment")
    can_reagents = _can("reagents")
    can_finance_records = can_payments and user.role_key in {
        "admin", "superadmin", "reception", "cashier"
    }

    since = datetime.now(timezone.utc) - timedelta(days=s.bootstrap_patient_days)
    # Yangi bemorlar + yaqinda/kelajakda qabuli bor bemorlar. Aks holda 30 kundan
    # eski bemorning bugungi navbati qabulxona/shifokor ekranida ko'rinmay qolardi
    # (bemor keshda yo'q -> qator yashiriladi).
    since_date = since.date().isoformat()
    patient_stmt = (
        select(Patient)
        .where(
            or_(
                Patient.created_at >= since,
                Patient.id.in_(
                    select(Appointment.patient_id).where(Appointment.date >= since_date)
                ),
            )
        )
        .order_by(Patient.id.desc())
        .limit(1000)
    )
    if not can_patients:
        patient_stmt = patient_stmt.where(Patient.id == -1)
    elif user.role_key == "doctor":
        if user.doctor_id:
            patient_stmt = patient_stmt.where(Patient.id.in_(
                select(Appointment.patient_id).where(Appointment.doctor_id == user.doctor_id)
            ))
        else:
            patient_stmt = patient_stmt.where(Patient.id == -1)
    elif user.role_key == "lab":
        patient_stmt = patient_stmt.where(Patient.id.in_(select(LabOrder.patient_id)))
    elif user.role_key == "patient":
        patient_stmt = patient_stmt.where(Patient.id == (user.patient_id or -1))
    elif user.role_key not in {"admin", "superadmin", "reception", "cashier"}:
        patient_stmt = patient_stmt.where(Patient.id == -1)
    patients = (await db.execute(patient_stmt)).scalars().all()

    appt_stmt = select(Appointment).order_by(Appointment.scheduled_time)
    if not can_appointments:
        appt_stmt = appt_stmt.where(Appointment.id == -1)
    # TIBEX_DOCTOR_PRIVACY_v1: doctor faqat o'z bemorlarining qabullarini olishi kerak
    # (GET /api/appointments dagi filtr bilan bir xil qoida — bootstrap ham mos bo'lishi kerak)
    if user.role_key == "doctor":
        if user.doctor_id:
            appt_stmt = appt_stmt.where(Appointment.doctor_id == user.doctor_id)
        else:
            appt_stmt = appt_stmt.where(Appointment.id == -1)
    elif user.role_key == "patient":
        appt_stmt = appt_stmt.where(Appointment.patient_id == (user.patient_id or -1))
    elif user.role_key == "lab":
        appt_stmt = appt_stmt.where(Appointment.id.in_(
            select(LabOrder.appointment_id).where(LabOrder.appointment_id.is_not(None))
        ))
    elif user.role_key not in {"admin", "superadmin", "reception", "cashier"}:
        appt_stmt = appt_stmt.where(Appointment.id == -1)
    appointments = (await db.execute(appt_stmt)).scalars().all()

    # TIBEX_DOCTOR_SYNC_v1_BOOTSTRAP: doctor uchun lab filtrlash
    lab_stmt = select(LabOrder).order_by(LabOrder.created_at.desc()).limit(500)
    if not can_lab:
        lab_stmt = lab_stmt.where(LabOrder.id == -1)
    if user.role_key == "doctor":
        my_appt_ids = [a.id for a in appointments]
        if my_appt_ids:
            lab_stmt = lab_stmt.where(LabOrder.appointment_id.in_(my_appt_ids))
        else:
            lab_stmt = lab_stmt.where(LabOrder.id == -1)
    lab_orders = (await db.execute(lab_stmt)).scalars().all()

    payments = (
        (
            await db.execute(
                select(Payment).order_by(Payment.created_at.desc()).limit(500)
            )
        ).scalars().all()
        if can_finance_records
        else []
    )

    refunds = (
        (
            await db.execute(
                select(Refund).order_by(Refund.created_at.desc()).limit(200)
            )
        ).scalars().all()
        if can_finance_records
        else []
    )

    # Xodimlar bo'limi faqat xodim rollarini oladi; bemor portal akkauntlari bu yerga kirmaydi.
    users = (
        (await db.execute(select(User).where(User.role_key != "patient"))).scalars().all()
        if can_users
        else []
    )
    doctors = (await db.execute(select(Doctor))).scalars().all() if can_doctors else []
    # Shifokorning o'z profili (mutaxassislik, xona, narx): doctors.view ruxsatisiz ham,
    # faqat o'ziga bog'langan yozuv — real-time profil yangilanishi uchun.
    own_doctor = None
    if user.doctor_id:
        own_doctor = (
            await db.execute(select(Doctor).where(Doctor.id == user.doctor_id))
        ).scalar_one_or_none()
    services = (await db.execute(select(Service))).scalars().all() if can_services else []
    # Ruxsati roles.view bo'lmagan xodim ham o'zining haqiqiy permission
    # snapshotini front-end guardlari uchun olishi kerak; boshqa rollar berilmaydi.
    roles = (await db.execute(select(Role).order_by(Role.id))).scalars().all() if can_roles else [role]
    equipment = (await db.execute(select(Equipment))).scalars().all() if can_equipment else []
    reagents = (await db.execute(select(Reagent))).scalars().all() if can_reagents else []
    integrations = (
        filter_for_role(
            (await db.execute(select(Integration).order_by(Integration.id))).scalars().all(),
            user.role_key,
        )
        if can_integrations
        else []
    )
    shift = (
        (
            await db.execute(select(Shift).order_by(Shift.id.desc()).limit(1))
        ).scalar_one_or_none()
        if can_finance_records
        else None
    )
    audit = (
        (
            await db.execute(
                select(AuditLog).order_by(AuditLog.id.desc()).limit(200)
            )
        ).scalars().all()
        if can_audit
        else []
    )

    sys_info = await _system_info_dict(db)
    if not has_permission(role.permissions, "settings", "view"):
        sys_info = {
            "finance": sys_info.get("finance", {}) if can_finance_records else {},
            "clinic": sys_info.get("clinic", {}),
        }

    return {
        "data": {
            "system_info": sys_info,
            "patients": {str(p.id): _patient_dict(p) for p in patients},
            "appointments": [_appointment_dict(a) for a in appointments],
            "lab_orders": [_lab_dict(o) for o in lab_orders],
            "payments": [_payment_dict(p) for p in payments],
            "refunds": [_refund_dict(r) for r in refunds],
            "users": [_user_dict(u) for u in users],
            "doctors": [_doctor_dict(d) for d in doctors],
            "doctor_profile": _doctor_dict(own_doctor) if own_doctor else None,
            "services": [_service_dict(s_) for s_ in services],
            "roles": [_role_dict(r) for r in roles],
            "equipment": [_equipment_dict(e) for e in equipment],
            "reagents": [_reagent_dict(r) for r in reagents],
            "integrations": [_integration_dict(i, user.role_key) for i in integrations],
            "shift": _shift_dict(shift),
            "audit": [_audit_dict(a) for a in audit],
        },
        "current_user": {
            "id": user.id,
            "fullname": user.fullname,
            "login": user.login,
            "role": user.role_key,
            "doctor_id": user.doctor_id,
            "patient_id": user.patient_id,
            "password_change_count": user.password_change_count or 0,
        },
        "csrf_token": csrf_token,
        "role": user.role_key,
    }


@router.get("/bootstrap")
async def bootstrap(
    request: Request,
    db: AsyncSession = Depends(get_db),
    sess: dict = Depends(get_current_session),
    user: User = Depends(get_current_user),
    role: Role = Depends(get_current_role),
):
    """Rolga qarab mos snapshot qaytaradi."""
    csrf = issue_csrf(sess["jti"])

    if user.role_key == "patient" and user.patient_id is not None:
        await audit_view(db, user, request, f"bootstrap patient #{user.patient_id}")
        return await _bootstrap_patient(db, user, csrf)

    await audit_view(db, user, request, f"bootstrap role={user.role_key}")
    return await _bootstrap_staff(db, user, role, csrf)
