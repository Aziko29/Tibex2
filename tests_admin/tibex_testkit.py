"""TIBEX testlari uchun umumiy yordamchi modul (admin_api_check.py va admin_ui_check.py bilan BIR PAPKADA turishi kerak)."""
from __future__ import annotations

import getpass
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = os.environ.get("TIBEX_URL", "http://127.0.0.1:8000").rstrip("/")
LOGIN = os.environ.get("TIBEX_ADMIN_LOGIN", "admin")
_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def setup_console() -> None:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def get_password() -> str:
    pw = os.environ.get("TIBEX_ADMIN_PASSWORD") or getpass.getpass("Admin paroli: ")
    if not pw:
        sys.exit("Parol kiritilmadi.")
    return pw


class Recorder:
    def __init__(self, kind: str, base: str):
        self.kind, self.base = kind, base
        self.items: list[dict] = []
        self.timings: list[dict] = []
        self.meta: dict = {}
        self.secrets: set[str] = set()
        self.section = ""
        self.t0 = time.time()

    def add_secret(self, s) -> None:
        if s and len(str(s)) >= 6:
            self.secrets.add(str(s))

    def _clean(self, text) -> str:
        t = str(text or "")
        for s in self.secrets:
            t = t.replace(s, "***")
        return t

    def begin(self, title: str) -> None:
        self.section = title
        print(f"\n--- {title}")

    def add(self, status: str, name: str, detail: str = "", sev: str = "medium", ms: float = 0, **_) -> None:
        item = {"status": status, "section": self.section, "name": self._clean(name),
                "detail": self._clean(detail)[:300], "severity": sev, "ms": round(ms or 0)}
        self.items.append(item)
        if status != "PASS":
            print(f"  [{status}] {item['name']}" + (f" -> {item['detail']}" if item["detail"] else ""))

    def check(self, ok: bool, name: str, detail: str = "", sev: str = "medium", ms: float = 0, warn: bool = False) -> bool:
        ok = bool(ok)
        self.add("PASS" if ok else ("WARN" if warn else "FAIL"), name, "" if ok else detail, sev, ms)
        return ok

    def skip(self, name: str, detail: str = "") -> None:
        self.add("SKIP", name, detail, "low")

    def info(self, text: str) -> None:
        self.add("INFO", text, "", "low")

    def finish(self, report_name: str, extra: dict | None = None) -> int:
        cnt = {k: sum(i["status"] == k for i in self.items) for k in ("PASS", "FAIL", "WARN", "SKIP", "INFO")}
        fails = sorted((i for i in self.items if i["status"] == "FAIL"), key=lambda i: _ORDER.get(i["severity"], 9))
        print(f"\n===== {self.kind}: {cnt['PASS']} PASS, {cnt['FAIL']} FAIL, {cnt['WARN']} WARN, {cnt['SKIP']} SKIP =====")
        for i in fails:
            print(f"  ! [{i['severity']}] {i['name']}: {i['detail']}")
        report = {"kind": self.kind, "base": self.base, "seconds": round(time.time() - self.t0, 1),
                  "counts": cnt, "meta": self.meta, "items": [i for i in self.items if i["status"] != "PASS"], **(extra or {})}
        try:
            (HERE / report_name).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"Hisobot: {HERE / report_name}")
        except Exception as exc:
            print(f"Hisobot yozilmadi: {exc}")
        return 1 if fails else 0
