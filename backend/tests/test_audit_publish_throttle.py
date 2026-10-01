"""Audit publish siyosati testlari.

Implementatsiya: `app/security/audit.py::_should_publish`.
Siyosat:
  * `view` harakati WebSocket'ga YUBORILMAYDI (PHI o'qish shovqinini oldini olish).
    Lekin DB'ga (`audit_logs`) baribir yoziladi.
  * Boshqa harakatlar (create/update/delete/login/payment/refund/shift/export)
    WebSocket'ga darhol yuboriladi.

Bu testlar avval `_last_publish` / `_PUBLISH_THROTTLE_S` / `audit.time`
nomli symbol'larga tayanardi — ular mavjud emas. Yondashuv
`_should_publish()` bilan almashtirilgan (throttling emas, siyosat).
Shu sabab testlar actual implementatsiyaga mos qayta yozildi.
"""
from types import SimpleNamespace

import pytest

from app.security import audit


class _FakeDB:
    """log_action uchun minimal soxta sessiya.

    Advisory lock (faqat PG) va sequence chaqiruvlarini chetlab o'tadi;
    sqlite yo'lidan foydalanadi. `add()` qilingan obyektlar ro'yxatga olinadi.
    """

    def __init__(self) -> None:
        self.added: list = []

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))

    async def execute(self, _stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    def add(self, obj) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        pass


@pytest.fixture
def published(monkeypatch):
    """`audit.publish` ni ushlab oluvchi fixture."""
    bucket: list[str] = []

    async def _fake_publish(event_type: str, data: dict) -> None:
        bucket.append(data.get("action", "?"))

    monkeypatch.setattr(audit, "publish", _fake_publish)
    return bucket


async def _write(db, action: str, user: str = "Dr. A") -> None:
    await audit.log_action(
        db, user=user, role="doctor", action=action, detail="x",
    )


@pytest.mark.asyncio
async def test_view_is_never_published_but_row_is_written(published):
    """50 ta `view`: WS'ga 0 ta, DB'ga 50 ta."""
    db = _FakeDB()
    for _ in range(50):
        await _write(db, "view")
    assert published == []
    assert len(db.added) == 50


@pytest.mark.asyncio
async def test_payment_is_published_each_time(published):
    """5 ta `payment`: WS'ga 5 ta."""
    db = _FakeDB()
    for _ in range(5):
        await _write(db, "payment")
    assert published == ["payment"] * 5


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action",
    ["create", "update", "delete", "login", "payment", "refund", "shift", "export"],
)
async def test_non_view_actions_are_published(published, action):
    db = _FakeDB()
    await _write(db, action)
    assert published == [action]


def test_should_publish_predicate_contract():
    """`_should_publish` — yagona siyosat nuqtasi."""
    assert audit._should_publish("anyone", "view") is False
    for a in ("create", "update", "delete", "login", "payment", "refund", "shift"):
        assert audit._should_publish("anyone", a) is True
