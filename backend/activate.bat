@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
echo.
echo   Venv aktiv. Endi: python, pip, alembic, uvicorn ishlaydi.
echo.
cmd /k