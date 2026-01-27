# Script de déploiement via Kudu API (alternative au portail)
# Nécessite Azure CLI installé

Write-Host "Déploiement via Kudu API..." -ForegroundColor Cyan

$zipPath = Join-Path $PSScriptRoot "rfacto-backend-linux.zip"
$appName = "rfacto-c2cmgac5erbcfafq"
$resourceGroup = "DefaultResourceGroup-CC"  # À MODIFIER si différent

if (-not (Test-Path $zipPath)) {
    Write-Host "ERREUR: ZIP non trouvé: $zipPath" -ForegroundColor Red
    exit 1
}

Write-Host "Récupération des credentials..." -ForegroundColor Yellow
try {
    $creds = az webapp deployment list-publishing-credentials --name $appName --resource-group $resourceGroup --query "{username:publishingUserName, password:publishingPassword}" -o json | ConvertFrom-Json
    
    if (-not $creds) {
        throw "Credentials non récupérés"
    }
} catch {
    Write-Host "ERREUR: Azure CLI requis. Installez-le ou utilisez le portail." -ForegroundColor Red
    Write-Host "Alternative: Portail Azure > App Service > Deployment Center > Zip Deploy" -ForegroundColor Yellow
    exit 1
}

Write-Host "Envoi du ZIP via Kudu..." -ForegroundColor Yellow
$base64AuthInfo = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($creds.username):$($creds.password)"))
$kuduUrl = "https://$appName.scm.canadacentral-01.azurewebsites.net/api/zipdeploy"

try {
    $response = Invoke-RestMethod -Uri $kuduUrl -Method POST -InFile $zipPath -Headers @{Authorization=("Basic {0}" -f $base64AuthInfo)} -ContentType "application/zip"
    Write-Host "✅ Déploiement réussi!" -ForegroundColor Green
} catch {
    Write-Host "❌ Échec du déploiement:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
