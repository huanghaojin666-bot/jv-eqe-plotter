@echo off
setlocal
set "SITE_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$portOpen = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue; if (-not $portOpen) { Start-Process -FilePath 'py.exe' -ArgumentList '-3','local_server.py' -WorkingDirectory '%SITE_DIR%' -WindowStyle Hidden }; Start-Sleep -Milliseconds 900; $version = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); Start-Process ('http://127.0.0.1:8765/?v=' + $version)"
endlocal
