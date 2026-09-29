"""TIBEX State Machine — markazlashgan status o'tishlari.

Tamoyillar:
  • Har bir status o'tish markazda saqlanadi (TRANSITIONS)
  • Biznes qoidalari (debt, vaqt, rol) shu yerda
  • Yakuniy holatlar o'zgarmas
  • Har bir o'tish audit'ga yoziladi

Rollar bo'yicha ruxsat:
  • reception — waiting, arrived, delayed, cancelled, no_show
  • doctor — in_progress, lab_waiting, lab_ready, completed
  • lab — lab_waiting, lab_ready (faqat lab.py orqali)
  • cashier — completed (faqat qarz yopilgan bo'lsa)
  • admin — barcha
"""
from typing import Optional

from fastapi import HTTPException, status as http_status


# ═══════════════════════════════════════════════════════════
# QABULLAR (Appointment) STATUS O'TISHLARI
# ═══════════════════════════════════════════════════════════
APPOINTMENT_TRANSITIONS: dict[str, set[str]] = {
    "waiting":     {"arrived", "in_progress", "delayed", "cancelled", "no_show"},
    "arrived":     {"in_progress", "delayed", "cancelled", "no_show"},
    "in_progress": {"lab_waiting", "completed", "delayed", "cancelled"},
    "lab_waiting": {"lab_ready", "completed", "cancelled"},
    "lab_ready":   {"completed", "cancelled"},
    "delayed":     {"waiting", "arrived", "in_progress", "cancelled", "no_show"},
    # Yakuniy holatlar
    "completed":   set(),
    "cancelled":   set(),
    "no_show":     set(),
}

# Qaysi rol qaysi status'ni qo'ya oladi
APPOINTMENT_ROLE_PERMISSIONS: dict[str, set[str]] = {
    "reception": {"arrived", "delayed", "cancelled", "no_show"},
    "doctor":    {"in_progress", "lab_waiting", "lab_ready", "completed", "delayed"},
    "cashier":   {"completed"},  # Faqat qarz yopilgach
    "lab":       {"lab_waiting", "lab_ready"},
    "admin":     {
        "waiting", "arrived", "in_progress", "lab_waiting", "lab_ready",
        "completed", "delayed", "cancelled", "no_show",
    },
    "superadmin": {
        "waiting", "arrived", "in_progress", "lab_waiting", "lab_ready",
        "completed", "delayed", "cancelled", "no_show",
    },
}


# ═══════════════════════════════════════════════════════════
# LAB STATUS O'TISHLARI
# ═══════════════════════════════════════════════════════════
LAB_TRANSITIONS: dict[str, set[str]] = {
    "new":        {"received", "cancelled"},
    "received":   {"processing", "cancelled"},
    "processing": {"ready", "cancelled"},
    "ready":      {"verified", "cancelled"},
    # Yakuniy
    "verified":   set(),
    "cancelled":  set(),
}


# ═══════════════════════════════════════════════════════════
# VALIDATSIYA FUNKSIYALARI
# ═══════════════════════════════════════════════════════════
def validate_appointment_transition(
    current: str,
    target: str,
    appointment=None,
    actor_role: str = "admin",
) -> tuple[bool, str]:
    """Qabul status o'tishini tekshiradi.

    Returns:
        (True, "") — ruxsat berilgan
        (False, "Xabar") — rad etilgan
    """
    if not target or target == current:
        return True, ""

    # 1. Holat mavjudmi?
    if current not in APPOINTMENT_TRANSITIONS:
        return False, f"Noma'lum status: {current}"
    if target not in APPOINTMENT_TRANSITIONS:
        return False, f"Noma'lum status: {target}"

    # 2. O'tish ruxsat etilganmi?
    allowed = APPOINTMENT_TRANSITIONS[current]
    if target not in allowed:
        if not allowed:
            return False, f"'{current}' yakuniy holat — o'zgartirib bo'lmaydi"
        return False, (
            f"'{current}' dan '{target}' ga o'tish mumkin emas. "
            f"Ruxsat etilgan: {', '.join(sorted(allowed))}"
        )

    # 3. Rol ruxsati bormi?
    role_perms = APPOINTMENT_ROLE_PERMISSIONS.get(actor_role, set())
    if target not in role_perms:
        return False, (
            f"Sizning rolingiz ({actor_role}) '{target}' statusini "
            f"qo'ya olmaydi"
        )

    # 4. BIZNES QOIDALARI
    if appointment is not None:
        # 4a. Yakunlash faqat qarzsiz
        if target == "completed":
            debt = getattr(appointment, "debt", 0) or 0
            if debt > 0:
                return False, (
                    f"Qarz yopilmagan: {debt:,} so'm. "
                    f"Kassaga murojaat qiling."
                )

        # 4b. Lab jarayonida bo'lgan qabulni yakunlash mumkin emas
        if current == "lab_waiting" and target == "completed":
            return False, (
                "Lab natijalari tayyor emas. "
                "Lab tasdiqlagach yakunlang."
            )

        # 4c. Qabul qilingan bemor (arrived) dan to'g'ridan-to'g'ri completed
        # faqat shifokor uchun
        if current == "arrived" and target == "completed":
            if actor_role not in ("admin", "superadmin", "doctor"):
                return False, "Faqat shifokor qabulni yakunlay oladi"

    return True, ""


def validate_lab_transition(
    current: str,
    target: str,
    lab_order=None,
) -> tuple[bool, str]:
    """Lab so'rov status o'tishini tekshiradi."""
    if not target or target == current:
        return True, ""

    if current not in LAB_TRANSITIONS:
        return False, f"Noma'lum lab status: {current}"
    if target not in LAB_TRANSITIONS:
        return False, f"Noma'lum lab status: {target}"

    allowed = LAB_TRANSITIONS[current]
    if target not in allowed:
        if not allowed:
            return False, f"'{current}' yakuniy holat"
        return False, (
            f"'{current}' dan '{target}' ga o'tish mumkin emas. "
            f"Ruxsat etilgan: {', '.join(sorted(allowed))}"
        )

    # Biznes qoidalar
    if lab_order is not None:
        # Tasdiqlashdan oldin natija bo'lishi shart
        if target == "verified":
            if not getattr(lab_order, "result_data", None):
                return False, "Natija kiritilmagan — tasdiqlab bo'lmaydi"
        # Ready holatida result_summary bo'lishi kerak
        if target == "ready":
            if not getattr(lab_order, "result_summary", None):
                return False, "Natija xulosasi kiritilmagan"

    return True, ""


def is_final_appointment_status(status: str) -> bool:
    """Yakuniy holatmi?"""
    return status in ("completed", "cancelled", "no_show")


def is_final_lab_status(status: str) -> bool:
    return status in ("verified", "cancelled")


def raise_if_invalid_appointment(current, target, appointment=None, actor_role="admin"):
    """Yaroqsiz bo'lsa HTTPException ko'taradi."""
    ok, msg = validate_appointment_transition(current, target, appointment, actor_role)
    if not ok:
        raise HTTPException(http_status.HTTP_409_CONFLICT, msg)


def raise_if_invalid_lab(current, target, lab_order=None):
    ok, msg = validate_lab_transition(current, target, lab_order)
    if not ok:
        raise HTTPException(http_status.HTTP_409_CONFLICT, msg)
