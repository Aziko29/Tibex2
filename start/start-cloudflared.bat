@echo off
REM TIBEX - mavjud Cloudflare Tunnel'ni topib ishga tushiruvchi skript.
REM
REM Bu skript loyiha tuzilishiga bog'liq emas (cloudflared global
REM sozlamalardan - %%USERPROFILE%%\.cloudflared\ dan - foydalanadi),
REM shuning uchun "start" papkasida turishi kifoya.

cd /d "%~dp0"

echo ============================================
echo   Cloudflare Tunnel qidirilmoqda...
echo ============================================
echo.

REM 1) cloudflared.exe'ni topish: avval PATH'dan, topilmasa aniq
REM    ma'lum manzildan (C:\cloudflared\cloudflared.exe).
set CLOUDFLARED=cloudflared
where cloudflared >nul 2>nul
if errorlevel 1 (
    if exist "C:\cloudflared\cloudflared.exe" (
        set CLOUDFLARED=C:\cloudflared\cloudflared.exe
    ) else (
        echo [XATO] cloudflared.exe topilmadi ^(na PATH'da, na C:\cloudflared\da^).
        pause
        exit /b 1
    )
)

echo [+] cloudflared topildi: %CLOUDFLARED%
echo.

REM 2) Windows xizmati (service) sifatida o'rnatilganini tekshirish
REM    (odatda "cloudflared service install" bilan avval o'rnatilgan bo'ladi)
sc query cloudflared >nul 2>nul
if not errorlevel 1 (
    echo [+] "cloudflared" Windows xizmati sifatida topildi.
    echo [+] Xizmat holati tekshirilmoqda...
    sc query cloudflared | find "RUNNING" >nul 2>nul
    if not errorlevel 1 (
        echo [OK] Xizmat allaqachon ishlab turibdi. Hech narsa qilish shart emas.
    ) else (
        echo [+] Xizmat ishga tushirilmoqda...
        net start cloudflared
    )
    echo.
    goto :end
)

echo [i] Windows xizmati sifatida o'rnatilmagan ekan.
echo [+] Mavjud tunnellar ro'yxati:
echo.
"%CLOUDFLARED%" tunnel list
echo.

REM 3) Standart config.yml orqali ishga tushirishga urinish
REM    (Explorer'da fayl "config" deb ko'rinsa ham, haqiqiy nomi
REM    odatda config.yml - Windows kengaytmani yashirib turadi)
set CFG=%USERPROFILE%\.cloudflared\config.yml
if not exist "%CFG%" set CFG=%USERPROFILE%\.cloudflared\config
if exist "%CFG%" (
    echo [+] Config topildi: %CFG%
    echo [+] Tunnel ishga tushirilmoqda ^(shu oyna ochiq turishi kerak^)...
    echo.
    "%CLOUDFLARED%" tunnel run
) else (
    echo [XATO] %USERPROFILE%\.cloudflared\config.yml topilmadi.
    echo        Yuqoridagi ro'yxatdan tunnel nomini oling va qo'lda ishga tushiring:
    echo            "%CLOUDFLARED%" tunnel run ^<TUNNEL-NOMI^>
)

:end
echo.
pause
