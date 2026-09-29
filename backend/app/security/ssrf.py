"""SSRF himoyasi.

DIQQAT: bu yerda faqat *oldindan* tekshiruv bor. Agar kelajakda server shu URL'ga
so'rov yuborsa, DNS rebinding'dan himoya uchun IP'ni **ulanish paytida** qayta
tekshirish shart (masalan, resolve qilingan IP'ga to'g'ridan-to'g'ri ulanib,
Host/SNI'ni alohida berish yoki custom transport bilan).
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlparse


def _is_public(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str.split("%", 1)[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    # is_global: 100.64/10, 198.18/15, 192.0.0.0/24 va boshqa maxsus diapazonlarni ham qamraydi
    return ip.is_global and not ip.is_multicast


def _validate_sync(url: str) -> str:
    p = urlparse(url)
    if p.scheme != "https":
        raise ValueError("Faqat https:// manzillarga ruxsat berilgan")
    if not p.hostname:
        raise ValueError("URL xost qismi topilmadi")
    port = p.port or 443
    try:
        infos = socket.getaddrinfo(p.hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ValueError(f"Xost aniqlanmadi: {p.hostname}") from exc
    for info in infos:
        if not _is_public(info[4][0]):
            raise ValueError("Ichki/xususiy IP manzil bloklangan")
    return url


async def validate_https_url(url: str) -> str:
    """Faqat public https:// manzillarni o'tkazadi (DNS event loop'ni bloklamaydi)."""
    return await asyncio.to_thread(_validate_sync, url)
