@echo off
echo ======================================
echo   TEST RAPIDE - Authentification
echo ======================================
echo.

echo Verification des fichiers necessaires...
if not exist "login.html" (
    echo [ERREUR] login.html manquant
    pause
    exit /b 1
)
echo [OK] login.html

if not exist "rfacto-auth.js" (
    echo [ERREUR] rfacto-auth.js manquant
    pause
    exit /b 1
)
echo [OK] rfacto-auth.js

if not exist "index.html" (
    echo [ERREUR] index.html manquant
    pause
    exit /b 1
)
echo [OK] index.html

if not exist "app.js" (
    echo [ERREUR] app.js manquant
    pause
    exit /b 1
)
echo [OK] app.js

echo.
echo Tous les fichiers sont presents !
echo.
echo ---------------------------------------
echo   DEPLOIEMENT FIREBASE
echo ---------------------------------------
echo.
echo Voulez-vous deployer sur Firebase maintenant?
echo (Tapez 'O' pour Oui, ou n'importe quelle touche pour annuler)
set /p "deploy=Votre choix: "

if /i "%deploy%"=="O" (
    echo.
    echo Deploiement en cours...
    firebase deploy
    echo.
    echo Deploiement termine!
    echo.
    echo Testez sur: https://www.rfacto.com
    echo Mot de passe: elux2026secure
) else (
    echo.
    echo Deploiement annule.
    echo.
    echo Pour tester en local, lancez:
    echo   python -m http.server 8080
    echo.
    echo Puis ouvrez: http://localhost:8080/login.html
)

echo.
pause
