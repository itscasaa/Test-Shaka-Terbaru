@echo off
title Shaka Player Demo Server
echo ===================================================
echo             SHAKA PLAYER LOCAL SERVER
echo ===================================================
echo.
cd /d "%~dp0"
echo Server berjalan di http://localhost:8000
echo Membuka demo di browser...
start http://localhost:8000/player.html
echo - Custom UI Player: http://localhost:8000/player.html
echo - Shaka Official Demo: http://localhost:8000/demo/
echo Tekan Ctrl+C untuk menghentikan server.
echo.
python -m http.server 8000
pause
