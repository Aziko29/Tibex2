# TIBEX production hardening — ish jurnali

Bu hujjat `BIT 6` nusxasida bajarilgan ishlarni qayd etadi. Haqiqiy server, Docker konteyneri, PostgreSQL/Redis ma'lumotlari va tashqi xizmatlarga ulanilmadi.

## Bajarildi

- `payments.py` ichida ishlatilgan, lekin import qilinmagan `get_settings` importi qo'shildi.
- Xato handlerlar HTTP xatosi, so'rov validatsiyasi va kutilmagan server xatosi uchun alohida qilindi. Ichki xato javob orqali oshkor qilinmaydi; server jurnalida stack trace saqlanadi.
- `/api/health` endi DB ulanishini va sozlangan Redisni tekshiradi. Tekshiruv muvaffaqiyatsiz bo'lsa `503` va `{"ok": false}` qaytaradi; ichki tafsilotlar javobga chiqmaydi.
- Production'da `TIBEX_SERVE_FRONTEND=true` bo'lsa ilova ishga tushmaydi. Compose production sozlamasi `false` qilindi va frontend bind mount olib tashlandi.
- Xavfli admin reset routeri production'da ro'yxatdan o'tmaydi. Factory reset, full demo reset va ommaviy parol reset buyruqlari ham production'da to'xtaydi; demo reset servisining o'zida ham himoya bor.
- Production sozlamalarida muhit nomi normallashtiriladi/tekshiriladi; demo reset kodi taqiqlanadi; asosiy kalitlar takrorlanmasligi, PostgreSQL paroli kamida 24 belgi bo'lishi va Telegram yoqilganda webhook siri berilishi tekshiriladi.
- Compose sirlarni `environment` ichida literal qiymat ko'rinishida bermasligi uchun DB URL, Redis URL/config, Telegram credentiallari va mavjud to'rtta kalit faylini `secrets:` orqali ulashga o'tkazildi. Sir bo'lmagan sozlamalar uchun `.env.example` andozasi qo'shildi; `setup.py` endi kalit yaratmaydi va qiymat ko'rsatmaydi, secret fayllari tayyorligini tekshiradi. Backend va Redis secret mount'larni tmpfs'ga nusxalaydi va ilovani imtiyozsiz foydalanuvchi sifatida ishga tushiradi. `docs/ROTATION.md` kalitlarni foydalanuvchi almashtirishi uchun yozildi.
- Eski README'dagi avtomatik sir yaratish va logdan birinchi admin parolini olish haqidagi noto'g'ri yo'riqnoma olib tashlandi.
- O'zgargan health va production sozlamalariga testlar qo'shildi. Test muhitiga faqat sun'iy kalitlar qo'yildi.

## Tekshiruv

- `python -m compileall -q backend/app backend/scripts` — muvaffaqiyatli.
- `pytest -q backend/tests` — 45 test muvaffaqiyatli. Faqat Starlette/httpx deprecation ogohlantirishi qoldi (Compose/secret mount yo'lini runtime'da sinamadi).
- `ruff check --select F821 backend/app backend/scripts backend/setup.py` — `undefined name` xatolari 0.
- `ruff check backend/app backend/scripts backend/setup.py` — repo bo'ylab 235 lint muammosi topildi; to'liq lint toza emas, aniqlangan bandlar keyingi ishlar uchun ochiq.
- `python -m pyflakes app scripts tests` — 0 ta `undefined name` (keyingi bosqichda tekshirildi).

## Ochiq / bajarilmagan

- Loyiha nusxasida `.git` yo'q; shuning uchun branch yoki commit yaratilmagan.
- 3-banddagi `demo.py`, `autofix_admin.py`, `snapshot.py`, `security_audit.py` `dev-tools/`ga ko'chirildi; 2 MB `snapshot.md` o'chirildi. (Keyingi bosqichda bo'sh `backend/powershell`/`frontend/span` ham o'chirildi; arxivda `.deb` va `__pycache__` yo'q.)
- `Patient.fullname` ma'lumoti uchun shifrlash bo'yicha talabdagi qaror kutilmoqda. Shu sababli bu maydon, migratsiya va unga bog'liq kalit rotatsiyasi o'zgartirilmadi.
- Haqiqiy production `.env`/secret fayllari, DB/Redis, domen, TLS, backup va tashqi SMS/Telegram sozlamalari ko'rilmagan yoki o'zgartirilmagan.
- Compose YAML sintaksisi va secret mount runtime holati tasdiqlanmagan. `docker compose config --quiet` `.env.public` yo'qligi va Docker CLI konfiguratsiyasiga ruxsat bo'lmagani sababli muvaffaqiyatsiz tugadi. Linux hostda secret fayl egaligi/ruxsatlari backend va Redis xizmat foydalanuvchilariga mosligi tekshirilishi, tarmoq/IP arxitekturasi esa keyingi bandda hal qilinishi kerak.
- To'liq deployga tayyor deb tasdiqlash uchun qolgan security bandlari, migratsiyalar va real bo'lmagan, alohida test muhiti talab qilinadi.

## Davom — 16-band: kalitlar halqasi va deshifrlash xatolari

- `backend/app/security/crypto.py`: `TIBEX_MASTER_KEYS_FILE` JSON kalit xaritasi, barqaror kalit ID va `TIBEX_MASTER_ACTIVE_KEY_ID` qo'llandi. Eski bitta `master_key_b64` moslik uchun qoldi, bu rejimda ogohlantirish yoziladi. Noto'g'ri ID yoki buzilgan ciphertext `DecryptionError` beradi. `EncryptedString`/`EncryptedText` endi `"—"` qaytarmaydi; critical log va in-memory alert hosil qiladi. `EncryptedJSON` qo'shildi.
- `backend/app/main.py`: so'rov qabul qilishdan oldin key ring tekshiriladi.
- `backend/docker-compose.yml`, `backend/docker-entrypoint.sh`, `backend/setup.py`: key ring secret fayli va faol ID sozlamasi qo'shildi.
- `backend/scripts/reencrypt.py`: encrypted ustunlarni batch bilan qayta shifrlash, `--dry-run`, `--batch`, legacy AAD yozuvlarini faqat migratsiyada o'qish va idempotent ishlash qo'shildi.
- `backend/docs/ROTATION.md`: kalit ID qo'shish, eski kalitni saqlash, backup va rotatsiya ketma-ketligi yozildi.
- `backend/tests/test_security_regressions.py`: fixed-window TTL, old/new key, JSON round-trip, noto'g'ri ciphertext va JSON keyring testlari qo'shildi.
- Tekshiruv: `pytest -q backend/tests` — 45 passed; `compileall` — muvaffaqiyatli; `ruff check --select F821 ...` — muvaffaqiyatli. `pyflakes` virtual muhitda o'rnatilmagan. To'liq ruff repo bo'ylab oldingi va mavjud format/import muammolarini ko'rsatadi.
- Redis `observe()` atomik Lua fixed-window counter ishlatadi; expiry faqat key yaratilganda qo'yiladi.
- Runtime qayta shifrlash, migration, Docker start, haqiqiy DB/Redis va production sirlar ishga tushirilmadi. Keyring faylini yaratish/deploy qilish operator vazifasi.

## Joriy nuqta

16-band kodi va unit regressionlari bajarildi. 17-bandda `Patient.fullname` va boshqa PHI maydonlarini saqlash/qidiruv sxemasi o'zgaradi. Prompt foydalanuvchi qarorini majburiy qilgani uchun fullname sxemasi va unga bog'liq PHI migratsiyasi kutmoqda. A yoki B qarori kelmaguncha shu o'zgarishlarga bog'liq ishlar bajarilmaydi.

### 16-band qayta ko'rikdagi qo'shimcha mustahkamlash

- Keyring parsingi endi to'liq tekshiruv o'tmaguncha ichki holatni o'zgartirmaydi. Noto'g'ri `active_key_id` birinchi xatodan keyin eski/yarim yuklangan kalitni ishlatib ketolmaydi; regressiya testi qo'shildi.
- `docker-entrypoint.sh` kalit halqasini Alembic migratsiyalaridan oldin tekshiradi; noto'g'ri yoki yo'q secret bo'lsa DB migratsiyasiga o'tmaydi.
- `TIBEX_MASTER_ACTIVE_KEY_ID` `.env.public` orqali olinishi uchun Compose'dagi noto'g'ri interpolatsiya olib tashlandi; andoza va rotatsiya hujjati moslashtirildi. Rotatsiya paytida konteynerni qayta yaratish va container ichida `reencrypt.py` ishlatish ko'rsatildi.
- Yakuniy tekshiruv: `pytest -q backend/tests` — 45 passed; `compileall`, `ruff check --select F821` va Compose YAML parse — muvaffaqiyatli.


---

# Bo'shliqlarni yopish (1–16-bandlar) — 2026-09-29

Format: band → o'zgargan fayllar → qanday tekshirildi. Hammasi lokal sandboxda (Python 3.12, SQLite/fake DB); haqiqiy Postgres/Redis/Docker/nginx **ishlatilmadi**.

| Band | O'zgargan fayllar | Tekshiruv |
|---|---|---|
| 1 | `tests/test_payments.py` (`list_payments(today=True)` va `close_shift` regressiya testlari) | 2 yangi test yashil |
| 3 | `backend/powershell`, `frontend/span` o'chirildi | `find` bilan tekshirildi |
| 4 | `deploy/tibex.service` (`TIBEX_MASTER_KEYS_FILE` qo'shildi; `MASTER_ACTIVE_KEY_ID` `.env.public` orqali keladi) | qo'lda o'qib tekshirildi |
| 6 | `scripts/check_real_ip.sh` (yangi), `deploy/DEPLOY-VARIANT-B.md` (QADAM 5a, `master_keys.json`, health javobi, checklist) | `bash -n` OK; **haqiqiy serverda ishga tushirilmagan** |
| 9 | `deploy/nginx.conf` (CSP'ga `style-src-attr 'unsafe-inline'`), `DEPLOY-VARIANT-B.md` (`rsync` nusxalash) | `nginx -t` **ishga tushirilmagan** |
| 10 | `Dockerfile` (ko'p bosqichli, `--require-hashes`), `requirements.txt` (`~=`), `requirements.lock` (hash'li, `pip-compile`), `pyproject.toml` (`~=`) | lock generatsiya qilindi; `docker build` **ishga tushirilmagan** |
| 11 | `security/passwords.py` (semaphore endi har event loop uchun alohida), `tests/test_auth_flow.py::test_parallel_password_hashing_does_not_block_event_loop` | 8 parallel Argon2 paytida loop qotishi < 200 ms |
| 12 | `tests/test_auth_flow.py` (mavjud/yo'q/qulflangan login: bir xil 401 + matn, har birida 1 ta Argon2, vaqt farqi < 30 ms) | yashil |
| 14 | `security/session_binding.py` (mos kelmaslikda audit `session_mismatch` + alert; sessiya bekor qilinmaydi), `frontend/docs/API.md` (cookie nomi) | mavjud binding testi yashil |
| 15 | `security/session_state.py` (yangi, umumiy mantiq), `deps.py` va `routers/ws.py` shuni ishlatadi; rad etilgan WS ulanishi audit'ga (`ws_reject`) | `tests/test_ws.py` (10 test) |
| 16 | `tests/test_crypto_rotation.py` (`reencrypt.py` dry-run/haqiqiy/idempotent — SQLite'da; noma'lum ID → `DecryptionError`) | yashil |

Yakuniy: `pytest` — **63 passed** (2 marta ketma-ket), `pyflakes app scripts tests` — 0 ta `undefined name`. Compose YAML parse — OK.

## Hali yopilmagan / e'tibor talab qiladi

- **CSP hali `Report-Only`.** 9-band uni 23-bandda (inline handlerlar olib tashlangach) enforce qilishni talab qiladi.
- **12-band:** `failed_attempts` qulfi hamon foydalanuvchi bo'yicha umumiy (`(user, ip)` juftligiga bog'lanmagan); himoya sifatida admin `unlock` endpointi bor.
- **6-band muqobil variant** (host-network taqiqlangan bo'lsa) avtomatlashtirilmagan — faqat hujjatda tavsiflangan, QAROR KERAK.
- **16-band:** `record_alert` xotiradagi bufer — jarayon qayta ishga tushganda alertlar yo'qoladi (29-bandda hal qilinadi).
- **15-band:** rol o'zgarganda WS'ni yopish yo'li alohida tekshirilmadi (logout/parol o'zgarishi/sessiyani bekor qilish yo'llari `publish_session_revoked` ishlatadi).
- **Tekshirilmagan:** Alembic `upgrade/downgrade`, `docker build`/`compose up`, `nginx -t`, real DB/Redis. Bularni serverda `check_real_ip.sh` va Definition-of-Done bo'yicha tasdiqlash kerak.
- `pyproject.toml` `packages` ro'yxatida `app.middleware` va `app.services` yo'q (avvaldan bor muammo; bu bosqichda tegilmadi).

---

# 17–20-bandlar — 2026-09-29

**Muhim:** bu sandboxda `fastapi/sqlalchemy/pytest/pyflakes` o'rnatilmagan (tarmoq yo'q), shuning uchun faqat `compileall` (xatosiz) va `bash -n` bajarildi. `pytest`, `pyflakes`, Alembic `upgrade/downgrade`, trigger va skriptlar **ishga tushirilmagan** — serverda/CI'da tasdiqlang.

| Band | O'zgargan fayllar | Tekshiruv |
|---|---|---|
| 17 | `app/models.py` (PHI ustunlar → `*_enc`, `EncryptedText/JSON`, noyob context; ORM atribut nomlari o'zgarmagan), `alembic/versions/20260929_100000_phi…encrypt_phi.py` (1-bosqich: qo'shish + batch ko'chirish; eski ustunlar qoladi; `downgrade()` deshifrlab qaytaradi), `docs/SECURITY.md` (qonun ro'yxati, fullname qarori) | `tests/test_phi_audit.py` (tur tekshiruvi); migratsiya **ishga tushirilmagan** |
| 18 | `security/audit.py` (Python `created_at`, `id/ip/before/after` hash'da, advisory lock, `verify_audit_chain`), `routers/audit.py` (`GET /verify`, `/clear` → 410, `Literal` action, `audit.write`), `models.py` (`legacy`), `alembic/…aud…append_only.py` (trigger + REVOKE), `services/demo_reset.py` (audit o'chirilmaydi), `routers/roles.py`, `scripts/verify_audit.py`, `scripts/audit_archive.py` | hash testi; trigger/verify **ishga tushirilmagan** |
| 19 | `security/audit.py:audit_view`; `patients`, `appointments`, `lab`, `payments` (GET), `bootstrap`, `patient_portal` GET'lari | `tests/test_payments.py` yangilandi |
| 20 | `scripts/backup.sh`, `restore.sh`, `restore_drill.sh`, `deploy/tibex-backup.cron`, `tibex-restore-drill.service/.timer`, `DEPLOY-VARIANT-B.md` QADAM 12, `docs/BACKUP.md`, `backup_db.py` → `dev-tools/` | `bash -n` OK |

## Qaror / eslatmalar
- **17-band `fullname`:** (A) ochiq qoldirildi (tezlik uchun); (B) blind-index — sizning qaroringizni kutadi.
- **Eski ochiq ustunlar** DB'da qoladi — keyingi releasda o'chirilmaguncha zaxiralarda ochiq matn bor.
- **Frontend:** admin paneldagi "Auditni tozalash" endi 410 oladi (UI olib tashlanmagan).
- **`audit.write`** ruxsati rollarga berilmagan (faqat `superadmin`). Frontend telemetriyasi kerak bo'lsa rolga qo'shing.
- Audit trigger'ni jadval egasi o'chira oladi — ilova DB foydalanuvchisini egadan ajratish tavsiya etiladi.
- Audit yozuvi har GET'da yoziladi (so'rov = 1 qator), commit `get_db` da.

---

# 21–24-bandlar — 2026-09-29

**Muhim:** bu sandboxda `fastapi/sqlalchemy/pytest/jsdom` yo'q, shuning uchun faqat `compileall` (xatosiz) bajarildi. Yangi testlar (`test_input_false_positives.py`, `test_limits_24.py`, `frontend/tests/xss.spec.js`) **ishga tushirilmagan**; brauzerda CSP tekshiruvi ham qilinmagan.

| Band | O'zgargan fayllar | Tekshiruv |
|---|---|---|
| 21 | `security/input_fortress.py` (`_check_xss` olib tashlandi; `read_body_limited` — stream bilan sanash, 413), `security/threat_detector.py` (kontent patternlari ballga qo'shilmaydi; `_whitelist` xatosi tuzatildi — avval `AttributeError` tufayli detector umuman ishlamagan; TTL 300 s; avto-blok faqat autentifikatsiyasiz IP; 401/403/404 skan), `deps.py` (`request.state.authenticated`), `middleware/request_inspector.py` (`log.warning`; prod'da limiter xatosi → 503) | `tests/test_input_false_positives.py` |
| 22 | `static/js/{reception,lab,doctor,cashier}*.js`, `tibex-notifications.js`, `tibex-settings.js`, `tibex-fortress.js` (44 ta `${…}` → `esc()`, skript bilan), `tibex-password.js` (`+` bilan yig'ilgan HTML), `admin.js`/`bemor.js`/`staff-login.js` (mahalliy `esc` nusxalari → `window.esc`) | `frontend/tests/xss.spec.js` |
| 23 | `cashier…js`, `tibex-fortress.js`, `kassa.html` (`onclick` → `data-action` + delegation); `deploy/nginx.conf` (CSP endi **enforce**) | grep: `on*=` 0 ta |
| 24 | `patients.py` (limit ≤ 200, offset, `q` ≤ 100, LIKE escape), `payments.py`, `audit.py`, `monitoring.py` (limit ≤ 200; `/frontend-errors`: `hit` 30/60 s, body ≤ 16 KB), `camera_security.py` | `tests/test_limits_24.py` |

## Qo'lda tekshirish kerak / qoldiqlar
- **142 ta `innerHTML`** ro'yxati to'liq qo'lda ko'rilmadi: `${…}` (fullname, doctor_name, service.name, detail, message, note, allergies, chronic va h.k. nomlari bo'yicha) va `tibex-password.js` tuzatildi; boshqa nomdagi maydonlar bo'lsa `frontend/tests/xss.spec.js` (source testi) faqat shu nomlarni ushlaydi.
- **CSP enforce:** har rol sahifasini (login, qabulxona, shifokor, kassa, labaratoriya, admin, bemor) Chrome+Firefox'da ochib konsolni tekshiring. `nginx -t` ishga tushirilmagan.
- `patients.py`/`audit.py` ro'yxatlari `limit` bilan cheklangan; `.all()` → `yield_per` almashtirilmadi (200–500 qator).
- Frontend `limit=` bilan 200 dan katta so'rov yuborsa endi 422 oladi — `static/` da shunday chaqiruvlar bor-yo'qligini tekshiring.
- Klinika NAT IP'sini `TIBEX_THREAT_WHITELIST` ga qo'shing.

---

# 25–29-bandlar — 2026-09-29

**Muhim:** sandboxda `fastapi/sqlalchemy/pytest` yo'q — faqat `compileall` (xatosiz). `pytest`, Alembic `upgrade/downgrade`, `pyflakes` **ishga tushirilmagan** — serverda/CI'da tasdiqlang.

| Band | O'zgargan fayllar | Tekshiruv |
|---|---|---|
| 25 | `models.py` (`Patient.deleted_at/deleted_by`), `db.py` (global `do_orm_execute` filtr: barcha SELECT'da `deleted_at IS NULL`, `include_deleted=True` bilan chetlab o'tiladi), `routers/patients.py` (soft delete, `IntegrityError` → 409), migratsiya `20260929_120000_int…integrity.py` | `tests/test_items_25_29.py` |
| 26 | `routers/payments.py` (`Idempotency-Key` sarlavhasi; qabul qulfidan keyin tekshiruv, boshqa summa → 409), `models.py` (`idempotency_key` UNIQUE, `CHECK amount>0` Payment/Refund, `uq_shifts_one_open` qisman UNIQUE), shu migratsiya | model testi; migratsiya **ishga tushirilmagan** |
| 27 | `scripts/cleanup.py` (`--dry-run`), `deploy/tibex-cleanup.service/.timer` (audit'ga tegmaydi) | qo'lda |
| 28 | `security/ssrf.py` (`is_global`, `asyncio.to_thread`, docstring: DNS rebinding), `routers/integrations.py` (`await`) | `test_items_25_29.py` |
| 29 | `observability.py` (JSON log, `request_id`, Sentry ixtiyoriy, `/metrics` token bilan), `config.py`, `main.py`, `scripts/uptime_check.sh`, `deploy/tibex-logrotate`, `docs/OPERATIONS.md`, `.env.example`; `error_tracker` allaqachon `client_ip` ishlatadi | JSON log testi |

## Eslatmalar
- CHECK constraint'lar `NOT VALID` (eski noto'g'ri qatorlar bo'lsa migratsiya yiqilmasin); tozalagach `VALIDATE CONSTRAINT`.
- Migratsiya bir nechta ochiq smena bo'lsa, eng yangisidan boshqasini yopadi.
- Frontend `Idempotency-Key` yubormasa, eski xatti-harakat saqlanadi (kalit ixtiyoriy). Kassa UI'da har to'lov formasi uchun `crypto.randomUUID()` yuborish tavsiya etiladi.
- `/metrics` uchun `TIBEX_METRICS_TOKEN` o'rnating, aks holda 404.
- Sentry uchun `sentry-sdk` alohida o'rnatiladi (`requirements.lock` ga qo'shilmagan).

---

# 30–33-bandlar — 2026-09-29

**Muhim:** sandboxda `fastapi/sqlalchemy/pytest` yo'q — faqat `compileall`. Barcha yangi testlar, CI va `eslint` **ishga tushirilmagan**. (Promptda 34-band yo'q; oxirgisi 33.)

| Band | O'zgargan fayllar | Tekshiruv |
|---|---|---|
| 30 | yangi: `tests/test_audit_chain.py` (zanjir, buzilish, o'chirilgan qator), `test_health.py`, `test_rbac_matrix.py`, `test_key_separation.py` (mavjud: payments, auth_flow, crypto_rotation, input_false_positives, ws, xss.spec.js) | **ishga tushirilmagan** |
| 31 | `.github/workflows/ci.yml` (ruff, pyflakes, bandit, pip-audit, pytest --cov, Alembic up/down/up/check, eslint, detect-secrets), `.pre-commit-config.yaml`, `frontend/.eslintrc.json` | — |
| 32 | `security/keys.py` (HKDF-SHA256), `sessions.py`, `csrf.py`, `otp.py`, `session_binding.py`, `routers/camera_security.py`; `docs/ROTATION.md` | `test_key_separation.py` |
| 33 | `docs/SECURITY.md` (saqlash muddatlari, kalit ajratish, CI), `docs/ROTATION.md`, `backend/README.md`, `frontend/docs/README.md` (CSP, `esc()`), `deploy/DEPLOY-VARIANT-B.md` (Go-Live checklist) | — |

## Qoldiqlar
- `test_rbac_matrix.py` — statik marshrut auditi (himoyasiz / CSRF'siz marshrutlar). `PUBLIC` ro'yxati taxminiy: birinchi CI yurishida haqiqiy ochiq endpointlarga moslang. To'liq rol×endpoint HTTP matritsasi test DB talab qiladi (yozilmagan).
- **32-band:** deploy'da barcha sessiyalar bekor bo'ladi (ROTATION.md).
- `.secrets.baseline` yaratilmagan: `detect-secrets scan > .secrets.baseline` ni bir marta ishga tushiring.
- CI'da `pip-audit -r requirements.lock` mavjud lock faylga tayanadi.

---

# Integratsiya va sinxronlik tekshiruvi — 2026-09-29

**Muhim:** sandboxda `fastapi/sqlalchemy/pytest/pyflakes/jsdom` yo'q (tarmoq yo'q). Bajarilgani: AST asosida import/undefined-name tekshiruvi (0 muammo), `node --check` (barcha JS), `bash -n`, YAML parse, `esc()` ni Node'da ishga tushirish, yangi `test_integration_consistency.py` (9 ta test, qo'lda ishga tushirildi, hammasi yashil). `pytest` to'liq to'plami, Alembic, `docker build`, `nginx -t` **hamon ishga tushirilmagan**.

| Topilma | Tuzatish | Fayllar |
|---|---|---|
| `.env.example` da `TIBEX_DEBUG_AUTH` (Settings maydoni `debug_auth_logging`) — o'zgaruvchi jimgina e'tiborsiz qolardi | `TIBEX_DEBUG_AUTH_LOGGING`; README/log matnlari ham tuzatildi | `.env.example`, `README.md`, `app/main.py`, `app/deps.py` |
| `.env.example` da yo'q sozlamalar | `THREAT_WHITELIST`, `BOOTSTRAP_*_DAYS`, `TELEGRAM_BOT_USERNAME`, ESKIZ izohi | `.env.example` |
| Redis `redis:7-alpine` imidjida `gosu` yo'q (`su-exec` bor) — Redis ishga tushmasdi | `su-exec redis` | `docker-compose.yml` |
| Admin UI "Auditni tozalash" 410 oladigan endpointni chaqirardi | Tugmalar/modal/`store.clearAudit` olib tashlandi, izoh qo'shildi | `static/js/admin.js`, `static/tibex-client.js` |
| Kassa `Idempotency-Key` yubormasdi (26-band faqat server tomonda edi) | Har to'lovga avtomatik `crypto.randomUUID()` | `static/tibex-client.js`, `frontend/docs/README.md` |
| Escape'siz interpolyatsiyalar: `s.name`, `a.user`, `d.name`, `p.phone`, `e.last/next_service`, `a.title`, `u.login`, `u.fullname` va h.k. | `esc()` qo'shildi; `xss.spec.js` manba testi kengaytirildi | `cashier/reception/lab *.js`, `tibex-notifications/settings/fortress/password/barcode-camera.js`, `tests/xss.spec.js` |

**Sinxronlik natijalari (muammo topilmadi):** model ↔ Alembic (20 jadval, 14 `*_enc` ustun, zanjir chiziqli, 11 revizya, hammasida `downgrade`); frontend `/api/...` chaqiruvlari ↔ 112 backend marshrut; HTML ↔ static fayllar (har sahifada `tibex-safe.js` birinchi, inline skript/`on*=`/`<style>` yo'q); compose secrets ↔ entrypoint ↔ `setup.py`; rol o'zgarganda sessiya bekor qilinib WS'ga `session.revoked` yuboriladi (avvalgi "tekshirilmadi" eslatmasi yopildi).

## Hali yopilmagan
- `pytest` (yangi va eski testlar), `pyflakes`, `bandit`, `pip-audit`, Alembic up/down/up, `docker compose up`, `nginx -t`, Chrome+Firefox'da CSP konsoli — CI/serverda.
- `(user, ip)` bo'yicha `failed_attempts` qulfi: admin `unlock` endpointi (`POST /api/users/{id}/unlock`) bilan yopilgan deb qabul qilindi, juftlikka bog'lanmagan.
- `Patient.fullname` (17-band A/B) — sizning qaroringiz; eski ochiq PHI ustunlari 2-bosqichli migratsiyada keyingi releasda o'chiriladi.
- Frontendda yetim (hech bir HTML/JS yuklamaydigan) fayllar: `tibex-barcode-camera.js`, `tibex-camera-secure.js`, `tibex-fortress.js`, `tibex-realtime.js`, `tibex-ultimate-scanner.js`, `js/admin-mobile-sidebar.js`, `js/admin-shortcuts.js`, `css/tibex-modern-theme.css` — o'chirish yoki ulash qarori sizniki (docs/README ularni ro'yxatlaydi).
- Admin "Demo reset" qatori production'da ham ko'rinadi (endpoint 404 qaytaradi); UI'da yashirish ixtiyoriy.
- `tibex-console-theme.js`/`tibex-realtime-pro.js` banner matni `innerHTML` ga statik matn bilan tushadi (foydalanuvchi ma'lumoti emas).

