/**
 * RfactO Authentication Helper
 * Gère l'authentification avec le système de mot de passe simple
 */

class RfactoAuth {
  constructor() {
    this.API_BASE = window.location.hostname === 'localhost'
      ? 'http://localhost:3000/api'
      : 'https://api.rfacto.com/api';
    
    this.tokenKey = 'rfacto_auth_token';
    this.timestampKey = 'rfacto_auth_timestamp';
  }

  /**
   * Récupère le token stocké
   */
  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  /**
   * Stocke le token
   */
  setToken(token) {
    localStorage.setItem(this.tokenKey, token);
    localStorage.setItem(this.timestampKey, Date.now().toString());
  }

  /**
   * Supprime le token
   */
  clearToken() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.timestampKey);
  }

  /**
   * Vérifie si l'utilisateur est authentifié
   */
  isAuthenticated() {
    return !!this.getToken();
  }

  /**
   * Redirige vers la page de login si non authentifié
   */
  requireAuth() {
    if (!this.isAuthenticated()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  /**
   * Déconnexion
   */
  logout() {
    this.clearToken();
    window.location.href = '/login.html';
  }

  /**
   * Wrapper fetch avec authentification automatique
   */
  async fetch(url, options = {}) {
    const token = this.getToken();
    
    if (!token) {
      this.requireAuth();
      throw new Error('Non authentifié');
    }

    // Ajouter le token aux headers
    const headers = {
      ...options.headers,
      'X-API-Token': token
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    // Si 401, le token est invalide → déconnecter
    if (response.status === 401) {
      console.warn('Token invalide, déconnexion...');
      this.logout();
      throw new Error('Session expirée');
    }

    return response;
  }

  /**
   * Wrapper pour apiGet (compatible avec app.js existant)
   */
  async apiGet(path) {
    const response = await this.fetch(this.API_BASE + path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Wrapper pour apiPost (compatible avec app.js existant)
   */
  async apiPost(path, data) {
    const response = await this.fetch(this.API_BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Wrapper pour apiPut (compatible avec app.js existant)
   */
  async apiPut(path, data) {
    const response = await this.fetch(this.API_BASE + path, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Wrapper pour apiDelete (compatible avec app.js existant)
   */
  async apiDelete(path) {
    const response = await this.fetch(this.API_BASE + path, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Vérifier le token côté serveur
   */
  async verifyToken() {
    const token = this.getToken();
    if (!token) return false;

    try {
      const response = await this.fetch(this.API_BASE + '/health');
      return response.ok;
    } catch (error) {
      console.error('Erreur vérification token:', error);
      return false;
    }
  }

  /**
   * Login avec mot de passe
   */
  async login(password) {
    const response = await fetch(this.API_BASE + '/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      this.setToken(data.token);
      return true;
    } else {
      throw new Error(data.message || 'Authentification échouée');
    }
  }
}

// Instance globale
const rfactoAuth = new RfactoAuth();

// Export pour utilisation dans app.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RfactoAuth;
}
