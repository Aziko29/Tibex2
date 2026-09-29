"""Unauthenticated, size-limited CSP violation collection endpoint."""
import json
import logging
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException, Request, Response, status

from ..security.netutil import client_ip
from ..security.rate_limit import hit

router = APIRouter()
_log = logging.getLogger("tibex.csp")


def _safe(value: object, limit: int = 240) -> str:
    # CSP reports are attacker-controlled. Strip controls and keep logs bounded.
    text = str(value or "")
    return "".join(ch for ch in text if ch.isprintable())[:limit]


@router.post("/csp-report", status_code=status.HTTP_204_NO_CONTENT)
async def csp_report(request: Request) -> Response:
    peer = client_ip(request) or "unknown"
    await hit(f"rl:csp-report:{peer}", limit=60, window=60)
    chunks = bytearray()
    async for chunk in request.stream():
        if len(chunks) + len(chunk) > 16_384:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Report hajmi katta")
        chunks.extend(chunk)
    try:
        report = json.loads(chunks or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSP report JSON noto'g'ri")
    if not isinstance(report, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSP report formati noto'g'ri")
    item = report.get("csp-report", report)
    if not isinstance(item, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSP report formati noto'g'ri")
    fields = {
        key: _safe(item.get(key))
        for key in ("document-uri", "violated-directive", "blocked-uri", "source-file", "line-number")
        if item.get(key) is not None
    }
    if fields.get("document-uri"):
        parsed = urlsplit(fields["document-uri"])
        fields["document-uri"] = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))[:240]
    _log.info("CSP violation peer=%s report=%s", _safe(peer, 64), fields)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
