@echo off
setlocal
cd /d "%~dp0"
set "ADB_PATH=%USERPROFILE%\Desktop\platform-tools\adb.exe"
if not exist "%ADB_PATH%" (echo ADB executable not found: %ADB_PATH% & exit /b 2)
if not exist "gateway\config.json" (copy /Y "gateway\config.pilot-112.example.json" "gateway\config.json" >nul)
node gateway/local-pilot.mjs --room-id 112
endlocal
