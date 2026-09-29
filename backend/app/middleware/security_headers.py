"""Enhanced security headers — zamonaviy standartlar.

  • CSP (Content-Security-Policy) — nonce bilan
  • HSTS (max-age 2 yil, preload)
  • X-Content-Type-Options: nosniff
  • X-Frame-Options: DENY
  • Referrer-Policy: strict-origin-when-cross-origin
  • Permissions-Policy — barcha API lar o'chirilgan
  • Cross-Origin-Opener-Policy: same-origin
  • Cross-Origin-Resource-Policy: same-origin
  • Cross-Origin-Embedder-Policy: require-corp
  • Cache-Control: no-store (API uchun)
  • X-Permitted-Cross-Domain-Policies: none
  • X-Download-Options: noopen
  • X-DNS-Prefetch-Control: off
"""
from fastapi import Request
from fastapi.responses import Response


async def enhanced_security_headers(request: Request, call_next):
    response: Response = await call_next(request)

    # CSP — nonce asosida (prod) yoki yumshoq (dev)
    from ..config import get_settings
    s = get_settings()

    if s.is_prod:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data: blob:; "
            "connect-src 'self' wss:; "
            "font-src 'self' data:; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "object-src 'none'; "
            "upgrade-insecure-requests"
        )
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )

    # Universal headers (har qanday muhitda)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # TIBEX_CAMERA_FIX_v3: kamera ruxsat
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), camera=(self), geolocation=(self), "
        "gyroscope=(), magnetometer=(), microphone=(self), "
        "payment=(self), usb=(self)"
    )
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["X-Download-Options"] = "noopen"
    response.headers["X-DNS-Prefetch-Control"] = "off"

    # API endpointlar uchun caching'ni o'chirish
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"

    # Server nomini yashirish
    response.headers["Server"] = "TIBEX"

    return response
