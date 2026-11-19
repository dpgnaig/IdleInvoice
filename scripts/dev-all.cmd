@echo off
REM Chay parser + api + web cung luc. Tham so: -Install -Seed -NoParser -NoApi -NoWeb
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-all.ps1" %*
exit /b %ERRORLEVEL%
