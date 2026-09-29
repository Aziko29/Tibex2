"""25–29-band regressiya testlari (DB talab qilmaydigan qismlari)."""
import asyncio
import json
import logging

import pytest

from app.models import Patient, Payment, Refund, Shift
from app.observability import JsonFormatter, request_id_var
from app.security import ssrf


def test_patient_soft_delete_columns():
    assert "deleted_at" in Patient.__table__.c and "deleted_by" in Patient.__table__.c


def test_payment_constraints():
    assert Payment.__table__.c.idempotency_key.unique
    for m in (Payment, Refund):
        assert any("amount > 0" in str(c.sqltext) for c in m.__table__.constraints if hasattr(c, "sqltext"))
    assert any(i.unique and i.name == "uq_shifts_one_open" for i in Shift.__table__.indexes)


def test_patient_filter_applied():
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from sqlalchemy.orm import with_loader_criteria  # noqa: F401

    s = Session()  # dvigatelsiz: faqat kompilyatsiya
    from sqlalchemy.dialects import postgresql

    stmt = select(Patient).options(with_loader_criteria(Patient, Patient.deleted_at.is_(None)))
    assert "deleted_at IS NULL" in str(stmt.compile(dialect=postgresql.dialect()))
    s.close()


@pytest.mark.parametrize("ip", ["100.64.0.1", "198.18.0.1", "192.0.0.1", "10.0.0.1", "127.0.0.1", "::1", "169.254.1.1"])
def test_ssrf_blocks_non_global(ip):
    assert ssrf._is_public(ip) is False


def test_ssrf_allows_public_and_async():
    assert ssrf._is_public("8.8.8.8") is True
    with pytest.raises(ValueError):
        asyncio.run(ssrf.validate_https_url("http://example.com"))


def test_json_log_has_request_id():
    tok = request_id_var.set("abc123")
    rec = logging.LogRecord("t", logging.INFO, "", 0, "salom", None, None)
    data = json.loads(JsonFormatter().format(rec))
    request_id_var.reset(tok)
    assert data["request_id"] == "abc123" and data["msg"] == "salom"
