"""Payments router testlari: smoke + `today=true` va smena yopish regressiyalari."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient


def test_payments_requires_auth():
    from app.main import app
    client = TestClient(app)
    r = client.get("/api/payments")
    assert r.status_code == 401


def test_payments_module_imports_get_settings():
    """1-band: `get_settings` import qilinmagani NameError berardi."""
    from app.routers import payments
    assert callable(payments.get_settings)


class _Result:
    def __init__(self, items=None, one=None):
        self._items, self._one = items or [], one

    def scalars(self):
        return SimpleNamespace(all=lambda: list(self._items))

    def scalar_one_or_none(self):
        return self._one


class _RecordingDB:
    def __init__(self, results):
        self.results = list(results)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.results.pop(0)

    async def flush(self):
        return None


@pytest.mark.asyncio
async def test_list_payments_today_true_does_not_raise_and_filters_by_date(monkeypatch):
    from app.routers import payments

    audited = []

    async def fake_audit_view(_db, _user, _request, detail):
        audited.append(detail)

    monkeypatch.setattr(payments, "audit_view", fake_audit_view)

    db = _RecordingDB([_Result(items=[])])
    cashier = SimpleNamespace(role_key="cashier", patient_id=None)
    result = await payments.list_payments(
        request=SimpleNamespace(), today=True, appointment_id=None, patient_id=None,
        limit=500, db=db, user=cashier, _perm=None,
    )
    assert result == []
    assert audited == ["payments list count=0"]
    sql = str(db.statements[0])
    assert "payments.created_at >=" in sql


@pytest.mark.asyncio
async def test_close_shift_does_not_raise_name_error_and_sums_cash(monkeypatch):
    from starlette.requests import Request
    from app.routers import payments

    shift = SimpleNamespace(
        open=True, opening_balance=100_000, closed_at=None, closed_by=None, close_record=None,
    )
    pays = [
        SimpleNamespace(amount=50_000, method="cash"),
        SimpleNamespace(amount=30_000, method="card"),
    ]
    refunds = [SimpleNamespace(amount=10_000)]
    db = _RecordingDB([_Result(one=shift), _Result(items=pays), _Result(items=refunds)])

    async def no_audit(*_a, **_k):
        return None

    monkeypatch.setattr(payments, "log_action", no_audit)
    monkeypatch.setattr(payments, "publish", no_audit)
    request = Request({
        "type": "http", "method": "POST", "path": "/api/shift/close", "headers": [],
        "client": ("198.51.100.1", 1), "server": ("t", 80), "scheme": "http", "query_string": b"",
    })
    user = SimpleNamespace(fullname="Kassir", role_key="cashier")
    record = await payments.close_shift(
        payments.ShiftCloseIn(actual_cash=140_000), request, db, user, None,
    )
    assert record["expected_cash"] == 140_000  # 100k + 50k cash - 10k refund
    assert record["difference"] == 0
    assert shift.open is False
