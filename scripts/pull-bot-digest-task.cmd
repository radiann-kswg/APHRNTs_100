@echo off
cd /d "%~dp0.."
npm run sync:pull-remote >> logs\pull-digest.log 2>&1
