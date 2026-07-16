@echo off
cd /d "%~dp0"
echo Stopping server...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo Clearing cache...
del /q "data\transfer_history.json" 2>nul
del /q "data\cache.json" 2>nul

echo Starting server...
start "" node server/index.js
timeout /t 3 /nobreak >nul
echo.
echo Frontend: http://localhost:3090
echo Admin:    http://localhost:3090/admin.html
echo Password: admin123
echo.
pause
