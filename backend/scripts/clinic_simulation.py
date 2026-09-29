"""Run safe TIBEX clinic preflight and negative-security simulations.

The default run is read-only: it checks the migration graph and runs isolated
tests. Optional HTTP checks use GET/OPTIONS only and are restricted to loopback.
It never creates users/patients/payments, sends SMS/Telegram, clears audit data,
or runs demo reset. See the attached clinic simulation plan for manual E2E work.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values


BACKEND = Path(__file__).resolve().parents[1]
PROTECTED_GETS = (
    "/api/bootstrap",
    "/api/patients",
    "/api/appointments",
    "/api/lab-orders",
    "/api/payments",
    "/api/refunds",
    "/api/users",
    "/api/roles",
    "/api/audit",
    "/api/monitoring/health",
)


def _check(results: list[dict], name: str, status: str, detail: str = "") -> None:
    results.append({"name": name, "status": status, "detail": detail})


def _loopback_base_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("base URL noto'g'ri")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("base URL credential/query/fragment saqlamasligi kerak")
    try:
        loopback = ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        loopback = parsed.hostname.lower() == "localhost"
    if not loopback:
        raise ValueError("simulyatsiya xavfsizligi uchun API manzili localhost/loopback bo'lishi shart")
    return value.rstrip("/")


def _effective_env() -> str:
    env_file = dotenv_values(BACKEND / ".env")
    return (os.environ.get("TIBEX_ENV") or env_file.get("TIBEX_ENV") or "local").strip().lower()


def _run_command(results: list[dict], name: str, command: list[str], *, env: dict[str, str] | None = None) -> None:
    try:
        proc = subprocess.run(
            command,
            cwd=BACKEND,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=180,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        _check(results, name, "FAIL", type(exc).__name__)
        return
    # Keep test output short and avoid returning accidental application data.
    tail = " | ".join(line.strip() for line in proc.stdout.splitlines()[-4:])[:500]
    _check(results, name, "PASS" if proc.returncode == 0 else "FAIL", tail)


async def _api_checks(base_url: str, results: list[dict]) -> None:
    timeout = httpx.Timeout(5.0, connect=2.0)
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=timeout, follow_redirects=False) as client:
            try:
                response = await client.get("/api/health")
            except httpx.HTTPError as exc:
                _check(results, "local API/DB health", "BLOCKED", type(exc).__name__)
                return
            try:
                health = response.json()
            except ValueError:
                health = {}
            ok = response.status_code == 200 and health.get("ok") is True
            _check(
                results,
                "local API/DB health",
                "PASS" if ok else "FAIL",
                f"HTTP {response.status_code}; database={'up' if health.get('ok') is True else 'down/unavailable'}",
            )

            for path in PROTECTED_GETS:
                try:
                    response = await client.get(path)
                    passed = response.status_code in (401, 403)
                    _check(results, f"unauthenticated access blocked: {path}", "PASS" if passed else "FAIL", f"HTTP {response.status_code}")
                except httpx.HTTPError as exc:
                    _check(results, f"unauthenticated access blocked: {path}", "BLOCKED", type(exc).__name__)

            try:
                response = await client.options(
                    "/api/patients",
                    headers={
                        "Origin": "https://attacker.invalid",
                        "Access-Control-Request-Method": "GET",
                        "Access-Control-Request-Headers": "content-type",
                    },
                )
                allow_origin = response.headers.get("access-control-allow-origin", "")
                passed = not allow_origin or (allow_origin != "*" and allow_origin != "https://attacker.invalid")
                _check(results, "untrusted CORS origin denied", "PASS" if passed else "FAIL", f"HTTP {response.status_code}; allow-origin={'present' if allow_origin else 'absent'}")
            except httpx.HTTPError as exc:
                _check(results, "untrusted CORS origin denied", "BLOCKED", type(exc).__name__)
    except httpx.HTTPError as exc:
        _check(results, "local API probes", "BLOCKED", type(exc).__name__)


def _write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="TIBEX safe clinic simulation runner")
    parser.add_argument("--base-url", default=os.environ.get("TIBEX_SIM_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--api", action="store_true", help="run read-only API/DB/auth/CORS checks against loopback")
    parser.add_argument("--confirm-isolated-db", action="store_true", help="confirm the local service uses a disposable simulation database")
    parser.add_argument("--skip-tests", action="store_true", help="skip the local regression simulation suite")
    parser.add_argument("--report", type=Path, help="optional JSON report destination")
    args = parser.parse_args()

    results: list[dict] = []
    env_mode = _effective_env()
    _check(results, "simulation environment is local", "PASS" if env_mode in {"local", "test"} else "BLOCKED", f"effective TIBEX_ENV={env_mode}")

    try:
        base_url = _loopback_base_url(args.base_url)
        _check(results, "target restricted to loopback", "PASS", urlsplit(base_url).hostname or "")
    except ValueError as exc:
        _check(results, "target restricted to loopback", "FAIL", str(exc))
        base_url = ""

    if not args.skip_tests:
        test_env = os.environ.copy()
        test_env["TIBEX_ENV"] = "local"
        _run_command(
            results,
            "automated negative-security/regression suite",
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_security_regressions.py"],
            env=test_env,
        )

    migration_env = os.environ.copy()
    migration_env["TIBEX_ENV"] = "local"
    _run_command(results, "Alembic migration graph has one head", [sys.executable, "-m", "alembic", "heads"], env=migration_env)

    if args.api:
        if not args.confirm_isolated_db:
            _check(results, "read-only API probes", "BLOCKED", "--confirm-isolated-db talab qilinadi; API health DB ga SELECT so'rovi yuboradi")
        elif env_mode not in {"local", "test"}:
            _check(results, "read-only API probes", "BLOCKED", "project .env is not local/test; live endpoint probes were not sent")
        elif base_url:
            asyncio.run(_api_checks(base_url, results))
    else:
        _check(results, "read-only API probes", "SKIPPED", "pass --api after starting an isolated local simulation stack")

    failed = sum(item["status"] == "FAIL" for item in results)
    blocked = sum(item["status"] == "BLOCKED" for item in results)
    overall = "FAIL" if failed else "BLOCKED" if blocked else "PASS"
    report = {
        "title": "TIBEX clinic simulation",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "overall": overall,
        "safety": "No clinical records or external provider calls were created by this runner.",
        "counts": {status: sum(item["status"] == status for item in results) for status in ("PASS", "FAIL", "BLOCKED", "SKIPPED")},
        "checks": results,
        "not_automated": [
            "browser UI workflows, staff role CRUD, synthetic patient/appointment/payment/lab lifecycle, refunds and shift close",
            "SMS/Telegram/online-payment/device integrations, WebSocket reconnect, backup restore, production DB migrations",
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.report:
        _write_report(args.report, report)
        print(f"Report saved: {args.report.resolve()}")
    return 1 if failed else 2 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
