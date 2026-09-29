"""Pytest konfiguratsiyasi."""
import asyncio
import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Tests must not inherit the production mode from backend/.env. Keep an
# explicitly supplied TIBEX_ENV intact so deployment-config tests can opt in.
os.environ.setdefault("TIBEX_ENV", "local")
os.environ.setdefault("TIBEX_SECRET_KEY", "test-only-secret-key-" + "s" * 40)
os.environ.setdefault("TIBEX_MASTER_KEY_B64", "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg=")
os.environ.setdefault("TIBEX_BLIND_INDEX_KEY_B64", "eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXk=")
os.environ.setdefault("TIBEX_PASSWORD_PEPPER", "test-only-password-pepper-" + "p" * 40)

# P1-1 guards: the DB-backed RBAC matrix must never touch a production database.
os.environ.setdefault("TIBEX_ENV", "test")
_test_url = os.environ.get("TEST_DATABASE_URL")
_prod_url = os.environ.get("TIBEX_DATABASE_URL")
if _test_url and _prod_url and _test_url == _prod_url:
    raise RuntimeError("TEST_DATABASE_URL must not equal TIBEX_DATABASE_URL")
if _test_url:
    # Extra safety (alembic downgrade base runs on teardown): only *test* databases.
    if "test" not in _test_url.rsplit("/", 1)[-1].lower():
        raise RuntimeError("TEST_DATABASE_URL database name must contain 'test'")
    # The app, alembic and the fixtures below all read TIBEX_DATABASE_URL.
    os.environ["TIBEX_DATABASE_URL"] = _test_url

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ───────────────────────── P1-1: DB-backed fixtures (RBAC matrix) ─────────────────────────
# Everything below is a no-op / skip unless TEST_DATABASE_URL is set, so the existing
# DB-less tests keep running everywhere.
import subprocess  # noqa: E402

import pytest_asyncio  # noqa: E402

RBAC_PASSWORD = "Rbac-Test#2026-pass"
RBAC_ROLES = ("admin", "superadmin", "doctor", "reception", "cashier", "lab", "patient")
_RBAC_UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36 tibex-rbac-test"
_AUTH_CACHE: dict[str, tuple[str, str]] = {}  # role -> (session cookie, csrf token)


def _require_test_db() -> str:
    if not _test_url:
        pytest.skip("TEST_DATABASE_URL is not set (DB-backed test)")
    return _test_url


def _alembic(*args: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND, env=os.environ.copy(), check=True,
    )


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """alembic upgrade head on setup, downgrade base on teardown (test DB only)."""
    if not _test_url:
        yield
        return
    _alembic("upgrade", "head")
    yield
    _alembic("downgrade", "base")


@pytest.fixture(scope="session")
def session_factory(_schema):
    """async_sessionmaker over the test engine; also installed as the app's own engine.

    NullPool: connections are never reused across event loops (each pytest-asyncio test
    may run in its own loop), which would otherwise raise 'attached to a different loop'.
    """
    url = _require_test_db()
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from app import db as app_db

    engine = create_async_engine(url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    app_db._engine, app_db._SessionLocal = engine, factory
    yield factory
    app_db._engine = app_db._SessionLocal = None
    asyncio.run(engine.dispose())


@pytest.fixture(scope="session")
def seed_roles(session_factory):
    """Insert the canonical roles from scripts.init_db.SYSTEM_ROLES (idempotent)."""
    from sqlalchemy import select

    from app.models import Role
    from scripts.init_db import SYSTEM_ROLES

    async def _run():
        async with session_factory() as db:
            for r in SYSTEM_ROLES:
                exists = (await db.execute(select(Role).where(Role.key == r["key"]))).scalar_one_or_none()
                if exists is None:
                    db.add(Role(**r, active=True))
            await db.commit()

    asyncio.run(_run())
    return [r["key"] for r in SYSTEM_ROLES]


@pytest.fixture(scope="session")
def seed_users(session_factory, seed_roles):
    """One user per role with a fixed password → {role: (login, password)}."""
    from sqlalchemy import delete, select

    from app.models import Session as DBSession
    from app.models import User
    from app.security.passwords import hash_password

    creds = {role: (f"rbac_{role}", RBAC_PASSWORD) for role in RBAC_ROLES}

    async def _run():
        async with session_factory() as db:
            logins = [login for login, _ in creds.values()]
            old = (await db.execute(select(User.id).where(User.login.in_(logins)))).scalars().all()
            if old:
                await db.execute(delete(DBSession).where(DBSession.user_id.in_(old)))
                await db.execute(delete(User).where(User.id.in_(old)))
            pw_hash = hash_password(RBAC_PASSWORD)
            for role, (login, _pw) in creds.items():
                db.add(User(fullname=f"RBAC {role}", login=login, password_hash=pw_hash,
                            role_key=role, active=True))
            await db.commit()

    asyncio.run(_run())
    _AUTH_CACHE.clear()
    return creds


@pytest_asyncio.fixture
async def login(seed_users, session_factory):
    """Async factory: `client, csrf = await login(role)` against ASGITransport(app).

    Staff roles sign in through the real POST /api/auth/login (once per role per run, to
    stay under the login rate limit). The `patient` account cannot use that endpoint by
    design, so a staff-kind session is minted directly — the point of the matrix is that
    the *permission layer* refuses it on every staff endpoint.
    """
    import httpx

    from app.main import app
    from app.models import Session as DBSession
    from app.models import User
    from app.security.csrf import issue_csrf
    from app.security.session_cookie import COOKIE_NAME
    from app.security.sessions import create_token
    from sqlalchemy import select

    clients: list[httpx.AsyncClient] = []

    def _client(role: str, cookies: dict | None = None) -> httpx.AsyncClient:
        # Distinct client IP per role → independent per-IP rate-limit / threat buckets.
        ip = f"10.77.0.{RBAC_ROLES.index(role) + 1}"
        c = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=(ip, 50000)),
            base_url="https://test",  # __Host- cookie is Secure
            headers={"User-Agent": _RBAC_UA},
            cookies=cookies,
        )
        clients.append(c)
        return c

    async def _establish(role: str) -> tuple[str, str]:
        login_name, password = seed_users[role]
        if role == "patient":
            async with session_factory() as db:
                uid = (await db.execute(select(User.id).where(User.login == login_name))).scalar_one()
                token, jti, exp = create_token(uid, 3600, kind="staff")
                db.add(DBSession(jti=jti, user_id=uid, expires_at=exp,
                                 ip="10.77.0.7", user_agent=_RBAC_UA))
                await db.commit()
            return token, issue_csrf(jti)
        c = _client(role)
        r = await c.post("/api/auth/login", json={"username": login_name, "password": password})
        assert r.status_code == 200, f"login({role}) → {r.status_code} {r.text[:120]}"
        cookie = c.cookies.get(COOKIE_NAME)
        assert cookie, f"login({role}): no {COOKIE_NAME} cookie set"
        return cookie, r.json()["csrf_token"]

    async def _login(role: str):
        if role not in _AUTH_CACHE:
            _AUTH_CACHE[role] = await _establish(role)
        cookie, csrf = _AUTH_CACHE[role]
        return _client(role, cookies={COOKIE_NAME: cookie}), csrf

    yield _login
    for c in clients:
        await c.aclose()
