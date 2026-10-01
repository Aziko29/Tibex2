"""Qabulxona: appointments.arrived_at, status_changed_at, cancel_reason.

Revision ID: rcp20260930_1000
Revises: int20260929_1200
"""
import sqlalchemy as sa
from alembic import op

revision = "rcp20260930_1000"
down_revision = "int20260929_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appointments", sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("appointments", sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("appointments", sa.Column("cancel_reason", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("appointments", "cancel_reason")
    op.drop_column("appointments", "status_changed_at")
    op.drop_column("appointments", "arrived_at")
