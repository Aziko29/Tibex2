"""Eksport va bulk SMS routeri."""
import csv
import html
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import client_ip, get_current_user, require_csrf, require_permission
from ..models import (
    Appointment, AuditLog, LabOrder, Patient, Payment, Refund, Role, User,
)
from ..security.audit import log_action

router = APIRouter()


def _csv(rows: list[list], filename: str) -> Response:
    """CSV javob (Excel-compatible, UTF-8 BOM).

    TIBEX_SUPER_FIX_v2.1: .xlsx nomini .csv ga almashtiradi.
    """
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        # Spreadsheet programs execute formula-prefixed text when a CSV is
        # opened. Escape text values only (negative numeric amounts stay numeric).
        w.writerow([
            ("'" + value if isinstance(value, str) and value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")) else value)
            for value in r
        ])
    content = "\ufeff" + buf.getvalue()
    safe_name = filename.replace(".xlsx", ".csv")
    return Response(
        content=content.encode("utf-8"),
        media_type="application/vnd.ms-excel; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


def _html_report(title: str, body: str, nonce: str) -> HTMLResponse:
    title = html.escape(str(title), quote=True)
    document = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style nonce="{html.escape(nonce, quote=True)}">
body {{ font-family: -apple-system, "Segoe UI", sans-serif; padding: 30px; color: #1a2332; }}
h1 {{ font-size: 22px; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }}
th {{ background: #f1f5f9; text-align: left; padding: 8px 10px; border-bottom: 1px solid #cbd5e1; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #64748b; }}
td {{ padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }}
.meta {{ color: #64748b; font-size: 12px; margin-bottom: 16px; }}
.no-print {{ margin: 20px 0; }}
#print-report {{ padding:8px 16px;background:#1e40af;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600; }}
@media print {{ .no-print {{ display: none; }} body {{ padding: 10px; }} }}
</style></head>
<body>
<h1>{title}</h1>
<div class="meta">Yaratilgan: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</div>
<div class="no-print"><button id="print-report" type="button">🖨 Chop etish</button></div>
{body}
<script nonce="{html.escape(nonce, quote=True)}">document.getElementById('print-report').addEventListener('click', () => window.print());</script>
</body></html>"""
    return HTMLResponse(content=document)


def _toa(ts) -> str:
    if not ts: return ""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
    return ts.strftime("%Y-%m-%d %H:%M") if hasattr(ts, "strftime") else str(ts)


def _doctor_appointments(user: User):
    """Query fragment limiting clinicians to their own assigned appointments."""
    if user.role_key != "doctor":
        return None
    if user.doctor_id is None:
        return Appointment.id == -1
    return Appointment.doctor_id == user.doctor_id


# ═══════════════════ PAYMENTS XLSX ═══════════════════
@router.get("/export/payments.xlsx")
async def export_payments(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("reports", "export")),
    _domain_perm: Role = Depends(require_permission("payments", "view")),
):
    query = select(Payment)
    if user.role_key == "doctor":
        appt_scope = _doctor_appointments(user)
        query = query.where(Payment.appointment_id.in_(select(Appointment.id).where(appt_scope)))
    rows = (await db.execute(query.order_by(Payment.created_at.desc()).limit(10000))).scalars().all()
    header = ["ID", "Sana", "Bemor ID", "Qabul ID", "Summa", "Usul", "Kassir", "Holat"]
    data = [header]
    for p in rows:
        data.append([p.id, _toa(p.created_at), p.patient_id, p.appointment_id,
                     p.amount, p.method, p.cashier, p.status])
    await log_action(db, user=user.fullname, role=user.role_key, action="payment",
                     detail=f"Eksport: to'lovlar ({len(rows)} ta)", ip=client_ip(request))
    return _csv(data, f"payments_{datetime.now().strftime('%Y%m%d')}.csv")


@router.get("/export/payments.pdf")
async def export_payments_pdf(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("reports", "view")),
    _domain_perm: Role = Depends(require_permission("payments", "view")),
):
    query = select(Payment)
    if user.role_key == "doctor":
        query = query.where(Payment.appointment_id.in_(select(Appointment.id).where(_doctor_appointments(user))))
    rows = (await db.execute(query.order_by(Payment.created_at.desc()).limit(500))).scalars().all()
    body = "<table><tr><th>ID</th><th>Sana</th><th>Summa</th><th>Usul</th><th>Kassir</th></tr>"
    for p in rows:
        body += "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>".format(
            html.escape(str(p.id)), html.escape(_toa(p.created_at)),
            html.escape(f"{p.amount:,}"), html.escape(str(p.method or "")),
            html.escape(str(p.cashier or "")),
        )
    body += "</table>"
    return _html_report("To'lovlar hisoboti", body, getattr(request.state, "csp_nonce", ""))


@router.get("/export/refunds.xlsx")
async def export_refunds(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("reports", "export")),
    _domain_perm: Role = Depends(require_permission("payments", "view")),
):
    query = select(Refund)
    if user.role_key == "doctor":
        doctor_payments = select(Payment.id).where(Payment.appointment_id.in_(select(Appointment.id).where(_doctor_appointments(user))))
        query = query.where(Refund.payment_id.in_(doctor_payments))
    rows = (await db.execute(query.order_by(Refund.created_at.desc()).limit(5000))).scalars().all()
    data = [["ID", "Sana", "Bemor", "Summa", "Sabab", "Kassir"]]
    for r in rows:
        data.append([r.id, _toa(r.created_at), r.patient_id, r.amount, r.reason, r.cashier])
    return _csv(data, f"refunds_{datetime.now().strftime('%Y%m%d')}.csv")


@router.get("/export/appointments.xlsx")
async def export_appointments(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("reports", "export")),
    _domain_perm: Role = Depends(require_permission("appointments", "view")),
):
    query = select(Appointment)
    scope = _doctor_appointments(user)
    if scope is not None:
        query = query.where(scope)
    rows = (await db.execute(query.order_by(Appointment.id.desc()).limit(5000))).scalars().all()
    data = [["ID", "Sana", "Vaqt", "Bemor ID", "Shifokor", "Holat", "To'langan", "Qarz"]]
    for a in rows:
        data.append([a.id, a.date, a.scheduled_time, a.patient_id, a.doctor_name,
                     a.status, a.paid, a.debt])
    return _csv(data, f"appointments_{datetime.now().strftime('%Y%m%d')}.csv")


@router.get("/export/patients.xlsx")
async def export_patients(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("reports", "export")),
    _domain_perm: Role = Depends(require_permission("patients", "view")),
):
    query = select(Patient)
    if user.role_key == "doctor":
        scope = _doctor_appointments(user)
        patient_ids = select(Appointment.patient_id).where(scope)
        query = query.where(Patient.id.in_(patient_ids))
    rows = (await db.execute(query.order_by(Patient.id.desc()).limit(10000))).scalars().all()
    data = [["ID", "F.I.Sh", "Telefon", "Yosh", "Jins", "Qon"]]
    for p in rows:
        data.append([p.id, p.fullname, p.phone_enc or "", p.age, p.gender, p.blood])
    return _csv(data, f"patients_{datetime.now().strftime('%Y%m%d')}.csv")


@router.get("/export/audit.xlsx")
async def export_audit(
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("audit", "view")),
):
    rows = (await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(10000))).scalars().all()
    data = [["ID", "Vaqt", "Foydalanuvchi", "Rol", "Amal", "Tafsilot", "IP"]]
    for a in rows:
        data.append([a.id, _toa(a.created_at), a.user, a.role, a.action, a.detail, a.ip or ""])
    return _csv(data, f"audit_{datetime.now().strftime('%Y%m%d')}.csv")


@router.get("/export/lab_orders.xlsx")
async def export_lab(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("reports", "export")),
    _domain_perm: Role = Depends(require_permission("lab", "view")),
):
    query = select(LabOrder)
    if user.role_key == "doctor":
        appt_ids = select(Appointment.id).where(_doctor_appointments(user))
        query = query.where(LabOrder.appointment_id.in_(appt_ids))
    rows = (await db.execute(query.order_by(LabOrder.created_at.desc()).limit(5000))).scalars().all()
    data = [["ID", "Sana", "Bemor", "Tahlil", "Holat", "Natija", "Shifokor"]]
    for o in rows:
        data.append([o.id, _toa(o.created_at), o.patient_id, o.test_name,
                     o.status, o.result_summary or "", o.ordered_by])
    return _csv(data, f"lab_orders_{datetime.now().strftime('%Y%m%d')}.csv")


@router.get("/export/debtors.xlsx")
async def export_debtors(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("reports", "export")),
    _domain_perm: Role = Depends(require_permission("payments", "view")),
):
    query = select(Appointment).where(Appointment.debt > 0)
    scope = _doctor_appointments(user)
    if scope is not None:
        query = query.where(scope)
    rows = (await db.execute(query.order_by(Appointment.debt.desc()))).scalars().all()
    data = [["Qabul", "Sana", "Bemor ID", "Shifokor", "Qarz", "Holat"]]
    for a in rows:
        data.append([a.id, a.date, a.patient_id, a.doctor_name, a.debt, a.status])
    return _csv(data, f"debtors_{datetime.now().strftime('%Y%m%d')}.csv")


@router.get("/export/all.json")
async def export_all(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _perm: Role = Depends(require_permission("settings", "edit")),
):
    """To'liq DB snapshot (JSON, backup maqsadida)."""
    if user.role_key != "superadmin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "To'liq zaxira faqat superadmin uchun")
    import json
    from ..models import Doctor, Equipment, Integration, Reagent, Service
    out = {}
    for model in (Patient, Appointment, LabOrder, Payment, Refund, AuditLog,
                  Doctor, Service, Equipment, Reagent, Integration):
        rows = (await db.execute(select(model))).scalars().all()
        items = []
        for r in rows:
            d = {c.name: getattr(r, c.name) for c in model.__table__.columns}
            for k, v in list(d.items()):
                if hasattr(v, "isoformat"): d[k] = v.isoformat()
            items.append(d)
        out[model.__tablename__] = items
    payload = json.dumps(out, ensure_ascii=False, default=str)
    await log_action(
        db, user=user.fullname, role=user.role_key, action="export",
        detail="To'liq ma'lumotlar bazasi zaxirasi yuklandi", ip=client_ip(request),
    )
    return Response(
        content=payload.encode("utf-8"),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="tibex_backup_{datetime.now().strftime("%Y%m%d_%H%M")}.json"'},
    )


# ═══════════════════ BULK SMS ═══════════════════
class BulkSmsIn(BaseModel):
    phone_numbers: list[str] = Field(..., max_length=500)
    message: str = Field(..., min_length=1, max_length=500)


@router.post("/sms/send-bulk", dependencies=[Depends(require_csrf)])
async def send_bulk_sms(
    body: BulkSmsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _perm: Role = Depends(require_permission("patients", "view")),
):
    """SMS ataylab o'chirilgan; klinika kirish kodlari Telegram/admin orqali."""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="SMS xizmati o'chirilgan. Bemor kirish kodi Telegram bot yoki administrator orqali beriladi.",
    )
