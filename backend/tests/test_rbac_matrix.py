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
