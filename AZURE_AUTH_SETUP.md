# Configuration Azure AD pour RfactO

## Instructions de configuration

### 1. Créer une App Registration dans Azure AD

1. Connectez-vous au [Portail Azure](https://portal.azure.com)
2. Allez dans **Azure Active Directory** → **App registrations**
3. Cliquez sur **New registration**
4. Configurez:
   - **Nom**: RfactO
   - **Supported account types**: Accounts in this organizational directory only
   - **Redirect URI**: 
     - Type: Single-page application (SPA)
     - URL: `http://localhost:5500/login.html` (pour dev local)
     - Ajoutez aussi: `https://votre-domaine.com/login.html` (pour production)
5. Cliquez sur **Register**

### 2. Récupérer les informations

Après création, notez:
- **Application (client) ID**: visible sur la page Overview
- **Directory (tenant) ID**: visible sur la page Overview

### 3. Configurer les permissions API

1. Allez dans **API permissions**
2. Cliquez sur **Add a permission** → **Microsoft Graph**
3. Sélectionnez **Delegated permissions**
4. Ajoutez:
   - `User.Read`
   - `email`
   - `profile`
   - `openid`
5. Cliquez sur **Grant admin consent** (si vous êtes admin)

### 4. Configuration de l'authentification

1. Allez dans **Authentication**
2. Dans **Platform configurations** → **Single-page application**:
   - Redirect URIs: `http://localhost:5500/login.html`
   - Logout URLs: `http://localhost:5500/login.html`
3. Dans **Implicit grant and hybrid flows**:
   - Cochez **ID tokens** (optionnel pour debug)
4. Cliquez sur **Save**

### 5. Variables d'environnement

Créez un fichier `.env` dans `/frontend`:

```env
AZURE_CLIENT_ID=votre-client-id-ici
AZURE_TENANT_ID=votre-tenant-id-ici
```

Ou modifiez directement dans `auth.js` lignes 4-5:
```javascript
clientId: 'VOTRE_CLIENT_ID',
authority: 'https://login.microsoftonline.com/VOTRE_TENANT_ID',
```

### 6. Configuration backend

Le backend dans `server.cjs` valide automatiquement les tokens Azure AD via le middleware JWT.

Pour tester localement avec Visual Studio Code:
- Installez l'extension **Live Server**
- Clic droit sur `login.html` → **Open with Live Server**
- L'app s'ouvrira sur `http://localhost:5500`

### 7. URLs autorisées pour production

Quand vous déployez en production, ajoutez votre domaine dans:
1. Azure Portal → App Registration → Authentication → Redirect URIs
2. Modifiez `auth.js` pour utiliser `window.location.origin` (déjà fait)

## Test de l'authentification

1. Ouvrez `http://localhost:5500/login.html`
2. Cliquez sur "Se connecter avec Microsoft"
3. Connectez-vous avec un compte de votre tenant Azure AD
4. Vous serez redirigé vers l'application

## Sécurité

- Les tokens sont stockés dans `localStorage` par défaut
- Pour plus de sécurité, changez `cacheLocation` à `sessionStorage` dans `auth.js`
- Les tokens expirent automatiquement et sont renouvelés silencieusement
- La déconnexion efface tous les tokens locaux

## Troubleshooting

### Erreur: "AADSTS50011: redirect_uri mismatch"
→ Vérifiez que l'URL de redirection est exactement la même dans Azure et votre code

### Erreur: "Consent required"
→ L'admin doit accorder le consentement pour les permissions API

### Erreur: "AADSTS700051: Invalid client"
→ Vérifiez votre `clientId` et `tenantId`

### Popup bloquée
→ Autorisez les popups pour votre domaine dans le navigateur
