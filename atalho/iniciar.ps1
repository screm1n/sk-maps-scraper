# SK Maps Scraper: sobe o que precisa e abre o app numa janela propria.
# Com Docker rodando: docker compose (raspagem Local de verdade, porta 8080).
# Sem Docker: servidor de leads + scraper de exemplo (porta 3000). Apify e Google Places funcionam igual.
$ErrorActionPreference = "SilentlyContinue"
$kit = Split-Path -Parent $PSScriptRoot
$leads = Join-Path $kit "leads"

function Aberta($porta) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $porta); return $true } catch { return $false } finally { $c.Close() }
}
function Esperar($porta, $segundos) {
  for ($i = 0; $i -lt $segundos * 4; $i++) { if (Aberta $porta) { return $true }; Start-Sleep -Milliseconds 250 }
  return $false
}
function Aviso($texto) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($texto, "SK Maps Scraper") | Out-Null
}

$docker = $false
if (Get-Command docker) { docker info *> $null; $docker = ($LASTEXITCODE -eq 0) }

if ($docker) {
  Push-Location $kit
  docker compose up -d *> $null
  Pop-Location
  $porta = 8080; $url = "http://localhost:8080/leads"
} else {
  if (-not (Get-Command node)) { Aviso "Precisa do Node 22 instalado (nodejs.org)."; exit 1 }
  if (-not (Test-Path (Join-Path $leads "node_modules"))) {
    Push-Location $leads; npm install *> $null; Pop-Location
  }
  if (-not (Aberta 8082)) {
    $env:PORT = "8082"
    Start-Process node -ArgumentList "test/scraper-falso.js" -WorkingDirectory $leads -WindowStyle Hidden
    Remove-Item Env:PORT
  }
  if (-not (Aberta 3000)) {
    $env:GMAPS_URL = "http://localhost:8082"
    $env:LEADS_DB = "./data/teste.db"
    Start-Process node -ArgumentList "--no-warnings=ExperimentalWarning", "server.js" -WorkingDirectory $leads -WindowStyle Hidden
  }
  $porta = 3000; $url = "http://localhost:3000/leads"
}

if (-not (Esperar $porta 30)) { Aviso "O servidor nao respondeu na porta $porta."; exit 1 }

# Janela de app (sem abas e sem barra de endereco): Chrome, ou Edge se nao tiver Chrome.
$navegador = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($navegador) { Start-Process $navegador -ArgumentList "--app=$url", "--window-size=1400,900" }
else { Start-Process $url }
