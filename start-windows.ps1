# Run from PowerShell as your regular desktop user. Default: isolated demo.
param([switch]$Normal)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command exited with $LASTEXITCODE" }
}
New-Item -ItemType Directory -Force -Path 'artifacts/bootstrap' | Out-Null
$node = Get-Command node -ErrorAction SilentlyContinue
if (!$node -or (& node -p 'process.versions.node.split(".")[0]') -ne '24') {
  if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This Windows launcher requires an x64 PC.' }
  $manifest = (Invoke-WebRequest 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -UseBasicParsing).Content
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
$ollamaDirectory = Join-Path $env:LOCALAPPDATA 'Programs/Ollama'
$env:Path = "$ollamaDirectory;$env:Path"
if (!(Get-Command ollama -ErrorAction SilentlyContinue)) {
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
Invoke-Checked -Command 'npm.cmd' -Arguments @('ci')
Invoke-Checked -Command 'ollama' -Arguments @('pull', 'gemma3:4b-it-q4_K_M')
if ($Normal) { Invoke-Checked -Command 'npm.cmd' -Arguments @('run', 'dev') }
else { Invoke-Checked -Command 'npm.cmd' -Arguments @('run', 'demo') }
