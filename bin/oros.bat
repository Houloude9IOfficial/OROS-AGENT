@echo off
setlocal

set "OROS_DIR=C:\Users\USER\Documents\VSCODE_Laptop\OROS AGENT"

cd /d "%OROS_DIR%"

if "%~1"=="ui" (
    cmd /k npm run start -- ui
    exit /b
)

if "%~1"=="run" (
    shift
    cmd /k npm run start -- run %*
    exit /b
)

echo Usage:
echo   oros run "task"
echo   oros ui
exit /b 1