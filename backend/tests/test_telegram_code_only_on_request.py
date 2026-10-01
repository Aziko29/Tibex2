"""Telegram botga kirish kodi FAQAT bemor /code so'raganda va barcha
tekshiruvlardan o'tgandan keyin yuborilishini kafolatlaydi (DB talab qilmaydi)."""
import asyncio
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import telegram as tg

CHAT = "555"


class _Res:
    def __init__(self, v):
        self.v = v

    def scalar_one_or_none(self):
        return None if isinstance(self.v, list) else self.v

    def scalars(self):
        return self

    def all(self):
        return self.v if isinstance(self.v, list) else []


class FakeDB:
    def __init__(self, results):
        self.results = list(results)

    async def execute(self, *_a, **_k):
        return _Res(self.results.pop(0) if self.results else None)

    def add(self, *_a):
        pass

    async def flush(self):
        pass

    async def commit(self):
        pass


class FakeRequest:
    def __init__(self, body):
        self._body = body
        self.headers = {}
        self.client = SimpleNamespace(host="1.2.3.4")

    async def json(self):
        return self._body


def _user(**kw):
    base = dict(
        id=1, fullname="Test Bemor", login="+998901234567", active=True,
        role_key="patient", patient_id=7, telegram_chat_id=CHAT,
    )
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture
def env(monkeypatch):
    calls = {"codes": [], "texts": [], "contact": 0}
    counters: dict[str, int] = {}

    async def fake_hit(key, limit, window):
        counters[key] = counters.get(key, 0) + 1
        if counters[key] > limit:
            raise HTTPException(429, "limit")
        return counters[key]

    async def fake_code(chat_id, code):
        calls["codes"].append((chat_id, code))
        return True

    async def fake_text(chat_id, text):
        calls["texts"].append(text)
        return True

    async def fake_contact(chat_id):
        calls["contact"] += 1
        return True

    async def fake_log(*_a, **_k):
        return None

    monkeypatch.setattr(tg, "hit", fake_hit)
    monkeypatch.setattr(tg, "send_telegram_code", fake_code)
    monkeypatch.setattr(tg, "send_telegram_text", fake_text)
    monkeypatch.setattr(tg, "request_telegram_contact", fake_contact)
    monkeypatch.setattr(tg, "log_action", fake_log)
    monkeypatch.setattr(tg, "verify_webhook_secret", lambda _h: True)
    monkeypatch.setattr(tg, "client_ip", lambda _r: "1.2.3.4")
    import app.config as cfg
    monkeypatch.setattr(cfg, "get_settings", lambda: SimpleNamespace(telegram_bot_username="tibex_bot", telegram_bot_token="t"))
    return calls


def _msg(text="/code", *, chat_type="private", sender=CHAT, date=None, key="message", update_id=1, contact=None):
    m = {
        "chat": {"id": int(CHAT), "type": chat_type},
        "from": {"id": int(sender)},
        "date": int(time.time()) if date is None else date,
    }
    if text is not None:
        m["text"] = text
    if contact is not None:
        m["contact"] = contact
    return {"update_id": update_id, key: m}


def _run(body, results):
    return asyncio.run(tg.telegram_webhook(FakeRequest(body), FakeDB(results), None))


def test_parse_command():
    assert tg._parse_command("/code") == ("/code", "")
    assert tg._parse_command("/CODE") == ("/code", "")
    assert tg._parse_command("/start abc", "b") == ("/start", "abc")
    assert tg._parse_command("/code@tibex_bot", "tibex_bot") == ("/code", "")
    assert tg._parse_command("/code@other_bot", "tibex_bot") == ("", "")
    assert tg._parse_command("/codexyz") == ("/codexyz", "")
    assert tg._parse_command("salom") == ("", "")


def test_code_sent_on_fresh_private_code_command(env):
    _run(_msg("/code"), [_user(), []])
    assert len(env["codes"]) == 1 and env["codes"][0][0] == CHAT


def test_contact_link_does_not_send_code(env):
    patient = SimpleNamespace(id=7, fullname="Test Bemor")
    contact = {"user_id": int(CHAT), "phone_number": "+998901234567"}
    body = _msg(None, contact=contact)
    _run(body, [patient, _user(telegram_chat_id=None), None])
    assert env["codes"] == []
    assert any("/code" in t for t in env["texts"])


def test_start_and_status_do_not_send_code(env):
    _run(_msg("/start"), [_user()])
    _run(_msg("/status", update_id=2), [_user()])
    assert env["codes"] == []


@pytest.mark.parametrize(
    "kwargs",
    [
        {"key": "edited_message"},                 # tahrirlangan xabar
        {"chat_type": "group"},                    # guruh chati
        {"sender": "999"},                         # yuboruvchi chat egasi emas
        {"date": 1},                               # eski (to'planib qolgan) xabar
        {"text": "/codexyz"},                      # buyruq emas
        {"text": "/code@other_bot"},               # boshqa botga mo'ljallangan
    ],
)
def test_code_not_sent_for_invalid_requests(env, kwargs):
    _run(_msg(**kwargs), [_user(), []])
    assert env["codes"] == []


def test_duplicate_update_and_double_tap_send_once(env):
    _run(_msg("/code", update_id=10), [_user(), []])
    _run(_msg("/code", update_id=10), [_user(), []])   # Telegram qayta yubordi
    _run(_msg("/code", update_id=11), [_user(), []])   # ketma-ket bosish (cooldown)
    assert len(env["codes"]) == 1


def test_unlinked_chat_gets_contact_button_not_code(env):
    _run(_msg("/code", update_id=20), [None])
    assert env["contact"] == 1
    assert env["codes"] == []


def test_inactive_patient_gets_no_code(env):
    _run(_msg("/code", update_id=21), [_user(active=False)])
    assert env["codes"] == []
