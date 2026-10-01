# TIBEX — Telegram bot orqali bemor kirishi: joylashtirish qo'llanmasi

Kod tomoni (backend + frontend + migratsiya) to'liq tayyor. Qolgan qadamlar
— sizning real serveringiz/Telegram akkauntingizga bog'liq bo'lgani uchun
buni faqat siz (yoki serverga kirish huquqi bo'lgan admin) bajara oladi.

## 1) Bot yaratish (@BotFather)

1. Telegram'da **@BotFather** bilan chat oching.
2. `/newbot` yuboring, botga nom va username bering (username `bot` bilan
   tugashi kerak, masalan `TibexKlinikaBot`).
3. BotFather sizga **token** beradi (masalan
   `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`).

## 2) `.env` faylini to'ldirish

`backend/.env` faylida:

```
TIBEX_TELEGRAM_BOT_TOKEN=<BotFather bergan token>
TIBEX_TELEGRAM_BOT_USERNAME=<bot_username, @ belgisiz>
```

`TIBEX_TELEGRAM_WEBHOOK_SECRET` allaqachon xavfsiz tasodifiy qiymat bilan
to'ldirilgan — uni o'zgartirmang (o'zgartirsangiz, webhookni qayta
o'rnatishingiz kerak bo'ladi).

## 3) Migratsiyani ishga tushirish

```bash
cd backend
alembic upgrade head
```

Bu `users.telegram_chat_id` ustunini va `telegram_link_tokens` jadvalini
yaratadi (migratsiya fayli tayyor: `alembic/versions/20260927_120000_tg2026092711_telegram_login.py`).

## 4) Backendni qayta ishga tushiring

`.env` o'zgarganidan so'ng serverni (yoki `tibex.service`ni) qayta
ishga tushiring, shunda yangi sozlamalar o'qiladi.

## 5) Webhookni Telegram serverida ro'yxatdan o'tkazish

Sizning bemor domeningiz HTTPS orqali ochiq bo'lishi shart (Telegram
faqat HTTPS webhooklarni qabul qiladi). So'ng:

```bash
cd backend
python scripts/setup_telegram_webhook.py set https://sizning-domen.uz
```

Muvaffaqiyatli bo'lsa, `"ok": true` javobi qaytadi. Holatni istalgan vaqt
tekshirish uchun:

```bash
python scripts/setup_telegram_webhook.py info
```

## 6) Sinovdan o'tkazish

1. Saytdagi bemor kirish sahifasida **Telegram botni ochish** tugmasini
   bosing yoki botga `/start` yuboring.
2. Bot ko'rsatgan **Telefon raqamimni yuborish** tugmasini bosing. Telefon
   raqami Telegram Contact orqali, bemorning o'z akkauntidan kelishi kerak.
3. Bot telefonni bemorlar bazasidan izlaydi. Topilsa bemor akkauntini
   yaratadi (avval bo'lmasa) va Telegram bilan bog'laydi. Ulanganda kod
   AVTOMATIK yuborilmaydi.
4. Kirish kodini oling: botga `/code` yuboring (yoki saytdagi **Telegram
   kodini so'rash** tugmasini bosing). Kod faqat shu so'rovdan keyin
   keladi. Keyin saytga telefon raqami va shu kod bilan kiring.
5. Admin panelida Bemorlar → bemor qatori → akkaunt tugmasi →
   **Bir martalik kirish kodi** orqali bemorga 5 daqiqa amal qiladigan
   kod berish mumkin. Kod bir marta ishlaydi.

Bot buyruqlari: `/start`, `/code`, `/help`, `/status`, `/unlink`.

## Eslatma

- Bot tokeni sozlanmagan bo'lsa, bemor kodlari yuborilmaydi; SMS zaxirasi
  ataylab o'chirilgan.
- SMS integratsiyasi va bulk SMS endpointi o'chirilgan. Kirish kodlari
  faqat Telegram yoki admin tomonidan beriladi.
- Webhook so'rovlari `X-Telegram-Bot-Api-Secret-Token` headeri orqali
  tekshiriladi — soxta so'rovlar rad etiladi.
