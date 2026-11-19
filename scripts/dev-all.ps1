<#
  Chạy toàn bộ project dev một lần: parser (8001) + api (3000) + web (5173).
  Mỗi service mở một cửa sổ riêng để xem log. Nhấn Ctrl+C ở cửa sổ này để tắt tất cả.

  Dùng:
    .\scripts\dev-all.ps1              # cài dependency nếu thiếu, rồi chạy cả 3
    .\scripts\dev-all.ps1 -Install     # ép cài lại dependency
    .\scripts\dev-all.ps1 -Seed        # thêm dữ liệu mẫu (admin@example.com / Admin12345)
    .\scripts\dev-all.ps1 -NoWeb       # bỏ web (hoặc -NoApi, -NoParser)
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Seed,
  [switch]$NoParser,
  [switch]$NoApi,
  [switch]$NoWeb
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

# Giá trị dev mặc định; biến đã đặt sẵn trong môi trường sẽ được giữ nguyên.
$defaults = @{
  JWT_ACCESS_SECRET  = 'dev-access-secret-at-least-32-characters'
  JWT_REFRESH_SECRET = 'dev-refresh-secret-at-least-32-characters'
  INTERNAL_KEY       = 'local-internal-key'
  PARSER_URL         = 'http://localhost:8001'
  CORS_ORIGIN        = 'http://localhost:5173'
  PORT               = '3000'
  DATABASE_PATH      = './data/app.db'
  REGISTRATION_MODE  = 'open'
}
foreach ($k in $defaults.Keys) {
  if (-not (Test-Path "Env:$k")) { Set-Item "Env:$k" $defaults[$k] }
}

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

function Invoke-Checked([string]$Dir, [string]$Exe, [string[]]$Arguments) {
  Push-Location $Dir
  try {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "'$Exe $($Arguments -join ' ')' thất bại (exit $LASTEXITCODE) trong $Dir" }
  } finally { Pop-Location }
}

# ---- Chuẩn bị dependency ----
if (-not $NoParser) {
  $venv = Join-Path $Root 'parser\.venv'
  $py = Join-Path $venv 'Scripts\python.exe'
  if (-not (Test-Path $py)) {
    Step 'Tạo parser/.venv'
    Invoke-Checked "$Root\parser" 'python' @('-m', 'venv', '.venv')
    $Install = $true
  }
  if ($Install) {
    Step 'pip install parser'
    Invoke-Checked "$Root\parser" $py @('-m', 'pip', 'install', '-r', 'requirements.txt')
  }
}
foreach ($pair in @(@('api', $NoApi), @('web', $NoWeb))) {
  $name, $skip = $pair
  if ($skip) { continue }
  # npm chỉ ghi .package-lock.json khi cài xong; thiếu file này nghĩa là bản cài dở dang.
  $done = Test-Path (Join-Path $Root "$name\node_modules\.package-lock.json")
  if ($name -eq 'api') {
    $done = $done -and (Test-Path (Join-Path $Root 'api\node_modules\better-sqlite3\build\Release\better_sqlite3.node'))
  }
  if ($Install -or -not $done) {
    Step "npm ci $name"
    Invoke-Checked (Join-Path $Root $name) 'npm' @('ci')
  }
}

if (-not $NoApi) {
  # better-sqlite3 không tự tạo thư mục chứa DB
  $dbDir = Split-Path -Parent ([IO.Path]::GetFullPath((Join-Path "$Root\api" $env:DATABASE_PATH)))
  New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
}

if ($Seed -and -not $NoApi) {
  Step 'Seed dữ liệu mẫu'
  Invoke-Checked "$Root\api" 'npm' @('run', 'seed')
}

# ---- Chạy các service ----
$procs = @()
function Start-Service([string]$Title, [string]$Dir, [string]$Command) {
  Step "Khởi động $Title"
  $full = "`$Host.UI.RawUI.WindowTitle='$Title'; $Command"
  $p = Start-Process powershell -WorkingDirectory $Dir -PassThru `
    -ArgumentList '-NoLogo', '-NoExit', '-Command', $full
  $script:procs += $p
}

try {
  if (-not $NoParser) {
    Start-Service 'parser :8001' "$Root\parser" '& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8001'
  }
  if (-not $NoApi) {
    Start-Service 'api :3000' "$Root\api" 'npm run dev'
  }
  if (-not $NoWeb) {
    Start-Service 'web :5173' "$Root\web" 'npm run dev'
  }

  Write-Host ''
  Write-Host 'Web:    http://localhost:5173' -ForegroundColor Green
  Write-Host 'API:    http://localhost:3000' -ForegroundColor Green
  Write-Host 'Parser: http://localhost:8001' -ForegroundColor Green
  Write-Host 'Nhấn Ctrl+C để tắt tất cả.' -ForegroundColor Yellow

  while ($procs | Where-Object { -not $_.HasExited }) { Start-Sleep -Seconds 1 }
}
finally {
  foreach ($p in $procs) {
    if ($p -and -not $p.HasExited) {
      & taskkill /PID $p.Id /T /F | Out-Null
    }
  }
}
