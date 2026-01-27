# Script de deploiement Azure CORRIGE pour RfactO Backend
# Cree un ZIP compatible Linux avec slashes Unix

Write-Host "Preparation du deploiement Azure (version corrigee)..." -ForegroundColor Cyan

# 1. Parametres
$backendPath = $PSScriptRoot
$deployPath = Join-Path $backendPath "deploy-linux"
$zipPath = Join-Path $backendPath "rfacto-backend-linux.zip"

# 2. Nettoyer anciens fichiers
Write-Host "`nNettoyage..." -ForegroundColor Yellow
if (Test-Path $deployPath) {
    Remove-Item -Path $deployPath -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}

# 3. Creer dossier deploiement
Write-Host "Creation du dossier de deploiement..." -ForegroundColor Yellow
New-Item -Path $deployPath -ItemType Directory -Force | Out-Null

# 4. Copier fichiers necessaires
Write-Host "Copie des fichiers..." -ForegroundColor Yellow

$filesToInclude = @(
    "package.json",
    "package-lock.json",
    "startup.sh"
)

$foldersToInclude = @(
    "src",
    "prisma",
    "scripts",
    "data"
)

foreach ($file in $filesToInclude) {
    $sourcePath = Join-Path $backendPath $file
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $deployPath -Force
        Write-Host "  OK $file" -ForegroundColor Green
    }
}

foreach ($folder in $foldersToInclude) {
    $sourcePath = Join-Path $backendPath $folder
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $deployPath -Recurse -Force
        Write-Host "  OK $folder/" -ForegroundColor Green
    }
}

# 5. Configuration pour Azure (Schema & Nettoyage)
Write-Host "`nConfiguration pour Azure..." -ForegroundColor Yellow

# Remplacer schema.prisma par schema.mysql.prisma (Priorité MySQL si présent, sinon SQL Server)
$schemaMysqlPath = Join-Path $deployPath "prisma\schema.mysql.prisma"
$schemaSqlPath = Join-Path $deployPath "prisma\schema.sqlserver.prisma"
$schemaPath = Join-Path $deployPath "prisma\schema.prisma"

if (Test-Path $schemaMysqlPath) {
    Write-Host "  REMPLACEMENT schema.prisma par version MySQL" -ForegroundColor Cyan
    Remove-Item -Path $schemaPath -Force -ErrorAction SilentlyContinue
    Move-Item -Path $schemaMysqlPath -Destination $schemaPath -Force
    # Nettoyer l'autre
    if(Test-Path $schemaSqlPath) { Remove-Item $schemaSqlPath -Force }
}
elseif (Test-Path $schemaSqlPath) {
    Write-Host "  REMPLACEMENT schema.prisma par version SQL Server" -ForegroundColor Cyan
    Remove-Item -Path $schemaPath -Force -ErrorAction SilentlyContinue
    Move-Item -Path $schemaSqlPath -Destination $schemaPath -Force
} else {
    Write-Warning "  AUCUN schema.xxx.prisma TROUVE - Utilisation du schema par defaut (SQLite)"
}

# Supprimer fichiers .db
$dbFiles = Get-ChildItem -Path (Join-Path $deployPath "prisma") -Filter "*.db*" -ErrorAction SilentlyContinue
foreach ($dbFile in $dbFiles) {
    Remove-Item $dbFile.FullName -Force
    Write-Host "  EXCLU $($dbFile.Name)" -ForegroundColor Red
}

# 6. Creer .deployment
$deploymentConfig = @"
[config]
SCM_DO_BUILD_DURING_DEPLOYMENT=true
"@
Set-Content -Path (Join-Path $deployPath ".deployment") -Value $deploymentConfig

# 7. Creer le ZIP avec Python (compatible cross-platform)
Write-Host "`nCreation du ZIP compatible Linux..." -ForegroundColor Yellow

$pythonScript = @"
import zipfile
import os
from pathlib import Path

deploy_path = r'$deployPath'
zip_path = r'$zipPath'

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(deploy_path):
        for file in files:
            file_path = os.path.join(root, file)
            # Calculer le chemin relatif
            arcname = os.path.relpath(file_path, deploy_path)
            # IMPORTANT: Convertir les backslashes en slashes pour Linux
            arcname = arcname.replace('\\', '/')
            zipf.write(file_path, arcname)
            print(f'  Ajoute: {arcname}')

print(f'\nZIP cree: {zip_path}')
"@

$pythonScriptPath = Join-Path $backendPath "create_zip.py"
Set-Content -Path $pythonScriptPath -Value $pythonScript

# Executer le script Python
try {
    python $pythonScriptPath
    Remove-Item $pythonScriptPath -Force
    Write-Host "  OK ZIP cree avec slashes Unix" -ForegroundColor Green
} catch {
    Write-Host "  ERREUR: Python requis pour creer un ZIP compatible" -ForegroundColor Red
    Write-Host "  Alternative: Installez Azure CLI et utilisez 'az webapp deployment'" -ForegroundColor Yellow
    exit 1
}

# 8. Nettoyer dossier temporaire
Remove-Item -Path $deployPath -Recurse -Force

# 9. Afficher taille
$zipSize = (Get-Item $zipPath).Length / 1MB
Write-Host "  Taille: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Cyan

Write-Host "`n=====================================================================" -ForegroundColor Cyan
Write-Host "PACKAGE LINUX PRET !" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "`nFichier: $zipPath" -ForegroundColor White
Write-Host "`nCe ZIP utilise des slashes Unix (/) compatibles avec Azure Linux" -ForegroundColor Green
Write-Host "`nUploadez-le sur Azure via le portail:" -ForegroundColor Cyan
Write-Host "  1. portal.azure.com > App Services > rfacto" -ForegroundColor White
Write-Host "  2. Deployment Center > Zip Deploy" -ForegroundColor White
Write-Host "  3. Uploadez: rfacto-backend-linux.zip" -ForegroundColor White
Write-Host "`n=====================================================================" -ForegroundColor Cyan
