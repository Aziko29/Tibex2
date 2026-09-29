import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import WebSocket

from .redis_client import get_redis

log = logging.getLogger("tibex.realtime")

CHANNEL = "tibex:events"
SESSION_REVOKE_CHANNEL = "tibex:session-revoked"


class WSManager:
    """Mahalliy WebSocket ulanishlarini boshqaradi."""

    def __init__(self) -> None:
        self._clients: dict[WebSocket, tuple[int, str]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, user_id: int, jti: str) -> bool:
        async with self._lock:
            if sum(1 for uid, _ in self._clients.values() if uid == user_id) >= 5:
                return False
            await ws.accept()
            self._clients[ws] = (user_id, jti)
        log.info("WS ulandi. Jami: %d", len(self._clients))
        return True

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.pop(ws, None)
        log.info("WS uzildi. Jami: %d", len(self._clients))

    async def broadcast(self, message: dict) -> None:
        text = json.dumps(message, default=str, ensure_ascii=False)
        dead: list[WebSocket] = []
        async with self._lock:
            clients = list(self._clients)
        for ws in clients:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.pop(ws, None)

    async def revoke_session(self, jti: str) -> None:
        async with self._lock:
            clients = [ws for ws, (_, client_jti) in self._clients.items() if client_jti == jti]
        for ws in clients:
            with contextlib.suppress(Exception):
                await ws.close(code=4401, reason="Session revoked")


manager = WSManager()
_listener_task: asyncio.Task | None = None


async def publish(event_type: str, data: Any) -> None:
    """Send a non-sensitive invalidation; scoped snapshots are fetched over HTTP."""
    # Entity payloads can contain patient, medical, payment, or staff data.
    # WebSocket clients are not permission-scoped, so never fan those out.
    message = {"type": "snapshot.invalidate", "data": {}}
    r = get_redis()
    if r is not None:
        try:
            await r.publish(CHANNEL, json.dumps(message, default=str, ensure_ascii=False))
            return
        except Exception as exc:
            log.warning("Redis publish xatosi: %s", exc)
    # Redis yo'q — faqat mahalliy
    await manager.broadcast(message)


async def publish_session_revoked(jti: str) -> None:
    """Immediately close this session's WebSockets on every app worker."""
    payload = json.dumps({"type": "session.revoked", "jti": jti})
    r = get_redis()
    if r is not None:
        try:
            await r.publish(SESSION_REVOKE_CHANNEL, payload)
            return
        except Exception as exc:
            log.warning("Session revoke pubsub xatosi: %s", type(exc).__name__)
    await manager.revoke_session(jti)


async def _redis_listener() -> None:
    """Redis kanalini tinglab, xabarlarni mahalliy WS'ga uzatadi."""
    r = get_redis()
    if r is None:
        return
    pubsub = r.pubsub()
    await pubsub.subscribe(CHANNEL, SESSION_REVOKE_CHANNEL)
    log.info("Redis pubsub realtime kanallariga ulanildi")
    try:
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            try:
                payload = json.loads(msg["data"])
            except (json.JSONDecodeError, TypeError):
                continue
            if msg.get("channel") == SESSION_REVOKE_CHANNEL:
                jti = payload.get("jti") if isinstance(payload, dict) else None
                if isinstance(jti, str) and jti:
                    await manager.revoke_session(jti)
                continue
            await manager.broadcast(payload)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.exception("Redis listener xatosi: %s", exc)
    finally:
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(CHANNEL, SESSION_REVOKE_CHANNEL)
            await pubsub.aclose()


def start_redis_listener() -> None:
    global _listener_task
    if _listener_task is not None and not _listener_task.done():
        return
    if get_redis() is None:
        log.info("Redis yo'q — faqat mahalliy WS rejimi")
        return
    _listener_task = asyncio.create_task(_redis_listener(), name="redis-listener")


async def stop_redis_listener() -> None:
    global _listener_task
    if _listener_task is None:
        return
    _listener_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _listener_task
    _listener_task = None
