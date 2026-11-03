@echo off
rem One-click launcher for Windows: installs dependencies on first run, then opens OpenComp in your browser.
cd /d "%~dp0"

where node >nul 2>nul || goto :nonode

if not exist node_modules\ (
  echo Installing dependencies - first run only, this takes a minute...
  call npm install || goto :fail
)

call npm run dev -- --open
goto :eof

:nonode
echo OpenComp needs Node.js 20 or newer.
echo Install it from https://nodejs.org or run:  winget install OpenJS.NodeJS.LTS
echo Then double-click start.bat again.
pause
exit /b 1

:fail
echo.
echo Installing dependencies failed. See the messages above.
pause
exit /b 1
