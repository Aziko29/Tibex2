import time
from collections import defaultdict

from fastapi import HTTPException, status

from ..redis_client import get_redis

_memory_store: dict[str, list[float]] = {}
_observation_store: dict[str, list[float]] = defaultdict(list)


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
