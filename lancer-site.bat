@echo off
set "NODE_EXE=C:\Users\Kevan\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
cd /d "%~dp0"
echo Demarrage du carnet DHL...
echo.
"%NODE_EXE%" server.js
pause
