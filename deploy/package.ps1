$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$out = Join-Path $PSScriptRoot 'out'

Push-Location (Join-Path $root 'api')
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'api build failed' }
} finally {
    Pop-Location
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$out/api", "$out/parser", "$out/systemd" | Out-Null

Copy-Item "$root/api/dist" "$out/api/dist" -Recurse
Copy-Item "$root/api/package.json", "$root/api/package-lock.json" "$out/api/"

Copy-Item "$root/parser/app" "$out/parser/app" -Recurse
Get-ChildItem "$out/parser" -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
Copy-Item "$root/parser/requirements.txt" "$out/parser/"

Copy-Item "$PSScriptRoot/systemd/*.service" "$out/systemd/"
Copy-Item "$PSScriptRoot/Caddyfile.tmpl" "$out/"
Copy-Item "$PSScriptRoot/deploy.sh", "$PSScriptRoot/install.sh" "$out/"

Write-Host "Package ready: $out"
Write-Host "Deploy with: bash deploy/out/deploy.sh user@SERVER_IP https://your-app.vercel.app [path/to/key.pem]"
