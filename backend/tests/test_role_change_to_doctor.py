"""Xodim roli `doctor` ga o'zgarganda shifokor kartochkasi yaratilishi kerak.

Xato: update_user rolni o'zgartirardi, lekin doctor_id None bo'lib qolardi va
shifokor /api/patients da hech narsani ko'rmasdi (Patient.id == -1).
Run: pytest backend/tests/test_role_change_to_doctor.py  (test DB kerak, conftest.py ga qarang)
"""
import uuid

import pytest

PASSWORD = "Str0ng!Passw0rd#1"


async def _create_lab_user(client, csrf) -> dict:
    login = f"rc_doc_{uuid.uuid4().hex[:8]}"
    r = await client.post(
        "/api/users",
        headers={"X-CSRF-Token": csrf},
        json={"fullname": "Rol O'zgarishi Test", "login": login,
              "password": PASSWORD, "role": "lab"},
    )
    assert r.status_code == 201, r.text[:200]
    return r.json()


@pytest.mark.asyncio
async def test_role_change_to_doctor_creates_card(login):
    client, csrf = await login("admin")
    u = await _create_lab_user(client, csrf)
    assert u["doctor_id"] is None

    r = await client.patch(
        f"/api/users/{u['id']}",
        headers={"X-CSRF-Token": csrf},
        json={"role": "doctor", "specialty": "Terapevt"},
    )
    assert r.status_code == 200, r.text[:200]
    assert r.json()["doctor_id"] is not None, "shifokor kartochkasi yaratilmadi"


@pytest.mark.asyncio
async def test_role_change_to_doctor_requires_specialty(login):
    client, csrf = await login("admin")
    u = await _create_lab_user(client, csrf)

    r = await client.patch(
        f"/api/users/{u['id']}",
        headers={"X-CSRF-Token": csrf},
        json={"role": "doctor"},
    )
    assert r.status_code == 400, r.text[:200]


@pytest.mark.asyncio
async def test_doctor_card_cannot_be_shared_or_missing(login):
    client, csrf = await login("admin")
    a = await _create_lab_user(client, csrf)
    b = await _create_lab_user(client, csrf)

    r = await client.patch(
        f"/api/users/{a['id']}",
        headers={"X-CSRF-Token": csrf},
        json={"role": "doctor", "specialty": "Kardiolog"},
    )
    assert r.status_code == 200, r.text[:200]
    card_id = r.json()["doctor_id"]

    # Boshqa xodimni shu kartochkaga bog'lab bo'lmaydi
    r = await client.patch(
        f"/api/users/{b['id']}",
        headers={"X-CSRF-Token": csrf},
        json={"role": "doctor", "doctor_id": card_id},
    )
    assert r.status_code == 409, r.text[:200]

    # Mavjud bo'lmagan kartochka
    r = await client.patch(
        f"/api/users/{b['id']}",
        headers={"X-CSRF-Token": csrf},
        json={"role": "doctor", "doctor_id": 999999999},
    )
    assert r.status_code == 400, r.text[:200]
