@echo off
REM TIBEX backend'ni (Redis + Backend) Docker Compose orqali ishga tushiruvchi skript.
REM
REM JOYLASHUV: bu fayl "start" papkasida turadi, "backend" papkasi shu bilan yonma-yon:
REM
REM   <loyiha>\
REM     backend\
REM     frontend\
REM     start\              <- bu fayl shu yerda
REM
REM Ishga tushgach (frontend ham shu orqali): http://localhost:8000
REM Eslatma: PostgreSQL Docker'da emas, shu kompyuterning o'zida (Windows) ishlaydi.
REM          Konteyner unga host.docker.internal:5432 orqali ulanadi.

cd /d "%~dp0"
cd ..\backend

echo ============================================
echo   TIBEX Backend ishga tushirilmoqda
echo   Papka: %cd%
echo ============================================
echo.

REM 1) Docker Desktop ishlayaptimi?
docker info >nul 2>nul
if errorlevel 1 (
    echo [XATO] Docker ishlamayapti. Docker Desktop'ni oching, to'liq yuklanishini
    echo        kuting va bu faylni qayta ishga tushiring.
    pause
    exit /b 1
)
echo [+] Docker ishlab turibdi.

REM 2) Kerakli fayllar
if not exist "docker-compose.yml" (
    echo [XATO] docker-compose.yml topilmadi: %cd%
    echo        "start" papkasi "backend" bilan yonma-yon turishi kerak.
    pause
    exit /b 1
)
if not exist ".env.public" (
    echo [XATO] .env.public topilmadi. .env.example'dan nusxa oling.
    pause
    exit /b 1
)
for %%F in (database_url.txt redis_url.txt redis.conf secret_key.txt master_key_b64.txt master_keys.json blind_index_key_b64.txt password_pepper.txt telegram_bot_token.txt telegram_webhook_secret.txt) do (
    if not exist "secrets\%%F" (
        echo [XATO] secrets\%%F topilmadi.
        pause
        exit /b 1
    )
)
echo [+] Sozlama va secret fayllari joyida.

REM 3) 8000-port band emasmi? (lokal uvicorn ochiq qolgan bo'lishi mumkin)
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [OGOHLANTIRISH] 8000-port allaqachon band. Boshqa backend ^(uvicorn^) ochiq bo'lsa, uni yoping.
    echo                 Agar bu oldingi docker backend bo'lsa, davom etishingiz mumkin.
    echo.
)

REM 4) PostgreSQL (Windows) ishlayaptimi?
powershell -NoProfile -Command "if ((Test-NetConnection localhost -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo [XATO] PostgreSQL 5432-portda javob bermayapti.
    echo        services.msc ^> "postgresql" xizmatini ishga tushiring.
    pause
    exit /b 1
)
echo [+] PostgreSQL ishlab turibdi.
echo.

REM 5) Ishga tushirish
docker compose version >nul 2>nul
if not errorlevel 1 (
    echo [+] docker compose up --build   ^(to'xtatish: Ctrl+C^)
    echo.
    docker compose up --build
) else (
    echo [+] docker-compose up --build   ^(to'xtatish: Ctrl+C^)
    echo.
    docker-compose up --build
)

echo.
echo Backend to'xtadi.
pause
