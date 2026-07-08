@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install from https://nodejs.org/ then reopen this terminal.
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo ERROR: FFmpeg is not installed or not on PATH.
  echo.
  echo Windows install options ^(run one in an elevated terminal if needed^):
  echo   winget install --id Gyan.FFmpeg -e
  echo   choco install ffmpeg
  echo   scoop install ffmpeg
  echo.
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting RTSP stream server...
call npm start
