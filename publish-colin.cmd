@echo off
setlocal
cd /d "%~dp0"
echo Build and publish Colin's saved house tour
echo First save colin_house_v2.json after all-floor lighting is ready.
echo.
node scripts\publish-colin.mjs
if errorlevel 1 (
  echo.
  echo Publishing stopped. See the message above.
)
echo.
pause
