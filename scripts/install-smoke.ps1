$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem release/dAIly-Setup-*-x64.exe | Select-Object -First 1
if (-not $installer) { throw 'Installer artifact missing' }
$installRoot = Join-Path $env:RUNNER_TEMP 'daily-installed'
$reportRoot = Join-Path (Get-Location) 'artifacts/installed-smoke'
$personalDirectory = Join-Path $env:APPDATA 'dAIly'
New-Item -ItemType Directory -Force $personalDirectory | Out-Null
$marker = Join-Path $personalDirectory 'preservation-marker.txt'
Set-Content $marker 'Keep existing user data'

function Install-Daily {
  $result = Start-Process -FilePath $installer.FullName -ArgumentList '/S', "/D=$installRoot" -Wait -PassThru
  if ($result.ExitCode -ne 0) { throw "Installer failed: $($result.ExitCode)" }
  if (-not (Test-Path (Join-Path $installRoot 'dAIly.exe'))) { throw 'Installed application missing' }
}
Install-Daily
node scripts/smoke.mjs (Join-Path $installRoot 'dAIly.exe') $reportRoot
if ($LASTEXITCODE -ne 0) { throw 'Installed desktop smoke failed' }
if (-not (Test-Path $marker)) { throw 'Fresh installation removed existing user data' }
Install-Daily
if ((Get-Content $marker) -ne 'Keep existing user data') { throw 'Reinstallation changed user data' }
$uninstaller = Get-ChildItem $installRoot -Filter '*Uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'Uninstaller missing' }
$removed = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
if ($removed.ExitCode -ne 0) { throw 'Uninstaller failed' }
for ($attempt = 0; $attempt -lt 40 -and (Test-Path (Join-Path $installRoot 'dAIly.exe')); $attempt++) { Start-Sleep -Milliseconds 250 }
if (Test-Path (Join-Path $installRoot 'dAIly.exe')) { throw 'Uninstall did not remove the application' }
if (-not (Test-Path $marker)) { throw 'Uninstall removed retained user data' }
@{ passed = $true; checks = @('Fresh installation', 'Packaged renderer and SQLite', 'Existing data preserved on reinstall', 'Uninstaller removes application', 'Uninstaller retains user data') } | ConvertTo-Json | Set-Content (Join-Path $reportRoot 'installer.json')
