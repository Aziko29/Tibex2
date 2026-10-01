#!/usr/bin/env python3
"""Shifokor roli bor, lekin doctor_id yo'q xodimlarni topadi va kartochka yaratib bog'laydi.

Oldin ko'rish (hech narsa o'zgarmaydi):   python fix_doctor_cards.py
Tuzatish:                                 python fix_doctor_cards.py --apply --specialty "Terapevt"

Muhit: TIBEX_ADMIN_PASSWORD (yoki so'raydi), TIBEX_ADMIN_LOGIN, TIBEX_URL.
Talab: backend'da yangi users.py (specialty qo'llab-quvvatlanadigan) ishlayotgan bo'lishi kerak.
"""
import argparse

import httpx

from tibex_testkit import BASE, LOGIN, get_password

COOKIE = "__Host-cf_session"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--specialty", default="")
    a = ap.parse_args()

    c = httpx.Client(base_url=BASE, timeout=30)
    r = c.post("/api/auth/login", json={"username": LOGIN, "password": get_password()})
    if r.status_code != 200:
        raise SystemExit(f"Login xato: {r.status_code} {r.text[:120]}")
    csrf = r.json()["csrf_token"]
    sess = next((x for x in r.headers.get_list("set-cookie") if x.startswith(COOKIE + "=")), "")
    c.headers["Cookie"] = sess.split(";", 1)[0]

    users = c.get("/api/users").json()
    broken = [u for u in users if u.get("role") == "doctor" and not u.get("doctor_id")]
    if not broken:
        print("Buzuq shifokor-xodim yo'q.")
        return
    for u in broken:
        print(f"Buzuq: id={u['id']} login={u.get('login')} ism={u.get('fullname')}")
    if not a.apply:
        print("\nTuzatish uchun: python fix_doctor_cards.py --apply --specialty \"Terapevt\"")
        return
    if not a.specialty.strip():
        raise SystemExit("--specialty kerak")
    for u in broken:
        r = c.patch(f"/api/users/{u['id']}", headers={"X-CSRF-Token": csrf},
                    json={"specialty": a.specialty.strip()})
        ok = r.status_code == 200 and r.json().get("doctor_id")
        print(f"id={u['id']}: {'OK doctor_id=' + str(r.json().get('doctor_id')) if ok else 'XATO ' + str(r.status_code) + ' ' + r.text[:120]}")


if __name__ == "__main__":
    main()
