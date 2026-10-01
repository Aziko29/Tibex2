#!/bin/sh
# TIBEX backend entrypoint — konteyner ishga tushganda avtomatik:
#   1) migratsiyalarni qo'llaydi (alembic upgrade head)
#   2) tizim rollari va boshlang'ich smenani yaratadi (idempotent)
#   3) production BO'LMASA va hali admin bo'lmasa — tasodifiy parolli
#      admin hisobini bir martalik yaratadi va parolni bir marta chop etadi
# Shundan keyingina ilova serverini (gunicorn) ishga tushiradi.
set -e

# Compose file-backed secrets are mounted read-only. Copy them into tmpfs,
# make the files readable only by the application account, and pass paths
# (never secret values) to Settings. This also supports host files at 0600.
SECRET_DIR=/run/tibex-secrets
mkdir -p "$SECRET_DIR"
chown tibex:tibex "$SECRET_DIR"
chmod 700 "$SECRET_DIR"
cp /run/secrets/tibex_database_url "$SECRET_DIR/database_url"
cp /run/secrets/tibex_redis_url "$SECRET_DIR/redis_url"
cp /run/secrets/tibex_telegram_bot_token "$SECRET_DIR/telegram_bot_token"
cp /run/secrets/tibex_telegram_webhook_secret "$SECRET_DIR/telegram_webhook_secret"
cp /run/secrets/tibex_secret_key "$SECRET_DIR/secret_key"
cp /run/secrets/tibex_master_key_b64 "$SECRET_DIR/master_key_b64"
cp /run/secrets/tibex_master_keys "$SECRET_DIR/master_keys.json"
cp /run/secrets/tibex_blind_index_key_b64 "$SECRET_DIR/blind_index_key_b64"
cp /run/secrets/tibex_password_pepper "$SECRET_DIR/password_pepper"
chown tibex:tibex "$SECRET_DIR"/*
chmod 400 "$SECRET_DIR"/*
export TIBEX_DATABASE_URL_FILE="$SECRET_DIR/database_url"
export TIBEX_REDIS_URL_FILE="$SECRET_DIR/redis_url"
export TIBEX_TELEGRAM_BOT_TOKEN_FILE="$SECRET_DIR/telegram_bot_token"
export TIBEX_TELEGRAM_WEBHOOK_SECRET_FILE="$SECRET_DIR/telegram_webhook_secret"
export TIBEX_SECRET_KEY_FILE="$SECRET_DIR/secret_key"
export TIBEX_MASTER_KEY_B64_FILE="$SECRET_DIR/master_key_b64"
export TIBEX_MASTER_KEYS_FILE="$SECRET_DIR/master_keys.json"
export TIBEX_BLIND_INDEX_KEY_B64_FILE="$SECRET_DIR/blind_index_key_b64"
export TIBEX_PASSWORD_PEPPER_FILE="$SECRET_DIR/password_pepper"

echo "[entrypoint] Kalitlar halqasi tekshirilmoqda..."
python -c 'from app.security.crypto import _ring; _ring._ensure()'

echo "[entrypoint] Migratsiyalar qo'llanmoqda..."
alembic upgrade head

echo "[entrypoint] Rollar / smena tekshirilmoqda..."
python -m scripts.init_db

if [ "${TIBEX_ENV:-local}" != "production" ]; then
  python - <<'PYEOF'
import asyncio
from app.config import get_settings
from app.db import _init
import app.db as db
from app.models import User
from app.security.passwords import hash_password, generate_random_password
from sqlalchemy import select


async def ensure_admin():
    _init()
    async with db._SessionLocal() as session:
        existing = (await session.execute(select(User))).first()
        if existing is not None:
            return
        password = generate_random_password(16)
        session.add(User(
            fullname="Administrator",
            login="admin",
            password_hash=hash_password(password),
            role_key="admin",
            active=True,
        ))
        await session.commit()
        print("=" * 60)
        print("  [entrypoint] Birinchi ishga tushirish — admin yaratildi")
        print("=" * 60)
        print("  Login:  admin")
        print(f"  Parol:  {password}")
        print("  Bu parol faqat shu safar chop etiladi — yozib oling.")
        print("=" * 60)

asyncio.run(ensure_admin())
PYEOF
fi

echo "[entrypoint] Tayyor. Server ishga tushmoqda..."
exec gosu tibex "$@"
