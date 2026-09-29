# TIBEX Backend

FastAPI + PostgreSQL + Redis.

## Production ishga tushirish

Production compose faqat sir bo'lmagan sozlamalar uchun `.env.public`-ni,
maxfiy qiymatlar uchun `secrets/` fayllarini ishlatadi. Avval `.env.example`
ni `.env.public` nomiga ko'chiring, so'ng `docs/ROTATION.md` bo'yicha
secret fayllarni o'zingiz sozlang. `python setup.py` fayllar mavjudligini
va Compose sozlamasini tekshiradi, sir yaratmaydi yoki chop etmaydi, `.env`
yozmaydi. Sir fayllari to'g'ri tayyor bo'lgach `python setup.py` Compose'ni
ishga tushiradi.

Frontend alohida Nginx/static host orqali xizmat qiladi. Production'da
`TIBEX_SERVE_FRONTEND` o'chirilgan bo'lishi shart.

## Qo'lda ishga tushirish (Docker'siz, ishlab chiqish uchun)
    python -m venv .venv
    .venv\Scripts\activate    # Windows
    pip install -r requirements.txt

    copy .env.example .env
    # .env ni tahrirlang

    alembic upgrade head
    python -m scripts.init_db
    python -m scripts.create_admin --login admin --password "<kuchli-noyob-parol>" --name "Admin"

    uvicorn app.main:app --reload

Bu usulda frontend backenddan alohida serve qilinadi — qarang:
`frontend/README.md`.

## Hujjatlar
[SECURITY](docs/SECURITY.md) · [OPERATIONS](docs/OPERATIONS.md) · [ROTATION](docs/ROTATION.md) · [BACKUP](docs/BACKUP.md) · [Deploy](deploy/DEPLOY-VARIANT-B.md)

## Testlar
CI: `.github/workflows/ci.yml` (Postgres+Redis servislari bilan). Lokal: `pytest -q`. DB talab qiladigan testlar uchun `TIBEX_DATABASE_URL` test bazasiga qaratilsin (haqiqiy `.env` ishlatilmaydi).

    pytest -v

## Docker (qo'lda, .env allaqachon tayyor bo'lsa)
    docker compose up -d --build

## Sirlarni kuchli himoyalash (`.env` va `deps.py`)

**1) Sirlar alohida fayllarda saqlanadi.**
`database_url`, Redis URL/config, Telegram credentiallari va to'rtta
kriptografik kalit `backend/secrets/` ichidagi alohida fayllardan olinadi.
`docker-compose.yml` qiymatlarning o'zini environment variable sifatida
bermaydi. Fayllarning egaligi va ruxsatlarini production hostda tekshiring;
`secrets/` repoga kiritilmasligi kerak.

Konteyner entrypoint'i avval root huquqida secret fayllarni vaqtinchalik
`/run` xotira fayl tizimiga nusxalaydi, faqat `tibex` foydalanuvchisiga
o'qish huquqini beradi, migratsiya va boshlang'ich sozlamalarni bajaradi;
API jarayoni esa `gosu` orqali `tibex` foydalanuvchisiga tushiriladi. Redis
ham secret konfiguratsiyasini vaqtinchalik faylga olgach `redis` sifatida
ishga tushadi. Production hostda Docker secret fayllarini o'qish huquqi
faqat administratorga berilgan bo'lishi kerak.

Bu mexanizm har qanday maxfiy qiymat uchun universal — xohlasangiz Vault
yoki Kubernetes Secret'ni ham xuddi shu `_FILE` konventsiyasi orqali
ulash mumkin (fayl yo'lini `TIBEX_<NOM>_FILE`ga ko'rsating, xolos).

**2) Qo'shimcha ehtiyot choralari:**
- Har bir muhit (dev/staging/prod) uchun **alohida** kalitlar — hech
  qachon bir xil `SECRET_KEY`/`PEPPER`ni ikkita muhitda ishlatmang.
- Kalitlarni almashtirishdan oldin `docs/ROTATION.md` ni o'qing. Master
  kalitni almashtirish uchun qayta shifrlash skripti tayyor bo'lishi shart.
- Repo'ga tasodifan sir tushib qolishini oldini olish uchun commit
  qilishdan oldin **gitleaks** yoki **git-secrets** kabi vositani
  pre-commit hook sifatida ulashni tavsiya qilamiz.
- Production serverida: `.env` va `secrets/` papkasi faqat ilova
  ishlatadigan foydalanuvchiga tegishli bo'lsin (`chown`), va `chmod 600`
  / `chmod 700` bo'lsin. Ilova ishga tushganda buni o'zi tekshirib,
  ruxsat juda ochiq bo'lsa log'ga ogohlantirish yozadi.
- Agar biror kalit oshkor bo'lgan deb gumon qilsangiz — uni darhol
  almashtiring (yuqoridagi rotation jarayoni orqali) va barcha faol
  sessiyalarni bekor qiling (`UPDATE sessions SET revoked_at = now()`).

**3) Auth debug loglari (`deps.py`).**
Ilgari sessiya cookie'sining xom qiymati har bir so'rovda log'ga
yozilardi — bu tuzatildi. Endi:
- Token/cookie qiymati **hech qachon** hech qanday log satriga tushmaydi.
- Ixtiyoriy debug ma'lumot (`TIBEX_DEBUG_AUTH_LOGGING=true`) faqat sabab kodi va
  sessiya identifikatorining oxirgi 6 belgisini chiqaradi — sessiyani
  tiklab bo'lmaydi.
- `TIBEX_ENV=production` bo'lsa, bu debug logi kod darajasida **majburiy
  o'chirilgan** — `.env`da kim `TIBEX_DEBUG_AUTH_LOGGING=true` qo'yib qo'ysa ham
  ishlamaydi (ikkinchi qatlam himoya sifatida ilova ishga tushganda ham
  bu haqda ogohlantirish log'ga yoziladi).

## Xavfsiz klinika simulyatsiyasi

Backend katalogida dev dependencylar o'rnatilgan muhitdan ishga tushiring:

```powershell
python -m scripts.clinic_simulation --report ..\..\..\..\outputs\BIT2-clinic-simulation-report.json
```

Skript lokal regression/security testlarini va Alembic revision graph'ini tekshiradi. `--api` qo'shimchasi faqat loopback manzilga read-only HTTP so'rovlar yuboradi; health endpoint DB'ga `SELECT` qilgani sabab buning uchun `--confirm-isolated-db` ham talab qilinadi. `TIBEX_ENV` `local` yoki `test` bo'lmasa API probe yuborilmaydi. Skript demo reset qilmaydi, klinik yozuvlar yaratmaydi, SMS/Telegram/to'lov provayderlariga ulanmaydi.

Xodim, bemor, qabul, to'lov, refund va laboratoriya jarayonlarining to'liq UI end-to-end ssenariysi hozircha qo'lda, faqat ajratilgan test DB bilan bajariladi; skript hisobotida bular avtomatlashtirilmagan deb ko'rsatiladi.
