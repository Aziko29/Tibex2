# TIBEX — ishga tushirish qo'llanmasi

## Papka tuzilishi

Bu 3 ta fayl **"start"** papkasida turadi, u esa `backend` va `frontend`
bilan yonma-yon (bir xil ota-papka ichida) bo'lishi kerak:

```
<loyiha>\
  backend\
  frontend\
  start\              <- shu papkada: 3 ta .bat + shu qo'llanma
```

Loyihaning nomi yoki qayerda joylashgani (masalan `D:\Desktop\BIT 2`)
muhim emas — skriptlar avtomatik yonidagi `backend`/`frontend`
papkalarini topadi.

---

## 1) start-backend.bat

**Nima qiladi:** Backend va bazani (Docker orqali) ishga tushiradi.

**Qanday ishlatish:** Ustiga 2 marta bosing.

**Tekshirish:** Oynada shunga o'xshash yozuv chiqsa — ishladi:
```
Uvicorn running on http://0.0.0.0:8000
```

⚠️ Bu oynani **yopmang** — yopsangiz, backend ham to'xtaydi.

⚠️ Ishga tushirishdan oldin **Docker Desktop** ochiq va to'liq
yuklangan bo'lishi kerak.

---

## 2) start-cloudflared.bat

**Nima qiladi:** Cloudflare Tunnel'ni topib, ishga tushiradi (tashqi
domendan kirish uchun).

**Qanday ishlatish:** `start-backend.bat` ishga tushib bo'lgach, ustiga
2 marta bosing.

**Tekshirish:** Oynada xatolik chiqmasa va "Connected" kabi yozuv
ko'rinsa — ishladi.

⚠️ Bu oynani ham **yopmang** — yopsangiz, tashqi domen orqali kirish
to'xtaydi.

---

## 3) start-frontend.bat

**Eslatma:** Ehtimol bu **kerak emas**. Chunki hozirgi sozlamada
frontend backend bilan birga, **8000-portda** avtomatik ochiladi
(`http://localhost:8000/login.html`).

Faqat agar frontendni **alohida, 5500-portda** ishga tushirish kerak
bo'lsa foydalaning.

---

## Umumiy tartib (har safar shunday)

1. Docker Desktop'ni oching, to'liq yuklanishini kuting.
2. `start-backend.bat` — 2 marta bosing, oyna ochiq qoldiring.
3. `start-cloudflared.bat` — 2 marta bosing, oyna ochiq qoldiring.
4. Brauzerda tekshiring:
   - Lokal: `http://localhost:8000/login.html`
   - Tashqi (domen orqali): sizning domeningiz

## To'xtatish

Ikkala oynada ham shunchaki **Ctrl+C** bosing, yoki oynalarni yoping.

## Muammo bo'lsa

- **"docker-compose.yml topilmadi"** — `start` papkasi `backend` bilan
  yonma-yon turganiga ishonch hosil qiling (yuqoridagi tuzilishga
  qarang).
- **"Docker ishlamayapti"** — Docker Desktop ochiqligini tekshiring.
- **"cloudflared topilmadi"** — cloudflared o'rnatilganini tekshiring.
- **Sayt ochilmayapti** — avval `start-backend.bat` oynasida xatolik
  yo'qligini tekshiring, keyin `start-cloudflared.bat`ni qayta oching.

---

## 4) start-public.bat  (internetga chiqadigan bemor sayti)

**Nima qiladi:** `frontend/public/` papkani yig'adi (faqat index, bemor-login, bemor va kerakli CSS/JS)
va 5600-portda serve qiladi. Xodim sahifalari bu yerda yo'q, papka ro'yxati ham yo'q.

**Cloudflare Tunnel** faqat 5600 (sayt) va 8000 (faqat /api/portal, /api/otp, /api/telegram/webhook,
/api/health) portlariga qarashi kerak: `backend/deploy/cloudflared-config.yml`.
`start-frontend.bat` (5500) esa faqat ichki tarmoq (xodimlar) uchun, tunnelga ulanmaydi.
Batafsil: `backend/deploy/PUBLIC_SITE.md`.


---

## 4) start-public.bat  (internetga chiqadigan bemor sayti)

**Nima qiladi:** `frontend/public/` papkani yig'adi (faqat bemor sahifalari) va 127.0.0.1:5600 da xavfsiz serve qiladi.
Cloudflare Tunnel shu portga (va API uchun 8000-portga) qaraydi — qarang: `PUBLIC_DEPLOY.md`
va `backend/deploy/cloudflared-config.yml`.

**Muhim:** `start-frontend.bat` (5500) faqat xodimlar uchun, LAN ichida. Tunnelga ULANMASIN.
