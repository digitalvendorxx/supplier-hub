#Requires -Version 5.1
# Supplier Hub - Windows one-shot installer
# Kullanim (PowerShell):
#   iwr -useb https://raw.githubusercontent.com/digitalvendorxx/supplier-hub/main/install.ps1 | iex
#
# "running scripts is disabled" hatasi alirsan once:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$ErrorActionPreference = 'Stop'

$RepoUrl   = 'https://github.com/digitalvendorxx/supplier-hub.git'
$TargetDir = Join-Path $HOME 'supplier-hub'

function Say($m) { Write-Host ">> $m" -ForegroundColor Cyan }
function Ok($m)  { Write-Host "   $m"  -ForegroundColor Green }
function Warn($m){ Write-Host "   UYARI: $m" -ForegroundColor Yellow }
function Need($c){ $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User")
}

Write-Host "=== Supplier Hub - Windows installer ===" -ForegroundColor Magenta

# 1. winget
if (-not (Need winget)) {
  throw "winget bulunamadi. Windows 10/11 guncel olmali. https://aka.ms/getwinget"
}

# 2. Git
if (-not (Need git)) {
  Say "Git kuruluyor (winget)..."
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
}
Ok "Git: $(git --version)"

# 3. Node 22+ (node:sqlite icin)
$needNode = $true
if (Need node) {
  $ver = (node -v) -replace '^v',''
  $major = [int]($ver.Split('.')[0])
  if ($major -ge 22) { $needNode = $false }
}
if ($needNode) {
  Say "Node 22 LTS kuruluyor (winget)..."
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
}
Ok "Node: $(node -v)"

# 4. Clone / pull
if (Test-Path (Join-Path $TargetDir '.git')) {
  Say "Repo mevcut, guncelleniyor: $TargetDir"
  Push-Location $TargetDir
  git pull --ff-only
  Pop-Location
} else {
  Say "Repo klonlaniyor: $TargetDir"
  git clone $RepoUrl $TargetDir
}

Set-Location $TargetDir

# 5. npm install
if (-not (Test-Path (Join-Path $TargetDir 'node_modules'))) {
  Say "npm install..."
  npm install
}
Ok "node_modules OK"

# 6. .env + SESSION_SECRET auto
$envPath = Join-Path $TargetDir '.env'
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $TargetDir '.env.example') $envPath
  $secret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  (Get-Content $envPath) -replace '^SESSION_SECRET=.*', "SESSION_SECRET=$secret" |
    Set-Content $envPath -Encoding UTF8
  Ok ".env olusturuldu (SESSION_SECRET otomatik)"
} else {
  Ok ".env mevcut, dokunulmadi"
}

# 7. Data dir + seed
New-Item -ItemType Directory -Force -Path (Join-Path $TargetDir 'data') | Out-Null
Say "seed: users + catalog + mock..."
try { npm run seed:users }   catch { Warn "seed:users hata: $_" }
try { npm run seed:catalog } catch { Warn "seed:catalog hata: $_" }
try { npm run seed }         catch { Warn "seed hata: $_" }

Write-Host ""
Write-Host "Kurulum tamam." -ForegroundColor Green
Write-Host ""
Write-Host "Dizin: $TargetDir"
Write-Host ""
Write-Host "Test kullanicilari:"
Write-Host "  admin\@hub.local    / admin123"
Write-Host "  owner\@hub.local    / owner123"
Write-Host "  supplier\@hub.local / supplier123"
Write-Host ""

# 8. Auto-start server (detached) + open browser
$port   = 3100
$logOut = Join-Path $TargetDir 'server.log'
$logErr = Join-Path $TargetDir 'server.err.log'

# Onceki instance varsa oldur
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} }

Say "Server baslatiliyor (detached)..."
$proc = Start-Process -FilePath "node" -ArgumentList "server.js" `
  -WorkingDirectory $TargetDir `
  -RedirectStandardOutput $logOut `
  -RedirectStandardError  $logErr `
  -WindowStyle Hidden -PassThru

# Port bind bekle (max 15 sn)
$url = "http://localhost:$port"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    $ready = $true; break
  }
}

if ($ready) {
  Ok "Server ayakta (PID $($proc.Id)) -> $url"
  Start-Process $url
} else {
  Warn "Server ayaga kalkmadi. Log: $logErr"
}

Write-Host ""
Write-Host "Durdurmak icin: Stop-Process -Id $($proc.Id)"
Write-Host "Tekrar baslat:  cd `"$TargetDir`"; npm start"
Write-Host ""
Write-Host "Gercek Easyship: .env -> DATA_SOURCE=easyship + EASYSHIP_API_TOKEN"
