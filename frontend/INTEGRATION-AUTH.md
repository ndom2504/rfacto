# 🔐 Mise à jour Frontend - Authentification par mot de passe

## ✅ Backend protégé

Le backend ELUX Dashboard est maintenant **100% protégé par mot de passe**. Toutes les routes API exigent l'authentification:

- ✅ `/api/claims`
- ✅ `/api/projects`
- ✅ `/api/taxes`
- ✅ `/api/settings`
- ✅ `/api/team-members`
- ✅ `/api/amendments`
- ✅ `/api/vps`

**Sans authentification → 401 Unauthorized**

## 📦 Fichiers créés pour le frontend

### 1. Page de login
- **Fichier**: `login.html`
- **Design**: Interface moderne avec gradient
- **Fonctionnalités**:
  - Vérifie si déjà authentifié au chargement
  - Stocke le token dans localStorage
  - Redirige vers index.html après login réussi
  - Gestion des erreurs avec animation

### 2. Helper d'authentification
- **Fichier**: `rfacto-auth.js`
- **API**:
  ```javascript
  const auth = new RfactoAuth();
  
  // Vérifier l'authentification
  auth.requireAuth(); // Redirige vers login.html si non authentifié
  
  // Faire des requêtes authentifiées
  const data = await auth.apiGet('/claims');
  
  // Déconnexion
  auth.logout();
  ```

## 🚀 Intégration dans index.html

### Option A: Modification minimale (RECOMMANDÉE)

Ajoutez ces lignes **AVANT** `<script src="app.js">` dans `index.html`:

```html
<!-- Authentification par mot de passe -->
<script src="rfacto-auth.js"></script>
<script>
  // Vérifier l'authentification avant de charger l'app
  if (!rfactoAuth.isAuthenticated()) {
    window.location.href = '/login.html';
  }
</script>

<!-- App principale -->
<script src="app.js?v=20260206-1"></script>
```

### Option B: Remplacement complet d'app.js

Remplacer toutes les fonctions `apiGet()`, `apiPost()`, `apiPut()`, `apiDelete()` par:

```javascript
// Ancienne version (avec MSAL Azure AD)
async function apiGet(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(API_BASE + path, { headers });
  return res.json();
}

// Nouvelle version (avec mot de passe simple)
async function apiGet(path) {
  return rfactoAuth.apiGet(path);
}
```

## 🔑 Mot de passe

**Mot de passe actuel**: `elux2026secure`

Pour modifier:
1. Éditer `.env.local` dans le backend:
   ```bash
   SIMPLE_API_PASSWORD=nouveau_mot_de_passe
   ```
2. Rebuild: `npm run build`
3. Redémarrer: `.\start-server.ps1`

## 🌐 Déploiement

### 1. Backend (déjà fait ✅)
```powershell
cd C:\elux\dashboard
npm run build
.\start-server.ps1
```

Le serveur tourne sur:
- Local: http://localhost:3000
- Cloudflare: https://api.rfacto.com (via tunnel)

### 2. Frontend (À FAIRE)

#### Copier les nouveaux fichiers
```powershell
cp C:\RfactO\frontend\login.html C:\RfactO\frontend\public\
cp C:\RfactO\frontend\rfacto-auth.js C:\RfactO\frontend\public\
```

#### Modifier index.html
Ajouter la vérification d'authentification (voir Option A ci-dessus)

#### Déployer sur Firebase
```powershell
cd C:\RfactO\frontend
firebase deploy
```

## 🧪 Tests

### Test 1: Accès sans authentification → Erreur
```powershell
Invoke-RestMethod -Uri 'https://api.rfacto.com/api/claims' -Method GET
# Résultat attendu: 401 Unauthorized ✅
```

### Test 2: Login + récupération données → Succès
```powershell
# Login
$body = @{ password = 'elux2026secure' } | ConvertTo-Json
$loginResponse = Invoke-RestMethod -Uri 'https://api.rfacto.com/api/auth/verify' `
  -Method POST -Body $body -ContentType 'application/json'
$token = $loginResponse.token

# Récupérer les claims
$claims = Invoke-RestMethod -Uri 'https://api.rfacto.com/api/claims' `
  -Method GET -Headers @{ 'X-API-Token' = $token }

Write-Host "Claims récupérées: $($claims.Count)"
# Résultat attendu: 317 claims ✅
```

### Test 3: Frontend login

1. Ouvrir www.rfacto.com (ou localhost)
2. **Vous devriez voir une erreur 401** dans la console si les données ne se chargent pas
3. Aller sur www.rfacto.com/login.html
4. Entrer le mot de passe: `elux2026secure`
5. Vous devriez être redirigé vers index.html avec accès aux données

## 📊 Statut actuel

### ✅ Fait
- Backend protégé à 100%
- Système de mot de passe fonctionnel
- Page de login créée
- Helper JavaScript créé
- Tests validés en local

### ⏳ À faire
- Modifier `index.html` pour vérifier l'authentification au démarrage
- Tester en local avec le nouveau système
- Déployer sur Firebase: www.rfacto.com

## 🔒 Sécurité

### Durée de validité du token
- **24 heures** après le login
- Après expiration → redirection automatique vers login.html

### Stockage
- Token stocké dans `localStorage` du navigateur
- Clé: `rfacto_auth_token`
- **Note**: localStorage est accessible en JavaScript, gardez votre mot de passe secret!

### HTTPS
- ✅ Pas de problème: www.rfacto.com est en HTTPS
- ✅ api.rfacto.com est en HTTPS (via Cloudflare)
- Le token est transmis de manière sécurisée

## 🆘 Dépannage

### "Les données ne s'affichent plus sur www.rfacto.com"
**C'est normal!** Le backend est maintenant protégé. Il faut:
1. Ajouter la page de login
2. Modifier index.html pour l'utiliser

### "401 Unauthorized même avec le token"
Vérifier que:
- Le serveur backend tourne: `.\start-server.ps1`
- Le fichier `.env.local` existe dans `.next/standalone/`
- NEXTAUTH_SECRET est défini dans `.env.local`

### "Le token ne fonctionne pas après un rebuild"
C'est normal si vous avez changé `NEXTAUTH_SECRET`. Les anciens tokens sont invalidés.
Solution: Se reconnecter sur login.html

## 📝 Prochaines étapes

1. **Tester en local**:
   ```powershell
   # Terminal 1: Backend
   cd C:\elux\dashboard
   .\start-server.ps1
   
   # Terminal 2: Frontend (serveur local simple)
   cd C:\RfactO\frontend
   python -m http.server 8080
   
   # Ouvrir: http://localhost:8080/login.html
   ```

2. **Modifier index.html** (ajouter la vérification auth)

3. **Déployer sur Firebase**:
   ```bash
   firebase deploy
   ```

4. **Tester en production**: www.rfacto.com

---

**✅ Votre backend est maintenant sécurisé!**  
**⏳ Il reste juste à intégrer le login dans le frontend.**
