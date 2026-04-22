@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo === Supplier Hub kurulum ===

where node >nul 2>&1
if errorlevel 1 (
  echo Node yok. Kur: https://nodejs.org/ ^(22 LTS^) veya: winget install OpenJS.NodeJS.LTS
  exit /b 1
)

for /f "tokens=1 delims=." %%a in ('node -v') do set NODEMAJOR=%%a
set NODEMAJOR=!NODEMAJOR:v=!
if !NODEMAJOR! LSS 22 (
  echo Node !NODEMAJOR! tespit edildi. Node 22+ gerekli ^(node:sqlite icin^).
  echo Kur: winget install OpenJS.NodeJS.LTS
  exit /b 1
)
echo    Node:
node -v

if not exist node_modules (
  echo ^>^> npm install...
  call npm install
)
echo    node_modules OK

if not exist .env (
  copy .env.example .env >nul
  for /f "delims=" %%s in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set SECRET=%%s
  powershell -Command "(Get-Content .env) -replace '^SESSION_SECRET=.*', 'SESSION_SECRET=!SECRET!' | Set-Content .env"
  echo    .env olusturuldu ^(SESSION_SECRET otomatik^)
) else (
  echo    .env mevcut, dokunulmadi
)

if not exist data mkdir data
echo ^>^> seed...
call npm run seed:users
call npm run seed:catalog
call npm run seed

echo.
echo Kurulum tamam.
echo.
echo Test kullanicilari:
echo   admin@hub.local    / admin123
echo   owner@hub.local    / owner123
echo   supplier@hub.local / supplier123
echo.
echo Baslat: npm start
echo   -^> http://localhost:3100
