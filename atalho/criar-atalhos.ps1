# Cria os atalhos do SK Maps Scraper na Area de Trabalho e no menu Iniciar (Windows).
#   powershell -ExecutionPolicy Bypass -File atalho\criar-atalhos.ps1
$aqui = $PSScriptRoot
$icone = Join-Path (Split-Path -Parent $aqui) "assets\logo-sk.ico"
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shell = New-Object -ComObject WScript.Shell

function Atalho($caminho, $script, $descricao) {
  $a = $shell.CreateShortcut($caminho)
  $a.TargetPath = $ps
  $a.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $aqui $script)`""
  $a.WorkingDirectory = $aqui
  $a.IconLocation = "$icone,0"
  $a.Description = $descricao
  $a.WindowStyle = 7
  $a.Save()
  Write-Output "criado: $caminho"
}

$menu = Join-Path ([Environment]::GetFolderPath("Programs")) "SK Maps Scraper"
New-Item -ItemType Directory -Force $menu | Out-Null
Atalho (Join-Path ([Environment]::GetFolderPath("Desktop")) "SK Maps Scraper.lnk") "iniciar.ps1" "Abre o SK Maps Scraper"
Atalho (Join-Path $menu "SK Maps Scraper.lnk") "iniciar.ps1" "Abre o SK Maps Scraper"
Atalho (Join-Path $menu "Parar SK Maps Scraper.lnk") "parar.ps1" "Desliga o SK Maps Scraper"
