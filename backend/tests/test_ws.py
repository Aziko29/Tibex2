"""WebSocket sessiya tekshiruvi (umumiy `session_state` mantiqi) va rad etish auditi."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest


class _QueueDB:
    def __init__(self, *results):
        self.results = list(results)
        self.commits = 0

    async def execute(self, _stmt):
        value = self.results.pop(0)
        return SimpleNamespace(scalar_one_or_none=lambda: value)

    async def commit(self):
        self.commits += 1


def _patch_db(monkeypatch, db):
    from app.routers import ws

    async def fake_get_db():
        yield db

    monkeypatch.setattr(ws, "get_db", fake_get_db)
    return ws


def _row(**kw):
    now = datetime.now(timezone.utc)
    base = dict(revoked_at=None, expires_at=now + timedelta(hours=1), last_seen_at=now)
    base.update(kw)
    return SimpleNamespace(**base)


def _user(**kw):
    base = dict(active=True, role_key="doctor", session_valid_after=None)
    base.update(kw)
    return SimpleNamespace(**base)


INFO = {"jti": "j1", "user_id": 5, "iat": 1_700_000_000}


@pytest.mark.asyncio
async def test_revoked_session_is_rejected(monkeypatch):
    revoked = _row(revoked_at=datetime.now(timezone.utc))
    ws = _patch_db(monkeypatch, _QueueDB(revoked, revoked))
    assert await ws._ws_session_problem(INFO) == "revoked"
    assert await ws._validate_ws_session(INFO) is False


@pytest.mark.asyncio
async def test_missing_session_is_rejected(monkeypatch):
    ws = _patch_db(monkeypatch, _QueueDB(None))
    assert await ws._ws_session_problem(INFO) == "revoked"


@pytest.mark.asyncio
async def test_expired_session_is_rejected(monkeypatch):
    row = _row(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    ws = _patch_db(monkeypatch, _QueueDB(row))
    assert await ws._ws_session_problem(INFO) == "expired"


@pytest.mark.asyncio
async def test_inactive_session_is_revoked_and_committed(monkeypatch):
    row = _row(last_seen_at=datetime.now(timezone.utc) - timedelta(days=1))
    db = _QueueDB(row)
    ws = _patch_db(monkeypatch, db)
    assert await ws._ws_session_problem(INFO) == "inactive"
    assert row.revoked_at is not None and db.commits == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("user,expected", [
    (None, "user_disabled"),
    (_user(active=False), "user_disabled"),
    (_user(role_key="patient"), "user_disabled"),
    (_user(session_valid_after=datetime.now(timezone.utc) + timedelta(hours=1)), "session_renewed"),
])
async def test_user_state_rejects_ws(monkeypatch, user, expected):
    ws = _patch_db(monkeypatch, _QueueDB(_row(), user))
    assert await ws._ws_session_problem(INFO) == expected


@pytest.mark.asyncio
async def test_valid_session_passes_and_touches_last_seen(monkeypatch):
    row = _row(last_seen_at=datetime.now(timezone.utc) - timedelta(minutes=5))
    before = row.last_seen_at
    db = _QueueDB(row, _user())
    ws = _patch_db(monkeypatch, db)
    assert await ws._ws_session_problem(INFO) is None
    assert row.last_seen_at > before and db.commits == 1


@pytest.mark.asyncio
async def test_rejected_ws_is_audited(monkeypatch):
    from app.routers import ws

    calls = []
    db = _QueueDB()

    async def fake_get_db():
        yield db

    async def fake_log_action(_db, **kw):
        calls.append(kw)

    monkeypatch.setattr(ws, "get_db", fake_get_db)
    monkeypatch.setattr(ws, "log_action", fake_log_action)
    await ws._audit_ws_reject(INFO, "revoked", "203.0.113.9")
    assert calls and calls[0]["action"] == "ws_reject" and calls[0]["ip"] == "203.0.113.9"
    assert "revoked" in calls[0]["detail"] and db.commits == 1


@pytest.mark.asyncio
async def test_http_and_ws_share_the_same_session_rules():
    """deps va ws bir xil `session_state` funksiyalaridan foydalanadi."""
    from app import deps
    from app.routers import ws
    from app.security import session_state

    assert deps.session_row_problem is session_state.session_row_problem
    assert ws.session_row_problem is session_state.session_row_problem
    assert deps.user_problem is session_state.user_problem
    assert ws.user_problem is session_state.user_problem
