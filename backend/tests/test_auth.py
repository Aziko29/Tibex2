"""Auth router uchun smoke testlar."""
from fastapi.testclient import TestClient


def test_health_endpoint_reports_database_and_redis_status(monkeypatch):
    from types import SimpleNamespace
    from app import db
    from app.main import app

    class HealthyDB:
        async def execute(self, _query):
            return None

    async def healthy_db():
        yield HealthyDB()

    monkeypatch.setattr(db, "get_db", healthy_db)
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_health_endpoint_fails_closed_when_database_is_unavailable(monkeypatch):
    from app import db
    from app.main import app

    async def broken_db():
        raise RuntimeError("database unavailable")
        yield  # make this an async generator

    monkeypatch.setattr(db, "get_db", broken_db)
    response = TestClient(app).get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"ok": False}


def test_health_endpoint_fails_closed_when_redis_is_unavailable(monkeypatch):
    from types import SimpleNamespace
    from app import db, main, redis_client

    class HealthyDB:
        async def execute(self, _query):
            return None

    async def healthy_db():
        yield HealthyDB()

    class BrokenRedis:
        async def ping(self):
            return False

    monkeypatch.setattr(db, "get_db", healthy_db)
    monkeypatch.setattr(main, "_settings", SimpleNamespace(redis_url="redis://unused", is_prod=False))
    monkeypatch.setattr(redis_client, "get_redis", lambda: BrokenRedis())
    response = TestClient(main.app).get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"ok": False}


def test_bootstrap_requires_auth():
    from app.main import app
    client = TestClient(app)
    r = client.get("/api/bootstrap")
    assert r.status_code == 401


def test_lifespan_rejects_multiple_workers(monkeypatch):
    import asyncio
    import pytest
    from app.main import app, lifespan

    monkeypatch.setenv("WEB_CONCURRENCY", "2")

    async def start():
        async with lifespan(app):
            pass

    with pytest.raises(RuntimeError, match="Ko'p worker"):
        asyncio.run(start())


def test_session_cookie_uses_host_prefix_requirements():
    from fastapi import Response
    from app.security.session_cookie import set_session_cookie

    response = Response()
    set_session_cookie(response, "opaque", 300, "lax")
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("__Host-cf_session=opaque")
    assert "Secure" in cookie and "HttpOnly" in cookie and "Path=/" in cookie
    assert "Domain=" not in cookie
