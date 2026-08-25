$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$electronDir = Join-Path $root "node_modules\electron"
$packagePath = Join-Path $electronDir "package.json"
$checksumsPath = Join-Path $electronDir "checksums.json"

if (!(Test-Path $packagePath)) {
  throw "Electron npm package is missing. Run npm install first."
}
if (!(Test-Path $checksumsPath)) {
  throw "Electron checksums.json is missing. Reinstall the electron npm package."
}

$pkg = Get-Content $packagePath -Raw | ConvertFrom-Json
$version = [string]$pkg.version
if (!$version) { throw "Could not determine Electron version." }

$file = "electron-v$version-win32-x64.zip"
$mirror = $env:ELECTRON_MIRROR
if ([string]::IsNullOrWhiteSpace($mirror)) {
  $mirror = "https://npmmirror.com/mirrors/electron/"
}
if (!$mirror.EndsWith("/")) { $mirror += "/" }
$url = "${mirror}v$version/$file"
$zip = Join-Path $env:TEMP $file
$dist = Join-Path $electronDir "dist"
$exe = Join-Path $dist "electron.exe"

Write-Host "[SnapFlow] Electron fallback installer"
Write-Host "[SnapFlow] Version: $version"
Write-Host "[SnapFlow] Download: $url"

Remove-Item $zip -Force -ErrorAction SilentlyContinue
& curl.exe -L --fail --retry 5 --retry-delay 2 --connect-timeout 20 -o $zip $url
if ($LASTEXITCODE -ne 0 -or !(Test-Path $zip)) {
  throw "Electron ZIP download failed from $url"
}

$checksums = Get-Content $checksumsPath -Raw | ConvertFrom-Json
$property = $checksums.PSObject.Properties[$file]
if ($null -eq $property) {
  throw "No SHA-256 entry for $file in checksums.json"
}
$expected = ([string]$property.Value).ToLowerInvariant()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "[SnapFlow] Expected SHA256: $expected"
Write-Host "[SnapFlow] Actual   SHA256: $actual"
if ($expected -ne $actual) {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  throw "Electron ZIP SHA-256 verification failed. The downloaded archive was deleted."
}

Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dist | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $dist -Force

if (!(Test-Path $exe)) {
  throw "Electron archive was verified but electron.exe was not found after extraction."
}

Set-Content -LiteralPath (Join-Path $electronDir "path.txt") -Value "electron.exe" -Encoding ascii -NoNewline
Remove-Item $zip -Force -ErrorAction SilentlyContinue

Write-Host "[SnapFlow] Electron binary ready: $exe"
