@echo off
setlocal
cd /d "%~dp0"
title StoryTime (LAN)

echo.
echo  ============================================
echo   StoryTime - LAN mode
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
    copy /y ".env.example" ".env" >nul
  )
)

REM Launching again restarts the app: stop any copy already running first, so
REM it is not holding the database while migrations run.
call node scripts\free-ports.mjs || goto :failed

call npm run db:migrate || goto :failed

REM dev:lan prints the addresses to use from other devices and binds to 0.0.0.0.
call npm run dev:lan

goto :eof

:failed
echo.
echo  Something went wrong. The message above should say what.
echo.
pause
exit /b 1
