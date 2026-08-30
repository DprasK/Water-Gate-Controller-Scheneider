@echo off
cd /d "%~dp0"
node src\start-control-profile.js config\production-control.json
pause
