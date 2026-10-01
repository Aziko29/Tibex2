import time
from collections import defaultdict

from fastapi import HTTPException, status

from ..redis_client import get_redis

_memory_store: dict[str, list[float]] = {}
_observation_store: dict[str, list[float]] = defaultdict(list)

# TIBEX_RATELIMIT_MEMORY_CLEANUP_v1: Redis yo'q bo'lganda har bir noyob
# kalit (IP, IP+login, ...) xotirada abadiy qolardi. Uzoq ishlagan server
# bilan bu dict'lar millionlab kalitga yetishi mumkin. Davriy cleanup:
# 5 daqiqada bir marta, oxirgi 1 soat ichida ishlatilmagan kalitlarni o'chiramiz.
_CLEANUP_STATE = {"last_run": 0.0}
_CLEANUP_INTERVAL_S = 300.0   # 5 daqiqa
_STORE_MAX_AGE_S = 3600.0     # 1 soat
_STORE_HARD_CAP = 50_000      # favqulodda chegara


def _cleanup_stores_if_due() -> None:
    now = time.time()
    if now - _CLEANUP_STATE["last_run"] < _CLEANUP_INTERVAL_S:
        return
    _CLEANUP_STATE["last_run"] = now
    for store in (_memory_store, _observation_store):
        stale = [
            k for k, arr in store.items()
            if not arr or (now - max(arr)) > _STORE_MAX_AGE_S
        ]
        for k in stale:
            store.pop(k, None)
        # Favqulodda himoya: agar biror sabab bilan hali ham juda ko'p
        # kalit qolgan bo'lsa (masalan, 1 soatda juda ko'p noyob IP),
        # eng eski yozuvlarni bo'shatib tashlaymiz.
        if len(store) > _STORE_HARD_CAP:
            for k in list(store.keys())[: len(store) - _STORE_HARD_CAP]:
                store.pop(k, None)


def _require_redis():
    """Production'da rate limit uchun umumiy, bardoshli Redis talab qilinadi."""
    from ..config import get_settings
    r = get_redis()
    if r is None and get_settings().is_prod:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Xavfsizlik xizmati vaqtincha mavjud emas.",
            headers={"Retry-After": "30"},
        )
    return r


async def hit(key: str, limit: int, window: int) -> int:
    """Sliding-window rate limit. Limitdan oshsa 429 ko'taradi."""
    _cleanup_stores_if_due()
    r = _require_redis()
    now = time.time()

    if r is not None:
        async with r.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, now - window)
            pipe.zadd(key, {str(now): now})
            pipe.expire(key, window)
            pipe.zcard(key)
            results = await pipe.execute()
        count = int(results[-1])
    else:
        arr = [t for t in _memory_store.get(key, []) if t > now - window]
        arr.append(now)
        _memory_store[key] = arr
        count = len(arr)

    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Juda ko'p so'rov. Iltimos, keyinroq urinib ko'ring.",
        )
    return count


async def reset(key: str) -> None:
    r = _require_redis()
    if r is not None:
        await r.delete(key)
    _memory_store.pop(key, None)


async def observe(key: str, window: int) -> int:
    """Non-blocking fixed-window counter for alerting; never rejects requests."""
    _cleanup_stores_if_due()
    r = _require_redis()
    if r is not None:
        # Atomic fixed window: only the request creating the key sets expiry.
        # Reapplying EXPIRE on every request would slide the alert window forever.
        script = """
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        return count
        """
        return int(await r.eval(script, 1, key, max(1, int(window))))

    now = time.time()
    if key not in _observation_store and len(_observation_store) >= 10_000:
        _observation_store.pop(next(iter(_observation_store)))
    recent = [at for at in _observation_store[key] if at > now - window]
    recent.append(now)
    _observation_store[key] = recent
    return len(recent)
