@echo off
setlocal

set "OROS_DIR=C:\Users\USER\Documents\VSCODE_Laptop\OROS AGENT"

if "%~1"=="run" (
    shift

    pushd "%OROS_DIR%"
    npm run start -- run %*
    popd

    exit /b %errorlevel%
)

echo Usage:
echo   oros run "Open notepad and write Hello"
exit /b 1