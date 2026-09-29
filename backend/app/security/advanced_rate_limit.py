"""Advanced Rate Limit — token bucket + adaptive + exponential backoff.

Xususiyatlar:
  • Token bucket algoritmi (silliq)
  • Adaptive limits (rol bo'yicha)
  • Exponential backoff (qoidabuzarga qattiqroq)
  • Endpoint kategoriyalari (read/write/auth/critical)
  • Bypass qiyin (ko'p qavatli)
  • Redis bo'lmasa — xotirada ishlaydi
"""
import time
import asyncio
from collections import defaultdict
from dataclasses import dataclass, field

from fastapi import HTTPException, Request, status


# ═══════════════════════════════════════════════════════════
# TOKEN BUCKET
# ═══════════════════════════════════════════════════════════
@dataclass
class _Bucket:
    tokens: float
    last_refill: float
    capacity: float
    refill_rate: float   # tokens/sekund
    # Abuse tracking
    violations: int = 0
    last_violation: float = 0.0
    blocked_until: float = 0.0
    
    def refill(self, now: float):
        elapsed = now - self.last_refill
        if elapsed <= 0:
            return
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
    
    def consume(self, tokens: float = 1.0) -> bool:
        now = time.time()
        
        # Bloklanganmi?
        if self.blocked_until > now:
            return False
        
        self.refill(now)
        
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        
        # Qoidabuzarlik
        self.violations += 1
        self.last_violation = now
        
        # Exponential backoff
        backoff = min(300, 2 ** min(self.violations, 8))
        self.blocked_until = now + backoff
        return False


# ═══════════════════════════════════════════════════════════
# ENDPOINT KATEGORIYALARI
# ═══════════════════════════════════════════════════════════
ENDPOINT_LIMITS = {
    # Kritik endpointlar — qattiq cheklov
    "auth": {"capacity": 10, "refill": 0.2},        # 10 login / daqiqa
    "critical": {"capacity": 30, "refill": 0.5},    # 30 amal / daqiqa
    "write": {"capacity": 60, "refill": 1.0},       # 60 yozish / daqiqa
    "read": {"capacity": 300, "refill": 5.0},       # 300 o'qish / daqiqa
    "bulk": {"capacity": 10, "refill": 0.1},        # 10 bulk / daqiqa
    "default": {"capacity": 120, "refill": 2.0},
}


def _classify_endpoint(path: str, method: str) -> str:
    """Endpoint kategoriyasini aniqlash."""
    p = path.lower()
    m = method.upper()
    
    if "/auth/login" in p or "/otp/send" in p or "/auth/change-password" in p:
        return "auth"
    if "/demo-reset" in p or "/admin-reset" in p or "/clear-audit" in p:
        return "critical"
    if "bulk" in p or "export" in p or "import" in p:
        return "bulk"
    if m in ("POST", "PATCH", "PUT", "DELETE"):
        return "write"
    if m == "GET":
        return "read"
    return "default"


# ═══════════════════════════════════════════════════════════
# ADAPTIVE LIMITS — rol bo'yicha
# ═══════════════════════════════════════════════════════════
ROLE_MULTIPLIERS = {
    "admin": 3.0,
    "superadmin": 5.0,
    "doctor": 2.0,
    "reception": 2.0,
    "cashier": 1.5,
    "lab": 1.5,
    "patient": 0.5,   # Bemorlar kamroq
}


# ═══════════════════════════════════════════════════════════
# MAIN CLASS
# ═══════════════════════════════════════════════════════════
class AdvancedRateLimiter:
    MAX_BUCKETS = 50000
    CLEANUP_TTL = 3600
    
    def __init__(self):
        self._buckets: dict[str, _Bucket] = {}
        self._last_cleanup = time.time()
    
    def _cleanup(self):
        now = time.time()
        if now - self._last_cleanup < 300:
            return
        self._last_cleanup = now
        
        # Eskirganlarni o'chirish
        expired = [
            k for k, b in self._buckets.items()
            if now - b.last_refill > self.CLEANUP_TTL
            and b.blocked_until < now
        ]
        for k in expired[:5000]:
            del self._buckets[k]
        
        # Maksimal chegaradan oshsa
        if len(self._buckets) > self.MAX_BUCKETS:
            sorted_items = sorted(
                self._buckets.items(),
                key=lambda x: x[1].last_refill,
            )
            for k, _ in sorted_items[:10000]:
                del self._buckets[k]
    
    def _get_bucket(self, key: str, capacity: float, refill: float) -> _Bucket:
        self._cleanup()
        if key not in self._buckets:
            now = time.time()
            self._buckets[key] = _Bucket(
                tokens=capacity,
                last_refill=now,
                capacity=capacity,
                refill_rate=refill,
            )
        return self._buckets[key]
    
    async def check(
        self,
        request: Request,
        user_id: int | None = None,
        role: str = "default",
    ) -> None:
        """Ko'p qavatli tekshiruv."""
        # IP olish
        from ..deps import client_ip
        ip = client_ip(request) or "?"
        
        path = request.url.path
        method = request.method
        cat = _classify_endpoint(path, method)
        limits = ENDPOINT_LIMITS[cat]
        multiplier = ROLE_MULTIPLIERS.get(role, 1.0)
        
        # QATLAM 1: Global (barcha tizim)
        global_b = self._get_bucket(
            "global", capacity=10000, refill=200.0
        )
        if not global_b.consume(1.0):
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Tizim yuklamasi yuqori. Biroz kuting.",
            )
        
        # QATLAM 2: IP + Endpoint category
        ip_key = f"ip:{ip}:{cat}"
        ip_b = self._get_bucket(
            ip_key,
            capacity=limits["capacity"],
            refill=limits["refill"],
        )
        if not ip_b.consume(1.0):
            wait = max(1, int(ip_b.blocked_until - time.time()))
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Juda ko'p so'rov. {wait} sekund kuting.",
            )
        
        # QATLAM 3: User (agar login qilgan bo'lsa)
        if user_id:
            u_key = f"user:{user_id}"
            u_cap = limits["capacity"] * multiplier
            u_refill = limits["refill"] * multiplier
            u_b = self._get_bucket(u_key, u_cap, u_refill)
            if not u_b.consume(1.0):
                wait = max(1, int(u_b.blocked_until - time.time()))
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"Juda ko'p so'rov. {wait} sekund kuting.",
                )
        
        # QATLAM 4: Auth endpointlar uchun qattiq
        if cat == "auth":
            auth_b = self._get_bucket(f"auth:{ip}", capacity=5, refill=0.1)
            if not auth_b.consume(1.0):
                wait = max(1, int(auth_b.blocked_until - time.time()))
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"Login urinishlari ko'p. {wait} sekund kuting.",
                )
    
    def stats(self) -> dict:
        now = time.time()
        blocked = sum(
            1 for b in self._buckets.values() if b.blocked_until > now
        )
        return {
            "buckets": len(self._buckets),
            "blocked": blocked,
            "max_buckets": self.MAX_BUCKETS,
        }


# Singleton
limiter = AdvancedRateLimiter()
