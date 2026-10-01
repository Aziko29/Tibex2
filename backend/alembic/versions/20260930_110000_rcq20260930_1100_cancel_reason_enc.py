"""Qabulxona: cancel_reason shifrlanadi (cancel_reason_enc).

Revision ID: rcq20260930_1100
Revises: rcp20260930_1000
"""
import sqlalchemy as sa
from alembic import op

revision = "rcq20260930_1100"
down_revision = "rcp20260930_1000"
branch_labels = None
depends_on = None


def _cols(bind, table):
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _cols(bind, "appointments")
    if "cancel_reason_enc" not in cols:
        op.add_column("appointments", sa.Column("cancel_reason_enc", sa.Text(), nullable=True))
    # Ochiq matnli ustun: bo'sh bo'lsa olib tashlanadi. Ma'lumot bo'lsa YO'QOTILMAYDI
    # (SQL'da shifrlab bo'lmaydi) — `scripts/reencrypt.py` yoki qo'lda ko'chirish kerak.
    if "cancel_reason" in cols:
        n = bind.execute(sa.text("SELECT count(*) FROM appointments WHERE cancel_reason IS NOT NULL")).scalar()
        if not n:
            op.drop_column("appointments", "cancel_reason")


def downgrade() -> None:
    bind = op.get_bind()
    if "cancel_reason_enc" in _cols(bind, "appointments"):
        op.drop_column("appointments", "cancel_reason_enc")
