@echo off
REM TIBEX - internetga chiqadigan (bemor) sayt. Faqat public/ papkani serve qiladi.
REM Xodim sahifalari (admin, kassa...) bu serverda UMUMAN yo'q.
cd /d "%~dp0"
cd ..\frontend
python tools\build_public.py || (echo [XATO] public/ yig'ilmadi & pause & exit /b 1)
python tools\serve_public.py 5600
pause
