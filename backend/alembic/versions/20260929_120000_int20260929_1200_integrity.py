"""25-26: bemor yumshoq o'chirish, to'lov idempotentligi, CHECK va bitta-ochiq-smena.

Revision ID: int20260929_1200
Revises: aud20260929_1100
"""
import sqlalchemy as sa
from alembic import op

revision = "int20260929_1200"
down_revision = "aud20260929_1100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("patients", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("patients", sa.Column("deleted_by", sa.String(200), nullable=True))
    op.create_index("ix_patients_deleted_at", "patients", ["deleted_at"])

    op.add_column("payments", sa.Column("idempotency_key", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_payments_idempotency_key", "payments", ["idempotency_key"])

    # Eski noto'g'ri qatorlar migratsiyani yiqitmasin: NOT VALID (yangi yozuvlar tekshiriladi)
    op.execute("ALTER TABLE payments ADD CONSTRAINT ck_payments_amount_positive CHECK (amount > 0) NOT VALID")
    op.execute("ALTER TABLE refunds ADD CONSTRAINT ck_refunds_amount_positive CHECK (amount > 0) NOT VALID")

    # Bir nechta ochiq smena bo'lsa, eng yangisidan boshqasini yopamiz
    op.execute(
        "UPDATE shifts SET open = false, closed_at = COALESCE(closed_at, now()) "
        "WHERE open AND id <> (SELECT max(id) FROM shifts WHERE open)"
    )
    op.create_index("uq_shifts_one_open", "shifts", ["open"], unique=True, postgresql_where=sa.text("open"))


def downgrade() -> None:
    op.drop_index("uq_shifts_one_open", table_name="shifts")
    op.execute("ALTER TABLE refunds DROP CONSTRAINT IF EXISTS ck_refunds_amount_positive")
    op.execute("ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_amount_positive")
    op.drop_constraint("uq_payments_idempotency_key", "payments", type_="unique")
    op.drop_column("payments", "idempotency_key")
    op.drop_index("ix_patients_deleted_at", table_name="patients")
    op.drop_column("patients", "deleted_by")
    op.drop_column("patients", "deleted_at")
