# Package de Déploiement Azure - Résumé

## ✅ Fichier créé : `rfacto-backend-deploy.zip`

Taille : **~80 KB**  
Emplacement : `C:\RfactO\backend\rfacto-backend-deploy.zip`

---

## 📦 Contenu du Package

### ✅ INCLUS (Obligatoire)

| Fichier/Dossier | Raison |
|-----------------|--------|
| **package.json** | ✅ **NÉCESSAIRE** - Azure l'utilise pour `npm install` |
| **package-lock.json** | ✅ Verrouille les versions des dépendances |
| **src/** | ✅ Code source de l'application (server.cjs) |
| **prisma/** | ✅ Schéma DB + migrations |
| **scripts/** | ✅ Scripts (fixAzureMigration.js, etc.) |
| **data/** | ⚠️ Données d'import (optionnel) |
| **.deployment** | ✅ Configuration Azure (généré par le script) |

### ❌ EXCLU (Correctement retiré)

| Fichier/Dossier | Raison |
|-----------------|--------|
| **node_modules/** | ❌ Azure exécute `npm install` automatiquement |
| **.env** | ❌ Variables configurées dans Azure Portal |
| **\*.db** | ❌ Base de données locale (SQLite) |
| **\*.db-journal** | ❌ Journal SQLite |

---

## 🚀 Comment Déployer

### Méthode 1 : Via le Portail Azure (Recommandé pour débutants)

1. Connectez-vous à https://portal.azure.com
2. Ouvrez votre **App Service** (ex: rfacto-backend)
3. Dans le menu de gauche, allez à **Deployment Center**
4. Sélectionnez l'onglet **ZIP Deploy** ou **Local Git**
5. Cliquez sur **Browse** et sélectionnez `rfacto-backend-deploy.zip`
6. Cliquez sur **Deploy**
7. Attendez la fin du déploiement (regardez les logs)

### Méthode 2 : Via Azure CLI (Plus rapide)

```powershell
# Installer Azure CLI si nécessaire
winget install Microsoft.AzureCLI

# Se connecter à Azure
az login

# Déployer le ZIP
az webapp deployment source config-zip \
  --resource-group <VOTRE-RESOURCE-GROUP> \
  --name <VOTRE-APP-NAME> \
  --src C:\RfactO\backend\rfacto-backend-deploy.zip

# Exemple concret
az webapp deployment source config-zip \
  --resource-group rfacto-rg \
  --name rfacto-backend \
  --src C:\RfactO\backend\rfacto-backend-deploy.zip
```

---

## ⚙️ Configuration Post-Déploiement

### Variables d'Environnement Requises

Configurez ces variables dans **Azure Portal** > **App Service** > **Configuration** > **Application settings** :

```
DATABASE_URL=file:/home/data/rfacto.db
NODE_ENV=production
JWT_SECRET=votre-secret-jwt-unique-et-securise
PORT=8080
```

#### Si vous utilisez Firebase :
```
FIREBASE_PROJECT_ID=votre-project-id
FIREBASE_PRIVATE_KEY=votre-private-key
FIREBASE_CLIENT_EMAIL=votre-client-email
```

### Via Azure CLI :

```powershell
az webapp config appsettings set \
  --resource-group rfacto-rg \
  --name rfacto-backend \
  --settings \
    NODE_ENV=production \
    DATABASE_URL="file:/home/data/rfacto.db" \
    JWT_SECRET="votre-secret"
```

---

## 📊 Vérification du Déploiement

### 1. Vérifier les logs en temps réel

```powershell
az webapp log tail \
  --resource-group rfacto-rg \
  --name rfacto-backend
```

### Logs attendus (succès) :

```
🔧 Correction de migration échouée détectée...
✅ Colonnes ajoutées
✔ Generated Prisma Client (v5.17.0)
All migrations have been successfully applied
RfactO backend listening on http://localhost:4008
```

### 2. Tester l'application

```powershell
# Remplacez par votre URL Azure
$appUrl = "https://rfacto-backend.azurewebsites.net"

# Test de santé (si endpoint existe)
Invoke-WebRequest -Uri "$appUrl/health"

# Test API
Invoke-WebRequest -Uri "$appUrl/api/settings"
```

### 3. Vérifier dans le Portail Azure

- **Overview** : État = "Running" ✅
- **Metrics** : CPU/Memory normaux
- **Log stream** : Pas d'erreurs critiques

---

## 🔄 Redéploiement

Pour redéployer après modifications :

```powershell
cd C:\RfactO\backend
.\deploy-azure.ps1
# Puis uploadez le nouveau ZIP sur Azure
```

---

## 🆘 Problèmes Courants

### Erreur : "npm install failed"

**Cause** : package.json manquant ou corrompu

**Solution** : Vérifiez que package.json est dans le ZIP :
```powershell
Expand-Archive -Path rfacto-backend-deploy.zip -DestinationPath temp
Get-ChildItem temp
Remove-Item temp -Recurse
```

### Erreur : "Application failed to start"

**Cause** : Variable d'environnement manquante

**Solution** : Vérifiez les variables dans Azure Portal > Configuration

### Migration échoue

**Cause** : Base de données corrompue ou migration déjà appliquée

**Solution** : Le script `fixAzureMigration.js` corrige automatiquement au démarrage

---

## 📝 Checklist Finale

- [x] Script de déploiement créé : `deploy-azure.ps1`
- [x] Package ZIP généré : `rfacto-backend-deploy.zip`
- [x] package.json INCLUS ✅
- [x] node_modules EXCLU ✅
- [x] .env EXCLU ✅
- [x] *.db EXCLU ✅
- [ ] Variables d'environnement configurées dans Azure
- [ ] Package uploadé sur Azure
- [ ] Application démarrée avec succès
- [ ] API testée et fonctionnelle

---

## 📚 Documentation Complète

Consultez [DEPLOIEMENT_AZURE.md](../DEPLOIEMENT_AZURE.md) pour le guide complet.
