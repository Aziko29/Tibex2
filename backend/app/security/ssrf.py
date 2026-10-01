"""SSRF himoyasi + integratsiya ulanishini tekshirish.

Oddiy turlar: faqat public https://.
`device` turi (HL7 analizator va h.k.): https://, http://, tcp://, mllp:// va
sozlangan LAN diapazonlari (TIBEX_INTEGRATION_LAN_CIDRS). Loopback, link-local
(169.254.x.x — bulut metadata), multicast, unspecified va login/parolli URL har
doim bloklanadi.

Ulanish tekshiruvi (`check_connectivity`) resolve qilingan IP ga to'g'ridan-to'g'ri
ulanadi (DNS rebinding'dan himoya), Host/SNI alohida beriladi.
"""
import asyncio
import ipaddress
import socket
import ssl
from dataclasses import dataclass
from urllib.parse import urlparse

PUBLIC_SCHEMES = {"https"}
DEVICE_SCHEMES = {"https", "http", "tcp", "mllp"}
DEFAULT_PORTS = {"https": 443, "http": 80}
CONNECT_TIMEOUT = 5.0


@dataclass(frozen=True)
class Target:
    url: str
    scheme: str
    host: str
    port: int
    ips: tuple[str, ...]


def _parse_ip(ip_str: str):
    try:
        ip = ipaddress.ip_address(ip_str.split("%", 1)[0])
    except ValueError:
        return None
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip


def _is_public(ip_str: str) -> bool:
    ip = _parse_ip(ip_str)
    if ip is None:
        return False
    # is_global: 100.64/10, 198.18/15, 192.0.0.0/24 va boshqa maxsus diapazonlarni ham qamraydi
    return ip.is_global and not ip.is_multicast


def _always_blocked(ip) -> bool:
    return (
        ip.is_loopback or ip.is_link_local or ip.is_multicast
        or ip.is_unspecified or ip.is_reserved
    )


def lan_networks() -> list:
    """Sozlamadagi LAN diapazonlari. Faqat xususiy (private) tarmoqlar qabul qilinadi."""
    from ..config import get_settings

    raw = (get_settings().integration_lan_cidrs or "").strip()
    nets = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            net = ipaddress.ip_network(part, strict=False)
        except ValueError:
            continue
        if net.version == 4 and net.is_private and not (
            net.is_loopback or net.is_link_local or net.is_unspecified
        ):
            nets.append(net)
    return nets


def _is_allowed_lan(ip_str: str) -> bool:
    ip = _parse_ip(ip_str)
    if ip is None or _always_blocked(ip):
        return False
    return any(ip in net for net in lan_networks() if net.version == ip.version)


def _validate_sync(url: str, device: bool) -> Target:
    p = urlparse(url)
    schemes = DEVICE_SCHEMES if device else PUBLIC_SCHEMES
    scheme = (p.scheme or "").lower()
    if scheme not in schemes:
        if device:
            raise ValueError("Qurilma uchun https://, http://, tcp:// yoki mllp:// manzil kerak")
        raise ValueError("Faqat https:// manzillarga ruxsat berilgan")
    if p.username is not None or p.password is not None:
        raise ValueError("URL ichida login/parol bo'lishi mumkin emas")
    if not p.hostname:
        raise ValueError("URL xost qismi topilmadi")
    try:
        port = p.port or DEFAULT_PORTS.get(scheme)
    except ValueError:
        raise ValueError("Port noto'g'ri") from None
    if not port:
        raise ValueError("Port ko'rsatilishi shart (masalan tcp://192.168.1.20:2575)")
    try:
        infos = socket.getaddrinfo(p.hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ValueError(f"Xost aniqlanmadi: {p.hostname}") from exc
    ips: list[str] = []
    for info in infos:
        ip = info[4][0]
        if _is_public(ip) or (device and _is_allowed_lan(ip)):
            if ip not in ips:
                ips.append(ip)
            continue
        raise ValueError("Ichki/xususiy IP manzil bloklangan")
    if not ips:
        raise ValueError("Xost aniqlanmadi")
    return Target(url=url, scheme=scheme, host=p.hostname, port=port, ips=tuple(ips))


async def resolve_target(url: str, type_: str = "other") -> Target:
    device = str(type_ or "").lower() == "device"
    return await asyncio.to_thread(_validate_sync, url, device)


async def validate_integration_url(url: str, type_: str = "other") -> str:
    await resolve_target(url, type_)
    return url


async def validate_https_url(url: str) -> str:
    """Orqaga moslik: faqat public https:// manzillarni o'tkazadi."""
    await resolve_target(url, "other")
    return url


async def check_connectivity(url: str, type_: str = "other") -> tuple[bool, str | None]:
    """Tekshirilgan IP ga TCP (https bo'lsa TLS) ulanishini sinaydi. HL7 muloqoti emas."""
    try:
        target = await resolve_target(url, type_)
    except ValueError as exc:
        return False, str(exc)
    last_err = "Ulanib bo'lmadi"
    for ip in target.ips:
        writer = None
        try:
            kwargs = {}
            if target.scheme == "https":
                kwargs = {"ssl": ssl.create_default_context(), "server_hostname": target.host}
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, target.port, **kwargs), CONNECT_TIMEOUT
            )
            return True, None
        except asyncio.TimeoutError:
            last_err = "Ulanish vaqti tugadi"
        except ssl.SSLError as exc:
            last_err = f"TLS xatosi: {exc.reason or exc}"
        except OSError as exc:
            last_err = f"Ulanib bo'lmadi: {exc.strerror or exc}"
        finally:
            if writer is not None:
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
    return False, last_err
