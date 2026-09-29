"""Content Security Policy — nonce asosida, dev'da yumshoqroq."""
import base64
import secrets


def make_nonce() -> str:
    return base64.b64encode(secrets.token_bytes(16)).decode("ascii")


def build_csp(nonce: str, is_prod: bool) -> str:
    """CSP sarlavhasini quradi.

    Dev (local): inline style/script'ga ruxsat beriladi (tezroq ishlab chiqish uchun).
    Prod: faqat nonce bilan inline'ga ruxsat (XSS himoyasi kuchli).
    """
    if not is_prod:
        # Dev rejimi — inline ruxsat, hamma funksiya ishlaydi
        directives = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "connect-src 'self' ws: wss: http: https:",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
        ]
    else:
        # Production — qat'iy CSP, faqat nonce bilan
        directives = [
            "default-src 'self'",
            f"script-src 'self' 'nonce-{nonce}'",
            f"style-src 'self' 'nonce-{nonce}'",
            "img-src 'self' data: blob:",
            "connect-src 'self' ws: wss:",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
            "upgrade-insecure-requests",
        ]
    return "; ".join(directives)