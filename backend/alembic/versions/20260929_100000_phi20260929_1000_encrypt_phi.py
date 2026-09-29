"""PHI ustunlarini shifrlash — 1-bosqich: *_enc ustunlar + ma'lumotni ko'chirish.

Eski ustunlar SAQLANADI (nullable qilinadi) — keyingi releasda alohida
migratsiya bilan o'chiriladi. downgrade() ma'lumotni deshifrlab qaytaradi.

Revision ID: phi20260929_1000
Revises: tg2026092711
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "phi20260929_1000"
down_revision = "tg2026092711"
branch_labels = None
depends_on = None

BATCH = 500
# (jadval, ustun, tur: "t" matn / "j" JSON, eski ustun NOT NULL bo'lganmi)
COLS = [
    ("patients", "address", "t"),
    ("patients", "allergies", "j"),
    ("patients", "chronic", "j"),
    ("appointments", "service", "j"),
    ("appointments", "complaint", "t"),
    ("appointments", "vitals", "j"),
    ("appointments", "prelim_dx", "t"),
    ("appointments", "final_dx", "t"),
    ("appointments", "prescriptions", "j"),
    ("appointments", "draft", "j"),
    ("appointments", "lab_orders", "j"),
    ("lab_orders", "result_data", "j"),
    ("lab_orders", "result_summary", "t"),
    ("lab_orders", "result_note", "t"),
]
NOT_NULL_OLD = {("appointments", "service"), ("patients", "allergies"),
                ("patients", "chronic"), ("appointments", "prescriptions"),
                ("appointments", "lab_orders")}
PK = {"lab_orders": "id"}


def _ring():
    from app.security.crypto import _ring
    return _ring


def _as_obj(v):
    if isinstance(v, (str, bytes)):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v


def _copy(conn, table, col, kind, direction):
    ring = _ring()
    pk = PK.get(table, "id")
    ctx = f"{table}.{col}"
    src, dst = (col, f"{col}_enc") if direction == "up" else (f"{col}_enc", col)
    last = None
    while True:
        q = f'SELECT "{pk}", "{src}" FROM "{table}" WHERE "{src}" IS NOT NULL'
        params = {"n": BATCH}
        if last is not None:
            q += f' AND "{pk}" > :last'
            params["last"] = last
        q += f' ORDER BY "{pk}" LIMIT :n'
        rows = conn.execute(sa.text(q), params).all()
        if not rows:
            break
        for rid, val in rows:
            last = rid
            if direction == "up":
                obj = _as_obj(val) if kind == "j" else val
                plain = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if kind == "j" else str(val)
                new = ring.encrypt(plain, ctx)
                conn.execute(sa.text(f'UPDATE "{table}" SET "{dst}" = :v WHERE "{pk}" = :i AND "{dst}" IS NULL'),
                             {"v": new, "i": rid})
            else:
                plain = ring.decrypt(val, ctx)
                new = plain if kind == "t" else plain  # JSON: matn sifatida yoziladi, CAST pastda
                stmt = f'UPDATE "{table}" SET "{dst}" = ' + (":v" if kind == "t" else "CAST(:v AS JSON)") + f' WHERE "{pk}" = :i'
                conn.execute(sa.text(stmt), {"v": new, "i": rid})


def upgrade() -> None:
    for t, c, _k in COLS:
        op.add_column(t, sa.Column(f"{c}_enc", sa.Text(), nullable=True))
    conn = op.get_bind()
    for t, c, k in COLS:
        _copy(conn, t, c, k, "up")
    for t, c, _k in COLS:
        if (t, c) in NOT_NULL_OLD:
            op.alter_column(t, c, existing_type=sa.JSON(), nullable=True)


def downgrade() -> None:
    conn = op.get_bind()
    for t, c, k in COLS:
        _copy(conn, t, c, k, "down")
    for t, c, _k in COLS:
        if (t, c) in NOT_NULL_OLD:
            empty = "'{}'" if c == "service" else "'[]'"
            op.execute(f'UPDATE "{t}" SET "{c}" = CAST({empty} AS JSON) WHERE "{c}" IS NULL')
            op.alter_column(t, c, existing_type=sa.JSON(), nullable=False)
    for t, c, _k in reversed(COLS):
        op.drop_column(t, f"{c}_enc")
