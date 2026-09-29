"""Reverse-proxy-aware client IP resolution shared by security and audit code."""
from ipaddress import ip_address, ip_network

from fastapi import Request

from ..config import get_settings


def client_ip(request: Request) -> str | None:
    """Trust X-Forwarded-For only from configured proxies and only as one IP."""
    peer = request.client.host if request.client else None
    if not peer:
        return None

    try:
        peer_ip = ip_address(peer)
    except ValueError:
        return peer

    trusted = False
    for configured in get_settings().trusted_proxy_ips:
        try:
            if peer_ip in ip_network(configured, strict=False):
                trusted = True
                break
        except ValueError:
            continue

    if not trusted:
        return str(peer_ip)

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return str(peer_ip)
    try:
        # nginx overwrites the header with $remote_addr. Reject chains or
        # malformed values instead of trusting the first caller-controlled IP.
        return str(ip_address(forwarded.strip()))
    except ValueError:
        return str(peer_ip)
