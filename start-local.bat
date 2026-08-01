@echo off
echo ===================================
echo   Starting AudioSync (Local Mode)
echo ===================================
echo.

REM Install dependencies only if node_modules doesn't exist yet
if not exist "node_modules" (
    echo Installing dependencies, this only happens once...
    call npm install
)

echo Building the app...
call npm run build

echo.
echo Starting the server...
echo.
echo IMPORTANT: If Windows Firewall shows a popup asking to allow
echo Node.js to communicate on the network, click "Allow access" —
echo otherwise devices on your WiFi won't be able to join.
echo.

call npm start

pause
