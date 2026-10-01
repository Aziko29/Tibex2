"""Local-only middleware regressiya testlari.

TIBEX_PATIENT_PUBLIC_ACCESS_v1: bemor yo'llari (`/api/otp/*`,
`/api/portal/*`) `patient_web_access=True` bo'lganda tashqi IP'dan ham
o'tadi; xodim yo'llari (`/api/auth/login`, `/api/users`, ...) esa baribir
FAQAT LAN'dan ishlaydi.
"""
from __future__ import annotations

import pytest
from starlette.types import Message

from app.security import local_only as lo


# ─── 0) Test helperlari ───

def _settings(enabled: bool, patient_open: bool = True, trust_cf: bool = False):
    """Test uchun yengil sozlamalar obyekti (Pydantic emas)."""
    return type(
        "S", (),
        {"local_only_enabled": enabled, "patient_web_access": patient_open,
         "trust_cf_connecting_ip": trust_cf},
    )()


# ─── 1) Yo'l normalizatsiyasi ───

@pytest.mark.parametrize("raw,expected_path,expected_valid", [
    ("/api/health", "/api/health", True),
    ("/API/Health", "/api/health", True),
    ("//api///health", "/api/health", True),
    ("/api/./health", "/api/health", True),
    ("/api/%2e/health", "/api/health", True),
    ("/a\\b/c", "/a/b/c", True),
    ("/api/health/extra", "/api/health/extra", True),
    ("", "/", True),
    (None, "/", True),
    # `..` — rad etiladi (drop emas)
    ("/a/../b", "/", False),
    ("/api/health/../patients", "/", False),
    ("/api/%2e%2e/patients", "/", False),
    ("/../../etc/passwd", "/", False),
])
def test_normalize_path(raw, expected_path, expected_valid):
    path, valid = lo._normalize_path(raw)
    assert path == expected_path
    assert valid is expected_valid


def test_double_encoded_dot_is_not_decoded_twice():
    """`%252e%252e` bir marta unquote → `%2e%2e` — bu `..` deb talqin qilinmasin."""
    path, valid = lo._normalize_path("/api/%252e%252e/health")
    assert valid is True
    assert path == "/api/%2e%2e/health"  # literal `%2e%2e` segment


# ─── 2) Chegarali prefiks ───

@pytest.mark.parametrize("path,prefix,expected", [
    ("/api/health", "/api/health", True),
    ("/api/health/", "/api/health", True),
    ("/api/health/x", "/api/health", True),
    ("/api/healthcheck", "/api/health", False),
    ("/api/hea", "/api/health", False),
    ("/", "/api/health", False),
])
def test_has_bounded_prefix(path, prefix, expected):
    assert lo._has_bounded_prefix(path, prefix) is expected


# ─── 3) Local IP aniqlash ───

@pytest.mark.parametrize("ip,expected", [
    ("127.0.0.1", True),
    ("::1", True),
    ("::ffff:127.0.0.1", True),   # IPv4-mapped
    ("10.1.2.3", True),
    ("192.168.1.1", True),
    ("172.16.0.1", True),
    ("172.31.255.255", True),     # yuqori chegara
    ("172.15.255.255", False),    # pastdagi chegara tashqarisida
    ("172.32.0.1", False),        # yuqoridagi chegara tashqarisida
    ("100.64.0.1", True),         # CGNAT
    ("169.254.1.1", True),
    ("8.8.8.8", False),
    ("2001:db8::1", False),
    (None, False),
    ("", False),
    ("not-an-ip", False),
])
def test_is_local_ip(ip, expected):
    assert lo._is_local_ip(ip) is expected


# ─── 4) Klient IP resolution ───

def test_forwarded_ignored_from_untrusted_peer():
    headers = {"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8"}
    ip, tunneled = lo._resolve_client_ip("203.0.113.9", headers)
    assert ip == "203.0.113.9"
    assert tunneled is False


def test_cf_header_trusted_from_local_peer():
    ip, tunneled = lo._resolve_client_ip("127.0.0.1", {"cf-connecting-ip": "1.2.3.4"}, trust_cf=True)
    assert ip == "1.2.3.4"
    assert tunneled is True


def test_cf_priority_over_xff():
    headers = {"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9"}
    ip, tunneled = lo._resolve_client_ip("10.0.0.5", headers, trust_cf=True)
    assert ip == "1.2.3.4"
    assert tunneled is True


def test_xff_last_token_trusted_from_local_peer():
    ip, tunneled = lo._resolve_client_ip("10.0.0.5", {"x-forwarded-for": "1.2.3.4, 5.6.7.8"})
    assert ip == "5.6.7.8"
    assert tunneled is True


def test_malformed_xff_falls_back_to_peer():
    ip, tunneled = lo._resolve_client_ip("10.0.0.5", {"x-forwarded-for": "garbage"})
    assert ip == "10.0.0.5"
    assert tunneled is False


def test_no_peer_returns_none():
    ip, tunneled = lo._resolve_client_ip(None, {})
    assert ip is None
    assert tunneled is False


# ─── 5) Middleware end-to-end ───

async def _echo_app(scope, receive, send):
    if scope["type"] == "http":
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})
    elif scope["type"] == "websocket":
        await send({"type": "websocket.accept"})
        await send({"type": "websocket.close", "code": 1000})


async def _noop_receive():
    return {"type": "http.request", "body": b"", "more_body": False}


def _scope(kind: str, path: str, peer: str | None, headers: dict | None = None):
    return {
        "type": kind,
        "method": "GET" if kind == "http" else None,
        "path": path,
        "headers": [(k.encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (peer, 12345) if peer else None,
        "query_string": b"",
        "scheme": "http",
        "server": ("test", 80),
    }


class _Collector:
    def __init__(self) -> None:
        self.messages: list[Message] = []

    async def __call__(self, msg: Message) -> None:
        self.messages.append(msg)


@pytest.mark.asyncio
async def test_local_peer_allowed(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/patients", "127.0.0.1"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 200


@pytest.mark.asyncio
async def test_docker_gateway_is_local(monkeypatch):
    """Docker bridge (172.17.0.1) — local; cloudflared shu peer bilan keladi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/patients", "172.17.0.1"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 200


@pytest.mark.asyncio
async def test_remote_peer_denied_http_404(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/patients", "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 404
    assert b"Not Found" in send.messages[1]["body"]
    headers = dict(send.messages[0]["headers"])
    assert headers[b"x-content-type-options"] == b"nosniff"
    assert headers[b"cache-control"] == b"no-store"


@pytest.mark.asyncio
async def test_remote_peer_denied_ws_close_4404(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("websocket", "/api/ws", "203.0.113.9"), _noop_receive, send
    )
    assert send.messages == [
        {"type": "websocket.close", "code": 4404, "reason": "Not Found"}
    ]


@pytest.mark.asyncio
async def test_health_endpoint_always_allowed(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/health", "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 200


@pytest.mark.asyncio
async def test_telegram_webhook_always_allowed(monkeypatch):
    """Telegram serverlari tashqi IP'dan keladi — o'z secret-token himoyasi bor."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/telegram/webhook", "149.154.167.220"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 200


@pytest.mark.asyncio
async def test_health_prefix_is_bounded(monkeypatch):
    """`/api/healthcheck` — ochiq emas, rad etiladi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/healthcheck", "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 404


@pytest.mark.asyncio
async def test_dotdot_path_is_denied_for_local_peer_too(monkeypatch):
    """`..` uchragan yo'l — hatto local peer uchun ham rad etiladi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/health/../patients", "127.0.0.1"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 404


@pytest.mark.asyncio
async def test_disabled_passes_everything(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(False, patient_open=False))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/patients", "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 200


@pytest.mark.asyncio
async def test_lifespan_scope_passes_through(monkeypatch):
    """`lifespan` va boshqa non-http/ws scope'lar tegilmaydi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True))
    called = {"hit": False}

    async def app(scope, receive, send):
        called["hit"] = True

    await lo.LocalOnlyMiddleware(app)(
        {"type": "lifespan"}, _noop_receive, _Collector()
    )
    assert called["hit"] is True


# ─── 6) Log throttle ───

def test_denial_log_is_rate_limited(monkeypatch, caplog):
    lo._deny_log_last.clear()
    with caplog.at_level("INFO", logger="tibex.local_only"):
        for _ in range(100):
            lo._log_denied("http", "203.0.113.9", "203.0.113.9", "/x")
    assert len([r for r in caplog.records if "denied" in r.getMessage()]) == 1


def test_denial_log_per_client(monkeypatch, caplog):
    lo._deny_log_last.clear()
    with caplog.at_level("INFO", logger="tibex.local_only"):
        lo._log_denied("http", "172.17.0.1", "1.1.1.1", "/x")
        lo._log_denied("http", "172.17.0.1", "2.2.2.2", "/x")
    assert len([r for r in caplog.records if "denied" in r.getMessage()]) == 2


def test_denial_log_truncates_and_sanitizes_path(caplog):
    lo._deny_log_last.clear()
    with caplog.at_level("INFO", logger="tibex.local_only"):
        lo._log_denied("http", "1.1.1.1", "1.1.1.1", "/x\n" * 5000)
    msg = caplog.records[0].getMessage()
    assert "\n" not in msg
    assert len(msg) < 500
    assert "cookie" not in msg.lower()
    assert "authorization" not in msg.lower()


# ─── 7) announce_once idempotentligi ───

def test_announce_once_is_idempotent(monkeypatch, caplog):
    lo._announced = False
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    with caplog.at_level("INFO", logger="tibex.local_only"):
        lo.announce_once()
        lo.announce_once()
        lo.announce_once()
    assert len(caplog.records) == 1


def test_announce_once_warns_when_disabled(monkeypatch, caplog):
    lo._announced = False
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(False, patient_open=False))
    with caplog.at_level("WARNING", logger="tibex.local_only"):
        lo.announce_once()
    assert any(r.levelname == "WARNING" for r in caplog.records)


# ─── 8) TIBEX_PATIENT_PUBLIC_ACCESS_v1 — yangi regressiyalar ───


# Bemor yo'llari — patient_web_access=True bo'lganda tashqi IP'dan o'tadi.
_PATIENT_PATHS = (
    "/api/otp/request",
    "/api/otp/verify",
    "/api/otp/admin-issue",
    "/api/portal/me",
    "/api/portal/summary",
    "/api/portal/appointments",
    "/api/portal/lab-orders",
    "/api/portal/payments",
    "/api/portal/telegram/status",
    "/api/telegram/bot-info",
    "/api/auth/me",
    "/api/auth/logout",
)


@pytest.mark.asyncio
@pytest.mark.parametrize("path", _PATIENT_PATHS)
async def test_patient_paths_open_from_public_ip_when_enabled(monkeypatch, path):
    """Bemor yo'llari internetdan ham ishlaydi (patient_web_access=True)."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", path, "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 200, path


@pytest.mark.asyncio
@pytest.mark.parametrize("path", _PATIENT_PATHS)
async def test_patient_paths_blocked_when_flag_off(monkeypatch, path):
    """patient_web_access=False — bemor yo'llari ham yopiq."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=False))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", path, "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 404, path


# Xodim yo'llari — patient_web_access qiymatidan QAT'I NAZAR, faqat LAN.
_STAFF_PATHS = (
    "/api/auth/login",              # xodim login (bemor login emas!)
    "/api/auth/change-password",
    "/api/users",
    "/api/users/1/admin-reset-password",
    "/api/roles",
    "/api/patients",
    "/api/appointments",
    "/api/lab-orders",
    "/api/payments",
    "/api/refunds",
    "/api/shift",
    "/api/shift/close",
    "/api/audit",
    "/api/audit/verify",
    "/api/settings",
    "/api/doctors",
    "/api/services",
    "/api/equipment",
    "/api/reagents",
    "/api/integrations",
    "/api/bootstrap",
    "/api/monitoring/health",
    "/api/monitoring/errors",
    "/api/monitoring/alerts",
    "/api/monitoring/threat-map",
    "/api/export/payments.xlsx",
    "/api/export/all.json",
    "/api/admin/demo-reset",
    "/api/camera/session",
    "/api/security/csp-report",
)


@pytest.mark.asyncio
@pytest.mark.parametrize("path", _STAFF_PATHS)
@pytest.mark.parametrize("patient_open", [True, False])
async def test_staff_paths_blocked_from_public_ip(monkeypatch, path, patient_open):
    """Xodim endpointlari internetdan DOIM 404 (patient flag mustaqil)."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=patient_open))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", path, "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0]["status"] == 404, f"{path} (patient_open={patient_open})"


@pytest.mark.asyncio
async def test_staff_paths_allowed_from_local_ip(monkeypatch):
    """Xodim yo'llari LAN'dan (peer 127.0.0.1) baribir ishlaydi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    for path in ("/api/auth/login", "/api/users", "/api/audit", "/api/bootstrap"):
        send = _Collector()
        await lo.LocalOnlyMiddleware(_echo_app)(
            _scope("http", path, "127.0.0.1"), _noop_receive, send
        )
        assert send.messages[0]["status"] == 200, path


@pytest.mark.asyncio
async def test_ws_blocked_from_public_ip_even_when_patient_open(monkeypatch):
    """WebSocket har doim local-only — bemor flag ta'sir qilmaydi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("websocket", "/api/ws", "203.0.113.9"), _noop_receive, send
    )
    assert send.messages[0] == {
        "type": "websocket.close", "code": 4404, "reason": "Not Found"
    }


@pytest.mark.asyncio
async def test_patient_path_prefix_is_bounded(monkeypatch):
    """`/api/otp-evil` — bemor yo'li emas, 404 bo'lishi kerak."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    for path in ("/api/otpevil", "/api/portals", "/api/otp-injection"):
        send = _Collector()
        await lo.LocalOnlyMiddleware(_echo_app)(
            _scope("http", path, "203.0.113.9"), _noop_receive, send
        )
        assert send.messages[0]["status"] == 404, path


@pytest.mark.asyncio
async def test_cloudflared_peer_cf_header_opens_patient(monkeypatch):
    """Cloudflare Tunnel: peer=172.17.0.1 (docker), cf-ip=1.2.3.4 → bemor yo'li ochiq."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True, trust_cf=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/portal/me", "172.17.0.1",
               headers={"cf-connecting-ip": "1.2.3.4"}),
        _noop_receive, send,
    )
    assert send.messages[0]["status"] == 200


@pytest.mark.asyncio
async def test_cloudflared_peer_cf_header_blocks_staff(monkeypatch):
    """Cloudflare Tunnel orqali xodim endpointi 404 (haqiqiy klient 1.2.3.4 tashqi)."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True, trust_cf=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/users", "172.17.0.1",
               headers={"cf-connecting-ip": "1.2.3.4"}),
        _noop_receive, send,
    )
    assert send.messages[0]["status"] == 404


# ─── TIBEX_CF_HEADER_TRUST_v1: nginx orqasida Cf-Connecting-Ip soxtalashtirish ───

@pytest.mark.asyncio
@pytest.mark.parametrize("spoofed", ["192.168.1.10", "10.0.0.5", "127.0.0.1", "not-an-ip"])
@pytest.mark.parametrize("path", ["/api/auth/login", "/api/users", "/api/patients", "/api/ws"])
async def test_spoofed_cf_header_behind_nginx_does_not_open_staff(monkeypatch, path, spoofed):
    """peer=127.0.0.1 (nginx), XFF=tashqi klient, soxta Cf-Connecting-Ip=LAN → 404."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", path, "127.0.0.1",
               headers={"x-forwarded-for": "203.0.113.9", "cf-connecting-ip": spoofed}),
        _noop_receive, send,
    )
    assert send.messages[0]["status"] == 404, (path, spoofed)


@pytest.mark.asyncio
async def test_cf_header_without_trust_is_fail_closed_even_without_xff(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/auth/login", "172.17.0.1",
               headers={"cf-connecting-ip": "192.168.1.10"}),
        _noop_receive, send,
    )
    assert send.messages[0]["status"] == 404


@pytest.mark.asyncio
async def test_lan_staff_via_nginx_still_allowed(monkeypatch):
    """Xodim LAN'da: nginx XFF=192.168.1.20 qo'yadi, Cf header yo'q → o'tadi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/auth/login", "127.0.0.1",
               headers={"x-forwarded-for": "192.168.1.20"}),
        _noop_receive, send,
    )
    assert send.messages[0]["status"] == 200


@pytest.mark.asyncio
async def test_patient_paths_still_open_behind_nginx(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    for path in ("/api/otp/request", "/api/portal/me"):
        send = _Collector()
        await lo.LocalOnlyMiddleware(_echo_app)(
            _scope("http", path, "127.0.0.1", headers={"x-forwarded-for": "203.0.113.9"}),
            _noop_receive, send,
        )
        assert send.messages[0]["status"] == 200, path


# ─── TIBEX_TUNNEL_REALIP_v1: tunnel trafigi lokal bo'lib ko'rinmasin ───

def test_tunnel_flag_with_local_client_is_fail_closed():
    """nginx realip ishlamadi: XFF=127.0.0.1, lekin so'rov tunnel orqali kelgan."""
    headers = {"x-forwarded-for": "127.0.0.1", "x-tibex-tunnel": "1"}
    ip, tunneled = lo._resolve_client_ip("127.0.0.1", headers)
    assert ip == "0.0.0.0"
    assert lo._is_local_ip(ip) is False


def test_tunnel_flag_with_public_client_keeps_real_ip():
    headers = {"x-forwarded-for": "203.0.113.9", "x-tibex-tunnel": "1"}
    ip, tunneled = lo._resolve_client_ip("127.0.0.1", headers)
    assert ip == "203.0.113.9"
    assert tunneled is True


def test_no_tunnel_flag_lan_client_still_local():
    ip, _ = lo._resolve_client_ip("127.0.0.1", {"x-forwarded-for": "192.168.1.20", "x-tibex-tunnel": "0"})
    assert ip == "192.168.1.20"
    assert lo._is_local_ip(ip) is True


def test_invalid_cf_header_in_trust_mode_is_fail_closed():
    ip, _ = lo._resolve_client_ip("127.0.0.1", {"cf-connecting-ip": "garbage"}, trust_cf=True)
    assert ip == "0.0.0.0"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/auth/login", "/api/users", "/api/patients", "/api/ws"])
@pytest.mark.parametrize("xff", ["127.0.0.1", "172.17.0.1", "192.168.1.10", "::1"])
async def test_tunnel_traffic_seen_as_local_is_denied(monkeypatch, path, xff):
    """Asosiy xato: cloudflared -> nginx bo'lganda XFF=127.0.0.1 bo'lib, tashqi klient
    xodim API'siga o'tib ketardi. Endi nginx belgilagan tunnel so'rovi rad etiladi."""
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    send = _Collector()
    kind = "websocket" if path == "/api/ws" else "http"
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope(kind, path, "127.0.0.1",
               headers={"x-forwarded-for": xff, "x-tibex-tunnel": "1"}),
        _noop_receive, send,
    )
    assert send.messages[0].get("status", send.messages[0].get("code")) in (404, 4404), (path, xff)


@pytest.mark.asyncio
async def test_tunnel_public_client_reaches_patient_paths_only(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    hdrs = {"x-forwarded-for": "203.0.113.9", "x-tibex-tunnel": "1"}
    for path, expected in (("/api/portal/me", 200), ("/api/otp/request", 200),
                           ("/api/auth/login", 404), ("/api/users", 404)):
        send = _Collector()
        await lo.LocalOnlyMiddleware(_echo_app)(
            _scope("http", path, "127.0.0.1", headers=hdrs), _noop_receive, send
        )
        assert send.messages[0]["status"] == expected, path


@pytest.mark.asyncio
async def test_lan_staff_direct_to_nginx_still_allowed_with_flag_zero(monkeypatch):
    monkeypatch.setattr(lo, "get_settings", lambda: _settings(True, patient_open=True))
    send = _Collector()
    await lo.LocalOnlyMiddleware(_echo_app)(
        _scope("http", "/api/auth/login", "127.0.0.1",
               headers={"x-forwarded-for": "192.168.1.20", "x-tibex-tunnel": "0"}),
        _noop_receive, send,
    )
    assert send.messages[0]["status"] == 200
