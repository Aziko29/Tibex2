"""Integratsiyalarni yagona serializatsiya qilish va rol bo'yicha ko'rinish chegarasi.

Laborant faqat `device`, kassir faqat `payment` turini ko'radi; ularga endpoint,
izoh va API kalit holati yashiriladi. Boshqa rollar (admin va h.k.) hammasini ko'radi.
"""
from __future__ import annotations

ROLE_TYPE_SCOPE: dict[str, frozenset[str]] = {
    "lab": frozenset({"device"}),
    "cashier": frozenset({"payment"}),
}


def type_scope(role_key: str | None) -> frozenset[str] | None:
    """None = cheklov yo'q."""
    return ROLE_TYPE_SCOPE.get(role_key or "")


def filter_for_role(items, role_key: str | None):
    scope = type_scope(role_key)
    if scope is None:
        return list(items)
    return [i for i in items if str(i.type or "").lower() in scope]


def serialize_integration(i, role_key: str | None = None, mask_key: bool = True) -> dict:
    """API va bootstrap uchun yagona format. api_key hech qachon qaytmaydi (mask_key=True)."""
    sms_disabled = str(i.type or "").lower() == "sms"
    restricted = type_scope(role_key) is not None
    return {
        "id": i.id,
        "name": i.name,
        "type": i.type,
        "provider": i.provider,
        "version": i.version,
        "endpoint": None if restricted else i.endpoint,
        "api_key": None if (mask_key or sms_disabled or restricted) else i.api_key,
        "has_api_key": False if (sms_disabled or restricted) else bool(i.api_key),
        "status": "disabled" if sms_disabled else i.status,
        "notes": None if restricted else i.notes,
        "last_sync": int(i.last_sync.timestamp() * 1000) if i.last_sync else None,
    }
