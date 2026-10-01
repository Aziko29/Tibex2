#!/usr/bin/env python3
"""TIBEX admin API testi v2 (chuqur: autentifikatsiya, RBAC, CSRF, CRUD x8, validatsiya, audit, eksport).

Ishga tushirish (backend ishlab turishi kerak):   python admin_api_check.py
Xavfsizlik: faqat "TEST_AUTO" belgili yozuvlar yaratiladi va oxirida o'chiriladi. audit/clear, SMS,
demo-reset, secure-delete, integratsiya sync kabi xavfli yo'llarga TEGILMAYDI.
Skaner-yo'l tekshiruvi (/.env, /.git) alohida: TIBEX_SCANNER_PROBES=1 (IP 5 daqiqaga bloklanishi mumkin).
"""
from __future__ import annotations

import json
import os
import random
import re
import string
import sys
import time
import uuid

import httpx

from tibex_testkit import BASE, LOGIN, Recorder, get_password, setup_console

setup_console()
PASSWORD = get_password()
R = Recorder("API", BASE)
R.add_secret(PASSWORD)
SLOW_MS = 1500
COOKIE = "__Host-cf_session"
STRONG = "Zq7!vRt#92xLm"  # test foydalanuvchi uchun (hisobotga tushmaydi)
R.add_secret(STRONG)
RUN = uuid.uuid4().hex[:6]
leak_flagged: set[str] = set()


def short(r) -> str:
    return "javob yo'q" if r is None else f"HTTP {r.status_code}: {r.text[:160]!r}"


def blocked(r) -> bool:
    return r is not None and r.status_code == 403 and "retry_in" in r.text


class Api:
    def __init__(self, name: str):
        self.name, self.csrf = name, ""
        self.c = httpx.Client(base_url=BASE, timeout=30, follow_redirects=False)

    def __call__(self, method: str, path: str, *, csrf: bool = False, **kw):
        h = dict(kw.pop("headers", None) or {})
        if csrf and self.csrf:
            h["X-CSRF-Token"] = self.csrf
        r, ms = None, 0.0
        for attempt in range(4):
            time.sleep(0.25)  # server rate-limit (429) ga tushmaslik uchun
            t0 = time.perf_counter()
            try:
                r = self.c.request(method, path, headers=h, **kw)
            except Exception as exc:
                return None, (time.perf_counter() - t0) * 1000, str(exc)
            ms = (time.perf_counter() - t0) * 1000
            if r.status_code == 429 and attempt < 3:
                m = re.search(r"(\d+)\s*sekund", r.text)
                time.sleep(min(float(m.group(1)) if m else 2, 10) + 0.5)
                continue
            break
        if method == "GET":
            R.timings.append({"path": path.split("?")[0], "ms": round(ms)})
        if r.status_code >= 500:
            R.add("FAIL", f"[{self.name}] Server xatosi 5xx: {method} {path}", short(r), sev="high", ms=ms)
        if r.status_code == 200:
            body = r.text
            if path.startswith("/api/monitoring/errors"):
                # xato jurnalidagi "path" maydoni testning o'z skaner-yo'llarini (masalan master_key_b64.txt) saqlaydi -> soxta signal
                try:
                    d = r.json()
                    for it in d.get("items", []):
                        it.pop("path", None)
                    body = json.dumps(d, ensure_ascii=False)
                except Exception:
                    pass
            for needle in ("password_hash", "PRIVATE KEY", "master_key", PASSWORD, STRONG):
                if needle in body and needle not in leak_flagged:
                    if needle == PASSWORD and len(PASSWORD) < 8:
                        continue  # qisqa parol oddiy so'zlarga tasodifan mos keladi
                    leak_flagged.add(needle)
                    label = needle if needle in ("password_hash", "PRIVATE KEY", "master_key") else (
                        "admin paroli" if needle == PASSWORD else "test parol")
                    i = body.find(needle)
                    ctx = body[max(0, i - 60):i].replace(needle, "***") if label in ("admin paroli", "test parol") else body[max(0, i - 60):i + 60]
                    R.add("FAIL", f"Javobda maxfiy ma'lumot izi ({label}): {path}", f"...{ctx}...", sev="critical")
        return r, ms, ""

    def login(self, login: str, password: str):
        r, ms, err = self("POST", "/api/auth/login", json={"username": login, "password": password})
        if r is not None and r.status_code == 200:
            self.csrf = r.json().get("csrf_token", "")
            R.add_secret(self.csrf)
            sess = next((c for c in r.headers.get_list("set-cookie") if c.startswith(COOKIE + "=")), "")
            if sess:  # Secure cookie http:// da yuborilmaydi — qo'lda ulaymiz
                self.c.headers["Cookie"] = sess.split(";", 1)[0]
                R.add_secret(sess.split(";", 1)[0].split("=", 1)[1])
        return r, ms, err


def rows_of(r):
    try:
        d = r.json()
    except Exception:
        return []
    return d if isinstance(d, list) else (d.get("items") or [])


def jget(r, key, default=None):
    try:
        return r.json().get(key, default)
    except Exception:
        return default


def main() -> int:
    anon, adm = Api("anon"), Api("admin")
    print(f"\n=== TIBEX admin API testi v2: {BASE} ===")

    # ---------------------------------------------------------------- 1
    R.begin("1. Server holati")
    r, ms, err = anon("GET", "/api/health")
    if not R.check(r is not None and r.status_code == 200, "GET /api/health", err or short(r), sev="critical", ms=ms):
        print("\nBackend javob bermayapti (start-backend.bat). Tavsiya: TIBEX_URL=http://127.0.0.1:8000")
        return R.finish("admin_api_report.json")
    if "localhost" in BASE and ms > 1000:
        R.add("WARN", "localhost sekin (IPv6->IPv4 kechikishi)", f"{round(ms)} ms. 127.0.0.1 ishlating", sev="low")

    # ---------------------------------------------------------------- 2
    R.begin("2. Loginsiz kirish yopiqmi")
    protected = ["/api/users", "/api/patients", "/api/appointments", "/api/lab-orders", "/api/payments",
                 "/api/refunds", "/api/shift", "/api/doctors", "/api/services", "/api/equipment", "/api/reagents",
                 "/api/roles", "/api/integrations", "/api/settings", "/api/audit", "/api/bootstrap",
                 "/api/monitoring/errors", "/api/monitoring/security-status", "/api/export/all.json",
                 "/api/export/patients.xlsx", "/api/auth/me"]
    for p in protected:
        r, ms, _ = anon("GET", p)
        R.check(r is not None and r.status_code in (401, 403), f"Loginsiz {p} -> 401/403", short(r), sev="critical", ms=ms)
    for m, p in (("POST", "/api/patients"), ("DELETE", "/api/users/1"), ("PATCH", "/api/settings")):
        r, ms, _ = anon(m, p, json={})
        R.check(r is not None and r.status_code in (401, 403), f"Loginsiz {m} {p} -> 401/403", short(r), sev="critical")
    r, _, _ = anon("GET", "/api/ws")
    R.check(r is None or r.status_code != 200, "WebSocket /api/ws loginsiz oddiy GET bilan ochilmaydi", short(r), sev="high")

    # ---------------------------------------------------------------- 3
    R.begin("3. Admin login va sessiya cookie")
    r, ms, err = adm.login(LOGIN, PASSWORD)
    if blocked(r):
        print("\nIP vaqtincha bloklangan (threat detector). 5 daqiqa kuting va qayta ishga tushiring.")
        R.add("FAIL", "Login: IP bloklangan", short(r), sev="high")
        return R.finish("admin_api_report.json")
    if not R.check(r is not None and r.status_code == 200, f"Login: {LOGIN}", err or short(r), sev="critical", ms=ms):
        return R.finish("admin_api_report.json")
    R.check(bool(adm.csrf), "Login javobida csrf_token bor", sev="high")
    role = r.json().get("user", {}).get("role")
    R.check(role in ("admin", "superadmin"), "Roli admin/superadmin", f"role={role}", sev="high")
    sess = next((c for c in r.headers.get_list("set-cookie") if c.startswith(COOKIE + "=")), "")
    low = sess.lower()
    R.check(bool(sess), f"Sessiya cookie'si {COOKIE}", sev="critical")
    for flag in ("httponly", "secure", "samesite", "path=/"):
        R.check(flag in low, f"Cookie atributi: {flag}", "yo'q", sev="high")
    R.check("domain=" not in low, "Cookie'da Domain yo'q (__Host- talabi)", "Domain bor", sev="medium")
    r, ms, _ = adm("GET", "/api/auth/me")
    R.check(r is not None and r.status_code == 200 and jget(r, "login") == LOGIN, "GET /api/auth/me login mos", short(r), ms=ms)

    # ---------------------------------------------------------------- 4
    R.begin("4. O'qish endpointlari (sxema + tezlik + sirlar)")
    gets = ["/api/bootstrap", "/api/users", "/api/doctors", "/api/patients", "/api/appointments", "/api/lab-orders",
            "/api/payments", "/api/refunds", "/api/shift", "/api/services", "/api/equipment", "/api/reagents",
            "/api/roles", "/api/integrations", "/api/settings", "/api/audit", "/api/audit/verify",
            "/api/monitoring/health", "/api/monitoring/errors", "/api/monitoring/alerts",
            "/api/monitoring/integrations", "/api/monitoring/activity", "/api/monitoring/security-status",
            "/api/monitoring/threat-map"]
    data: dict[str, list] = {}
    for p in gets:
        r, ms, err = adm("GET", p)
        ok = r is not None and r.status_code == 200
        if ok:
            try:
                r.json()
            except ValueError:
                ok = False
        R.check(ok, f"GET {p}", err or short(r), sev="high", ms=ms)
        if ok:
            data[p] = rows_of(r)
            if ms > SLOW_MS:
                R.add("WARN", f"GET {p} sekin", f"{round(ms)} ms > {SLOW_MS}", sev="low", ms=ms)
    users0 = data.get("/api/users", [])
    R.check(all("password" not in u and "password_hash" not in u for u in users0), "Xodimlar ro'yxatida parol maydoni yo'q", sev="critical")
    R.check(all(u.get("role") != "patient" for u in users0), "Xodimlar ro'yxatiga bemor akkauntlari aralashmagan", sev="medium")
    R.check(all("api_key" not in i or not i.get("api_key") for i in data.get("/api/integrations", [])),
            "Integratsiyalar ro'yxatida api_key qaytmaydi", sev="critical")
    ids = [u.get("id") for u in users0]
    R.check(len(ids) == len(set(ids)), "Xodim ID'lari takrorlanmaydi", sev="medium")
    roles0 = {x.get("key") for x in data.get("/api/roles", [])}
    R.check({"admin", "doctor", "reception", "cashier", "lab"} <= roles0, "Tizim rollari mavjud", f"bor: {sorted(roles0)}", sev="high")
    bad_roles = {u.get("role") for u in users0} - roles0
    R.check(not bad_roles, "Har bir xodim roli mavjud rollar ichida", f"noma'lum: {bad_roles}", sev="medium")
    docs = data.get("/api/doctors", [])
    doc_users = [u for u in users0 if u.get("role") == "doctor"]
    R.check(len(doc_users) == len(docs), "Shifokor-rolli xodimlar soni = shifokor kartochkalari soni",
            f"xodim(doctor)={len(doc_users)}, shifokorlar={len(docs)} (UI'dagi 5/3 va 2/1 farqi shundan)", sev="medium")
    r, _, _ = adm("GET", "/api/audit/verify")
    R.check(r is not None and jget(r, "ok") is True, "Audit zanjiri yaxlit (ok=true)", short(r), sev="high")

    R.begin("4b. Parametr chegaralari va inyeksiya")
    cases = [("/api/patients?limit=0", 422), ("/api/patients?limit=201", 422), ("/api/patients?offset=-1", 422),
             ("/api/audit?limit=501", 422), ("/api/patients/abc", 422), ("/api/patients/999999999", 404),
             ("/api/patients?q=" + "a" * 101, 422)]
    for p, want in cases:
        r, ms, _ = adm("GET", p)
        R.check(r is not None and r.status_code == want, f"GET {p[:50]} -> {want}", short(r), sev="medium", ms=ms)
    for q in ("%27%20OR%201%3D1--", "%25", "%3Cscript%3Ealert(1)%3C%2Fscript%3E", "..%2F..%2Fetc%2Fpasswd", "%00"):
        r, ms, _ = adm("GET", f"/api/patients?q={q}")
        R.check(r is not None and r.status_code in (200, 400, 422), f"Qidiruv q={q[:20]} 500 bermaydi", short(r), sev="high")

    # ---------------------------------------------------------------- 5
    R.begin("5. Eksport")
    for name in ("payments", "refunds", "appointments", "patients", "audit", "lab_orders", "debtors"):
        r, ms, err = adm("GET", f"/api/export/{name}.xlsx")
        ct = r.headers.get("content-type", "").lower() if r is not None else ""
        ok = r is not None and r.status_code == 200 and len(r.content) > 0 and any(k in ct for k in ("excel", "spreadsheet", "csv"))
        R.check(ok, f"Eksport {name}.xlsx", err or f"{short(r)} ctype={ct}", sev="medium", ms=ms)
        if ok:
            if not r.content.startswith(b"PK"):
                R.add("INFO", f"{name}.xlsx aslida CSV (haqiqiy .xlsx emas)")
            first = r.content.decode("utf-8-sig", "replace").splitlines()[:1]
            R.check(bool(first) and ("," in first[0] or ";" in first[0] or "\t" in first[0]), f"{name}: sarlavha qatori bor", sev="low", warn=True)
            R.check("password" not in r.text.lower(), f"{name}: eksportda parol so'zi yo'q", sev="high")
    r, ms, _ = adm("GET", "/api/export/payments.pdf")
    R.check(r is not None and r.status_code == 200 and ("pdf" in r.headers.get("content-type", "") or "html" in r.headers.get("content-type", "")),
            "Eksport payments.pdf", short(r), sev="medium", ms=ms)
    r, ms, _ = adm("GET", "/api/export/all.json")
    R.check(r is not None and r.status_code in (200, 403), "Eksport all.json (admin uchun 403 kutilgan)", short(r), sev="medium", ms=ms)

    # ---------------------------------------------------------------- 6
    R.begin("6. CSRF himoyasi")
    probe = {"code": "TESTCSRF", "name": "csrf", "category": "TEST", "price": 1}
    for label, hdr in (("tokensiz", {}), ("soxta token bilan", {"X-CSRF-Token": "abc.def"}), ("bo'sh token bilan", {"X-CSRF-Token": ""})):
        r, ms, _ = adm("POST", "/api/services", json=probe, headers=hdr)
        R.check(r is not None and r.status_code == 403, f"POST {label} rad etiladi (403)", short(r), sev="critical", ms=ms)
    for m, p in (("PATCH", "/api/settings"), ("DELETE", "/api/users/999999999"), ("POST", "/api/patients")):
        r, _, _ = adm(m, p, json={})
        R.check(r is not None and r.status_code == 403, f"{m} {p} tokensiz -> 403", short(r), sev="critical")

    # ---------------------------------------------------------------- 7
    R.begin("7. CRUD + validatsiya (8 ta bo'lim)")
    created: list[tuple[str, int]] = []
    ph = "+99890" + "".join(random.choices(string.digits, k=7))
    specs = [
        ("services", "/api/services", {"code": "TA" + RUN.upper(), "name": "TEST_AUTO xizmat", "category": "TEST", "price": 1000},
         {"price": 2000}, "price",
         [{"code": "", "name": "", "category": "", "price": -5}, {"code": "x", "name": "y", "category": "z", "price": "abc"},
          {"code": "A" * 65, "name": "y", "category": "z", "price": 1}, {"name": "faqat nom"}]),
        ("doctors", "/api/doctors", {"name": "TEST_AUTO Shifokor", "specialty": "TEST", "price": 5000, "room": "9"},
         {"price": 6000}, "price", [{"name": "", "specialty": ""}, {"name": "x", "specialty": "y", "price": -1}, {}]),
        ("equipment", "/api/equipment", {"name": "TEST_AUTO uskuna", "category": "Analizator", "status": "working"},
         {"status": "maintenance"}, "status",
         [{"name": ""}, {"name": "x", "status": "zzz"}, {"name": "x", "purchase_date": "2026-13-45"}, {"name": "A" * 201}]),
        ("reagents", "/api/reagents", {"name": "TEST_AUTO reagent", "unit": "ml", "stock": 10, "min_stock": 2},
         {"stock": 5}, "stock",
         [{"name": ""}, {"name": "x", "stock": -1}, {"name": "x", "stock": "abc"}, {"name": "x", "expiry": "31-12-2026"}]),
        ("roles", "/api/roles", {"key": "test_auto_" + RUN, "name": "TEST_AUTO rol", "permissions": ["patients.view"]},
         {"description": "auto"}, "description", [{"key": "BAD KEY!", "name": "x"}, {"key": "a", "name": "x"}, {"key": "ok_key", "name": ""}]),
        ("integrations", "/api/integrations", {"name": "TEST_AUTO integratsiya", "type": "other", "status": "pending"},
         {"notes": "auto"}, "notes", [{"name": ""}, {"name": "x", "type": "zzz"}, {"name": "x", "status": "zzz"}]),
        ("patients", "/api/patients", {"fullname": "TEST_AUTO Bemor", "phone": ph, "age": 30, "gender": "Erkak", "blood": "A+",
                                       "address": "test", "allergies": ["TESTalg"], "chronic": []},
         {"age": 31}, "age",
         [{"fullname": "", "phone": "+998901234567"}, {"fullname": "x", "phone": "123"},
          {"fullname": "x", "phone": "+998901234567", "age": 200}, {"fullname": "x", "phone": "+998901234567", "age": -1}]),
    ]
    try:
        for label, path, body, patch, field, bads in specs:
            r, ms, _ = adm("POST", path, csrf=True, json=body)
            if not R.check(r is not None and r.status_code == 201, f"{label}: yaratish (201)", short(r), sev="high", ms=ms):
                continue
            rid = jget(r, "id")
            created.append((path, rid))
            r, ms, _ = adm("PATCH", f"{path}/{rid}", csrf=True, json=patch)
            R.check(r is not None and r.status_code == 200, f"{label}: tahrirlash (200)", short(r), sev="high", ms=ms)
            r, ms, _ = adm("GET", path)
            mine = next((x for x in rows_of(r) if x.get("id") == rid), None) if r is not None else None
            R.check(mine is not None, f"{label}: yangi yozuv ro'yxatda ko'rinadi", sev="high", ms=ms)
            if mine is not None:
                want = patch[field]
                R.check(mine.get(field) == want, f"{label}: '{field}' o'zgarishi saqlandi", f"kutildi={want!r} bor={mine.get(field)!r}", sev="high")
                if label == "integrations":
                    R.check(not mine.get("api_key"), "integrations: api_key javobda yo'q", sev="critical")
            for i, bad in enumerate(bads, 1):
                r, ms, _ = adm("POST", path, csrf=True, json=bad)
                R.check(r is not None and r.status_code in (400, 422), f"{label}: noto'g'ri ma'lumot #{i} -> 4xx (500 emas)", short(r), sev="high", ms=ms)
                if r is not None and r.status_code == 201:  # tozalash
                    created.append((path, jget(r, "id")))
            r, ms, _ = adm("DELETE", f"{path}/{rid}", csrf=True)
            R.check(r is not None and r.status_code in (200, 204), f"{label}: o'chirish", short(r), sev="high", ms=ms)
            if r is not None and r.status_code in (200, 204):
                created.remove((path, rid))
                r, _, _ = adm("GET", path)
                R.check(all(x.get("id") != rid for x in rows_of(r)), f"{label}: o'chirilgach ro'yxatda yo'q", sev="medium", warn=True)
                r, _, _ = adm("PATCH", f"{path}/{rid}", csrf=True, json=patch)
                R.check(r is not None and r.status_code == 404, f"{label}: o'chirilganni tahrirlash -> 404", short(r), sev="medium")

        # --- xodimlar (alohida, parol qoidalari + RBAC) ---
        R.begin("7b. Xodimlar: parol qoidalari, dublikat, RBAC")
        login_new = "test_auto_" + RUN
        ub = {"fullname": "TEST_AUTO Xodim", "login": login_new, "password": STRONG, "role": "lab"}
        for label, patch_body, want in (
            ("qisqa parol", {"password": "Ab1!"}, (400, 422)), ("katta harfsiz", {"password": "abcdefg123!x"}, (400, 422)),
            ("belgisiz", {"password": "Abcdefg12345"}, (400, 422)), ("login ichida", {"password": "Test_auto_1!" + RUN}, (400, 422)),
            ("noma'lum rol", {"role": "nonexistent_role"}, (400, 404, 422)), ("bemor roli", {"role": "patient"}, (400, 403, 422)),
            ("login bo'sh joyli", {"login": "bad login"}, (400, 422)), ("login belgi xato", {"login": "Bad/Login!"}, (400, 422))):
            r, ms, _ = adm("POST", "/api/users", csrf=True, json={**ub, **patch_body})
            R.check(r is not None and r.status_code in want, f"Xodim: {label} rad etiladi", short(r), sev="high", ms=ms)
            if r is not None and r.status_code == 201:
                created.append(("/api/users", jget(r, "id")))
        r, ms, _ = adm("POST", "/api/users", csrf=True, json=ub)
        uid = jget(r, "id") if r is not None and r.status_code == 201 else None
        if R.check(uid is not None, "Xodim: yaratish (201)", short(r), sev="high", ms=ms):
            created.append(("/api/users", uid))
            R.check("password" not in (r.text or "").lower(), "Xodim yaratish javobida parol yo'q", sev="critical")
            r, _, _ = adm("POST", "/api/users", csrf=True, json=ub)
            R.check(r is not None and r.status_code == 409, "Xodim: dublikat login -> 409", short(r), sev="high")
            r, _, _ = adm("POST", "/api/users", csrf=True, json={**ub, "login": login_new.upper()})
            R.check(r is not None and r.status_code == 409, "Xodim: login katta-kichik harfga sezgir emas -> 409", short(r), sev="medium")
            r, _, _ = adm("PATCH", f"/api/users/{uid}", csrf=True, json={"phone": "+998901112233"})
            R.check(r is not None and r.status_code == 200, "Xodim: tahrirlash", short(r), sev="high")
            r, _, _ = adm("PATCH", f"/api/users/{uid}", csrf=True, json={"active": False})
            R.check(r is not None and r.status_code == 200, "Xodim: bloklash (active=false)", short(r), sev="high")
            lab = Api("lab-test")
            r, _, _ = lab.login(login_new, STRONG)
            R.check(r is not None and r.status_code == 401, "Bloklangan xodim kira olmaydi (401)", short(r), sev="critical")
            adm("PATCH", f"/api/users/{uid}", csrf=True, json={"active": True})
            r, _, _ = lab.login(login_new, STRONG)
            if R.check(r is not None and r.status_code == 200, "Faollashtirilgan xodim kiradi", short(r), sev="high"):
                for p in ("/api/users", "/api/roles", "/api/settings", "/api/monitoring/security-status"):
                    r, _, _ = lab("GET", p)
                    R.check(r is not None and r.status_code == 403, f"RBAC: laborant {p} -> 403", short(r), sev="critical")
                r, _, _ = lab("POST", "/api/users", csrf=True, json={**ub, "login": "test_auto_x" + RUN, "role": "superadmin"})
                R.check(r is not None and r.status_code in (401, 403), "RBAC: laborant superadmin yarata olmaydi", short(r), sev="critical")
                r, _, _ = lab("GET", "/api/equipment")
                R.check(r is not None and r.status_code == 200, "RBAC: laborant uskunalarni ko'ra oladi", short(r), sev="medium")
                lab("POST", "/api/auth/logout")
            r, _, _ = adm("DELETE", f"/api/users/{uid}", csrf=True)
            if R.check(r is not None and r.status_code in (200, 204), "Xodim: o'chirish", short(r), sev="high"):
                created.remove(("/api/users", uid))
        r, _, _ = adm("DELETE", "/api/users/999999999", csrf=True)
        R.check(r is not None and r.status_code == 404, "Mavjud bo'lmagan xodimni o'chirish -> 404", short(r), sev="medium")
        r, _, _ = adm("POST", "/api/auth/change-password", csrf=True, json={"old_password": "wrong-old-pass-1", "new_password": STRONG + "x"})
        R.check(r is not None and r.status_code in (400, 401), "Parol almashtirish: noto'g'ri eski parol rad etiladi", short(r), sev="high")
    finally:
        for path, rid in created:
            adm("DELETE", f"{path}/{rid}", csrf=True)
        if created:
            R.add("WARN", "Tozalash: ba'zi TEST_AUTO yozuvlar qo'lda o'chirilishi kerak", str(created), sev="low")

    # ---------------------------------------------------------------- 8
    R.begin("8. Audit jurnali")
    r, _, _ = adm("GET", "/api/audit?limit=100")
    txt = r.text if r is not None else ""
    acts = {x.get("action") for x in rows_of(r)}
    R.check({"create", "delete"} <= acts or {"create", "update"} <= acts, "CRUD amallari audit'ga tushgan", f"actions={sorted(a for a in acts if a)}", sev="high")
    R.check("TEST_AUTO" in txt, "Audit'da TEST_AUTO yozuvlari ko'rinadi", sev="medium", warn=True)
    R.check(STRONG not in txt and PASSWORD not in txt, "Audit'da parol saqlanmagan", sev="critical")
    r, _, _ = adm("GET", "/api/audit/verify")
    R.check(r is not None and jget(r, "ok") is True, "CRUD'dan keyin audit zanjiri yaxlit", short(r), sev="high")

    # ---------------------------------------------------------------- 9
    R.begin("9. Xavfsizlik sarlavhalari va CORS")
    for path in ("/login.html", "/admin.html", "/api/health"):
        r, _, _ = anon("GET", path)
        if r is None:
            continue
        h = {k.lower(): v for k, v in r.headers.items()}
        for hn in ("content-security-policy", "x-content-type-options", "referrer-policy"):
            R.check(hn in h, f"{path}: {hn}", "yo'q", sev="medium", warn=True)
        R.check("x-frame-options" in h or "frame-ancestors" in h.get("content-security-policy", ""), f"{path}: clickjacking himoyasi", "yo'q", sev="medium", warn=True)
    r, _, _ = adm("GET", "/api/users")
    R.check("no-store" in (r.headers.get("cache-control", "") if r is not None else "").lower(), "API javobi Cache-Control: no-store", "yo'q (shaxsiy ma'lumot keshlanishi mumkin)", sev="medium", warn=True)
    r, _, _ = anon("GET", "/api/health", headers={"Origin": "https://evil.example"})
    acao = r.headers.get("access-control-allow-origin", "") if r is not None else ""
    R.check(acao not in ("*", "https://evil.example"), "CORS: begona Origin'ga ruxsat berilmagan", f"ACAO={acao}", sev="high")
    r, _, _ = anon("GET", "/api/health", headers={"X-Forwarded-For": "1.2.3.4"})
    R.check(r is not None and r.status_code == 200, "Soxta X-Forwarded-For server'ni buzmaydi", short(r), sev="low")

    # ---------------------------------------------------------------- 10
    R.begin("10. Logout (oxirgi qadam: sessiya haqiqatan bekor bo'ladimi)")
    old_cookie = adm.c.headers.get("Cookie", "")
    r, ms, _ = adm("POST", "/api/auth/logout")
    if blocked(r):
        R.skip("Logout: IP bloklangan — tekshirib bo'lmadi", short(r))
    else:
        R.check(r is not None and r.status_code in (200, 204), "Logout", short(r), sev="high", ms=ms)
        chk = Api("old-session")
        chk.c.headers["Cookie"] = old_cookie
        r, ms, _ = chk("GET", "/api/users")
        if blocked(r):
            R.skip("Eski sessiya tekshiruvi inconclusive (IP bloklangan)")
        else:
            R.check(r is not None and r.status_code == 401, "Logoutdan keyin ESKI cookie bilan 401 (sessiya serverda bekor)", short(r), sev="critical", ms=ms)
        r, _, _ = chk("POST", "/api/auth/logout")
        R.check(r is not None and r.status_code in (200, 204, 401, 403), "Qayta logout 500 bermaydi", short(r), sev="medium")

    # ---------------------------------------------------------------- 11
    R.begin("11. Salbiy loginlar (ENG OXIRDA — IP limiti ishga tushmasin)")
    for body, label in (({"username": f"nouser_{RUN}", "password": "wrong-password-1"}, "noto'g'ri parol"),
                        ({"username": "x' OR '1'='1", "password": "' OR '1'='1"}, "SQL-injection ko'rinishi"),
                        ({"username": "", "password": ""}, "bo'sh maydonlar"),
                        ({"username": "a" * 65, "password": "x"}, "juda uzun login")):
        r, ms, _ = anon("POST", "/api/auth/login", json=body)
        R.check(r is not None and r.status_code in (400, 401, 422, 429), f"Login rad etiladi: {label}", short(r), sev="high", ms=ms)
    r, _, _ = anon("POST", "/api/auth/login", content=b"{bad json", headers={"Content-Type": "application/json"})
    if r is not None and r.status_code == 429:
        R.skip("Buzuq JSON tekshiruvi inconclusive (login limiti: 429)", short(r))
    else:
        R.check(r is not None and r.status_code in (400, 422), "Buzuq JSON 500 bermaydi", short(r), sev="medium")
    if os.environ.get("TIBEX_SCANNER_PROBES") == "1":
        for path in ("/secrets/secret_key.txt", "/backend/secrets/master_key_b64.txt", "/backend/app/config.py", "/docker-compose.yml", "/.env", "/.git/config"):
            r, _, _ = anon("GET", path)
            leaked = r is not None and r.status_code == 200 and any(m in r.text for m in ("TIBEX_", "PRIVATE KEY", "[core]", "services:"))
            R.check(not leaked, f"Maxfiy fayl ochiq emas: {path}", short(r), sev="critical")
    else:
        for path in ("/secrets/secret_key.txt", "/backend/secrets/master_key_b64.txt", "/backend/app/config.py", "/docker-compose.yml"):
            r, _, _ = anon("GET", path)
            leaked = r is not None and r.status_code == 200 and any(m in r.text for m in ("TIBEX_", "PRIVATE KEY", "services:"))
            R.check(not leaked, f"Maxfiy fayl ochiq emas: {path}", short(r), sev="critical")
        R.info("/.env va /.git tekshiruvi o'tkazilmadi (IP bloklanmasligi uchun). Yoqish: TIBEX_SCANNER_PROBES=1")

    ts = sorted((t["ms"] for t in R.timings), reverse=True)
    R.meta["slowest_get"] = sorted(R.timings, key=lambda t: -t["ms"])[:5]
    R.meta["get_p95_ms"] = ts[max(0, int(len(ts) * 0.05) - 1)] if ts else None
    return R.finish("admin_api_report.json")


if __name__ == "__main__":
    sys.exit(main())
