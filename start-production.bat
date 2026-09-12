@echo off
setlocal
cd /d "%~dp0"
title StoryTime (built)

echo.
echo  ============================================
echo   StoryTime - production build
echo  ============================================
echo.
echo  Builds the app, then serves everything from one port.
echo  Slower to start than start.bat, but no dev tooling running.
echo.

if not exist "node_modules\" (
  echo  First run: installing dependencies.
  echo.
  call npm install || goto :failed
  echo.
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
  )
)

call npm run db:migrate || goto :failed

echo  Building...
call npm run build || goto :failed
echo.

echo  Starting. The app will be at http://localhost:3001
echo  Press Ctrl+C in this window to stop.
echo.

start "StoryTime browser" /min "%~dp0scripts\open-browser.bat" 3 http://localhost:3001
call npm start

goto :eof

:failed
echo.
echo  Something went wrong. The message above should say what.
echo.
pause
exit /b 1
