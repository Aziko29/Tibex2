# Maxfiy kalitlarni almashtirish bo'yicha qo'llanma

Ushbu buyruqlar Linux production serverida administrator tomonidan bajariladi. Qiymatlarni chatga, terminal tarixiga, logga yoki repoga kiritmang. Sirlar faqat `backend/secrets/` ichidagi fayllarda turadi; katalog `0700`, fayllar `0600` bo'lishi kerak.

## Kerakli qiymatlar

Quyidagilar alohida, kriptografik tasodifiy qiymat bo'lishi kerak: `secret_key.txt`, `password_pepper.txt`, `master_key_b64.txt`, `master_keys.json`, `blind_index_key_b64.txt`, `database_url.txt`, `redis_url.txt`, Telegram bot token va webhook siri. Redis uchun `redis.conf` dagi `requirepass` qiymati `redis_url.txt` ichidagi parol bilan bir xil bo'lishi shart. Telegram bot tokeni BotFather'da `/revoke` orqali bekor qilinadi.

Quyidagi buyruqlar faqat terminalda qiymat yaratadi; natijalarni hech kimga yubormang:

```sh
cd /path/to/BIT/backend
install -d -m 700 secrets
umask 077
openssl rand -hex 32 > secrets/secret_key.txt
openssl rand -base64 32 > secrets/master_key_b64.txt
python - <<'PY'
import json
from pathlib import Path
key = Path("secrets/master_key_b64.txt").read_text().strip()
Path("secrets/master_keys.json").write_text(json.dumps({"1": key}) + "\n")
PY
openssl rand -base64 32 > secrets/blind_index_key_b64.txt
openssl rand -base64 48 > secrets/password_pepper.txt
```

`database_url.txt` ichiga PostgreSQL serveridagi mavjud `tibex` foydalanuvchisiga mos to'liq `postgresql+asyncpg://tibex:<parol>@127.0.0.1:5432/tibex` URL yoziladi. Belgilar URL uchun maxsus bo'lsa parol percent-encode qilinadi. `redis_url.txt` uchun yangi alohida Redis paroli ishlatilib `redis://:<parol>@127.0.0.1:6379/0` ko'rinishidagi URL yoziladi. `redis.conf` ichiga kamida `appendonly yes` va shu parolga mos `requirepass <parol>` yoziladi. Maxfiy matnlarni shell argumenti sifatida bermang.

Telegram ishlatilmasa, `telegram_bot_token.txt` va `telegram_webhook_secret.txt` bo'sh qoldiriladi. Ishlatilsa, ikkala faylni haqiqiy yangi qiymat bilan to'ldiring va webhook'ni qayta ro'yxatdan o'tkazing.

```sh
chmod 700 secrets
chmod 600 secrets/*
```

## Almashtirish ta'siri va ketma-ketligi

1. Avval zaxira nusxa oling va tiklash imkonini alohida muhitda tekshiring.
2. `TIBEX_SECRET_KEY` almashtirilganda eski imzolangan sessiyalar yaroqsiz bo'ladi; barcha xodim va bemorlar qayta kirishi kerak.
3. `TIBEX_PASSWORD_PEPPER` almashtirilganda eski parol xeshlari tekshirilmay qolishi mumkin. Barcha akkauntlar uchun nazoratli parol tiklash rejasini tayyorlang; administratorlarni `python -m scripts.create_admin` orqali qayta yarating. Foydalanuvchilarga umumiy vaqtinchalik parol bermang.
4. Master kalit halqasi `master_keys.json` ko'rinishida bo'ladi: `{"1":"<eski-b64>","2":"<yangi-b64>"}`. Eski kalitni ro'yxatdan o'chirmasdan yangi kalitni qo'shing, so'ng `.env.public` dagi `TIBEX_MASTER_ACTIVE_KEY_ID=2` ni belgilang. Avval backup oling. Backend konteynerini qayta yarating, shunda yangi kalit halqasi yuklanadi. Yangi yozuvlar ID 2 bilan shifrlanadi, eski yozuvlar ID 1 bilan o'qiladi. Maintenance oynasida avval `docker compose exec backend python -m scripts.reencrypt --dry-run`, so'ng `docker compose exec backend python -m scripts.reencrypt --batch 500` bajaring. Skript xato bilan to'xtasa, eski kalitni olib tashlamang. Qayta shifrlash tugagandan keyingina eski kalitni alohida tekshirilgan zaxira escrow'ga ko'chiring va eski kalit bo'lmagan keyring bilan konteynerni qayta yarating. Bu skript production DB'ga ulanadi; uni faqat operator tasdiqlangan backup va maintenance oynasida ishga tushiradi.
5. Blind-index kalitini almashtirish mavjud indekslarni o'qish/qidirishga ta'sir qiladi; migratsiya va indekslarni qayta qurish rejasisiz almashtirmang.
6. DB yoki Redis credential almashtirilganda avval serverdagi rol/parol va Redis ACL/config'ni yangilang, so'ng mos secret fayllarni yangilang, so'ng servislarni qayta ishga tushiring. Har bosqichda ulanishni tekshiring.
7. Telegram tokenini BotFather'da bekor qilib, yangisini secret faylga kiriting; webhook secretni ham yangilang va webhook'ni qayta o'rnating.
8. Fayllarni zaxira nusxada saqlash zarur bo'lsa, ilova DB zaxirasidan alohida, shifrlangan va kirishi cheklangan escrow'da saqlang. Eski kalitlarni tekshirilgan rotatsiyadan oldin yo'q qilmang.

> Agent ushbu buyruqlarni ishga tushirmaydi va kalit yaratmaydi. Kalit halqasi va qayta shifrlash kodi qo'shilgan, ammo real DB rotatsiyasi faqat operatorning backup/restore mashqi va alohida test bazasidagi tekshiruvdan keyin bajarilishi kerak.

## Kalit ajratish (32-band) — sessiyalar bekor bo'ladi
`SECRET_KEY` endi HKDF-SHA256 bilan maqsadga xos kalitlarga bo'linadi (`app/security/keys.py`: `session`, `csrf`, `otp`, `fingerprint`, `camera`).
Shu release'ga o'tishda (yoki `SECRET_KEY` almashtirilganda) **barcha sessiyalar, CSRF tokenlar va tugallanmagan OTP kodlar yaroqsiz bo'ladi** — foydalanuvchilar qayta kiradi. Ish vaqtidan tashqarida o'tkazing.
