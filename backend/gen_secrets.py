"""TIBEX: tasodifiy kalitlarni yaratadi. backend/ papkasi ichidan ishga tushiring.

    python gen_secrets.py local    -> backend/.env  (lokal ishlab chiqish, TIBEX_ENV=local)
    python gen_secrets.py prod     -> backend/secrets/*  (docker compose, production)

Mavjud fayllarni ustidan YOZMAYDI (kalit almashib ketsa, shifrlangan bemor ma'lumotlari ochilmay qoladi).
Yaratilgan qiymatlarni chatga yubormang va commit qilmang.
"""
import base64
import json
import secrets
import sys
from pathlib import Path
from urllib.parse import quote


def b64(n: int) -> str:
    return base64.b64encode(secrets.token_bytes(n)).decode()


def write_new(path: Path, text: str) -> None:
    if path.exists():
        sys.exit(f"TO'XTADI: {path} allaqachon bor. Kalitni almashtirish oqibatlari uchun docs/ROTATION.md ni o'qing; "
                 "kerak bo'lsa faylni o'zingiz o'chiring.")
    path.write_text(text, encoding="utf-8", newline="\n")


mode = sys.argv[1] if len(sys.argv) > 1 else ""
if mode not in ("local", "prod"):
    sys.exit("Ishlatish: python gen_secrets.py local   yoki   python gen_secrets.py prod")

if mode == "local":
    write_new(Path(".env"), "\n".join([
        "TIBEX_ENV=local",
        f"TIBEX_SECRET_KEY={secrets.token_hex(32)}",
        f"TIBEX_MASTER_KEY_B64={b64(32)}",
        f"TIBEX_BLIND_INDEX_KEY_B64={b64(32)}",
        f"TIBEX_PASSWORD_PEPPER={b64(48)}",
        "",
    ]))
    print("Tayyor: .env yaratildi (TIBEX_ENV=local). DB manzili standart: postgresql+asyncpg://tibex:tibex@localhost:5432/tibex.")
    print("Boshqa DB ishlatsangiz, .env ga TIBEX_DATABASE_URL=... qatorini qo'shing.")
else:
    d = Path("secrets")
    d.mkdir(exist_ok=True)
    db_pass, redis_pass, master = secrets.token_urlsafe(32), secrets.token_urlsafe(32), b64(32)
    files = {
        "secret_key.txt": secrets.token_hex(32),
        "master_key_b64.txt": master,
        "master_keys.json": json.dumps({"1": master}),
        "blind_index_key_b64.txt": b64(32),
        "password_pepper.txt": b64(48),
        "database_url.txt": f"postgresql+asyncpg://tibex:{quote(db_pass, safe='')}@host.docker.internal:5432/tibex",
        "redis_url.txt": f"redis://:{quote(redis_pass, safe='')}@redis:6379/0",
        "redis.conf": f"appendonly yes\nrequirepass {redis_pass}",
        "telegram_bot_token.txt": "",
        "telegram_webhook_secret.txt": "",
    }
    existing = [n for n in files if (d / n).exists()]
    if existing:
        sys.exit(f"TO'XTADI: secrets/ da allaqachon bor: {existing}. Hech narsa yozilmadi.")
    for name, val in files.items():
        write_new(d / name, val + "\n")
    print("Tayyor: secrets/ yaratildi.")
    print("Postgres'da 'tibex' foydalanuvchisiga shu parolni o'rnating (faqat shu yerda ko'rinadi):", db_pass)
