# TIBEX Desktop (brauzersiz dastur)

Mavjud `frontend/` ni oddiy dastur oynasida ochadi: manzil satri ham, tablar ham yo'q.
Backend'ni o'zgartirish shart emas (`TIBEX_SERVE_FRONTEND=false` qolaveradi).

## Qanday ishlaydi
Dastur ichida kichik mahalliy shlyuz (`gateway.py`) ishga tushadi. U frontend fayllarini beradi va
`/api/*` hamda WebSocket so'rovlarini klinika serveriga uzatadi. Brauzer uchun hammasi bitta manzil
bo'lgani uchun cookie, CSRF va CORS bilan muammo chiqmaydi.

## Joylashuv
Bu papkani loyiha ildiziga `desktop/` nomi bilan qo'ying (`frontend/` bilan yonma-yon):

    TIBEX/
      backend/  frontend/  desktop/

## Ishga tushirish (dasturchi uchun)
    cd desktop
    pip install -r requirements.txt
    python main.py            # oddiy oyna
    python main.py --kiosk    # to'liq ekran (qabulxona uchun)
    python main.py --debug    # F12 dasturchi asboblari

## Server manzili
Birinchi ishga tushishda server ochilmasa, "Server bilan aloqa yo'q" oynasi chiqadi va manzilni o'sha yerda
kiritasiz (masalan `http://192.168.1.10:8000`). Manzil `%APPDATA%\TIBEX\config.json` ga saqlanadi.
Boshqa yo'l: `TIBEX_SERVER_URL` o'zgaruvchisi. Internet orqali ulansangiz, faqat `https://` manzil ishlating.

## .exe va o'rnatuvchi
1. `build.bat`: `dist\TIBEX\TIBEX.exe` yaratadi (frontend ichiga joylanadi).
2. `installer.iss`: Inno Setup'da oching, `TIBEX-Setup.exe` chiqadi (ish stoli yorlig'i va "to'liq ekran" yorlig'i bilan).

## Tugmalar
F11: to'liq ekranga o'tish/chiqish. Ctrl + sichqoncha g'ildiragi: masshtab.

## Xavfsizlik
- Dastur yopilganda sessiya ham yopiladi (`private_mode`). Har safar qayta kirish kerak.
- Bitta kompyuterda dasturni ikki marta ochib bo'lmaydi.
- Yangi oyna/tab ochilmaydi: barcha havolalar shu oynada ochiladi.
- Mahalliy shlyuz faqat `127.0.0.1` da tinglaydi (tarmoqdan ko'rinmaydi).

## Talablar
Windows 10/11 va Microsoft WebView2 Runtime (Windows 11 va yangi Windows 10 da tayyor bo'ladi).

## Sinov
    pytest tests
