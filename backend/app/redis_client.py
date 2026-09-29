import redis.asyncio as aioredis

from .config import get_settings

_redis: aioredis.Redis | None = None
_initialized = False


def get_redis() -> aioredis.Redis | None:
    global _redis, _initialized
    if _initialized:
        return _redis
    _initialized = True

    s = get_settings()
    if not s.redis_url:
        if s.is_prod:
            raise RuntimeError("TIBEX_REDIS_URL production muhitida majburiy")
        return None

    _redis = aioredis.from_url(
        s.redis_url,
        encoding="utf-8",
        decode_responses=True,
    )
    return _redis


async def close_redis() -> None:
    global _redis, _initialized
    if _redis is not None:
        await _redis.aclose()
        _redis = None
    _initialized = False
