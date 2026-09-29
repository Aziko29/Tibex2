"""Audit: legacy belgisi + append-only triggerlar (UPDATE/DELETE/TRUNCATE taqiqlangan).

Revision ID: aud20260929_1100
Revises: phi20260929_1000
"""
import sqlalchemy as sa
from alembic import op

revision = "aud20260929_1100"
down_revision = "phi20260929_1000"
branch_labels = None
depends_on = None

TABLES = ("audit_logs", "audit_archives")


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("legacy", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.execute("UPDATE audit_logs SET legacy = true")  # mavjud qatorlar eski davrniki
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    for t in TABLES:
        op.execute(f"CREATE TRIGGER {t}_no_mod BEFORE UPDATE OR DELETE ON {t} "
                   f"FOR EACH ROW EXECUTE FUNCTION audit_append_only()")
        op.execute(f"CREATE TRIGGER {t}_no_truncate BEFORE TRUNCATE ON {t} "
                   f"FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only()")
        op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {t} FROM PUBLIC")


def downgrade() -> None:
    for t in TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {t}_no_truncate ON {t}")
        op.execute(f"DROP TRIGGER IF EXISTS {t}_no_mod ON {t}")
    op.execute("DROP FUNCTION IF EXISTS audit_append_only()")
    op.drop_column("audit_logs", "legacy")
