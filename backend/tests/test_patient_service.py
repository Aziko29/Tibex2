"""services/patient_service.py — bemor profili qoidalari (DB talab qilmaydi)."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import patient_service as svc


class _Res:
    def __init__(self, v):
        self.v = v

    def scalar_one_or_none(self):
        return self.v


class FakeDB:
    """execute() chaqiruvlari tartibida tayyor natijalarni qaytaradi."""

    def __init__(self, *results):
        self.results = list(results)

    async def execute(self, *_a, **_k):
        return _Res(self.results.pop(0) if self.results else None)


def _patient(**kw):
    base = dict(id=7, fullname="Ali Valiyev", phone_enc="+998901111111", phone_bidx="+998901111111",
                age=30, gender="Erkak", blood="A+", address="Toshkent", allergies=None, chronic=None)
    base.update(kw)
    return SimpleNamespace(**base)


def _run(coro):
    return asyncio.run(coro)


def test_masked_phone():
    assert svc.masked_phone("+998901234567") == "***67"
    assert svc.masked_phone("") == "***"


def test_patient_to_dict_login_only_with_user():
    p = _patient()
    assert "login" not in svc.patient_to_dict(p)
    d = svc.patient_to_dict(p, SimpleNamespace(login="+998901111111"))
    assert d["login"] == "+998901111111" and d["allergies"] == [] and d["chronic"] == []


def test_change_phone_updates_patient_and_login():
    p, acc = _patient(), SimpleNamespace(login="+998901111111", phone="+998901111111")
    out = _run(svc.change_patient_phone(FakeDB(None, None, acc), p, "90 222 33 44", strict=True))
    assert out == "+998902223344"
    assert p.phone_enc == p.phone_bidx == acc.login == acc.phone == "+998902223344"


@pytest.mark.parametrize("raw", ["", "12345", "+1 202 555 0100"])
def test_change_phone_strict_rejects_invalid(raw):
    with pytest.raises(HTTPException) as e:
        _run(svc.change_patient_phone(FakeDB(), _patient(), raw, strict=True))
    assert e.value.status_code == 400


def test_change_phone_duplicate_patient_hides_owner_for_patients_only():
    other = SimpleNamespace(fullname="Boshqa Bemor")
    with pytest.raises(HTTPException) as e:
        _run(svc.change_patient_phone(FakeDB(other), _patient(), "+998903334455", strict=True, reveal_owner=False))
    assert e.value.status_code == 409 and "Boshqa Bemor" not in e.value.detail
    with pytest.raises(HTTPException) as e:
        _run(svc.change_patient_phone(FakeDB(other), _patient(), "+998903334455", strict=False, reveal_owner=True))
    assert "Boshqa Bemor" in e.value.detail


def test_change_phone_login_taken_by_other_account():
    taken = SimpleNamespace(patient_id=None)  # xodim akkaunti
    with pytest.raises(HTTPException) as e:
        _run(svc.change_patient_phone(FakeDB(None, taken), _patient(), "+998903334455", strict=True))
    assert e.value.status_code == 409


def test_change_phone_staff_may_store_raw_value():
    p = _patient()
    assert _run(svc.change_patient_phone(FakeDB(), p, "noma'lum", strict=False)) == "noma'lum"
    assert p.phone_enc == p.phone_bidx == "noma'lum"


def test_find_patient_user_conflict_and_missing():
    p = _patient()
    staff = SimpleNamespace(role_key="admin", patient_id=None)
    with pytest.raises(svc.PatientAccountConflict):
        _run(svc.find_patient_user(FakeDB(None, staff), p, "+998901111111"))
    assert _run(svc.find_patient_user(FakeDB(None, None), p, "+998901111111")) is None
    mine = SimpleNamespace(role_key="patient", patient_id=7)
    assert _run(svc.find_patient_user(FakeDB(mine), p, "+998901111111")) is mine
