# Script de test du frontend avec le nouveau système d'authentification
# Lance un serveur HTTP local sur le port 8080

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RfactO Frontend - Serveur de test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Vérifier si le backend tourne
try {
    $healthCheck = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✅ Backend détecté sur localhost:3000" -ForegroundColor Green
} catch {
    Write-Host "⚠️  WARNING: Le backend ne semble pas tourner sur localhost:3000" -ForegroundColor Yellow
    Write-Host "   Lancez d'abord: cd C:\elux\dashboard; .\start-server.ps1" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continuer quand même? (O/N)"
    if ($continue -ne 'O') {
        exit
    }
}

Write-Host ""
Write-Host "Démarrage du serveur HTTP sur le port 8080..." -ForegroundColor Green
Write-Host ""
Write-Host "📝 Pages disponibles:" -ForegroundColor Yellow
Write-Host "   - Login:  http://localhost:8080/login.html" -ForegroundColor Gray
Write-Host "   - App:    http://localhost:8080/index.html" -ForegroundColor Gray
Write-Host ""
Write-Host "🔑 Mot de passe: elux2026secure" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  NOTE: index.html n'a pas encore été modifié pour utiliser le nouveau système" -ForegroundColor Yellow
Write-Host "   Suivez le guide dans INTEGRATION-AUTH.md pour l'intégrer" -ForegroundColor Yellow
Write-Host ""
Write-Host "Appuyez sur Ctrl+C pour arrêter le serveur" -ForegroundColor Gray
Write-Host ""

# Lancer le serveur Python
try {
    Set-Location -Path $PSScriptRoot
    python -m http.server 8080
} catch {
    Write-Host "❌ ERREUR: Python n'est pas installé ou pas dans le PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternatives:" -ForegroundColor Yellow
    Write-Host "1. Installer Python: https://www.python.org/downloads/" -ForegroundColor Gray
    Write-Host "2. Utiliser Node.js: npm install -g http-server; http-server -p 8080" -ForegroundColor Gray
    Write-Host "3. Utiliser VS Code: Extension 'Live Server'" -ForegroundColor Gray
}
