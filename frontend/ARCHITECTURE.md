# Architecture Frontend RfactO

## 📁 Structure des fichiers

```
frontend/
├── index.html          # Point d'entrée unique de l'application
├── app.js             # Logique principale (state, API, UI)
├── auth.js            # Authentification Azure AD via MSAL
├── styles.css         # Styles globaux de l'application
├── assets/            # Ressources statiques (icônes, etc.)
├── mock/              # Données de test pour mode hors ligne
└── firebase.json      # Configuration Firebase Hosting
```

## 🎯 Flux d'authentification

### 1. Démarrage de l'application

L'utilisateur accède à `index.html` qui contient :
- **Login Overlay** : écran de connexion Azure AD (initialement visible)
- **App Shell** : interface principale (initialement cachée)

### 2. Vérification de l'authentification

Au chargement (`DOMContentLoaded`), `app.js` exécute :

```javascript
checkAuth() → vérifie si utilisateur connecté via MSAL
  ├─ Non authentifié → showLoginOverlay()
  └─ Authentifié → hideLoginOverlay() + affiche app-shell
```

### 3. Processus de connexion

```
Utilisateur clique "Se connecter avec Microsoft"
  ↓
handleLogin() appelle msalAuth.loginRedirect()
  ↓
Redirection vers login.microsoftonline.com
  ↓
Utilisateur s'authentifie avec Azure AD
  ↓
Redirection vers index.html avec code d'autorisation
  ↓
MSAL traite la réponse et stocke les tokens
  ↓
checkAuth() détecte l'authentification
  ↓
Application affichée (overlay caché)
```

## 🔑 Configuration Azure AD

### Redirect URIs à configurer dans Azure Portal

**Application Registration → Authentication → Redirect URIs :**

- `http://localhost:5500` (développement local)
- `https://www.rfacto.com` (production)
- `https://rfacto-7d240.web.app` (Firebase preview)
- `https://rfacto-7d240.firebaseapp.com` (Firebase)

**Note :** Le code utilise `window.location.origin` pour s'adapter automatiquement au domaine.

### Identifiants

Configurés dans `auth.js` :

```javascript
const msalConfig = {
  auth: {
    clientId: '4803f728-e682-4ec9-bb16-bf120a02b237',
    authority: 'https://login.microsoftonline.com/79f19744-dc18-4e15-b6b9-a65e89211776',
    redirectUri: window.location.origin
  }
}
```

## 🌐 API Backend

### Configuration dynamique

L'URL du backend s'adapte automatiquement selon l'environnement :

```javascript
// app.js
let API_BASE = 
  window.location.hostname === 'www.rfacto.com' 
    ? "https://rfacto-api.azurewebsites.net/api"  // Production
    : "http://localhost:4007/api"                 // Développement
```

### Paramètres personnalisés

- `?api=https://custom-api.com/api` : force une API spécifique (stocké dans localStorage)
  - Attention: ne pas inclure de query dans `api` (ex: `.../api?mock=0`). Utiliser plutôt `?api=https://.../api&mock=0` ou encoder l'URL.
- `?mock=1` : active le mode hors ligne avec données JSON

## 🧪 Mode Mock (sans backend)

Active un mode démo complet sans connexion au backend :

### Activation

```
?mock=1 dans l'URL
```

### Données simulées

Fichiers JSON dans `frontend/mock/` :
- `projects.json` : projets de test
- `taxes.json` : taux de taxes QC/ON
- `settings.json` : paramètres généraux
- `claims.json` : réclamations exemples
- `teamMembers.json` : membres d'équipe
- `dcr-duplicates.json` : DCR en double

### Comportement

- `USE_MOCK = true` → toutes les requêtes API retournent les données mock
- Rôle utilisateur : `lecture` (lecture seule, pas de modification)
- Idéal pour démos, tests UI, développement frontend isolé

## 🚀 Déploiement

### Firebase Hosting (Frontend)

```bash
# Déployer sur Firebase
npx firebase-tools deploy --only hosting

# URL de production
https://www.rfacto.com
```

### Azure App Service (Backend)

```bash
# Déployé via GitHub Actions
# Voir: .github/workflows/deploy-backend.yml
```

## 🔒 Sécurité

### Tokens d'accès

- **Stockage** : `localStorage` via MSAL
- **Durée** : 1 heure (Azure AD standard)
- **Renouvellement** : automatique via MSAL (refresh token)

### Headers API

Toutes les requêtes au backend incluent :

```javascript
Authorization: Bearer <access_token>
```

### Vérification backend

Le backend vérifie chaque token JWT avec :
- JWKS (JSON Web Key Set) de Microsoft
- Audience : vérifie le `clientId`
- Émetteur : vérifie le `tenantId`

## 📊 États de l'application

### State global (`state` object dans app.js)

```javascript
{
  projects: [],         // Liste des projets
  taxes: [],           // Taux de taxes par province
  settings: {},        // Paramètres généraux
  claims: [],          // Réclamations
  teamMembers: [],     // Membres d'équipe
  currentUser: {       // Utilisateur connecté
    email: "...",
    name: "...",
    role: "user"
  }
}
```

### Onglets disponibles

1. **Registre** : gestion des réclamations
2. **Bilan** : tableau récapitulatif
3. **Rapport** : génération de rapports
4. **Archive** : fichiers et historique
5. **Audit** : traçabilité des modifications
6. **Paramètres** : configuration

## 🔧 Développement local

### Prérequis

- Python 3.x (pour serveur HTTP)
- Navigateur moderne (Chrome, Edge, Firefox)
- Compte Azure AD configuré

### Démarrage

```bash
# Terminal 1 : Frontend
cd C:\RfactO\frontend
python -m http.server 5500

# Terminal 2 : Backend (si nécessaire)
cd C:\RfactO\backend
npm start

# Accès : http://localhost:5500
```

### Mode développement sans backend

```bash
# Ajouter ?mock=1 dans l'URL
http://localhost:5500?mock=1
```

## 📝 Points importants

### ✅ Améliorations de cette architecture

- **Single-Page Application** : un seul fichier HTML
- **Auth intégrée** : overlay de connexion au lieu d'une page séparée
- **Moins de fichiers** : suppression de `login.html`, `api.js`, `archive.js`
- **Configuration adaptative** : s'ajuste automatiquement selon l'environnement
- **Mode offline** : développement possible sans backend

### ⚠️ Points d'attention

- **Redirect URIs** : bien configurer toutes les URLs dans Azure AD
- **CORS** : le backend doit autoriser `www.rfacto.com` et `localhost:5500`
- **Tokens** : ne jamais commiter les clientId/tenantId en production (utiliser variables d'environnement)
- **HTTPS** : obligatoire en production pour MSAL (sauf localhost)

## 🔄 Mise à jour vers production

Avant de déployer sur Firebase :

1. Vérifier les redirect URIs dans Azure AD
2. Tester le flux complet en local
3. S'assurer que `API_BASE` pointe vers l'App Service Azure
4. Déployer : `npx firebase-tools deploy --only hosting`
5. Vérifier l'authentification sur `www.rfacto.com`

---

**Dernière mise à jour :** Décembre 2024
