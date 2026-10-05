# Run from PowerShell as your regular desktop user. Default: isolated demo.
param([switch]$Normal, [switch]$SeedOnly, [switch]$Reset, [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$windowsArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($windowsArchitecture -ne 'AMD64') { throw 'This Windows launcher requires an x64 PC.' }
if ($Normal -and ($SeedOnly -or $Reset)) { throw 'SeedOnly and Reset apply only to the isolated demo database.' }
function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command exited with $LASTEXITCODE" }
}
New-Item -ItemType Directory -Force -Path 'artifacts/bootstrap' | Out-Null
if (!$Normal -and (Test-Path 'artifacts/demo-recording/user-data/demo-process.json')) {
  $owner = Get-Content 'artifacts/demo-recording/user-data/demo-process.json' -Raw | ConvertFrom-Json
  if (Get-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue) {
    throw 'Quit dAIly from its system tray and stop its terminal with Ctrl+C before starting another take.'
  }
}
Write-Host 'Preparing Node 24...'
$node = Get-Command node -ErrorAction SilentlyContinue
if (!$node -or (& node -p 'process.versions.node.split(".")[0]') -ne '24') {
  $cachedNode = Get-ChildItem 'artifacts/bootstrap' -Directory -Filter 'node-v24.*-win-x64' |
    Where-Object { Test-Path (Join-Path $_.FullName 'node.exe') } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($cachedNode) {
    $env:Path = "$($cachedNode.FullName);$env:Path"
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
}
if (!$node -or (& node -p 'process.versions.node.split(".")[0]') -ne '24') {
  $manifest = (Invoke-WebRequest 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -UseBasicParsing).Content
  if ($manifest -is [byte[]]) { $manifest = [System.Text.Encoding]::UTF8.GetString($manifest) }
  $line = ($manifest -split "`n" | Where-Object { $_ -match ' node-v24\.[\d.]+-win-x64\.zip\s*$' } | Select-Object -First 1).Trim()
  if (!$line) { throw 'Unable to identify Node 24 download.' }
  $parts = $line -split '\s+'
  $archive = $parts[1]
  $download = Join-Path $PSScriptRoot "artifacts/bootstrap/$archive"
  Invoke-WebRequest "https://nodejs.org/dist/latest-v24.x/$archive" -OutFile $download -UseBasicParsing
  if ((Get-FileHash $download -Algorithm SHA256).Hash.ToLower() -ne $parts[0]) { throw 'Node download checksum mismatch.' }
  Expand-Archive $download -DestinationPath 'artifacts/bootstrap' -Force
  $env:Path = "$(Join-Path $PSScriptRoot ('artifacts/bootstrap/' + $archive.Replace('.zip', '')));$env:Path"
}
if ($SkipInstall -and (!(Test-Path 'node_modules/electron/dist/electron.exe') -or !(Test-Path 'node_modules/tsx/dist/cli.mjs') -or !(Test-Path 'node_modules/better-sqlite3'))) {
  throw 'Dependencies are missing. Run start-windows.ps1 without -SkipInstall first.'
}
if (!$SeedOnly) {
  Write-Host 'Checking Ollama...'
  $ollamaDirectory = Join-Path $env:LOCALAPPDATA 'Programs/Ollama'
  $env:Path = "$ollamaDirectory;$env:Path"
  if (!(Get-Command ollama -ErrorAction SilentlyContinue)) {
    if ($SkipInstall) { throw 'Ollama is missing. Run start-windows.ps1 without -SkipInstall first.' }
    $installer = Join-Path $PSScriptRoot 'artifacts/bootstrap/OllamaSetup.exe'
    Invoke-WebRequest 'https://ollama.com/download/OllamaSetup.exe' -OutFile $installer -UseBasicParsing
    $installation = Start-Process $installer -ArgumentList '/VERYSILENT', '/NORESTART' -Wait -PassThru
    if ($installation.ExitCode -ne 0) { throw "Ollama installation failed: $($installation.ExitCode)" }
    if (!(Get-Command ollama -ErrorAction SilentlyContinue)) { throw 'Ollama was installed but is unavailable. Restart PowerShell and retry.' }
  }
  function Test-Ollama {
    try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; return $true }
    catch { return $false }
  }
  if (!(Test-Ollama)) {
    Start-Process (Get-Command ollama).Source -ArgumentList 'serve' -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if (Test-Ollama) { break }
      Start-Sleep -Seconds 1
    }
    if (!(Test-Ollama)) { throw 'Ollama did not start. Open Ollama and run this script again.' }
  }
}
if (!$SkipInstall) {
  Write-Host 'Installing pinned application dependencies...'
  Invoke-Checked -Command 'npm.cmd' -Arguments @('ci')
}
if (!$SeedOnly) {
  if ($SkipInstall) {
    $tags = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
    if (!($tags.models | Where-Object { $_.name -eq 'gemma3:4b-it-q4_K_M' })) {
      throw 'Gemma is missing. Run start-windows.ps1 without -SkipInstall first.'
    }
  } else {
    Write-Host 'Preparing Gemma. The first download is about 3.3 GB...'
    Invoke-Checked -Command 'ollama' -Arguments @('pull', 'gemma3:4b-it-q4_K_M')
  }
}
Write-Host $(if ($Normal) { 'Starting dAIly with personal data...' } elseif ($SeedOnly) { 'Preparing the isolated demo database...' } else { 'Starting dAIly with the isolated demo database...' })
if ($Normal) { Invoke-Checked -Command 'npm.cmd' -Arguments @('run', 'dev') }
else {
  $demoArguments = @('run', 'demo', '--')
  if ($Reset) { $demoArguments += '--reset' }
  if ($SeedOnly) { $demoArguments += '--seed-only' }
  Invoke-Checked -Command 'npm.cmd' -Arguments $demoArguments
}
