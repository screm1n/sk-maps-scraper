# Baixa o motor de raspagem (gosom/google-maps-scraper) como programa do Windows, sem Docker.
#   powershell -ExecutionPolicy Bypass -File atalho\baixar-motor.ps1
# Vem do release oficial no GitHub e so e aceito se o SHA-256 bater com o publicado.
$ErrorActionPreference = "Stop"
$versao = "1.18.2"
$arquivo = "google_maps_scraper-$versao-windows-amd64.exe"
$sha256 = "6609e9638ee303b6d419a329f629efcd9ed5d083f86ad6b93f92a21d59c2aca5"
$url = "https://github.com/gosom/google-maps-scraper/releases/download/v$versao/$arquivo"

$destino = Join-Path (Split-Path -Parent $PSScriptRoot) "motor"
New-Item -ItemType Directory -Force $destino | Out-Null
$exe = Join-Path $destino $arquivo
if (-not (Test-Path $exe)) {
  Write-Output "Baixando $arquivo (cerca de 60 MB)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest $url -OutFile "$exe.parcial" -UseBasicParsing
  Move-Item "$exe.parcial" $exe -Force
}
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $sha256) { Remove-Item $exe -Force; throw "O arquivo baixado nao confere com o publicado. Apaguei e nao vou usar." }
Write-Output "Motor pronto em $exe. Abra o atalho SK Maps Scraper: a raspagem Local agora e de verdade."
