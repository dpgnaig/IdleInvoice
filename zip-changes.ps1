<#
.SYNOPSIS
  Zip cac file da thay doi (git) cua repo, giu nguyen cau truc thu muc.

.EXAMPLE
  .\zip-changes.ps1
  # Zip file sua/them/moi (chua commit) so voi HEAD -> Desktop\changes-<timestamp>.zip

.EXAMPLE
  .\zip-changes.ps1 -Base origin/main
  # Zip moi thu khac voi origin/main (gom ca commit da co + chua commit)

.EXAMPLE
  .\zip-changes.ps1 -Base HEAD~3 -Output D:\out\patch.zip
#>
param(
  [string]$Base = 'HEAD',
  [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
if (-not $root) { throw 'Khong phai git repo.' }
$root = (Resolve-Path $root).Path

if (-not $Output) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Output = Join-Path ([Environment]::GetFolderPath('Desktop')) "changes-$stamp.zip"
}
$Output = [IO.Path]::GetFullPath($Output)

# File sua/them/doi ten (so voi $Base) + file moi chua track (khong bi .gitignore)
$changed = @(git -C $root -c core.quotepath=false diff --name-only --diff-filter=ACMR $Base)
$untracked = @(git -C $root -c core.quotepath=false ls-files --others --exclude-standard)
$deleted = @(git -C $root -c core.quotepath=false diff --name-only --diff-filter=D $Base)

$files = @($changed + $untracked) | Where-Object { $_ } | Sort-Object -Unique
$files = $files | Where-Object { (Join-Path $root $_) -ne $Output }

if (-not $files -and -not $deleted) {
  Write-Host 'Khong co thay doi nao de zip.'
  exit 0
}

$outDir = Split-Path $Output -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
if (Test-Path $Output) { Remove-Item $Output -Force }

$zip = [IO.Compression.ZipFile]::Open($Output, 'Create')
try {
  foreach ($rel in $files) {
    $full = Join-Path $root $rel
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $entry = $rel -replace '\\', '/'
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $entry, 'Optimal')
  }
  if ($deleted) {
    $e = $zip.CreateEntry('_deleted-files.txt')
    $w = New-Object IO.StreamWriter($e.Open(), (New-Object Text.UTF8Encoding($false)))
    $w.Write(($deleted -join "`n"))
    $w.Dispose()
  }
}
finally {
  $zip.Dispose()
}

Write-Host "Da zip $(@($files).Count) file$(if ($deleted) { ", $(@($deleted).Count) file bi xoa (liet ke trong _deleted-files.txt)" }) -> $Output"
