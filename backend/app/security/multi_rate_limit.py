"""Multi-layer rate limiting — bypass qilish qiyin.

Qatlamlar:
  1. Per IP
  2. Per User
  3. Per Endpoint
  4. Per IP+Endpoint (kombinatsiya)
  5. Global (umumiy tizim)
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from ..redis_client import get_redis


# In-memory fallback (Redis yo'q bo'lsa)
_mem: dict[str, deque] = defaultdict(lambda: deque(maxlen=500))


def _check_memory(key: str, limit: int, window: int) -> int:
    """Memory-based sliding window."""
    now = time.time()
    dq = _mem[key]
    while dq and dq[0] < now - window:
        dq.popleft()
    dq.append(now)
    return len(dq)


async def _check_redis(key: str, limit: int, window: int) -> int:
    """Redis-based sliding window."""
    r = get_redis()
    if r is None:
        return _check_memory(key, limit, window)
    now = time.time()
    async with r.pipeline(transaction=True) as pipe:
        pipe.zremrangebyscore(key, 0, now - window)
        pipe.zadd(key, {str(now): now})
        pipe.expire(key, window)
        pipe.zcard(key)
        results = await pipe.execute()
    return int(results[-1])


async def multi_layer_limit(
    request: Request,
    user_id: int | None = None,
    endpoint_name: str = "default",
    ip_limit: int = 100,
    user_limit: int = 300,
    endpoint_limit: int = 60,
    combo_limit: int = 30,
    global_limit: int = 5000,
):
    """5 qatlamli rate limit. Birinchi oshgan qatlam bloklaydi."""
    from ..deps import client_ip
    ip = client_ip(request) or "unknown"

    endpoint = request.url.path
    method = request.method

    # 1. IP
    count = await _check_redis(f"rl:ip:{ip}", ip_limit, 60)
    if count > ip_limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Juda ko'p so'rov (IP). Keyinroq urinib ko'ring.",
        )

    # 2. User
    if user_id:
        count = await _check_redis(f"rl:user:{user_id}", user_limit, 60)
        if count > user_limit:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Juda ko'p so'rov (foydalanuvchi). Keyinroq urinib ko'ring.",
            )

    # 3. Endpoint
    count = await _check_redis(f"rl:ep:{method}:{endpoint}", endpoint_limit, 60)
    if count > endpoint_limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Juda ko'p so'rov (endpoint). Keyinroq urinib ko'ring.",
        )

    # 4. IP + Endpoint
    count = await _check_redis(f"rl:ip:{ip}:ep:{method}:{endpoint}", combo_limit, 60)
    if count > combo_limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Juda ko'p so'rov (kombinatsiya). Keyinroq urinib ko'ring.",
        )

    # 5. Global
    count = await _check_redis("rl:global", global_limit, 60)
    if count > global_limit:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Tizim yuklamasi yuqori. Keyinroq urinib ko'ring.",
        )
