#!/usr/bin/env python3
"""TIBEX: internetga chiqadigan (public) papkani ALLOWLIST asosida yig'adi.

Prinsip: qora ro'yxat emas, oq ro'yxat. Faqat quyidagi kirish sahifalaridan
(index, bemor-login, bemor) bevosita ulangan fayllar `public/` ga nusxalanadi.
Xodim sahifalari (admin.html, login.html, kassa.html ...), docs/, tests/, tools/,
package.json, README.md, .eslintrc.json va h.k. `public/` da UMUMAN bo'lmaydi,
shuning uchun ularni hech qanday xato sozlama ochib qo'ya olmaydi.

Ishlatish (frontend/ ichidan):   python tools/build_public.py
Chiqish kodi 0 emas bo'lsa — deploy'ni to'xtating.
"""
import re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent      # frontend/
OUT = ROOT / "public"
ENTRY_PAGES = ["index.html", "bemor-login.html", "bemor.html"]
EXTRA = ["favicon.svg"]
# public ichida HECH QACHON bo'lmasligi kerak (xodim sahifalari):
FORBIDDEN_HTML = {"admin.html", "login.html", "kassa.html", "qabulxona.html",
                  "shifokor.html", "labaratoriya.html"}

ATTR = re.compile(r'''(?:src|href)\s*=\s*["']([^"'#?]+)''', re.I)
STATIC_IN_TEXT = re.compile(r'''["'`]((?:/)?static/[A-Za-z0-9_./-]+\.(?:js|css|svg|png|jpg|webp|woff2?))["'`?]''')
CSS_URL = re.compile(r'url\(\s*["\']?([^)"\'#?]+)')

def local(ref):
    return not re.match(r"^(?:[a-z]+:)?//|^(?:data|mailto|tel|javascript):", ref, re.I)

def resolve(ref, base):
    ref = ref.lstrip("/") if ref.startswith("/") else ref
    p = (ROOT / ref) if ref.startswith("static/") or ref in EXTRA or ref.endswith(".html") and "/" not in ref \
        else (base.parent / ref)
    return p.resolve()

def main():
    todo = [ROOT / p for p in ENTRY_PAGES + EXTRA]
    seen, problems = set(), []
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        if not f.exists():
            problems.append(f"topilmadi: {f.relative_to(ROOT)}"); continue
        try:
            f.relative_to(ROOT)
        except ValueError:
            problems.append(f"frontend/ dan tashqarida: {f}"); continue
        seen.add(f)
        text = f.read_text(encoding="utf8", errors="ignore")
        refs = []
        if f.suffix == ".html":
            refs = [r for r in ATTR.findall(text) if local(r)]
            # HTML'dagi sahifalararo havolalar faqat kirish sahifalari bo'lishi mumkin
            refs = [r for r in refs if not r.endswith(".html") or r.lstrip("/") in ENTRY_PAGES]
        elif f.suffix == ".js":
            refs = STATIC_IN_TEXT.findall(text)      # JS ichidagi .html nomlari OLINMAYDI
        elif f.suffix == ".css":
            refs = [r for r in CSS_URL.findall(text) if local(r)]
        for r in refs:
            if r.lstrip("/") in ENTRY_PAGES or r.endswith(".html"):
                p = ROOT / r.lstrip("/")
            elif f.suffix == ".css":
                p = (f.parent / r).resolve()
            else:
                p = (ROOT / r.lstrip("/")).resolve() if r.lstrip("/").startswith(("static/", "favicon")) else (f.parent / r).resolve()
            todo.append(p)

    bad = [p.name for p in seen if p.name in FORBIDDEN_HTML]
    if bad:
        problems.append("xodim sahifasi public'ga tushib qoldi: " + ", ".join(bad))
    if problems:
        print("\n".join("XATO: " + x for x in problems)); sys.exit(1)

    if OUT.exists():
        shutil.rmtree(OUT)
    for f in sorted(seen):
        dst = OUT / f.relative_to(ROOT)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
    print(f"public/ tayyor: {len(seen)} ta fayl")
    for f in sorted(seen):
        print("  ", f.relative_to(ROOT).as_posix())

if __name__ == "__main__":
    main()
