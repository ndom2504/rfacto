# ✅ Checklist de Déploiement RfactO

## 📋 Avant le déploiement

### Configuration Azure AD

- [ ] Ouvrir [Azure Portal](https://portal.azure.com)
- [ ] Aller dans **Azure Active Directory** → **App registrations**
- [ ] Sélectionner l'app **RfactO** (Client ID: `4803f728...`)
- [ ] **Authentication** → **Redirect URIs** → Vérifier/ajouter :
  - [ ] `http://localhost:5500` (dev local)
  - [ ] `https://www.rfacto.com` (production)
  - [ ] `https://rfacto-7d240.web.app` (preview Firebase)
  - [ ] `https://rfacto-7d240.firebaseapp.com` (Firebase)
- [ ] Vérifier **Logout URL** : `https://www.rfacto.com`
- [ ] **Token configuration** → Vérifier les claims :
  - [ ] `email`
  - [ ] `name`
  - [ ] `preferred_username`

### Tests en local

- [ ] Démarrer le serveur frontend :
  ```bash
  cd C:\RfactO\frontend
  python -m http.server 5500
  ```
- [ ] Ouvrir `http://localhost:5500` dans le navigateur
- [ ] **Test 1 :** Overlay de connexion visible au démarrage
- [ ] **Test 2 :** Cliquer sur "Se connecter avec Microsoft"
- [ ] **Test 3 :** Authentification Azure réussie
- [ ] **Test 4 :** Retour sur l'app → overlay disparaît
- [ ] **Test 5 :** Interface principale visible
- [ ] **Test 6 :** Onglets fonctionnels (registre, bilan, rapport, etc.)
- [ ] **Test 7 :** Mode mock fonctionne avec `?mock=1`

### Backend (optionnel si déjà déployé)

- [ ] Backend tourne en local sur port 4007
  ```bash
  cd C:\RfactO\backend
  npm start
  ```
- [ ] Tester une requête API :
  ```bash
  curl http://localhost:4007/api/health
  ```
- [ ] Vérifier les logs backend (pas d'erreur)

## 🚀 Déploiement

### 1. Frontend sur Firebase

- [ ] Ouvrir un terminal dans `C:\RfactO\frontend`
- [ ] Déployer sur Firebase :
  ```bash
  npx firebase-tools deploy --only hosting
  ```
- [ ] Attendre la fin du déploiement (≈ 30-60 secondes)
- [ ] Noter les URLs affichées :
  - [ ] `https://rfacto-7d240.web.app`
  - [ ] `https://rfacto-7d240.firebaseapp.com`
- [ ] Ouvrir `https://www.rfacto.com` dans le navigateur
- [ ] **Test post-déploiement :**
  - [ ] Overlay de connexion visible
  - [ ] Authentification fonctionne
  - [ ] Application charge correctement

### 2. Backend sur Azure App Service (si pas déjà fait)

#### Option A : Via Azure Portal

- [ ] Aller sur [Azure Portal](https://portal.azure.com)
- [ ] **Create a resource** → **Web App**
- [ ] Configuration :
  - [ ] **Name :** `rfacto-api` (ou autre nom disponible)
  - [ ] **Runtime :** Node.js 20 LTS
  - [ ] **Region :** choisir la plus proche
  - [ ] **Plan :** Free F1 ou Basic B1
- [ ] Cliquer **Review + Create** → **Create**
- [ ] Attendre la création (≈ 2-3 minutes)
- [ ] Noter l'URL : `https://rfacto-api.azurewebsites.net`

#### Option B : Via GitHub Actions (recommandé)

- [ ] Sur Azure Portal, ouvrir l'App Service créé
- [ ] **Deployment Center** → **GitHub Actions**
- [ ] Autoriser GitHub → sélectionner repo `RfactO`
- [ ] Branch : `main` (ou `master`)
- [ ] Build : **Node.js**
- [ ] Version : **20 LTS**
- [ ] **Save** → workflow créé automatiquement
- [ ] Aller sur GitHub → **Actions** → vérifier le workflow
- [ ] Attendre la fin du déploiement (≈ 5-10 minutes)

#### Configuration de l'App Service

- [ ] **Configuration** → **Application settings** → Ajouter :
  - [ ] `DATABASE_URL` : URL de la base de données (PostgreSQL ou SQLite)
  - [ ] `JWT_AUDIENCE` : `4803f728-e682-4ec9-bb16-bf120a02b237`
  - [ ] `JWT_ISSUER` : `https://login.microsoftonline.com/79f19744.../v2.0`
  - [ ] `PORT` : `8080` (Azure utilise ce port)
- [ ] **CORS** → Ajouter les origines :
  - [ ] `https://www.rfacto.com`
  - [ ] `https://rfacto-7d240.web.app`
  - [ ] `http://localhost:5500` (dev)
- [ ] **Save** → **Restart** l'App Service

### 3. Mise à jour du frontend avec l'URL backend

- [ ] Ouvrir `C:\RfactO\frontend\app.js`
- [ ] Ligne 3-6, remplacer `rfacto-api.azurewebsites.net` par la vraie URL :
  ```javascript
  let API_BASE = localStorage.getItem('rfacto_api_base') || (
    window.location.hostname === 'www.rfacto.com' || window.location.hostname.includes('firebaseapp.com')
      ? "https://TON-APP-SERVICE.azurewebsites.net/api"  // ← Mettre la vraie URL
      : "http://localhost:4007/api"
  );
  ```
- [ ] Sauvegarder le fichier
- [ ] Redéployer sur Firebase :
  ```bash
  npx firebase-tools deploy --only hosting
  ```

## ✅ Validation finale

### Tests de production

- [ ] Ouvrir `https://www.rfacto.com` en navigation privée
- [ ] **Test 1 :** Overlay de connexion affiché
- [ ] **Test 2 :** Se connecter avec un compte Microsoft valide
- [ ] **Test 3 :** Après authentification, app s'affiche
- [ ] **Test 4 :** Charger les projets (onglet registre)
- [ ] **Test 5 :** Créer une nouvelle réclamation
- [ ] **Test 6 :** Vérifier que les données sont sauvegardées
- [ ] **Test 7 :** Se déconnecter → retour à l'overlay
- [ ] **Test 8 :** Ouvrir la console développeur (F12) → pas d'erreur rouge

### Tests multi-navigateurs

- [ ] **Chrome/Edge :** tout fonctionne
- [ ] **Firefox :** tout fonctionne
- [ ] **Safari** (si Mac disponible) : tout fonctionne
- [ ] **Mobile (iOS)** : responsive et fonctionnel
- [ ] **Mobile (Android)** : responsive et fonctionnel

### Sécurité

- [ ] Vérifier que les tokens ne sont PAS dans le code source (GitHub)
- [ ] `clientId` et `tenantId` dans `auth.js` : OK pour le frontend (non sensibles)
- [ ] Variables d'environnement backend bien configurées sur Azure
- [ ] HTTPS actif sur www.rfacto.com (🔒 dans la barre d'adresse)
- [ ] CORS correctement configuré (pas d'erreur `Access-Control-Allow-Origin`)

### Performance

- [ ] Temps de chargement initial < 3 secondes
- [ ] Authentification < 2 secondes
- [ ] Appels API < 1 seconde
- [ ] Pas de lag dans la navigation entre onglets
- [ ] Images et assets chargent rapidement

## 🐛 Résolution des problèmes courants

### Problème : "AADSTS50011: Reply URL mismatch"

**Solution :**
1. Vérifier les redirect URIs dans Azure AD
2. S'assurer que `https://www.rfacto.com` est bien ajouté
3. Attendre 5 minutes pour la propagation des changements Azure

### Problème : "CORS error" lors des appels API

**Solution :**
1. Vérifier les origines CORS dans l'App Service Azure
2. Ajouter `https://www.rfacto.com` dans les origines autorisées
3. Redémarrer l'App Service

### Problème : "Failed to fetch" lors des appels API

**Solutions possibles :**
1. Vérifier que l'App Service est bien démarré (Azure Portal)
2. Tester l'URL backend directement : `https://ton-app.azurewebsites.net/api/health`
3. Vérifier les logs de l'App Service pour des erreurs
4. S'assurer que `API_BASE` dans `app.js` pointe vers la bonne URL

### Problème : Overlay reste visible après connexion

**Solution :**
1. Ouvrir la console développeur (F12)
2. Vérifier s'il y a des erreurs JavaScript
3. Vérifier que `msalAuth` est bien chargé (regarder les scripts dans index.html)
4. Tester en mode incognito pour éliminer les problèmes de cache

### Problème : "Cannot read property 'email' of undefined"

**Solution :**
1. Le token Azure ne contient pas le claim `email`
2. Aller dans Azure AD → App registration → Token configuration
3. Ajouter les optional claims : `email`, `name`, `preferred_username`

## 📞 Support

### Ressources utiles

- **Documentation MSAL :** https://github.com/AzureAD/microsoft-authentication-library-for-js
- **Azure AD Troubleshooting :** https://learn.microsoft.com/azure/active-directory/develop/
- **Firebase Hosting Docs :** https://firebase.google.com/docs/hosting
- **Architecture du projet :** `C:\RfactO\frontend\ARCHITECTURE.md`
- **Résumé des changements :** `C:\RfactO\frontend\REFACTORING.md`

### Logs et debugging

- **Frontend :** Console développeur (F12)
- **Backend :** Azure Portal → App Service → Log stream
- **Firebase :** `npx firebase-tools hosting:channel:list`

---

**Une fois tous les tests passés, l'application est prête pour la production ! 🎉**
