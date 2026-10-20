$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    node scripts/build.mjs
    if ($LASTEXITCODE) { throw 'Component build failed' }
} finally { Pop-Location }
