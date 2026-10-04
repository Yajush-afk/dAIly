# Prepare the isolated demo database without starting Ollama or Electron.
param([switch]$Reset)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/start-windows.ps1" -SeedOnly -Reset:$Reset
