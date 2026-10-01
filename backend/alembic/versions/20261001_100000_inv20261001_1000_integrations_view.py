"""Laborant va Kassir rollariga `integrations.view` beriladi.

Ko'rinish serverda tur bo'yicha cheklanadi (laborant: device, kassir: payment).
Faqat tizim rollari (key = lab / cashier) yangilanadi; ruxsat allaqachon bo'lsa tegilmaydi.

Revision ID: inv20261001_1000
Revises: rcq20260930_1100
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "inv20261001_1000"
down_revision = "rcq20260930_1100"
branch_labels = None
depends_on = None

PERM = "integrations.view"
ROLE_KEYS = ("lab", "cashier")

_roles = sa.table("roles", sa.column("key", sa.String), sa.column("permissions", sa.JSON))


def _load(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, list) else None


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.select(_roles.c.key, _roles.c.permissions).where(_roles.c.key.in_(ROLE_KEYS))).all()
    for key, perms in rows:
        perms = _load(perms)
        if perms is None or PERM in perms:
            continue
        bind.execute(_roles.update().where(_roles.c.key == key).values(permissions=perms + [PERM]))


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.select(_roles.c.key, _roles.c.permissions).where(_roles.c.key.in_(ROLE_KEYS))).all()
    for key, perms in rows:
        perms = _load(perms)
        if perms is None or PERM not in perms:
            continue
        bind.execute(
            _roles.update().where(_roles.c.key == key).values(permissions=[p for p in perms if p != PERM])
        )
