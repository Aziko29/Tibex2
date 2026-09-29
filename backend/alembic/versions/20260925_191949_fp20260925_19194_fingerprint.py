"""fingerprint qo'shildi (session binding)

Revision ID: fp20260925_19194
Revises: pwd20260925_18064
"""
from alembic import op
import sqlalchemy as sa


revision = "fp20260925_19194"
down_revision = "pwd20260925_18064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("fingerprint", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "fingerprint")
