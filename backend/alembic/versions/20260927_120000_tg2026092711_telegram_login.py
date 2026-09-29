"""Telegram orqali bemor kirishi — User.telegram_chat_id + telegram_link_tokens

Revision ID: tg2026092711
Revises: auda20260926_1500
"""
from alembic import op
import sqlalchemy as sa


revision = "tg2026092711"
down_revision = "auda20260926_1500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("telegram_chat_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_users_telegram_chat_id", "users", ["telegram_chat_id"], unique=True
    )

    op.create_table(
        "telegram_link_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_telegram_link_tokens_token", "telegram_link_tokens", ["token"], unique=True
    )
    op.create_index(
        "ix_telegram_link_tokens_user_id", "telegram_link_tokens", ["user_id"]
    )
    op.create_index(
        "ix_telegram_link_tokens_created_at", "telegram_link_tokens", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_telegram_link_tokens_created_at", table_name="telegram_link_tokens")
    op.drop_index("ix_telegram_link_tokens_user_id", table_name="telegram_link_tokens")
    op.drop_index("ix_telegram_link_tokens_token", table_name="telegram_link_tokens")
    op.drop_table("telegram_link_tokens")

    op.drop_index("ix_users_telegram_chat_id", table_name="users")
    op.drop_column("users", "telegram_chat_id")
