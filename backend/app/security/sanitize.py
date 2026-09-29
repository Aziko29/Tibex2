"""Input sanitization — XSS, SQL, path traversal himoyasi."""
import html
import re

# SQL injection patternlar
SQL_PATTERNS = [
    re.compile(r"(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b)", re.I),
    re.compile(r"(--|#|/\*|\*/|;)", re.I),
    re.compile(r"('\s*OR\s*'|'\s*AND\s*')", re.I),
]

# XSS patternlar
XSS_PATTERNS = [
    re.compile(r"<script[^>]*>.*?</script>", re.I | re.S),
    re.compile(r"javascript\s*:", re.I),
    re.compile(r"on\w+\s*=", re.I),
    re.compile(r"<iframe", re.I),
    re.compile(r"<embed", re.I),
    re.compile(r"<object", re.I),
]

# Path traversal
PATH_PATTERNS = [
    re.compile(r"\.\./|\.\.\\"),
    re.compile(r"%2e%2e[/\\]", re.I),
]


def contains_sql_injection(value: str) -> bool:
    if not isinstance(value, str):
        return False
    return any(p.search(value) for p in SQL_PATTERNS)


def contains_xss(value: str) -> bool:
    if not isinstance(value, str):
        return False
    return any(p.search(value) for p in XSS_PATTERNS)


def contains_path_traversal(value: str) -> bool:
    if not isinstance(value, str):
        return False
    return any(p.search(value) for p in PATH_PATTERNS)


def sanitize_html(value: str) -> str:
    """HTML escape — XSS oldini oladi."""
    if not isinstance(value, str):
        return value
    return html.escape(value, quote=True)


def sanitize_string(value: str, max_length: int = 1000) -> str:
    """Umumiy tozalash."""
    if not isinstance(value, str):
        return value
    # Trim
    value = value.strip()
    # Uzunlikni cheklash
    if len(value) > max_length:
        value = value[:max_length]
    # Null byte olib tashlash
    value = value.replace("\x00", "")
    return value


def is_safe(value: str) -> bool:
    """Xavfsizlik tekshiruvi."""
    return not (
        contains_sql_injection(value) or
        contains_xss(value) or
        contains_path_traversal(value)
    )
