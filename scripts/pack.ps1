<#
.SYNOPSIS
  Đóng gói project thành file zip, bỏ qua mọi thứ trong .gitignore.

.DESCRIPTION
  Mặc định KHÔNG xóa gì: chỉ gom các file git đang track + file mới chưa bị ignore
  (git ls-files --cached --others --exclude-standard) vào một file zip đặt NGOÀI repo.

  -Clean : xóa hẳn các file/thư mục bị ignore khỏi ổ đĩa (node_modules, .venv, dist, ...).
           Luôn in danh sách và hỏi xác nhận trước. Mặc định GIỮ LẠI dữ liệu thật và secret
           (.env, .run/, data/, uploads/, *.db, *.sqlite, *.pem, *.key).
  -IncludeData : dùng cùng -Clean để xóa luôn cả dữ liệu thật/secret ở trên. Không hoàn tác được.

.EXAMPLE
  .\scripts\pack.ps1
  .\scripts\pack.ps1 -Output D:\backup\IdleInvoice.zip
  .\scripts\pack.ps1 -Clean            # xóa file sinh ra (giữ dữ liệu), không zip
  .\scripts\pack.ps1 -Clean -Zip       # xóa file sinh ra rồi zip
#>
[CmdletBinding()]
param(
  [string]$Output,
  [switch]$Clean,
  [switch]$IncludeData,
  [switch]$Zip,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$root = (git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if (-not $root) { throw 'Không tìm thấy git repo (cần chạy script trong repo IdleInvoice và đã cài git).' }
$root = (Resolve-Path $root).Path
Set-Location $root

# Đường dẫn bị coi là dữ liệu thật / secret: không xóa nếu không có -IncludeData
$protected = @(
  '(^|/)\.env($|\.)', '(^|/)\.run/', '(^|/)data/', '(^|/)uploads/',
  '\.db($|-wal$|-shm$)', '\.sqlite3?$', '\.pem$', '\.key$'
)
function Test-Protected([string]$p) {
  foreach ($re in $protected) { if ($p -match $re) { return $true } }
  return $false
}

# ---------------- Xóa file bị ignore ----------------
if ($Clean) {
  # core.quotepath=false: giữ nguyên tên file tiếng Việt thay vì dạng "\303\241"
  $items = git -c core.quotepath=false clean -ndX |
    ForEach-Object { $_ -replace '^Would remove ', '' } |
    Where-Object { $_ }

  $toDelete = @(); $kept = @()
  foreach ($i in $items) {
    if (-not $IncludeData -and (Test-Protected $i)) { $kept += $i } else { $toDelete += $i }
  }

  if ($kept.Count) {
    Write-Host "`nGiữ lại (dữ liệu thật / secret, thêm -IncludeData nếu muốn xóa):" -ForegroundColor Yellow
    $kept | ForEach-Object { Write-Host "  $_" }
  }
  if (-not $toDelete.Count) {
    Write-Host "`nKhông có gì để xóa." -ForegroundColor Green
  } else {
    Write-Host "`nSẽ xóa:" -ForegroundColor Red
    $toDelete | ForEach-Object { Write-Host "  $_" }
    if ($IncludeData) { Write-Host "`nCẢNH BÁO: danh sách có cả database/uploads/secret, xóa là mất vĩnh viễn." -ForegroundColor Red }
    $ok = $Force -or ((Read-Host "`nGõ 'yes' để xóa") -eq 'yes')
    if (-not $ok) { Write-Host 'Đã hủy, không xóa gì.'; if (-not $Zip) { return } }
    else {
      foreach ($p in $toDelete) {
        $full = Join-Path $root $p
        if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
      }
      Write-Host "Đã xóa $($toDelete.Count) mục." -ForegroundColor Green
    }
  }
  if (-not $Zip) { return }
}

# ---------------- Tạo file zip ----------------
if (-not $Output) {
  $name = Split-Path $root -Leaf
  # Đặt NGOÀI repo để lần đóng gói sau không tự gom chính file zip này vào
  $Output = Join-Path (Split-Path $root -Parent) ("{0}-{1}.zip" -f $name, (Get-Date -Format 'yyyyMMdd-HHmm'))
}
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw "File đã tồn tại: $Output" }

# -z: phân tách bằng NUL để tên file có dấu cách / tiếng Việt không bị lỗi
$raw = git -c core.quotepath=false ls-files -z --cached --others --exclude-standard
$files = $raw -split "`0" | Where-Object { $_ } | Sort-Object -Unique |
  Where-Object { Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf }  # bỏ file đã xóa nhưng còn trong index

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zipFile = [IO.Compression.ZipFile]::Open($Output, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zipFile, (Join-Path $root $f), $f.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $zipFile.Dispose()
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $Output).Length / 1MB, 2)
Write-Host "`nĐã tạo $Output ($($files.Count) file, $sizeMb MB)" -ForegroundColor Green
Write-Host 'Lưu ý: zip có sample/ và parser/tests/fixtures/ (dữ liệu khách hàng thật theo .gitignore). Chỉ gửi cho người được phép xem.' -ForegroundColor Yellow
