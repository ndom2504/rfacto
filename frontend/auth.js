// Configuration MSAL pour Azure AD
// Documentation: https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-browser

// Configuration Azure AD - À remplacer par vos valeurs
const msalConfig = {
  auth: {
    clientId: '4a3f05bb-fa7b-48b0-9732-3937868527fe', // Application (client) ID (nouvelle app)
    authority: 'https://login.microsoftonline.com/79f19744-dc18-4e15-b6b9-a65e89211776', // Directory (tenant) ID
    redirectUri: window.location.origin, // s'adapte au domaine (local ou prod), pointe vers index.html
    postLogoutRedirectUri: window.location.origin
  },
  cache: {
    cacheLocation: 'localStorage', // ou 'sessionStorage'
    storeAuthStateInCookie: false
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case msal.LogLevel.Error:
            console.error(message);
            break;
          case msal.LogLevel.Warning:
            console.warn(message);
            break;
          case msal.LogLevel.Info:
            console.info(message);
            break;
          default:
            console.log(message);
        }
      }
    }
  }
};

// Scopes requis pour l'authentification
const loginRequest = {
  scopes: ['openid', 'profile', 'email']
};

// Token request pour API calls - utilise l'API scope de RfactO backend
// Format: api://<AZURE_CLIENT_ID>/user_impersonation OU juste le client ID par défaut
const tokenRequest = {
  scopes: [`api://4a3f05bb-fa7b-48b0-9732-3937868527fe/user_impersonation`],
  forceRefresh: false
};

// Instance MSAL
let msalInstance = null;
let currentAccount = null;

// Classe pour gérer l'authentification
class MSALAuth {
  constructor() {
    try {
      msalInstance = new msal.PublicClientApplication(msalConfig);
    } catch (error) {
      console.error('Erreur initialisation MSAL:', error);
      throw error;
    }
  }

  // Initialiser et gérer le callback de redirection
  async handleRedirectCallback() {
    try {
      // Vérifier s'il y a des paramètres de redirect dans l'URL (query ou hash)
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const hasRedirectParams = 
        urlParams.has('code') || urlParams.has('error') || urlParams.has('state') ||
        hashParams.has('code') || hashParams.has('error') || hashParams.has('state');
      
      if (!hasRedirectParams) {
        // Pas de redirect en cours, vérifier juste les comptes en cache
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          currentAccount = accounts[0];
          msalInstance.setActiveAccount(currentAccount);
          this.storeUserInfo(currentAccount);
        }
        
        // Nettoyer tout état d'interaction en cours qui pourrait traîner
        const interactionStatusKey = Object.keys(localStorage).find(key => 
          key.includes('interaction.status')
        );
        if (interactionStatusKey) {
          localStorage.removeItem(interactionStatusKey);
        }
        
        return null;
      }
      
      // Il y a un redirect en cours, traiter la réponse
      console.log('Traitement du callback de redirect...');
      const response = await msalInstance.handleRedirectPromise();
      if (response) {
        console.log('Authentification réussie:', response.account.username);
        currentAccount = response.account;
        this.storeUserInfo(response.account);
        // Nettoyer l'URL après traitement
        window.history.replaceState({}, document.title, window.location.pathname);
        return response;
      }
      return null;
    } catch (error) {
      console.error('Erreur handleRedirect:', error);
      // Nettoyer l'URL et l'état d'interaction même en cas d'erreur
      window.history.replaceState({}, document.title, window.location.pathname);
      const interactionStatusKey = Object.keys(localStorage).find(key => 
        key.includes('interaction.status')
      );
      if (interactionStatusKey) {
        localStorage.removeItem(interactionStatusKey);
      }
      throw error;
    }
  }

  // Connexion avec popup
  async login() {
    try {
      const response = await msalInstance.loginPopup(loginRequest);
      currentAccount = response.account;
      msalInstance.setActiveAccount(currentAccount);
      this.storeUserInfo(response.account);
      return response;
    } catch (error) {
      console.error('Erreur login popup:', error);
      throw error;
    }
  }

  // Connexion avec redirection (alternative)
  async loginRedirect() {
    try {
      await msalInstance.loginRedirect(loginRequest);
    } catch (error) {
      console.error('Erreur login redirect:', error);
      throw error;
    }
  }

  // Déconnexion
  async logout() {
    try {
      const logoutRequest = {
        account: currentAccount,
        postLogoutRedirectUri: msalConfig.auth.postLogoutRedirectUri
      };
      await msalInstance.logoutPopup(logoutRequest);
      currentAccount = null;
      localStorage.removeItem('rfacto_user');
      localStorage.removeItem('rfacto_token');
    } catch (error) {
      console.error('Erreur logout:', error);
      throw error;
    }
  }

  // Obtenir un access token (silencieux ou interactif)
  async getAccessToken() {
    if (!currentAccount) {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length === 0) {
        throw new Error('Aucun compte connecté');
      }
      currentAccount = accounts[0];
      msalInstance.setActiveAccount(currentAccount);
    }

    const request = {
      ...tokenRequest,
      account: currentAccount
    };

    try {
      // Tentative silencieuse
      const response = await msalInstance.acquireTokenSilent(request);
      localStorage.setItem('rfacto_token', response.accessToken);
      return response.accessToken;
    } catch (error) {
      // Vérifier si MFA ou interaction requise
      const interactionRequired =
        error?.name === "InteractionRequiredAuthError" ||
        error?.errorCode === "interaction_required" ||
        error?.errorCode === "consent_required" ||
        String(error?.message || "").includes("AADSTS50076");

      if (interactionRequired) {
        console.warn('MFA/Interaction requise, déclenchement du redirect...');
        
        // Vérifier qu'une interaction n'est pas déjà en cours
        const interactionStatus = localStorage.getItem('msal.interaction.status');
        if (!interactionStatus) {
          // Déclencher le redirect pour MFA
          await msalInstance.acquireTokenRedirect(request);
        }
        return null;
      }

      // Autre erreur (timeout, réseau, etc.)
      console.debug('Token acquisition failed:', error.message);
      throw error;
    }
  }

  // Vérifier si l'utilisateur est authentifié
  async isAuthenticated() {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length === 0) {
      console.log('Aucun compte trouvé dans MSAL - tentative de reconnexion silencieuse...');
      
      // Vérifier si on a un interaction_status qui bloque
      const interactionStatus = localStorage.getItem('msal.interaction.status');
      if (interactionStatus) {
        console.log('Nettoyage interaction bloquée...');
        localStorage.removeItem('msal.interaction.status');
      }
      
      // Tenter une reconnexion silencieuse
      try {
        const response = await msalInstance.handleRedirectPromise();
        if (response && response.account) {
          currentAccount = response.account;
          msalInstance.setActiveAccount(currentAccount);
          console.log('Reconnexion réussie:', currentAccount.username);
          return true;
        }
      } catch (err) {
        console.warn('Reconnexion silencieuse échouée:', err.message);
      }
      
      return false;
    }

    currentAccount = accounts[0];
    msalInstance.setActiveAccount(currentAccount);
    console.log('Utilisateur authentifié:', currentAccount.username);
    return true;
  }

  // Obtenir les informations de l'utilisateur connecté
  getUserInfo() {
    if (!currentAccount) {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        currentAccount = accounts[0];
      } else {
        return null;
      }
    }

    return {
      name: currentAccount.name || currentAccount.username,
      email: currentAccount.username,
      id: currentAccount.localAccountId,
      tenantId: currentAccount.tenantId
    };
  }

  // Stocker les infos utilisateur dans localStorage
  storeUserInfo(account) {
    const userInfo = {
      name: account.name || account.username,
      email: account.username,
      id: account.localAccountId,
      tenantId: account.tenantId
    };
    localStorage.setItem('rfacto_user', JSON.stringify(userInfo));
  }

  // Récupérer les infos utilisateur depuis localStorage
  getStoredUserInfo() {
    const stored = localStorage.getItem('rfacto_user');
    return stored ? JSON.parse(stored) : null;
  }

  // Obtenir le compte actif
  getActiveAccount() {
    return currentAccount || msalInstance.getActiveAccount();
  }
}

// Initialiser l'instance globale
const msalAuth = new MSALAuth();

// Export pour utilisation dans d'autres fichiers
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { msalAuth, msalConfig, loginRequest };
}
