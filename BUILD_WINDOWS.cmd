@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  SnapFlow Windows Builder
for /f "tokens=*" %%v in ('node -v 2^>nul') do echo  Node: %%v
echo ============================================================
where node >nul 2>nul || (echo [ERROR] Node.js is not installed.& pause & exit /b 1)
where npm >nul 2>nul || (echo [ERROR] npm is not installed.& pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\build-windows.ps1"
if errorlevel 1 (
  echo.
  echo [FAILED] SnapFlow build did not complete. Read the error above.
  pause
  exit /b 1
)
echo.
echo [PASS] Installer and Portable EXE were verified.
start "" "%CD%\release"
pause
