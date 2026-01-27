# Guide de Déploiement Azure - RfactO Backend

## 📋 Ce qui DOIT être inclus dans le déploiement

### ✅ Fichiers Obligatoires

| Fichier/Dossier | Raison |
|-----------------|--------|
| **package.json** | ✅ **OBLIGATOIRE** - Azure en a besoin pour `npm install` |
| **package-lock.json** | ✅ Recommandé - Verrouille les versions des dépendances |
| **src/** | ✅ Code source de l'application |
| **prisma/** | ✅ Schéma et migrations de base de données |
| **scripts/** | ✅ Scripts de correction et d'initialisation |
| **data/** | ⚠️  Optionnel - Données d'import/seed |

### ❌ Fichiers à EXCLURE

| Fichier/Dossier | Raison |
|-----------------|--------|
| **node_modules/** | ❌ Azure exécute `npm install` automatiquement |
| **.env** | ❌ Variables d'environnement configurées dans Azure |
| **\*.db** | ❌ Base de données locale, utilisez Azure SQL/PostgreSQL |
| **deploy/** | ❌ Dossier temporaire de build |
| **\*.log** | ❌ Fichiers de log locaux |

## 🚀 Méthode 1: Script PowerShell Automatique (Recommandé)

### Exécution

```powershell
cd c:\RfactO\backend
.\deploy-azure.ps1
```

### Ce que fait le script

1. ✅ Crée un dossier `deploy/` temporaire
2. ✅ Copie **uniquement** les fichiers nécessaires
3. ✅ Exclut automatiquement node_modules, .env, *.db
4. ✅ Crée les fichiers de configuration Azure (.deployment, web.config)
5. ✅ Génère un ZIP optimisé: `rfacto-backend-deploy.zip`
6. ✅ Nettoie les fichiers temporaires

### Résultat

Un fichier **rfacto-backend-deploy.zip** contenant:
```
rfacto-backend-deploy.zip
├── package.json          ✅ Pour npm install
├── package-lock.json     ✅ Versions verrouillées
├── .deployment           ✅ Config Azure
├── web.config           ✅ Config IIS/Node
├── src/                 ✅ Code source
│   └── server.cjs
├── prisma/              ✅ Schéma + migrations
│   ├── schema.prisma
│   └── migrations/
├── scripts/             ✅ Scripts de correction
│   ├── fixAzureMigration.js
│   └── verifyMigration.js
└── data/                ✅ Données optionnelles
```

## 🌐 Méthode 2: Déploiement via Azure Portal

### Étapes

1. **Créer le package**:
   ```powershell
   .\deploy-azure.ps1
   ```

2. **Se connecter au portail Azure**:
   - Allez sur https://portal.azure.com
   - Ouvrez votre App Service

3. **Déployer le ZIP**:
   - Naviguez vers **Deployment Center**
   - Sélectionnez **ZIP Deploy** ou **Local Git**
   - Uploadez `rfacto-backend-deploy.zip`

4. **Vérifier le déploiement**:
   - Allez dans **Log stream** pour voir les logs en temps réel
   - Vérifiez que `npm install` s'exécute
   - Vérifiez que les migrations Prisma s'appliquent

## 🔧 Méthode 3: Déploiement via Azure CLI

### Prérequis

```powershell
# Installer Azure CLI si nécessaire
winget install Microsoft.AzureCLI

# Se connecter
az login
```

### Commandes

```powershell
# 1. Créer le package
cd c:\RfactO\backend
.\deploy-azure.ps1

# 2. Déployer via ZIP
az webapp deployment source config-zip `
  --resource-group <VOTRE-RESOURCE-GROUP> `
  --name <VOTRE-APP-NAME> `
  --src rfacto-backend-deploy.zip

# 3. Vérifier les logs
az webapp log tail `
  --resource-group <VOTRE-RESOURCE-GROUP> `
  --name <VOTRE-APP-NAME>
```

### Exemple concret

```powershell
# Remplacez par vos valeurs
$resourceGroup = "rfacto-rg"
$appName = "rfacto-backend"

# Déploiement
az webapp deployment source config-zip `
  --resource-group $resourceGroup `
  --name $appName `
  --src rfacto-backend-deploy.zip

# Logs en temps réel
az webapp log tail --resource-group $resourceGroup --name $appName
```

## ⚙️ Configuration des Variables d'Environnement Azure

### Variables Requises

Configurez ces variables dans Azure Portal > App Service > Configuration > Application settings:

| Variable | Exemple | Description |
|----------|---------|-------------|
| **DATABASE_URL** | `file:/home/data/rfacto.db` | Chemin vers la base de données SQLite |
| **NODE_ENV** | `production` | Environnement d'exécution |
| **PORT** | `8080` | Port (Azure définit automatiquement) |
| **JWT_SECRET** | `votre-secret-jwt-123` | Secret pour les tokens JWT |

### Configuration Firebase (si utilisé)

| Variable | Description |
|----------|-------------|
| **FIREBASE_PROJECT_ID** | ID du projet Firebase |
| **FIREBASE_PRIVATE_KEY** | Clé privée (depuis le fichier JSON) |
| **FIREBASE_CLIENT_EMAIL** | Email du service account |

### Via Azure CLI

```powershell
# Définir une variable
az webapp config appsettings set `
  --resource-group rfacto-rg `
  --name rfacto-backend `
  --settings NODE_ENV=production

# Définir plusieurs variables
az webapp config appsettings set `
  --resource-group rfacto-rg `
  --name rfacto-backend `
  --settings `
    NODE_ENV=production `
    DATABASE_URL="file:/home/data/rfacto.db" `
    JWT_SECRET="votre-secret"
```

## 📊 Vérification Post-Déploiement

### 1. Vérifier les Logs

```powershell
az webapp log tail --resource-group rfacto-rg --name rfacto-backend
```

**Logs attendus** :
```
🔧 Correction de migration échouée détectée...
✅ Entrées de migration échouées supprimées
✅ Colonnes ajoutées
✔ Generated Prisma Client
All migrations have been successfully applied
RfactO backend listening on http://localhost:4008
```

### 2. Tester l'API

```powershell
# Remplacez par votre URL Azure
$appUrl = "https://rfacto-backend.azurewebsites.net"

# Test de santé (si endpoint existe)
Invoke-WebRequest -Uri "$appUrl/health" -Method GET

# Test API (nécessite authentification)
Invoke-WebRequest -Uri "$appUrl/api/settings" -Method GET
```

### 3. Vérifier dans le Portail

- **Overview** : État "Running"
- **Metrics** : CPU et Memory usage normaux
- **Log stream** : Pas d'erreurs

## 🔄 Déploiement Continu (CI/CD)

### Option 1: GitHub Actions

Créez `.github/workflows/deploy-azure.yml`:

```yaml
name: Deploy to Azure

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: |
          cd backend
          npm ci
      
      - name: Deploy to Azure
        uses: azure/webapps-deploy@v2
        with:
          app-name: 'rfacto-backend'
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: ./backend
```

### Option 2: Azure DevOps

1. Créez un pipeline dans Azure DevOps
2. Connectez votre repository
3. Utilisez le template "Node.js to Azure App Service"

## 🆘 Dépannage

### Erreur: "npm install failed"

**Cause** : package.json manquant ou corrompu

**Solution** :
```powershell
# Vérifiez que package.json est dans le ZIP
Expand-Archive -Path rfacto-backend-deploy.zip -DestinationPath temp-check
Get-ChildItem temp-check
Remove-Item temp-check -Recurse
```

### Erreur: "Application failed to start"

**Cause** : Variable d'environnement manquante ou script de démarrage incorrect

**Solution** :
1. Vérifiez les logs: `az webapp log tail`
2. Vérifiez les variables d'environnement dans Azure Portal
3. Vérifiez que `npm start` est défini dans package.json

### Erreur: "Migration failed"

**Cause** : Database URL incorrecte ou migrations non synchronisées

**Solution** :
1. Le script `fixAzureMigration.js` devrait corriger automatiquement
2. Vérifiez DATABASE_URL dans les variables d'environnement
3. Vérifiez les logs pour voir les détails de l'erreur

## 📝 Checklist de Déploiement

- [ ] Package.json présent et à jour
- [ ] Script de démarrage configuré (`npm start`)
- [ ] Variables d'environnement configurées dans Azure
- [ ] Base de données accessible (si externe)
- [ ] ZIP créé avec le script PowerShell
- [ ] Déploiement effectué
- [ ] Logs vérifiés (pas d'erreurs)
- [ ] Application accessible via URL Azure
- [ ] API testée et fonctionnelle

## 📚 Ressources

- [Azure App Service Documentation](https://docs.microsoft.com/azure/app-service/)
- [Deploy Node.js to Azure](https://docs.microsoft.com/azure/app-service/quickstart-nodejs)
- [Prisma with Azure](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-azure-app-service)
