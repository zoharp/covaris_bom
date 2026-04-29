@echo off
REM ────────────────────────────────────────────────────────────────
REM  Covaris BOM Viewer — local dev launcher (Windows)
REM
REM  Installs dependencies if needed, then starts the Vite dev
REM  server on http://localhost:5173. The browser will open
REM  automatically.
REM
REM  Usage:
REM    run.bat
REM ────────────────────────────────────────────────────────────────

setlocal

cd /d "%~dp0"

REM Check for Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Please install Node.js 18 or later from https://nodejs.org/
  echo.
  exit /b 1
)

REM Install dependencies if node_modules is missing
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    exit /b 1
  )
)

echo.
echo Starting Vite dev server on http://localhost:5173 ...
echo Press Ctrl+C to stop.
echo.

call npm run dev

endlocal
