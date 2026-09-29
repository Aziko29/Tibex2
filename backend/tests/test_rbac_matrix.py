"""RBAC: har /api marshrut ruxsat/sessiya bilan himoyalangan; o'zgartiruvchilar CSRF talab qiladi.
(Rol × endpoint HTTP matritsasi test DB talab qiladi — CI'da Postgres bilan kengaytiring.)"""
import pytest
from fastapi.routing import APIRoute

from app import deps
from app.main import app
from app.security.rbac import has_permission

PUBLIC = {
    "/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/staff-login",
    "/api/otp/request", "/api/otp/verify", "/api/security/csp-report",
    "/api/monitoring/frontend-errors", "/api/telegram/webhook", "/api/auth/me",
    "/api/auth/csrf",
}


def _funcs(dependant):
    for d in dependant.dependencies:
        yield d.call
        yield from _funcs(d)


def _routes():
    return [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api")]


def _protected(route) -> bool:
    calls = list(_funcs(route.dependant))
    names = {getattr(c, "__name__", "") for c in calls}
    return bool(names & {"_check", "get_current_user", "get_current_role", "get_current_session",
                         "get_current_patient_user", "require_patient_access"}) or any(
        getattr(c, "__module__", "").endswith("deps") and "current" in getattr(c, "__name__", "") for c in calls)


def test_all_non_public_routes_require_auth():
    open_routes = [f"{sorted(r.methods)} {r.path}" for r in _routes() if r.path not in PUBLIC and not _protected(r)]
    assert not open_routes, f"Himoyasiz marshrutlar: {open_routes}"


def test_mutating_routes_require_csrf():
    exempt = PUBLIC | {"/api/auth/change-password"}
    missing = []
    for r in _routes():
        if r.path in exempt or not (r.methods & {"POST", "PUT", "PATCH", "DELETE"}):
            continue
        if deps.require_csrf not in set(_funcs(r.dependant)) and deps.require_csrf not in [
            getattr(d, "dependency", None) for d in r.dependencies
        ]:
            missing.append(f"{sorted(r.methods)} {r.path}")
    assert not missing, f"CSRF'siz o'zgartiruvchi marshrutlar: {missing}"


@pytest.mark.parametrize("perms,allowed", [
    ("*", True), (["payments.create"], True), (["payments.view"], False), ([], False), (None, False),
])
def test_has_permission_matrix(perms, allowed):
    assert has_permission(perms, "payments", "create") is allowed


# ───────────────────────── P1-1: rol × endpoint HTTP matritsasi ─────────────────────────
# Real Postgres kerak: TEST_DATABASE_URL o'rnatilmasa quyidagi testlar skip bo'ladi.
# Source of truth (promptdan). Yagona og'ish: GET /api/reagents da "doctor" ham bor —
# init_db.SYSTEM_ROLES da doctor roliga `reagents.view` berilgan (kodga mos).
# Agar siyosat "doctor ko'rmasin" bo'lsa: SYSTEM_ROLES dan reagents.view ni olib tashlang
# va bu yerdan "doctor" ni ham.
ENDPOINTS: dict[tuple[str, str], set[str]] = {
    ("GET",   "/api/patients"):           {"admin", "superadmin", "reception", "cashier", "doctor", "lab"},
    ("POST",  "/api/patients"):           {"admin", "superadmin", "reception"},
    ("GET",   "/api/appointments"):       {"admin", "superadmin", "reception", "cashier", "doctor", "lab"},
    ("POST",  "/api/appointments"):       {"admin", "superadmin", "reception"},
    ("GET",   "/api/lab-orders"):         {"admin", "superadmin", "lab", "doctor"},
    ("POST",  "/api/lab-orders"):         {"admin", "superadmin", "lab", "doctor"},
    ("GET",   "/api/payments"):           {"admin", "superadmin", "cashier", "reception"},
    ("POST",  "/api/payments"):           {"admin", "superadmin", "cashier", "reception"},
    ("GET",   "/api/users"):              {"admin", "superadmin"},
    ("POST",  "/api/users"):              {"admin", "superadmin"},
    ("GET",   "/api/roles"):              {"admin", "superadmin"},
    ("POST",  "/api/roles"):              {"admin", "superadmin"},
    ("GET",   "/api/audit"):              {"admin", "superadmin", "reception", "cashier"},
    ("GET",   "/api/settings"):           {"admin", "superadmin"},
    ("PATCH", "/api/settings"):           {"admin", "superadmin"},
    ("GET",   "/api/equipment"):          {"admin", "superadmin", "lab", "doctor"},
    ("GET",   "/api/reagents"):           {"admin", "superadmin", "lab", "doctor"},
    ("GET",   "/api/integrations"):       {"admin", "superadmin"},
    ("GET",   "/api/monitoring/health"):  {"admin", "superadmin"},
}
ROLES = ("admin", "superadmin", "doctor", "reception", "cashier", "lab", "patient")

_BODIES: dict[tuple[str, str], dict] = {
    ("POST", "/api/patients"): {"fullname": "RBAC Test Bemor", "phone": "+998901234567"},
    ("POST", "/api/appointments"): {"patient_id": 1, "scheduled_time": "10:00", "date": "2026-10-01"},
    ("POST", "/api/lab-orders"): {"patient_id": 1, "test_key": "cbc", "test_name": "Umumiy qon tahlili"},
    ("POST", "/api/payments"): {"appointment_id": 1, "patient_id": 1, "amount": 1000},
    ("POST", "/api/users"): {"fullname": "RBAC Yangi", "login": "rbac_new_user",
                             "password": "Str0ng!Passw0rd#1", "role": "lab"},
    ("POST", "/api/roles"): {"key": "rbac_tmp_role", "name": "RBAC tmp", "permissions": ["patients.view"]},
    ("PATCH", "/api/settings"): {"discount_limit": 10},
}


def _minimal_body(method: str, path: str) -> dict:
    """Smallest plausible payload. Permission checks run before body validation, so the
    denied path is 403 regardless; the allowed path only has to avoid 401/403."""
    return _BODIES.get((method, path), {})


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", list(ENDPOINTS))
@pytest.mark.parametrize("role", ROLES)
async def test_rbac(method, path, role, seed_users, login):
    client, csrf = await login(role)
    kw = {}
    if method in ("POST", "PATCH", "PUT", "DELETE"):
        kw["headers"] = {"X-CSRF-Token": csrf}
    if method in ("POST", "PATCH", "PUT"):
        kw["json"] = _minimal_body(method, path)
    r = await client.request(method, path, **kw)
    if role in ENDPOINTS[(method, path)]:
        assert r.status_code not in (401, 403), f"{role} {method} {path} → {r.status_code}"
    else:
        assert r.status_code == 403, f"{role} {method} {path} → {r.status_code} (expected 403)"
