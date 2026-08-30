@echo off
cd /d "%~dp0"
node src\start-control-profile.js config\commissioning-control.json
pause
