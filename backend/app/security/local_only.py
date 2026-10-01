"""Local-only ASGI middleware — default-deny.

TIBEX_PATIENT_PUBLIC_ACCESS_v1:
  Yo'l ikki toifaga bo'linadi:

  1) XODIM trafigi (default: FAQAT lokal):
     /api/auth/login, /api/users, /api/patients, /api/appointments,
     /api/lab-orders, /api/payments, /api/audit, /api/settings,
     /api/roles, /api/monitoring/*, /api/ws va h.k.
     Bu yo'llar faqat local klient IP'laridan o'tadi; boshqalarga 404.

  2) BEMOR trafigi (`patient_web_access=True` bo'lsa ochiq):
     /api/otp/*, /api/portal/*, /api/telegram/bot-info,
     /api/auth/me, /api/auth/logout.
     Bu yo'llar internetdan ham ishlaydi — bemor uydan kira oladi.
     Bemor sessiyasi (`role=patient`) bo'lmasa, himoya `deps.py` va
     `routers/*` darajasida 401/403 beradi; xodim API'lariga bu
     yo'llar orqali kirib bo'lmaydi.

  3) Har doim ochiq (infratuzilma uchun):
     /api/health              — monitoring/health-check
     /api/telegram/webhook    — Telegram serverlari tashqi IP'dan chaqiradi

Pure ASGI. `http` va `websocket` scope'larini bir joyda hal qiladi.
Yo'l normalizatsiya: unquote → `\\`→`/` → `..` (rad etish) → kichik harf
→ chegarali prefiks. Klient IP: `X-Forwarded-For` oxirgi tokeni (nginx uni
`$remote_addr` bilan QAYTA YOZADI; tunnel trafigida nginx realip modul orqali
`Cf-Connecting-Ip` dan haqiqiy IP oladi) — faqat peer local bo'lganda ishonchli.
`X-Tibex-Tunnel: 1` (nginx qo'yadi) bo'lsa, klient LOKAL bo'la olmaydi:
aks holda so'rov fail-closed rad etiladi (TIBEX_TUNNEL_REALIP_v1).
Log rate-limit: bir klient IP/daqiqa uchun ko'pi bilan 1 satr, sirsiz.
"""

from __future__ import annotations

import logging
import time
from ipaddress import ip_address, ip_network
from typing import Any, Iterable
from urllib.parse import unquote

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..config import get_settings

log = logging.getLogger("tibex.local_only")

# ─── Allowlist ───
# Har doim ochiq (infratuzilma). Chegarali prefiks sifatida tekshiriladi.
_PUBLIC_PATH_PREFIXES_ALWAYS: tuple[str, ...] = (
    "/api/health",
    "/api/telegram/webhook",
)

# Bemorga tegishli yo'llar (faqat `patient_web_access=True` bo'lganda).
# Bu ro'yxatga xodim login/API'larini QO'SHMANG.
_PUBLIC_PATH_PREFIXES_PATIENT: tuple[str, ...] = (
    "/api/otp",                 # bemor telefon raqami + OTP oqimi
    "/api/portal",              # bemor kabineti (role=patient)
    "/api/telegram/bot-info",   # bemor-login.html bot username'ini oladi
    "/api/auth/me",             # bemor-login.html sessiyani tekshiradi
    "/api/auth/logout",         # chiqish (bemor sessiyasini bekor qiladi)
)

# "Local" tarmoqlar: loopback, RFC1918, CGNAT, ULA, link-local,
# Docker bridge (172.16/12).
_LOCAL_NETWORKS: tuple[Any, ...] = (
    ip_network("127.0.0.0/8"),
    ip_network("::1/128"),
    ip_network("10.0.0.0/8"),
    ip_network("172.16.0.0/12"),
    ip_network("192.168.0.0/16"),
    ip_network("169.254.0.0/16"),
    ip_network("100.64.0.0/10"),
    ip_network("fc00::/7"),
    ip_network("fe80::/10"),
)

_DENY_LOG_WINDOW_S = 60.0
_DENY_LOG_MAX = 4096
_deny_log_last: dict[str, float] = {}
_announced = False


# ─── Yo'l normalizatsiyasi ───

def _normalize_path(raw: str | None) -> tuple[str, bool]:
    """(kanonik, valid). `..` uchrasa — valid=False (rad etish signali)."""
    if not raw:
        return "/", True
    s = unquote(str(raw), errors="replace").replace("\\", "/")
    parts: list[str] = []
    for p in s.split("/"):
        if not p or p == ".":
            continue
        if p == "..":
            return "/", False
        parts.append(p)
    return ("/" + "/".join(parts)).lower(), True


def _has_bounded_prefix(path: str, prefix: str) -> bool:
    if path == prefix:
        return True
    if prefix.endswith("/"):
        return path.startswith(prefix)
    return path.startswith(prefix + "/")


def _is_public_path(normalized: str) -> bool:
    """Yo'l ochiqmi? Patient yo'llari faqat bayroq yoqilganda ochiq."""
    for prefix in _PUBLIC_PATH_PREFIXES_ALWAYS:
        if _has_bounded_prefix(normalized, prefix):
            return True
    # get_settings() xato bo'lsa (test muhiti), patient yo'llarini yopiq
    # deb hisoblaymiz — fail-closed.
    try:
        patient_open = get_settings().patient_web_access
    except Exception:
        patient_open = False
    if patient_open:
        for prefix in _PUBLIC_PATH_PREFIXES_PATIENT:
            if _has_bounded_prefix(normalized, prefix):
                return True
    return False


# ─── Header / IP yordamchilari ───

def _lower_headers(raw: Iterable[tuple[bytes, bytes]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for name, value in raw:
        try:
            k = name.decode("latin-1").lower()
            v = value.decode("latin-1")
        except Exception:
            continue
        if k not in out:
            out[k] = v
    return out


def _is_local_ip(ip: str | None) -> bool:
    if not ip:
        return False
    try:
        addr = ip_address(ip)
    except ValueError:
        return False
    if addr.version == 6 and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return any(addr in net for net in _LOCAL_NETWORKS)


def _resolve_client_ip(
    peer_ip: str | None, headers: dict[str, str], trust_cf: bool = False
) -> tuple[str | None, bool]:
    """(real_client_ip, tunnel_orqali). Peer local bo'lmasa — peer qaytadi."""
    if not peer_ip:
        return None, False
    try:
        peer = ip_address(peer_ip)
    except ValueError:
        return peer_ip, False

    if not _is_local_ip(str(peer)):
        return str(peer), False

    ip, tunneled = _resolve_via_local_peer(str(peer), headers, trust_cf)

    # TIBEX_TUNNEL_REALIP_v1: nginx so'rov Cloudflare Tunnel orqali kelganini
    # `X-Tibex-Tunnel: 1` bilan belgilaydi (asl so'rovda Cf-Connecting-Ip bor edi).
    # Bunday so'rovning haqiqiy klienti internetda — LOKAL IP bo'la olmaydi.
    # Agar baribir lokal chiqsa (nginx `set_real_ip_from` da cloudflared manzili
    # yo'q, header yaroqsiz va h.k.), tashqi trafik lokal bo'lib ko'rinib qolgan
    # bo'ladi -> fail-closed. Header'ni klient yuborsa ham faqat O'ZIGA zarar
    # qiladi (faqat rad etish tomonga ishlaydi), shuning uchun xavfsiz.
    if headers.get("x-tibex-tunnel", "").strip() == "1" and _is_local_ip(ip):
        return "0.0.0.0", True
    return ip, tunneled


def _resolve_via_local_peer(
    peer_ip: str, headers: dict[str, str], trust_cf: bool
) -> tuple[str, bool]:
    """Peer local (nginx yoki cloudflared): klient IP'ni header'lardan aniqlaydi."""
    # TIBEX_CF_HEADER_TRUST_v1: nginx orqasida Cf-Connecting-Ip soxta bo'lishi
    # mumkin -> faqat `trust_cf_connecting_ip=true` bo'lganda o'qiladi.
    cf = headers.get("cf-connecting-ip", "").strip()
    if cf and not trust_cf:
        # Header bor, lekin unga ishonish yoqilmagan: bu soxta yoki noto'g'ri
        # sozlangan tunnel. Fail-closed — lokal emas deb hisoblaymiz.
        return "0.0.0.0", False
    if cf:
        try:
            return str(ip_address(cf)), True
        except ValueError:
            # Ishonchli rejimda ham yaroqsiz qiymat fail-closed (peer'ga
            # qaytish tashqi klientni lokal qilib yuborar edi).
            return "0.0.0.0", False

    xff = headers.get("x-forwarded-for", "").strip()
    if xff:
        last = xff.split(",")[-1].strip()
        try:
            return str(ip_address(last)), True
        except ValueError:
            return peer_ip, False

    return peer_ip, False


# ─── Javob yordamchilari ───

_HTTP_404_BODY = b'{"detail":"Not Found"}'
_HTTP_404_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"content-type", b"application/json"),
    (b"content-length", str(len(_HTTP_404_BODY)).encode("ascii")),
    (b"x-content-type-options", b"nosniff"),
    (b"cache-control", b"no-store"),
)

_WS_CLOSE_NOT_FOUND = 4404


async def _send_http_404(send: Send) -> None:
    await send({
        "type": "http.response.start",
        "status": 404,
        "headers": list(_HTTP_404_HEADERS),
    })
    await send({"type": "http.response.body", "body": _HTTP_404_BODY, "more_body": False})


async def _send_ws_close_404(send: Send) -> None:
    msg: Message = {
        "type": "websocket.close",
        "code": _WS_CLOSE_NOT_FOUND,
        "reason": "Not Found",
    }
    await send(msg)


# ─── Rate-limited log ───

def _log_denied(kind: str, peer: str | None, client: str | None, path: str) -> None:
    now = time.monotonic()
    key = client or peer or "?"
    last = _deny_log_last.get(key)
    if last is not None and now - last < _DENY_LOG_WINDOW_S:
        return

    if len(_deny_log_last) >= _DENY_LOG_MAX:
        cutoff = now - _DENY_LOG_WINDOW_S
        for k in [k for k, t in _deny_log_last.items() if t < cutoff]:
            _deny_log_last.pop(k, None)
        if len(_deny_log_last) >= _DENY_LOG_MAX:
            for k in list(_deny_log_last)[: _DENY_LOG_MAX // 4]:
                _deny_log_last.pop(k, None)
    _deny_log_last[key] = now

    safe_path = (path or "/")[:200].replace("\n", " ").replace("\r", " ")
    log.info(
        "local_only: denied %s path=%s peer=%s client=%s",
        kind, safe_path, peer or "?", client or "-",
    )


# ─── Middleware ───

class LocalOnlyMiddleware:
    """Pure ASGI. `TIBEX_LOCAL_ONLY_ENABLED=false` bo'lsa — no-op."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        if not get_settings().local_only_enabled:
            await self.app(scope, receive, send)
            return

        raw_path: str = scope.get("path") or "/"
        normalized, valid = _normalize_path(raw_path)

        # 1) Ochiq yo'llar (health, telegram webhook + bemor yo'llari).
        if valid and _is_public_path(normalized):
            await self.app(scope, receive, send)
            return

        # 2) Xodim yo'llari va hamma qolgani — faqat local IP.
        client = scope.get("client")
        peer_ip = client[0] if client else None
        headers = _lower_headers(scope.get("headers") or [])
        try:
            trust_cf = bool(get_settings().trust_cf_connecting_ip)
        except Exception:
            trust_cf = False
        client_ip, _ = _resolve_client_ip(peer_ip, headers, trust_cf)

        if valid and client_ip and _is_local_ip(client_ip):
            await self.app(scope, receive, send)
            return

        # 3) Rad etish.
        _log_denied(scope["type"], peer_ip, client_ip, raw_path)
        if scope["type"] == "websocket":
            await _send_ws_close_404(send)
        else:
            await _send_http_404(send)


# ─── Startup annonsi ───

def announce_once() -> None:
    global _announced
    if _announced:
        return
    _announced = True
    try:
        s = get_settings()
        enabled = s.local_only_enabled
        patient_open = s.patient_web_access
    except Exception:
        log.warning("local_only: settings o'qilmadi; enabled deb hisoblanadi")
        enabled, patient_open = True, False

    if enabled:
        if patient_open:
            log.info(
                "local_only middleware: ENABLED | bemor portali OCHIQ "
                "(/api/otp/*, /api/portal/*, /api/telegram/bot-info, "
                "/api/auth/me, /api/auth/logout) | xodim API'lari FAQAT "
                "local klient IP'laridan | /api/health va "
                "/api/telegram/webhook har doim ochiq"
            )
        else:
            log.info(
                "local_only middleware: ENABLED (default-deny — faqat local "
                "klient IP'lari kira oladi; bemor portali ham yopiq; "
                "/api/health va /api/telegram/webhook har doim ochiq)"
            )
    else:
        log.warning(
            "local_only middleware: DISABLED — ilova har qanday tarmoqdan ochiq"
        )