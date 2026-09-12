@echo off
REM Wait, then open a URL. Kept in its own file because nesting a `start` inside
REM another `start "" cmd /c "..."` is re-parsed by cmd.exe and breaks.
REM Usage: open-browser.bat <seconds> <url>
timeout /t %1 /nobreak >nul 2>&1
start "" "%2"
exit
