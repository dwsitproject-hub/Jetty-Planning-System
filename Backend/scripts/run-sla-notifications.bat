@echo off
cd /d "%~dp0.."
node scripts/run-sla-notifications.js %*
