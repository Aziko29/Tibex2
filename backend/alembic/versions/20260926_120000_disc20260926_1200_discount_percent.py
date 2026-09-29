"""payments.discount_percent qo'shildi (kassa chegirma funksiyasi)

Revision ID: disc20260926_1200
Revises: upgrade_full_v1
"""
from alembic import op
import sqlalchemy as sa


revision = "disc20260926_1200"
down_revision = "upgrade_full_v1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column(
            "discount_percent",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("payments", "discount_percent")
