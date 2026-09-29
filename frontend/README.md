# TIBEX Frontend — alohida ilova

Bu papka endi backend jarayonidan **mustaqil** serve qilinadi. Backend faqat
`/api/*` endpointlarni beradi (`TIBEX_SERVE_FRONTEND=false`, default).

## Lokal ishlab chiqish

Har qanday oddiy static server ishlaydi, masalan:

```bash
cd frontend
python -m http.server 5500
```

yoki Node bilan:

```bash
npx serve -l 5500
```

Backend `.env` faylida:

```
TIBEX_ALLOWED_ORIGINS=["http://localhost:5500"]
TIBEX_COOKIE_SAMESITE=lax
```

## Production

Frontendni Nginx (yoki boshqa static host) orqali serve qiling.

**Tavsiya etilgan topologiya (xavfsiz va sodda):** frontend va backend bir xil
registrable domenning subdomenlari bo'lsin, masalan:

- Frontend: `https://admin.tibex.uz`
- Backend:  `https://api.tibex.uz`

Bu holda `.env`:

```
TIBEX_ALLOWED_ORIGINS=["https://admin.tibex.uz"]
TIBEX_COOKIE_DOMAIN=.tibex.uz
TIBEX_COOKIE_SAMESITE=lax
TIBEX_COOKIE_SECURE=true
```

`SameSite=Lax` shu topologiyada YETARLI, chunki subdomenlar bir xil "site"
hisoblanadi — cookie fetch/XHR so'rovlarida ham to'g'ri yuboriladi, va bu
`none`ga qaraganda kuchliroq CSRF himoyasini saqlab qoladi.

Agar frontend **butunlay boshqa** (boshqa registrable) domenda joylashishi
kerak bo'lsa (masalan uchinchi tomon hosting), unda:

```
TIBEX_COOKIE_SAMESITE=none
TIBEX_COOKIE_SECURE=true   # majburiy, aks holda brauzer cookie'ni rad etadi
```

Bu holatda CSRF himoyasi butunlay `X-CSRF-Token` mexanizmiga (pastga qarang)
tayanadi — u allaqachon backendda mavjud.

## Nginx namunasi (frontend uchun)

```nginx
server {
    listen 443 ssl;
    server_name admin.tibex.uz;

    root /var/www/tibex-frontend;
    index admin.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

## API bilan ishlash (fetch)

Har bir so'rovda cookie yuborilishi uchun `credentials: 'include'` shart.
Login javobida qaytgan `csrf_token`ni saqlab, mutatsiya so'rovlarida
`X-CSRF-Token` header sifatida yuborish kerak:

```js
const res = await fetch(`${API_BASE}/api/auth/login`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const { csrf_token } = await res.json();
sessionStorage.setItem("csrf_token", csrf_token); // localStorage EMAS — XSS xavfi

// Keyingi mutatsiya so'rovlarida:
await fetch(`${API_BASE}/api/patients`, {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": sessionStorage.getItem("csrf_token"),
  },
  body: JSON.stringify(payload),
});
```

`API_BASE` — backendning to'liq originini bildiruvchi doimiy (masalan
`https://api.tibex.uz`), barcha sahifalarda bitta joyda (masalan
`frontend/scripts/config.js`) e'lon qilinishi kerak.
