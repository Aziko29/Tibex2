@echo off
REM TIBEX frontend statik serverini ishga tushiruvchi skript.
REM
REM JOYLASHUV: bu fayl "start" papkasida turadi, "frontend" papkasi esa
REM shu bilan yonma-yon (bir xil ota-papka ichida):
REM
REM   <loyiha>\
REM     backend\
REM     frontend\
REM     start\              <- bu fayl shu yerda
REM
REM Eslatma: agar backend TIBEX_SERVE_FRONTEND=true bilan ishga tushirilgan
REM bo'lsa, frontend allaqachon http://localhost:8000 orqali ochiladi va
REM bu skript SHART EMAS. Faqat frontendni alohida, 5500-portda ishga
REM tushirish kerak bo'lsagina ishlating.

cd /d "%~dp0"
cd ..\frontend

echo ============================================
echo   TIBEX Frontend server ishga tushirilmoqda
echo   Papka: %cd%
echo   Manzil: http://127.0.0.1:5500
echo   To'xtatish uchun: shu oynani yoping yoki Ctrl+C
echo ============================================
echo.

REM Papka to'g'ri ekanini tekshirish (frontendda odatda login.html bo'ladi)
if not exist "login.html" (
    echo [OGOHLANTIRISH] "login.html" shu papkada topilmadi: %cd%
    echo                 "start" papkasi "frontend" bilan yonma-yon turishi kerak.
    echo                 Baribir davom etilmoqda...
    echo.
)

REM Python borligini tekshirish
where python >nul 2>nul
if errorlevel 1 (
    echo [XATO] Python topilmadi. Avval Python o'rnating: https://www.python.org/downloads/
    pause
    exit /b 1
)

python -m http.server 5500

echo.
echo Server to'xtadi.
pause
