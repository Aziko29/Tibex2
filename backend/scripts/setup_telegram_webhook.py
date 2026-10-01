"""TIBEX_TELEGRAM_LOGIN_v1: Telegram bot webhookini sozlash yordamchisi.

BotFather'dan token olib, .env'ga (TIBEX_TELEGRAM_BOT_TOKEN,
TIBEX_TELEGRAM_BOT_USERNAME) yozgandan so'ng shu skriptni ishga tushiring —
u sizning domeningizga webhookni ro'yxatdan o'tkazadi (yoki o'chiradi /
holatini ko'rsatadi).

Ishlatilishi (backend/ papkasidan, venv faollashtirilgan holda):

    python scripts/setup_telegram_webhook.py set https://sizning-domen.uz
    python scripts/setup_telegram_webhook.py info
    python scripts/setup_telegram_webhook.py delete

`set` buyrug'i webhook manzilini avtomatik quradi:
    https://<domen>/api/telegram/webhook
va secret_token sifatida .env'dagi TIBEX_TELEGRAM_WEBHOOK_SECRET'ni yuboradi
(shu bilan telegram.py -> verify_webhook_secret bilan mos keladi).
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.config import get_settings  # noqa: E402


def _api_base(token: str) -> str:
    return f"https://api.telegram.org/bot{token}"


async def cmd_set(domain: str) -> int:
    s = get_settings()
    token = getattr(s, "telegram_bot_token", "") or ""
    secret = getattr(s, "telegram_webhook_secret", "") or ""

    if not token:
        print("XATO: .env'da TIBEX_TELEGRAM_BOT_TOKEN bo'sh. Avval BotFather'dan")
        print("token oling va .env fayliga yozing, so'ng qayta urinib ko'ring.")
        return 1

    domain = domain.strip().rstrip("/")
    if not domain.startswith("http"):
        domain = f"https://{domain}"
    webhook_url = f"{domain}/api/telegram/webhook"

    payload = {
        "url": webhook_url,
        "secret_token": secret,
        "allowed_updates": ["message"],
        "drop_pending_updates": True,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{_api_base(token)}/setWebhook", json=payload)

    data = r.json()
    print(f"HTTP {r.status_code}: {data}")
    if data.get("ok"):
        print(f"\n✅ Webhook o'rnatildi: {webhook_url}")
        if not secret:
            print(
                "⚠️  Diqqat: TIBEX_TELEGRAM_WEBHOOK_SECRET bo'sh edi — webhook"
                " secret_token'siz o'rnatildi. Bu faqat dev uchun xavfsiz."
            )
        return 0
    print("\n❌ Webhookni o'rnatib bo'lmadi, xabarni tekshiring.")
    return 1


async def cmd_info() -> int:
    s = get_settings()
    token = getattr(s, "telegram_bot_token", "") or ""
    if not token:
        print("XATO: .env'da TIBEX_TELEGRAM_BOT_TOKEN bo'sh.")
        return 1
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(f"{_api_base(token)}/getWebhookInfo")
    print(r.json())
    return 0


async def cmd_delete() -> int:
    s = get_settings()
    token = getattr(s, "telegram_bot_token", "") or ""
    if not token:
        print("XATO: .env'da TIBEX_TELEGRAM_BOT_TOKEN bo'sh.")
        return 1
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{_api_base(token)}/deleteWebhook")
    print(r.json())
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_set = sub.add_parser("set", help="Webhookni domenga o'rnatish")
    p_set.add_argument("domain", help="Masalan: https://klinika.uz")

    sub.add_parser("info", help="Joriy webhook holatini ko'rish")
    sub.add_parser("delete", help="Webhookni o'chirish (polling rejimiga qaytish)")

    args = parser.parse_args()

    if args.cmd == "set":
        return asyncio.run(cmd_set(args.domain))
    if args.cmd == "info":
        return asyncio.run(cmd_info())
    if args.cmd == "delete":
        return asyncio.run(cmd_delete())
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
