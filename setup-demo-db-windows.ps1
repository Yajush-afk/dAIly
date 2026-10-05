# Prepare the isolated demo database without starting Ollama or Electron.
param([switch]$Reset, [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/start-windows.ps1" -SeedOnly -Reset:$Reset -SkipInstall:$SkipInstall
