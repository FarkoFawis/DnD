@echo off
rem Double-click to start the DnD server for a game night (see docs\self-hosting.md).
title DnD server
cd /d "%~dp0"
call npm run host
echo.
echo The DnD server has stopped. You can close this window.
pause >nul
