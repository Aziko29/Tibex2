from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request


@pytest.mark.asyncio
async def test_sms_fails_closed_without_provider_token(monkeypatch):
    from app.security import otp

    monkeypatch.setattr(otp, "get_settings", lambda: SimpleNamespace(eskiz_token=""))
    assert await otp.send_sms("+998901234567", "123456") is False


@pytest.mark.asyncio
async def test_argon2_async_wrappers_offload_work_and_cap_parallelism(monkeypatch):
    import asyncio
    import threading
    import time

    from app.security import passwords

    state = {"active": 0, "peak": 0}
    lock = threading.Lock()

    def slow_hash(_password):
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        time.sleep(0.04)
        with lock:
            state["active"] -= 1
        return "test-hash"

    monkeypatch.setattr(passwords, "hash_password", slow_hash)
    started = time.perf_counter()
    task = asyncio.create_task(passwords.hash_password_async("secret"))
    await asyncio.sleep(0.01)
    assert not task.done()
    assert time.perf_counter() - started < 0.03
    assert await task == "test-hash"

    await asyncio.gather(*(passwords.hash_password_async("secret") for _ in range(8)))
    assert state["peak"] <= 4


def test_telegram_webhook_secret_required_in_production(monkeypatch):
    from app.security import telegram

    monkeypatch.setattr(
        telegram,
        "get_settings",
        lambda: SimpleNamespace(telegram_webhook_secret="", is_prod=True),
    )
    assert telegram.verify_webhook_secret(None) is False


@pytest.mark.asyncio
async def test_wrong_otp_attempt_is_committed_before_error(monkeypatch):
    from app.routers import patient_otp

    otp_row = SimpleNamespace(
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        attempts=0,
        used=False,
        user_id=10,
        code_hash="stored",
    )

    class Result:
        def scalar_one_or_none(self):
            return otp_row

    class FakeDB:
        commits = 0

        async def execute(self, _query):
            return Result()

        def add(self, _row):
            pass

        async def commit(self):
            self.commits += 1

    async def no_limit(*_args, **_kwargs):
        return None

    async def no_audit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(patient_otp, "hit", no_limit)
    monkeypatch.setattr(patient_otp, "verify_code", lambda *_args: False)
    monkeypatch.setattr(patient_otp, "log_action", no_audit)

    request = Request({"type": "http", "method": "POST", "path": "/verify", "headers": [], "client": ("127.0.0.1", 1), "server": ("test", 80), "scheme": "http", "query_string": b""})
    db = FakeDB()
    with pytest.raises(HTTPException) as exc:
        await patient_otp.verify_otp(
            patient_otp.OTPVerify(phone="901234567", code="000000"),
            request,
            Response(),
            db,
        )
    assert exc.value.status_code == 400
    assert otp_row.attempts == 1
    assert db.commits == 1


def _http_request(path="/test", headers=(), client="198.51.100.20"):
    return Request({
        "type": "http", "method": "GET", "path": path,
        "headers": list(headers), "client": (client, 1234),
        "server": ("test", 80), "scheme": "http", "query_string": b"",
    })


class _SessionDB:
    def __init__(self, row):
        self.row = row
        self.commits = 0

    async def execute(self, _query):
        return SimpleNamespace(scalar_one_or_none=lambda: self.row)

    async def commit(self):
        self.commits += 1


@pytest.mark.asyncio
async def test_staff_inactivity_revokes_persist_before_401(monkeypatch):
    from app import deps

    now = datetime.now(timezone.utc)
    row = SimpleNamespace(
        revoked_at=None,
        expires_at=now + timedelta(hours=1),
        last_seen_at=now - timedelta(hours=1),
    )
    db = _SessionDB(row)
    monkeypatch.setattr(deps, "parse_token", lambda *_a, **_k: {"jti": "j1", "user_id": 1, "iat": 1})
    monkeypatch.setattr(deps, "verify_session_binding", lambda *_a: _async_none())
    monkeypatch.setattr(deps, "get_settings", lambda: SimpleNamespace(inactivity_minutes=30, is_prod=False))

    with pytest.raises(HTTPException) as exc:
        await deps.get_current_session(_http_request(), "signed-token", db)

    assert exc.value.status_code == 401
    assert row.revoked_at is not None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_patient_inactivity_revokes_persist_before_401(monkeypatch):
    from app import deps

    now = datetime.now(timezone.utc)
    row = SimpleNamespace(
        revoked_at=None,
        expires_at=now + timedelta(hours=1),
        last_seen_at=now - timedelta(hours=1),
    )
    db = _SessionDB(row)
    monkeypatch.setattr(deps, "parse_token", lambda *_a, **_k: {"jti": "p1", "user_id": 2, "iat": 1})
    monkeypatch.setattr(deps, "get_settings", lambda: SimpleNamespace(inactivity_minutes=30))

    with pytest.raises(HTTPException) as exc:
        await deps.get_patient_session(_http_request(), "signed-token", db)

    assert exc.value.status_code == 401
    assert row.revoked_at is not None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_session_binding_mismatch_requires_login_without_revoking(monkeypatch):
    from app.security import session_binding

    row = SimpleNamespace(fingerprint="known-device", revoked_at=None)
    db = _SessionDB(row)
    monkeypatch.setattr(session_binding, "_client_fingerprint", lambda _request: "different-device")

    with pytest.raises(HTTPException) as exc:
        await session_binding.verify_session_binding(_http_request(), "j1", db)

    assert exc.value.status_code == 401
    assert row.revoked_at is None
    assert db.commits == 0


def test_session_fingerprint_uses_browser_family_and_major_version_only():
    from app.security.session_binding import _client_fingerprint

    first = _http_request(
        headers=[
            (b"user-agent", b"Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.1 Safari/537.36"),
            (b"accept-language", b"uz-UZ"),
        ],
    )
    changed_ip_and_locale = Request({
        "type": "http", "method": "GET", "path": "/test",
        "headers": [(b"user-agent", b"Mozilla/5.0 (Linux) Chrome/126.5.9 Safari/537.36"),
                    (b"accept-language", b"en-US")],
        "client": ("203.0.113.4", 1234), "server": ("test", 80),
        "scheme": "http", "query_string": b"",
    })
    assert _client_fingerprint(first) == _client_fingerprint(changed_ip_and_locale)


async def _async_none():
    return None


def test_untrusted_forwarded_for_is_ignored(monkeypatch):
    from app.security import netutil

    monkeypatch.setattr(netutil, "get_settings", lambda: SimpleNamespace(trusted_proxy_ips=["127.0.0.1"]))
    request = _http_request(headers=[(b"x-forwarded-for", b"203.0.113.99")])
    assert netutil.client_ip(request) == "198.51.100.20"


def test_trusted_proxy_accepts_one_valid_forwarded_ip_only(monkeypatch):
    from app.security import netutil

    monkeypatch.setattr(netutil, "get_settings", lambda: SimpleNamespace(trusted_proxy_ips=["127.0.0.1"]))
    valid = _http_request(headers=[(b"x-forwarded-for", b"203.0.113.99")], client="127.0.0.1")
    chain = _http_request(headers=[(b"x-forwarded-for", b"203.0.113.99, 198.51.100.7")], client="127.0.0.1")
    malformed = _http_request(headers=[(b"x-forwarded-for", b"not-an-ip")], client="127.0.0.1")
    assert netutil.client_ip(valid) == "203.0.113.99"
    assert netutil.client_ip(chain) == "127.0.0.1"
    assert netutil.client_ip(malformed) == "127.0.0.1"


def test_compose_nginx_and_systemd_use_host_loopback_only():
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    compose = (backend / "docker-compose.yml").read_text(encoding="utf-8")
    nginx = (backend / "deploy" / "nginx.conf").read_text(encoding="utf-8")
    service = (backend / "deploy" / "tibex.service").read_text(encoding="utf-8")
    assert "network_mode: host" in compose
    assert '"127.0.0.1:6379:6379"' in compose
    assert "host.docker.internal" not in compose
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in nginx
    assert "rate=10r/m" in nginx and "rate=20r/s" in nginx
    assert "--forwarded-allow-ips=127.0.0.1" in service
    assert "-w 1" in service


@pytest.mark.asyncio
async def test_production_rate_limit_fails_closed_without_redis(monkeypatch):
    from app.security import rate_limit
    from app import config

    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(is_prod=True))
    with pytest.raises(HTTPException) as exc:
        await rate_limit.hit("login:test", 5, 60)
    assert exc.value.status_code == 503
    assert exc.value.headers["Retry-After"] == "30"


def test_production_rejects_http_or_placeholder_origins():
    from app.config import Settings

    for origins in (["http://localhost:8000"], ["https://<CLINIC-DOMAIN>"]):
        with pytest.raises(ValueError, match="allowed_origins"):
            Settings(
                env="production",
                secret_key="s" * 48,
                master_key_b64="m" * 48,
                blind_index_key_b64="b" * 48,
                password_pepper="p" * 48,
                redis_url="redis://localhost:6379/0",
                database_url="postgresql+asyncpg://tibex:" + "d" * 24 + "@localhost:5432/tibex",
                allowed_origins=origins,
                cookie_secure=True,
            )


def test_patient_account_never_uses_default_or_weak_password():
    from pydantic import ValidationError
    from app.routers.patients import PatientIn

    common = {"fullname": "Synthetic Patient", "phone": "+998901234567", "create_account": True}
    with pytest.raises(ValidationError):
        PatientIn(**common)
    with pytest.raises(ValidationError):
        PatientIn(**common, account_password="tibex_2026")
    with pytest.raises(ValidationError):
        PatientIn(**{**common, "phone": "123"}, account_password="Strong@Pass2026")
    model = PatientIn(**common, account_password="Strong@Pass2026")
    assert model.account_password == "Strong@Pass2026"


def test_production_accepts_a_real_https_origin():
    from app.config import Settings

    settings = Settings(
        env="production",
        secret_key="s" * 48,
        master_key_b64="m" * 48,
        blind_index_key_b64="b" * 48,
        password_pepper="p" * 48,
        redis_url="redis://localhost:6379/0",
        database_url="postgresql+asyncpg://tibex:" + "d" * 24 + "@localhost:5432/tibex",
        allowed_origins=["https://clinic.tibex.uz"],
        cookie_secure=True,
    )
    assert settings.is_prod
    assert settings.allowed_origins == ["https://clinic.tibex.uz"]


def test_production_rejects_demo_reset_and_duplicate_secrets():
    from app.config import Settings

    base = dict(
        env="production",
        secret_key="s" * 48,
        master_key_b64="m" * 48,
        blind_index_key_b64="b" * 48,
        password_pepper="p" * 48,
        redis_url="redis://localhost:6379/0",
        database_url="postgresql+asyncpg://tibex:" + "d" * 24 + "@localhost:5432/tibex",
        allowed_origins=["https://clinic.tibex.uz"],
        cookie_secure=True,
    )
    with pytest.raises(ValueError, match="demo reset"):
        Settings(**base, demo_reset_code="this-is-a-demo-reset-code")
    with pytest.raises(ValueError, match="bir-biridan"):
        Settings(**{**base, "password_pepper": "s" * 48})


@pytest.mark.asyncio
async def test_auth_alert_counter_never_blocks_at_global_phone_or_login_limit(monkeypatch):
    from app import config
    from app.security import rate_limit

    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(is_prod=False))
    for attempt in range(101):
        count = await rate_limit.observe("test:global-observe", window=3600)
        assert count == attempt + 1


@pytest.mark.asyncio
async def test_observe_uses_atomic_fixed_window_expiration(monkeypatch):
    from app import config
    from app.security import rate_limit

    class FakeRedis:
        async def eval(self, script, numkeys, key, window):
            assert "if count == 1" in script
            assert numkeys == 1 and key == "test:fixed-window" and window == 60
            return 7

    monkeypatch.setattr(rate_limit, "get_redis", lambda: FakeRedis())
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(is_prod=True))
    assert await rate_limit.observe("test:fixed-window", window=60) == 7


def test_crypto_key_ring_rotation_and_decryption_errors(monkeypatch):
    import base64
    from app.security.crypto import DecryptionError, EncryptedJSON, EncryptedString, _ring

    old, new = b"o" * 32, b"n" * 32
    monkeypatch.setattr(_ring, "_keys", {"1": old, "2": new})
    monkeypatch.setattr(_ring, "active_id", "2")
    # Key ring authenticates old-key ciphertext while creating new-key values.
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = __import__("os").urandom(12)
    ciphertext = AESGCM(old).encrypt(nonce, b"legacy", b"1|patients.phone_enc")
    old_token = "1:" + base64.b64encode(nonce + ciphertext).decode()
    assert _ring.decrypt(old_token, "patients.phone_enc") == "legacy"
    legacy_nonce = __import__("os").urandom(12)
    legacy_ciphertext = AESGCM(old).encrypt(legacy_nonce, b"old-aad", b"1")
    legacy_token = "1:" + base64.b64encode(legacy_nonce + legacy_ciphertext).decode()
    assert _ring.decrypt_legacy_aad(legacy_token, "patients.phone_enc") == "old-aad"
    new_token = EncryptedString(context="patients.phone_enc").process_bind_param("new", None)
    assert new_token.startswith("2:")
    assert EncryptedString(context="patients.phone_enc").process_result_value(new_token, None) == "new"

    encrypted_json = EncryptedJSON(context="appointments.vitals")
    token = encrypted_json.process_bind_param({"bp": "120/80"}, None)
    assert encrypted_json.process_result_value(token, None) == {"bp": "120/80"}
    with pytest.raises(DecryptionError):
        _ring.decrypt("99:" + base64.b64encode(b"x" * 40).decode(), "any")
    with pytest.raises(DecryptionError):
        EncryptedString(context="patients.phone_enc").process_result_value("bad", None)


def test_crypto_key_ring_loads_stable_ids_from_file(monkeypatch, tmp_path):
    import base64
    import json
    from types import SimpleNamespace
    from app import config
    from app.security.crypto import _ring

    key1, key2 = b"1" * 32, b"2" * 32
    ring_file = tmp_path / "ring.json"
    ring_file.write_text(json.dumps({
        "1": base64.b64encode(key1).decode(),
        "2": base64.b64encode(key2).decode(),
    }))
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(
        master_keys_file=str(ring_file), master_active_key_id="2", master_key_b64="unused",
    ))
    monkeypatch.setattr(_ring, "_keys", None)
    _ring._ensure()
    assert _ring.active_id == "2"
    assert _ring._keys == {"1": key1, "2": key2}


def test_invalid_active_key_does_not_leave_partial_keyring(monkeypatch, tmp_path):
    import base64
    import json
    from types import SimpleNamespace
    from app import config
    from app.security.crypto import _ring

    settings = SimpleNamespace(
        master_keys_file=str(tmp_path / "keys.json"),
        master_active_key_id="missing",
        master_key_b64="unused",
    )
    (tmp_path / "keys.json").write_text(json.dumps({"1": base64.b64encode(b"z" * 32).decode()}))
    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr(_ring, "_keys", None)
    with pytest.raises(ValueError, match="Faol master kalit"):
        _ring._ensure()
    assert _ring._keys is None
    with pytest.raises(ValueError, match="Faol master kalit"):
        _ring._ensure()

    settings.master_active_key_id = "1"
    _ring._ensure()
    assert _ring.active_id == "1"


@pytest.mark.asyncio
async def test_password_change_rate_limit_is_five_per_hour(monkeypatch):
    from app import config
    from app.security import rate_limit

    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(is_prod=False))
    for _ in range(5):
        await rate_limit.hit("test:pwchange:user", limit=5, window=3600)
    with pytest.raises(HTTPException) as exc:
        await rate_limit.hit("test:pwchange:user", limit=5, window=3600)
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_admin_unlock_clears_lock_without_changing_password(monkeypatch):
    from app.routers import users

    target = SimpleNamespace(id=8, failed_attempts=5, locked_until=datetime.now(timezone.utc))

    class Result:
        def scalar_one_or_none(self):
            return target

    class FakeDB:
        async def execute(self, _statement):
            return Result()

        async def flush(self):
            return None

    async def allow_actor(*_args, **_kwargs):
        return None

    async def no_audit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(users, "_check_user_modification", allow_actor)
    monkeypatch.setattr(users, "log_action", no_audit)
    actor = SimpleNamespace(id=1, fullname="Admin", role_key="admin")
    result = await users.unlock_user(
        8, _http_request(), FakeDB(), actor, SimpleNamespace(permissions={})
    )
    assert result == {"ok": True}
    assert target.failed_attempts == 0
    assert target.locked_until is None


@pytest.mark.asyncio
async def test_websocket_manager_limits_per_user_and_closes_revoked_jti():
    from app.realtime import WSManager

    class FakeWebSocket:
        def __init__(self):
            self.accepted = False
            self.closed = []

        async def accept(self):
            self.accepted = True

        async def close(self, code, reason=""):
            self.closed.append((code, reason))

    manager = WSManager()
    sockets = [FakeWebSocket() for _ in range(6)]
    for ws in sockets[:5]:
        assert await manager.connect(ws, user_id=42, jti="session-a")
    assert not await manager.connect(sockets[5], user_id=42, jti="session-b")
    assert not sockets[5].accepted

    await manager.revoke_session("session-a")
    assert all(ws.closed == [(4401, "Session revoked")] for ws in sockets[:5])


def test_environment_name_is_normalized_and_allowlisted():
    from app.config import Settings

    common = dict(
        secret_key="s" * 48,
        master_key_b64="m" * 48,
        blind_index_key_b64="b" * 48,
        password_pepper="p" * 48,
    )
    assert Settings(**common, env=" TEST ").env == "test"
    with pytest.raises(ValueError, match="TIBEX_ENV"):
        Settings(**common, env="developement")


def test_nginx_overwrites_client_supplied_forwarded_for():
    from pathlib import Path

    nginx = Path(__file__).resolve().parents[1] / "deploy" / "nginx.conf"
    content = nginx.read_text(encoding="utf-8")
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in content
    assert "$proxy_add_x_forwarded_for" not in content


def test_packaged_cli_entrypoints_resolve_to_sync_functions():
    import importlib
    import inspect
    import tomllib

    project = Path(__file__).resolve().parents[1] / "pyproject.toml"
    entry_points = tomllib.loads(project.read_text(encoding="utf-8"))["project"]["scripts"]
    for target in entry_points.values():
        module_name, function_name = target.split(":", maxsplit=1)
        function = getattr(importlib.import_module(module_name), function_name)
        assert callable(function)
        assert not inspect.iscoroutinefunction(function)


@pytest.mark.parametrize("url", ["https://clinic.example", "http://192.0.2.10:8000", "http://user@localhost:8000"])
def test_simulation_runner_rejects_remote_or_credentialed_target(url):
    from scripts.clinic_simulation import _loopback_base_url

    with pytest.raises(ValueError):
        _loopback_base_url(url)


def test_payment_and_refund_schemas_reject_malformed_financial_values():
    from pydantic import ValidationError
    from app.routers.payments import PaymentIn, RefundIn

    with pytest.raises(ValidationError):
        PaymentIn(appointment_id=1, patient_id=2, amount=0)
    with pytest.raises(ValidationError):
        PaymentIn(appointment_id=1, patient_id=2, amount=100, discount_percent=101)
    with pytest.raises(ValidationError):
        PaymentIn(appointment_id=1, patient_id=2, amount=100, method="wire")
    with pytest.raises(ValidationError):
        RefundIn(payment_id=1, patient_id=2, amount=100, reason="  ")
    with pytest.raises(ValidationError):
        RefundIn(payment_id=1, patient_id=2, amount=100, reason="refund", method="crypto")


def test_csv_export_neutralizes_formula_prefix_but_keeps_numeric_values():
    from app.routers.export import _csv

    response = _csv([["=1+1", "  @SUM(A1)", -150], ["normal", "+cmd", "-not-number"]], "check.xlsx")
    body = response.body.decode("utf-8-sig")
    assert "'=1+1" in body
    assert "'  @SUM(A1)" in body
    assert "-150" in body
    assert "'+cmd" in body
    assert "'-not-number" in body


def test_html_report_escapes_untrusted_title_and_nonce():
    from app.routers.export import _html_report

    response = _html_report('<img src=x onerror="alert(1)">', "<p>ok</p>", 'x" onload="alert(1)')
    body = response.body.decode("utf-8")
    assert "<img src=x" not in body
    assert "&lt;img" in body
    assert 'nonce="x&quot; onload=&quot;alert(1)"' in body


def test_rbac_unknown_permissions_default_to_deny():
    from app.security.rbac import has_permission

    assert not has_permission(None, "payments", "refund")
    assert not has_permission(["payments.view"], "payments", "refund")
    assert has_permission(["payments.refund"], "payments", "refund")
    assert has_permission("*", "payments", "refund")


def test_terminal_appointment_and_lab_states_cannot_be_reopened():
    from app.state_machine import validate_appointment_transition, validate_lab_transition

    ok, _ = validate_appointment_transition("completed", "in_progress", actor_role="admin")
    assert not ok
    ok, _ = validate_lab_transition("verified", "processing")
    assert not ok


def test_vat_breakdown_matches_inclusive_amount():
    from app.routers.payments import _vat_breakdown

    assert _vat_breakdown(150_000) == {"rate": 12, "amount": 16_071, "base": 133_929}


@pytest.mark.asyncio
async def test_admin_cli_rejects_weak_password_before_database_access(capsys):
    from scripts.create_admin import create

    assert not await create("admin", "weak", "Administrator")
    assert "kamida 10" in capsys.readouterr().out
