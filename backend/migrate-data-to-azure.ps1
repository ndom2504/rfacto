# Script d'encapsulation pour la migration vers Azure
# Utilisation: .\migrate-data-to-azure.ps1
# Ce script prépare l'environnement local pour parler à Azure MySQL ou SQL Server, migre les données, puis restaure l'environnement local.

$backendPath = $PSScriptRoot
$schemaPath = Join-Path $backendPath "prisma\schema.prisma"
$schemaSqlPath = Join-Path $backendPath "prisma\schema.sqlserver.prisma"
$schemaMysqlPath = Join-Path $backendPath "prisma\schema.mysql.prisma"
$schemaMyBackup = Join-Path $backendPath "prisma\schema.local_backup.prisma"

Write-Host "=== MIGRATION DES DONNEES LOCALES VERS AZURE ===" -ForegroundColor Cyan
Write-Host "Ce script va :"
Write-Host "1. Demander votre chaine de connexion Azure (MySQL ou SQL Server)"
Write-Host "2. Configurer temporairement Prisma"
Write-Host "3. Pousser le schema (création des tables sur Azure)"
Write-Host "4. Importer le dernier backup local vers Azure"
Write-Host "5. Restaurer votre configuration locale (SQLite)"
Write-Host ""

# 1. Demander connection string
Write-Host "Exemple MySQL     : mysql://admin:pass@host:3306/db?sslaccept=strict"
Write-Host "Exemple SQLServer : sqlserver://host.database.windows.net:1433;database=db;..."
$connectionString = Read-Host "Entrez votre Connection String Azure"

if ([string]::IsNullOrWhiteSpace($connectionString)) {
    Write-Error "Chaine de connexion vide. Abandon."
    exit 1
}

# Détection du type de base de données
$targetSchema = ""
if ($connectionString.StartsWith("mysql")) {
    $targetSchema = $schemaMysqlPath
    Write-Host "Détection : MySQL" -ForegroundColor Green
} elseif ($connectionString.StartsWith("sqlserver")) {
    $targetSchema = $schemaSqlPath
    Write-Host "Détection : SQL Server" -ForegroundColor Green
} else {
    Write-Error "Impossible de détecter le type (mysql://... ou sqlserver://... attendu)."
    exit 1
}

if (-not (Test-Path $targetSchema)) {
    Write-Error "Le fichier de schema cible n'existe pas : $targetSchema"
    exit 1
}

# Configurer l'environnement pour ce processus
$env:DATABASE_URL = $connectionString

# 2. Backup schema local et Swap
Write-Host "`n[1/5] Changement de schema..." -ForegroundColor Yellow
if (Test-Path $schemaPath) {
    Copy-Item $schemaPath -Destination $schemaMyBackup -Force
}
Copy-Item $targetSchema -Destination $schemaPath -Force

# 3. Generate Client (pour SQL Server)
Write-Host "`n[2/5] Generation du client Prisma (SQL Server)..." -ForegroundColor Yellow
Set-Location $backendPath
cmd /c "npx prisma generate"

# 4. Push DB
Write-Host "`n[3/5] Création des tables sur Azure (db push)..." -ForegroundColor Yellow
cmd /c "npx prisma db push --accept-data-loss"

# 5. Run Migration
Write-Host "`n[4/5] Execution du script de migration des données..." -ForegroundColor Yellow
cmd /c "node scripts/migrateToAzure.js"

# 6. Restore Local
Write-Host "`n[5/5] Restauration de la configuration locale..." -ForegroundColor Yellow
if (Test-Path $schemaMyBackup) {
    Copy-Item $schemaMyBackup -Destination $schemaPath -Force
    Remove-Item $schemaMyBackup -Force
}
# Reset env var
$env:DATABASE_URL = ""
# Regenerate pour SQLite
cmd /c "npx prisma generate"

Write-Host "`n=== TERMINE ! Votre base Azure est prete. ===" -ForegroundColor Green
Write-Host "N'oubliez pas de configurer 'DATABASE_URL' dans les 'Configuration' > 'Application Settings' de votre Azure App Service." -ForegroundColor Cyan
