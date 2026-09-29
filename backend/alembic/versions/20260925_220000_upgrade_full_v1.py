"""system_settings jadvali qo'shildi

Revision ID: upgrade_full_v1
Revises: fp20260925_19194
"""
from alembic import op
import sqlalchemy as sa


revision = "upgrade_full_v1"
down_revision = "fp20260925_19194"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(64), primary_key=True, nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.String(200), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("system_settings")
