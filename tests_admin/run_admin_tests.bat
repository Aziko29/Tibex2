@echo off
setlocal
REM TIBEX admin testlarini ishga tushiradi (API + brauzer UI).
REM Backend avval ishlab turishi kerak (start-backend.bat).
REM Parol so'raladi va ekranda ko'rinmaydi; hech qayerga saqlanmaydi.

cd /d "%~dp0"

set "TIBEX_URL=http://127.0.0.1:8000"
set "TIBEX_ADMIN_LOGIN=admin"

REM Parolni xavfsiz o'qib, shu oyna uchun muhit o'zgaruvchisiga yozish
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString 'Admin paroli'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "TIBEX_ADMIN_PASSWORD=%%P"

echo.
echo [0/2] Kutubxonalar tekshirilmoqda...
python -m pip install --quiet httpx playwright
python -m playwright install chromium

echo.
echo [1/2] API tekshiruvi
python admin_api_check.py
set API_RC=%errorlevel%

echo.
echo Login limiti tozalanishi uchun 40 soniya kutilmoqda...
timeout /t 40 /nobreak >nul

echo.
echo [2/2] Brauzer (UI) tekshiruvi
python admin_ui_check.py
set UI_RC=%errorlevel%

set "TIBEX_ADMIN_PASSWORD="
echo.
echo ============================================
echo   API: kod %API_RC%   UI: kod %UI_RC%   (0 = hammasi joyida)
echo ============================================
pause
endlocal
