@echo off
setlocal
cd /d "%~dp0"
title StoryTime

echo.
echo  ============================================
echo   StoryTime
echo  ============================================
echo.

if not exist "node_modules\" (
  echo  First run: installing dependencies. This takes a minute.
  echo.
  call npm install || goto :failed
  echo.
)

if not exist ".env" (
  if exist ".env.example" (
    echo  Creating .env from .env.example.
    copy /y ".env.example" ".env" >nul
    echo  Add an API key to .env when you want to use a real model.
    echo.
  )
)

echo  Applying database migrations...
call npm run db:migrate || goto :failed
echo.

echo  Starting. The app will be at http://localhost:5173
echo  Press Ctrl+C in this window to stop.
echo.

set BROWSER=none
REM Open the browser after a short delay so Vite is listening by the time it loads.
start "StoryTime browser" /min "%~dp0scripts\open-browser.bat" 4 http://localhost:5173
call npm run dev

goto :eof

:failed
echo.
echo  Something went wrong. The message above should say what.
echo.
pause
exit /b 1
