#!/usr/bin/env python3
"""Ikkita yo'q faylni yaratadi (tarmoq kerak; Windows/Linux/macOS):

    frontend/package-lock.json   <- npm install --package-lock-only
    backend/.secrets.baseline    <- detect-secrets 1.5.0, repo ildizidan, git bilan kuzatilgan fayllar bo'yicha

Ishlatish (repo ildizidan):
    git add -A                   # baseline faqat git'da kuzatiladigan fayllarni skanerlaydi (CI ham shunday)
    python tools/bootstrap_lockfiles.py

Keyin qo'lda (interaktiv, avtomatlashtirilmaydi):
    detect-secrets audit backend/.secrets.baseline
Haqiqiy sir chiqsa: to'xtang, uni ALMASHTIRING (backend/docs/ROTATION.md), keyin baseline'ga qo'shing.
Faqat soxta/test qiymatlarni "false positive" deb belgilang. So'ng fayllarni commit qiling.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
BASELINE = ROOT / "backend" / ".secrets.baseline"
DS_VERSION = "1.5.0"


def run(cmd: list[str], cwd: Path, **kw) -> subprocess.CompletedProcess:
    print("$", " ".join(cmd), f"   (cwd={cwd.relative_to(ROOT) or '.'})")
    return subprocess.run(cmd, cwd=cwd, check=True, **kw)


def lockfile() -> None:
    npm = shutil.which("npm")
    if not npm:
        sys.exit("npm topilmadi: Node.js 20 o'rnating (https://nodejs.org).")
    run([npm, "install", "--package-lock-only", "--no-audit", "--no-fund"], FRONTEND)
    lock = FRONTEND / "package-lock.json"
    if not lock.is_file():
        sys.exit("package-lock.json yaratilmadi.")
    print(f"OK: {lock.relative_to(ROOT)}")


def baseline() -> None:
    try:
        import detect_secrets  # noqa: F401
    except ImportError:
        run([sys.executable, "-m", "pip", "install", f"detect-secrets=={DS_VERSION}"], ROOT)
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    if "frontend/tools/hash_assets.js" not in tracked:
        sys.exit("Yangi fayllar git'da kuzatilmayapti: avval `git add -A` qiling, keyin qayta ishga tushiring.")
    # `detect-secrets scan` (argumentsiz) git ls-files bo'yicha skanerlaydi, CI dagi detect-secrets-hook bilan bir xil to'plam.
    out = run([sys.executable, "-m", "detect_secrets", "scan"], ROOT, capture_output=True, text=True).stdout
    BASELINE.write_text(out, encoding="utf-8", newline="\n")
    print(f"OK: {BASELINE.relative_to(ROOT)}")
    print("Endi: detect-secrets audit backend/.secrets.baseline  (haqiqiy sir chiqsa, AVVAL almashtiring)")


if __name__ == "__main__":
    lockfile()
    baseline()
