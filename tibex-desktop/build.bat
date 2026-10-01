@echo off
cd /d %~dp0
python -m venv .venv
call .venv\Scripts\activate
pip install -r requirements.txt pyinstaller
pyinstaller --noconfirm --clean --windowed --name TIBEX --icon assets\tibex.ico --add-data "..\frontend;frontend" main.py
echo.
echo Tayyor: dist\TIBEX\TIBEX.exe
