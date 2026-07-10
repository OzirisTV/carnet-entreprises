@echo off
set "NODE_EXE=C:\Users\Kevan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
cd /d "%~dp0"

powershell -NoProfile -Command "try { $health = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 1; if ($health.version -eq '2026.07.10-local-save-1') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Arret du serveur DHL bloque...
    taskkill /PID %%P /F >nul 2>&1
  )
  echo Demarrage du serveur DHL...
  start "Serveur DHL" /min "%NODE_EXE%" server.js
  timeout /t 2 /nobreak >nul
) else (
  echo Le serveur DHL est deja actif.
)

powershell -NoProfile -Command "try { $health = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 2; if ($health.version -eq '2026.07.10-local-save-1') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo Impossible de demarrer le serveur DHL.
  echo Verifiez que Node.js est installe puis relancez ce fichier.
  pause
  exit /b 1
)

start "" "http://localhost:3000/"
exit
