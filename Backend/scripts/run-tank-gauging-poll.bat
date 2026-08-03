@echo off
cd /d "%~dp0.."
node scripts/run-tank-gauging-poll.js %*
