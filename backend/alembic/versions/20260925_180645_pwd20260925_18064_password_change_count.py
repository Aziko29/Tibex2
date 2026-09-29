"""password_change_count + password_changed_at qo'shildi

Revision ID: pwd20260925_18064
Revises: 4e9535194e19
Create Date: 2026-09-25T18:06:45.501897
"""
from alembic import op
import sqlalchemy as sa


revision = "pwd20260925_18064"
down_revision = "4e9535194e19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_change_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
    op.drop_column("users", "password_change_count")
