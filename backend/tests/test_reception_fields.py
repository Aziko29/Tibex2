"""Qabulxona: kutish taymeri maydonlari, bekor sababi va rol cheklovlari."""
import re
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from app.state_machine import validate_appointment_transition

VERSIONS = Path(__file__).resolve().parent.parent / "alembic" / "versions"


def _appt(**kw):
    base = dict(
        id=1, patient_id=1, doctor_id=1, doctor_name="Dr", scheduled_time="10:00",
        date="2026-09-30", status="waiting", priority="normal", service={},
        paid=0, debt=0, payment_method=None, complaint=None, vitals=None,
        prelim_dx=None, final_dx=None, prescriptions=[], draft=None, lab_orders=[],
        completed_at=None, completed_by=None, created_at=None,
        arrived_at=datetime(2026, 9, 30, 5, 0, tzinfo=timezone.utc),
        status_changed_at=None, cancel_reason="Bemor rad etdi",
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_appointment_dict_exposes_reception_fields():
    from app.routers.appointments import _to_dict
    d = _to_dict(_appt())
    assert d["arrived_at"] == int(datetime(2026, 9, 30, 5, 0, tzinfo=timezone.utc).timestamp() * 1000)
    assert d["status_changed_at"] is None
    assert d["cancel_reason"] == "Bemor rad etdi"


def test_bootstrap_dict_exposes_reception_fields():
    from app.routers.bootstrap import _appointment_dict
    d = _appointment_dict(_appt())
    assert {"arrived_at", "status_changed_at", "cancel_reason"} <= d.keys()


def test_patch_schema_accepts_cancel_reason():
    from app.routers.appointments import AppointmentPatch
    body = AppointmentPatch(status="cancelled", cancel_reason="Bemor kelmadi")
    assert body.model_dump(exclude_unset=True)["cancel_reason"] == "Bemor kelmadi"


def test_reception_cannot_start_consultation():
    ok, _ = validate_appointment_transition("arrived", "in_progress", None, "reception")
    assert not ok
    ok, _ = validate_appointment_transition("waiting", "arrived", None, "reception")
    assert ok


def test_single_alembic_head():
    revs, downs = set(), set()
    for f in VERSIONS.glob("*.py"):
        t = f.read_text(encoding="utf-8")
        r = re.search(r'^revision\s*=\s*"([^"]+)"', t, re.M)
        d = re.search(r'^down_revision\s*=\s*(?:"([^"]+)"|None)', t, re.M)
        if r:
            revs.add(r.group(1))
        if d and d.group(1):
            downs.add(d.group(1))
    assert len(revs - downs) == 1


def test_realtime_publish_deferred_until_flush(monkeypatch):
    import asyncio
    from app import realtime

    sent = []

    async def fake(event_type, data):
        sent.append(event_type)

    monkeypatch.setattr(realtime, "_publish_now", fake)

    async def scenario():
        # Scope yo'q — darhol yuboriladi
        await realtime.publish("a", {})
        assert sent == ["a"]
        # Scope ichida — commit'gacha kutadi
        realtime.begin_deferred()
        await realtime.publish("appointment.updated", {})
        await realtime.publish("payment.created", {})
        assert sent == ["a"]
        await realtime.flush_deferred()
        assert sent == ["a", "appointment.updated"]  # bitta invalidate yetarli
        # Rollback — tashlab yuboriladi
        realtime.begin_deferred()
        await realtime.publish("x", {})
        realtime.discard_deferred()
        await realtime.flush_deferred()
        assert sent == ["a", "appointment.updated"]

    asyncio.run(scenario())


def test_cancel_reason_is_encrypted_column():
    from app.models import Appointment
    from app.security.crypto import EncryptedText
    col = Appointment.__table__.c.cancel_reason_enc
    assert isinstance(col.type, EncryptedText)
    assert "cancel_reason" not in Appointment.__table__.c
