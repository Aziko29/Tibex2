@echo off
REM TIBEX backend'ni (Redis + Backend, Docker Compose orqali) ishga
REM tushiruvchi skript.
REM
REM JOYLASHUV: bu fayl "start" papkasida turadi, "backend" papkasi esa
REM shu bilan yonma-yon (bir xil ota-papka ichida):
REM
REM   <loyiha>\
REM     backend\
REM     frontend\
REM     start\              <- bu fayl shu yerda
REM
REM Loyihaning nomi yoki qayerda joylashgani muhim emas - skript
REM avtomatik yonidagi "backend" papkasini topadi.

REM avval shu skript turgan papkaga, so'ng bir pog'ona yuqoriga, so'ng backend'ga o'tamiz
cd /d "%~dp0"
cd ..\backend

echo ============================================
echo   TIBEX Backend ishga tushirilmoqda
echo   Papka: %cd%
echo ============================================
echo.

REM 1) Docker Desktop ishlab turganini tekshirish
docker info >nul 2>nul
if errorlevel 1 (
    echo [XATO] Docker ishlamayapti. Avval Docker Desktop'ni oching,
    echo        to'liq yuklanishini kuting, so'ng bu faylni qayta ishga tushiring.
    pause
    exit /b 1
)

echo [+] Docker ishlab turibdi.
echo.

REM 2) docker-compose.yml shu papkada borligini tekshirish
if not exist "docker-compose.yml" (
    echo [XATO] docker-compose.yml topilmadi: %cd%
    echo        "start" papkasi "backend" bilan yonma-yon turishi kerak:
    echo          loyiha\backend\
    echo          loyiha\frontend\
    echo          loyiha\start\   ^<- bu skript shu yerda
    pause
    exit /b 1
)

REM 3) Yangi "docker compose" (bo'shliq bilan) buyrug'ini sinab ko'ramiz,
REM    topilmasa eski "docker-compose" (chiziqcha bilan)ga o'tamiz.
docker compose version >nul 2>nul
if not errorlevel 1 (
    echo [+] Ishga tushirilmoqda: docker compose up --build
    echo     (to'xtatish uchun shu oynada Ctrl+C bosing)
    echo.
    docker compose up --build
) else (
    echo [+] Ishga tushirilmoqda: docker-compose up --build
    echo     (to'xtatish uchun shu oynada Ctrl+C bosing)
    echo.
    docker-compose up --build
)

echo.
echo Backend to'xtadi.
pause
