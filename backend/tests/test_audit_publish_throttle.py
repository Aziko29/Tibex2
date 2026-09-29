"""P2-4: `view` audit eventlari 2 s da bittadan publish qilinadi, qolganlari darhol."""
from types import SimpleNamespace

import pytest

from app.security import audit


class _DB:
    """log_action uchun minimal soxta sessiya (sqlite yo'li: advisory lock/sequence yo'q)."""

    def __init__(self):
        self.added = []

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))

    async def execute(self, _stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


@pytest.fixture
def harness(monkeypatch):
    published: list[str] = []
    clock = {"t": 1000.0}

    async def fake_publish(event_type, data):
        published.append(data["action"])

    monkeypatch.setattr(audit, "publish", fake_publish)
    monkeypatch.setattr(audit, "_last_publish", {})
    monkeypatch.setattr(audit.time, "monotonic", lambda: clock["t"])
    return published, clock


async def _log(db, action, user="Dr. A"):
    return await audit.log_action(db, user=user, role="doctor", action=action, detail="x")


@pytest.mark.asyncio
async def test_50_views_in_1s_publish_once_but_all_rows_written(harness):
    published, clock = harness
    db = _DB()
    for _ in range(50):
        await _log(db, "view")
        clock["t"] += 1.0 / 50
    assert published.count("view") == 1
    assert len(db.added) == 50  # throttle faqat publish'ga tegadi, audit yozuviga emas


@pytest.mark.asyncio
async def test_5_payments_publish_5_times(harness):
    published, _clock = harness
    db = _DB()
    for _ in range(5):
        await _log(db, "payment")
    assert published == ["payment"] * 5


@pytest.mark.asyncio
async def test_view_publishes_again_after_window_and_per_user(harness):
    published, clock = harness
    db = _DB()
    await _log(db, "view", user="A")
    await _log(db, "view", user="B")      # boshqa foydalanuvchi — alohida oyna
    await _log(db, "view", user="A")      # oyna ichida — o'tkazib yuboriladi
    assert published == ["view", "view"]
    clock["t"] += audit._PUBLISH_THROTTLE_S
    await _log(db, "view", user="A")
    assert published == ["view", "view", "view"]
