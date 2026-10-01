"""Append-only audit jurnali: hash-zanjir, poyga-himoyasi va tekshiruv."""
import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..realtime import publish

ZERO_HASH = "0" * 64
_ADVISORY_LOCK_KEY = 7_420_001_001  # audit zanjiri uchun doimiy kalit

# TIBEX_AUDIT_NO_WS_VIEW_v1:
# `view` (PHI o'qish) DB'ga yoziladi (audit uchun kerak), LEKIN WebSocket'ga
# TARQATILMAYDI. Sabab: har bir GET (bootstrap, patients list, audit list, ...)
# `audit_view()` chaqiradi. Agar bu WS'ga chiqsa, har bootstrap → view → publish
# → admin yana bootstrap → view → publish → ... cheksiz loop va ekran
# pirpirashi (2 s da bir marta). Audit yozuvining o'zi DB'da qoladi.
def _should_publish(user: str, action: str) -> bool:  # noqa: ARG001
    return action != "view"


# TIBEX_AUDIT_PHI_REDACTION_v1: audit before_data/after_data — oddiy `sa.JSON`
# ustunlar (SHIFRLANMAGAN). Router'lar `_to_dict(obj)` bilan butun obyektni
# yozadi — jumladan complaint, final_dx, prescriptions, address, allergies,
# chronic va boshqa PHI. Asl jadvalda bu maydonlar AES-GCM bilan shifrlangan,
# lekin audit jurnalida PLAINTEXT nusxasi qolar edi. Bitta DB dump —
# barcha PHI ochiq matnda. Yechim: kalit nomi sezgir bo'lsa, qiymatni
# sha256-hash prefiksi bilan almashtiramiz. Audit qaysi maydon o'zgarganini
# bilish imkoniyatini saqlab qoladi (bir xil qiymat = bir xil hash),
# lekin haqiqiy qiymat audit jurnaliga tushmaydi. Asl qiymat asosiy jadvalda
# shifrlangan holda qoladi.
_AUDIT_SENSITIVE_KEYS = frozenset({
    # Bemor
    "phone", "phone_enc", "phone_bidx",
    "address", "allergies", "chronic",
    # Qabul — tibbiy
    "complaint", "vitals",
    "prelim_dx", "final_dx", "prescriptions", "draft", "lab_orders",
    "cancel_reason",
    # Lab natijalar
    "result_data", "result_summary", "result_note",
    # Integratsiya
    "api_key",
})


def _redact_phi(value):
    """Audit before/after_data uchun rekursiv PHI redaktsiyasi.

    Sezgir kalitning qiymati bo'sh (None/''/[]/{}) bo'lsa — o'zgartirilmaydi.
    Aks holda `[redacted:<10-belgili sha256>]` bilan almashtiriladi.
    Bir xil qiymat har doim bir xil hash beradi, shu sabab audit yozuvida
    qaysi maydon o'zgarganini aniqlash mumkin (eski hash != yangi hash).
    """
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k in _AUDIT_SENSITIVE_KEYS:
                if v is None or v == "" or v == [] or v == {}:
                    out[k] = v
                else:
                    try:
                        payload = json.dumps(v, default=str, ensure_ascii=False, sort_keys=True)
                    except Exception:
                        payload = str(v)
                    out[k] = "[redacted:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:10] + "]"
            else:
                out[k] = _redact_phi(v)
        return out
    if isinstance(value, list):
        return [_redact_phi(x) for x in value]
    return value


def compute_row_hash(prev_hash: str, *, id: int, user: str, role: str, action: str,
                     detail: str, before, after, ip, created_at: datetime) -> str:
    payload = json.dumps(
        {
            "id": id, "u": user, "r": role, "a": action, "d": detail,
            "b": before, "f": after, "ip": ip,
            "t": created_at.astimezone(timezone.utc).isoformat(),
        },
        sort_keys=True, default=str, ensure_ascii=False,
    )
    return hashlib.sha256((prev_hash + payload).encode("utf-8")).hexdigest()


async def log_action(
    db: AsyncSession,
    *,
    user: str,
    role: str,
    action: str,
    detail: str,
    before: dict | None = None,
    after: dict | None = None,
    ip: str | None = None,
):
    """Audit jurnaliga yozuv qo'shadi (hash-zanjir bilan)."""
    from ..models import AuditLog

    # TIBEX_AUDIT_DETAIL_LIMIT_v1: `detail` — Text ustun. Caller xato
    # yozib 10 MB yuborsa, DB shishadi. Defensiv chegara: 2000 belgi.
    # Hozirgi chaqiruvchilar 300 belgidan kam yozadi — ta'sir yo'q.
    if isinstance(detail, str) and len(detail) > 2000:
        detail = detail[:2000]

    # TIBEX_AUDIT_PHI_REDACTION_v1: before_data/after_data — sa.JSON (shifrlanmagan).
    # PHI nusxasi auditga tushmasligi uchun sezgir kalitlar qiymati hash'ga
    # almashtiriladi. Hash hisoblash redaktsiyadan KEYIN bo'ladi, shuning uchun
    # zanjir butunligi saqlanadi.
    if before is not None:
        before = _redact_phi(before)
    if after is not None:
        after = _redact_phi(after)

    is_pg = db.get_bind().dialect.name == "postgresql"
    if is_pg:
        # Tranzaksiya oxirigacha ushlab turiladi: zanjir ketma-ket yoziladi.
        await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_LOCK_KEY})

    last = (
        await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1))
    ).scalar_one_or_none()
    prev_hash = last.row_hash if last and last.row_hash else ZERO_HASH

    if is_pg:
        new_id = (await db.execute(
            text("SELECT nextval(pg_get_serial_sequence('audit_logs', 'id'))")
        )).scalar_one()
    else:
        new_id = ((last.id if last else 0) + 1)
    created_at = datetime.now(timezone.utc)

    row_hash = compute_row_hash(
        prev_hash, id=new_id, user=user, role=role, action=action, detail=detail,
        before=before, after=after, ip=ip, created_at=created_at,
    )
    log = AuditLog(
        id=new_id, user=user, role=role, action=action, detail=detail,
        before_data=before, after_data=after, ip=ip,
        prev_hash=prev_hash, row_hash=row_hash, created_at=created_at, legacy=False,
    )
    db.add(log)
    await db.flush()
    if _should_publish(user, action):
        await publish("audit.created", {
            "id": log.id, "user": log.user, "role": log.role,
            "action": log.action, "detail": log.detail,
            "ts": int(created_at.timestamp() * 1000),
        })
    return log


async def verify_audit_chain(db: AsyncSession, from_id: int | None = None) -> dict:
    """Zanjirni boshidan (yoki from_id dan) qayta hisoblaydi.

    `legacy=True` qatorlar (created_at saqlanmagan davr) uchun faqat
    prev_hash bog'liqligi tekshiriladi. Qaytaradi: ok, checked, broken_id.
    """
    from ..models import AuditLog

    stmt = select(AuditLog).order_by(AuditLog.id.asc())
    if from_id is not None:
        stmt = stmt.where(AuditLog.id >= from_id)
    prev = None
    if from_id is not None:
        prev = (await db.execute(
            select(AuditLog.row_hash).where(AuditLog.id < from_id).order_by(AuditLog.id.desc()).limit(1)
        )).scalar_one_or_none()
    expected_prev = prev if prev else ZERO_HASH
    checked = 0
    result = await db.stream_scalars(stmt.execution_options(yield_per=500))
    async for r in result:
        checked += 1
        if (r.prev_hash or ZERO_HASH) != expected_prev:
            return {"ok": False, "checked": checked, "broken_id": r.id, "reason": "prev_hash"}
        if not r.legacy:
            calc = compute_row_hash(
                r.prev_hash or ZERO_HASH, id=r.id, user=r.user, role=r.role, action=r.action,
                detail=r.detail, before=r.before_data, after=r.after_data, ip=r.ip,
                created_at=r.created_at,
            )
            if calc != r.row_hash:
                return {"ok": False, "checked": checked, "broken_id": r.id, "reason": "row_hash"}
        expected_prev = r.row_hash or ZERO_HASH
    return {"ok": True, "checked": checked, "broken_id": None}


async def count_rows(db: AsyncSession) -> int:
    from ..models import AuditLog
    return (await db.execute(select(func.count()).select_from(AuditLog))).scalar() or 0


async def audit_view(db: AsyncSession, user, request, detail: str):
    """PHI o'qishni audit qiladi: faqat ID/son yoziladi (ism, tashxis — hech qachon)."""
    from ..deps import client_ip

    return await log_action(
        db, user=user.fullname, role=user.role_key, action="view",
        detail=detail[:300], ip=client_ip(request),
    )