"""P2-2: takroriy decrypt xatolari uchun alert 60 s oynada context bo'yicha bitta."""
import pytest

from app.security import crypto


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch):
    monkeypatch.setattr(crypto, "_last_decrypt_alert", {})


def _recorder(monkeypatch):
    calls: list[tuple] = []

    def fake_record_alert(*args, **kwargs):
        calls.append((args, kwargs))

    from app.routers import monitoring

    monkeypatch.setattr(monitoring, "record_alert", fake_record_alert)
    return calls


def test_100_bad_calls_same_context_alert_once(monkeypatch):
    calls = _recorder(monkeypatch)
    for _ in range(100):
        with pytest.raises(crypto.DecryptionError):
            crypto._decrypt_or_raise("1:not-valid-base64!!", "patients.fullname")
    assert len(calls) == 1


def test_different_contexts_alert_separately(monkeypatch):
    calls = _recorder(monkeypatch)
    for ctx in ("a.x", "b.y", "a.x", "b.y"):
        with pytest.raises(crypto.DecryptionError):
            crypto._decrypt_or_raise("1:not-valid-base64!!", ctx)
    assert len(calls) == 2


def test_alert_fires_again_after_window(monkeypatch):
    calls = _recorder(monkeypatch)
    clock = {"t": 1000.0}
    monkeypatch.setattr(crypto.time, "monotonic", lambda: clock["t"])
    for _ in range(3):
        with pytest.raises(crypto.DecryptionError):
            crypto._decrypt_or_raise("1:not-valid-base64!!", "ctx")
    assert len(calls) == 1
    clock["t"] += crypto._DECRYPT_ALERT_WINDOW_S + 1
    with pytest.raises(crypto.DecryptionError):
        crypto._decrypt_or_raise("1:not-valid-base64!!", "ctx")
    assert len(calls) == 2
