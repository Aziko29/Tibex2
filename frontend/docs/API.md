# TIBEX API

## Base URL
`/api/*` — barcha endpointlar (autentifikatsiya talab qilinadi,
`/api/health` va `/api/auth/login` dan tashqari)

## Autentifikatsiya
- **Xodimlar:** `POST /api/auth/login` -> `__Host-cf_session` cookie + CSRF token
- **Bemorlar:** Telegram botdagi `/start` orqali o'z kontaktini tasdiqlaydi;
  so'ng `POST /api/otp/request` + `POST /api/otp/verify`. Admin paneli
  `/api/otp/admin-issue` orqali bir martalik kod chiqarishi mumkin.

## CSRF
Har bir `POST/PATCH/PUT/DELETE` sorovda `X-CSRF-Token` header bolishi shart.

## Asosiy endpointlar
| Method | Path | Tavsif |
|--------|------|--------|
| GET    | `/api/health` | Health check |
| POST   | `/api/auth/login` | Xodim login |
| POST   | `/api/otp/request` | Bemor login kodini faqat Telegramga yuborish |
| POST   | `/api/otp/verify` | Telegram/admin kodini tekshirish |
| POST   | `/api/otp/admin-issue` | Admin uchun bemorga bir martalik kod chiqarish |
| POST   | `/api/telegram/webhook` | Bot kontaktini qabul qilish va ulash |
| GET    | `/api/telegram/bot-info` | Ommaviy bot nomi (token qaytarmaydi) |

### Bemor kabineti (`/api/portal/*`, bemor sessiyasi kerak)

| Metod | Yo'l | Vazifa |
|--------|------|--------|
| GET    | `/api/portal/csrf` | Sessiyaga bog'langan CSRF token |
| POST   | `/api/portal/logout` | Sessiyani yopish |
| GET    | `/api/portal/me` | Profil + `telegram_linked`, `telegram_available` |
| PATCH  | `/api/portal/me` | Telefon / manzilni o'zgartirish (telefon o'zgarsa login ham o'zgaradi) |
| GET    | `/api/portal/summary` | Dashboard statistikasi |
| GET    | `/api/portal/appointments` | Bemorning qabullari |
| GET    | `/api/portal/lab-orders` | Laboratoriya natijalari |
| GET    | `/api/portal/payments` | To'lovlar tarixi |
| GET    | `/api/portal/telegram/status` | Telegram ulanganligi (ulanishni kutish uchun) |
| POST   | `/api/portal/telegram/link-token` | Botga bir martalik `/start` havolasi |
| POST   | `/api/portal/telegram/unlink` | Telegram ulanishini uzish |

Bemor paroli bilan kirmaydi, shuning uchun `/api/portal/change-password` va 
`/api/portal/permissions` endpointlari olib tashlangan.
| POST   | `/api/auth/logout` | Chiqish |
| GET    | `/api/bootstrap` | Frontend snapshot |
| GET/POST/PATCH/DELETE | `/api/patients` | Bemorlar |
| GET/POST/PATCH/DELETE | `/api/appointments` | Qabullar |
| GET/POST/PATCH | `/api/lab-orders` | Lab |
| GET/POST | `/api/payments` | Tolovlar |
| POST   | `/api/shift/close` | Smena yopish |
| GET/PATCH | `/api/settings` | Sozlamalar |
| GET/POST/PATCH/DELETE | `/api/users` | Xodimlar |
| GET/POST/PATCH/DELETE | `/api/roles` | Rollar |
| GET/POST/PATCH/DELETE | `/api/doctors` | Shifokorlar |
| GET/POST/PATCH/DELETE | `/api/services` | Xizmatlar |
| GET/POST/PATCH/DELETE | `/api/equipment` | Uskunalar |
| GET/POST/PATCH/DELETE | `/api/reagents` | Reagentlar |
| GET/POST/PATCH/DELETE | `/api/integrations` | Integratsiyalar |
| GET/POST | `/api/audit` | Audit |
| POST   | `/api/export/payments.xlsx` | Eksport |
| WS     | `/api/ws` | Real-time |
