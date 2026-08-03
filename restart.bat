@echo off
cd /d "%~dp0"
echo [1/3] Stopping server on port 3090 ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3090" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>&1
timeout /t 2 /nobreak >nul
echo [2/3] Starting server ...
start "pansou-server" /min node server/index.js
timeout /t 3 /nobreak >nul
echo [3/3] Server started.
echo.
echo Frontend: http://localhost:3090
echo Admin:    http://localhost:3090/admin.html
echo Password: admin123
echo.
pause
