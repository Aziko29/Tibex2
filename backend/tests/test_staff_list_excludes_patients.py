"""Xodimlar ro'yxati bemor portal akkauntlarini (role_key == "patient") o'z ichiga olmaydi.

`seed_users` har bir rol uchun bittadan akkaunt yaratadi, jumladan `rbac_patient` — shuning uchun
ro'yxatda u ko'rinmasligi kerak, `rbac_admin` esa ko'rinishi kerak.
Run: pytest backend/tests/test_staff_list_excludes_patients.py  (test DB kerak, conftest.py ga qarang)
"""
import pytest


@pytest.mark.asyncio
async def test_list_users_has_no_patient_accounts(login):
    client, _csrf = await login("admin")
    r = await client.get("/api/users")
    assert r.status_code == 200, r.text[:200]
    rows = r.json()
    logins = {u["login"] for u in rows}
    assert "rbac_admin" in logins, "xodim akkaunti ro'yxatda bo'lishi kerak"
    assert "rbac_patient" not in logins, "bemor akkaunti Xodimlar ro'yxatiga kirib qolgan"
    assert all(u["role"] != "patient" for u in rows)


@pytest.mark.asyncio
async def test_bootstrap_users_has_no_patient_accounts(login):
    client, _csrf = await login("admin")
    r = await client.get("/api/bootstrap")
    assert r.status_code == 200, r.text[:200]
    users = r.json().get("users", [])
    assert users, "admin uchun users bo'limi bo'sh bo'lmasligi kerak"
    assert all(u.get("role") != "patient" for u in users)


@pytest.mark.asyncio
async def test_cannot_create_staff_with_patient_role(login):
    client, csrf = await login("admin")
    r = await client.post(
        "/api/users",
        headers={"X-CSRF-Token": csrf},
        json={"fullname": "Bemor Roli Sinov", "login": "rbac_patient_role_try",
              "password": "Str0ng!Passw0rd#42", "role": "patient"},
    )
    assert r.status_code == 400, f"{r.status_code} {r.text[:200]}"
