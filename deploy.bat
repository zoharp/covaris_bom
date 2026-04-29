@echo off
REM ────────────────────────────────────────────────────────────────
REM  Covaris BOM Viewer — Vercel production deploy (Windows)
REM
REM  Builds the app and pushes it to Vercel as a production deploy.
REM
REM  Prerequisites (one-time):
REM    1. Install Vercel CLI:   npm install -g vercel
REM    2. Log in to Vercel:     vercel login
REM    3. Link project:         vercel link  (first time only)
REM
REM  Usage:
REM    deploy.bat
REM ────────────────────────────────────────────────────────────────

setlocal

cd /d "%~dp0"

REM Sanity checks
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  exit /b 1
)

where vercel >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Vercel CLI is not installed.
  echo Run: npm install -g vercel
  echo Then: vercel login
  exit /b 1
)

REM Install / refresh dependencies
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

REM Build
echo.
echo Building production bundle...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed.
  exit /b 1
)

REM Deploy
echo.
echo Deploying to Vercel (production)...
echo.
call vercel --prod

endlocal
