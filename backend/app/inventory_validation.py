"""Uskuna / reagent / integratsiya uchun umumiy kirish tekshiruvi.

Barcha xatolar 422 (HTTPException) qaytaradi — DB ustun uzunligi yoki NOT NULL
buzilishidan keladigan 500 xatolar oldi olinadi.
"""
from __future__ import annotations

import math
from datetime import datetime

from fastapi import HTTPException, status

EQUIPMENT_STATUSES = frozenset({"working", "calibration", "maintenance", "broken", "offline"})
INTEGRATION_TYPES = frozenset({
    "website", "mobile_app", "ai_model", "device", "payment",
    "telegram", "webhook", "database", "other", "sms",
})
INTEGRATION_STATUSES = frozenset({"connected", "pending", "disconnected", "error", "disabled"})

# Maydon -> (maks. uzunlik, NOT NULL)
EQUIPMENT_FIELDS = {
    "name": (200, True), "category": (64, True), "department": (64, True),
    "manufacturer": (128, False), "model": (128, False), "serial": (128, False),
    "location": (128, False), "status": (32, True), "notes": (5000, False),
}
EQUIPMENT_DATES = ("purchase_date", "warranty", "last_service", "next_service")

REAGENT_FIELDS = {
    "name": (200, True), "category": (64, True), "unit": (16, True),
    "lot": (64, False), "supplier": (128, False), "notes": (5000, False),
}
REAGENT_NUMBERS = ("stock", "min_stock")
MAX_STOCK = 1_000_000_000

INTEGRATION_FIELDS = {
    "name": (200, True), "type": (32, True), "status": (32, True),
    "provider": (64, False), "version": (32, False), "endpoint": (500, False),
    "api_key": (2000, False), "notes": (5000, False),
}


def _bad(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)


def clean_text(value, field: str, max_len: int, required: bool) -> str:
    if value is None:
        if required:
            raise _bad(f"'{field}' bo'sh bo'lishi mumkin emas")
        return ""
    if not isinstance(value, str):
        raise _bad(f"'{field}' matn bo'lishi kerak")
    value = value.strip()
    if required and not value:
        raise _bad(f"'{field}' bo'sh bo'lishi mumkin emas")
    if len(value) > max_len:
        raise _bad(f"'{field}' juda uzun (maksimum {max_len} belgi)")
    return value


def clean_date(value, field: str) -> str:
    if value is None or value == "":
        return ""
    if not isinstance(value, str):
        raise _bad(f"'{field}' sana (YYYY-MM-DD) bo'lishi kerak")
    value = value.strip()
    if len(value) != 10:
        raise _bad(f"'{field}' sanasi YYYY-MM-DD formatida bo'lishi kerak")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise _bad(f"'{field}' sanasi YYYY-MM-DD formatida bo'lishi kerak") from None
    return value


def clean_number(value, field: str) -> float:
    if value is None or isinstance(value, bool):
        raise _bad(f"'{field}' son bo'lishi kerak")
    try:
        num = float(value)
    except (TypeError, ValueError):
        raise _bad(f"'{field}' son bo'lishi kerak") from None
    if not math.isfinite(num):
        raise _bad(f"'{field}' to'g'ri son bo'lishi kerak")
    if num < 0:
        raise _bad(f"'{field}' manfiy bo'lishi mumkin emas")
    if num > MAX_STOCK:
        raise _bad(f"'{field}' juda katta")
    return num


def _choice(value: str, field: str, allowed) -> str:
    if value not in allowed:
        raise _bad(f"'{field}' qiymati noto'g'ri: {value!r}")
    return value


def _run(data: dict, partial: bool, texts: dict, dates=(), numbers=()) -> dict:
    """`data` ichidagi faqat berilgan kalitlarni tekshiradi (partial=True da)."""
    out: dict = {}
    for key, (max_len, required) in texts.items():
        if key in data:
            out[key] = clean_text(data[key], key, max_len, required)
        elif not partial and required:
            raise _bad(f"'{key}' majburiy")
    for key in dates:
        if key in data:
            out[key] = clean_date(data[key], key)
    for key in numbers:
        if key in data:
            out[key] = clean_number(data[key], key)
        elif not partial:
            out[key] = 0.0
    return out


def validate_equipment(data: dict, partial: bool = False) -> dict:
    out = _run(data, partial, EQUIPMENT_FIELDS, EQUIPMENT_DATES)
    if "status" in out:
        _choice(out["status"], "status", EQUIPMENT_STATUSES)
    return out


def validate_reagent(data: dict, partial: bool = False) -> dict:
    return _run(data, partial, REAGENT_FIELDS, numbers=REAGENT_NUMBERS) | _reagent_dates(data)


def _reagent_dates(data: dict) -> dict:
    return {"expiry": clean_date(data["expiry"], "expiry")} if "expiry" in data else {}


def validate_integration(data: dict, partial: bool = False) -> dict:
    out = _run(data, partial, INTEGRATION_FIELDS)
    if "type" in out:
        _choice(out["type"].lower(), "type", INTEGRATION_TYPES)
        out["type"] = out["type"].lower()
    if "status" in out:
        _choice(out["status"], "status", INTEGRATION_STATUSES)
    return out
