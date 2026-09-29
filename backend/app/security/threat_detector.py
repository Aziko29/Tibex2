"""Threat Detector — aqlli risk scoring + pattern detection.

Xususiyatlar:
  • Ikki toifali SQL injection (STRONG + WEAK)
  • XSS, path traversal, command injection
  • Suspicious User-Agent detection
  • Scanner path detection
  • Auto-blacklist (risk score ≥ 80)
  • Bounded memory (max 10k profiles)
"""
import logging
import time
import re
from collections import defaultdict, deque
from dataclasses import dataclass, field

log = logging.getLogger("tibex.threat")


# ═══════════════════════════════════════════════════════════
# PATTERNLAR
# ═══════════════════════════════════════════════════════════

# ─── SQL injection — KUCHLI patternlar (o'zi yetarli) ───
SQL_STRONG = re.compile(
    r"("
    # Tautologiya: ' OR '1'='1
    r"['\"]\s*(OR|AND)\s*['\"]?\d+['\"]?\s*=\s*['\"]?\d+"
    r"|['\"]\s*(OR|AND)\s+\d+\s*=\s*\d+"
    r"|\b(OR|AND)\s+['\"]?\w+['\"]?\s*=\s*['\"]?\w+"
    # UNION SELECT
    r"|\bUNION\s+(ALL\s+)?SELECT\b"
    # Stacked queries
    r"|;\s*(DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER|CREATE|SHUTDOWN)\b"
    # Time-based
    r"|\b(SLEEP|PG_SLEEP|BENCHMARK)\s*\("
    r"|\bWAITFOR\s+DELAY\b"
    # Info schema
    r"|\bINFORMATION_SCHEMA\b"
    r"|\bPG_CATALOG\b"
    r"|\bSYS\.(TABLES|COLUMNS)\b"
    # File access
    r"|\bLOAD_FILE\s*\("
    r"|INTO\s+(OUT|DUMP)FILE\b"
    # Comment injection: '--, '/*
    r"|['\"]\s*--(\s|$|['\"])"
    r"|['\"]\s*/\*"
    r")",
    re.I,
)

# ─── SQL injection — KUCHSIZ patternlar (2+ kerak) ───
SQL_KEYWORDS = re.compile(
    r"\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|"
    r"UNION|WHERE|FROM|SLEEP|WAITFOR)\b",
    re.I,
)
SQL_COMMENT = re.compile(r"(--|/\*|\*/|#\s)", re.I)
SQL_QUOTE = re.compile(r"['\"]")

# ─── XSS ───
XSS_PAT = re.compile(
    r"(<script|javascript:|data:text/html|<iframe|<object|<embed|"
    r"onerror\s*=|onload\s*=|onclick\s*=|onmouseover\s*=)",
    re.I,
)

# ─── Path Traversal ───
TRAVERSAL = re.compile(r"(\.\./|\.\.\\|%2e%2e|%252e%252e)", re.I)

# ─── Command Injection ───
CMD_INJ = re.compile(
    r"(\|\s*(cat|ls|rm|wget|curl|nc|bash|sh|python)\b|"
    r";\s*(cat|rm|wget|curl)\b|"
    r"`[^`]+`|\$\([^)]+\))",
    re.I,
)

# ─── Suspicious User-Agent ───
SUSPICIOUS_UA = re.compile(
    r"(sqlmap|nikto|nmap|masscan|acunetix|w3af|nessus|openvas|havij|zgrab|nuclei|"
    r"dirbuster|gobuster|wfuzz|ffuf|hydra|medusa)",
    re.I,
)

# ─── Scanner Paths ───
SCANNER_PATHS = re.compile(
    r"(wp-admin|wp-login|wp-content|\.env|\.git|phpmyadmin|adminer|"
    r"config\.php|shell\.php|xmlrpc\.php|\.well-known/security|"
    r"cgi-bin|/manager/html|/solr/|/actuator/)",
    re.I,
)


# ═══════════════════════════════════════════════════════════
# FUNKSIYALAR
# ═══════════════════════════════════════════════════════════
def _count_weak_patterns(value: str) -> int:
    """Kuchsiz SQL patternlar soni.
    
    MUHIM: O'zbek tilida ko'p apostrof bor (o'qidim, g'alla, bo'ldi).
    Shuning uchun quote yolg'iz o'zi signal emas.
    Faqat: keyword + comment (yoki ikkalasi birga) — shubhali.
    """
    if not isinstance(value, str):
        return 0
    count = 0
    has_keyword = bool(SQL_KEYWORDS.search(value))
    has_comment = bool(SQL_COMMENT.search(value))
    if has_keyword:
        count += 1
    if has_comment:
        count += 1
    # Keyword + comment birga — juda shubhali (SQL injection signature)
    if has_keyword and has_comment:
        count += 1
    return count


def contains_sql_injection(value: str) -> bool:
    """Aqlli SQL injection tekshiruvi."""
    if not isinstance(value, str):
        return False
    # KUCHLI pattern — o'zi yetarli
    if SQL_STRONG.search(value):
        return True
    # KUCHSIZ patternlar — 2+ bo'lishi kerak
    if _count_weak_patterns(value) >= 2:
        return True
    return False


def contains_xss(value: str) -> bool:
    if not isinstance(value, str):
        return False
    return bool(XSS_PAT.search(value))


def contains_path_traversal(value: str) -> bool:
    if not isinstance(value, str):
        return False
    return bool(TRAVERSAL.search(value))


def contains_cmd_injection(value: str) -> bool:
    if not isinstance(value, str):
        return False
    return bool(CMD_INJ.search(value))


# ═══════════════════════════════════════════════════════════
# PROFILE
# ═══════════════════════════════════════════════════════════
@dataclass
class _Profile:
    """IP uchun behavior profile."""
    first_seen: float = 0.0
    last_seen: float = 0.0
    requests: int = 0
    errors_4xx: int = 0
    errors_5xx: int = 0
    suspicious_hits: int = 0
    failed_logins: int = 0
    risk_score: float = 0.0
    events: deque = field(default_factory=lambda: deque(maxlen=200))
    blacklisted_until: float = 0.0


# ═══════════════════════════════════════════════════════════
# THREAT DETECTOR
# ═══════════════════════════════════════════════════════════
class ThreatDetector:
    """Aqlli tahdid aniqlovchi."""

    MAX_PROFILES = 10000
    PROFILE_TTL = 3600
    BLACKLIST_TTL = 300  # 21-band: ≤ 300 s
    SCAN_WINDOW = 60
    SCAN_THRESHOLD = 30

    def __init__(self):
        self._profiles: dict[str, _Profile] = {}
        self._last_cleanup = time.time()
        self._whitelist: set[str] = self._load_whitelist()

    @staticmethod
    def _load_whitelist() -> set[str]:
        try:
            from ..config import get_settings
            raw = get_settings().threat_whitelist or ""
        except Exception:
            raw = "127.0.0.1,::1,localhost"
        return {x.strip() for x in raw.split(",") if x.strip()}

    def add_whitelist(self, ip: str) -> None:
        """Haqiqiy klinika (NAT) IP'sini qo'shish uchun."""
        self._whitelist.add(ip)

    def _cleanup(self):
        now = time.time()
        if now - self._last_cleanup < 300:
            return
        self._last_cleanup = now
        expired = [
            ip for ip, p in self._profiles.items()
            if now - p.last_seen > self.PROFILE_TTL
            and p.blacklisted_until < now
        ]
        for ip in expired[:1000]:
            del self._profiles[ip]
        if len(self._profiles) > self.MAX_PROFILES:
            sorted_items = sorted(
                self._profiles.items(),
                key=lambda x: x[1].last_seen,
            )
            for ip, _ in sorted_items[:1000]:
                del self._profiles[ip]

    def _get(self, ip: str) -> _Profile:
        self._cleanup()
        if ip not in self._profiles:
            now = time.time()
            self._profiles[ip] = _Profile(first_seen=now, last_seen=now)
        return self._profiles[ip]

    def is_blacklisted(self, ip: str) -> tuple[bool, float]:
        if ip in self._whitelist:
            return False, 0
        p = self._profiles.get(ip)
        if not p:
            return False, 0
        now = time.time()
        if p.blacklisted_until > now:
            return True, p.blacklisted_until - now
        return False, 0

    def record_request(
        self,
        ip: str,
        path: str,
        method: str,
        status_code: int,
        user_agent: str = "",
        body_sample: str = "",
        authenticated: bool = False,
    ):
        # ── FIX_v1: whitelist'da bo'lsa — tahlil qilmaymiz ──
        if ip in self._whitelist:
            return
        now = time.time()
        p = self._get(ip)
        p.requests += 1
        p.last_seen = now

        if 400 <= status_code < 500:
            p.errors_4xx += 1
        elif status_code >= 500:
            p.errors_5xx += 1

        score_add = 0.0

        # Suspicious UA
        if user_agent and SUSPICIOUS_UA.search(user_agent):
            score_add += 15
            p.events.append(("suspicious_ua", now))

        # Scanner paths
        if SCANNER_PATHS.search(path):
            score_add += 20
            p.events.append(("scanner_path", now))

        # Kontent patternlari (SQL/XSS/CMD/traversal) ballga QO'SHILMAYDI —
        # klinik matn ("WBC = 12 and RBC = 4.5") noto'g'ri hujum deb topilardi.
        # Faqat log.info (kuzatuv uchun).
        if body_sample and (
            contains_sql_injection(body_sample) or contains_xss(body_sample)
            or contains_path_traversal(body_sample) or contains_cmd_injection(body_sample)
        ):
            log.info("Shubhali kontent namunasi (ball berilmadi): ip=%s path=%s", ip, path)

        if score_add > 0:
            p.suspicious_hits += 1

        # 404 scan detection
        if status_code in (401, 403, 404):
            p.events.append(("4xx", now))
            recent_4xx = sum(
                1 for e, t in p.events
                if e == "4xx" and now - t < self.SCAN_WINDOW
            )
            if recent_4xx >= self.SCAN_THRESHOLD:
                score_add += 30
                p.events.append(("scanning_detected", now))

        if score_add > 0:
            p.risk_score = min(100.0, p.risk_score + score_add)

        # Auto-blacklist: faqat autentifikatsiyasiz IP'lar uchun
        if not authenticated and p.risk_score >= 80 and p.suspicious_hits >= 3:
            p.blacklisted_until = now + self.BLACKLIST_TTL
            p.events.append(("auto_blacklisted", now))

        # Slow decay
        if now - p.last_seen > 60 and p.risk_score > 0:
            p.risk_score = max(0, p.risk_score - 0.5)

    def record_failed_login(self, ip: str):
        if ip in self._whitelist:
            return
        p = self._get(ip)
        p.failed_logins += 1
        p.risk_score = min(100, p.risk_score + 10)
        if p.failed_logins >= 10:
            p.blacklisted_until = time.time() + self.BLACKLIST_TTL

    def get_risk(self, ip: str) -> float:
        p = self._profiles.get(ip)
        return p.risk_score if p else 0.0

    def stats(self) -> dict:
        now = time.time()
        active_blacklist = sum(
            1 for p in self._profiles.values()
            if p.blacklisted_until > now
        )
        high_risk = sum(
            1 for p in self._profiles.values()
            if p.risk_score >= 50
        )
        return {
            "profiles": len(self._profiles),
            "blacklisted": active_blacklist,
            "high_risk": high_risk,
            "max_profiles": self.MAX_PROFILES,
        }


# Singleton
detector = ThreatDetector()
