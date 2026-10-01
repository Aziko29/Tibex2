"""Resurslar (uskuna / reagent / integratsiya): validatsiya, rol ko'rinishi, SSRF/LAN.

DB talab qilmaydi.
"""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import inventory_validation as iv
from app.integration_access import filter_for_role, serialize_integration
from app.security import ssrf

BACKEND = Path(__file__).resolve().parents[1]
EQ = {"name": "Analizator", "category": "Analizator", "department": "Laboratoriya", "status": "working"}
RG = {"name": "Reagent", "category": "Gematologiya", "unit": "ml", "stock": 1, "min_stock": 0}


def _integration(**kw):
    base = dict(id=1, name="HL7", type="device", provider="Mindray", version="1", endpoint="tcp://192.168.1.5:2575",
                api_key="secret", status="connected", notes="izoh",
                last_sync=datetime(2026, 10, 1, tzinfo=timezone.utc))
    base.update(kw)
    return SimpleNamespace(**base)


def _code(fn, *a, **kw):
    with pytest.raises(HTTPException) as e:
        fn(*a, **kw)
    return e.value.status_code


# ───── validatsiya ─────
def test_equipment_rejects_empty_name_long_values_bad_status_and_dates():
    assert _code(iv.validate_equipment, {**EQ, "name": "  "}) == 422
    assert _code(iv.validate_equipment, {**EQ, "serial": "x" * 129}) == 422
    assert _code(iv.validate_equipment, {**EQ, "status": "zzz"}) == 422
    assert _code(iv.validate_equipment, {**EQ, "next_service": "2026-10-01T00:00"}) == 422
    assert _code(iv.validate_equipment, {**EQ, "last_service": "2026-02-30"}) == 422
    ok = iv.validate_equipment({**EQ, "last_service": "2026-02-03", "warranty": ""})
    assert ok["last_service"] == "2026-02-03" and ok["warranty"] == ""


def test_patch_null_for_not_null_columns_is_422():
    for field in ("name", "category", "department", "status"):
        assert _code(iv.validate_equipment, {field: None}, partial=True) == 422
    for field in ("name", "unit", "stock"):
        assert _code(iv.validate_reagent, {field: None}, partial=True) == 422
    for field in ("name", "type", "status"):
        assert _code(iv.validate_integration, {field: None}, partial=True) == 422


def test_reagent_rejects_negative_and_nan_stock():
    assert _code(iv.validate_reagent, {**RG, "stock": -1}) == 422
    assert _code(iv.validate_reagent, {**RG, "min_stock": -0.1}) == 422
    assert _code(iv.validate_reagent, {**RG, "stock": float("nan")}) == 422
    assert _code(iv.validate_reagent, {**RG, "stock": float("inf")}) == 422
    assert _code(iv.validate_reagent, {**RG, "expiry": "31.12.2026"}) == 422
    assert iv.validate_reagent({**RG, "expiry": "2026-12-31"})["stock"] == 1.0


def test_integration_type_status_validation():
    base = {"name": "n", "type": "device", "status": "pending"}
    assert iv.validate_integration(base)["type"] == "device"
    assert _code(iv.validate_integration, {**base, "type": "nope"}) == 422
    assert _code(iv.validate_integration, {**base, "status": "nope"}) == 422
    assert iv.validate_integration({"api_key": ""}, partial=True) == {"api_key": ""}


# ───── rol bo'yicha ko'rinish ─────
def test_lab_sees_only_devices_cashier_only_payments_admin_all():
    rows = [_integration(id=1, type="device"), _integration(id=2, type="payment"), _integration(id=3, type="website")]
    assert [i.id for i in filter_for_role(rows, "lab")] == [1]
    assert [i.id for i in filter_for_role(rows, "cashier")] == [2]
    assert [i.id for i in filter_for_role(rows, "admin")] == [1, 2, 3]


def test_restricted_roles_do_not_get_endpoint_notes_or_key_state():
    d = serialize_integration(_integration(), "lab")
    assert d["endpoint"] is None and d["notes"] is None and d["api_key"] is None and d["has_api_key"] is False
    full = serialize_integration(_integration(), "admin")
    assert full["endpoint"] and full["has_api_key"] is True and full["api_key"] is None


def test_serializer_is_the_same_for_api_and_bootstrap_and_sms_disabled():
    sms = _integration(type="sms", status="connected")
    d = serialize_integration(sms, "admin")
    assert d["status"] == "disabled" and d["has_api_key"] is False
    src = (BACKEND / "app/routers/bootstrap.py").read_text(encoding="utf-8")
    assert "serialize_integration(i, role_key)" in src


def test_lab_and_cashier_system_roles_have_integrations_view():
    src = (BACKEND / "scripts/init_db.py").read_text(encoding="utf-8")
    assert src.count('"integrations.view"') == 2
    mig = next((BACKEND / "alembic/versions").glob("*inv20261001_1000*.py")).read_text(encoding="utf-8")
    assert 'down_revision = "rcq20260930_1100"' in mig


# ───── SSRF / LAN ─────
def _lan(monkeypatch, cidrs):
    monkeypatch.setattr(ssrf, "lan_networks", lambda: [__import__("ipaddress").ip_network(c) for c in cidrs])


def test_device_allows_lan_and_mllp_but_others_stay_public_https(monkeypatch):
    _lan(monkeypatch, ["192.168.0.0/16", "10.0.0.0/8"])
    t = ssrf._validate_sync("mllp://192.168.1.20:2575", True)
    assert (t.scheme, t.port, t.ips) == ("mllp", 2575, ("192.168.1.20",))
    assert ssrf._validate_sync("http://10.1.2.3:8080/x", True).port == 8080
    with pytest.raises(ValueError):
        ssrf._validate_sync("tcp://192.168.1.20:2575", False)
    with pytest.raises(ValueError):
        ssrf._validate_sync("https://192.168.1.20", False)


def test_always_blocked_even_if_configured(monkeypatch):
    _lan(monkeypatch, ["192.168.0.0/16"])
    for url in ("tcp://127.0.0.1:2575", "http://169.254.169.254/latest", "tcp://224.0.0.1:2575",
                "tcp://[::1]:2575", "https://user:pw@8.8.8.8/", "tcp://172.16.0.5:2575"):
        with pytest.raises(ValueError):
            ssrf._validate_sync(url, True)


def test_lan_closed_when_cidrs_empty(monkeypatch):
    _lan(monkeypatch, [])
    with pytest.raises(ValueError):
        ssrf._validate_sync("tcp://192.168.1.20:2575", True)


def test_tcp_requires_port():
    with pytest.raises(ValueError):
        ssrf._validate_sync("tcp://8.8.8.8", True)


def test_check_connectivity_success_and_failure(monkeypatch):
    async def run():
        srv = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        monkeypatch.setattr(ssrf, "_validate_sync",
                            lambda url, device: ssrf.Target(url, "tcp", "x", port, ("127.0.0.1",)))
        ok = await ssrf.check_connectivity("tcp://x:1", "device")
        srv.close()
        await srv.wait_closed()
        bad = await ssrf.check_connectivity("tcp://x:1", "device")
        blocked = await ssrf.check_connectivity("tcp://127.0.0.1:1", "device")
        return ok, bad, blocked

    ok, bad, blocked = asyncio.run(run())
    assert ok == (True, None)
    assert bad[0] is False and bad[1]
    assert blocked[0] is False
