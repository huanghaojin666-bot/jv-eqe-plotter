@echo off
setlocal
set "SITE_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SITE_DIR%启动网站.ps1"
endlocal
