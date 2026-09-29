"""Audit zanjiri: hisoblash, buzilishni aniqlash (DB'siz, soxta oqim bilan)."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from app.security.audit import ZERO_HASH, compute_row_hash, verify_audit_chain


def _rows(n=4):
    rows, prev = [], ZERO_HASH
    for i in range(1, n + 1):
        t = datetime(2026, 9, 29, 10, i, tzinfo=timezone.utc)
        h = compute_row_hash(prev, id=i, user="u", role="admin", action="view", detail=f"patient #{i}",
                             before=None, after=None, ip="1.2.3.4", created_at=t)
        rows.append(SimpleNamespace(id=i, user="u", role="admin", action="view", detail=f"patient #{i}",
                                    before_data=None, after_data=None, ip="1.2.3.4", created_at=t,
                                    prev_hash=prev, row_hash=h, legacy=False))
        prev = h
    return rows


class _Stream:
    def __init__(self, rows):
        self.rows = rows

    def __aiter__(self):
        async def gen():
            for r in self.rows:
                yield r
        return gen()


class _DB:
    def __init__(self, rows):
        self.rows = rows

    async def stream_scalars(self, _stmt):
        return _Stream(self.rows)


def _verify(rows):
    return asyncio.run(verify_audit_chain(_DB(rows)))


def test_chain_valid():
    assert _verify(_rows()) == {"ok": True, "checked": 4, "broken_id": None}


def test_tampered_detail_detected():
    rows = _rows()
    rows[1].detail = "patient #999"
    res = _verify(rows)
    assert res["ok"] is False and res["broken_id"] == 2 and res["reason"] == "row_hash"


def test_deleted_row_detected():
    rows = _rows()
    del rows[1]
    res = _verify(rows)
    assert res["ok"] is False and res["broken_id"] == 3 and res["reason"] == "prev_hash"


def test_hash_depends_on_created_at():
    a, b = _rows(1)[0], _rows(1)[0]
    b_hash = compute_row_hash(ZERO_HASH, id=1, user="u", role="admin", action="view", detail="patient #1",
                              before=None, after=None, ip="1.2.3.4",
                              created_at=datetime(2026, 9, 29, 11, 0, tzinfo=timezone.utc))
    assert a.row_hash != b_hash
