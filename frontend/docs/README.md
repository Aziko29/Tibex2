# TIBEX - Frontend

## Sahifalar
- `login.html` - Kirish (xodim + bemor OTP)
- `admin.html` - Admin konsoli
- `qabulxona.html` - Qabulxona
- `shifokor.html` - Shifokor
- `labaratoriya.html` - Laboratoriya
- `kassa.html` - Kassa

## Xavfsizlik modullari (`static/`)
1. `tibex-safe.js` - XSS escape - **birinchi yuklanadi**
2. `tibex-client.js` - API + WebSocket
3. `tibex-session.js` - Auto-lock (15 daqiqa)
4. `tibex-password.js` - Parol boshqaruvi
5. `tibex-settings.js` - Sozlamalar
6. `tibex-notifications.js` - Bildirishnomalar

## CSP va `esc()` qoidasi
- Nginx **enforcing** CSP yuboradi: inline `<script>` va `on*=` handlerlar **taqiqlangan** — `addEventListener` / `data-action` delegation ishlating. Inline `style=""` faqat `style-src-attr` orqali ruxsat.
- Foydalanuvchi manbali har qanday qiymat (`fullname`, `doctor_name`, `service.name`, `complaint`, `address`, `detail`, `message`, `note`, `allergies[]`, `chronic[]`) `innerHTML` ga tushishidan oldin `esc()` (matn) yoki `escAttr()` (atribut) dan o'tadi, yoki `textContent` ishlatiladi. Yordamchilar `static/tibex-safe.js` da, u HTML'da birinchi yuklanadi.
- Tekshiruv: `frontend/tests/xss.spec.js`, CI'da `eslint` (`no-unsanitized`).
- Kassa: `tibex-client.js` har `POST /api/payments` so'roviga avtomatik `Idempotency-Key` (`crypto.randomUUID()`) qo'shadi; server takroriy kalitni bitta to'lov sifatida qaytaradi.
- Audit jurnali o'zgarmas: admin paneldagi "Tozalash" olib tashlangan (`/api/audit/clear` → 410); arxivlash serverda `scripts/audit_archive.py` orqali.
