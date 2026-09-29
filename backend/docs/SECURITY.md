# Xavfsizlik (qisqa)

## Tahdid modeli
Klinika PHI'si: bemor ma'lumotlari, tashxis, retsept, lab natijalari. Asosiy xavflar: sirlar sizishi, XSS, IDOR, ichki shaxs tomonidan suiiste'mol, DB/zaxira o'g'irlanishi.

## PHI shifrlash (17-band)
AES-GCM (context-bound, kalit halqasi). Shifrlangan: `patients.{phone, address, allergies, chronic}`, `appointments.{service, complaint, vitals, prelim_dx, final_dx, prescriptions, draft, lab_orders}`, `lab_orders.{result_data, result_summary, result_note}`, integratsiya `api_key`.
Migratsiya ikki bosqichli: `phi20260929_1000` yangi `*_enc` ustunlarni to'ldiradi, **eski ochiq ustunlar saqlanadi (nullable)**. Barqaror ishlashi tasdiqlangach keyingi releasda ularni o'chiring (alohida migratsiya) va zaxiralarni ham yangilang — aks holda eski ochiq matn zaxiralarda qoladi.

### QAROR: `Patient.fullname`
Hozircha **(A) ochiq qoldirilgan** (qidiruv `ilike` ishlashi uchun): himoya = disk/Postgres darajasida shifrlash + RBAC + audit. (B) blind-index (token/prefiks) — foydalanuvchi qaroriga qadar amalga oshirilmagan.

## Audit siyosati
Append-only (DB trigger + `REVOKE`), hash-zanjir (`/api/audit/verify`, `scripts/verify_audit.py`). PHI o'qish `view` sifatida yoziladi (faqat ID/son). Saqlash: `audit_logs` kamida 2 yil, eksport arxivi 5 yil (`scripts/audit_archive.py`). Ilova DB foydalanuvchisi jadval egasi bo'lmasligi tavsiya etiladi (trigger'ni egasi o'chira oladi).

## Shaxsga doir ma'lumotlar qonuni — tekshiruv ro'yxati (yurist uchun)
- [ ] Server O'zbekiston hududida joylashganmi (ma'lumotlarni mahalliylashtirish talabi)
- [ ] Operator sifatida ro'yxatdan o'tish / ma'lumotlar bazasi reyestri talabi
- [ ] Bemordan rozilik olish va uni saqlash tartibi
- [ ] Saqlash muddatlari va o'chirish/anonimlashtirish tartibi
- [ ] Zaxira nusxalar (offsite) joylashuvi qonunga mosligi
- [ ] Ma'lumot sizib chiqqanda xabar berish tartibi (`docs/OPERATIONS.md`)
- [ ] Uchinchi tomonga uzatish (SMS/Telegram) huquqiy asosi

## Saqlash muddatlari
| Ma'lumot | Muddat | Vosita |
|---|---|---|
| `sessions` | tugagach/bekor qilingach 7 kun | `scripts/cleanup.py` (kunlik) |
| `login_attempts` | 30 kun | `scripts/cleanup.py` |
| `otp_codes` | 1 kun | `scripts/cleanup.py` |
| `audit_logs` | kamida 2 yil, arxiv 5 yil | `scripts/audit_archive.py` (qo'lda, superuser) |
| Bemorlar | yumshoq o'chirish (`deleted_at`), tarix va to'lovlar saqlanadi | 25-band |

## Kalitlarni ajratish
`SECRET_KEY` → HKDF-SHA256 → `session|csrf|otp|fingerprint|camera` (32-band). Shifrlash (`MASTER`) va blind-index kalitlari alohida.

## CI / sifat
`.github/workflows/ci.yml`: ruff, pyflakes, bandit, pip-audit, pytest+cov, Alembic up/down/check, eslint (`no-unsanitized`), detect-secrets. `pre-commit`: `pip install pre-commit && pre-commit install`.
