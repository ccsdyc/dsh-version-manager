@echo off
setlocal
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo [dsh-version-manager] Node.js was not found on PATH.
  echo Install Node.js, or run: node install.mjs
  pause
  exit /b 1
)

node "%~dp0install.mjs" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  pause
  exit /b %CODE%
)

if "%~1"=="" pause
exit /b 0
