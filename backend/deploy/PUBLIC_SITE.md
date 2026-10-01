# TIBEX: faqat bemor sayti internetda, qolgani yopiq

Arxitektura:

    Internet -> Cloudflare -> tunnel (allowlist) -+-> /api/portal|otp|telegram/webhook|health -> backend :8000
                                                  +-> qolgan hamma yo'l -> serve_public.py :5600 (faqat public/)
    Xodimlar (LAN)  -> http://<server-IP>:5500  (start-frontend.bat, tunnelga ULANMAGAN)

Qadamlar:
1. `frontend/tools/build_public.py`, `serve_public.py`, `start/start-public.bat` ni loyihaga ko'chiring.
2. `frontend/.gitignore` ga `public/` qo'shing.
3. `start-public.bat` ni ishga tushiring (5600-port).
4. `deploy/cloudflared-config.yml` ni to'ldirib `%USERPROFILE%\.cloudflared\config.yml` ga qo'ying.
   Tunnel dashboard (Zero Trust > Networks > Tunnels > Public hostname) orqali yaratilgan bo'lsa,
   shu qoidalarni o'sha yerda kiriting (path maydoni regex qabul qiladi) — tartib muhim.
5. cloudflared ni Windows xizmati qilib qoldiring: `cloudflared service install`
   (kompyuter qayta yonsa ham o'zi ko'tariladi). Tunnelni O'CHIRISH shart emas.
6. `start-frontend.bat` (5500) ni faqat LAN uchun ishlating, tunnel unga qaramasin.
   Windows Firewall'da 5500 va 8000 ni faqat lokal tarmoqqa oching.
7. Tekshiruv (telefonda mobil internetdan): tibex.uz/ , /bemor-login.html -> 200;
   /admin.html, /login.html, /package.json, /api/patients, /api/users -> 404.
