@echo off
title Censor Application Launcher
echo ============================================
echo   CENSOR - Real-Time Censorship Engine
echo ============================================
echo.

:: Start Python backend
echo [*] Starting backend...
cd /d "%~dp0backend"
start "Censor Backend" cmd /c "venv\Scripts\activate && python -m src.main"

:: Wait for backend to start
echo [*] Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

:: Start Electron frontend
echo [*] Starting frontend...
cd /d "%~dp0frontend"
start "Censor Frontend" cmd /c "npm run dev"

echo.
echo [+] Application starting...
echo [+] Close this window to continue. Use the app's window controls to exit.
echo.
pause
