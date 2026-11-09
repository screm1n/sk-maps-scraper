# Desliga o SK Maps Scraper (servidor de leads, scraper de exemplo e, se tiver, o Docker).
$ErrorActionPreference = "SilentlyContinue"
$kit = Split-Path -Parent $PSScriptRoot
foreach ($porta in 3000, 8082) {
  Get-NetTCPConnection -LocalPort $porta -State Listen |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}
if (Get-Command docker) { docker info *> $null; if ($LASTEXITCODE -eq 0) { Push-Location $kit; docker compose stop *> $null; Pop-Location } }
