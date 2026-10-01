#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TibEx Project Snapshot v4 — "Xavfsiz, Aqlli, AI-ga Tayyor"
==========================================================
Xususiyatlar:
  ▸ Secret masking (parol, API kalit, JWT avtomatik yashiriladi)
  ▸ Priority files (config, main.py birinchi ko'rsatiladi)
  ▸ Per-file truncation (katta fayllar aqlli qisqartiriladi)
  ▸ Extension statistikasi
  ▸ Git info (branch, oxirgi commit'lar)
  ▸ Docker services summary
  ▸ Max hajm cheklovi (default 5MB)

Ishlatish:
    python project_snapshot.py                  # to'liq snapshot
    python project_snapshot.py --open           # + faylni ochish
    python project_snapshot.py --no-mask        # secret masking o'chirish
    python project_snapshot.py --max-total 10M  # jami hajm limiti
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

# ══════════════════════════════════════════════════════════════════════════════
#  FILTRLAR
# ══════════════════════════════════════════════════════════════════════════════

SKIP_DIRS: set[str] = {
    # Python
    ".venv", "venv", "env", "virtualenv", ".virtualenv",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".tox", ".nox", ".cache", ".hypothesis",
    # JS/Node
    "node_modules", "bower_components", ".parcel-cache",
    ".next", ".nuxt", ".svelte-kit", ".vite", ".turbo",
    # VCS
    ".git", ".hg", ".svn",
    # IDE
    ".idea", ".vscode", ".vs", ".history",
    # Build
    "dist", "build", "target", "out", "bin", "obj",
    # Skaner chiqishi — O'ZINI CHIQARIB TASHLASH
    "reports", "_snapshot", "snapshots",
    # Boshqa
    "backups", "Output", "coverage", "htmlcov",
    ".terraform", ".serverless",
}

SKIP_EXTS: set[str] = {
    # Binary
    ".pyc", ".pyo", ".pyd",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff",
    ".mp3", ".mp4", ".avi", ".mov", ".wav", ".webm", ".mkv",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".tgz",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".o", ".obj", ".so", ".dll", ".dylib", ".a", ".lib", ".exe", ".bin",
    ".class", ".jar", ".war", ".ear",
    ".sqlite", ".sqlite3", ".db", ".rdb", ".dump",
    ".log", ".tmp", ".temp", ".bak", ".swp", ".swo", ".orig", ".rej",
    ".map", ".min.js", ".min.css",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    # Python cache
    ".pyc", ".pyo",
}

SKIP_FILES: set[str] = {
    ".DS_Store", "Thumbs.db", "desktop.ini", ".gitkeep",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "poetry.lock", "Pipfile.lock", "Cargo.lock",
}

# Bu fayllar BIRINCHI ko'rsatiladi (muhim!)
PRIORITY_FILES: list[str] = [
    # Root
    "README.md", "readme.md", "README.rst",
    "requirements.txt", "requirements-dev.txt", "requirements.lock",
    "pyproject.toml", "setup.py", "setup.cfg", "Pipfile",
    "package.json", "tsconfig.json", "vite.config.ts", "vite.config.js",
    "docker-compose.yml", "docker-compose.yaml", "Dockerfile",
    ".env.example", ".env.sample", ".env.template",
    # Backend
    "backend/main.py", "backend/app.py", "backend/__init__.py",
    "backend/config.py", "backend/settings.py",
    "backend/requirements.txt",
    "app/main.py", "app/__init__.py",
    "main.py", "app.py", "config.py", "settings.py",
    "backend/database.py", "backend/db.py",
    "backend/models/__init__.py", "backend/models/user.py",
    "backend/api/__init__.py", "backend/api/auth.py",
    "backend/auth.py", "backend/security.py",
    # Frontend
    "frontend/index.html", "frontend/package.json",
    "frontend/src/main.js", "frontend/src/main.ts",
    "frontend/src/App.vue", "frontend/src/App.jsx",
    # Docker
    "docker/nginx/nginx.conf", "nginx.conf",
    "docker/api/Dockerfile", "docker/db/Dockerfile",
]

TEXT_EXTS: set[str] = {
    # Python
    ".py", ".pyw", ".pyx", ".pxd", ".pyi",
    # Web
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".vue", ".svelte",
    # Config
    ".toml", ".ini", ".cfg", ".yaml", ".yml", ".json",
    ".conf", ".properties", ".env",
    # Docs
    ".md", ".rst", ".txt", ".mako",
    # Shell
    ".sh", ".bat", ".cmd", ".ps1", ".service", ".timer",
    # DB
    ".sql", ".graphql", ".gql",
    # Misc
    ".gitignore", ".dockerignore", ".eslintrc", ".prettierrc",
}

TEXT_NAMES: set[str] = {
    "Dockerfile", "Makefile", "Procfile", "Vagrantfile",
    ".gitignore", ".dockerignore", ".env", ".env.example",
    "requirements.txt", "LICENSE", "README", "README.md",
    "docker-compose.yml", "docker-compose.yaml",
    "nginx.conf", "supervisord.conf",
}

# ══════════════════════════════════════════════════════════════════════════════
#  SECRET MASKING — xavfsiz ulashish uchun
# ══════════════════════════════════════════════════════════════════════════════

# (regex, replacement_template)
MASK_RULES: list[tuple[re.Pattern, str]] = [
    # Passwords: password = "abc123"
    (re.compile(r'(?i)(password|passwd|pwd|pass)\s*[:=]\s*["\']([^"\']{1,200})["\']'),
     r'\1 = "***MASKED***"'),
    # Postgres/MySQL URL: postgres://user:pass@host
    (re.compile(r'(postgres|postgresql|mysql|mongodb|redis|amqp)://([^:]+):([^@]+)@'),
     r'\1://\2:***MASKED***@'),
    # JWT secret
    (re.compile(r'(?i)(jwt[_-]?secret|secret[_-]?key|secret_key)\s*[:=]\s*["\']([^"\']{1,200})["\']'),
     r'\1 = "***MASKED***"'),
    # API keys
    (re.compile(r'(?i)(api[_-]?key|apikey|api_secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*["\']([^"\']{8,200})["\']'),
     r'\1 = "***MASKED***"'),
    # AWS
    (re.compile(r'AKIA[0-9A-Z]{16}'), '***MASKED_AWS_ACCESS_KEY***'),
    (re.compile(r'(?i)(aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*["\']?([A-Za-z0-9/+=]{40})["\']?'),
     r'\1 = "***MASKED***"'),
    # JWT tokens (eyJ...)
    (re.compile(r'\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*'),
     'eyJ***MASKED_JWT***'),
    # Bearer tokens
    (re.compile(r'(?i)(bearer|authorization)\s*[:=]\s*["\']?([A-Za-z0-9_\-\.]{20,})'),
     r'\1: ***MASKED***'),
    # Private keys
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'),
     '***MASKED_PRIVATE_KEY***'),
    # Database URLs with any scheme
    (re.compile(r'(?i)(database[_-]?url|db[_-]?url|dsn)\s*[:=]\s*["\']([^"\']+)["\']'),
     r'\1 = "***MASKED***"'),
    # Generic 32+ char hex/base64 (likely secrets)
    (re.compile(r'["\']([A-Za-z0-9+/=]{40,})["\']'),
     '"***POSSIBLE_SECRET_MASKED***"'),
    # Emails (optional privacy)
    # (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
    #  '***EMAIL_MASKED***'),
    # Internal IPs (docker network)
    (re.compile(r'\b(?:172|192\.168|10)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b'),
     '***INTERNAL_IP***'),
]


def mask_secrets(text: str) -> tuple[str, int]:
    """Secret'larni maskalaydi. Qaytaradi: (masked_text, count)."""
    count = 0
    for pattern, replacement in MASK_RULES:
        text, n = pattern.subn(replacement, text)
        count += n
    return text, count


# ══════════════════════════════════════════════════════════════════════════════
#  YORDAMCHI
# ══════════════════════════════════════════════════════════════════════════════

def parse_size(s: str) -> int:
    s = s.strip().upper()
    mult = 1
    if s.endswith("K"): mult, s = 1024, s[:-1]
    elif s.endswith("M"): mult, s = 1024 ** 2, s[:-1]
    elif s.endswith("G"): mult, s = 1024 ** 3, s[:-1]
    return int(float(s) * mult)


def fmt_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.2f}{unit}"
        n /= 1024
    return f"{n:.2f}PB"


def should_skip_dir(name: str) -> bool:
    return name in SKIP_DIRS


def should_skip_file(name: str) -> bool:
    if name in SKIP_FILES:
        return True
    ext = Path(name).suffix.lower()
    if ext and ext in SKIP_EXTS:
        return True
    if name.endswith((".dist-info", ".egg-info")):
        return True
    return False


def is_text(name: str) -> bool:
    if name in TEXT_NAMES:
        return True
    return Path(name).suffix.lower() in TEXT_EXTS


def read_safe(path: Path, max_bytes: int) -> tuple[Optional[str], str]:
    try:
        size = path.stat().st_size
    except OSError as e:
        return None, f"(stat xatosi: {e})"
    if size == 0:
        return "", ""
    if size > max_bytes:
        return None, f"(o'tkazildi: {fmt_size(size)} > {fmt_size(max_bytes)})"
    for enc in ("utf-8", "utf-8-sig", "cp1251", "latin-1"):
        try:
            return path.read_text(encoding=enc), ""
        except UnicodeDecodeError:
            continue
        except OSError as e:
            return None, f"(o'qilmadi: {e})"
    return None, "(binariy)"


def truncate_file(content: str, max_lines: int = 400) -> tuple[str, bool]:
    """Katta faylni aqlli qisqartiradi: boshidan + ... + oxiridan."""
    lines = content.split("\n")
    if len(lines) <= max_lines:
        return content, False
    head = lines[:max_lines - 50]
    tail = lines[-40:]
    truncated = (
        "\n".join(head)
        + f"\n\n# ... [ {len(lines) - max_lines - 10} qator qisqartirildi ] ...\n\n"
        + "\n".join(tail)
    )
    return truncated, True


# ══════════════════════════════════════════════════════════════════════════════
#  DARAXT
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Node:
    path: Path
    name: str
    is_dir: bool
    size: int = 0
    children: list["Node"] = field(default_factory=list)


def scan(path: Path, depth: int = 0, max_depth: int = 12) -> Node:
    node = Node(path=path, name=path.name or str(path), is_dir=True)
    if depth >= max_depth:
        return node
    try:
        entries = sorted(path.iterdir(),
                         key=lambda p: (not p.is_dir(), p.name.lower()))
    except (PermissionError, OSError):
        return node

    for e in entries:
        try:
            if e.is_dir():
                if should_skip_dir(e.name):
                    continue
                node.children.append(scan(e, depth + 1, max_depth))
            else:
                if should_skip_file(e.name):
                    continue
                try:
                    size = e.stat().st_size
                except OSError:
                    size = 0
                node.children.append(Node(e, e.name, False, size))
        except OSError:
            continue
    return node


def draw_tree(node: Node, prefix: str = "", last: bool = True,
              root: bool = True, depth: int = 0) -> Iterable[str]:
    if depth > 15:
        yield f"{prefix}    ... (chuqurlik limiti)"
        return
    out: list[str] = []
    if root:
        out.append(node.name + "/")
        child_prefix = ""
    else:
        out.append(f"{prefix}{'`-- ' if last else '|-- '}{node.name}"
                   f"{'/' if node.is_dir else ''}")
        child_prefix = prefix + ("    " if last else "|   ")

    for i, c in enumerate(node.children):
        out.extend(draw_tree(c, child_prefix, i == len(node.children) - 1,
                             False, depth + 1))
    for line in out:
        yield line


def stats(node: Node) -> tuple[int, int, int]:
    d = 1 if node.is_dir else 0
    f = 0
    s = 0
    for c in node.children:
        if c.is_dir:
            dd, ff, ss = stats(c)
            d += dd; f += ff; s += ss
        else:
            f += 1; s += c.size
    return d, f, s


def collect_files(node: Node) -> Iterable[Node]:
    for c in node.children:
        if c.is_dir:
            yield from collect_files(c)
        else:
            yield c


# ══════════════════════════════════════════════════════════════════════════════
#  GIT INFO
# ══════════════════════════════════════════════════════════════════════════════

def git_info(root: Path) -> list[str]:
    """Git repo haqida ma'lumot."""
    out: list[str] = []
    if not (root / ".git").exists():
        return ["(Git repo emas)"]
    cmds = [
        ("Branch", ["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        ("Oxirgi commit", ["git", "log", "-1", "--pretty=format:%h %s (%cr)"]),
        ("Status", ["git", "status", "--short"]),
        ("Remote", ["git", "remote", "-v"]),
    ]
    for label, cmd in cmds:
        try:
            r = subprocess.run(cmd, cwd=root, capture_output=True, text=True,
                               timeout=5)
            val = (r.stdout or r.stderr).strip()
            if val:
                out.append(f"  {label}: {val[:300]}")
        except Exception as e:
            out.append(f"  {label}: (xato: {e})")
    # Oxirgi 5 ta commit
    try:
        r = subprocess.run(["git", "log", "-5", "--pretty=format:%h  %an  %s"],
                           cwd=root, capture_output=True, text=True, timeout=5)
        if r.stdout:
            out.append("  Oxirgi 5 commit:")
            for line in r.stdout.strip().split("\n"):
                out.append(f"    {line[:150]}")
    except Exception:
        pass
    return out


def docker_info(root: Path) -> list[str]:
    """docker-compose.yml dan servis ma'lumotlari."""
    out: list[str] = []
    for name in ("docker-compose.yml", "docker-compose.yaml"):
        p = root / name
        if p.exists():
            out.append(f"  Fayl: {name}")
            try:
                content = p.read_text(errors="ignore")
                # Servis nomlarini ajratish
                services = re.findall(r"^  ([a-z][a-z0-9_\-]+):\s*$",
                                      content, re.MULTILINE)
                if services:
                    out.append(f"  Servislar: {', '.join(services)}")
                # Portlarni ajratish
                ports = re.findall(r'-\s*["\']?(\d+:\d+)["\']?', content)
                if ports:
                    out.append(f"  Portlar: {', '.join(ports[:15])}")
                # Image'lar
                images = re.findall(r"image:\s*(\S+)", content)
                if images:
                    out.append(f"  Image'lar: {', '.join(images[:15])}")
            except Exception:
                pass
            break
    if not out:
        out.append("  (docker-compose.yml topilmadi)")
    return out


# ══════════════════════════════════════════════════════════════════════════════
#  SNAPSHOT YASASH
# ══════════════════════════════════════════════════════════════════════════════

def build_snapshot(root: Path, tree: Node, max_size: int,
                   with_content: bool, mask: bool,
                   max_total: int) -> tuple[str, int, int, int]:
    dirs, files, total = stats(tree)
    sep = "=" * 78
    thin = "-" * 78

    out: list[str] = []
    out.append(sep)
    out.append("  TibEx PROJECT SNAPSHOT v4")
    out.append(f"  Ildiz    : {root}")
    out.append(f"  Sana     : {datetime.now():%Y-%m-%d %H:%M:%S}")
    out.append(f"  Statistika: {dirs} papka | {files} fayl | {fmt_size(total)}")
    out.append(f"  Rejim    : {'daraxt + mazmun' if with_content else 'faqat daraxt'}")
    out.append(f"  Fayl lim : {fmt_size(max_size)}")
    out.append(f"  Jami lim : {fmt_size(max_total)}")
    out.append(f"  Masking  : {'HA' if mask else 'YO`Q'}")
    out.append(sep)
    out.append("")

    # ─── GIT INFO ───
    if with_content:
        out.append("## 0. GIT MA'LUMOTI")
        out.append(thin)
        out.extend(git_info(root))
        out.append("")
        out.append("## 0.1. DOCKER MA'LUMOTI")
        out.append(thin)
        out.extend(docker_info(root))
        out.append("")

    # ─── DARAXT ───
    out.append("## 1. PAPKA / FAYL DARAXTI")
    out.append(thin)
    out.extend(draw_tree(tree))
    out.append("")

    if not with_content:
        return "\n".join(out), 0, 0, 0

    # ─── EXT STATISTIKASI ───
    ext_counter: Counter[str] = Counter()
    for f in collect_files(tree):
        ext = Path(f.name).suffix.lower() or "(no ext)"
        ext_counter[ext] += 1
    out.append("## 1.1. FAYL TURLARI BO'YICHA STATISTIKA")
    out.append(thin)
    for ext, cnt in ext_counter.most_common(20):
        out.append(f"  {ext:<15} {cnt:>5} ta")
    out.append("")

    # ─── FAYL MAZMUNI ───
    out.append(sep)
    out.append("## 2. FAYL MAZMUNI")
    out.append(sep)

    # Priority files'ni birinchi yig'amiz
    all_files = list(collect_files(tree))
    priority_set = {p.replace("/", os.sep).replace("\\", os.sep)
                    for p in PRIORITY_FILES}

    def priority_key(node: Node):
        rel = node.path.relative_to(root).as_posix()
        try:
            idx = PRIORITY_FILES.index(rel)
            return (0, idx, rel)
        except ValueError:
            return (1, 0, rel)

    all_files.sort(key=priority_key)

    shown = 0
    skipped: list[tuple[str, str]] = []
    masked_count = 0
    truncated_count = 0
    current_total = len("\n".join(out))

    for f in all_files:
        rel = f.path.relative_to(root).as_posix()
        if not is_text(f.name):
            skipped.append((rel, "(matnli emas)"))
            continue
        content, note = read_safe(f.path, max_size)
        if content is None:
            skipped.append((rel, note))
            continue

        # Masking
        if mask:
            content, m = mask_secrets(content)
            masked_count += m

        # Truncation
        content, was_trunc = truncate_file(content)
        if was_trunc:
            truncated_count += 1

        # Header yasash
        is_priority = rel in PRIORITY_FILES
        badge = " [PRIORITY]" if is_priority else ""
        header = f"\n{sep}\n### {rel}{badge}\n### Hajm: {fmt_size(f.size)}\n{sep}\n"

        # Jami hajm cheklovi
        current_total += len(header) + len(content) + 20
        if current_total > max_total:
            out.append(header)
            out.append(f"⚠️ JAMI LIMIT ({fmt_size(max_total)}) yetdi. "
                       f"Qolgan fayllar chiqarilmadi.")
            break

        out.append(header)
        out.append("```")
        out.append(content.rstrip("\n"))
        out.append("```")
        shown += 1

    # ─── SKIPPED ───
    out.append("")
    out.append(sep)
    out.append(f"## 3. O'TKAZIB YUBORILGAN FAYLLAR ({len(skipped)} ta)")
    out.append(sep)
    for rel, reason in skipped[:200]:  # limit
        out.append(f"  - {rel}   {reason}")
    if len(skipped) > 200:
        out.append(f"  ... va yana {len(skipped) - 200} ta")

    # ─── YAKUNIY ───
    out.append("")
    out.append(sep)
    out.append(f"  Mazmun ko'rsatildi: {shown} ta fayl")
    out.append(f"  O'tkazib yuborildi: {len(skipped)} ta fayl")
    out.append(f"  Qisqartirilgan   : {truncated_count} ta fayl (>400 qator)")
    out.append(f"  Maskalangan      : {masked_count} ta secret")
    out.append(sep)

    return "\n".join(out), shown, len(skipped), masked_count


# ══════════════════════════════════════════════════════════════════════════════
#  ASOSIY
# ══════════════════════════════════════════════════════════════════════════════

def main() -> int:
    ap = argparse.ArgumentParser(
        description="TibEx snapshot v4 — xavfsiz, aqlli, AI-ga tayyor")
    ap.add_argument("--root", "-r", default=".", help="Ildiz papka (default: .)")
    ap.add_argument("--out", "-o", default=None, help="Chiqish fayli")
    ap.add_argument("--max-size", "-m", default="1M",
                    help="Har bir fayl uchun limit (default 1M)")
    ap.add_argument("--max-total", "-t", default="5M",
                    help="Jami snapshot hajmi (default 5M)")
    ap.add_argument("--no-content", action="store_true",
                    help="Faqat daraxt (mazmunsiz)")
    ap.add_argument("--no-mask", action="store_true",
                    help="Secret masking o'chirish (EHTIYOT BO'LING!)")
    ap.add_argument("--open", action="store_true",
                    help="Snapshot tayyor bo'lgach avtomatik ochish")
    ap.add_argument("--stdout", action="store_true",
                    help="Faylga yozmasdan konsolga chiqarish")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"[!] Papka topilmadi: {root}", file=sys.stderr)
        return 2

    max_size = parse_size(args.max_size)
    max_total = parse_size(args.max_total)
    with_content = not args.no_content
    mask = not args.no_mask

    print(f"[*] Skanerlanmoqda : {root}")
    print(f"[*] Rejim          : {'daraxt + mazmun' if with_content else 'faqat daraxt'}")
    print(f"[*] Fayl limiti    : {fmt_size(max_size)}")
    print(f"[*] Jami limit     : {fmt_size(max_total)}")
    print(f"[*] Secret masking : {'HA' if mask else 'YO`Q ⚠️'}")

    tree = scan(root)
    dirs, files, total = stats(tree)
    print(f"[+] Topildi        : {dirs} papka | {files} fayl | {fmt_size(total)}")

    print("[*] Snapshot yig'ilmoqda...")
    text, shown, skipped, masked = build_snapshot(
        root, tree, max_size, with_content, mask, max_total)

    if args.stdout:
        print(text)
        return 0

    if args.out:
        out_path = Path(args.out).resolve()
    else:
        snap_dir = root / "_snapshot"
        snap_dir.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = snap_dir / f"snapshot_{ts}.txt"

    try:
        out_path.write_text(text, encoding="utf-8", newline="\n")
    except OSError as e:
        print(f"[!] Yozib bo'lmadi: {e}", file=sys.stderr)
        return 1

    size = out_path.stat().st_size

    # ─── XULOSA ───
    print()
    print("=" * 60)
    print("  SNAPSHOT TAYYOR")
    print("=" * 60)
    print(f"  Fayl       : {out_path}")
    print(f"  Hajm       : {fmt_size(size)}")
    if with_content:
        print(f"  Ko'rsatildi: {shown} ta fayl mazmuni")
        print(f"  O'tkazildi : {skipped} ta fayl")
        if mask:
            print(f"  Maskalangan: {masked} ta secret  🔒")
    print("=" * 60)
    print()
    print("  📤 Bu faylni AI'ga yuborish xavfsiz (parol/API kalitlar yashirilgan)")
    print()

    if args.open:
        print("[*] Ochilmoqda...")
        try:
            if sys.platform.startswith("win"):
                os.startfile(str(out_path))  # type: ignore
            elif sys.platform == "darwin":
                subprocess.run(["open", str(out_path)], check=False)
            else:
                subprocess.run(["xdg-open", str(out_path)], check=False)
        except Exception as e:
            print(f"[!] Ochib bo'lmadi: {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())