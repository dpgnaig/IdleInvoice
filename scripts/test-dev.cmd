@echo off
REM Wrapper cho Windows: chạy scripts/test-dev.sh qua Git Bash.
REM   scripts\test-dev.cmd            -> parser + API + typecheck/build web
REM   scripts\test-dev.cmd --e2e      -> thêm Playwright (cần stack đang chạy)

setlocal
set "SCRIPT_DIR=%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not exist "%BASH%" (
  where bash >nul 2>&1 && set "BASH=bash"
)
if not exist "%BASH%" (
  echo Khong tim thay Git Bash. Cai Git for Windows hoac chay: bash scripts/test-dev.sh
  exit /b 1
)

"%BASH%" "%SCRIPT_DIR%test-dev.sh" %*
exit /b %ERRORLEVEL%
