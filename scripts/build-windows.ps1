$ErrorActionPreference = "Stop"
$version = (Get-Content .\package.json -Raw | ConvertFrom-Json).version

Write-Host "[SnapFlow] Installing exact dependencies..."
if (Test-Path .\package-lock.json) { npm ci } else { npm install }

Write-Host "[SnapFlow] Ensuring Electron binary is present..."
npm run electron:ensure

Write-Host "[SnapFlow] Running doctor..."
npm run doctor

Write-Host "[SnapFlow] TypeScript + tests + production build + Windows installer/portable..."
npm run dist:win

Write-Host "[SnapFlow] Verifying required EXE artifacts for v$version..."
$setup = Join-Path $PWD "release\SnapFlow-Setup-$version.exe"
$portable = Join-Path $PWD "release\SnapFlow-Portable-$version.exe"
if (!(Test-Path $setup)) { throw "Missing installer: $setup" }
if (!(Test-Path $portable)) { throw "Missing portable build: $portable" }
Get-Item $setup, $portable | Select-Object FullName, Length, LastWriteTime

Write-Host "[SnapFlow] Running packaged EXE renderer smoke test..."
& .\scripts\smoke-windows.ps1

Write-Host "[SnapFlow] Build artifacts and packaged renderer smoke test verified."
