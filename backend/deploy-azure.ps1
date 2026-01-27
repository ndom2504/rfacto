# Script de deployment Azure pour RfactO Backend
# Ce script cree un package ZIP optimise pour Azure App Service

Write-Host "Preparation du deploiement Azure..." -ForegroundColor Cyan

# 1. Definir les parametres
$backendPath = $PSScriptRoot
$deployPath = Join-Path $backendPath "deploy"
$zipPath = Join-Path $backendPath "rfacto-backend-deploy.zip"

# 2. Nettoyer les anciens fichiers de deploiement
Write-Host "`nNettoyage des anciens fichiers de deploiement..." -ForegroundColor Yellow
if (Test-Path $deployPath) {
    Remove-Item -Path $deployPath -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}

# 3. Creer le dossier de deploiement
Write-Host "Creation du dossier de deploiement..." -ForegroundColor Yellow
New-Item -Path $deployPath -ItemType Directory -Force | Out-Null

# 4. Copier les fichiers necessaires
Write-Host "Copie des fichiers necessaires..." -ForegroundColor Yellow

# Fichiers a inclure
$filesToInclude = @(
    "package.json",
    "package-lock.json",
    "startup.sh"
)

# Dossiers a inclure
$foldersToInclude = @(
    "src",
    "prisma",
    "scripts",
    "data"
)

# Copier les fichiers
foreach ($file in $filesToInclude) {
    $sourcePath = Join-Path $backendPath $file
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $deployPath -Force
        Write-Host "  OK $file" -ForegroundColor Green
    } else {
        Write-Host "  WARN $file (non trouve, ignore)" -ForegroundColor Yellow
    }
}

# Copier les dossiers
foreach ($folder in $foldersToInclude) {
    $sourcePath = Join-Path $backendPath $folder
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $deployPath -Recurse -Force
        Write-Host "  OK $folder/" -ForegroundColor Green
    } else {
        Write-Host "  WARN $folder/ (non trouve, ignore)" -ForegroundColor Yellow
    }
}

# Supprimer les fichiers de base de donnees locale du dossier prisma copie
Write-Host "`nSuppression des fichiers de base de donnees locale..." -ForegroundColor Yellow
$dbFiles = Get-ChildItem -Path (Join-Path $deployPath "prisma") -Filter "*.db*" -ErrorAction SilentlyContinue
foreach ($dbFile in $dbFiles) {
    Remove-Item $dbFile.FullName -Force
    Write-Host "  EXCLU $($dbFile.Name)" -ForegroundColor Red
}

# 5. Creer un .deployment pour Azure
Write-Host "`nCreation du fichier .deployment..." -ForegroundColor Yellow
$deploymentConfig = @"
[config]
SCM_DO_BUILD_DURING_DEPLOYMENT=true
"@
Set-Content -Path (Join-Path $deployPath ".deployment") -Value $deploymentConfig
Write-Host "  OK .deployment cree" -ForegroundColor Green

# 6. Afficher le resume des fichiers
Write-Host "`nResume du package:" -ForegroundColor Cyan
Write-Host "  INCLUS package.json (necessaire pour npm install)" -ForegroundColor Green
Write-Host "  INCLUS package-lock.json (verrouille les versions)" -ForegroundColor Green
Write-Host "  INCLUS src/ (code source)" -ForegroundColor Green
Write-Host "  INCLUS prisma/ (schema et migrations)" -ForegroundColor Green
Write-Host "  INCLUS scripts/ (scripts de correction)" -ForegroundColor Green
Write-Host "  EXCLU node_modules/ (Azure installe automatiquement)" -ForegroundColor Red
Write-Host "  EXCLU .env (utilisez les variables Azure)" -ForegroundColor Red
Write-Host "  EXCLU *.db (base de donnees locale)" -ForegroundColor Red

# 7. Creer le ZIP
Write-Host "`nCreation du fichier ZIP..." -ForegroundColor Yellow
Compress-Archive -Path "$deployPath\*" -DestinationPath $zipPath -Force
Write-Host "  OK ZIP cree: $zipPath" -ForegroundColor Green

# 8. Afficher la taille
$zipSize = (Get-Item $zipPath).Length / 1MB
Write-Host "  Taille: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Cyan

# 9. Nettoyer le dossier temporaire
Write-Host "`nNettoyage du dossier temporaire..." -ForegroundColor Yellow
Remove-Item -Path $deployPath -Recurse -Force
Write-Host "  OK Nettoyage termine" -ForegroundColor Green

# 10. Instructions finales
Write-Host "`n=====================================================================" -ForegroundColor Cyan
Write-Host "PACKAGE DE DEPLOIEMENT PRET !" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "`nFichier cree: $zipPath" -ForegroundColor White
Write-Host "`nProchaines etapes:" -ForegroundColor Cyan
Write-Host "   1. Allez sur le portail Azure (portal.azure.com)" -ForegroundColor White
Write-Host "   2. Ouvrez votre App Service" -ForegroundColor White
Write-Host "   3. Allez dans 'Deployment Center' > 'FTPS credentials' ou 'Zip Deploy'" -ForegroundColor White
Write-Host "   4. Uploadez le fichier: rfacto-backend-deploy.zip" -ForegroundColor White
Write-Host "`nAlternative via Azure CLI:" -ForegroundColor Cyan
Write-Host "   az webapp deployment source config-zip \" -ForegroundColor Yellow
Write-Host "     --resource-group <votre-resource-group> \" -ForegroundColor Yellow
Write-Host "     --name <votre-app-name> \" -ForegroundColor Yellow
Write-Host "     --src $zipPath" -ForegroundColor Yellow
Write-Host "`nConfiguration requise dans Azure:" -ForegroundColor Cyan
Write-Host "   Variables d'environnement a configurer:" -ForegroundColor White
Write-Host "     - DATABASE_URL (connexion base de donnees)" -ForegroundColor Gray
Write-Host "     - JWT_SECRET (secret pour JWT)" -ForegroundColor Gray
Write-Host "     - FIREBASE_* (configuration Firebase si utilise)" -ForegroundColor Gray
Write-Host "     - NODE_ENV=production" -ForegroundColor Gray
Write-Host "`n=====================================================================" -ForegroundColor Cyan
