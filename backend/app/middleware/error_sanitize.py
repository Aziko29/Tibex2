"""Error sanitization — stack trace va env leak oldini oladi.

OWASP #10: Mishandling of Exceptional Conditions
"""
import logging
import time

from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("tibex.errors")


async def sanitize_errors_middleware(request: Request, call_next):
    """Barcha xatolarni xavfsiz formatda qaytarish."""
    try:
        response = await call_next(request)
    except Exception as exc:
        # Exception messages and tracebacks may expose SQL parameters, tokens,
        # or patient data. Keep the public response and server log non-sensitive.
        log.error("Request failed: %s %s (%s)", request.method, request.url.path, type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Server xatosi. Iltimos, keyinroq urinib ko'ring.",
                "type": "server_error",
                "ts": time.time(),
            },
            headers={
                "X-Content-Type-Options": "nosniff",
            },
        )
    return response
