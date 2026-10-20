param([int]$Port = 4173)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try { cargo run --locked --release --bin serve -- $Port }
finally { Pop-Location }
