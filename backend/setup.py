#!/usr/bin/env python3
"""Production sozlamalarini tekshiradi va Docker Compose'ni ishga tushiradi.

Bu skript kalit yaratmaydi, secret qiymatlarini ko'rsatmaydi va `.env` yozmaydi.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

HERE = Path(__file__).resolve().parent
PUBLIC_TEMPLATE = HERE / ".env.example"
PUBLIC_ENV = HERE / ".env.public"
SECRETS = HERE / "secrets"
SECRET_FILES = (
    "database_url.txt",
    "redis_url.txt",
    "telegram_bot_token.txt",
    "telegram_webhook_secret.txt",
    "secret_key.txt",
    "master_key_b64.txt",
    "master_keys.json",
    "blind_index_key_b64.txt",
    "password_pepper.txt",
    "redis.conf",
)
OPTIONAL_SECRET_FILES = {"telegram_bot_token.txt", "telegram_webhook_secret.txt"}


def fail(message: str) -> NoReturn:
    print(f"[XATO] {message}", file=sys.stderr)
    raise SystemExit(2)


def compose_command() -> list[str]:
    if shutil.which("docker"):
        result = subprocess.run(
            ["docker", "compose", "version"], capture_output=True, text=True, check=False
        )
        if result.returncode == 0:
            return ["docker", "compose"]
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    fail("Docker Compose topilmadi.")


def prepare_public_config() -> None:
    if not PUBLIC_TEMPLATE.is_file():
        fail(".env.example topilmadi.")
    if not PUBLIC_ENV.exists():
        shutil.copyfile(PUBLIC_TEMPLATE, PUBLIC_ENV)
    try:
        os.chmod(PUBLIC_ENV, 0o600)
    except OSError:
        pass


def check_secret_files() -> None:
    SECRETS.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(SECRETS, 0o700)
    except OSError:
        pass

    missing = [name for name in SECRET_FILES if not (SECRETS / name).is_file()]
    if missing:
        fail(
            "Quyidagi secret fayllar avval qo'lda yaratilishi va docs/ROTATION.md "
            f"bo'yicha to'ldirilishi kerak: {', '.join(missing)}"
        )

    incomplete = []
    for name in SECRET_FILES:
        path = SECRETS / name
        try:
            content = path.read_text(encoding="utf-8").strip()
        except OSError:
            incomplete.append(name)
            continue
        if (
            (not content and name not in OPTIONAL_SECRET_FILES)
            or "CHANGE_ME" in content.upper()
            or "CHANGE-ME" in content.upper()
        ):
            incomplete.append(name)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    if incomplete:
        fail(
            "Secret fayllar bo'sh yoki namuna qiymatida. Qiymatlari ekranga "
            "chiqarilmadi; docs/ROTATION.md bo'yicha tekshiring."
        )


def main() -> None:
    prepare_public_config()
    check_secret_files()
    compose = compose_command()
    config = subprocess.run(compose + ["config", "--quiet"], cwd=HERE, check=False)
    if config.returncode:
        fail("Docker Compose sozlamasi yaroqsiz; sirli qiymatlar chop etilmadi.")
    print("[>] Production servislari ishga tushirilmoqda.")
    subprocess.run(compose + ["up", "-d", "--build"], cwd=HERE, check=True)


if __name__ == "__main__":
    main()
