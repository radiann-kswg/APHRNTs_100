@echo off
cd /d "%~dp0.."
npm run sync:remote >> logs\sync-remote.log 2>&1
