"""Input Fortress — chuqur kirish validatsiyasi.

Xususiyatlar:
  • JSON chuqurligi va hajmi cheklangan
  • Content-Type enforcement
  • Null byte, control character tozalash
  • Unicode normalization (homoglyph hujumlar)
  • Max body size
  • Sinkron timeout yo'q — barcha async
"""
import json
import re
import unicodedata
from typing import Any

from fastapi import HTTPException, Request, status


# ═══════════════════════════════════════════════════════════
# CHEGARALAR
# ═══════════════════════════════════════════════════════════
MAX_BODY_SIZE = 1 * 1024 * 1024        # 1 MB
MAX_JSON_DEPTH = 10                    # Nesting chuqurligi
MAX_JSON_KEYS = 200                    # Total keys
MAX_STRING_LENGTH = 10000              # Bitta string
MAX_ARRAY_LENGTH = 1000                # Array uzunligi

ALLOWED_CONTENT_TYPES = {
    "application/json",
    "application/csp-report",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
}

# Xavfli patternlar (kuchaytirilgan)
NULL_BYTE = re.compile(r"\x00")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
UNICODE_BIDI = re.compile(r"[\u202a-\u202e\u2066-\u2069]")  # Bidi override
SCRIPT_TAGS = re.compile(
    r"<\s*(script|iframe|object|embed|applet|meta|link|style)\b",
    re.I,
)
# 21-band: kontentga qarab (XSS/SQL) bloklash olib tashlandi — klinik matn
# ("onset = 3 kun", "Lab data: normal") noto'g'ri rad etilardi. Himoya =
# chiqishda escape (22-band) + CSP.


def _check_body_size(request: Request):
    """Body hajmini tekshirish."""
    cl = request.headers.get("content-length")
    if cl:
        try:
            size = int(cl)
            if size > MAX_BODY_SIZE:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    f"So'rov hajmi juda katta (maks: {MAX_BODY_SIZE // 1024} KB)",
                )
        except ValueError:
            pass


async def read_body_limited(request: Request, limit: int = MAX_BODY_SIZE) -> bytes:
    """Body'ni stream bilan SANAB o'qiydi (Content-Length yolg'on/yo'q bo'lsa ham).

    O'qilgan body `request._body` ga keshlanadi, shuning uchun keyingi
    `await request.body()` chaqiruvlari ishlaydi.
    """
    if hasattr(request, "_body"):
        data = request._body
        if len(data) > limit:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "So'rov hajmi juda katta")
        return data
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"So'rov hajmi juda katta (maks: {limit // 1024} KB)",
            )
        chunks.append(chunk)
    data = b"".join(chunks)
    request._body = data
    return data


def _check_content_type(request: Request):
    """Content-Type tekshiruvi (faqat write uchun)."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    ct = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not ct:
        return  # Bo'sh — OK (ba'zi client'lar yuboradi)
    if ct not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Content-Type qo'llab-quvvatlanmaydi: {ct}",
        )


def _sanitize_string(s: str) -> str:
    """String'ni tozalash."""
    if not isinstance(s, str):
        return s
    # Unicode normalization (NFKC — homoglyph hujumlar)
    s = unicodedata.normalize("NFKC", s)
    # Null byte va control chars
    s = NULL_BYTE.sub("", s)
    s = CONTROL_CHARS.sub("", s)
    # Bidi override (Trojan Source hujumlar)
    s = UNICODE_BIDI.sub("", s)
    return s


def _validate_json(data: Any, depth: int = 0, key_count: list = None):
    """JSON'ni rekursiv tekshirish."""
    if key_count is None:
        key_count = [0]
    
    if depth > MAX_JSON_DEPTH:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"JSON juda chuqur (maks: {MAX_JSON_DEPTH})",
        )
    
    if isinstance(data, dict):
        key_count[0] += len(data)
        if key_count[0] > MAX_JSON_KEYS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Juda ko'p kalit (maks: {MAX_JSON_KEYS})",
            )
        for k, v in data.items():
            if not isinstance(k, str):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Kalit faqat string bo'lishi kerak",
                )
            if len(k) > 500:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Kalit juda uzun",
                )
            _validate_json(v, depth + 1, key_count)
    
    elif isinstance(data, list):
        if len(data) > MAX_ARRAY_LENGTH:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Array juda uzun (maks: {MAX_ARRAY_LENGTH})",
            )
        for item in data:
            _validate_json(item, depth + 1, key_count)
    
    elif isinstance(data, str):
        if len(data) > MAX_STRING_LENGTH:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"String juda uzun (maks: {MAX_STRING_LENGTH})",
            )


async def fortress_validate(request: Request) -> dict | None:
    """To'liq validatsiya."""
    # Body size
    _check_body_size(request)
    
    # Content-Type
    _check_content_type(request)
    
    # Body parse (faqat JSON uchun)
    body_data = None
    if request.method in ("POST", "PATCH", "PUT"):
        ct = (request.headers.get("content-type") or "").lower()
        if "application/json" in ct or not request.headers.get("content-length"):
            raw = await read_body_limited(request)
        else:
            raw = b""
        if "application/json" in ct:
            try:
                if raw:
                    body_data = json.loads(raw)
                    _validate_json(body_data)
            except json.JSONDecodeError:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "JSON formatida xato",
                )
    
    return body_data


def sanitize_deep(value: Any) -> Any:
    """Chuqur tozalash — barcha string'lar uchun."""
    if isinstance(value, str):
        return _sanitize_string(value)
    if isinstance(value, dict):
        return {k: sanitize_deep(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_deep(v) for v in value]
    return value
