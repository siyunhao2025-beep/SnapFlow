$ErrorActionPreference = "Stop"
$version = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
$exe = Join-Path $PWD "release\win-unpacked\SnapFlow.exe"
if (!(Test-Path $exe)) { throw "Missing packaged executable: $exe" }

Write-Host "[SnapFlow] Starting packaged renderer smoke test for v$version..."
$process = Start-Process -FilePath $exe -ArgumentList "--smoke-test" -PassThru
$deadline = (Get-Date).AddSeconds(25)
while (!$process.HasExited -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  $process.Refresh()
}
if (!$process.HasExited) {
  try { Stop-Process -Id $process.Id -Force } catch {}
  throw "Packaged SnapFlow smoke test timed out."
}
if ($process.ExitCode -ne 0) {
  throw "Packaged SnapFlow smoke test failed with exit code $($process.ExitCode)."
}
Write-Host "[SnapFlow] Packaged EXE renderer smoke test PASS."
