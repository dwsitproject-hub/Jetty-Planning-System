@echo off
cd /d "%~dp0.."
node scripts\aggregate-daily-cargo-progress.js %*
