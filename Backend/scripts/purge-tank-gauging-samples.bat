@echo off
cd /d "%~dp0.."
node scripts/purge-tank-gauging-samples.js %*
