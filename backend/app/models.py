from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Index,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .security.crypto import (
    BlindIndexString,
    EncryptedJSON,
    EncryptedString,
    EncryptedText,
)


# ===================== Rollar va foydalanuvchilar =====================
class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    icon: Mapped[str] = mapped_column(String(8), default="👤")
    color: Mapped[str] = mapped_column(String(32), default="lab")
    description: Mapped[str] = mapped_column(Text, default="")
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fullname: Mapped[str] = mapped_column(String(200))
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role_key: Mapped[str] = mapped_column(String(64), ForeignKey("roles.key"), index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    doctor_id: Mapped[int | None] = mapped_column(BigInteger)
    patient_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_valid_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # TIBEX_PWD_SYSTEM: model
    password_change_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # TIBEX_TELEGRAM_LOGIN_v1: bemor Telegram akkauntini ulaganda to'ldiriladi.
    # Faqat allaqachon parol/OTP bilan kirgan (login qilingan) sessiyadan,
    # bir martalik token orqali bog'lanadi — shuning uchun login qilinmagan
    # kishi boshqaning raqamiga o'z Telegramini ulay olmaydi.
    telegram_chat_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


class Session(Base):
    __tablename__ = "sessions"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(Text)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str | None] = mapped_column(String(64), index=True)
    ip: Mapped[str | None] = mapped_column(String(64), index=True)
    success: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


# ===================== Shifokorlar va xizmatlar =====================
class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    specialty: Mapped[str] = mapped_column(String(128))
    phone: Mapped[str | None] = mapped_column(String(32))
    price: Mapped[int] = mapped_column(BigInteger, default=0)
    room: Mapped[str | None] = mapped_column(String(32))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(64))
    price: Mapped[int] = mapped_column(BigInteger, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


# ===================== Bemorlar =====================
class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fullname: Mapped[str] = mapped_column(String(200), index=True)
    phone_enc: Mapped[str | None] = mapped_column(
        EncryptedString("patients.phone_enc")
    )
    phone_bidx: Mapped[str | None] = mapped_column(BlindIndexString("phone"), index=True)
    age: Mapped[int] = mapped_column(Integer, default=0)
    gender: Mapped[str] = mapped_column(String(16))
    blood: Mapped[str] = mapped_column(String(8), default="Noma'lum")
    address: Mapped[str | None] = mapped_column(
        "address_enc", EncryptedText("patients.address")
    )
    allergies: Mapped[list | None] = mapped_column(
        "allergies_enc", EncryptedJSON("patients.allergies"), default=list
    )
    chronic: Mapped[list | None] = mapped_column(
        "chronic_enc", EncryptedJSON("patients.chronic"), default=list
    )
    key_id: Mapped[int] = mapped_column(SmallInteger, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )
    # Yumshoq o'chirish (25-band): db.py dagi global filtr deleted_at IS NULL qo'shadi
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    deleted_by: Mapped[str | None] = mapped_column(String(200))


# ===================== Qabullar =====================
class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id"), index=True)
    doctor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("doctors.id"))
    doctor_name: Mapped[str] = mapped_column(String(200))
    scheduled_time: Mapped[str] = mapped_column(String(8))
    date: Mapped[str] = mapped_column(String(10), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    service: Mapped[dict | list | None] = mapped_column(
        "service_enc", EncryptedJSON("appointments.service")
    )
    paid: Mapped[int] = mapped_column(BigInteger, default=0)
    debt: Mapped[int] = mapped_column(BigInteger, default=0)
    payment_method: Mapped[str | None] = mapped_column(String(16))
    complaint: Mapped[str | None] = mapped_column(
        "complaint_enc", EncryptedText("appointments.complaint")
    )
    vitals: Mapped[dict | list | None] = mapped_column(
        "vitals_enc", EncryptedJSON("appointments.vitals")
    )
    prelim_dx: Mapped[str | None] = mapped_column(
        "prelim_dx_enc", EncryptedText("appointments.prelim_dx")
    )
    final_dx: Mapped[str | None] = mapped_column(
        "final_dx_enc", EncryptedText("appointments.final_dx")
    )
    prescriptions: Mapped[list | None] = mapped_column(
        "prescriptions_enc", EncryptedJSON("appointments.prescriptions"), default=list
    )
    draft: Mapped[dict | list | None] = mapped_column(
        "draft_enc", EncryptedJSON("appointments.draft")
    )
    lab_orders: Mapped[list | None] = mapped_column(
        "lab_orders_enc", EncryptedJSON("appointments.lab_orders"), default=list
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[str | None] = mapped_column(String(200))
    # Qabulxona: kutish taymeri va bekor/kelmadi sababi
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(
        "cancel_reason_enc", EncryptedText("appointments.cancel_reason")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


# ===================== Laboratoriya =====================
class LabOrder(Base):
    __tablename__ = "lab_orders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    appointment_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    patient_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id"), index=True)
    test_key: Mapped[str] = mapped_column(String(64))
    test_name: Mapped[str] = mapped_column(String(200))
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    status: Mapped[str] = mapped_column(String(32), index=True)
    ordered_by: Mapped[str] = mapped_column(String(200))
    received_by: Mapped[str | None] = mapped_column(String(200))
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    analyzer: Mapped[str | None] = mapped_column(String(64))
    result_data: Mapped[dict | list | None] = mapped_column(
        "result_data_enc", EncryptedJSON("lab_orders.result_data")
    )
    result_summary: Mapped[str | None] = mapped_column(
        "result_summary_enc", EncryptedText("lab_orders.result_summary")
    )
    result_note: Mapped[str | None] = mapped_column(
        "result_note_enc", EncryptedText("lab_orders.result_note")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[str | None] = mapped_column(String(200))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


# ===================== To'lovlar va qaytarishlar =====================
class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_payments_amount_positive"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    appointment_id: Mapped[int] = mapped_column(BigInteger, index=True)
    patient_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    method: Mapped[str] = mapped_column(String(16), index=True)
    cashier: Mapped[str] = mapped_column(String(200))
    services: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="completed")
    discount_percent: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    idempotency_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_refunds_amount_positive"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    payment_id: Mapped[int] = mapped_column(BigInteger)
    patient_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("patients.id"))
    amount: Mapped[int] = mapped_column(BigInteger)
    reason: Mapped[str] = mapped_column(Text)
    method: Mapped[str | None] = mapped_column(String(16))
    cashier: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Shift(Base):
    __tablename__ = "shifts"
    __table_args__ = (
        Index("uq_shifts_one_open", "open", unique=True, postgresql_where=text("open")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    open: Mapped[bool] = mapped_column(Boolean, default=True)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    opened_by: Mapped[str] = mapped_column(String(200))
    opening_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[str | None] = mapped_column(String(200))
    close_record: Mapped[dict | None] = mapped_column(JSON)


# ===================== Uskunalar / reagentlar / integratsiyalar =====================
class Equipment(Base):
    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(64))
    department: Mapped[str] = mapped_column(String(64), index=True)
    manufacturer: Mapped[str | None] = mapped_column(String(128))
    model: Mapped[str | None] = mapped_column(String(128))
    serial: Mapped[str | None] = mapped_column(String(128))
    location: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32), index=True)
    purchase_date: Mapped[str | None] = mapped_column(String(10))
    warranty: Mapped[str | None] = mapped_column(String(10))
    last_service: Mapped[str | None] = mapped_column(String(10))
    next_service: Mapped[str | None] = mapped_column(String(10))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


class Reagent(Base):
    __tablename__ = "reagents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(64))
    unit: Mapped[str] = mapped_column(String(16))
    stock: Mapped[float] = mapped_column(Float, default=0)
    min_stock: Mapped[float] = mapped_column(Float, default=0)
    lot: Mapped[str | None] = mapped_column(String(64))
    expiry: Mapped[str | None] = mapped_column(String(10))
    supplier: Mapped[str | None] = mapped_column(String(128))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(32), index=True)
    provider: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[str | None] = mapped_column(String(32))
    endpoint: Mapped[str | None] = mapped_column(String(500))
    api_key: Mapped[str | None] = mapped_column(
        EncryptedString("integrations.api_key")
    )
    status: Mapped[str] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(Text)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )


# ===================== Audit =====================
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32), index=True)
    detail: Mapped[str] = mapped_column(Text)
    before_data: Mapped[dict | None] = mapped_column(JSON)
    after_data: Mapped[dict | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    row_hash: Mapped[str | None] = mapped_column(String(64))
    # legacy=True: created_at hash'ga kirmagan eski davr yozuvlari (faqat bog'liqlik tekshiriladi)
    legacy: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        server_default=func.now(), index=True
    )


# ===================== Audit arxivi (tozalashda saqlash) =====================
class AuditArchive(Base):
    """Audit jurnalini tozalashda (clear) yozuvlar shu yerga ko'chiriladi,
    to'liq o'chirilmasin degan maqsadda (TIBEX_AUDIT_ARCHIVE_v1)."""

    __tablename__ = "audit_archives"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    original_id: Mapped[int] = mapped_column(BigInteger, index=True)
    user: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32), index=True)
    detail: Mapped[str] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    row_hash: Mapped[str | None] = mapped_column(String(64))
    archived_by: Mapped[str] = mapped_column(String(200))
    archived_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


# ===================== Bemor OTP (SMS kod) =====================
class OTPCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    phone: Mapped[str] = mapped_column(String(32), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


# ===================== Telegram ulash tokenlari =====================
class TelegramLinkToken(Base):
    """TIBEX_TELEGRAM_LOGIN_v1: bemor portalidan so'ralgan, bir martalik,
    muddati cheklangan token — Telegram botga /start <token> yuborilganda
    shu yozuv orqali qaysi User'ga chat_id bog'lanishi kerakligi aniqlanadi.
    Token faqat allaqachon login qilingan bemorga (patient sessiyasi orqali)
    beriladi, shuning uchun login qilinmagan kishi begona raqamga o'z
    Telegramini bog'lay olmaydi.
    """

    __tablename__ = "telegram_link_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


# ===================== Tizim sozlamalari =====================
class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(String(200))
