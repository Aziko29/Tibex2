"""Login oqimi: enumeration/timing, lockout holati, event loop bloklanmasligi."""
import asyncio
import statistics
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request


def _request():
    return Request({
        "type": "http", "method": "POST", "path": "/api/auth/login", "headers": [],
        "client": ("198.51.100.7", 1), "server": ("t", 80), "scheme": "http", "query_string": b"",
    })


class _LoginDB:
    def __init__(self, user):
        self.user = user
        self.added = []

    async def execute(self, _stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: self.user)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        return None

    async def flush(self):
        return None


@pytest.fixture
def login_env(monkeypatch):
    from app.routers import auth

    async def noop(*_a, **_k):
        return 1

    monkeypatch.setattr(auth, "hit", noop)
    monkeypatch.setattr(auth, "observe", noop)
    monkeypatch.setattr(auth, "log_action", noop)
    return auth


def _user(password_hash, locked=False):
    from app.security.passwords import hash_password  # noqa: F401
    return SimpleNamespace(
        id=1, login="ali", fullname="Ali", role_key="cashier", active=True,
        password_hash=password_hash, failed_attempts=0,
        locked_until=(datetime.now(timezone.utc) + timedelta(minutes=5)) if locked else None,
    )


async def _attempt(auth, user, username="ali"):
    start = time.perf_counter()
    with pytest.raises(HTTPException) as exc:
        await auth.login(auth.LoginIn(username=username, password="wrong-password"),
                         _request(), Response(), _LoginDB(user))
    return time.perf_counter() - start, exc.value


@pytest.mark.asyncio
async def test_login_unknown_existing_and_locked_look_identical(login_env, monkeypatch):
    from app.security import passwords
    from app.security.passwords import hash_password

    auth = login_env
    real = _user(hash_password("Correct-Horse-9!"))
    locked = _user(hash_password("Correct-Horse-9!"), locked=True)

    # Deterministik dalil: har uch holatda aynan BITTA Argon2 tekshiruvi bajariladi.
    verify_calls = []
    original = passwords.verify_password

    def counting_verify(stored, provided):
        verify_calls.append(stored)
        return original(stored, provided)

    monkeypatch.setattr(passwords, "verify_password", counting_verify)

    results = {}
    for label, user, name in (("unknown", None, "yoq"), ("existing", real, "ali"), ("locked", locked, "ali")):
        durations = []
        calls_before = len(verify_calls)
        for _ in range(5):
            real.failed_attempts = 0
            d, err = await _attempt(auth, user, name)
            durations.append(d)
        assert len(verify_calls) - calls_before == 5, f"{label}: har urinishda 1 ta Argon2 bo'lishi kerak"
        # min() umumiy CPU shovqinini (parallel jarayonlar) kamaytiradi.
        results[label] = (min(durations), err.status_code, err.detail)

    statuses = {(r[1], r[2]) for r in results.values()}
    assert statuses == {(401, "Login yoki parol xato")}, results
    times = [r[0] for r in results.values()]
    assert max(times) - min(times) < 0.030, results  # < 30 ms


@pytest.mark.asyncio
async def test_parallel_password_hashing_does_not_block_event_loop():
    """11-band: 8 parallel Argon2 paytida event loop 200 ms dan ko'p qotmasligi kerak."""
    from app.security.passwords import DUMMY_HASH, verify_password_async

    max_gap = 0.0
    stop = False

    async def heartbeat():
        nonlocal max_gap
        last = time.perf_counter()
        while not stop:
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            max_gap = max(max_gap, now - last)
            last = now

    task = asyncio.create_task(heartbeat())
    await asyncio.gather(*(verify_password_async(DUMMY_HASH, "x") for _ in range(8)))
    stop = True
    await task
    assert max_gap < 0.2, f"event loop {max_gap*1000:.0f} ms qotdi"
