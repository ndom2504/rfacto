# Script pour diagnostiquer les erreurs de deploiement Azure

Write-Host "=== DIAGNOSTIC DE DEPLOIEMENT AZURE ===" -ForegroundColor Cyan
Write-Host ""

# Verifier si Azure CLI est installe
Write-Host "1. Verification d'Azure CLI..." -ForegroundColor Yellow
$azInstalled = Get-Command az -ErrorAction SilentlyContinue
if (-not $azInstalled) {
    Write-Host "   ERREUR: Azure CLI n'est pas installe" -ForegroundColor Red
    Write-Host "   Installation: winget install Microsoft.AzureCLI" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "OU bien, consultez les logs directement sur le portail Azure:" -ForegroundColor Cyan
    Write-Host "   1. Allez sur portal.azure.com" -ForegroundColor White
    Write-Host "   2. Ouvrez votre App Service" -ForegroundColor White
    Write-Host "   3. Dans le menu, cliquez sur 'Log stream'" -ForegroundColor White
    Write-Host "   4. Regardez les erreurs en rouge" -ForegroundColor White
    Write-Host ""
    Write-Host "Copiez/collez les erreurs ici pour que je puisse vous aider." -ForegroundColor Yellow
    exit
}

Write-Host "   OK: Azure CLI installe" -ForegroundColor Green

# Verifier la connexion
Write-Host ""
Write-Host "2. Verification de la connexion Azure..." -ForegroundColor Yellow
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "   ERREUR: Non connecte a Azure" -ForegroundColor Red
    Write-Host "   Executez: az login" -ForegroundColor Yellow
    exit
}
Write-Host "   OK: Connecte en tant que $($account.user.name)" -ForegroundColor Green

# Demander le nom de l'App Service
Write-Host ""
Write-Host "3. Quelle est votre App Service?" -ForegroundColor Yellow
Write-Host "   Listage de vos App Services..." -ForegroundColor Gray
$webapps = az webapp list --query "[].{name:name, resourceGroup:resourceGroup, state:state}" | ConvertFrom-Json

if ($webapps.Count -eq 0) {
    Write-Host "   ERREUR: Aucun App Service trouve" -ForegroundColor Red
    Write-Host "   Vous devez d'abord creer un App Service sur Azure" -ForegroundColor Yellow
    exit
}

Write-Host ""
for ($i = 0; $i -lt $webapps.Count; $i++) {
    $status = if ($webapps[$i].state -eq "Running") { "Running" } else { $webapps[$i].state }
    $color = if ($webapps[$i].state -eq "Running") { "Green" } else { "Red" }
    Write-Host "   [$i] $($webapps[$i].name) - RG: $($webapps[$i].resourceGroup) - " -NoNewline
    Write-Host "$status" -ForegroundColor $color
}

Write-Host ""
$selection = Read-Host "Selectionnez le numero (0, 1, 2...)"
$webapp = $webapps[$selection]

if (-not $webapp) {
    Write-Host "Selection invalide" -ForegroundColor Red
    exit
}

Write-Host ""
Write-Host "=== APP SERVICE: $($webapp.name) ===" -ForegroundColor Cyan
Write-Host "Resource Group: $($webapp.resourceGroup)" -ForegroundColor White
Write-Host ""

# Recuperer les logs recents
Write-Host "4. Recuperation des logs recents..." -ForegroundColor Yellow
Write-Host ""
Write-Host "--- LOGS (60 dernieres lignes) ---" -ForegroundColor Cyan

az webapp log download `
    --resource-group $webapp.resourceGroup `
    --name $webapp.name `
    --log-file "$PSScriptRoot\azure-logs.zip" 2>$null

if (Test-Path "$PSScriptRoot\azure-logs.zip") {
    Expand-Archive -Path "$PSScriptRoot\azure-logs.zip" -DestinationPath "$PSScriptRoot\azure-logs" -Force
    $logFiles = Get-ChildItem -Path "$PSScriptRoot\azure-logs" -Filter "*.log" -Recurse | Sort-Object LastWriteTime -Descending
    if ($logFiles) {
        Get-Content $logFiles[0].FullName -Tail 60
    }
    Remove-Item "$PSScriptRoot\azure-logs" -Recurse -Force
    Remove-Item "$PSScriptRoot\azure-logs.zip" -Force
}

Write-Host ""
Write-Host "--- LOG STREAM EN TEMPS REEL ---" -ForegroundColor Cyan
Write-Host "Appuyez sur Ctrl+C pour arreter" -ForegroundColor Gray
Write-Host ""

az webapp log tail `
    --resource-group $webapp.resourceGroup `
    --name $webapp.name
