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
