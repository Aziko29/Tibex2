"""21-band: klinik matn bloklanmasin va ball olmasin."""
import pytest
from starlette.requests import Request

from app.security.input_fortress import _validate_json, read_body_limited
from app.security.threat_detector import ThreatDetector

CLINICAL = [
    "onset = 3 kun", "WBC = 12 and RBC = 4.5", "Lab data: normal",
    "O'Brien -- allergiya", "Hb = 130 or 140 g/l", "javascript: kurs tugatgan",
    "BP 120/80, pulse = 72 and temp = 36.6", "data: bemor shikoyati yo'q",
    "select ko'rik va update qilindi",
]


@pytest.mark.parametrize("text", CLINICAL)
def test_clinical_text_passes_validation_and_scores_zero(text):
    _validate_json({"complaint": text})  # HTTPException ko'tarilmasligi kerak
    d = ThreatDetector()
    for _ in range(50):
        d.record_request("10.0.0.5", "/api/appointments", "POST", 200, "Mozilla/5.0", text)
    assert d.get_risk("10.0.0.5") == 0
    assert d.is_blacklisted("10.0.0.5") == (False, 0)


def test_scanner_user_agent_scores():
    d = ThreatDetector()
    d.record_request("9.9.9.9", "/api/x", "GET", 200, "sqlmap/1.7", "")
    assert d.get_risk("9.9.9.9") >= 15


def test_authenticated_ip_is_never_auto_blacklisted():
    d = ThreatDetector()
    for _ in range(40):
        d.record_request("8.8.8.8", "/wp-admin", "GET", 404, "nikto", "", authenticated=True)
    assert d.is_blacklisted("8.8.8.8")[0] is False


def test_unauthenticated_scanner_blacklisted_with_short_ttl():
    d = ThreatDetector()
    for _ in range(6):
        d.record_request("7.7.7.7", "/wp-admin", "GET", 404, "nikto", "")
    blocked, remaining = d.is_blacklisted("7.7.7.7")
    assert blocked and remaining <= 300


def test_whitelisted_ip_ignored():
    d = ThreatDetector()
    d.add_whitelist("5.5.5.5")
    d.record_request("5.5.5.5", "/wp-admin", "GET", 404, "nikto", "")
    assert d.get_risk("5.5.5.5") == 0


def _request(chunks, headers=None):
    async def receive():
        if chunks:
            return {"type": "http.request", "body": chunks.pop(0), "more_body": bool(chunks)}
        return {"type": "http.request", "body": b"", "more_body": False}
    scope = {"type": "http", "method": "POST", "path": "/x", "headers": headers or []}
    return Request(scope, receive)


@pytest.mark.asyncio
async def test_body_limit_counts_stream_without_content_length():
    from fastapi import HTTPException
    req = _request([b"x" * 600, b"y" * 600])
    with pytest.raises(HTTPException) as ei:
        await read_body_limited(req, limit=1000)
    assert ei.value.status_code == 413


@pytest.mark.asyncio
async def test_body_within_limit_is_cached_for_downstream():
    req = _request([b"ab", b"cd"])
    assert await read_body_limited(req, limit=100) == b"abcd"
    assert await req.body() == b"abcd"
