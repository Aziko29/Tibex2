"""audit_archives jadvali qo'shildi (audit tozalashda arxivlash uchun)

Revision ID: auda20260926_1500
Revises: disc20260926_1200
"""
from alembic import op
import sqlalchemy as sa


revision = "auda20260926_1500"
down_revision = "disc20260926_1200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_archives",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("original_id", sa.BigInteger(), nullable=False),
        sa.Column("user", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("prev_hash", sa.String(length=64), nullable=True),
        sa.Column("row_hash", sa.String(length=64), nullable=True),
        sa.Column("archived_by", sa.String(length=200), nullable=False),
        sa.Column(
            "archived_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_audit_archives_original_id", "audit_archives", ["original_id"]
    )
    op.create_index(
        "ix_audit_archives_action", "audit_archives", ["action"]
    )
    op.create_index(
        "ix_audit_archives_archived_at", "audit_archives", ["archived_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_audit_archives_archived_at", table_name="audit_archives")
    op.drop_index("ix_audit_archives_action", table_name="audit_archives")
    op.drop_index("ix_audit_archives_original_id", table_name="audit_archives")
    op.drop_table("audit_archives")
