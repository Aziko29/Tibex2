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

## Asset hash'lash (deploy oldidan majburiy)

`static/js/*.js` va `static/css/*.css` nomlari `<nom>.<8hex>.<ext>` ko'rinishida bo'lishi shart: nginx aynan shu nomlarni
7 kun `immutable` keshlaydi. Hash = `sha256(tarkib, CRLF→LF)` ning birinchi 8 belgisi. Bu fayllardan birini
o'zgartirgan bo'lsangiz:

```bash
node frontend/tools/hash_assets.js          # nomlarni va 8 ta HTML dagi havolalarni yangilaydi
node frontend/tools/hash_assets.js --check  # faqat tekshiradi (CI ham shuni yuritadi)
git add -A frontend
```

Nomi hash'siz yoki hash'i tarkibga mos bo'lmagan fayl bilan `tests/asset-hash.spec.js` (va CI) yiqiladi. Aks holda foydalanuvchi
brauzeri eski faylni 7 kun ushlab turishi mumkin. `static/` ildizidagi `tibex-*.js` fayllar hash'lanmaydi va keshlanmaydi.

## Lokalda prod-CSP bilan sinash

Prod nginx `style-src 'self'` beradi (nonce ham, `'unsafe-inline'` ham yo'q), dev'da esa CSP yo'q, shuning uchun JS da
yaratilgan `<style>` lokalda ko'rinmay qoladi. Prod bilan bir xil CSP beradigan server:

```bash
node frontend/tools/serve_with_csp.js --port 5500 --api http://127.0.0.1:8000   # CSP matni deploy/nginx.conf dan o'qiladi
```

Konsolda `Refused to apply inline style` / `violates the following Content Security Policy` bo'lmasligi kerak.
Qoida: JS da `createElement("style")` / `<style>` yozmang. CSS ni `static/css/` ga chiqaring, HTML da `<link>` qiling va
`node frontend/tools/hash_assets.js` ni yurgizing (`tests/csp-inline-style.spec.js` shuni tekshiradi).
`style="..."` atributi va `el.style.*` ga nginx `style-src-attr 'unsafe-inline'` ruxsat beradi.

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
