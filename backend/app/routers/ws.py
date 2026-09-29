"""WebSocket endpoint — Origin tekshiruvi bilan (CSWSH himoyasi)."""
import asyncio
import contextlib
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..config import get_settings
from ..db import get_db
from ..models import Session as DBSession, User
from ..realtime import manager
from ..security.netutil import client_ip
from ..security.sessions import parse_token
from ..security.audit import log_action
from ..security.session_cookie import COOKIE_NAME
from ..security.session_state import INACTIVE, session_row_problem, user_problem

log = logging.getLogger("tibex.ws")
router = APIRouter()


def _is_origin_allowed(origin: str | None) -> bool:
    """Origin ruxsat etilganmi?

    • Origin yo'q → rad etish (brauzerlar har doim yuboradi)
    • Origin allowed_origins da → ruxsat
    • Else → rad etish
    """
    if not origin:
        return False

    s = get_settings()

    # Dev muhit: localhost har xil variantlarni ruxsat
    if not s.is_prod:
        dev_origins = {
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5500",
            "http://127.0.0.1:5500",
        }
        if origin in dev_origins:
            return True

    # Prod muhit: allowed_origins dan tekshirish
    return origin in (s.allowed_origins or [])


@router.websocket("")
async def ws_endpoint(
    ws: WebSocket,
    cf_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
):
    """WebSocket ulanish. Cookie + Origin tekshiruvi.

    Himoyalar:
      1. Origin — CSWSH oldini olish
      2. Cookie — sessiya mavjudligi
      3. Token — imzo va muddat
      4. DB — sessiya bekor qilinmaganligi
    """
    # ─── HIMOYA 1: Origin tekshiruvi ───
    origin = ws.headers.get("origin")
    if not _is_origin_allowed(origin):
        log.warning("WS CSWSH urinishi: origin=%r", origin)
        await ws.close(code=4403)
        return

    # ─── HIMOYA 2: Cookie ───
    if not cf_session:
        await ws.close(code=4401)
        return

    # ─── HIMOYA 3: Token ───
    info = parse_token(cf_session, expected_kind="staff")
    if not info:
        await ws.close(code=4401)
        return

    # Ulanish ochilishidan oldin sessiya va foydalanuvchini DB'dan tasdiqlaymiz.
    problem = await _ws_session_problem(info)
    if problem:
        ip = client_ip(ws)
        log.info("WS ulanishi rad etildi ip=%s sabab=%s", ip or "?", problem)
        await _audit_ws_reject(info, problem, ip)
        await ws.close(code=4401)
        return

    if not await manager.connect(ws, user_id=info["user_id"], jti=info["jti"]):
        await ws.close(code=4429, reason="Too many connections")
        return

    last_activity = time.monotonic()
    next_validation = last_activity + 60
    try:
        while True:
            now_mono = time.monotonic()
            wait_for = max(0.01, min(60, next_validation - now_mono))
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=wait_for)
            except TimeoutError:
                if time.monotonic() - last_activity >= 120:
                    await ws.close(code=4408, reason="Idle timeout")
                    return
                if not await _validate_ws_session(info):
                    await ws.close(code=4401, reason="Session expired")
                    return
                next_validation = time.monotonic() + 60
                continue

            last_activity = time.monotonic()
            if len(msg.encode("utf-8")) > 64:
                await ws.close(code=1009, reason="Message too large")
                return
            if msg == "ping":
                await ws.send_text('{"type":"pong"}')
            else:
                await ws.close(code=1008, reason="Unsupported message")
                return
            if time.monotonic() >= next_validation:
                if not await _validate_ws_session(info):
                    await ws.close(code=4401, reason="Session expired")
                    return
                next_validation = time.monotonic() + 60
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("WS xatosi: %s", exc)
    finally:
        await manager.disconnect(ws)


@contextlib.asynccontextmanager
async def _ws_session_scope():
    """Bitta DB sessiyasi: chiqishda commit/rollback va yopish kafolatlanadi.

    `get_db` har chaqiruvda modul darajasidan olinadi (testlar uni almashtiradi).
    """
    async with contextlib.asynccontextmanager(get_db)() as db:
        yield db


async def _ws_session_problem(info: dict) -> str | None:
    """Sessiya yaroqsiz bo'lsa sabab kodini, yaroqli bo'lsa None qaytaradi.

    Qoidalar HTTP tomon bilan bir xil: `security/session_state.py`.
    """
    async with _ws_session_scope() as db:
        row = (
            await db.execute(select(DBSession).where(DBSession.jti == info["jti"]))
        ).scalar_one_or_none()
        now = datetime.now(timezone.utc)
        problem = session_row_problem(row, now, get_settings().inactivity_minutes)
        if problem == INACTIVE:
            row.revoked_at = now
            await db.commit()
        if problem:
            return problem

        user = (await db.execute(select(User).where(User.id == info["user_id"]))).scalar_one_or_none()
        problem = user_problem(user, info["iat"], allow_patient=False)
        if problem:
            return problem

        row.last_seen_at = now
        await db.commit()
        return None


async def _validate_ws_session(info: dict) -> bool:
    return await _ws_session_problem(info) is None


async def _audit_ws_reject(info: dict, reason: str, ip: str | None) -> None:
    """Imzosi to'g'ri, lekin sessiyasi yaroqsiz ulanish urinishini audit'ga yozadi.

    Imzosiz/noto'g'ri tokenlar yozilmaydi (audit jadvalini to'ldirib yubormaslik uchun).
    """
    try:
        async with _ws_session_scope() as db:
            await log_action(
                db, user=f"user#{info.get('user_id')}", role="?", action="ws_reject",
                detail=f"WS ulanishi rad etildi: {reason}", ip=ip,
            )
            await db.commit()
    except Exception as exc:  # audit xatosi WS'ni yiqitmasin
        log.warning("WS reject audit yozilmadi: %s", exc)
