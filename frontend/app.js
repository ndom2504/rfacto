// app.js
const isLocalHost = /^(localhost|127\.0\.0\.1|::1)/.test(window.location.hostname);
const savedApiBase = localStorage.getItem('rfacto_api_base');
const PROD_API_BASE = "https://api.rfacto.com/api";

function normalizeApiBase(value) {
  if (!value) return null;
  let v = String(value).trim();

  // Empêche les bases du style ".../api?mock=0" (ça casserait API_BASE + '/projects')
  v = v.split('#')[0];
  v = v.split('?')[0];

  // Normaliser les slashs finaux
  v = v.replace(/\/+$/, '');
  return v;
}

const defaultApiBase = normalizeApiBase(
  isLocalHost ? "http://localhost:4008/api" : PROD_API_BASE
);

// Hôtes de prod ou préprod : forcer l'API prod et ignorer toute valeur mémorisée
const isProdHost = /rfacto\.com|rfacto-7d240\.web\.app|firebaseapp\.com/i.test(window.location.hostname);

// En local, on ignore l'API mémorisée (qui peut encore pointer sur 4007)
let API_BASE = defaultApiBase;

// Si la page est en HTTPS et que l'API est en HTTP, on force l'API par défaut HTTPS prod
if (isProdHost) {
  API_BASE = PROD_API_BASE;
  localStorage.removeItem('rfacto_api_base');
}

if (window.location.protocol === 'https:' && API_BASE.startsWith('http://')) {
  console.warn('API_BASE en HTTP bloqué en contexte HTTPS, bascule vers l\'API de production');
  API_BASE = PROD_API_BASE;
}

const apiParamRaw = new URLSearchParams(window.location.search).get('api');
const apiParam = normalizeApiBase(apiParamRaw);
// En production/Firebase: ne jamais permettre d'override API via URL (ça casse pour tous les utilisateurs)
if (apiParam && isProdHost) {
  console.warn('Paramètre ?api ignoré en production:', apiParamRaw);
} else if (apiParam) {
  localStorage.setItem('rfacto_api_base', apiParam);
  API_BASE = apiParam;
} else if (!isLocalHost && !isProdHost && savedApiBase) {
  const normalizedSaved = normalizeApiBase(savedApiBase);
  if (normalizedSaved) API_BASE = normalizedSaved;
}
// Mode mock (sans backend) : seulement en localhost + ?mock=1
let USE_MOCK = isProdHost ? false : (isLocalHost && /[?&]mock=1/.test(window.location.search));

// En local, le backend (port 4008) est permissif en mode dev. Par défaut on ne bloque pas l'app sur MSAL.
// Pour forcer le comportement prod (auth obligatoire) en local: ajouter ?auth=1 à l'URL.
const DEV_ALLOW_ANON = isLocalHost && !isProdHost;
const DEV_FORCE_AUTH = /[?&]auth=1/.test(window.location.search);

// Si ?mock=1 → activer explicitement
if (/[?&]mock=1/.test(window.location.search)) {
  console.warn('⚠️ MODE MOCK ACTIVÉ MANUELLEMENT VIA URL');
}

// Si ?mock=0 → forcer sortie du mock
if (/[?&]mock=0/.test(window.location.search)) {
  USE_MOCK = false;
  console.info('✓ Mode mock désactivé via URL');
}

// ⚠️ IMPORTANT : on NE PERSISTE PLUS le mock automatiquement
function setMockMode(on) {
  console.warn('setMockMode() ignoré (mock manuel uniquement via ?mock=1)');
}
let dcrDuplicateIds = new Set();
let msalReady = false;

// État global dédié au tableau Paiement (évite les collisions avec d'autres "appState")
var paymentClaimState = window.paymentClaimState || {
  paymentClaimRows: null,
  paymentClaimTaxFilter: "all",
  paymentClaimSearch: "",
  history: [], // pour Annuler
};
window.paymentClaimState = paymentClaimState;

// === AUTH VÉRIFICATION ==============================================
async function checkAuth() {
  // NOUVEAU: Système de mot de passe simple
  // La vérification est faite dans index.html via rfactoAuth.requireAuth()
  
  // Si on arrive ici, c'est qu'on a un token (sinon redirection vers login.html)
  const token = localStorage.getItem('rfacto_auth_token');
  
  if (token) {
    // Utilisateur authentifié avec le système simple
    state.currentUser = {
      email: 'user@rfacto.com',
      name: 'Utilisateur',
      role: 'admin'  // Tout le monde est admin avec le mot de passe unique
    };
    hideLoginOverlay();
    console.log('✅ Authentifié avec token simple');
    return true;
  }

  // Pas de token → redirection vers login (normalement déjà fait dans index.html)
  console.warn('Pas de token, redirection vers login...');
  if (isProdHost || !DEV_ALLOW_ANON) {
    window.location.href = '/login.html';
    return false;
  }

  // En dev local uniquement: mode permissif
  state.currentUser = {
    email: 'local-dev@rfacto.test',
    name: 'Dev User',
    role: USE_MOCK ? 'lecture' : 'admin'
  };
  hideLoginOverlay();
  return true;
}

// === LOGIN OVERLAY ==================================================
function showLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  const appShell = document.querySelector('.app-shell');
  if (overlay) overlay.style.display = 'flex';
  if (appShell) appShell.style.display = 'none';
}

function hideLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  const appShell = document.querySelector('.app-shell');
  if (overlay) overlay.style.display = 'none';
  if (appShell) appShell.style.display = 'flex';
}

function toggleUserDropdown() {
  const dropdown = document.getElementById('userDropdown');
  if (!dropdown) return;
  
  if (dropdown.style.display === 'none' || dropdown.style.display === '') {
    dropdown.style.display = 'block';
  } else {
    dropdown.style.display = 'none';
  }
}

function hideUserDropdown() {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

async function handleLogout() {
  if (!confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    return;
  }
  
  // Supprimer le token
  localStorage.removeItem('rfacto_auth_token');
  localStorage.removeItem('rfacto_auth_timestamp');
  
  // Rediriger vers la page de login
  window.location.href = '/login.html';
}

async function handleLogin() {
  // Rediriger vers la page de login
  window.location.href = '/login.html';
}

// --- Helpers HTTP avec authentification -----------------------------
// Partage une seule acquisition de token entre appels parallèles (loadData charge plusieurs endpoints)
let tokenAcquisitionPromise = null;

async function getAuthHeaders() {
  if (USE_MOCK) {
    return { 'Content-Type': 'application/json' };
  }

  // NOUVEAU: Système de mot de passe simple via rfactoAuth
  const token = localStorage.getItem('rfacto_auth_token');
  
  if (token) {
    return {
      'Content-Type': 'application/json',
      'X-API-Token': token
    };
  }

  // Pas de token → pas authentifié
  console.warn('Pas de token d\'authentification');
  
  // En production, rediriger vers login
  if (isProdHost) {
    console.warn('Non authentifié, redirection vers login...');
    window.location.href = '/login.html';
    throw new Error('Non authentifié');
  }

  // En dev local sans token, essayer quand même (backend peut être permissif)
  return {
    'Content-Type': 'application/json'
  };
}

async function fetchMock(path) {
  const map = {
    '/health': null,  // Retourne un objet vide
    '/projects': 'mock/projects.json',
    '/taxes': 'mock/taxes.json',
    '/settings': 'mock/settings.json',
    '/claims': 'mock/claims.json',
    '/team-members': 'mock/teamMembers.json',
    '/claims/dcr-duplicates': 'mock/dcr-duplicates.json'
  };
  const file = map[path];
  if (file === undefined) {
    console.warn('MOCK non défini pour', path);
    return {};
  }
  if (file === null) {
    // Endpoint qui ne retourne rien de spécial
    return {};
  }
  const res = await fetch(file + `?t=${Date.now()}`);
  return res.json();
}

async function apiGet(path) {
  if (USE_MOCK) {
    return fetchMock(path);
  }
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(API_BASE + path, { headers });
    if (res.status === 401) {
      // Token invalide ou expiré → rediriger vers login
      console.warn('401 reçu sur', path, '- token invalide ou expiré');
      localStorage.removeItem('rfacto_auth_token');
      localStorage.removeItem('rfacto_auth_timestamp');
      
      if (isProdHost || !DEV_ALLOW_ANON) {
        window.location.href = '/login.html';
      }
      
      throw new Error('Non authentifié');
    }
    if (!res.ok) throw new Error("GET " + path + " -> " + res.status);
    return res.json();
  } catch (e) {
    console.error('Erreur API GET', path, ':', e.message);
    // ✅ NE PLUS basculer en mode mock automatiquement
    // Si le backend est down, on veut voir l'erreur, pas masquer avec du mock
    throw e;
  }
}

// Vérifie rapidement la disponibilité du backend, et désactive le mock si OK
async function ensureBackendAvailableAndDisableMock() {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(API_BASE + '/health', { signal: controller.signal });
    clearTimeout(to);
    if (res.ok) {
      console.log('Backend détecté, désactivation du mode mock');
      setMockMode(false);
      return true;
    }
  } catch (err) {
    console.warn('Backend non joignable pour /health:', err?.message || err);
  }
  return false;
}

// === INIT / TABS / UI STUBS =======================================
async function initApp() {
  // Vérifier auth (affiche l'overlay si non connecté)
  const ok = await checkAuth();
  if (!ok) return;
  // Debug token: si ?debugToken=1, affiche les claims du jeton côté serveur
  try {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('debugToken') === '1') {
      const info = await apiGet('/debug/token');
      alert('Token debug\n' + JSON.stringify(info, null, 2));
    }
  } catch (e) {
    console.warn('Debug token error:', e);
  }
  // Charger les données (mock ou backend selon disponibilité)
  await loadData();
}

function renderTabs() {
  // Activer par défaut l'onglet Registre s'il existe
  const panels = document.querySelectorAll('.tab-panel');
  const btns = document.querySelectorAll('.tab-btn');
  const regPanel = document.getElementById('tab-registre');
  if (panels.length && regPanel) {
    panels.forEach(p => p.classList.remove('active'));
    regPanel.classList.add('active');
  }
  if (btns.length) {
    btns.forEach(b => b.classList.remove('active'));
    const regBtn = document.querySelector('.tab-btn[data-tab="registre"]');
    if (regBtn) regBtn.classList.add('active');
  }
}

function renderFiltersProjects() {
  // Remplir le filtre Registre
  const selReg = document.getElementById('filterRegProjet');
  if (selReg) {
    const currentReg = selReg.value || 'all';
    selReg.innerHTML = '';
    const optAllReg = document.createElement('option');
    optAllReg.value = 'all';
    optAllReg.textContent = 'Tous';
    selReg.appendChild(optAllReg);
    (state.projects || []).forEach(p => {
      const o = document.createElement('option');
      o.value = p.code;
      o.textContent = p.code;
      selReg.appendChild(o);
    });
    // Restaurer la valeur précédente ou défaut à 'all'
    selReg.value = currentReg === '' ? 'all' : currentReg;
  }
  
  // Remplir le filtre Bilan
  const selBilan = document.getElementById('filterBilanProjet');
  if (selBilan) {
    const currentBilan = selBilan.value || 'all';
    selBilan.innerHTML = '';
    const optAllBilan = document.createElement('option');
    optAllBilan.value = 'all';
    optAllBilan.textContent = 'Tous';
    selBilan.appendChild(optAllBilan);
    (state.projects || []).forEach(p => {
      const o = document.createElement('option');
      o.value = p.code;
      o.textContent = p.code;
      selBilan.appendChild(o);
    });
    if (currentBilan) selBilan.value = currentBilan;
  }
}

function renderUserBubble() {
  const initialsEl = document.getElementById('userInitials');
  const bubbleEl = document.getElementById('userBubble');
  if (!initialsEl || !bubbleEl) return;
  
  const u = state.currentUser || {};
  const userName = u.name || u.email || 'Utilisateur';
  
  // Extraire les initiales (max 2 lettres)
  let initials = 'U';
  if (userName) {
    const words = userName.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      initials = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
      initials = words[0].substring(0, 2).toUpperCase();
    }
  }
  
  // Indicateur de mode
  const modeIndicator = USE_MOCK ? ' 🔴' : ' 🟢';
  
  initialsEl.textContent = initials;
  bubbleEl.title = userName + (USE_MOCK ? ' - Mode MOCK (lecture seule)' : ' - Mode BACKEND');
  
  // Ajouter l'indicateur après la bulle
  const container = bubbleEl.parentElement;
  let indicator = container.querySelector('.mode-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'mode-indicator';
    indicator.style.cssText = 'font-size: 12px; margin-left: 4px;';
    container.appendChild(indicator);
  }
  indicator.textContent = modeIndicator;
  indicator.title = USE_MOCK ? 'Mode MOCK - Modifications non sauvegardées' : 'Mode BACKEND - Sauvegardes actives';
}

function updateNotifications() {
  // Stub: rien à faire pour l’instant
}

function hideNotificationDropdown() {
  const dropdown = document.getElementById("notificationDropdown");
  if (dropdown) {
    dropdown.style.display = "none";
  }
}

function showNotificationDropdown() {
  const dropdown = document.getElementById("notificationDropdown");
  if (dropdown) {
    dropdown.style.display = "block";
  }
}

async function apiPost(path, body) {
  if (USE_MOCK) {
    throw new Error('Mode lecture seule (mock)');
  }
  const headers = await getAuthHeaders();
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (res.status === 401) {
    console.warn('Non authentifié, affichage de l\'overlay');
    showLoginOverlay();
    throw new Error('Non authentifié');
  }
  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new Error(`POST ${path} -> ${res.status}${details ? ` | ${details}` : ''}`);
  }
  return res.json();
}

async function apiPut(path, body) {
  if (USE_MOCK) {
    throw new Error('Mode lecture seule (mock)');
  }
  const headers = await getAuthHeaders();
  const res = await fetch(API_BASE + path, {
    method: "PUT",
    headers,
    body: JSON.stringify(body)
  });
  if (res.status === 401) {
    console.warn('Non authentifié, affichage de l\'overlay');
    showLoginOverlay();
    throw new Error('Non authentifié');
  }
  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new Error(`PUT ${path} -> ${res.status}${details ? ` | ${details}` : ''}`);
  }
  return res.json();
}

async function apiDelete(path) {
  if (USE_MOCK) {
    throw new Error('Mode lecture seule (mock)');
  }
  const headers = await getAuthHeaders();
  const res = await fetch(API_BASE + path, { 
    method: "DELETE",
    headers 
  });
  if (res.status === 401) {
    console.warn('Non authentifié, affichage de l\'overlay');
    showLoginOverlay();
    throw new Error('Non authentifié');
  }
  if (!res.ok) {
    const details = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} -> ${res.status}${details ? ` | ${details}` : ''}`);
  }
  return res.json();
}

// === STATE GLOBAL ===================================================
const state = {
  projects: [],
  taxes: [],
  settings: null,
  amendments: [],
  selectedAmendmentProjectId: null,
  claims: [],
  teamMembers: [],
  currentUser: null,

  // Archive
  archiveSelectedClaimId: null,
  archiveFiles: {}, // { [claimId]: [{...file, url:absoluteUrl}] }

  // Audit
  audit: {
    active: false,
    createdAt: null,
    selectedClaimIds: new Set(),
    files: [] // {claimId, name, url, size, uploadedAt}
  }
  ,paymentClaimRows: null
};

async function loadDcrDuplicates() {
  try {
    // Fonction actuellement sans implémentation spécifique
    return;
  } catch (e) {
    console.error("Erreur loadDcrDuplicates", e);
  }
}

function renderTraitement() {
  const container = document.getElementById("paiementClaimContent");
  if (!container) return;

  // Compteur global "claims en cours" (toutes les claims non payées / non annulées)
  try {
    const allClaims = state.claims || [];
    const ongoing = allClaims.filter(
      (c) => c && c.status !== "Payé" && c.status !== "Annulé"
    ).length;
    const headerCounter = document.getElementById("traitementClaimCounter");
    if (headerCounter) {
      headerCounter.textContent = `Claims en cours : ${ongoing}`;
    }
  } catch (e) {
    console.warn("Impossible de calculer le compteur de claims en cours dans l'onglet Traitement", e);
  }

  // État local résilient (évite ReferenceError si le state global n'est pas encore initialisé)
  const pcState =
    paymentClaimState ||
    (window.paymentClaimState = {
	  paymentClaimRows: null,
	  paymentClaimTaxFilter: "all",
	  paymentClaimSearch: "",
	});

  const data = {
    contract: "017mc.W8472-185713",
    claimNo: 162,
    cumulativeWithoutTax: [
      { label: "5% tax claim cumulative W/O tx", value: 82822118.9 },
      { label: "15% tax claim cumulative W/O tx", value: 60110436.66 },
      { label: "14% tax claim cumulative W/O tx", value: 16367155.59 },
      { label: "14% tax claim cumulative W/O tx", value: 6344526.65 }
    ],
    cumulativeTax: [
      { label: "5% tax rate cumulative", value: 6348828.9 },
      { label: "15% tax rate cumulative", value: 3005521.83 },
      { label: "14% tax rate cumulative", value: 2455073.34 },
      { label: "14% tax rate cumulative", value: 888233.73 }
    ],
    totalToDate: 89170947.8,
    rows: [
      { description: "Milestone 3 Payment #1 C-228", claimNumber: 1, amount: 131656.25, taxRate: 0.05, totalToDate: 138239.06 },
      { description: "Milestone 3 Payment #2 C-229", claimNumber: 2, amount: 131656.25, taxRate: 0.05, totalToDate: 138239.06 },
      { description: "Milestone 3 Payment #3 C-230", claimNumber: 3, amount: 131656.25, taxRate: 0.15, taxAmount: 19748.44, totalToDate: 151404.69 },
      { description: "Milestone 3 Payment #4 C-231", claimNumber: 4, amount: 131656.25, taxRate: 0.15, taxAmount: 19748.44, totalToDate: 151404.69 },
      { description: "Total milestone #3", subtotal: true, amount: 526625.0 },
      { description: "Milestone 1 Claim 5 C-228", claimNumber: 5, amount: 439863.61, taxRate: 0.05, taxAmount: 21993.18, totalToDate: 461856.79 },
      { description: "Milestone 1 Claim 6 C-229", claimNumber: 6, amount: 439863.61, taxRate: 0.05, taxAmount: 21993.18, totalToDate: 461856.79 },
      { description: "Milestone 1 Claim 7 C-230", claimNumber: 7, amount: 439863.6, taxRate: 0.15, taxAmount: 65979.54, totalToDate: 505843.14 },
      { description: "Milestone 1 Claim 8 C-231", claimNumber: 8, amount: 439863.6, taxRate: 0.15, taxAmount: 65979.54, totalToDate: 505843.14 },
      { description: "Total milestone #1", subtotal: true, amount: 1759454.42 },
      { description: "Milestone 2 Claim 9  C-228", claimNumber: 9, amount: 879727.21, taxRate: 0.05, taxAmount: 43986.36, totalToDate: 923713.57 },
      { description: "Milestone 2 Claim 10 C-229", claimNumber: 10, amount: 879727.21, taxRate: 0.05, taxAmount: 43986.36, totalToDate: 923713.57 },
      { description: "Milestone 2 Claim 11 C-230", claimNumber: 11, amount: 879727.21, taxRate: 0.15, taxAmount: 131959.08, totalToDate: 1011686.29 },
      { description: "Milestone 2 Claim 12 C-231", claimNumber: 12, amount: 879727.21, taxRate: 0.15, taxAmount: 131959.08, totalToDate: 1011686.29 },
      { description: "Total milestone #2", subtotal: true, amount: 3518908.84 },
      { description: "Milestone 4.a Claim 13 C-228", claimNumber: 13, amount: 36125.12, taxRate: 0.05, taxAmount: 1806.26, totalToDate: 37931.38 },
      { description: "Milestone 4.a Claim 14 C-229", claimNumber: 14, amount: 36125.12, taxRate: 0.05, taxAmount: 1806.26, totalToDate: 37931.38 },
      { description: "Milestone 4.a Claim 15 C-230", claimNumber: 15, amount: 36125.13, taxRate: 0.15, taxAmount: 5418.77, totalToDate: 41543.9 },
      { description: "Milestone 4.a Claim 16 C-231", claimNumber: 16, amount: 36125.13, taxRate: 0.15, taxAmount: 5418.77, totalToDate: 41543.9 },
      { description: "Total milestone #4.a", subtotal: true, amount: 144500.5 },

      // Nouvelle série (claims 17 à 43)
      { description: "Milestone 5.a Claim 17  C-228", claimNumber: 17, amount: 506009.87, taxRate: 0.05, taxAmount: 25300.49, totalToDate: 531310.36 },
      { description: "Milestone 5.a Claim 18  C-229", claimNumber: 18, amount: 506009.87, taxRate: 0.05, taxAmount: 25300.49, totalToDate: 531310.36 },
      { description: "Milestone 5.a Claim 19  C-230", claimNumber: 19, amount: 506009.87, taxRate: 0.15, taxAmount: 75901.48, totalToDate: 581911.35 },
      { description: "Milestone 5.a Claim 20  C-231", claimNumber: 20, amount: 506009.87, taxRate: 0.15, taxAmount: 75901.48, totalToDate: 581911.35 },
      { description: "Total milestone #5.a", subtotal: true, amount: 2024039.48 },

      { description: "Milestone 6.a Claim 21  C-228", claimNumber: 21, amount: 442084.25, taxRate: 0.05, taxAmount: 22104.21, totalToDate: 464188.46 },
      { description: "Milestone 6.a Claim 22  C-229", claimNumber: 22, amount: 442084.25, taxRate: 0.05, taxAmount: 22104.21, totalToDate: 464188.46 },
      { description: "Milestone 6.a Claim 23  C-230", claimNumber: 23, amount: 442084.25, taxRate: 0.15, taxAmount: 66312.64, totalToDate: 508396.89 },
      { description: "Milestone 6.a Claim 24  C-231", claimNumber: 24, amount: 442084.25, taxRate: 0.15, taxAmount: 66312.64, totalToDate: 508396.89 },
      { description: "Total milestone #6.a", subtotal: true, amount: 1768337.0 },

      { description: "Milestone 12.a Claim 25  C-228", claimNumber: 25, amount: 87990.0, taxRate: 0.05, taxAmount: 4399.5, totalToDate: 92389.5 },
      { description: "Milestone 12.a Claim 26  C-229", claimNumber: 26, amount: 87990.0, taxRate: 0.05, taxAmount: 4399.5, totalToDate: 92389.5 },
      { description: "Milestone 12.a Claim 27  C-230", claimNumber: 27, amount: 87990.0, taxRate: 0.15, taxAmount: 13198.5, totalToDate: 101188.5 },
      { description: "Milestone 12.a Claim 28  C-231", claimNumber: 28, amount: 87990.0, taxRate: 0.15, taxAmount: 13198.5, totalToDate: 101188.5 },
      { description: "Total milestone #12.a", subtotal: true, amount: 351960.0 },

      { description: "Milestone 14.a Claim 29  C-228", claimNumber: 29, amount: 3429.0, taxRate: 0.05, taxAmount: 171.45, totalToDate: 3600.45 },
      { description: "Milestone 14.a Claim 30  C-229", claimNumber: 30, amount: 3429.0, taxRate: 0.05, taxAmount: 171.45, totalToDate: 3600.45 },
      { description: "Milestone 14.a Claim 31  C-230", claimNumber: 31, amount: 3429.0, taxRate: 0.15, taxAmount: 514.35, totalToDate: 3943.35 },
      { description: "Milestone 14.a Claim 32  C-231", claimNumber: 32, amount: 3429.0, taxRate: 0.15, taxAmount: 514.35, totalToDate: 3943.35 },
      { description: "Total milestone #14.a", subtotal: true, amount: 13716.0 },

      { description: "Milestone 4.b Claim 33  C-228", claimNumber: 33, amount: 2603056.5, taxRate: 0.05, taxAmount: 130152.83, totalToDate: 2733209.33 },
      { description: "Milestone 4.b Claim 34  C-229", claimNumber: 34, amount: 2603056.5, taxRate: 0.05, taxAmount: 130152.83, totalToDate: 2733209.33 },
      { description: "Milestone 4.b Claim 35  C-230", claimNumber: 35, amount: 2603056.5, taxRate: 0.15, taxAmount: 390458.48, totalToDate: 2993514.98 },
      { description: "Milestone 4.b Claim 36  C-231", claimNumber: 36, amount: 2603056.5, taxRate: 0.15, taxAmount: 390458.48, totalToDate: 2993514.98 },
      { description: "Total milestone #4.b", subtotal: true, amount: 10412226.0 },

      { description: "Milestone 5.b Claim 37  C-228", claimNumber: 37, amount: 1253444.55, taxRate: 0.05, taxAmount: 62672.23, totalToDate: 1316116.78 },
      { description: "Total milestone #5.b", subtotal: true, amount: 1253444.55 },

      { description: "DCR-001-ENG  - Exterior Watertight Power Receptacles", claimNumber: 38, amount: 2660.0, taxRate: 0.05, taxAmount: 133.0, totalToDate: 2793.0 },
      { description: "DCR-016-ENG  - Deck Crane Upgrade", claimNumber: 38, amount: 18900.0, taxRate: 0.05, taxAmount: 945.0, totalToDate: 19845.0 },
      { description: "DCR-025-ENG  - Power Lashing to Submarines", claimNumber: 38, amount: 18400.0, taxRate: 0.05, taxAmount: 920.0, totalToDate: 19320.0 },
      { description: "DCR-027-ENG  - Grey Water Treatment Capability", claimNumber: 38, amount: 14770.0, taxRate: 0.05, taxAmount: 738.5, totalToDate: 15508.5 },
      { description: "Total DCR Claim 38", subtotal: true, amount: 54730.0 },

      { description: "DCR 017-ENG EARLY ORDER OF MATERIAL ASSESSMENT", claimNumber: 39, amount: 68180.0, taxRate: 0.05, taxAmount: 3409.0, totalToDate: 71589.0 },
      { description: "Total DCR Claim 39", subtotal: true, amount: 68180.0 },

      { description: "DCR-004-ENG - Upgrade of 5 skyport to heated skyport", claimNumber: 40, amount: 22400.0, taxRate: 0.05, taxAmount: 1120.0, totalToDate: 23520.0 },
      { description: "Total DCR Claim 40", subtotal: true, amount: 22400.0 },

      { description: "DCR-006-ENG Tie-Downs on Aft Deck", claimNumber: 41, amount: 9100.0, taxRate: 0.05, taxAmount: 455.0, totalToDate: 9555.0 },
      { description: "Total DCR Claim 41", subtotal: true, amount: 9100.0 },

      { description: "DCR-008-Pyrotechnics Locker", claimNumber: 42, amount: 15600.0, taxRate: 0.05, taxAmount: 780.0, totalToDate: 16380.0 },
      { description: "Total DCR Claim 42", subtotal: true, amount: 15600.0 },

      { description: "DCR-011-ENG  - Connecting to Shore Power", claimNumber: 43, amount: 27300.0, taxRate: 0.05, taxAmount: 1365.0, totalToDate: 28665.0 },
      { description: "Total DCR Claim 43", subtotal: true, amount: 27300.0 },

      { description: "DCR-013-ENG  - Connecting to Shore Power", claimNumber: 44, amount: 7000.0, taxRate: 0.05, taxAmount: 350.0, totalToDate: 7350.0 },
      { description: "Total DCR Claim 44", subtotal: true, amount: 7000.0 },

      { description: "DCR-014-ENG  - Storage Cabinets in Z Drive", claimNumber: 45, amount: 5180.0, taxRate: 0.05, taxAmount: 259.0, totalToDate: 5439.0 },
      { description: "Total DCR Claim 45", subtotal: true, amount: 5180.0 },

      { description: "DCR-015-ENG  - Exterior Superstructure Light Fixtures", claimNumber: 46, amount: 3640.0, taxRate: 0.05, taxAmount: 182.0, totalToDate: 3822.0 },
      { description: "Total DCR Claim 46", subtotal: true, amount: 3640.0 },

      { description: "Milestone 6.b.1 Claim 47", claimNumber: 47, amount: 877506.57, taxRate: 0.05, taxAmount: 43875.33, totalToDate: 921381.9 },
      { description: "Total Milestone 6.b.1 Claim 47", subtotal: true, amount: 877506.57 },

      { description: "DCR-007-ENG - Addition of storage locker for NERT", claimNumber: 48, amount: 15400.0, taxRate: 0.05, taxAmount: 770.0, totalToDate: 16170.0 },
      { description: "Total DCR Claim 48", subtotal: true, amount: 15400.0 },

      { description: "Milestone 5.b.1", claimNumber: 49, amount: 1253444.55, taxRate: 0.05, taxAmount: 62672.23, totalToDate: 1316116.78 },
      { description: "Total Claim 49 Milestone 5.b.1", subtotal: true, amount: 1253444.55 },

      { description: "Milestone 7.1", claimNumber: 50, amount: 2199318.03, taxRate: 0.05, taxAmount: 109965.9, totalToDate: 2309283.93 },
      { description: "Total Claim 50 Milestone 7.1", subtotal: true, amount: 2199318.03 },

      { description: "DCR-019 COVID-19 Health and Safety Measures Nov 2020-March 2021", claimNumber: 51, amount: 125500.66, taxRate: 0.05, taxAmount: 6275.03, totalToDate: 131775.69 },
      { description: "DCR-019 COVID-19 Health and Safety Measures April 2021-February 2022", claimNumber: 51, amount: 400027.11, taxRate: 0.05, taxAmount: 20001.36, totalToDate: 420028.47 },
      { description: "Total Claim 51 DCR-019 Health and Safety Measures Nov 2020 - February 2022", subtotal: true, amount: 525527.77 },

      { description: "DCR-019 COVID-19 Health and Safety Measures March 2022", claimNumber: 52, amount: 61287.17, taxRate: 0.05, taxAmount: 3064.36, totalToDate: 64351.53 },
      { description: "Total Claim 52 DCR-019 COVID-19 Health and Safety Measures March 2022", subtotal: true, amount: 61287.17 },

      { description: "DCR-019 COVID-19 Health and Safety Measures April 2022", claimNumber: 53, amount: 74652.2, taxRate: 0.05, taxAmount: 3732.61, totalToDate: 78384.81 },
      { description: "Total Claim 53 DCR-019 COVID-19 Health and Safety Measures April 2022", subtotal: true, amount: 74652.2 },

      { description: "DCR-017-229 Early order of Material", claimNumber: 54, amount: 134333.66, taxRate: 0.05, taxAmount: 6716.68, totalToDate: 141050.34 },
      { description: "DCR-017-229 Early order of Material", claimNumber: 54, amount: 149958.42, taxRate: 0.05, taxAmount: 7497.92, totalToDate: 157456.34 },
      { description: "Total Claim 54 DCR-017 Early order of material", subtotal: true, amount: 284292.08 },

      { description: "DCR-006-228 Tie-down aft deck", claimNumber: 55, amount: 54970.0, taxRate: 0.05, taxAmount: 2748.5, totalToDate: 57718.5 },
      { description: "DCR-006-229 Tie-down aft deck", claimNumber: 55, amount: 49773.0, taxRate: 0.05, taxAmount: 2488.65, totalToDate: 52261.65 },
      { description: "Total Claim 55 DCR-006 Tie-down aft deck", subtotal: true, amount: 104743.0 },

      { description: "DCR-019 COVID-19 Health and Safety Measures May 2022", claimNumber: 56, amount: 57320.63, taxRate: 0.05, taxAmount: 2866.03, totalToDate: 60186.66 },
      { description: "Total Claim 56 DCR-019 COVID-19 Health and Safety Measures May 2022", subtotal: true, amount: 57320.63 },

      { description: "Milestone 6.2.b", claimNumber: 57, amount: 877506.57, taxRate: 0.05, taxAmount: 43875.33, totalToDate: 921381.9 },
      { description: "Total Claim 57 Milestone 6.2.b", subtotal: true, amount: 877506.57 },

      { description: "DCR-025-C-228 Power Lashing to Submarines", claimNumber: 58, amount: 103501.66, taxRate: 0.05, taxAmount: 5175.08, totalToDate: 108676.74 },
      { description: "DCR-025-C-229 Power Lashing to Submarines", claimNumber: 58, amount: 95998.34, taxRate: 0.05, taxAmount: 4799.92, totalToDate: 100798.26 },
      { description: "Total Claim 58 DCR-025 Power Lashing to submarines C-228 C-229", subtotal: true, amount: 199500.0 },

      { description: "Milestone 8.2.a Prime Movers installed and accepted by Canada-C-229", claimNumber: 59, amount: 879727.21, taxRate: 0.05, taxAmount: 43986.36, totalToDate: 923713.57 },
      { description: "Total Claim 59 Milestone 8.2.a Prime Movers installed and accepted", subtotal: true, amount: 879727.21 },

      { description: "NOT ACCEPTED DCR-001 C-228 Watertight Power Receptacles", claimNumber: 60 },
      { description: "NOT ACCEPTED DCR-001 C-229 Watertight Power Receptacles", claimNumber: 60 },
      { description: "Total Claim 60 DCR-001 Watertight Power Receptacles", subtotal: true },

      { description: "Milestone 8.2.a Prime Movers installed and accepted by Canada C-228", claimNumber: 61, amount: 879727.21, taxRate: 0.05, taxAmount: 43986.36, totalToDate: 923713.57 },
      { description: "Total Claim 61 Milestone 8.2.a Prime Movers installed and accepted", subtotal: true, amount: 879727.21 },

      { description: "DCR-004 Heated skyports C-228", claimNumber: 62, amount: 14157.0, taxRate: 0.05, taxAmount: 707.85, totalToDate: 14864.85 },
      { description: "DCR-004 Heated skyports C-229", claimNumber: 62, amount: 13728.0, taxRate: 0.05, taxAmount: 686.4, totalToDate: 14414.4 },
      { description: "Total Claim 62 DCR-004 Heated skyports", subtotal: true, amount: 27885.0 },

      { description: "NOT ACCEPTED DCR-011 Connecting to Shore Power C-228", claimNumber: 63 },
      { description: "NOT ACCEPTED DCR-011 Connecting to Shore Power C-229", claimNumber: 63 },
      { description: "Total Claim 63 DCR-011 Connecting to Shore Power C-228, C-229", subtotal: true },

      { description: "DCR-009 ENG", claimNumber: 64, amount: 27853.2, taxRate: 0.05, taxAmount: 1392.66, totalToDate: 29245.86 },
      { description: "DCR-009 Space Heaters C-228", claimNumber: 64, amount: 97627.6, taxRate: 0.05, taxAmount: 4881.38, totalToDate: 102508.98 },
      { description: "Total Claim 64 DCR-009 ENG and Space Heaters", subtotal: true, amount: 125480.8 },

      { description: "NOT ACCEPTED DCR-015-Exterior Superstructure Light Fixtures", claimNumber: 65 },
      { description: "Total Claim 65 DCR-015-Exterior Superstructure Light Fixtures", subtotal: true },

      { description: "DCR-027-Grey Water Treatment C-228", claimNumber: 66, amount: 44676.18, taxRate: 0.05, taxAmount: 2233.81, totalToDate: 46909.99 },
      { description: "Total Claim 66 DCR-027 Grey Water Treatment", subtotal: true, amount: 44676.18 },

      { description: "DCR-020 COVID-19 Subcontractor Cost Assistance - January - March 2022", claimNumber: 67, amount: 977272.16, taxRate: 0.05, taxAmount: 48863.61, totalToDate: 1026135.77 },
      { description: "Total Claim 67 DCR-020 COVID-19 Subcontractor Cost Assistance", subtotal: true, amount: 977272.16 },

      { description: "Milestone #7.2b/Hull, deck and wheelhouse enclosed and accepted by Canada", claimNumber: 68, amount: 2199318.03, taxRate: 0.05, taxAmount: 109965.9, totalToDate: 2309283.93 },
      { description: "Total Claim 68 Milestone #7.2b/Hull, deck and wheelhouse enclosed and accepted by Canada", subtotal: true, amount: 2199318.03 },

      { description: "NOT ACCEPTED DCR-020 COVID-19 Subcontractor Cost Assistance - April, May, June 2022", claimNumber: 69 },
      { description: "Total Claim 69 DCR-020 Subcontractor Cost Assistance", subtotal: true },

      { description: "Milestone #8,1 Prime Movers Alignment", claimNumber: 70, amount: 1319590.82, taxRate: 0.05, taxAmount: 65979.59, totalToDate: 1385570.36 },
      { description: "Total Claim 70 Milestone #8,1 Prime Movers Alignment", subtotal: true, amount: 1319590.82 },

      { description: "Milestone # 16 a Completion Aboriginal Report C-228, C-229", claimNumber: 71, amount: 219931.8, taxRate: 0.05, taxAmount: 10996.59, totalToDate: 230928.39 },
      { description: "Milestone # 16 a Completion Aboriginal Report C-228, C-229", claimNumber: 71, amount: 219931.8, taxRate: 0.15, taxAmount: 32989.77, totalToDate: 252921.57 },
      { description: "Total Claim 71 Milestone # 16 a Completion Aboriginal Report", subtotal: true, amount: 439863.6 },

      { description: "Milestone # 5.3 b Delivery of Propulsion Machinery by ship set to shipyard", claimNumber: 72, amount: 1253444.55, taxRate: 0.15, taxAmount: 188016.68, totalToDate: 1441461.23 },
      { description: "Total Claim 72 Milestone # 5.3 b Delivery Propulsion Machinery", subtotal: true, amount: 1253444.55 },

      { description: "DCR-020 COVID-19 Subcontractor Cost Assistance - April, May, June 2022", claimNumber: 73, amount: 1492798.45, taxRate: 0.05, taxAmount: 74639.92, totalToDate: 1567438.37 },
      { description: "Total Claim 73 DCR-020 Subcontractor Cost Assistance", subtotal: true, amount: 1492798.45 },

      { description: "Milestone #6.3, b Delivery of Electrical Equipment", claimNumber: 74, amount: 877506.57, taxRate: 0.15, taxAmount: 131625.99, totalToDate: 1009132.56 },
      { description: "Total Claim 74 Milestone #6.3.b Delivery of Electrical Equipment", subtotal: true, amount: 877506.57 },

      { description: "DCR-020 COVID19 Subcontractor cost assistance July 2022", claimNumber: 75, amount: 485299.91, taxRate: 0.05, taxAmount: 24265.0, totalToDate: 509564.91 },
      { description: "Total Claim 75 DCR-020 COVID19 Subcontractor cost assistance July 2022", subtotal: true, amount: 485299.91 },

      { description: "DCR-020 COVID19 Subcontractor cost assistance August 2022", claimNumber: 76, amount: 550343.25, taxRate: 0.05, taxAmount: 27517.16, totalToDate: 577860.41 },
      { description: "Total Claim 76 DCR-020 COVID19 Subcontractor cost assistance August 2022", subtotal: true, amount: 550343.25 },

      { description: "Claim Milestone 5.4,b Delivery of propulsion machinery", claimNumber: 77, amount: 1253444.55, taxRate: 0.15, taxAmount: 188016.68, totalToDate: 1441461.23 },
      { description: "Total Claim 77 Milestone 5.4,b Delivery of propulsion machinery", subtotal: true, amount: 1253444.55 },

      { description: "Claim Milestone 6.4b Delivery of Electrical Equipment Package", claimNumber: 78, amount: 877506.57, taxRate: 0.15, taxAmount: 131625.99, totalToDate: 1009132.56 },
      { description: "Total Claim 78 Milestone 6.4b Delivery of Electrical Equipment Package", subtotal: true, amount: 877506.57 },

      { description: "Milestone # 16.b Completion Aboriginal Report C-228, C-229", claimNumber: 79, amount: 219931.8, taxRate: 0.05, taxAmount: 10996.59, totalToDate: 230928.39 },
      { description: "Milestone # 16.b Completion Aboriginal Report C-230, C-231", claimNumber: 79, amount: 219931.8, taxRate: 0.15, taxAmount: 32989.77, totalToDate: 252921.57 },
      { description: "Total Claim 79 Milestone # 16.b Completion Aboriginal Report", subtotal: true, amount: 439863.6 },

      { description: "Milestone 10.1 C-228 CVM Template", claimNumber: 80, amount: 109965.9, taxRate: 0.05, taxAmount: 5498.3, totalToDate: 115464.2 },
      { description: "Milestone 10.1 C-229 CVM Template", claimNumber: 80, amount: 109965.9, taxRate: 0.05, taxAmount: 5498.3, totalToDate: 115464.2 },
      { description: "Milestone 10.1 C-230 CVM Template", claimNumber: 80, amount: 109965.9, taxRate: 0.15, taxAmount: 16494.89, totalToDate: 126460.79 },
      { description: "Milestone 10.1 C-231 CVM Template", claimNumber: 80, amount: 109965.9, taxRate: 0.15, taxAmount: 16494.89, totalToDate: 126460.79 },
      { description: "Total Claim 80 Milestone 10.1_10.4", subtotal: true, amount: 439863.6 },

      { description: "Milestone 13.1 ILS documents (Draft) received and accepted (NLT1 and NLT2)", claimNumber: 81, amount: 131959.08, taxRate: 0.05, taxAmount: 6597.95, totalToDate: 138557.03 },
      { description: "Milestone 13.1 ILS documents (Draft) received and accepted (NLT3 and NLT4)", claimNumber: 81, amount: 131959.08, taxRate: 0.15, taxAmount: 19793.86, totalToDate: 151752.94 },
      { description: "Total Claim 81 Milestone 13.1", subtotal: true, amount: 263918.16 },

      { description: "DCR-001-081 Exterior Watertight Power Receptacles NLT 1", claimNumber: 82, amount: 16163.1, taxRate: 0.05, taxAmount: 808.18, totalToDate: 16971.28 },
      { description: "Total Claim 82 DCR-001 Exterior Watertight Power Receptacles", subtotal: true, amount: 16163.1 },

      { description: "DCR-014-Laundry Equipment NLT 1", claimNumber: 83, amount: 18767.5, taxRate: 0.05, taxAmount: 938.38, totalToDate: 19705.88 },
      { description: "Total Claim 83-Laundry Equipment", subtotal: true, amount: 18767.5 },

      { description: "DCR-015-Exterior Superstructure Light Fixtures NLT 1", claimNumber: 84, amount: 12310.0, taxRate: 0.05, taxAmount: 615.5, totalToDate: 12925.5 },
      { description: "Total Claim 84 DCR-015 Exterior Superstructure Light Fixtures NLT 1", subtotal: true, amount: 12310.0 },

      { description: "DCR-016 C228- Deck Crane Upgrade", claimNumber: 85, amount: 28280.32, taxRate: 0.05, taxAmount: 1414.02, totalToDate: 29694.34 },
      { description: "Total Claim 85 C228-Deck Crane Upgrade", subtotal: true, amount: 28280.32 },

      { description: "Milestone #8,2,b1 Prime Movers Alignment", claimNumber: 86, amount: 527836.33, taxRate: 0.05, taxAmount: 26391.82, totalToDate: 554228.15 },
      { description: "Total Claim 86 Milestone #8,2,b1 Prime Movers Alignment", subtotal: true, amount: 527836.33 },

      { description: "DCR-008 C-228- Floodable Pyrotechnics Locker", claimNumber: 87, amount: 57764.0, taxRate: 0.05, taxAmount: 2888.2, totalToDate: 60652.2 },
      { description: "Total Claim 87 DCR-008 C-228- Floodable Pyrotechnics Locker", subtotal: true, amount: 57764.0 },

      { description: "DCR-011 C-228 Connecting to Shore Power", claimNumber: 88, amount: 15778.3, taxRate: 0.05, taxAmount: 788.92, totalToDate: 16567.22 },
      { description: "Total Claim 88 DCR-011 C-229 Connecting to shore power", subtotal: true, amount: 15778.3 },

      { description: "DCR-011 C-229 Connecting to Shore Power", claimNumber: 89, amount: 13698.2, taxRate: 0.05, taxAmount: 684.91, totalToDate: 14383.11 },
      { description: "Total Claim 89 DCR-011 C-229 Connecting to shore power", subtotal: true, amount: 13698.2 },

      { description: "DCR-008 C-229- Floodable Pyrotechnics Locker", claimNumber: 90, amount: 46377.2, taxRate: 0.05, taxAmount: 2318.86, totalToDate: 48696.06 },
      { description: "Total Claim 90 DCR-008 C-229- Floodable Pyrotechnics Locker", subtotal: true, amount: 46377.2 },

      { description: "DCR-013 C-228 Storage Cabinets Z-Drive", claimNumber: 91, amount: 8835.5, taxRate: 0.05, taxAmount: 441.78, totalToDate: 9277.28 },
      { description: "Total Claim 91 DCR-013 C-228 Storage Cabinets Z-Drive", subtotal: true, amount: 8835.5 },

      { description: "DCR-009-C229-Addition of Eight (8) Space Heaters", claimNumber: 92, amount: 89214.4, taxRate: 0.05, taxAmount: 4460.72, totalToDate: 93675.12 },
      { description: "Total Claim 92 DCR-009-C229-Addition of Eight (8) Space Heaters", subtotal: true, amount: 89214.4 },

      { description: "DCR-007-C228-Addition storage locker for NERT in FWD Store", claimNumber: 93, amount: 27079.0, taxRate: 0.05, taxAmount: 1353.95, totalToDate: 28432.95 },
      { description: "Total Claim 93 DCR-007-C228-Addition storage locker for NERT in FWD Store", subtotal: true, amount: 27079.0 },

      { description: "DCR-007-C229-Addition storage locker for NERT in FWD Store", claimNumber: 94, amount: 22789.8, taxRate: 0.05, taxAmount: 1139.49, totalToDate: 23929.29 },
      { description: "Total Claim 94 DCR-007-C229-Addition storage locker for NERT in FWD Store", subtotal: true, amount: 22789.8 },

      { description: "DCR-001-C229-Add exterior watertight power receptacles", claimNumber: 95, amount: 15973.05, taxRate: 0.05, taxAmount: 798.65, totalToDate: 16771.7 },
      { description: "Total Claim 95 DCR-001-C229-Add exterior watertight power receptacles", subtotal: true, amount: 15973.05 },

      { description: "DCR-013-C229-Add 2 storage cabinets in Z-Drive cabinets", claimNumber: 96, amount: 8042.0, taxRate: 0.05, taxAmount: 402.1, totalToDate: 8444.1 },
      { description: "Total Claim 96 DCR-013-Add 2 storage cabinets in Z-Drive cabinets", subtotal: true, amount: 8042.0 },

      { description: "DCR-015 C-229 Exterior Superstructure Light Fixtures", claimNumber: 97, amount: 11202.0, taxRate: 0.05, taxAmount: 560.1, totalToDate: 11762.1 },
      { description: "Total Claim 97 C-229 Exterior Superstructure Light Fixtures", subtotal: true, amount: 11202.0 },

      { description: "DCR-014 C-229 Add laundry equipment in accomodation space", claimNumber: 98, amount: 16841.5, taxRate: 0.05, taxAmount: 842.08, totalToDate: 17683.58 },
      { description: "Total Claim 98 DCR-014 C-229 Add laundry equipment in accomodation space", subtotal: true, amount: 16841.5 },

      { description: "Claim 99 DCR-016 C-229 Addition of a second winch on the deck crane", claimNumber: 99, amount: 26791.12, taxRate: 0.05, taxAmount: 1339.56, totalToDate: 28130.68 },
      { description: "Total Claim 99 DCR-016 Addition of a second winch on the deck crane", subtotal: true, amount: 26791.12 },

      { description: "Claim 100 DCR-027 C-229 Grey Water Treatment", claimNumber: 100, amount: 40360.13, taxRate: 0.05, taxAmount: 2018.01, totalToDate: 42378.14 },
      { description: "Total Claim 100 DCR-027 C-229 Grey Water Treatment", subtotal: true, amount: 40360.13 },

      { description: "Claim 101 Test and Trials Program Complete and Accepted by Canada C-228", claimNumber: 101, amount: 164948.85, taxRate: 0.05, taxAmount: 8247.44, totalToDate: 173196.29 },
      { description: "Claim 101 Test and Trials Program Complete and Accepted by Canada C-229", claimNumber: 101, amount: 164948.85, taxRate: 0.05, taxAmount: 8247.44, totalToDate: 173196.29 },
      { description: "Total Claim 101 Tests ans Trials Program Complete and Accepted by Canada", subtotal: true, amount: 329897.7 },

      { description: "Claim 102 Test and Trials Program Complete and Accepted by Canada C-230", claimNumber: 102, amount: 164948.85, taxRate: 0.15, taxAmount: 24742.33, totalToDate: 189691.18 },
      { description: "Claim 102 Test and Trials Program Complete and Accepted by Canada C-231", claimNumber: 102, amount: 164948.85, taxRate: 0.15, taxAmount: 24742.33, totalToDate: 189691.18 },
      { description: "Total Claim 102 Tests ans Trials Program Complete and Accepted by Canada", subtotal: true, amount: 329897.7 },

      { description: "Claim 103 DCR-023 TDP Partitioning", claimNumber: 103, amount: 4620.9, taxRate: 0.05, taxAmount: 231.05, totalToDate: 4851.95 },
      { description: "Total Claim 103 DCR-023 TDP Partitioning", subtotal: true, amount: 4620.9 },

      { description: "Claim 104 Milestone 8.2b Final alignment complete and accepted by Canada", claimNumber: 104, amount: 791754.49, taxRate: 0.05, taxAmount: 39587.72, totalToDate: 831342.21 },
      { description: "Total Claim 104 Milestone 8.2b Final alignment complete and accepted by Canada", subtotal: true, amount: 791754.49 },

      { description: "Claim 105 Milestone 12.b1 RSPL complete and accepted by Canada", claimNumber: 105, amount: 70374.73, taxRate: 0.05, taxAmount: 3518.74, totalToDate: 73993.47 },
      { description: "Total Claim 105 Milestone 12.b1 RSPL complete and accepted by Canada", subtotal: true, amount: 70374.73 },

      { description: "Claim 106 Milestone 10.b1 Upon Provisional Acceptance Certification signed by Canada", claimNumber: 106, amount: 494846.55, taxRate: 0.05, taxAmount: 24742.33, totalToDate: 519588.88 },
      { description: "Total Claim 106 Milestone 10.b1 Upon Provisional Acceptance Certification signed by Canada", subtotal: true, amount: 494846.55 },

      { description: "Claim 107 Milestone 9.1d Trials Reports Submitted and Accepted by Canada", claimNumber: 107, amount: 659795.41, taxRate: 0.05, taxAmount: 32989.77, totalToDate: 692785.18 },
      { description: "Total Claim 107 Milestone 9.1d Trials Reports Submitted and Accepted by Canada", subtotal: true, amount: 659795.41 },

      { description: "Claim 108 Milestone 12.2b1 RSPL Complete and Accepted by Canada", claimNumber: 108, amount: 70374.73, taxRate: 0.05, taxAmount: 3518.74, totalToDate: 73893.47 },
      { description: "Total Claim 108 Milestone 12.2b1 RSPL Complete and Accepted by Canada", subtotal: true, amount: 70374.73 },

      { description: "Claim 109 Milestone 10.2b1 Provisional Acceptance 50%", claimNumber: 109, amount: 494846.55, taxRate: 0.05, taxAmount: 24742.33, totalToDate: 519588.88 },
      { description: "Total Claim 109 Milestone 10.2b1 Provisional Acceptance 50%", subtotal: true, amount: 494846.55 },

      { description: "Claim 110 Milestone 9.1c Trials Conduct Complete and Accepted by CAN", claimNumber: 110, amount: 1484539.67, taxRate: 0.05, taxAmount: 74226.98, totalToDate: 1558766.65 },
      { description: "Total Claim 110 Milestone 9.1c Trials Conduct Complete and Accepted by CAN", subtotal: true, amount: 1484539.67 },

      { description: "Claim 111 Milestone 9.2c Trials Conduct Complete and Accepted by CAN", claimNumber: 111, amount: 1484539.67, taxRate: 0.05, taxAmount: 74226.98, totalToDate: 1558766.65 },
      { description: "Claim 111 Milestone 9.2c Trials Conduct Complete and Accepted by CAN", claimNumber: 111, amount: 659795.41, taxRate: 0.05, taxAmount: 32989.77, totalToDate: 692785.18 },
      { description: "Total Claim 111 Milestone 9.2c Trials Conduct Complete and Accepted by CAN", subtotal: true, amount: 1484539.67 },

      { description: "Claim 112 Milestone 9.2d Trials Reports Submitted and accepted by CAN", claimNumber: 112, amount: 659795.41, taxRate: 0.05, taxAmount: 32989.77, totalToDate: 692785.18 },
      { description: "Total Claim 112 Milestone 9.2d Trials Reports Submitted and accepted by CAN", subtotal: true, amount: 659795.41 },

      { description: "Claim 113 Milestone 14.b1 Training Plan including course manuals complete and accepted by CAN", claimNumber: 113, amount: 196909.92, taxRate: 0.05, taxAmount: 9845.5, totalToDate: 206755.42 },
      { description: "Claim 113 Milestone 14.b1, 14.2b1 Training Plan including course manuals complete and accepted by CAN", claimNumber: 113, amount: 196909.92, taxRate: 0.05, taxAmount: 9845.5, totalToDate: 206755.42 },
      { description: "Total Claim 113 Milestone 14.b1 Training Plan", subtotal: true, amount: 196909.92 },

      { description: "Claim 114 Milestone 14.3b1 Training Plan including course manuals complete and accepted by CAN", claimNumber: 114, amount: 196909.92, taxRate: 0.15, taxAmount: 29536.49, totalToDate: 226446.41 },
      { description: "Claim 114 Milestone 14.4b1 Training Plan including course manuals complete and accepted by CAN", claimNumber: 114, amount: 196909.92, taxRate: 0.15, taxAmount: 29536.49, totalToDate: 226446.41 },
      { description: "Claim 114 Milestone 14.b3.1_14.4b1 Training Plan including course manuals complete and accepted by CAN", claimNumber: 114, amount: 393819.84, taxRate: 0.05, taxAmount: 19690.99, totalToDate: 413510.83 },
      { description: "Total Claim 114 Milestone 14.b3.1_14.4b1 Training Plan", subtotal: true, amount: 393819.84 },

      { description: "Claim 115 Milestone 12.1b2, 12.2b2 Spares verified by Canada at shipyard before shipping", claimNumber: 115, amount: 251498.88, taxRate: 0.05, taxAmount: 12574.94, totalToDate: 264073.82 },
      { description: "Total Claim 115 Milestone 12.1b2, 12.2b2 Spares verified by Canada at shipyard before shipping", subtotal: true, amount: 251498.88 },

      { description: "Claim 116 Milestone 10.1b2 Delivery of all ILS Products & Documents reviewed and accepted by Canada", claimNumber: 116, amount: 494846.55, taxRate: 0.05, taxAmount: 24742.33, totalToDate: 519588.89 },
      { description: "Total Claim 116 Milestone 10.1b2 Delivery of all ILS Products & Documents reviewed and accepted by Canada", subtotal: true, amount: 494846.55 },

      { description: "Claim 117 Milestone 10.2b Provisional Acceptance NLT2 complete and accepted by Canada 2of2", claimNumber: 117, amount: 494846.55, taxRate: 0.05, taxAmount: 24742.33, totalToDate: 519588.88 },
      { description: "Total Claim 117 Milestone 10.2b Provisional Acceptance NLT2 complete and accepted by Canada", subtotal: true, amount: 494846.55 },

      { description: "C-228 Milestone 14.2b Training Completed and accepted by Canada", claimNumber: 118, amount: 459456.49, taxRate: 0.05, taxAmount: 22972.82, totalToDate: 482429.31 },
      { description: "C-229 Milestone 14.2b Training Completed and accepted by Canada", claimNumber: 118, amount: 459456.49, taxRate: 0.05, taxAmount: 22972.82, totalToDate: 482429.31 },
      { description: "Claim 118 14.b12.1a/b2 Training Completed and accepted", claimNumber: 118, amount: 918912.98, taxRate: 0.05, taxAmount: 45945.65, totalToDate: 964858.63 },
      { description: "Total Claim 118 14.2b Training Completed and accepted", subtotal: true, amount: 918912.98 },

      { description: "C-228 Milestone 9.1e Trials Complete and accepted by Canada", claimNumber: 119, amount: 659795.41, taxRate: 0.05, taxAmount: 32989.77, totalToDate: 692785.18 },
      { description: "C-229 Milestone 9.2e Trials Complete and accepted by Canada", claimNumber: 119, amount: 659795.41, taxRate: 0.05, taxAmount: 32989.77, totalToDate: 692785.18 },
      { description: "C-229 Milestone 9.1e - 9.2e Trials complete and accepted by Canada", claimNumber: 119, amount: 1319590.82, taxRate: 0.05, taxAmount: 65979.54, totalToDate: 1385570.36 },
      { description: "Total Claim 119 Trials complete and accepted", subtotal: true, amount: 2639182.05 },

      { description: "C-228 Milestone 11.1 Delivery and Final Acceptance of vessels complete at respective CFR bases (Holdback à facturer)", claimNumber: 120, amount: 3194980.92, taxRate: 0.05, taxAmount: 159749.05, totalToDate: 3354729.97 },
      { description: "C-229 Milestone 11.2 Delivery and Final Acceptance of vessels complete at respective CFR bases (Holdback à facturer)", claimNumber: 120, amount: 3148000.91, taxRate: 0.05, taxAmount: 157400.05, totalToDate: 3305400.96 },
      { description: "Total Claim 120 Delivery and Final Acceptance of vessels", subtotal: true, amount: 6342981.83 },

      { description: "C-228 Milestone 17 EPA Adjustment", claimNumber: 121, amount: 2000000.0, taxRate: 0.05, taxAmount: 100000.0, totalToDate: 2100000.0 },
      { description: "C-229 Milestone 17 EPA Adjustment", claimNumber: 121, amount: 2000000.0, taxRate: 0.05, taxAmount: 100000.0, totalToDate: 2100000.0 },
      { description: "Total Claim 121 Milestone 17 EPA Adjustment", subtotal: true, amount: 4000000.0 },

      { description: "Claim 122 C-228 Milestone11 Data Packaging tests delivered and accepted by Canada", claimNumber: 122, amount: 593815.87, taxRate: 0.05, taxAmount: 29690.79, totalToDate: 623506.66 },

      { description: "C-228 Milestones 19.a Final Delivery to Destination of NLT1 and all Contractual Deliverables Completed and Accepted by Canada for your review and payment", claimNumber: 123, amount: 3000000.0, taxRate: 0.05, taxAmount: 150000.0, totalToDate: 3150000.0 },
      { description: "C-229 Milestones 19.a Final Delivery to Destination of NLT2 and all Contractual Deliverables Completed and Accepted by Canada", claimNumber: 123, amount: 3000000.0, taxRate: 0.05, taxAmount: 150000.0, totalToDate: 3150000.0 },
      { description: "Total Claim 123 Milestones 19.a, 19.b Final Delivery to Destination", subtotal: true, amount: 6000000.0 },

      { description: "**Note Reconciled Claim 115- typo error on org tracker - amount should have been $281498.88 - this claim has already been accepted and paid in full", claimNumber: null, amount: 0 },
      { description: "Reconciled Claim 115", claimNumber: 115, amount: 30000.0, taxRate: 0.05, taxAmount: 1500.0, totalToDate: 31500.0 },

      { description: "Claim 124 C-228 Milestone 9.1b, 9.2b Pre-Requisites Complete and accepted by Canada (Commissioning, Flushing, ITP)", claimNumber: 124, amount: 329897.7, taxRate: 0.05, taxAmount: 16494.89, totalToDate: 346392.59 },
      { description: "Claim 124 C-229 Milestone 9.2b Pre-Requisites Complete and accepted by Canada (Commissioning, Flushing, ITP)", claimNumber: 124, amount: 329897.7, taxRate: 0.05, taxAmount: 16494.89, totalToDate: 346392.59 },
      { description: "Total Claim 124 Milestone 9.1b,9.2b Pre-Requisites Complete", subtotal: true, amount: 659795.4 },

      { description: "Cancelled Claim 125 C-230 Milestone 7.3a Deckhouse Complete and accepted by Canada", claimNumber: 125, amount: 0, taxRate: 0.15, taxAmount: 0, totalToDate: null },
      { description: "Cancelled Claim 125 C-230 Milestone 7.3a Deckhouse Complete and accepted by Canada", claimNumber: 125, amount: 0, taxRate: 0.15, taxAmount: 0, totalToDate: null },

      { description: "Claim 126 Milestone 7.3a Deckhouse Complete and accepted by Canada", claimNumber: 126, amount: 329897.71, taxRate: 0.15, taxAmount: 49484.86, totalToDate: 379382.57 },

      { description: "Claim 127 C-228 DCR-22 Transportation to Esquimalt", claimNumber: 127, amount: 534977.77, taxRate: 0.05, taxAmount: 26748.89, totalToDate: 561726.66 },
      { description: "Claim 127 C-229 DCR-22 Transportation to Esquimalt", claimNumber: 127, amount: 534977.77, taxRate: 0.05, taxAmount: 26748.89, totalToDate: 561726.66 },
      { description: "Total Claim 127 DCR-22 Transportation to Esquimalt", subtotal: true, amount: 1069955.54 },

      { description: "Claim 128 C-228- DCR-28 Winches Upgrade", claimNumber: 128, amount: 505961.34, taxRate: 0.05, taxAmount: 25298.07, totalToDate: 531259.41 },
      { description: "Total Claim 128 C-228- DCR-28 Winches Upgrade", subtotal: true, amount: 505961.34 },

      { description: "Claim 129 C-229- DCR-28 Upgrade for the THR Winches by DMT", claimNumber: 129, amount: 467179.48, taxRate: 0.05, taxAmount: 23358.97, totalToDate: 490538.45 },
      { description: "Total Claim 129 C-229- DCR-28 Upgrade for the THR Winches by DMT", subtotal: true, amount: 467179.48 },

      { description: "Cancelled Claim 130 C-230 Milestone 8.3a Prime Movers Installed and Accepted by Canada", claimNumber: 130, amount: 0, taxRate: 0.15, taxAmount: 0, totalToDate: null },
      { description: "Total Claim 130 Milestone 8.3a Prime Movers Installed and Accepted by Canada (Cancelled)", subtotal: true, amount: 0 },
      { description: "Cancelled Claim 131 C-230 Milestone 7.3b Hull enclosed and accepted by Canada", claimNumber: 131, amount: 0, taxRate: 0.15, taxAmount: 0, totalToDate: null },
      { description: "Total Claim 131 Milestone 7.3b Hull enclosed and accepted by Canada (Cancelled)", subtotal: true, amount: 0 },
      { description: "Cancelled Claim 132 DCR 037 - C-00230 - Fender modification Signed and Accepted by Canada", claimNumber: 132, amount: 0, taxRate: 0.15, taxAmount: 0, totalToDate: null },
      { description: "Total Claim 132 DCR 037 - C-00230 - Fender modification (Cancelled)", subtotal: true, amount: 0 },

      { description: "Claim 133 C-230 Milestone 8.3a Prime Movers Installed and Accepted by Canada", claimNumber: 133, amount: 879727.21, taxRate: 0.14, taxAmount: 123161.81, totalToDate: 1002889.02 },
      { description: "Total Claim 133 C-230 Milestone 8.3a Prime Movers Installed and Accepted by Canada", subtotal: true, amount: 879727.21 },

      { description: "Claim 134 C-230 Milestone 7.3b Hull enclosed and accepted by Canada", claimNumber: 134, amount: 989693.11, taxRate: 0.14, taxAmount: 138557.04, totalToDate: 1128250.15 },
      { description: "Total Claim 134 C-230 Milestone 7.3b Hull enclosed and accepted by Canada", subtotal: true, amount: 989693.11 },

      { description: "Claim 135 DCR 037 - C-00230 - Fender modification Signed and Accepted by Canada", claimNumber: 135, amount: 7903.0, taxRate: 0.14, taxAmount: 1106.42, totalToDate: 9009.42 },
      { description: "Total Claim 135 DCR 037 - C-00230 - Fender modification", subtotal: true, amount: 7903.0 },

      { description: "Claim 136 C-230 - Milestone 7.3c Deckhouse and hull assembly complete and accepted by Canada", claimNumber: 136, amount: 879727.21, taxRate: 0.14, taxAmount: 123161.81, totalToDate: 1002889.02 },
      { description: "Total Claim 136 C-230 - Milestone 7.3c Deckhouse and hull assembly", subtotal: true, amount: 879727.21 },

      { description: "Claim 137 C-19 C. Milestone 7 for NLT 3 completed and accepted by Canada", claimNumber: 137, amount: 1400000.0, taxRate: 0.14, taxAmount: 196000.0, totalToDate: 1596000.0 },
      { description: "Total Claim 137 C-19 C. Milestone 7 for NLT 3", subtotal: true, amount: 1400000.0 },

      { description: "Claim 138 C-228 Milestone 11.1 Delivery and Final Acceptance of vessels complete at respective CFR bases Holdback (Reference claim 120)", claimNumber: 138, amount: 103996.12, taxRate: 0.05, taxAmount: 5199.81, totalToDate: 109195.93 },
      { description: "Claim 138 C-230 Milestone 11.1, 11.2 Delivery and Final Acceptance of vessels complete at respective CFR bases Holdback (Reference claim 120)", claimNumber: 138, amount: 150976.13, taxRate: 0.05, taxAmount: 7548.81, totalToDate: 158524.94 },
      { description: "Total Claim 138 Delivery and Final Acceptance Holdback (Reference claim 120)", subtotal: true, amount: 254972.25 },

      { description: "Claim 139 C-230 DCR-001 Exterior Watertight Power Receptacles", claimNumber: 139, amount: 16041.25, taxRate: 0.14, taxAmount: 2245.78, totalToDate: 18287.03 },
      { description: "Total Claim 139 C-230 DCR-001 Exterior Watertight Power Receptacles", subtotal: true, amount: 16041.25 },

      { description: "Claim 140 C-230 DCR-006 Tie Downs on Aft Deck Accepted by Canada", claimNumber: 140, amount: 49773.0, taxRate: 0.14, taxAmount: 6968.22, totalToDate: 56741.22 },
      { description: "Total Claim 140 C-230 DCR-006 Tie Downs on Aft Deck", subtotal: true, amount: 49773.0 },

      { description: "Claim 141 C-230 Milestone 8.3 b1 All shaft components installed and accepted by Canada", claimNumber: 141, amount: 527836.33, taxRate: 0.14, taxAmount: 73897.09, totalToDate: 601733.42 },
      { description: "Total Claim 141 C-230 Milestone 8.3 b1 All shaft components installed and accepted by Canada", subtotal: true, amount: 527836.33 },

      { description: "Claim 142 C-230 Milestone 8.3 b2 Final alignment completed and accepted by Canada", claimNumber: 142, amount: 791754.49, taxRate: 0.14, taxAmount: 110845.63, totalToDate: 902600.12 },
      { description: "Total Claim 142 C-230 Milestone 8.3 b2 Final alignment completed and accepted by Canada", subtotal: true, amount: 791754.49 },

      { description: "Claim 143 C-230 DCR-009 Space Heaters", claimNumber: 143, amount: 89705.4, taxRate: 0.14, taxAmount: 12558.76, totalToDate: 102264.16 },
      { description: "Total Claim 143 C-230 DCR-009 Space Heaters", subtotal: true, amount: 89705.4 },

      { description: "Claim 144 C-230 DCR-011-Connecting to Shore Power", claimNumber: 144, amount: 13928.1, taxRate: 0.14, taxAmount: 1949.93, totalToDate: 15878.03 },
      { description: "Total Claim 144 C-230 DCR-011-Connecting to Shore Power", subtotal: true, amount: 13928.1 },

      { description: "Claim 145 C-230 DCR-013-2 storage cabinets in Z-drive cabinets", claimNumber: 145, amount: 8042.0, taxRate: 0.14, taxAmount: 1125.88, totalToDate: 9167.88 },
      { description: "Total Claim 145 C-230 DCR-013-2 storage cabinets in Z-drive cabinets", subtotal: true, amount: 8042.0 },

      { description: "Claim 146 C-230 DCR-015-Exterior superstructure light fixture", claimNumber: 146, amount: 10922.0, taxRate: 0.14, taxAmount: 1529.08, totalToDate: 12451.08 },
      { description: "Total Claim 146 C-230 DCR-015-Exterior superstructure light fixture", subtotal: true, amount: 10922.0 },

      { description: "Claim 147 C-230 DCR-016-Deck Crane Upgrade", claimNumber: 147, amount: 26791.12, taxRate: 0.14, taxAmount: 3750.76, totalToDate: 30541.88 },
      { description: "Total Claim 147 C-230 DCR-016-Deck Crane Upgrade", subtotal: true, amount: 26791.12 },

      { description: "Claim 148 C-230 DCR-025-Power Lashing to Submarines (Installation of 20 tonnes bollard on aft deck and fore bulwark)", claimNumber: 148, amount: 95998.34, taxRate: 0.14, taxAmount: 13439.77, totalToDate: 109438.11 },
      { description: "Total Claim 148 C-230 DCR-025-Power Lashing to Submarines", subtotal: true, amount: 95998.34 },

      { description: "Claim 149 C-230 DCR-027-Grey water treatment capability", claimNumber: 149, amount: 40360.13, taxRate: 0.14, taxAmount: 5650.42, totalToDate: 46010.55 },
      { description: "Total Claim 149 C-230 DCR-027-Grey water treatment capability", subtotal: true, amount: 40360.13 },

      { description: "Claim 150 C-230 DCR-036-ECDIS Battery back-up", claimNumber: 150, amount: 15330.67, taxRate: 0.14, taxAmount: 2146.29, totalToDate: 17476.96 },
      { description: "Total Claim 150 C-230 DCR-036-ECDIS Battery back-up", subtotal: true, amount: 15330.67 },

      { description: "Claim 151 C-230 DCR 039 Additional charger", claimNumber: 151, amount: 34449.69, taxRate: 0.14, taxAmount: 4822.96, totalToDate: 39272.65 },
      { description: "Total Claim 151 C-230 DCR 039 Additional charger", subtotal: true, amount: 34449.69 },

      { description: "Claim 152 C-230 DCR 004 Heated Sky Ports Accepted by Canada", claimNumber: 152, amount: 13783.0, taxRate: 0.14, taxAmount: 1929.62, totalToDate: 15712.62 },
      { description: "Total Claim 152 C-230 DCR 004 Heated Sky Ports Accepted by Canada", subtotal: true, amount: 13783.0 },

      { description: "Claim 153 C-00230 DCR 033 Bilge wells in U8 Accepted by Canada", claimNumber: 153, amount: 16315.0, taxRate: 0.14, taxAmount: 2284.1, totalToDate: 18599.1 },
      { description: "Total Claim 153 C-00230 DCR 033 Bilge wells in U8 Accepted by Canada", subtotal: true, amount: 16315.0 },

      { description: "Claim 154 C-00230 DCR 038 Change of Shelves Accepted by Canada", claimNumber: 154, amount: 8155.0, taxRate: 0.14, taxAmount: 1141.7, totalToDate: 9296.7 },
      { description: "Total Claim 154 C-00230 DCR 038 Change of Shelves Accepted by Canada", subtotal: true, amount: 8155.0 },

      { description: "Claim 155 C-00230 DCR 032 Modification of Chart Table Accepted by Canada", claimNumber: 155, amount: 10554.0, taxRate: 0.14, taxAmount: 1477.62, totalToDate: 12032.02 },
      { description: "Total Claim 155 C-00230 DCR 032 Modification of Chart Table Accepted by Canada", subtotal: true, amount: 10554.0 },

      { description: "Claim 156 C-00230 DCR 007 NERT Locker Accepted by Canada", claimNumber: 156, amount: 22789.8, taxRate: 0.14, taxAmount: 3190.57, totalToDate: 25980.37 },
      { description: "Total Claim 156 C-00230 DCR 007 NERT Locker Accepted by Canada", subtotal: true, amount: 22789.8 },

      { description: "Claim 157 C-00230 Milestone 9.3b Pre-Requisites Complete and accepted by Canada (Commissioning, Flushing, ITP)", claimNumber: 157, amount: 329897.7, taxRate: 0.14, taxAmount: 46185.68, totalToDate: 376083.38 },
      { description: "Total Claim 157 C-00230 Milestone 9.3b Pre-Requisites Complete and accepted by Canada", subtotal: true, amount: 329897.7 },

      { description: "Claim 158 C-00230 DCR 008 Floodable Pyrotechnics Locker Accepted by Canada", claimNumber: 158, amount: 46377.2, taxRate: 0.14, taxAmount: 6492.81, totalToDate: 52870.01 },
      { description: "Total Claim 158 C-00230 DCR 008 Floodable Pyrotechnics Locker Accepted by Canada", subtotal: true, amount: 46377.2 },

      { description: "Claim 159 C-00230 DCR 014 Laundry Equipment Accepted by Canada", claimNumber: 159, amount: 16841.5, taxRate: 0.14, taxAmount: 2357.81, totalToDate: 19199.31 },
      { description: "Total Claim 159 C-00230 DCR 014 Laundry Equipment Accepted by Canada", subtotal: true, amount: 16841.5 },

      { description: "Claim 160 C-00230 DCR 045 Tarp for U8 hatch Accepted by Canada", claimNumber: 160, amount: 1830.0, taxRate: 0.14, taxAmount: 256.2, totalToDate: 2086.2 },
      { description: "Total Claim 160 C-00230 DCR 045 Tarp for U8 hatch Accepted by Canada", subtotal: true, amount: 1830.0 },

      { description: "Claim 161 C-00228 Milestone 12.1b3 Spares delivered and accepted by Canada", claimNumber: 161, amount: 138124.44, taxRate: 0.05, taxAmount: 6906.22, totalToDate: 145030.66 },
      { description: "Total Claim 161 C-00228 Milestone 12.1b3 Spares delivered and accepted by Canada", subtotal: true, amount: 138124.44 }
    ]
  };

  const logoSvg = `
    <svg viewBox="0 0 220 70" role="img" aria-label="OCEAN logo" class="pc-logo-svg">
      <style>
        .ocean-text { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 800; fill: #0d4f9d; }
        .ocean-accent { fill: #0cb5d8; }
      </style>
      <text x="6" y="40" class="ocean-text" font-size="38">OCEAN</text>
      <path class="ocean-accent" d="M72 24c12-10 26-6 33 0-6-2-15-2-22 3 5 0 10 2 14 6-10-6-20-4-25 0 2-4 0-7 0-9z"/>
      <text x="12" y="60" class="ocean-text" font-size="13">GO FULL FORCE</text>
    </svg>`;

  if (!pcState.paymentClaimRows) {
    pcState.paymentClaimRows = data.rows.map((row) => ({ ...row }));
  }

  const rowsWithIndex = pcState.paymentClaimRows.map((row, idx) => ({
    ...row,
	__idx: idx,
  }));

  const claimSums = new Map();
  let maxClaimNumber = 0;

  rowsWithIndex.forEach((row) => {
    if (!row.subtotal && typeof row.claimNumber === "number") {
      const key = row.claimNumber;
      const current = claimSums.get(key) || 0;
      const amount = typeof row.amount === "number" ? row.amount : 0;
      claimSums.set(key, current + amount);
      if (row.claimNumber > maxClaimNumber) {
        maxClaimNumber = row.claimNumber;
      }
    }
  });

  // Numéro de Claim affiché dans l'en-tête = prochain Claim # à utiliser
  const currentClaimNo = maxClaimNumber + 1;

  const claimCount = Array.from(
    new Set(
      rowsWithIndex
        .filter((row) => !row.subtotal && row.claimNumber != null)
        .map((row) => row.claimNumber)
    )
  ).length;

  const taxFilter = pcState.paymentClaimTaxFilter || "all";
  const searchTerm = (pcState.paymentClaimSearch || "").trim().toLowerCase();
  const filteredRows = rowsWithIndex.filter((row) => {
    if (taxFilter !== "all") {
	  if (row.taxRate == null) return false;
	  if (row.taxRate.toFixed(2) !== taxFilter) return false;
	}
	if (searchTerm) {
	  const txt = (row.description || "").toLowerCase();
	  if (!txt.includes(searchTerm)) return false;
	}
	return true;
  });

  // Totaux par taxe basés sur les lignes actuellement visibles (après filtre)
  const totalsByRate = new Map(); // taxRate -> { amount, tax }
  filteredRows.forEach((row) => {
	if (row.subtotal || typeof row.amount !== "number") return;
	const rate = typeof row.taxRate === "number" ? row.taxRate : 0;
	const bucket = totalsByRate.get(rate) || { amount: 0, tax: 0 };
	bucket.amount += row.amount;
	bucket.tax += row.amount * rate;
	totalsByRate.set(rate, bucket);
  });

  // Prépare les lignes de résumé dynamiques par taux (sur le jeu filtré)
  const buildSummaryItems = () => {
    const rates = [0.05, 0.14, 0.15];
    const withoutTax = [];
    const taxOnly = [];
    rates.forEach((rate) => {
      const bucket = totalsByRate.get(rate);
      if (!bucket) return;
      const pct = (rate * 100).toFixed(0);
      withoutTax.push({
        label: `${pct}% tax claim cumulative W/O tx`,
        value: bucket.amount,
      });
      taxOnly.push({
        label: `${pct}% tax rate cumulative`,
        value: bucket.tax,
      });
    });
    return { withoutTax, taxOnly };
  };

  const { withoutTax: summaryWithoutTax, taxOnly: summaryTax } =
    buildSummaryItems();

  const summaryTotalToDate = Array.from(totalsByRate.values()).reduce(
    (acc, bucket) => acc + bucket.amount + bucket.tax,
    0
  );

  // --- utilitaire historique pour Annuler ---
  const pushHistory = () => {
    if (!pcState.history) pcState.history = [];
    const snapshot = pcState.paymentClaimRows.map((row) => ({ ...row }));
    pcState.history.push(snapshot);
    if (pcState.history.length > 20) {
    pcState.history.shift();
    }
  };

  const renderSummaryLines = (items) =>
    items
      .map(
        (item) =>
          `<div class="pc-summary-line"><span>${item.label}</span><span>$ ${formatMoney(item.value)}</span></div>`
      )
      .join("");

  const parseSubtotalClaimNumber = (description) => {
    if (typeof description !== "string") return null;
    const match = description.match(/Total\s+Claim\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  };

  const renderRow = (row) => {
	const taxRateValue = row.taxRate != null ? row.taxRate.toFixed(2) : "";
	const taxSelectHtml = `
    <select class="pc-tax-select" data-index="${row.__idx}">
      <option value="" ${taxRateValue === "" ? "selected" : ""}>—</option>
      <option value="0.05" ${taxRateValue === "0.05" ? "selected" : ""}>5%</option>
      <option value="0.14" ${taxRateValue === "0.14" ? "selected" : ""}>14%</option>
      <option value="0.15" ${taxRateValue === "0.15" ? "selected" : ""}>15%</option>
    </select>
  `;
    const taxAmount =
      row.taxAmount != null
        ? row.taxAmount
        : row.amount && row.taxRate != null
        ? row.amount * row.taxRate
        : null;
    const totalToDate = row.totalToDate != null && row.totalToDate !== ""
      ? row.totalToDate
      : row.amount != null && taxAmount != null
      ? row.amount + taxAmount
      : null;

    if (row.subtotal) {
      const claimNum =
        typeof row.claimNumber === "number"
          ? row.claimNumber
          : parseSubtotalClaimNumber(row.description);
      let subtotalValue = null;
      if (claimNum != null && claimSums.has(claimNum)) {
        subtotalValue = claimSums.get(claimNum);
      } else {
        subtotalValue = row.amount != null ? row.amount : totalToDate;
      }
      return `
        <tr class="pc-subtotal">
          <td colspan="3">${escapeHtml(row.description || "")}</td>
          <td></td>
          <td></td>
          <td class="t-right col-total">${subtotalValue != null ? `$ ${formatMoney(subtotalValue)}` : ""}</td>
          <td class="pc-actions">
            <button
              type="button"
              data-action="insert"
              data-index="${row.__idx}"
              class="pc-action-btn pc-action-insert"
              title="Insérer une nouvelle claim sous la ligne de résultat"
              aria-label="Insérer une nouvelle claim sous la ligne de résultat"
            >
              <span class="pc-action-icon">+</span>
            </button>
            <button
              type="button"
              data-action="delete"
              data-index="${row.__idx}"
              class="pc-action-btn pc-action-delete"
              title="Supprimer la ligne de résultat"
              aria-label="Supprimer la ligne de résultat"
            >
              <span class="pc-action-icon">×</span>
            </button>
          </td>
        </tr>
      `;
    }

    return `
      <tr>
        <td class="wide-desc">
          <input
            type="text"
            class="pc-cell-input pc-cell-desc"
            data-index="${row.__idx}"
            data-field="description"
            value="${escapeHtml(row.description || "")}"
          />
        </td>
        <td class="t-center col-num">${row.claimNumber != null ? row.claimNumber : ""}</td>
        <td class="t-right col-amount">
          <input
            type="number"
            step="0.01"
            class="pc-cell-input pc-cell-amount"
            data-index="${row.__idx}"
            data-field="amount"
            value="${row.amount != null ? row.amount.toFixed(2) : ""}"
          />
        </td>
        <td class="t-center col-tax">${taxSelectHtml}</td>
        <td class="t-right col-amount">${taxAmount != null ? `$ ${formatMoney(taxAmount)}` : ""}</td>
        <td class="t-right col-total">${totalToDate != null ? `$ ${formatMoney(totalToDate)}` : ""}</td>
        <td class="pc-actions">
          <button
            type="button"
            data-action="insert"
            data-index="${row.__idx}"
            class="pc-action-btn pc-action-insert"
            title="Insérer une ligne ordinaire"
            aria-label="Insérer une ligne ordinaire"
          >
            <span class="pc-action-icon">+</span>
          </button>
          <button
            type="button"
            data-action="insert-subtotal"
            data-index="${row.__idx}"
            class="pc-action-btn pc-action-subtotal"
            title="Insérer une ligne de résultat"
            aria-label="Insérer une ligne de résultat"
          >
            <span class="pc-action-icon">Σ</span>
          </button>
          <button
            type="button"
            data-action="delete"
            data-index="${row.__idx}"
            class="pc-action-btn pc-action-delete"
            title="Supprimer la ligne"
            aria-label="Supprimer la ligne"
          >
            <span class="pc-action-icon">×</span>
          </button>
        </td>
      </tr>
    `;
  };

  container.innerHTML = `
    <div class="pc-search-bar">
      <input
        type="text"
        id="pcSearchInput"
        class="pc-search-input"
        placeholder="Rechercher dans le paiement claim (description, texte...)"
        value="${escapeHtml(pcState.paymentClaimSearch || "")}"
      />
    </div>

    <div class="pc-summary-card">
      <div class="pc-summary-left">
        <div class="pc-logo">${logoSvg}</div>
        <div>
          <div class="pc-summary-title">Summary sheet to Claim for Progress Payment - Claim No. ${currentClaimNo}</div>
          <div class="pc-summary-contract">PSPC Contract # ${data.contract}</div>
          <div class="pc-summary-contract">Nombre de claims : ${claimCount}</div>
        </div>
      </div>
      <div class="pc-summary-actions">
        <button type="button" id="pcUndoBtn" class="pc-undo-btn" title="Annuler la dernière opération">Annuler</button>
      </div>
      <div class="pc-summary-total">
        <div class="pc-summary-total-label">Cumulative TOTAL to date</div>
        <div class="pc-summary-total-value">$ ${formatMoney(summaryTotalToDate)}</div>
      </div>
    </div>

    <div class="pc-summary-grid">
      <div class="pc-summary-block">
        <div class="pc-summary-block-title">Cumulative (W/O tax)</div>
        ${renderSummaryLines(summaryWithoutTax)}
      </div>
      <div class="pc-summary-block">
        <div class="pc-summary-block-title">Cumulative Tax</div>
        ${renderSummaryLines(summaryTax)}
      </div>
    </div>

    <div class="pc-table-card">
      <div class="pc-table-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>Paiement claim détaillé</span>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
          Filtrer taxe:
        <select id="taxFilterSelect" class="pc-select">
          <option value="all">Toutes</option>
          <option value="0.05">5%</option>
          <option value="0.14">14%</option>
          <option value="0.15">15%</option>
        </select>
        </label>
      </div>
      <div class="table-responsive">
        <table class="payment-claim-table">
          <thead>
            <tr>
              <th class="wide-desc">Description</th>
              <th class="t-center col-num">Claim #</th>
              <th class="t-right col-amount">Claim amount</th>
              <th class="t-center col-tax">Tax rate</th>
              <th class="t-right col-amount">Tax amount</th>
              <th class="t-right col-total">Total to date</th>
              <th class="t-center col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filteredRows.map(renderRow).join("")}
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:10px;">Tableau modifiable localement (ajout/suppression) et filtrable par code taxe.</p>
    </div>
  `;

  const handleInsertBelow = (rowIndex) => {
  pushHistory();
  // À chaque ajout, on crée un nouveau Claim # (max + 1)
  let maxClaim = 0;
  pcState.paymentClaimRows.forEach((row) => {
    if (!row.subtotal && typeof row.claimNumber === "number") {
    if (row.claimNumber > maxClaim) maxClaim = row.claimNumber;
    }
  });
  const newClaimNumber = maxClaim > 0 ? maxClaim + 1 : 1;

  const blankRow = {
    description: "Nouvelle ligne",
    claimNumber: newClaimNumber,
    amount: 0,
    taxRate: 0.05,
    taxAmount: 0,
    totalToDate: 0,
  };
  pcState.paymentClaimRows.splice(rowIndex + 1, 0, blankRow);
  renderTraitement();
  };

  const handleInsertSubtotalBelow = (rowIndex) => {
	pushHistory();
  const baseRow = pcState.paymentClaimRows[rowIndex] || {};
  const claimNumber =
    baseRow && !baseRow.subtotal && typeof baseRow.claimNumber === "number"
    ? baseRow.claimNumber
    : null;
  const description =
    claimNumber != null ? `Total Claim ${claimNumber}` : "Total Claim";
  const newRow = {
    description,
    claimNumber: claimNumber,
    subtotal: true,
    amount: 0,
    taxRate: null,
    taxAmount: null,
    totalToDate: null,
  };
  pcState.paymentClaimRows.splice(rowIndex + 1, 0, newRow);
  renderTraitement();
  };


  const handleDelete = (rowIndex) => {
	pushHistory();
    pcState.paymentClaimRows.splice(rowIndex, 1);
    renderTraitement();
  };

  const handleCellChange = (rowIndex, field, rawValue) => {
	pushHistory();
    const row = pcState.paymentClaimRows[rowIndex];
    if (!row) return;

    if (field === "amount") {
      const num = parseFloat(rawValue);
      row.amount = Number.isFinite(num) ? num : 0;
      row.taxAmount = null;
      row.totalToDate = null;
    } else if (field === "claimNumber") {
      if (rawValue === "") {
        row.claimNumber = null;
      } else {
        const n = parseInt(rawValue, 10);
        row.claimNumber = Number.isNaN(n) ? null : n;
      }
    } else if (field === "description") {
      row.description = rawValue;
    }

    renderTraitement();
  };

	const handleTaxChange = (rowIndex, taxRateStr) => {
    pushHistory();
	  const row = pcState.paymentClaimRows[rowIndex];
	  if (!row) return;
	  row.taxRate = taxRateStr ? parseFloat(taxRateStr) : null;
	  // Recalcule à l'affichage à partir du nouveau taux
	  row.taxAmount = null;
	  row.totalToDate = null;
	  renderTraitement();
	};

  const tbody = container.querySelector(".payment-claim-table tbody");
  if (tbody) {
    tbody.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action]");
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (Number.isNaN(idx)) return;
      if (btn.dataset.action === "delete") {
        handleDelete(idx);
      } else if (btn.dataset.action === "insert") {
        handleInsertBelow(idx);
      } else if (btn.dataset.action === "insert-subtotal") {
        handleInsertSubtotalBelow(idx);
      }
    });

  tbody.addEventListener("change", (event) => {
    const select = event.target.closest(".pc-tax-select");
    if (select) {
      const idx = Number(select.dataset.index);
      if (!Number.isNaN(idx)) {
        handleTaxChange(idx, select.value || "");
      }
      return;
    }

    const input = event.target.closest(".pc-cell-input");
    if (input) {
      const idx = Number(input.dataset.index);
      const field = input.dataset.field;
      if (!Number.isNaN(idx) && field) {
        handleCellChange(idx, field, input.value);
      }
    }
  });
  }

  const filterSelect = container.querySelector("#taxFilterSelect");
  if (filterSelect) {
    filterSelect.value = taxFilter;
    filterSelect.addEventListener("change", (event) => {
      pcState.paymentClaimTaxFilter = event.target.value;
      renderTraitement();
    });
  }

	const searchInput = container.querySelector("#pcSearchInput");
	if (searchInput) {
	  searchInput.addEventListener("input", (event) => {
		pcState.paymentClaimSearch = event.target.value || "";
		renderTraitement();
	  });
	}

  const undoBtn = container.querySelector("#pcUndoBtn");
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
    if (!pcState.history || !pcState.history.length) return;
    const previous = pcState.history.pop();
    pcState.paymentClaimRows = previous.map((row) => ({ ...row }));
    renderTraitement();
    });
  }

  // Met à jour le compteur "Traitement" dans le menu latéral
  // On utilise le même nombre que le résumé paiement : nombre de Claim # distincts
  const badgeTraitement = document.getElementById("badgeTraitement");
  if (badgeTraitement) {
    badgeTraitement.textContent = claimCount;
  }
}

function renderCompilation() {
  const container = document.getElementById("compilationContent");
  if (!container) return;

  const cState =
    window.compilationState ||
    (window.compilationState = {
      files: [],
      nextId: 1,
      selectedFileId: null
    });

  const files = Array.isArray(cState.files) ? cState.files : [];
  let selectedFile = files.find((f) => f.id === cState.selectedFileId) || null;
  if (!selectedFile && files.length > 0) {
    selectedFile = files[0];
    cState.selectedFileId = selectedFile.id;
  }

  const formatFileSize = (bytes) => {
    const n = Number(bytes || 0);
    if (!n) return "";
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ko`;
    return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const formatDateShort = (ts) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleDateString();
    } catch {
      return "";
    }
  };

  const getStatusLabel = (status) => {
    if (status === "prep") return "En préparation";
    if (status === "signed") return "Signé / envoyé";
    return "Nouveau";
  };

  const getStatusClass = (status) => {
    if (status === "prep") return "comp-status-prep";
    if (status === "signed") return "comp-status-signed";
    return "comp-status-new";
  };

  const toolsHtml = `
    <div class="comp-tools-grid">
      <button class="comp-tool-card" data-comp-tool="import">
        <div class="comp-tool-icon">📥</div>
        <div class="comp-tool-title">Importer</div>
        <div class="comp-tool-text">Ajouter un ou plusieurs PDF à traiter.</div>
      </button>
      <button class="comp-tool-card" data-comp-tool="organize">
        <div class="comp-tool-icon">🗂</div>
        <div class="comp-tool-title">Organiser</div>
        <div class="comp-tool-text">Simuler l'ordre des pages et préparer le montage.</div>
      </button>
      <button class="comp-tool-card" data-comp-tool="sign">
        <div class="comp-tool-icon">✍</div>
        <div class="comp-tool-title">Signer</div>
        <div class="comp-tool-text">Préparer les informations de signature et les notes.</div>
      </button>
    </div>
  `;

  const filesHtml = files.length
    ? files
        .map((f) => {
          const active = selectedFile && f.id === selectedFile.id ? " active" : "";
          const statusClass = getStatusClass(f.status);
          const statusLabel = getStatusLabel(f.status);
          return `
            <button class="comp-file-row${active}" data-id="${f.id}">
              <div class="comp-file-main">
                <span class="comp-file-name">${escapeHtml(f.name || "")}</span>
                <span class="comp-file-status ${statusClass}">${statusLabel}</span>
              </div>
              <div class="comp-file-meta">
                <span>${formatFileSize(f.size)}</span>
                <span>${f.pagesCount ? `${f.pagesCount} pages` : "Pages ?"}</span>
              </div>
            </button>
          `;
        })
        .join("")
    : '<p class="muted">Aucun PDF importé pour le moment. Utilisez le bouton ci-dessus pour commencer.</p>';

  const detailHtml = selectedFile
    ? `
      <div class="comp-detail-header">
        <div>
          <h4>${escapeHtml(selectedFile.name || "PDF sans nom")}</h4>
          <p class="muted">
            ${formatFileSize(selectedFile.size)}
            ${formatDateShort(selectedFile.lastModified) ? " · Importé le " + formatDateShort(selectedFile.lastModified) : ""}
          </p>
        </div>
        <span class="comp-status-pill ${getStatusClass(selectedFile.status)}">${getStatusLabel(selectedFile.status)}</span>
      </div>

      <div class="comp-preview-wrapper">
        <div class="comp-preview">
          <div class="comp-preview-page">
            <div class="comp-preview-header">Aperçu A4 (simulation)</div>
            <div class="comp-preview-body">
              <div class="comp-preview-title">${escapeHtml(selectedFile.name || "PDF sans nom")}</div>
              <div class="comp-preview-meta">
                ${selectedFile.pagesCount || 1} page${(selectedFile.pagesCount || 1) > 1 ? "s" : ""}
                ${formatFileSize(selectedFile.size) ? " · " + formatFileSize(selectedFile.size) : ""}
              </div>
            </div>
          </div>
          <p class="muted small">Cette fenêtre représente une page A4 pour l'aperçu rapide. Le rendu du PDF pourra être branché plus tard.</p>
        </div>
      </div>

      <div class="comp-detail-actions">
        <button class="btn small secondary" data-comp-action="set-prep">📑 Marquer en préparation</button>
        <button class="btn small" data-comp-action="set-signed">✍ Préparer / marquer comme signé</button>
      </div>

      <div class="comp-detail-grid">
        <div class="comp-detail-block" id="compOrganizeBlock">
          <h5>Organisation des pages</h5>
          <p class="muted">Nombre de pages (pour organisation visuelle) :</p>
          <input id="compPagesInput" type="number" min="1" step="1" value="${selectedFile.pagesCount || 1}" />
          <div class="comp-pages-grid">
            ${Array.from({ length: selectedFile.pagesCount || 1 }, (_, i) => `
              <div class="comp-page-thumb">
                <span class="comp-page-num">${i + 1}</span>
                <span class="comp-page-label">Page ${i + 1}</span>
              </div>
            `).join("")}
          </div>
          <p class="muted small">Cette zone simule la vue « Organiser les pages ». L'affichage réel des pages PDF pourra être branché plus tard (PDF.js, backend, etc.).</p>
        </div>

        <div class="comp-detail-block" id="compSignBlock">
          <h5>Signature / certificats</h5>
          <p class="muted">Préparez le workflow de signature pour ce PDF.</p>
          <div class="comp-signature-fields">
            <div>
              <label>Signataire principal</label>
              <input id="compSignerInput" type="text" placeholder="Nom du signataire (ex. Responsable Canada)" value="${escapeHtml(selectedFile.signer || "")}" />
            </div>
            <div>
              <label>Remarques internes</label>
              <textarea id="compNotesInput" rows="3" placeholder="Instructions internes, emplacement de la signature, certificats à utiliser...">${escapeHtml(selectedFile.notes || "")}</textarea>
            </div>
          </div>
        </div>
      </div>
    `
    : '<p class="muted">Importez un PDF puis sélectionnez-le dans la colonne de gauche pour organiser les pages et préparer la signature.</p>';

  container.innerHTML = `
    <div class="comp-toolbar">
      <div class="comp-toolbar-left">
        <button id="compImportBtn" class="btn primary">
          ➕ Importer des PDF
        </button>
        <input id="compFileInput" type="file" accept="application/pdf" multiple style="display:none" />
      </div>
      <div class="comp-toolbar-steps">
        <span>1. Importer</span>
        <span>2. Organiser les pages</span>
        <span>3. Préparer la signature</span>
      </div>
    </div>

    <div class="comp-layout">
      <div class="comp-files-panel">
        <div class="comp-panel-header">
          <h4>Dossiers en préparation</h4>
          <span class="comp-badge">${files.length}</span>
        </div>
        <div class="comp-files-list">
          ${filesHtml}
        </div>
      </div>

      <div class="comp-detail-panel">
        ${toolsHtml}
        ${detailHtml}
      </div>
    </div>
  `;

  const btnImport = container.querySelector("#compImportBtn");
  const fileInput = container.querySelector("#compFileInput");
  if (btnImport && fileInput) {
    btnImport.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async (e) => {
      const filesList = e.target.files;
      if (!filesList || !filesList.length) return;

      const estimatePages = (file) => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const buffer = reader.result;
              if (!(buffer instanceof ArrayBuffer)) {
                resolve(1);
                return;
              }
              const text = new TextDecoder("latin1").decode(new Uint8Array(buffer));
              const matches = text.match(/\/Type\s*\/Page[^s]/g);
              const count = matches ? matches.length : 1;
              resolve(count || 1);
            } catch {
              resolve(1);
            }
          };
          reader.onerror = () => resolve(1);
          reader.readAsArrayBuffer(file);
        });
      };

      for (const f of filesList) {
        const pages = await estimatePages(f);
        const newFile = {
          id: cState.nextId++,
          name: f.name,
          size: f.size,
          lastModified: f.lastModified,
          status: "new",
          pagesCount: pages,
          signer: "",
          notes: ""
        };
        cState.files.push(newFile);
        cState.selectedFileId = newFile.id;
      }
      fileInput.value = "";
      renderCompilation();
    });
  }

  // Cartes "Import / Organiser / Signer" du dashboard
  container.querySelectorAll("[data-comp-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = btn.getAttribute("data-comp-tool");
      if (tool === "import") {
        if (fileInput) fileInput.click();
        return;
      }

      if (!selectedFile) {
        alert("Importez d'abord un PDF pour utiliser cette fonctionnalité.");
        return;
      }

      if (tool === "organize") {
        const block = container.querySelector("#compOrganizeBlock");
        if (block) block.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (tool === "sign") {
        const block = container.querySelector("#compSignBlock");
        if (block) block.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  const filesListEl = container.querySelector(".comp-files-list");
  if (filesListEl) {
    filesListEl.addEventListener("click", (e) => {
      const row = e.target.closest(".comp-file-row");
      if (!row) return;
      const id = Number(row.getAttribute("data-id"));
      if (!id) return;
      cState.selectedFileId = id;
      renderCompilation();
    });
  }

  if (selectedFile) {
    const pagesInput = container.querySelector("#compPagesInput");
    if (pagesInput) {
      pagesInput.addEventListener("change", (e) => {
        const v = Number(e.target.value || 1);
        const safe = !v || v < 1 ? 1 : Math.round(v);
        const file = cState.files.find((f) => f.id === selectedFile.id);
        if (file) file.pagesCount = safe;
        renderCompilation();
      });
    }

    const signerInput = container.querySelector("#compSignerInput");
    if (signerInput) {
      signerInput.addEventListener("input", (e) => {
        const file = cState.files.find((f) => f.id === selectedFile.id);
        if (file) file.signer = e.target.value;
      });
    }

    const notesInput = container.querySelector("#compNotesInput");
    if (notesInput) {
      notesInput.addEventListener("input", (e) => {
        const file = cState.files.find((f) => f.id === selectedFile.id);
        if (file) file.notes = e.target.value;
      });
    }

    container.querySelectorAll("[data-comp-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-comp-action");
        const file = cState.files.find((f) => f.id === selectedFile.id);
        if (!file) return;
        if (action === "set-prep") {
          file.status = "prep";
        } else if (action === "set-signed") {
          file.status = "signed";
        }
        renderCompilation();
      });
    });
  }
}

// === FORMULAIRE 1111 (aperçu imprimable) ==============================
function renderFormulaire1111() {
  const container = document.getElementById("formulaire1111Content");
  if (!container) return;

  // On réutilise quelques infos connues (contrat, prochain Claim No.)
  let contractNo = "017mc.W8472-185713";
  let claimNo = "";
  try {
    const pcState = window.paymentClaimState;
    if (pcState && Array.isArray(pcState.paymentClaimRows)) {
      const rows = pcState.paymentClaimRows;
      const maxClaim = rows.reduce((max, row) => {
        if (!row.subtotal && typeof row.claimNumber === "number") {
          return Math.max(max, row.claimNumber);
        }
        return max;
      }, 0);
      if (maxClaim > 0) claimNo = String(maxClaim + 1);
    }
  } catch (e) {
    console.warn("renderFormulaire1111: impossible de dériver le Claim No.", e);
  }

  container.innerHTML = `
    <div class="f1111-container">
      <!-- Page 1 -->
      <section class="f1111-page">
        <header class="f1111-header">
          <div class="f1111-header-left">
            <div class="f1111-gov-block">Formulaire 1111 - Aperçu</div>
          </div>
          <div class="f1111-header-right">
            <div class="f1111-field-row">
              <span class="f1111-label">Claim No. / N° de la demande</span>
              <input class="f1111-input" type="text" value="${escapeHtml(claimNo)}" />
            </div>
            <div class="f1111-field-row">
              <span class="f1111-label">Date (AAAA-MM-JJ)</span>
              <input class="f1111-input" type="date" />
            </div>
            <div class="f1111-field-row">
              <span class="f1111-label">Contract Serial No.</span>
              <input class="f1111-input" type="text" value="${escapeHtml(contractNo)}" />
            </div>
          </div>
        </header>

        <main class="f1111-body">
          <div class="f1111-block f1111-block-wide">
            <div class="f1111-block-title">Description / Rapport</div>
            <textarea class="f1111-input f1111-textarea" rows="4" placeholder="Résumé (par ex. Claims 1-137, changement de taux de taxe, etc.)"></textarea>
          </div>

          <div class="f1111-table-wrapper">
            <table class="f1111-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Current claim (HT)</th>
                  <th>Tax rate</th>
                  <th>Tax amount</th>
                  <th>Total to date</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><textarea class="f1111-input f1111-textarea" rows="2"></textarea></td>
                  <td><input class="f1111-input" type="number" step="0.01" /></td>
                  <td><input class="f1111-input" type="text" /></td>
                  <td><input class="f1111-input" type="number" step="0.01" /></td>
                  <td><input class="f1111-input" type="number" step="0.01" /></td>
                </tr>
                <tr>
                  <td><textarea class="f1111-input f1111-textarea" rows="2"></textarea></td>
                  <td><input class="f1111-input" type="number" step="0.01" /></td>
                  <td><input class="f1111-input" type="text" /></td>
                  <td><input class="f1111-input" type="number" step="0.01" /></td>
                  <td><input class="f1111-input" type="number" step="0.01" /></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="f1111-totals">
            <div class="f1111-total-line">
              <span>Subtotal (HT)</span>
              <input class="f1111-input" type="number" step="0.01" />
            </div>
            <div class="f1111-total-line">
              <span>Applicable taxes</span>
              <input class="f1111-input" type="number" step="0.01" />
            </div>
            <div class="f1111-total-line f1111-total-main">
              <span>Total amount of claim (TTC)</span>
              <input class="f1111-input" type="number" step="0.01" />
            </div>
          </div>
        </main>
      </section>

      <!-- Page 2 (certificats & signatures) -->
      <section class="f1111-page">
        <header class="f1111-header f1111-header--small">
          <div class="f1111-header-left">
            <div class="f1111-gov-block">Formulaire 1111 - Certificats</div>
          </div>
          <div class="f1111-header-right">
            <div class="f1111-field-row">
              <span class="f1111-label">Contract Serial No.</span>
              <input class="f1111-input" type="text" value="${escapeHtml(contractNo)}" />
            </div>
            <div class="f1111-field-row">
              <span class="f1111-label">Claim No.</span>
              <input class="f1111-input" type="text" value="${escapeHtml(claimNo)}" />
            </div>
          </div>
        </header>

        <main class="f1111-body f1111-body--certs">
          <div class="f1111-cert-grid">
            <div class="f1111-cert-block">
              <div class="f1111-cert-title">Certificate of contractor</div>
              <div class="f1111-cert-static">(texte contractuel fixe du client)</div>
              <div class="f1111-cert-sign-row">
                <div>
                  <div class="f1111-label">Project manager</div>
                  <input class="f1111-input" type="text" placeholder="Nom" />
                </div>
                <div>
                  <div class="f1111-label">Date</div>
                  <input class="f1111-input" type="date" />
                </div>
              </div>
              <div class="f1111-cert-sign-row">
                <div>
                  <div class="f1111-label">Contractor's signature</div>
                  <input class="f1111-input" type="text" placeholder="Nom du signataire" />
                </div>
              </div>
            </div>

            <div class="f1111-cert-block">
              <div class="f1111-cert-title">Certificates of departmental representatives</div>
              <div class="f1111-cert-static">(texte contractuel fixe du client)</div>
              <div class="f1111-cert-sign-row">
                <div>
                  <div class="f1111-label">Representative name / title</div>
                  <input class="f1111-input" type="text" />
                </div>
                <div>
                  <div class="f1111-label">Date</div>
                  <input class="f1111-input" type="date" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </section>
    </div>
  `;
}

function attachRowGlow(tr) {
  // Ajoute un effet lumineux au survol et permet l'édition
  tr.addEventListener("mouseenter", () => {
    tr.style.backgroundColor = "rgba(200, 220, 255, 0.3)";
  });
  tr.addEventListener("mouseleave", () => {
    tr.style.backgroundColor = "";
  });
  
  // Double-click pour éditer
  tr.addEventListener("dblclick", () => {
    makeRowEditable(tr);
  });
}

function makeRowEditable(tr) {
  // Rendre les cellules éditables au double-clic
  const cells = tr.querySelectorAll("td:not(:last-child)");
  cells.forEach((cell) => {
    if (cell.querySelector("input, select")) return; // Déjà éditable
    const value = cell.textContent;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.style.width = "100%";
    cell.innerHTML = "";
    cell.appendChild(input);
    input.focus();
  });
}

function renderRegistre() {
  renderRegistreHeader();
  const tbody = document.getElementById("regBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const filtered = getRegistreFilteredClaims();

  

  filtered.forEach((c) => {
    const tr = document.createElement("tr");
    const { ht, ttc, taxRate } = computeAmounts(c);

    // Étape
    const tdStep = document.createElement("td");
    const inputStep = document.createElement("input");
    inputStep.type = "text";
    inputStep.value = c.step || "";
    if (!isReadOnly()) {
      inputStep.addEventListener("input", () => {
        c.step = inputStep.value;
        scheduleSaveClaim(c.id, () => ({ step: c.step }));
      });
      inputStep.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          // Force le save immédiat
          scheduleSaveClaim(c.id, () => ({ step: c.step }), { immediate: true });
        }
      });
    } else inputStep.disabled = true;
    tdStep.appendChild(inputStep);
    tr.appendChild(tdStep);

    // Type
    const tdType = document.createElement("td");
    const selType = document.createElement("select");
    ["milestone", "dcr"].forEach((t) => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      if (c.type === t) o.selected = true;
      selType.appendChild(o);
    });
    if (!isReadOnly()) {
      selType.addEventListener("change", () => {
        c.type = selType.value;
        // Changement discret: sauvegarde immédiate
        scheduleSaveClaim(c.id, () => ({ type: c.type }), { immediate: true });
      });
    } else selType.disabled = true;
    tdType.appendChild(selType);
    tr.appendChild(tdType);

    // Projet
    const tdProj = document.createElement("td");
    const selProj = document.createElement("select");
    state.projects.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.code;
      o.textContent = p.code;
      if (c.project?.code === p.code) o.selected = true;
      selProj.appendChild(o);
    });
    if (!isReadOnly()) {
      selProj.addEventListener("change", () => {
        const selectedCode = selProj.value;
        const selectedProject = state.projects.find(p => p.code === selectedCode);
        c.project = selectedProject ? { id: selectedProject.id, code: selectedProject.code } : null;
        c.projectCode = selectedCode;
        // Changement discret: sauvegarde immédiate
        scheduleSaveClaim(
          c.id,
          () => ({
            projectCode: selectedCode,
            project: c.project
          }),
          { immediate: true }
        );
      });
    } else selProj.disabled = true;
    tdProj.appendChild(selProj);
    tr.appendChild(tdProj);

    // Date
    const tdDate = document.createElement("td");
    const inputDate = document.createElement("input");
    inputDate.type = "date";
    inputDate.value = c.invoiceDate ? c.invoiceDate.slice(0, 10) : "";
    if (!isReadOnly()) {
      const applyInvoiceDate = () => {
        c.invoiceDate = inputDate.value ? new Date(inputDate.value).toISOString() : null;
      };
      // Date = changement discret -> sauvegarde immédiate
      inputDate.addEventListener("change", () => {
        applyInvoiceDate();
        scheduleSaveClaim(c.id, () => ({ invoiceDate: c.invoiceDate }), { immediate: true });
      });
      inputDate.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          applyInvoiceDate();
          scheduleSaveClaim(c.id, () => ({ invoiceDate: c.invoiceDate }), { immediate: true });
        }
      });
    } else inputDate.disabled = true;
    tdDate.appendChild(inputDate);
    tr.appendChild(tdDate);

    // Description
    const tdDesc = document.createElement("td");
    const inputDesc = document.createElement("input");
    inputDesc.type = "text";
    inputDesc.value = c.description || "";
    if (!isReadOnly()) {
      inputDesc.addEventListener("input", () => {
        c.description = inputDesc.value;
        scheduleSaveClaim(c.id, () => ({ description: c.description }));
      });
      inputDesc.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          scheduleSaveClaim(c.id, () => ({ description: c.description }), { immediate: true });
        }
      });
    } else inputDesc.disabled = true;
    tdDesc.appendChild(inputDesc);
    tr.appendChild(tdDesc);

    // Province
    const tdProv = document.createElement("td");
    const selProv = document.createElement("select");
    state.taxes.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.province;
      o.textContent = t.province;
      if (c.province === t.province) o.selected = true;
      selProv.appendChild(o);
    });
    if (!isReadOnly()) {
      selProv.addEventListener("change", () => {
        // Mettre à jour automatiquement le taux de taxe selon la province
        const selectedProv = selProv.value;
        const taxInfo = state.taxes.find(t => t.province === selectedProv);
        if (taxInfo && inputTax) {
          // Convertir le taux décimal (0.14) en pourcentage (14)
          inputTax.value = (taxInfo.rate * 100).toFixed(0) || 0;
        }
        // Recalculer TTC (convertir le pourcentage en décimal)
        const ht = parseMoney(inputHt.value);
        const ratePercent = Number(inputTax.value) || 0;
        const rate = ratePercent / 100;
        const newTtc = ht * (1 + rate);
        tdTtc.textContent = formatMoney(newTtc) + " $";
        // Autosave province + taxRate
        c.province = selectedProv;
        c.taxRate = ratePercent / 100;
        // Changement discret: sauvegarde immédiate
        scheduleSaveClaim(
          c.id,
          () => ({
            province: c.province,
            taxRate: c.taxRate,
            amountTTC: ht * (1 + c.taxRate)
          }),
          { immediate: true }
        );
      });
    } else selProv.disabled = true;
    tdProv.appendChild(selProv);
    tr.appendChild(tdProv);

    // Taxe (en pourcentage)
    const tdTax = document.createElement("td");
    const inputTax = document.createElement("input");
    inputTax.type = "number";
    inputTax.step = "1";
    inputTax.value = taxRate; // déjà en pourcentage (14 au lieu de 0.14)
    if (!isReadOnly()) {
      inputTax.addEventListener("input", () => {
        // Recalculer TTC quand la taxe change (convertir le pourcentage en décimal)
        const ht = parseMoney(inputHt.value);
        const ratePercent = Number(inputTax.value) || 0;
        const rate = ratePercent / 100;
        const newTtc = ht * (1 + rate);
        tdTtc.textContent = formatMoney(newTtc) + " $";
        c.taxRate = rate;
        c.amountTTC = newTtc;
        scheduleSaveClaim(c.id, () => ({
          taxRate: c.taxRate,
          amountTTC: c.amountTTC
        }));
      });
      inputTax.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          scheduleSaveClaim(
            c.id,
            () => ({
              taxRate: c.taxRate,
              amountTTC: c.amountTTC
            }),
            { immediate: true }
          );
        }
      });
    } else inputTax.disabled = true;
    tdTax.appendChild(inputTax);
    tr.appendChild(tdTax);

    // Montant HT
    const tdHt = document.createElement("td");
    const inputHt = document.createElement("input");
    inputHt.type = "text";
    inputHt.className = "money-input";
    inputHt.value = formatMoney(ht) + " $";
    if (!isReadOnly()) {
      inputHt.addEventListener("focus", () => {
        const raw = parseMoney(inputHt.value);
        inputHt.value = raw ? raw.toFixed(2) : "";
      });
      inputHt.addEventListener("input", () => {
        const raw = parseMoney(inputHt.value);
        c.amountHT = raw;
        // Recalculer TTC (convertir le pourcentage en décimal)
        const ratePercent = Number(inputTax.value) || 0;
        const rate = ratePercent / 100;
        const newTtc = raw * (1 + rate);
        c.amountTTC = newTtc;
        tdTtc.textContent = formatMoney(newTtc) + " $";
        // Autosave
        scheduleSaveClaim(c.id, () => ({
          amountHT: c.amountHT,
          amountTTC: c.amountTTC
        }));
      });
      inputHt.addEventListener("blur", () => {
        const raw = parseMoney(inputHt.value);
        inputHt.value = formatMoney(raw) + " $";
        // Recalculer TTC (convertir le pourcentage en décimal)
        const ratePercent = Number(inputTax.value) || 0;
        const rate = ratePercent / 100;
        const newTtc = raw * (1 + rate);
        c.amountHT = raw;
        c.amountTTC = newTtc;
        tdTtc.textContent = formatMoney(newTtc) + " $";
        // Force le save immédiat
        scheduleSaveClaim(
          c.id,
          () => ({
            amountHT: c.amountHT,
            amountTTC: c.amountTTC
          }),
          { immediate: true }
        );
      });
      inputHt.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          scheduleSaveClaim(
            c.id,
            () => ({
              amountHT: c.amountHT,
              amountTTC: c.amountTTC
            }),
            { immediate: true }
          );
        }
      });
    } else inputHt.disabled = true;
    tdHt.appendChild(inputHt);
    tr.appendChild(tdHt);

    // Montant TTC
    const tdTtc = document.createElement("td");
    tdTtc.textContent = formatMoney(ttc) + " $";
    tdTtc.style.textAlign = "right";
    tr.appendChild(tdTtc);

    // N° facture
    const tdNo = document.createElement("td");
    const inputNo = document.createElement("input");
    inputNo.type = "text";
    inputNo.value = c.invoiceNumber || "";
    if (!isReadOnly()) {
      inputNo.addEventListener("input", () => {
        c.invoiceNumber = inputNo.value;
        scheduleSaveClaim(c.id, () => ({ invoiceNumber: c.invoiceNumber }));
      });
      inputNo.addEventListener("blur", () => {
        c.invoiceNumber = inputNo.value;
        scheduleSaveClaim(c.id, () => ({ invoiceNumber: c.invoiceNumber }), { immediate: true });
      });
      inputNo.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          scheduleSaveClaim(c.id, () => ({ invoiceNumber: c.invoiceNumber }), { immediate: true });
        }
      });
    } else inputNo.disabled = true;
    tdNo.appendChild(inputNo);
    tr.appendChild(tdNo);

    // Statut
    const tdStatus = document.createElement("td");
    const selStatus = document.createElement("select");
    ["", "À facturer", "Facturé", "Approuvé", "Payé", "Annulé"].forEach(
      (s) => {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = s || "—";
        if ((c.status || "") === s) o.selected = true;
        selStatus.appendChild(o);
      }
    );
    if (!isReadOnly()) {
      selStatus.addEventListener("change", () => {
        c.status = selStatus.value || null;
        // Changement discret: sauvegarde immédiate
        scheduleSaveClaim(c.id, () => ({ status: c.status }), { immediate: true });
      });
    } else selStatus.disabled = true;
    tdStatus.appendChild(selStatus);
    tr.appendChild(tdStatus);

    // Actions
    const tdAct = document.createElement("td");
    const btnInsert = document.createElement("button");
    btnInsert.className = "mini-btn";
    btnInsert.textContent = "⬇";
    btnInsert.title = "Ajouter une ligne en dessous";

    const btnView = document.createElement("button");
    btnView.className = "mini-btn";
    btnView.textContent = "👁";
    btnView.title = "Voir la claim dans l’archive";

    const btnDel = document.createElement("button");
    btnDel.className = "mini-btn danger";
    btnDel.textContent = "🗑";
    btnDel.title = "Supprimer";

    const saveInd = document.createElement("span");
    saveInd.id = `save-indicator-${c.id}`;
    saveInd.style.cssText = 'display:inline-block;min-width:16px;margin-left:6px;opacity:0.9;';

    if (!isReadOnly()) {
      btnInsert.addEventListener("click", () => insertClaimBelow(c.id));
      btnDel.addEventListener("click", () => deleteClaim(c.id));
      btnView.addEventListener("click", () => openClaimArchive(c.id));
    } else {
      btnInsert.disabled = true;
      btnDel.disabled = true;
      btnView.disabled = true;
    }

    tdAct.appendChild(btnInsert);
    tdAct.appendChild(btnView);
    tdAct.appendChild(btnDel);
    tdAct.appendChild(saveInd);
    tr.appendChild(tdAct);

    // Initialiser l'indicateur selon l'état actuel
    updateClaimSaveIndicator(c.id);

    // Effet lumineux + click-to-lock
    attachRowGlow(tr);
    tbody.appendChild(tr);
  });

  const badgeReg = document.getElementById("badgeRegistre");
  if (badgeReg) badgeReg.textContent = state.claims.length;

  renderRegistreSummary(filtered);
  renderArchive();
  renderAudit();
}

// En-tête du registre (stub minimal pour éviter l'erreur)
function renderRegistreHeader() {
  const header = document.getElementById("registreHeader");
  if (!header) return;
  header.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div>
          <h3 style="margin:0;">Registre</h3>
          <small style="color:#666;">Liste des claims (filtrée)</small>
        </div>
        <div>
          <button id="btnAddClaim" class="btn">➕ Ajouter une ligne</button>
        </div>
      </div>
    </div>
  `;
}


async function insertClaimBelow(refId) {
  try {
    // Éviter d'écraser des modifications locales non encore persistées
    await flushPendingClaimSaves();

    const refIndex = state.claims.findIndex((c) => c.id === refId);
    const ref = state.claims[refIndex];
    if (!ref) return;
    const { taxRate } = computeAmounts(ref);

    // Récupérer les filtres actifs pour que la nouvelle ligne reste visible
    const typeFilter = document.getElementById("filterRegType")?.value || "all";
    const projFilter = document.getElementById("filterRegProjet")?.value || "all";
    const statFilter = document.getElementById("filterRegStatut")?.value || "all";
    const searchFilter = (document.getElementById("filterRegSearch")?.value || "").trim();

    // Générer un step unique pour éviter les conflits 409
    let newStep = searchFilter || ref.step || "";
    if (newStep) {
      // Ajouter un suffixe incrémental pour éviter les doublons (ex: 10.1b -> 10.1b-1, 10.1b-2...)
      let counter = 1;
      const baseStep = newStep;
      while (state.claims.some(c => c.step === newStep)) {
        newStep = `${baseStep}-${counter}`;
        counter++;
      }
    }

    // Créer une nouvelle ligne qui respecte les filtres actifs ET hérite de la ligne de référence
    const payload = {
      type: typeFilter !== "all" ? typeFilter : ref.type,
      step: newStep || null,
      projectCode: projFilter !== "all" ? projFilter : (ref.project?.code || null),
      invoiceDate: null,
      description: "",
      province: ref.province || null,
      taxRate,
      amountHT: 0,
      amountTTC: 0,
      invoiceNumber: "",
      status: statFilter !== "all" ? statFilter : (ref.status || "À facturer"),
      extraC228: null,
      extraC229: null,
      extraC230: null,
      extraC231: null,
      extraNLT5: null,
      extraNLT6: null
    };

    const created = await apiPost("/claims", payload);
    console.log('[addLineDirectly] Claim créée par backend:', created);
    
    // Recharger SEULEMENT les claims depuis le serveur pour avoir toutes les relations
    const freshClaims = await apiGet("/claims");
    console.log('[addLineDirectly] Claims rechargées, total:', freshClaims?.length);
    state.claims = freshClaims;
    
    // Re-rendre avec les nouvelles données, les filtres DOM restent intacts
    renderRegistre();
    renderBilan();
    renderRapport();
  } catch (e) {
    console.error(e);
    alert("Erreur lors de l’ajout de la ligne.");
  }
}

async function deleteClaim(id) {
  if (!confirm("Supprimer cette claim ?")) return;
  try {
    await apiDelete("/claims/" + id);
    await loadData();
  } catch (e) {
    console.error(e);
    alert("Erreur lors de la suppression.");
  }
}

function openClaimArchive(claimId) {
  // Basculer vers l'onglet Archive
  showTab("archive");
  // Sélectionner la claim
  state.archiveSelectedClaimId = claimId;
  // Re-rendre l'archive avec la claim sélectionnée
  renderArchive();
  renderArchiveDetail();
}

async function addClaim() {
  try {
    const firstProject = state.projects[0]?.code || null;
    const defaultProv = state.settings?.defaultProvMs || "QC";
    const tax = state.taxes.find((t) => t.province === defaultProv);
    const taxRate = tax ? tax.rate : 0;

    // Get current search to set step
    const filterSearch = document.getElementById("filterRegSearch")?.value?.trim() || "";

    const payload = {
      type: "milestone",
      step: filterSearch || null,
      projectCode: firstProject,
      invoiceDate: null,
      description: "",
      province: defaultProv,
      taxRate,
      amountHT: 0,
      amountTTC: 0,
      invoiceNumber: "",
      status: "À facturer",
      extraC228: null,
      extraC229: null,
      extraC230: null,
      extraC231: null,
      extraNLT5: null,
      extraNLT6: null
    };
    const result = await apiPost("/claims", payload);
    console.log('[addClaim] Claim créée avec succès:', result);
    
    // Ajouter la nouvelle claim à state.claims au lieu de tout recharger
    // (pour ne pas écraser les modifications en cours sur d'autres claims)
    state.claims.push(result);
    console.log('[addClaim] Claim ajoutée, total claims:', state.claims.length);

    // Do not reset filters, keep them to show the new claim if it matches
    renderRegistre();
    renderBilan();
    renderRapport();
  } catch (e) {
    console.error(e);
    alert("Erreur lors de l’ajout de la claim.");
  }
}

function sumClaims(claimsList, filter) {
  return claimsList
    .filter(filter)
    .reduce((sum, claim) => {
      const amounts = computeAmounts(claim);
      return sum + (amounts.ht || 0);  // ✅ Utiliser HT au lieu de TTC
    }, 0);
}

function renderRegistreSummary(claimsList) {
  const container = document.getElementById("regSummary");
  if (!container) return;
  container.innerHTML = "";

  // Le pourcentage doit toujours se baser sur Facturé + À facturer,
  // sans être biaisé par un filtre statut/recherche/date. On ne garde
  // que les filtres Type / Projet pour le calcul.
  const typeFilter = document.getElementById("filterRegType")?.value || "all";
  const projFilterRaw = document.getElementById("filterRegProjet")?.value;
  const projFilter = (projFilterRaw === '' || !projFilterRaw) ? "all" : projFilterRaw;

  // Base : toutes les claims, restreintes éventuellement par type/projet
  const baseClaims = (state.claims || []).filter((c) => {
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (projFilter !== "all" && c.project?.code !== projFilter) return false;
    return true;
  });

  console.log('[renderRegistreSummary] Claims utilisées (type/projet):', baseClaims.length);

  // On n'affiche que les projets concernés si un projet est sélectionné
  const projectsToShow = projFilter === "all"
    ? state.projects
    : state.projects.filter((p) => p.code === projFilter);

  projectsToShow.forEach((p) => {
    const claimsProj = baseClaims.filter((c) => c.project?.code === p.code);
    if (!claimsProj.length) return;

    const totalFacture = sumClaims(
      claimsProj,
      (c) => c.status === "Facturé"
    );
    const totalAFact = sumClaims(
      claimsProj,
      (c) => c.status === "À facturer"
    );
    const totalPayé = sumClaims(claimsProj, (c) => c.status === "Payé");
    const totalActif = totalFacture + totalAFact;
    
    console.log(`[Résumé ${p.code}]`, {
      totalClaims: claimsProj.length,
      facturé: totalFacture,
      aFacturer: totalAFact,
      payé: totalPayé,
      actif: totalActif
    });

    // Calcul du pourcentage de progression (facturé / total actif)
    // Si totalActif = 0 mais qu'il y a des claims, ça peut être des claims 'Brouillon' ou autre
    const progression = totalActif > 0 ? (totalFacture / totalActif) * 100 : 0;
    
    // Totaux par type (milestone vs DCR)
    const milestones = claimsProj.filter(c => c.type === 'milestone');
    const dcrs = claimsProj.filter(c => c.type === 'dcr');
    
    const milestoneFacture = sumClaims(milestones, c => c.status === "Facturé");
    const milestoneTotal = sumClaims(milestones, c => c.status === "Facturé" || c.status === "À facturer");
    const milestoneProgress = milestoneTotal > 0 ? (milestoneFacture / milestoneTotal) * 100 : 0;
    
    const dcrFacture = sumClaims(dcrs, c => c.status === "Facturé");
    const dcrTotal = sumClaims(dcrs, c => c.status === "Facturé" || c.status === "À facturer");
    const dcrProgress = dcrTotal > 0 ? (dcrFacture / dcrTotal) * 100 : 0;

    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML =
      '<div style="font-weight: bold; font-size: 1.2em; margin-bottom: 15px; color: #333;">' +
      p.code +
      '</div>' +
      '<div style="text-align: center; margin-bottom: 8px;">' +
        '<div style="font-size: 0.75em; color: #666; margin-bottom: 2px;">Facturé</div>' +
        '<div style="font-weight: bold; font-size: 1.3em;">' + formatMoney(totalFacture) + ' $</div>' +
      '</div>' +
      '<div style="text-align: center; margin-bottom: 8px;">' +
        '<div style="font-size: 0.75em; color: #666; margin-bottom: 2px;">À facturer</div>' +
        '<div style="font-weight: bold; font-size: 1.3em; color: #007bff;">' + formatMoney(totalAFact) + ' $</div>' +
      '</div>' +
      '<div style="text-align: center; padding-top: 8px; border-top: 1px solid #eee;">' +
        '<div style="font-weight: bold; font-size: 1.5em; color: #28a745;">' + progression.toFixed(1) + '%</div>' +
        '<div style="font-size: 0.75em; color: #666;">Progression</div>' +
      '</div>';
    container.appendChild(card);
  });

  if (!container.children.length) {
    container.innerHTML =
      '<div class="muted">Aucune donnée pour l’instant.</div>';
  }
}

// === BILAN ==========================================================
function renderBilanHeader() {
  const thead = document.getElementById("bilanHead");
  if (!thead) return;
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  const cols = [
    "Étape",
    "Projet",
    "Type",
    "Date",
    "Description",
    "Province",
    "Montant HT",
    "Montant TTC",
    "No facture",
    "Statut"
  ];
  cols.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
}

function renderBilan() {
  renderBilanHeader();
  const tbody = document.getElementById("bilanBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const typeFilter = document.getElementById("filterBilanType")?.value || "all";
  const projFilter =
    document.getElementById("filterBilanProjet")?.value || "all";
  const statFilter =
    document.getElementById("filterBilanStatut")?.value || "all";
  const search = (document.getElementById("filterBilanSearch")?.value || "")
    .trim()
    .toLowerCase();
  const sortStep =
    document.getElementById("filterBilanSortStep")?.value || "none";

  let lines = state.claims.filter((c) => {
    if (!c.status) return false;
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (projFilter !== "all" && c.project?.code !== projFilter) return false;
    if (statFilter !== "all" && c.status !== statFilter) return false;

    if (search) {
      const step = (c.step || "").toLowerCase();
      const desc = (c.description || "").toLowerCase();
      const proj = (c.project?.code || "").toLowerCase();
      const inv = (c.invoiceNumber || "").toLowerCase();
      const internalName = (c.extraC228 || "").toLowerCase();
      const clientName = (c.extraC229 || "").toLowerCase();
      if (
        !step.includes(search) &&
        !desc.includes(search) &&
        !proj.includes(search) &&
        !inv.includes(search) &&
        !internalName.includes(search) &&
        !clientName.includes(search)
      ) {
        return false;
      }
    }
    return true;
  });

  if (sortStep === "asc" || sortStep === "desc") {
    lines = [...lines].sort((a, b) => {
      const sa = (a.step || "").toString();
      const sb = (b.step || "").toString();
      const cmp = sa.localeCompare(sb, "fr", {
        numeric: true,
        sensitivity: "base"
      });
      return sortStep === "asc" ? cmp : -cmp;
    });
  }

  lines.forEach((c) => {
    let { ht, ttc } = computeAmounts(c);
    if (c.status === "Annulé") {
      ht = 0;
      ttc = 0;
    }
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" +
      (c.step || "") +
      "</td>" +
      "<td>" +
      (c.project?.code || "") +
      "</td>" +
      "<td>" +
      c.type +
      "</td>" +
      "<td>" +
      (c.invoiceDate ? c.invoiceDate.slice(0, 10) : "") +
      "</td>" +
      "<td>" +
      (c.description || "") +
      "</td>" +
      "<td>" +
      (c.province || "") +
      "</td>" +
      "<td style='text-align:right;'>" +
      formatMoney(ht) +
      " $</td>" +
      "<td style='text-align:right;'>" +
      formatMoney(ttc) +
      " $</td>" +
      "<td>" +
      (c.invoiceNumber || "") +
      "</td>" +
      '<td><span class="status-badge status-' +
      (c.status || "").replace(/\s/g, "") +
      '">' +
      (c.status || "") +
      "</span></td>";
    // Effet lumineux + click-to-lock
    attachRowGlow(tr);
    tbody.appendChild(tr);
  });

  const badgeBilan = document.getElementById("badgeBilan");
  if (badgeBilan) badgeBilan.textContent = state.claims.length;

  const summary = document.getElementById("bilanSummary");
  if (!summary) return;
  summary.innerHTML = "";
  state.projects.forEach((p) => {
    const projLines = lines.filter((c) => c.project?.code === p.code);
    if (!projLines.length) return;

    const total = projLines.reduce((acc, c) => {
      const base = c.status === "Annulé" ? 0 : computeAmounts(c).ht;
      return acc + base;
    }, 0);
    const aFact = projLines.reduce((acc, c) => {
      return acc + (c.status === "À facturer" ? computeAmounts(c).ht : 0);
    }, 0);
    const fact = projLines.reduce((acc, c) => {
      return acc + (c.status === "Facturé" ? computeAmounts(c).ht : 0);
    }, 0);
    const paye = projLines.reduce((acc, c) => {
      return acc + (c.status === "Payé" ? computeAmounts(c).ht : 0);
    }, 0);
    const actif = aFact + fact;

    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML =
      '<div class="summary-label">' +
      p.code +
      " – " +
      p.label +
      "</div>" +
      '<div class="summary-value">' +
      formatMoney(total) +
      " $ (HT)</div>" +
      "<div>" +
      '<span class="summary-tag">À facturer : ' +
      formatMoney(aFact) +
      " $</span>" +
      '<span class="summary-tag">Facturé : ' +
      formatMoney(fact) +
      " $</span>" +
      '<span class="summary-tag">Payé : ' +
      formatMoney(paye) +
      " $</span>" +
      '<span class="summary-tag">Actif (F + À F) : ' +
      formatMoney(actif) +
      " $</span>" +
      "</div>";
    summary.appendChild(card);
  });

  if (!summary.children.length) {
    summary.innerHTML = '<div class="muted">Bilan vide pour l’instant.</div>';
  }
}

// === RAPPORT =======================================================
function renderRapport() {
  const container = document.getElementById("rapportGlobal");
  if (!container) return;
  container.innerHTML = "";

  const valid = state.claims.filter(
    (c) => c.status && c.status !== "Annulé"
  );

  const env = state.settings || {};
  const contratHT = env.contractHT || 0;
  const contratTTC = env.contractTTC || 0;

  const totalFacture = sumClaims(valid, (c) => c.status === "Facturé");
  const totalAFacturer = sumClaims(valid, (c) => c.status === "À facturer");
  const totalPaye = sumClaims(valid, (c) => c.status === "Payé");
  const totalFactureEtAFacturer = totalFacture + totalAFacturer;
  const montantRestant = Math.max(0, contratHT - totalFactureEtAFacturer);

  const pctFacture = contratHT ? (totalFacture / contratHT) * 100 : 0;
  const pctAFacturer = contratHT ? (totalAFacturer / contratHT) * 100 : 0;
  const pctPaye = contratHT ? (totalPaye / contratHT) * 100 : 0;

  const kpiHtml = `
    <div class="report-kpi-grid">
      <div class="kpi-card success">
        <div class="kpi-title">Total facturé</div>
        <div class="kpi-value">${formatMoney(totalFacture)} $</div>
        <div class="kpi-sub">${pctFacture.toFixed(1)} % du contrat HT</div>
      </div>
      <div class="kpi-card warning">
        <div class="kpi-title">À facturer</div>
        <div class="kpi-value">${formatMoney(totalAFacturer)} $</div>
        <div class="kpi-sub">${pctAFacturer.toFixed(1)} % du contrat HT</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-title">Payé</div>
        <div class="kpi-value">${formatMoney(totalPaye)} $</div>
        <div class="kpi-sub">${pctPaye.toFixed(1)} % du contrat HT</div>
      </div>
      <div class="kpi-card danger">
        <div class="kpi-title">Montant restant (HT)</div>
        <div class="kpi-value">${formatMoney(montantRestant)} $</div>
        <div class="kpi-sub">Sur base du contrat HT</div>
      </div>
    </div>
  `;

  const projectCards = state.projects
    .map((p) => {
      const projLines = valid.filter((c) => c.project?.code === p.code);
      if (!projLines.length) return "";

      const facture = projLines.reduce((acc, c) => {
        return acc + (c.status === "Facturé" ? computeAmounts(c).ht : 0);
      }, 0);

      const aFacturer = projLines.reduce((acc, c) => {
        return acc + (c.status === "À facturer" ? computeAmounts(c).ht : 0);
      }, 0);

      const paye = projLines.reduce((acc, c) => {
        return acc + (c.status === "Payé" ? computeAmounts(c).ht : 0);
      }, 0);

      return `
        <div class="project-card">
          <div class="project-title">${p.code} – ${p.label}</div>
          <div class="project-line factured"><span>Facturé</span><span>${formatMoney(facture)} $</span></div>
          <div class="project-line pending"><span>À facturer</span><span>${formatMoney(aFacturer)} $</span></div>
          <div class="project-line paid"><span>Payé</span><span>${formatMoney(paye)} $</span></div>
        </div>
      `;
    })
    .filter(Boolean)
    .join("");

  const contractGrid = `
    <div class="contract-grid">
      <div class="contract-card">
        <div class="contract-label">Contrat HT</div>
        <div class="contract-value highlight">${formatMoney(contratHT)} $</div>
      </div>
      <div class="contract-card">
        <div class="contract-label">Contrat TTC</div>
        <div class="contract-value highlight">${formatMoney(contratTTC)} $</div>
      </div>
      <div class="contract-card">
        <div class="contract-label">Facturé + À facturer</div>
        <div class="contract-value">${formatMoney(totalFactureEtAFacturer)} $</div>
      </div>
      <div class="contract-card danger">
        <div class="contract-label">Reste à facturer (HT)</div>
        <div class="contract-value">${formatMoney(montantRestant)} $</div>
      </div>
    </div>
  `;

  container.innerHTML = `
    ${kpiHtml}
    <div class="report-section">
      <h3>Par projet</h3>
      <div class="project-summary-grid">
        ${projectCards || '<div class="muted">Aucun projet avec données.</div>'}
      </div>
    </div>
    <div class="report-section">
      <h3>Milestones par projet</h3>
      <div class="project-milestone-grid">
        ${state.projects
          .map((p) => {
            const projLines = valid.filter((c) => c.project?.code === p.code && c.type === "milestone");
            if (!projLines.length) return "";
            const totalMsProj = projLines.reduce((acc, c) => acc + computeAmounts(c).ht, 0);
            return `
              <div class="milestone-card">
                <div class="project-title">${p.code} – ${p.label}</div>
                <div class="project-line"><span>Total milestones</span><span>${formatMoney(totalMsProj)} $</span></div>
              </div>
            `;
          })
          .filter(Boolean)
          .join("") || '<div class="muted">Aucun total de milestone disponible.</div>'}
      </div>
    </div>
    <div class="report-section">
      <h3>Contrat & Statuts</h3>
      ${contractGrid}
    </div>
  `;
}

// === ARCHIVE =======================================================

// Nom affiché sur une claim dans l’archive
function getArchiveDisplayName(c) {
  return (
    c.extraC229 || // nom client
    c.extraC228 || // nom interne
    c.step ||
    c.description ||
    ""
  );
}

// Génération d’une référence automatique si absente
function generateClaimRef(claimId) {
  const claimsSorted = [...state.claims];
  const index = claimsSorted.findIndex((c) => c.id === claimId);
  const num = index === -1 ? claimsSorted.length : index + 1;
  return "Claim-" + String(num).padStart(3, "0");
}

// Construire l'URL absolue d'un fichier stocké côté backend
function getFileUrl(file) {
  if (!file || !file.url) return "#";
  if (file.url.startsWith("http://") || file.url.startsWith("https://")) {
    return file.url;
  }
  // API_BASE = "http://localhost:4000/api" => on remplace /api par ""
  const base = API_BASE.replace(/\/api\/?$/, "");
  return base + file.url;
}

// Assainir les noms de fichiers pour compatibilité Windows/ZIP
function sanitizeFileName(name) {
  const base = (name || "fichier");
  // Supprime les accents et remplace caractères non sûrs
  return base
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 200);
}

// Charger les fichiers persistants d'une claim
async function fetchClaimFiles(claimId) {
  try {
    const files = await apiGet(`/claims/${claimId}/files`);
    return Array.isArray(files) ? files : [];
  } catch (e) {
    console.error("Erreur chargement fichiers claim", e);
    return [];
  }
}

// Upload d'un seul fichier pour une claim
async function uploadSingleClaimFile(claimId, file, category = "invoice") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);

  const res = await fetch(`${API_BASE}/claims/${claimId}/files`, {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Upload échoué: ${res.status} ${txt}`);
  }

  return res.json();
}

// Upload de plusieurs fichiers (facture ou fichier de claim)
async function handleArchiveUpload(claimId, files, category = "invoice") {
  if (!files || !files.length) return;
  if (isReadOnly()) {
    alert("Mode lecture seule : upload de fichiers non autorisé.");
    return;
  }
  try {
    for (const f of Array.from(files)) {
      await uploadSingleClaimFile(claimId, f, category);
    }
    await renderArchiveDetail(); // recharger la liste persistante
  } catch (e) {
    console.error(e);
    alert("Erreur lors de l'upload du fichier.");
  }
}

// Remplacer un fichier existant par un nouveau
async function replaceClaimFile(fileId, claimId, newFile, category) {
  if (isReadOnly()) {
    alert("Mode lecture seule : remplacement de fichiers non autorisé.");
    return;
  }
  try {
    // On supprime d'abord l'ancien (route backend: /claims/:claimId/files/:fileId)
    await apiDelete(`/claims/${claimId}/files/${fileId}`);
    // Puis on upload le nouveau
    await uploadSingleClaimFile(claimId, newFile, category || "invoice");
    await renderArchiveDetail();
  } catch (e) {
    console.error(e);
    alert("Erreur lors du remplacement du fichier.");
  }
}

// Mise à jour des métadonnées (noms + ref) d’une claim depuis l’archive
async function updateClaimArchiveMeta(claimId, internalName, clientName) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim) return;

  const ref = claim.extraC230 || generateClaimRef(claimId);
  const { ht } = computeAmounts(claim);
  const taxRate = claim.taxRate || 0;

  const body = {
    type: claim.type,
    step: claim.step || null,
    projectCode: claim.project?.code || null,
    invoiceDate: claim.invoiceDate || null,
    description: claim.description || null,
    province: claim.province || null,
    taxRate,
    amountHT: ht,
    amountTTC: ht * (1 + taxRate),
    invoiceNumber: claim.invoiceNumber || null,
    status: claim.status || null,
    extraC228: internalName || null,
    extraC229: clientName || null,
    extraC230: ref,
    extraC231: claim.extraC231 || null,
    extraNLT5: claim.extraNLT5 || null,
    extraNLT6: claim.extraNLT6 || null
  };

  try {
    const updated = await apiPut("/claims/" + claimId, body);
    const idx = state.claims.findIndex((c) => c.id === claimId);
    if (idx !== -1) state.claims[idx] = updated;
    renderArchive();
    renderRegistre();
    renderBilan();
    renderRapport();
  } catch (e) {
    console.error(e);
    alert("Erreur lors de la mise à jour du nom de claim.");
  }
}

function renderArchive() {
  const listEl = document.getElementById("archiveList");
  const countEl = document.getElementById("archiveCount");
  if (!listEl || !countEl) return;

  listEl.innerHTML = "";
  let claims = [...(state.claims || [])];

  const searchTerm = (
    document.getElementById("archiveSearch")?.value || ""
  )
    .trim()
    .toLowerCase();
  const sortMode = document.getElementById("archiveSort")?.value || "recent";

  // Filtre recherche
  if (searchTerm) {
    claims = claims.filter((c) => {
      const name = getArchiveDisplayName(c).toLowerCase();
      const step = (c.step || "").toLowerCase();
      const proj = (c.project?.code || "").toLowerCase();
      return (
        name.includes(searchTerm) ||
        step.includes(searchTerm) ||
        proj.includes(searchTerm)
      );
    });
  }

  // Tri
  claims.sort((a, b) => {
    if (sortMode === "name-asc" || sortMode === "name-desc") {
      const na = getArchiveDisplayName(a) || a.step || "";
      const nb = getArchiveDisplayName(b) || b.step || "";
      const cmp = na.localeCompare(nb, "fr", { sensitivity: "base" });
      return sortMode === "name-asc" ? cmp : -cmp;
    }
    // "recent" -> date décroissante puis id
    const da = a.invoiceDate || "";
    const db = b.invoiceDate || "";
    if (da !== db) return db.localeCompare(da);
    return String(b.id || "").localeCompare(String(a.id || ""));
  });

  countEl.textContent = claims.length
    ? claims.length + " claims"
    : "Aucune claim";

  claims.forEach((c) => {
    const { ht } = computeAmounts(c);
    const displayName = getArchiveDisplayName(c) || "Sans nom";
    const ref = c.extraC230 || "";

    const btn = document.createElement("button");
    btn.className =
      "archive-item" +
      (state.archiveSelectedClaimId === c.id ? " is-active" : "");
    btn.innerHTML =
      '<div class="archive-item-main">' +
      '<div class="archive-item-step">' +
      displayName +
      (ref
        ? ' <span class="summary-tag" style="margin-left:4px;">' +
          ref +
          "</span>"
        : "") +
      "</div>" +
      '<span class="archive-item-project">' +
      (c.project?.code || "—") +
      "</span>" +
      "</div>" +
      '<div class="archive-item-meta">' +
      (c.step ? "Étape: " + c.step + " · " : "") +
      (c.invoiceDate ? c.invoiceDate.slice(0, 10) : "Date non définie") +
      " · " +
      formatMoney(ht) +
      " $" +
      "</div>";
    btn.addEventListener("click", () => {
      state.archiveSelectedClaimId = c.id;
      renderArchive();
      renderArchiveDetail();
    });
    listEl.appendChild(btn);
  });

  renderArchiveDetail();
}

// === APERÇU D'UN FICHIER D'ARCHIVE ================================

function renderArchiveFilePreview(file) {
  const preview = document.getElementById("archivePreview");
  if (!preview) return;

  if (!file) {
    preview.className = "archive-preview-empty";
    preview.innerHTML =
      "Sélectionne un fichier dans la liste pour afficher un aperçu.";
    return;
  }

  const url = getFileUrl(file);
  const mime = (file.mimeType || file.type || "").toLowerCase();
  const isPdf =
    mime.includes("pdf") || (file.name || "").toLowerCase().endsWith(".pdf");
  const isImage =
    mime.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");

  let headerHtml = `
    <div class="archive-preview-header">
      <div>
        <div class="title">${file.name}</div>
        <div class="meta">
          ${(file.category || "fichier")} · ${(file.size / 1024).toFixed(1)} Ko
        </div>
      </div>
      <a href="${url}" target="_blank" rel="noopener" class="link">
        Ouvrir dans un onglet
      </a>
    </div>
  `;

  let contentHtml = "";
  if (isPdf) {
    contentHtml = `<iframe src="${url}#zoom=100" class="archive-preview-frame"></iframe>`;
  } else if (isImage) {
    contentHtml = `
      <div class="archive-preview-image-wrapper">
        <img src="${url}" alt="${file.name}" />
      </div>
    `;
  } else {
    contentHtml = `
      <div class="archive-preview-empty">
        Aperçu non disponible pour ce type de fichier (${mime || "inconnu"}).<br/>
        Utilise le lien "Ouvrir dans un onglet" pour le consulter.
      </div>
    `;
  }

  preview.className = "archive-preview";
  preview.innerHTML = headerHtml + contentHtml;
}

async function renderArchiveDetail() {
  const container = document.getElementById("archiveDetail");
  const empty = document.getElementById("archiveDetailEmpty");
  if (!container || !empty) return;

  const id = state.archiveSelectedClaimId;
  const claim = state.claims.find((c) => c.id === id);

  if (!claim) {
    empty.style.display = "block";
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  empty.style.display = "none";
  container.style.display = "block";

  const { ht, ttc, taxRate } = computeAmounts(claim);
  const proj = claim.project || {};

  // 🔁 Fichiers persistants depuis le backend
  const rawFiles = await fetchClaimFiles(id);

  // On mémorise ces fichiers pour l'audit, avec URL absolue
  const files = rawFiles.map((f) => ({
    ...f,
    url: getFileUrl(f)
  }));
  state.archiveFiles[id] = files;
  // Mise à jour de l'onglet Audit pour les compteurs "Importer (n)"
  renderAudit();

  const internalName =
    claim.extraC228 || claim.step || claim.description || "";
  const clientName = claim.extraC229 || internalName;
  const ref = claim.extraC230 || generateClaimRef(id);

  container.innerHTML = `
    <div class="archive-detail-header">
      <div>
        <div class="archive-detail-title">
          Claim #${claim.id || ""} – ${(claim.step || "Sans étape")}
        </div>
        <div class="archive-detail-meta">
          Projet ${(proj.code || "–")} · ${(proj.label || "")}
        </div>
      </div>
      <div class="archive-detail-meta">
        Statut : <strong>${claim.status || "—"}</strong>
      </div>
    </div>

    <!-- Bloc noms + référence -->
    <div class="archive-fields">
      <div>
        <div class="archive-field-label">Nom interne de la claim</div>
        <input
          type="text"
          id="archiveInternalName"
          class="archive-name-input"
          value="${internalName.replace(/"/g, "&quot;")}"
        />
      </div>
      <div>
        <div class="archive-field-label">Nom affiché au client</div>
        <input
          type="text"
          id="archiveClientName"
          class="archive-name-input"
          value="${clientName.replace(/"/g, "&quot;")}"
        />
      </div>
      <div>
        <div class="archive-field-label">Référence automatique</div>
        <div class="archive-field-value">
          <span id="archiveRef">${ref}</span>
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;justify-content:flex-end;">
        <button class="mini-btn" id="btnArchiveSaveMeta">Enregistrer le nom</button>
      </div>
    </div>

    <!-- Infos financières / facturation -->
    <div class="archive-fields">
      <div>
        <div class="archive-field-label">Type</div>
        <div class="archive-field-value">${claim.type || "—"}</div>
      </div>
      <div>
        <div class="archive-field-label">Date claim</div>
        <div class="archive-field-value">${
          claim.invoiceDate ? claim.invoiceDate.slice(0,10) : "Non définie"
        }</div>
      </div>
      <div>
        <div class="archive-field-label">Montant HT</div>
        <div class="archive-field-value">${formatMoney(ht)} $</div>
      </div>
      <div>
        <div class="archive-field-label">Montant TTC</div>
        <div class="archive-field-value">${formatMoney(ttc)} $</div>
      </div>
      <div>
        <div class="archive-field-label">Province</div>
        <div class="archive-field-value">${claim.province || "—"}</div>
      </div>
      <div>
        <div class="archive-field-label">Taxe</div>
        <div class="archive-field-value">${taxRate || 0}</div>
      </div>
      <div>
        <div class="archive-field-label">No facture</div>
        <div class="archive-field-value">${claim.invoiceNumber || "—"}</div>
      </div>
      <div>
        <div class="archive-field-label">Description</div>
        <div class="archive-field-value">${claim.description || "—"}</div>
      </div>
    </div>

    <div class="archive-files">
      <div class="archive-files-header">
        <span>Factures &amp; fichiers de la claim</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <label class="btn secondary archive-upload">
            Importer facture
            <input type="file" id="archiveInvoiceInput" multiple />
          </label>
          <label class="btn secondary archive-upload">
            Importer fichier claim
            <input type="file" id="archiveClaimInput" multiple />
          </label>
        </div>
      </div>
      <ul class="archive-files-list" id="archiveFilesList"></ul>
    </div>

    <!-- Aperçu du document sélectionné -->
    <div class="archive-preview-pane">
      <div id="archivePreview" class="archive-preview-empty">
        Sélectionne un fichier dans la liste pour afficher un aperçu.
      </div>
    </div>
  `;

  // Bouton "Enregistrer le nom"
  const btnSaveMeta = container.querySelector("#btnArchiveSaveMeta");
  const inputInternal = container.querySelector("#archiveInternalName");
  const inputClient = container.querySelector("#archiveClientName");

  if (btnSaveMeta && inputInternal && inputClient) {
    btnSaveMeta.addEventListener("click", () => {
      if (isReadOnly()) {
        alert("Mode lecture seule : modification non autorisée.");
        return;
      }
      updateClaimArchiveMeta(id, inputInternal.value, inputClient.value);
    });
  }

  // Liste des fichiers
  const list = container.querySelector("#archiveFilesList");
  if (!list) return;

  list.innerHTML = "";

  if (!files.length) {
    const li = document.createElement("li");
    li.innerHTML =
      '<span class="muted">Aucun fichier importé pour cette claim pour le moment.</span>';
    list.appendChild(li);
    renderArchiveFilePreview(null);
  } else {
    files.forEach((f) => {
      const li = document.createElement("li");
      li.dataset.fileId = f.id;
      li.dataset.category = f.category || "invoice";

      const sizeKb = (f.size / 1024).toFixed(1);
      const dt = new Date(f.uploadedAt);
      const categoryLabel = f.category === "claim" ? "Fichier claim" : "Facture";

      const isPdf =
        (f.mimeType || f.type || "").toLowerCase().includes("pdf") ||
        (f.name || "").toLowerCase().endsWith(".pdf");

      const url = f.url; // déjà absolue

      li.innerHTML = `
        <div class="archive-file-main">
          <div class="archive-file-name">
            ${f.name}
            <span class="summary-tag" style="margin-left:4px;">${categoryLabel}</span>
          </div>
          <div class="archive-file-meta">
            ${sizeKb} Ko · ${dt.toLocaleString("fr-CA")}
          </div>
        </div>
        <div class="archive-file-actions">
          <a class="mini-btn" href="${url}" download="${f.name}">Télécharger</a>
          ${
            isPdf
              ? '<button class="mini-btn" data-action="preview">Aperçu</button>'
              : ""
          }
          <button class="mini-btn" data-action="replace">Remplacer</button>
          <button class="mini-btn danger" data-action="delete">Supprimer</button>
          <input type="file" class="archive-replace-input" style="display:none;" />
        </div>
      `;

      // Clic sur la ligne entière => aperçu (sauf sur la zone actions)
      li.addEventListener("click", (e) => {
        if (e.target.closest(".archive-file-actions")) return;
        renderArchiveFilePreview(f);
      });

      // Aperçu (PDF)
      if (isPdf) {
        const btnPreview = li.querySelector('[data-action="preview"]');
        if (btnPreview) {
          btnPreview.addEventListener("click", (e) => {
            e.stopPropagation();
            renderArchiveFilePreview(f);
          });
        }
      }

      // Supprimer
      const btnDelete = li.querySelector('[data-action="delete"]');
      if (btnDelete) {
        btnDelete.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (isReadOnly()) {
            alert("Mode lecture seule : suppression non autorisée.");
            return;
          }
          if (!confirm(`Supprimer le fichier "${f.name}" ?`)) return;
          try {
            // backend: DELETE /claims/:claimId/files/:fileId
            await apiDelete(`/claims/${id}/files/${f.id}`);
            await renderArchiveDetail();
          } catch (err) {
            console.error(err);
            alert("Erreur lors de la suppression du fichier.");
          }
        });
      }

      // Remplacer
      const btnReplace = li.querySelector('[data-action="replace"]');
      const inputReplace = li.querySelector(".archive-replace-input");
      if (btnReplace && inputReplace) {
        btnReplace.addEventListener("click", (e) => {
          e.stopPropagation();
          inputReplace.click();
        });
        inputReplace.addEventListener("change", (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const category = li.dataset.category || "invoice";
          replaceClaimFile(f.id, id, file, category);
          e.target.value = "";
        });
      }

      list.appendChild(li);
    });

    // Aperçu du premier fichier par défaut
    renderArchiveFilePreview(files[0]);
  }

  // Imports : facture / fichier claim
  const invoiceInput = container.querySelector("#archiveInvoiceInput");
  const claimInput = container.querySelector("#archiveClaimInput");

  if (invoiceInput) {
    invoiceInput.onchange = (e) => {
      handleArchiveUpload(id, e.target.files, "invoice");
      e.target.value = "";
    };
  }
  if (claimInput) {
    claimInput.onchange = (e) => {
      handleArchiveUpload(id, e.target.files, "claim");
      e.target.value = "";
    };
  }
}

// === AUDIT =========================================================

// Claims filtrées pour l’onglet Audit (filtres + recherche + tri)
function getAuditFilteredClaims() {
  const dFrom = document.getElementById("auditDateFrom")?.value || "";
  const dTo = document.getElementById("auditDateTo")?.value || "";
  const typeFilter =
    document.getElementById("auditFilterType")?.value || "all";
  const statFilter =
    document.getElementById("auditFilterStatut")?.value || "all";
  const projFilter =
    document.getElementById("auditFilterProjet")?.value || "all";
  const search = (document.getElementById("auditSearch")?.value || "")
    .trim()
    .toLowerCase();
  const sortMode = document.getElementById("auditSort")?.value || "date-desc";

  let list = [...state.claims];

  // Filtres
  list = list.filter((c) => {
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (statFilter !== "all" && (c.status || "") !== statFilter) return false;
    if (projFilter !== "all" && c.project?.code !== projFilter) return false;

    if (dFrom || dTo) {
      const date = c.invoiceDate ? c.invoiceDate.slice(0, 10) : "";
      if (dFrom && (!date || date < dFrom)) return false;
      if (dTo && (!date || date > dTo)) return false;
    }

    // Recherche texte
    if (search) {
      const step = (c.step || "").toLowerCase();
      const desc = (c.description || "").toLowerCase();
      const proj = (c.project?.code || "").toLowerCase();
      const inv = (c.invoiceNumber || "").toLowerCase();
      const internalName = (c.extraC228 || "").toString().toLowerCase();
      const clientName = (c.extraC229 || "").toString().toLowerCase();

      if (
        !step.includes(search) &&
        !desc.includes(search) &&
        !proj.includes(search) &&
        !inv.includes(search) &&
        !internalName.includes(search) &&
        !clientName.includes(search)
      ) {
        return false;
      }
    }

    return true;
  });

  // Tri
  list.sort((a, b) => {
    // Tri par nom
    if (sortMode === "name-asc" || sortMode === "name-desc") {
      const na = (
        a.extraC229 ||
        a.extraC228 ||
        a.step ||
        a.description ||
        ""
      )
        .toString()
        .toLowerCase();
      const nb = (
        b.extraC229 ||
        b.extraC228 ||
        b.step ||
        b.description ||
        ""
      )
        .toString()
        .toLowerCase();

      const cmp = na.localeCompare(nb, "fr", { sensitivity: "base" });
      return sortMode === "name-asc" ? cmp : -cmp;
    }

    // Tri par date
    const da = a.invoiceDate || "";
    const db = b.invoiceDate || "";
    let cmp = db.localeCompare(da); // récent → ancien

    if (sortMode === "date-asc") {
      cmp = -cmp; // ancien → récent
    }

    return cmp;
  });

  return list;
}

function resetAuditState() {
  state.audit.active = false;
  state.audit.createdAt = null;
  state.audit.selectedClaimIds = new Set();
  state.audit.files = [];
  renderAudit();
}

function startNewAudit() {
  state.audit.active = true;
  state.audit.createdAt = new Date().toISOString();
  state.audit.selectedClaimIds = new Set();
  state.audit.files = [];
  renderAudit();
}

function toggleAuditSelection(claimId, checked) {
  if (!state.audit.active) {
    startNewAudit();
  }
  if (checked) {
    state.audit.selectedClaimIds.add(claimId);
  } else {
    state.audit.selectedClaimIds.delete(claimId);
  }
  renderAuditSide();
}

function addAuditFilesFromArchive(claimId) {
  if (!state.audit.active) {
    startNewAudit();
  }
  const files = state.archiveFiles[claimId] || [];

  // On ne prend que les factures (category !== "claim")
  files
    .filter((f) => (f.category || "invoice") === "invoice")
    .forEach((f) => {
      state.audit.files.push({
        claimId,
        name: f.name,
        url: f.url, // déjà absolue dans renderArchiveDetail
        size: f.size,
        uploadedAt: f.uploadedAt
      });
    });

  renderAuditSide();
}

function renderAuditSide() {
  const statusEl = document.getElementById("auditCurrentStatus");
  const listClaimsEl = document.getElementById("auditReceiptsList");
  const historyEl = document.getElementById("auditHistoryList");
  if (!statusEl || !listClaimsEl || !historyEl) return;

  listClaimsEl.innerHTML = "";
  historyEl.innerHTML = "";

  const nbClaims = state.audit.selectedClaimIds.size;
  const nbFiles = state.audit.files.length;

  if (!state.audit.active || nbClaims === 0) {
    statusEl.textContent = "Aucun audit en cours.";
  } else {
    statusEl.textContent =
      "Audit en cours : " +
      nbClaims +
      " claim(s) sélectionnée(s), " +
      nbFiles +
      " fichier(s) de facture rattaché(s).";
  }

  // ===== Claims sélectionnées (détails complets) ====================
  if (nbClaims > 0) {
    const selectedClaims = state.claims.filter((c) =>
      state.audit.selectedClaimIds.has(c.id)
    );
    selectedClaims.forEach((c) => {
      const { ht, ttc, taxRate } = computeAmounts(c);
      const li = document.createElement("li");
      li.className = "audit-list-item";

      const displayName = getArchiveDisplayName(c) || "Sans nom";
      const ref = c.extraC230 || generateClaimRef(c.id);
      const dateStr = c.invoiceDate ? c.invoiceDate.slice(0, 10) : "Date non définie";

      li.innerHTML = `
        <div class="audit-list-main">
          <div class="audit-list-title">
            ${displayName}
            <span class="summary-tag" style="margin-left:4px;">${ref}</span>
          </div>
          <div class="audit-list-meta">
            ${c.project?.code || "—"} · ${c.type} · ${dateStr}
          </div>
          <div class="audit-list-meta">
            Province : ${c.province || "—"}
            · Taxe : ${(taxRate || 0).toFixed(4)}
            · Montant HT : ${formatMoney(ht)} $
            · Montant TTC : ${formatMoney(ttc)} $
            · Statut : ${c.status || "—"}
            · Facture : ${c.invoiceNumber || "—"}
          </div>
        </div>
      `;
      listClaimsEl.appendChild(li);
    });
  } else {
    const li = document.createElement("li");
    li.className = "audit-list-item";
    li.innerHTML =
      '<span class="muted">Aucune claim sélectionnée pour l’instant.</span>';
    listClaimsEl.appendChild(li);
  }

  // ===== Factures ajoutées au dossier : MINIATURES ==================
  // ===== Factures ajoutées au dossier : MINIATURES ==================
  if (nbFiles > 0) {
    // mode grille
    historyEl.classList.add("audit-thumbs");

    // ---- Ajustement d'échelle selon la quantité -------------------
    // Base  : 190px
    // >10   : 150px
    // >20   : 120px
    let thumbWidth = 190;
    if (nbFiles > 10 && nbFiles <= 20) {
      thumbWidth = 150;
    } else if (nbFiles > 20) {
      thumbWidth = 120;
    }
    historyEl.style.setProperty("--audit-thumb-width", thumbWidth + "px");

    state.audit.files.forEach((f) => {
      const claim = state.claims.find((c) => c.id === f.claimId);
      const sizeKb = (f.size / 1024).toFixed(1);
      const claimLabel = claim
        ? `Claim #${claim.id} · ${claim.project?.code || "—"}`
        : "Claim inconnue";

      const li = document.createElement("li");
      li.className = "audit-thumb-item";

      li.innerHTML = `
        <button type="button" class="audit-thumb-card">
          <div class="audit-thumb-preview">📄</div>
          <div class="audit-thumb-name" title="${f.name}">
            ${f.name}
          </div>
          <div class="audit-thumb-meta">
            ${claimLabel} · ${sizeKb} Ko
          </div>
        </button>
      `;

      // ouverture dans un onglet au clic sur la vignette
      const btn = li.querySelector(".audit-thumb-card");
      btn.addEventListener("click", () => {
        window.open(f.url, "_blank");
      });

      historyEl.appendChild(li);
    });
  } else {
    historyEl.classList.remove("audit-thumbs");
    historyEl.style.removeProperty("--audit-thumb-width");

    const li = document.createElement("li");
    li.className = "audit-list-item";
    li.innerHTML =
      '<span class="muted">Aucune facture importée dans le dossier d’audit.</span>';
    historyEl.appendChild(li);
  }
}

function renderAudit() {
  const tbody = document.getElementById("auditClaimsBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const claims = getAuditFilteredClaims();

  claims.forEach((c) => {
    const { ht, ttc, taxRate } = computeAmounts(c);
    const tr = document.createElement("tr");

    // Checkbox
    const tdCheck = document.createElement("td");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = state.audit.selectedClaimIds.has(c.id);
    chk.addEventListener("change", () =>
      toggleAuditSelection(c.id, chk.checked)
    );
    tdCheck.appendChild(chk);
    tr.appendChild(tdCheck);

    // Étape
    const tdStep = document.createElement("td");
    tdStep.textContent = c.step || "";
    tr.appendChild(tdStep);

    // Projet
    const tdProj = document.createElement("td");
    tdProj.textContent = c.project?.code || "";
    tr.appendChild(tdProj);

    // Type
    const tdType = document.createElement("td");
    tdType.textContent = c.type;
    tr.appendChild(tdType);

    // Date
    const tdDate = document.createElement("td");
    tdDate.textContent = c.invoiceDate ? c.invoiceDate.slice(0, 10) : "";
    tr.appendChild(tdDate);

    // Montant HT
    const tdHt = document.createElement("td");
    tdHt.style.textAlign = "right";
    tdHt.textContent = formatMoney(ht) + " $";
    tr.appendChild(tdHt);

    // Taxe
    const tdTax = document.createElement("td");
    tdTax.style.textAlign = "right";
    tdTax.textContent = (Number(taxRate) || 0).toFixed(4);
    tr.appendChild(tdTax);

    // Montant TTC
    const tdTtc = document.createElement("td");
    tdTtc.style.textAlign = "right";
    tdTtc.textContent = formatMoney(ttc) + " $";
    tr.appendChild(tdTtc);

    // Statut
    const tdStatus = document.createElement("td");
    tdStatus.textContent = c.status || "";
    tr.appendChild(tdStatus);

    // Facture (import depuis archive)
    const tdFact = document.createElement("td");
    const files = state.archiveFiles[c.id] || [];
    if (files.length) {
      const btn = document.createElement("button");
      btn.className = "mini-btn";
      btn.textContent = "Importer (" + files.length + ")";
      btn.title =
        "Importer les factures depuis l’archive dans le dossier d’audit";
      btn.addEventListener("click", () => addAuditFilesFromArchive(c.id));
      tdFact.appendChild(btn);
    } else {
      tdFact.innerHTML =
        '<span class="muted">Aucune facture en archive</span>';
    }
    tr.appendChild(tdFact);

    tbody.appendChild(tr);
  });

  renderAuditSide();
}

// Génération du récapitulatif d'audit
function generateAuditRecap(selectedClaims) {
  let content = "╔════════════════════════════════════════════════════════════╗\n";
  content += "║         DOSSIER D'AUDIT - RÉCAPITULATIF DES CLAIMS         ║\n";
  content += "╚════════════════════════════════════════════════════════════╝\n\n";
  
  content += `Date de création: ${new Date().toLocaleString('fr-FR')}\n`;
  content += `Nombre de claims: ${selectedClaims.length}\n`;
  content += `Nombre de fichiers: ${state.audit.files.length}\n\n`;
  
  // Résumé financier
  let totalHT = 0, totalTTC = 0;
  selectedClaims.forEach(c => {
    const { ht, ttc } = computeAmounts(c);
    totalHT += ht;
    totalTTC += ttc;
  });
  
  content += "─ RÉSUMÉ FINANCIER ─\n";
  content += `Total Montant HT: ${formatMoney(totalHT)} $\n`;
  content += `Total Montant TTC: ${formatMoney(totalTTC)} $\n\n`;
  
  // Détails par statut
  const byStatus = selectedClaims.reduce((acc, c) => {
    const status = c.status || "Non défini";
    if (!acc[status]) {
      acc[status] = { count: 0, totalHT: 0, totalTTC: 0 };
    }
    const { ht, ttc } = computeAmounts(c);
    acc[status].count++;
    acc[status].totalHT += ht;
    acc[status].totalTTC += ttc;
    return acc;
  }, {});
  
  content += "─ PAR STATUT ─\n";
  Object.entries(byStatus).forEach(([status, data]) => {
    content += `\n${status}:\n`;
    content += `  - Nombre: ${data.count}\n`;
    content += `  - Montant HT: ${formatMoney(data.totalHT)} $\n`;
    content += `  - Montant TTC: ${formatMoney(data.totalTTC)} $\n`;
  });
  
  // Liste des claims
  content += "\n─ LISTE DES CLAIMS ─\n";
  selectedClaims.forEach((c, idx) => {
    const { ht, ttc } = computeAmounts(c);
    content += `\n${idx + 1}. ${c.step || "N/A"} - ${c.type}\n`;
    content += `   Projet: ${c.project?.code || "N/A"}\n`;
    content += `   Date: ${c.invoiceDate ? c.invoiceDate.slice(0, 10) : "N/A"}\n`;
    content += `   Description: ${c.description || "-"}\n`;
    content += `   Montant HT: ${formatMoney(ht)} $ | TTC: ${formatMoney(ttc)} $\n`;
    content += `   Statut: ${c.status || "N/A"}\n`;
    content += `   Facture: ${c.invoiceNumber || "N/A"}\n`;
  });
  
  content += "\n╔════════════════════════════════════════════════════════════╗\n";
  content += "║                    FIN DU RÉCAPITULATIF                    ║\n";
  content += "╚════════════════════════════════════════════════════════════╝\n";
  
  return content;
}

// Téléchargement du ZIP d’audit
async function downloadAuditZip() {
  if (!state.audit.active || state.audit.selectedClaimIds.size === 0) {
    alert("Sélectionnez au moins une claim pour générer un dossier d’audit.");
    return;
  }
  if (typeof JSZip === "undefined") {
    alert(
      "La librairie JSZip n’est pas chargée.\nAjoute dans index.html :\n<script src=\"https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js\"></script>"
    );
    return;
  }

  const zip = new JSZip();
  const selectedClaims = state.claims.filter((c) =>
    state.audit.selectedClaimIds.has(c.id)
  );

  // === EXCEL TEMPLATE ===
  if (typeof XLSX !== "undefined") {
    const wb = XLSX.utils.book_new();
    
    // Sheet 1: Détails des claims
    const rows = [];
    rows.push([
      "Étape",
      "Type",
      "Projet",
      "Date",
      "Description",
      "Province",
      "Taxe",
      "Montant HT",
      "Montant TTC",
      "Statut",
      "No facture"
    ]);
    
    let totalHT = 0, totalTTC = 0;
    selectedClaims.forEach((c) => {
      const { ht, ttc, taxRate } = computeAmounts(c);
      totalHT += ht;
      totalTTC += ttc;
      rows.push([
        c.step || "",
        c.type,
        c.project?.code || "",
        c.invoiceDate ? c.invoiceDate.slice(0, 10) : "",
        c.description || "",
        c.province || "",
        taxRate,
        Number(ht.toFixed(2)),
        Number(ttc.toFixed(2)),
        c.status || "",
        c.invoiceNumber || ""
      ]);
    });
    
    // Ajouter une ligne de total
    rows.push(["", "", "", "", "", "TOTAL", "", Number(totalHT.toFixed(2)), Number(totalTTC.toFixed(2)), "", ""]);
    
    const wsDetails = XLSX.utils.aoa_to_sheet(rows);
    // Définir la largeur des colonnes
    wsDetails['!cols'] = [
      {wch: 12}, // Étape
      {wch: 12}, // Type
      {wch: 10}, // Projet
      {wch: 12}, // Date
      {wch: 25}, // Description
      {wch: 10}, // Province
      {wch: 8},  // Taxe
      {wch: 15}, // Montant HT
      {wch: 15}, // Montant TTC
      {wch: 12}, // Statut
      {wch: 12}  // No facture
    ];
    XLSX.utils.book_append_sheet(wb, wsDetails, "Détails");
    
    // Sheet 2: Résumé
    const summaryRows = [
      ["Dossier d'audit"],
      ["Date de création", new Date().toISOString()],
      ["Nombre de claims", selectedClaims.length],
      [""],
      ["Résumé financier"],
      ["Total Montant HT", Number(totalHT.toFixed(2))],
      ["Total Montant TTC", Number(totalTTC.toFixed(2))],
      [""],
      ["Par statut"],
      ...Object.entries(
        selectedClaims.reduce((acc, c) => {
          const status = c.status || "Non défini";
          if (!acc[status]) acc[status] = 0;
          acc[status]++;
          return acc;
        }, {})
      ).map(([status, count]) => [status, count])
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Résumé");
    
    // Écrire directement dans le ZIP avec XLSX.write()
    const excelData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    // Forcer binaire pour compatibilité ZIP/Windows
    zip.file("audit-details.xlsx", excelData, { binary: true });
  }

  // Base JSON (écriture finale après traitement des fichiers)
  const auditJsonBase = {
    generatedAt: new Date().toISOString(),
    createdAt: state.audit.createdAt,
    nbClaims: selectedClaims.length,
    nbFilesSelected: state.audit.files.length,
    claims: selectedClaims.map((c) => {
      const { ht, ttc, taxRate } = computeAmounts(c);
      return {
        id: c.id,
        step: c.step,
        type: c.type,
        projet: c.project?.code || null,
        description: c.description,
        internalName: c.extraC228 || null,
        clientName: c.extraC229 || null,
        ref: c.extraC230 || null,
        date: c.invoiceDate || null,
        province: c.province || null,
        taxRate,
        amountHT: ht,
        amountTTC: ttc,
        invoiceNumber: c.invoiceNumber || null,
        status: c.status || null
      };
    })
  };

  // CSV simple
  const csvRows = [];
  csvRows.push(
    [
      "id",
      "ref",
      "step",
      "internalName",
      "clientName",
      "projet",
      "type",
      "date",
      "province",
      "taxRate",
      "amountHT",
      "amountTTC",
      "invoiceNumber",
      "status"
    ].join(";")
  );
  selectedClaims.forEach((c) => {
    const { ht, ttc, taxRate } = computeAmounts(c);
    csvRows.push(
      [
        c.id,
        c.extraC230 || "",
        (c.step || "").replace(/;/g, ","),
        (c.extraC228 || "").replace(/;/g, ","),
        (c.extraC229 || "").replace(/;/g, ","),
        c.project?.code || "",
        c.type,
        c.invoiceDate ? c.invoiceDate.slice(0, 10) : "",
        c.province || "",
        taxRate,
        ht.toFixed(2),
        ttc.toFixed(2),
        c.invoiceNumber || "",
        c.status || ""
      ].join(";")
    );
  });
  zip.file("audit.csv", csvRows.join("\n"), { binary: false });

  // Factures jointes (ajoute celles sélectionnées et complète avec les factures des claims sélectionnées)
  const facturesFolder = zip.folder("factures");
  const filesToZip = [...state.audit.files];
  try {
    const selectedIds = selectedClaims.map((c) => c.id);
    const existingByClaim = new Set(filesToZip.map((x) => x.claimId));
    for (const id of selectedIds) {
      if (!existingByClaim.has(id)) {
        const backendFiles = await fetchClaimFiles(id);
        backendFiles
          .filter((ff) => (ff.category || 'invoice') === 'invoice')
          .forEach((ff) => {
            filesToZip.push({
              claimId: id,
              name: ff.name,
              url: getFileUrl(ff),
              size: ff.size,
              uploadedAt: ff.uploadedAt
            });
          });
      }
    }
  } catch (e) {
    console.warn('Complément factures depuis backend impossible:', e);
  }

  // Compteurs par claim pour suffixe séquentiel + collecte mapping export
  const exportedFiles = [];
  const perClaimCounters = new Map();
  const fetchLogs = [];
  for (const f of filesToZip) {
    try {
      if (!f.url || f.url === '#') continue;
      // Ne pas inclure les credentials pour éviter un échec CORS (serveur autorise origin "*")
      const res = await fetch(f.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      // Préparer un nom strict et unique: claim-<id>-<ref>-<invoice>-<NN>.<ext>
      const original = f.name || 'fichier';
      const dot = original.lastIndexOf('.');
      const ext = dot > -1 ? sanitizeFileName(original.slice(dot + 1)).toLowerCase() : '';
      const baseNoExt = dot > -1 ? original.slice(0, dot) : original;

      const claim = f.claimId ? state.claims.find(c => c.id === f.claimId) : null;
      const ref = claim ? (claim.extraC230 || generateClaimRef(claim.id)) : '';
      const invoice = claim ? (claim.invoiceNumber || '') : '';

      const parts = [];
      if (f.claimId) parts.push('claim-' + f.claimId);
      if (ref) parts.push('ref-' + sanitizeFileName(ref));
      if (invoice) parts.push('inv-' + sanitizeFileName(invoice));
      if (parts.length === 0) parts.push('piece');

      // Compteur séquentiel par claim
      const key = f.claimId ? String(f.claimId) : 'global';
      const current = perClaimCounters.get(key) || 0;
      const nextIdx = current + 1;
      perClaimCounters.set(key, nextIdx);
      parts.push(String(nextIdx).padStart(2, '0'));

      let fileName = parts.join('-');
      if (ext) fileName += '.' + ext;
      fileName = sanitizeFileName(fileName);
      facturesFolder.file(fileName, arrayBuffer, { binary: true });
      exportedFiles.push({
        claimId: f.claimId ?? null,
        sourceName: f.name ?? null,
        sourceUrl: f.url ?? null,
        finalName: fileName,
        size: (typeof f.size === 'number' ? f.size : blob.size) || null
      });
      fetchLogs.push(`[OK] claim:${f.claimId ?? '-'} name:${f.name ?? '-'} url:${f.url}`);
    } catch (e) {
      console.warn("Impossible d’ajouter un fichier au ZIP :", f.name, e);
      fetchLogs.push(`[ERR] claim:${f.claimId ?? '-'} name:${f.name ?? '-'} url:${f.url} -> ${e?.message || e}`);
      exportedFiles.push({
        claimId: f.claimId ?? null,
        sourceName: f.name ?? null,
        sourceUrl: f.url ?? null,
        finalName: null,
        error: String(e?.message || e)
      });
    }
  }

  // Journal des téléchargements de pièces pour debug utilisateur
  if (fetchLogs.length) {
    zip.file('audit-files.log', fetchLogs.join('\n'), { binary: false });
  }

  // Écriture finale du JSON avec mapping des fichiers exportés
  const finalJson = {
    ...auditJsonBase,
    nbFilesExported: exportedFiles.filter(x => x.finalName).length,
    filesExported: exportedFiles
  };
  zip.file("audit.json", JSON.stringify(finalJson, null, 2));

  // Récapitulatif texte (nom ASCII pour éviter les avertissements)
  const recap = generateAuditRecap(selectedClaims);
  zip.file("audit-recap.txt", recap, { binary: false });

  const blobZip = await zip.generateAsync({ type: "blob", compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const dateStr = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);

  // Si disponible, préfère File System Access API pour réduire les avertissements Windows
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "audit-rfacto-" + dateStr + ".zip",
        types: [{ description: 'Archive ZIP', accept: { 'application/zip': ['.zip'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blobZip);
      await writable.close();
      // Fin sans passer par ObjectURL
      return;
    } catch (e) {
      console.warn('Sauvegarde via File System Access annulée ou indisponible, fallback download.', e);
    }
  }

  // Fallback: lien de téléchargement
  const url = URL.createObjectURL(blobZip);
  const a = document.createElement("a");
  a.href = url;
  a.download = "audit-rfacto-" + dateStr + ".zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// === PROJETS / TAXES / SETTINGS / TEAM ==============================
function renderProjects() {
  const tbody = document.getElementById("projBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  state.projects.forEach((p, idx) => {
    const taxOptions = state.taxes.map((t) => t.province);
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="text" value="' +
      p.code +
      '" data-idx="' +
      idx +
      '" data-field="code" /></td>' +
      '<td><input type="text" value="' +
      p.label +
      '" data-idx="' +
      idx +
      '" data-field="label" /></td>' +
      "<td>" +
      '<select data-idx="' +
      idx +
      '" data-field="taxProvince">' +
      '<option value="">(aucune)</option>' +
      taxOptions
        .map(
          (prov) =>
            '<option value="' +
            prov +
            '" ' +
            (p.taxProvince === prov ? "selected" : "") +
            ">" +
            prov +
            "</option>"
        )
        .join("") +
      "</select>" +
      "</td>" +
      '<td><button class="mini-btn danger" data-idx="' +
      idx +
      '">Supprimer</button></td>';
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", async () => {
      if (isSettingsReadOnly()) {
        alert("Seuls les administrateurs peuvent modifier les projets.");
        return;
      }
      const idx = Number(el.getAttribute("data-idx"));
      const field = el.getAttribute("data-field");
      const proj = state.projects[idx];
      if (!proj) return;
      const body = {
        code: proj.code,
        label: proj.label,
        taxProvince: proj.taxProvince
      };
      if (field === "code") body.code = el.value;
      else if (field === "label") body.label = el.value;
      else if (field === "taxProvince") body.taxProvince = el.value || null;

      try {
        const updated = await apiPut("/projects/" + proj.id, body);
        state.projects[idx] = updated;
        renderFiltersProjects();
        renderRegistre();
        renderBilan();
        renderRapport();
        renderProjects();
      } catch (e) {
        console.error(e);
        alert(
          "Erreur lors de la mise à jour du projet : " + (e.message || "")
        );
      }
    });
  });

  tbody.querySelectorAll("button.mini-btn.danger").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (isSettingsReadOnly()) {
        alert("Seuls les administrateurs peuvent supprimer des projets.");
        return;
      }
      const idx = Number(btn.getAttribute("data-idx"));
      const proj = state.projects[idx];
      if (!proj) return;
      if (!confirm("Supprimer ce projet ?")) return;
      await apiDelete("/projects/" + proj.id);
      await loadData();
    });
  });
}

function renderTaxes() {
  const tbody = document.getElementById("taxBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  state.taxes.forEach((t, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="text" value="' +
      t.province +
      '" data-idx="' +
      idx +
      '" data-field="province" /></td>' +
      '<td><input type="number" step="0.0001" value="' +
      t.rate +
      '" data-idx="' +
      idx +
      '" data-field="rate" /></td>' +
      '<td><button class="mini-btn danger" data-idx="' +
      idx +
      '">Supprimer</button></td>';
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", async () => {
      if (isSettingsReadOnly()) {
        alert("Seuls les administrateurs peuvent modifier les taxes.");
        return;
      }
      const idx = Number(input.getAttribute("data-idx"));
      const field = input.getAttribute("data-field");
      const tax = state.taxes[idx];
      if (!tax) return;
      const body = { province: tax.province, rate: tax.rate };
      if (field === "rate") body.rate = Number(input.value) || 0;
      else body.province = input.value;
      try {
        const updated = await apiPut("/taxes/" + tax.id, body);
        state.taxes[idx] = updated;
        renderFiltersProjects();
        renderRegistre();
        renderBilan();
        renderRapport();
        renderProjects();
      } catch (e) {
        console.error(e);
        alert(
          "Erreur lors de la mise à jour de la taxe : " + (e.message || "")
        );
      }
    });
  });

  tbody.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (isSettingsReadOnly()) {
        alert("Seuls les administrateurs peuvent supprimer des taxes.");
        return;
      }
      const idx = Number(btn.getAttribute("data-idx"));
      const tax = state.taxes[idx];
      if (!tax) return;
      if (!confirm("Supprimer cette ligne de taxe ?")) return;
      await apiDelete("/taxes/" + tax.id);
      await loadData();
    });
  });

  const selects = [
    document.getElementById("envDefaultProvMs"),
    document.getElementById("envDefaultProvDcr"),
    document.getElementById("envDefaultProvReserve")
  ];
  selects.forEach((sel) => {
    if (!sel) return;
    const current = sel.value || "";
    sel.innerHTML = "";
    state.taxes.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.province;
      opt.textContent = t.province;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });
}

function renderAmendments() {
  const projectSelect = document.getElementById("amendProjectSelect");
  const tbody = document.getElementById("amendBody");
  if (!projectSelect || !tbody) return;

  const projects = Array.isArray(state.projects) ? state.projects : [];
  const amendments = Array.isArray(state.amendments) ? state.amendments : [];

  // Populate projects select
  projectSelect.innerHTML = "";
  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = `${p.code} - ${p.label}`;
    projectSelect.appendChild(opt);
  });

  const currentId =
    state.selectedAmendmentProjectId != null
      ? String(state.selectedAmendmentProjectId)
      : (projects[0] ? String(projects[0].id) : "");
  if (currentId) {
    projectSelect.value = currentId;
    state.selectedAmendmentProjectId = Number(currentId);
  }

  const selectedProjectId = Number(projectSelect.value) || null;
  tbody.innerHTML = "";

  const rows = selectedProjectId
    ? amendments
        .filter((a) => Number(a.projectId) === selectedProjectId)
        .slice()
        .sort((a, b) => String(a.numero || "").localeCompare(String(b.numero || "")))
    : [];

  rows.forEach((a, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="text" value="' +
      (a.numero || "") +
      '" data-id="' +
      a.id +
      '" data-field="numero" /></td>' +
      '<td><input type="text" value="' +
      (a.designation || "") +
      '" data-id="' +
      a.id +
      '" data-field="designation" /></td>' +
      '<td><input type="number" step="0.01" value="' +
      (Number(a.amountHT) || 0) +
      '" data-id="' +
      a.id +
      '" data-field="amountHT" /></td>' +
      '<td><input type="number" step="0.01" value="' +
      (Number(a.amountTTC) || 0) +
      '" data-id="' +
      a.id +
      '" data-field="amountTTC" /></td>' +
      '<td><button class="mini-btn danger" data-id="' +
      a.id +
      '">Supprimer</button></td>';
    tbody.appendChild(tr);
  });

  // Change project selection
  projectSelect.onchange = () => {
    state.selectedAmendmentProjectId = Number(projectSelect.value) || null;
    renderAmendments();
  };

  // Inline update
  tbody.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", async () => {
      if (isSettingsReadOnly()) {
        alert("Seuls les administrateurs peuvent modifier les amendements.");
        return;
      }
      const id = Number(input.getAttribute("data-id"));
      const field = input.getAttribute("data-field");
      const amend = (state.amendments || []).find((x) => Number(x.id) === id);
      if (!amend) return;
      const body = {
        numero: amend.numero,
        designation: amend.designation,
        amountHT: amend.amountHT,
        amountTTC: amend.amountTTC,
      };
      if (field === "numero") body.numero = input.value;
      else if (field === "designation") body.designation = input.value;
      else if (field === "amountHT") body.amountHT = Number(input.value) || 0;
      else if (field === "amountTTC") body.amountTTC = Number(input.value) || 0;

      try {
        const updated = await apiPut("/amendments/" + id, body);
        const idx = state.amendments.findIndex((x) => Number(x.id) === id);
        if (idx >= 0) state.amendments[idx] = updated;
        renderAmendments();
      } catch (e) {
        console.error(e);
        alert("Erreur lors de la mise à jour de l'amendement : " + (e.message || ""));
      }
    });
  });

  // Delete
  tbody.querySelectorAll("button.mini-btn.danger").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (isSettingsReadOnly()) {
        alert("Seuls les administrateurs peuvent supprimer des amendements.");
        return;
      }
      const id = Number(btn.getAttribute("data-id"));
      if (!id) return;
      if (!confirm("Supprimer cet amendement ?")) return;
      try {
        await apiDelete("/amendments/" + id);
        state.amendments = (state.amendments || []).filter((x) => Number(x.id) !== id);
        renderAmendments();
      } catch (e) {
        console.error(e);
        alert("Erreur lors de la suppression : " + (e.message || ""));
      }
    });
  });

  // Add
  const addBtn = document.getElementById("btnAddAmendment");
  if (addBtn) {
    addBtn.onclick = async () => {
      if (isSettingsReadOnly()) {
        alert("Seuls les administrateurs peuvent ajouter des amendements.");
        return;
      }
      const pid = Number(projectSelect.value) || null;
      if (!pid) {
        alert("Choisissez un projet.");
        return;
      }

      const existing = new Set(
        amendments
          .filter((x) => Number(x.projectId) === pid)
          .map((x) => String(x.numero || "").trim())
          .filter(Boolean)
      );
      let i = existing.size + 1;
      let numero = "A" + String(i).padStart(2, "0");
      while (existing.has(numero)) {
        i++;
        numero = "A" + String(i).padStart(2, "0");
      }

      try {
        const created = await apiPost("/amendments", {
          projectId: pid,
          numero,
          designation: "Nouvel amendement",
          amountHT: 0,
          amountTTC: 0,
        });
        state.amendments.push(created);
        renderAmendments();
      } catch (e) {
        console.error(e);
        alert("Erreur lors de la création de l'amendement : " + (e.message || ""));
      }
    };
  }
}

async function saveSettings() {
  if (isSettingsReadOnly()) return;
  const envNum = document.getElementById("envContratNumero")?.value || "";
  const envHt = Number(
    document.getElementById("envContratHt")?.value || 0
  );
  const envTtc = Number(
    document.getElementById("envContratTtc")?.value || 0
  );
  const provMs = document.getElementById("envDefaultProvMs")?.value || "";
  const provDcr = document.getElementById("envDefaultProvDcr")?.value || "";
  const provRes = document.getElementById("envDefaultProvReserve")?.value || "";
  const proc1 = document.getElementById("procTaxDefault1")?.value || "";
  const proc2 = document.getElementById("procTaxDefault2")?.value || "";
  const proc3 = document.getElementById("procTaxDefault3")?.value || "";
  const delayAFacturer = Number(document.getElementById("delayAFacturer")?.value || 1);
  const delayFacture = Number(document.getElementById("delayFacture")?.value || 1);
  const delayPaye = Number(document.getElementById("delayPaye")?.value || 1);
  const delayAFacturerUnit = document.getElementById("delayAFacturerUnit")?.value || "month";
  const delayFactureUnit = document.getElementById("delayFactureUnit")?.value || "month";
  const delayPayeUnit = document.getElementById("delayPayeUnit")?.value || "month";

  // Colonnes
  const columns = {};
  const defaultColumns = {
    id: "ID",
    step: "Étape",
    type: "Type",
    project: "Projet",
    date: "Date",
    description: "Description",
    province: "Province",
    taxRate: "Taxe",
    amountHT: "Montant HT",
    amountTTC: "Montant TTC",
    status: "Statut",
    invoiceNumber: "No facture"
  };
  Object.keys(defaultColumns).forEach(key => {
    const input = document.getElementById("col" + key.charAt(0).toUpperCase() + key.slice(1));
    columns[key] = input?.value || defaultColumns[key];
  });

  const updated = await apiPut("/settings", {
    contractNumber: envNum || null,
    contractHT: envHt,
    contractTTC: envTtc,
    defaultProvMs: provMs,
    defaultProvDcr: provDcr,
    defaultProvReserve: provRes,
    processingTaxProv1: proc1 || null,
    processingTaxProv2: proc2 || null,
    processingTaxProv3: proc3 || null,
    delayAFacturer,
    delayFacture,
    delayPaye,
    delayAFacturerUnit,
    delayFactureUnit,
    delayPayeUnit,
    columnNames: JSON.stringify(columns)
  });
  state.settings = updated;
  renderRapport();
}

function renderSettings() {
  const s = state.settings || {};
  const envNum = document.getElementById("envContratNumero");
  const envHt = document.getElementById("envContratHt");
  const envTtc = document.getElementById("envContratTtc");
  if (envNum) envNum.value = s.contractNumber != null ? s.contractNumber : "";
  if (envHt) envHt.value = s.contractHT != null ? s.contractHT : 0;
  if (envTtc) envTtc.value = s.contractTTC != null ? s.contractTTC : 0;
    // Province par défaut selon taux
  
  const selMs = document.getElementById("envDefaultProvMs");
  const selDcr = document.getElementById("envDefaultProvDcr");
  const selRes = document.getElementById("envDefaultProvReserve");
  const proc1 = document.getElementById("procTaxDefault1");
  const proc2 = document.getElementById("procTaxDefault2");
  const proc3 = document.getElementById("procTaxDefault3");

  // Peupler les listes déroulantes de provinces
  [selMs, selDcr, selRes, proc1, proc2, proc3].forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = "";
    const optEmpty = document.createElement("option");
    optEmpty.value = "";
    optEmpty.textContent = "(aucune)";
    sel.appendChild(optEmpty);
    (state.taxes || []).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.province;
      opt.textContent = `${t.province} (${(Number(t.rate)||0)*100}% )`;
      sel.appendChild(opt);
    });
  });

  if (selMs)
    selMs.value = s.defaultProvMs || state.taxes?.[0]?.province || "";
  if (selDcr)
    selDcr.value = s.defaultProvDcr || state.taxes?.[0]?.province || "";
  if (selRes)
    selRes.value = s.defaultProvReserve || state.taxes?.[0]?.province || "";
  if (proc2) proc2.value = s.processingTaxProv2 || "";
  if (proc3) proc3.value = s.processingTaxProv3 || "";
  if (proc1) proc1.value = s.processingTaxProv1 || "";

  // Délais
  const delayAFacturer = document.getElementById("delayAFacturer");
  const delayFacture = document.getElementById("delayFacture");
  const delayPaye = document.getElementById("delayPaye");
  if (delayAFacturer) delayAFacturer.value = s.delayAFacturer != null ? s.delayAFacturer : 1;
  if (delayFacture) delayFacture.value = s.delayFacture != null ? s.delayFacture : 1;
  if (delayPaye) delayPaye.value = s.delayPaye != null ? s.delayPaye : 1;

  const delayAFacturerUnit = document.getElementById("delayAFacturerUnit");
  const delayFactureUnit = document.getElementById("delayFactureUnit");
  const delayPayeUnit = document.getElementById("delayPayeUnit");
  if (delayAFacturerUnit) delayAFacturerUnit.value = s.delayAFacturerUnit || "month";
  if (delayFactureUnit) delayFactureUnit.value = s.delayFactureUnit || "month";
  if (delayPayeUnit) delayPayeUnit.value = s.delayPayeUnit || "month";

  // Colonnes
  const defaultColumns = {
    id: "ID",
    step: "Étape",
    type: "Type",
    project: "Projet",
    date: "Date",
    description: "Description",
    province: "Province",
    taxRate: "Taxe",
    amountHT: "Montant HT",
    amountTTC: "Montant TTC",
    status: "Statut",
    invoiceNumber: "No facture"
  };
  const columns = s.columnNames ? JSON.parse(s.columnNames) : defaultColumns;
  Object.keys(defaultColumns).forEach(key => {
    const input = document.getElementById("col" + key.charAt(0).toUpperCase() + key.slice(1));
    if (input) input.value = columns[key] || defaultColumns[key];
  });
}

// === STUBS / HELPERS ================================================

function isReadOnly() {
  return USE_MOCK || (state.currentUser?.role === 'lecture');
}

function isSettingsReadOnly() {
  return USE_MOCK || (state.currentUser?.role !== 'admin');
}

function getRegistreFilteredClaims() {
  const typeFilter = document.getElementById("filterRegType")?.value || "all";
  const projFilter = document.getElementById("filterRegProjet")?.value || "all";
  const statFilter = document.getElementById("filterRegStatut")?.value || "all";
  const search = (document.getElementById("filterRegSearch")?.value || "").trim().toLowerCase();
  const sortStep = document.getElementById("filterRegSortStep")?.value || "none";
  
  const dateMode = document.querySelector('input[name="regDateMode"]:checked')?.value || "all";
  const dateFrom = document.getElementById("filterRegDateFrom")?.value || "";
  const dateTo = document.getElementById("filterRegDateTo")?.value || "";

  let filtered = (state.claims || []).filter((c) => {
    // Type
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    
    // Projet
    if (projFilter !== "all" && c.project?.code !== projFilter) return false;
    
    // Statut
    if (statFilter !== "all" && c.status !== statFilter) return false;
    
    // Période
    if (dateMode === "period" && c.invoiceDate) {
      const cDate = c.invoiceDate.slice(0, 10);
      if (dateFrom && cDate < dateFrom) return false;
      if (dateTo && cDate > dateTo) return false;
    }
    
    // Recherche
    if (search) {
      const searchable = [
        c.step,
        c.project?.code,
        c.description,
        c.province,
        c.invoiceNumber
      ].filter(Boolean).join(" ").toLowerCase();
      if (!searchable.includes(search)) return false;
    }
    
    return true;
  });

  // Tri par étape
  if (sortStep === "asc") {
    filtered.sort((a, b) => (a.step || "").localeCompare(b.step || ""));
  } else if (sortStep === "desc") {
    filtered.sort((a, b) => (b.step || "").localeCompare(a.step || ""));
  }

  return filtered;
}

function getAuditFilteredClaims() {
  // Retourner les claims filtrés selon les filtres audit (stub: tous les claims)
  return (state.claims || []);
}

function saveClaimRow(tr, claimId) {
  // Stub: sauvegarde une ligne de claim (utilisé par listeners)
  console.debug('saveClaimRow stub pour', claimId);
}

function computeAmounts(claim) {
  // Calculer HT, TTC, et taux d'une claim
  const ht = claim.amountHT || 0;
  const taxRate = claim.taxRate != null ? claim.taxRate : 0;
  const tax = ht * taxRate;
  const ttc = ht + tax;
  return { ht, ttc, tax, taxRate: (taxRate * 100).toFixed(0) };
}

function formatMoney(amount) {
  // Formater un montant en devise ($)
  const num = Number(amount || 0);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoney(str) {
  // Convertir une chaîne formatée en nombre
  if (!str) return 0;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Système d'autosave avec debounce
const claimSaveTimers = new Map(); // claimId -> timeoutId
const claimSaveStatus = new Map(); // claimId -> "saving" | "saved" | "error"
const claimPendingBuilders = new Map(); // claimId -> () => patch
const claimSaveInFlight = new Map(); // claimId -> Promise
const claimSaveErrorMsg = new Map(); // claimId -> string

function updateClaimSaveIndicator(claimId) {
  const el = document.getElementById(`save-indicator-${claimId}`);
  if (!el) return;
  const status = claimSaveStatus.get(claimId);
  if (status === 'saving') {
    el.textContent = '⏳';
    el.title = 'Sauvegarde en cours…';
  } else if (status === 'saved') {
    el.textContent = '✓';
    el.title = 'Sauvegardé';
  } else if (status === 'error') {
    el.textContent = '⚠';
    el.title = claimSaveErrorMsg.get(claimId) || 'Erreur de sauvegarde';
  } else {
    el.textContent = '';
    el.title = '';
  }
}

async function verifyClaimPersistedOnServer(claimId, patch) {
  // Vérification légère: si le backend renvoie des anciennes valeurs après un PUT,
  // on le signale clairement (sinon ça ressemble à un bug "mémoire" côté front).
  if (USE_MOCK) return;
  if (!isProdHost) return; // éviter de spammer en dev
  if (!patch || typeof patch !== 'object') return;

  const fieldsToCheck = Object.keys(patch).filter((k) => {
    // On vérifie surtout les champs qui posent problème en refresh
    return [
      'status',
      'invoiceNumber',
      'invoiceDate',
      'type',
      'projectCode',
      'province',
      'taxRate',
      'amountHT',
      'amountTTC'
    ].includes(k);
  });
  if (!fieldsToCheck.length) return;

  // Petite attente pour laisser le backend/DB finir
  await new Promise((r) => setTimeout(r, 300));

  let serverClaims;
  try {
    serverClaims = await apiGet('/claims');
  } catch (e) {
    // Si on ne peut pas relire, ne pas bloquer l'expérience
    console.warn('[verifyClaimPersistedOnServer] Impossible de relire /claims:', e?.message || e);
    return;
  }

  const serverClaim = (serverClaims || []).find((c) => c && c.id === claimId);
  if (!serverClaim) return;

  const mismatches = [];
  for (const k of fieldsToCheck) {
    const expected = patch[k];
    const actual = serverClaim[k];
    // Comparaisons tolérantes (dates ISO)
    if (k === 'invoiceDate') {
      const exp = expected ? String(expected).slice(0, 10) : '';
      const act = actual ? String(actual).slice(0, 10) : '';
      if (exp !== act) mismatches.push(`${k}: attendu ${exp || '∅'}, reçu ${act || '∅'}`);
      continue;
    }
    if (typeof expected === 'number') {
      const expN = Number(expected);
      const actN = Number(actual);
      if (Number.isFinite(expN) && Number.isFinite(actN)) {
        if (Math.abs(expN - actN) > 0.000001) mismatches.push(`${k}: attendu ${expN}, reçu ${actN}`);
        continue;
      }
    }
    if ((expected ?? null) !== (actual ?? null)) {
      mismatches.push(`${k}: attendu ${expected ?? '∅'}, reçu ${actual ?? '∅'}`);
    }
  }

  if (mismatches.length) {
    const msg = `Backend n'a pas persisté la modification (refresh revient en arrière).\n${mismatches.join(' | ')}`;
    console.error('[verifyClaimPersistedOnServer] ' + msg);
    claimSaveStatus.set(claimId, 'error');
    claimSaveErrorMsg.set(claimId, msg);
    updateClaimSaveIndicator(claimId);
  }
}

function hasPendingClaimSaves() {
  return claimSaveTimers.size > 0 || claimPendingBuilders.size > 0 || claimSaveInFlight.size > 0;
}

// Empêcher la perte de modifications si l'utilisateur rafraîchit trop vite.
// Note: on ne peut pas forcer un PUT authentifié via sendBeacon (headers Authorization),
// donc on affiche un avertissement navigateur en cas de sauvegardes en attente.
window.addEventListener("beforeunload", (e) => {
  if (!hasPendingClaimSaves()) return;
  e.preventDefault();
  e.returnValue = "";
});

async function saveClaimToServer(claimId, patch) {
  console.log('[saveClaimToServer] Sauvegarde claim:', { claimId, patch, mode: USE_MOCK ? 'MOCK' : 'BACKEND' });
  try {
    const response = await apiPut(`/claims/${claimId}`, patch);
    console.log('[saveClaimToServer] ✓ Succès:', response);
    claimSaveStatus.set(claimId, "saved");
    claimSaveErrorMsg.delete(claimId);
    updateClaimSaveIndicator(claimId);
    // Mise à jour du state.claims en local
    const claimIndex = state.claims.findIndex(c => c.id === claimId);
    if (claimIndex >= 0) {
      state.claims[claimIndex] = { ...state.claims[claimIndex], ...patch };
      // Si on a envoyé un projectCode, reconstruire l'objet project
      if (patch.projectCode) {
        const proj = state.projects.find(p => p.code === patch.projectCode);
        if (proj) {
          state.claims[claimIndex].project = { id: proj.id, code: proj.code };
        }
      }
    }

    // Rafraîchir les vues (résumé, bilan, rapport) pour refléter le changement immédiatement
    renderRegistreSummary();
    renderBilan();
    renderRapport();

    // Vérifier que le backend a réellement persisté (sinon le refresh revient en arrière)
    void verifyClaimPersistedOnServer(claimId, patch);
    return response;
  } catch (e) {
    console.error('[saveClaimToServer] ✗ ERREUR:', { claimId, patch, error: e.message || e });
    claimSaveStatus.set(claimId, "error");
    claimSaveErrorMsg.set(claimId, e?.message || String(e));
    updateClaimSaveIndicator(claimId);
    throw e;
  }
}

async function executeSaveClaimNow(claimId) {
  const patchBuilder = claimPendingBuilders.get(claimId);
  if (!patchBuilder) return;

  // On capture le patch immédiatement (pour éviter toute mutation ultérieure)
  const patch = patchBuilder();
  console.log('[executeSaveClaimNow] Patch construit:', { claimId, patch });

  // Marquer le patch comme consommé (le prochain schedule remplacera si besoin)
  claimPendingBuilders.delete(claimId);

  const p = (async () => {
    try {
      claimSaveStatus.set(claimId, "saving");
      updateClaimSaveIndicator(claimId);
      await saveClaimToServer(claimId, patch);
    } catch (e) {
      console.error("Erreur autosave:", e);
    } finally {
      claimSaveInFlight.delete(claimId);
    }
  })();
  claimSaveInFlight.set(claimId, p);
  return p;
}

async function flushPendingClaimSaves() {
  const ids = Array.from(claimPendingBuilders.keys());
  // Exécuter immédiatement tout ce qui est en attente
  await Promise.all(ids.map((id) => executeSaveClaimNow(id)));
  // Et attendre les éventuels in-flight
  await Promise.all(Array.from(claimSaveInFlight.values()));
}

function scheduleSaveClaim(claimId, patchBuilder, options) {
  console.log('[scheduleSaveClaim] Appelé avec:', { claimId, hasPatchBuilder: !!patchBuilder, options });
  // patchBuilder: fonction qui renvoie l'objet à envoyer au backend
  if (!claimId) {
    console.warn('[scheduleSaveClaim] ⚠️ claimId manquant, sauvegarde annulée!');
    return;
  }

  if (typeof patchBuilder === 'function') {
    claimPendingBuilders.set(claimId, patchBuilder);
  }

  const immediate = !!options?.immediate;
  const debounceMs = Number.isFinite(options?.debounceMs) ? options.debounceMs : 600;
  
  // Marquer comme "en cours de sauvegarde"
  if (claimSaveTimers.has(claimId)) {
    clearTimeout(claimSaveTimers.get(claimId));
    claimSaveTimers.delete(claimId);
  }

  if (immediate) {
    void executeSaveClaimNow(claimId);
    return;
  }

  const timeoutId = setTimeout(async () => {
    console.log(`[scheduleSaveClaim] Timer déclenché après ${debounceMs}ms pour claim:`, claimId);
    claimSaveTimers.delete(claimId);
    await executeSaveClaimNow(claimId);
  }, debounceMs);

  claimSaveTimers.set(claimId, timeoutId);
}

function escapeHtml(text) {
  // Échapper les caractères spéciaux HTML
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function renderTeamMembers() {
  const tbody = document.getElementById("teamBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  state.teamMembers.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="email" value="${m.email}" data-idx="${idx}" data-field="email" /></td>
      <td><input type="text" value="${m.name || ""}" data-idx="${idx}" data-field="name" /></td>
      <td>
        <select data-idx="${idx}" data-field="role">
          <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option>
          <option value="user" ${!m.role || m.role === "user" ? "selected" : ""}>User</option>
          <option value="lecture" ${m.role === "lecture" ? "selected" : ""}>Lecture seule</option>
        </select>
      </td>
      <td style="text-align:center;">
        <input type="checkbox" data-idx="${idx}" data-field="active" ${
      m.active ? "checked" : ""
    } />
      </td>
      <td>
        <button class="mini-btn danger" data-idx="${idx}">Supprimer</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", async () => {
      if (isReadOnly()) {
        alert("Mode lecture seule : gestion des membres non autorisée.");
        return;
      }
      const idx = Number(el.getAttribute("data-idx"));
      const field = el.getAttribute("data-field");
      const member = state.teamMembers[idx];
      if (!member) return;

      const body = {
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        active: member.active
      };

      if (field === "active") {
        body.active = el.checked;
      } else {
        body[field] = el.value;
      }

      try {
        const updated = await apiPut("/team-members", body);
        state.teamMembers[idx] = updated;
        console.log('✅ Membre mis à jour:', updated);
      } catch (e) {
        console.error('❌ Erreur mise à jour membre:', e);
        alert('Erreur lors de la sauvegarde : ' + e.message);
      }
    });
  });

  tbody.querySelectorAll("button.mini-btn.danger").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (isReadOnly()) {
        alert("Mode lecture seule : suppression des membres non autorisée.");
        return;
      }
      const idx = Number(btn.getAttribute("data-idx"));
      const member = state.teamMembers[idx];
      if (!member) return;
      if (!confirm("Supprimer ce membre autorisé ?")) return;
      await apiDelete("/team-members/" + member.id);
      await loadData();
    });
  });
}

// === EXPORTS =======================================================
function exportJson() {
  // Export NON filtré: inclure toutes les claims (milestones + DCR)
  const data = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projects: state.projects,
    taxes: state.taxes,
    settings: state.settings,
    claims: state.claims,
    teamMembers: state.teamMembers
  };
  const jsonStr = JSON.stringify(data, null, 2);

  // Try File System Access API if available
  if ('showSaveFilePicker' in window) {
    window.showSaveFilePicker({
      suggestedName: 'rfacto-export.json',
      types: [{
        description: 'JSON Files',
        accept: { 'application/json': ['.json'] }
      }]
    }).then(handle => {
      return handle.createWritable();
    }).then(writable => {
      return writable.write(jsonStr).then(() => writable.close());
    }).then(() => {
      alert("Fichier sauvegardé avec succès.");
    }).catch(err => {
      if (err.name !== 'AbortError') {
        console.error(err);
        alert("Erreur lors de la sauvegarde.");
        // Fallback to download
        downloadJson(jsonStr);
      }
    });
  } else {
    // Fallback to download
    downloadJson(jsonStr);
  }
}

function downloadJson(jsonStr) {
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rfacto-export.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  alert("Snapshot JSON téléchargé (sauvegarde locale).");
}

async function importJson() {
  const fileInput = document.getElementById("importFile");
  if (!fileInput || !fileInput.files[0]) {
    alert("Veuillez sélectionner un fichier JSON.");
    return;
  }

  // Demander à l'utilisateur s'il veut remplacer ou fusionner
  const replace = confirm(
    "Mode d'import:\n\n" +
    "[OK] Remplacer: Supprime les données actuelles et importe le fichier\n" +
    "[Annuler] Fusionner: Ajoute les données du fichier aux existantes"
  );

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') {
        alert("Format JSON invalide.");
        return;
      }

      let deleteCount = 0;

      // MODE REMPLACER: Supprimer les données existantes via endpoint backend
      if (replace) {
        console.log('Mode REMPLACER: appel au backend pour nettoyer...');
        try {
          const resetRes = await apiPost('/admin/reset-all', {});
          console.log('Reset backend réussi:', resetRes);
          deleteCount = resetRes.deletedClaims || 0;
          
          // Attendre que le reset se termine et recharger les données
          console.log('Rechargement des données après reset...');
          await loadData();
          console.log('Données rechargées après reset');
        } catch (err) {
          console.error('Erreur reset backend:', err);
          alert('Erreur lors du reset: ' + (err.message || err));
          return;
        }
      }

      // 1) Projets (create ou update selon le mode)
      if (Array.isArray(data.projects)) {
        const existingProjects = new Map((state.projects || []).map(p => [p.code, p]));
        for (const p of data.projects) {
          if (!p || !p.code) continue;
          try {
            if (!replace && existingProjects.has(p.code)) {
              // Mode fusionner: update uniquement s'il existe
              const current = existingProjects.get(p.code);
              await apiPut(`/projects/${current.id}`, {
                code: p.code,
                label: p.label ?? current.label,
                taxProvince: p.taxProvince ?? current.taxProvince ?? null
              });
            } else {
              // Mode remplacer ou nouveau: créer
              await apiPost('/projects', {
                code: p.code,
                label: p.label || p.code,
                taxProvince: p.taxProvince ?? null
              });
            }
          } catch (err) {
            console.error('Erreur import projet:', p, err);
          }
        }
        // Recharger les projets depuis le backend après création
        try {
          await loadData();
        } catch (e) {
          console.error('Erreur rechargement projets:', e);
        }
      }

      // 2) Taxes (create ou update selon le mode)
      if (Array.isArray(data.taxes)) {
        const existingTaxes = new Map((state.taxes || []).map(t => [t.province, t]));
        for (const t of data.taxes) {
          const province = t?.province;
          if (!province) continue;
          const rate = (t.taxRate ?? t.rate ?? 0);
          try {
            if (!replace && existingTaxes.has(province)) {
              // Mode fusionner: update uniquement si existe
              await apiPut(`/taxes/${existingTaxes.get(province).id}`, { province, rate });
            } else {
              // Mode remplacer ou nouveau: créer
              await apiPost('/taxes', { province, rate });
            }
          } catch (err) {
            console.error('Erreur import taxe:', t, err);
          }
        }
      }

      // 3) Settings (toujours remplacer les champs connus)
      if (data.settings && typeof data.settings === 'object') {
        const s = data.settings;
        try {
          await apiPut('/settings', {
            contractHT: s.contractHT ?? 0,
            contractTTC: s.contractTTC ?? 0,
            defaultProvMs: s.defaultProvMs ?? null,
            defaultProvDcr: s.defaultProvDcr ?? null,
            defaultProvReserve: s.defaultProvReserve ?? null
          });
        } catch (err) {
          console.error('Erreur import settings:', err);
        }
      }

      // 4) Membres (create ou update selon le mode)
      if (Array.isArray(data.teamMembers)) {
        const existingMembers = new Map((state.teamMembers || []).map(m => [String(m.email).toLowerCase(), m]));
        for (const m of data.teamMembers) {
          const email = String(m?.email || '').toLowerCase();
          if (!email) continue;
          try {
            if (!replace && existingMembers.has(email)) {
              // Mode fusionner: update uniquement si existe
              const cur = existingMembers.get(email);
              await apiPut(`/team-members/${cur.id}`, {
                email,
                name: m.name ?? cur.name ?? null,
                role: m.role ?? cur.role ?? 'user',
                active: m.active ?? cur.active ?? true
              });
            } else {
              // Mode remplacer ou nouveau: créer
              await apiPost('/team-members', {
                email,
                name: m.name ?? null,
                role: m.role ?? 'user',
                active: m.active ?? true
              });
            }
          } catch (err) {
            console.error('Erreur import membre:', m, err);
          }
        }
      }

      // 5) Claims (milestones + DCR)
      if (Array.isArray(data.claims)) {
        const dataProjectsById = new Map((data.projects || []).map(p => [p.id, p]));
        console.log('Projects loaded for claims:', Array.from(dataProjectsById.entries()));
        let created = 0;
        let failed = 0;
        for (const c of data.claims) {
          try {
            // Extraire le projectCode avec priorité: project.code > projectCode > projectId lookup
            let projectCode = c.project?.code || c.projectCode || null;
            if (!projectCode && c.projectId && dataProjectsById.has(c.projectId)) {
              projectCode = dataProjectsById.get(c.projectId).code;
            }
            console.log(`Claim ${c.id || '?'}: projectCode="${projectCode}"`);
            
            const body = {
              type: c.type || 'milestone',
              step: c.step ?? null,
              projectCode: projectCode,
              invoiceDate: c.invoiceDate || null,
              description: c.description ?? null,
              province: c.province ?? null,
              taxRate: c.taxRate ?? null,
              amountHT: c.amountHT ?? null,
              amountTTC: c.amountTTC ?? null,
              invoiceNumber: c.invoiceNumber ?? null,
              status: c.status ?? null,
              extraC228: c.extraC228 ?? null,
              extraC229: c.extraC229 ?? null,
              extraC230: c.extraC230 ?? null,
              extraC231: c.extraC231 ?? null,
              extraNLT5: c.extraNLT5 ?? null,
              extraNLT6: c.extraNLT6 ?? null,
            };
            console.log('Creating claim with body:', body);
            const res = await apiPost('/claims', body);
            console.log('Claim created:', res);
            created++;
          } catch (err) {
            console.error('Erreur import claim:', c, err);
            failed++;
          }
        }
        const modeText = replace ? 'REMPLACÉ' : 'FUSIONNÉ';
        alert(`Import ${modeText}.\n\nClaims créées: ${created}/${data.claims.length}\n(${failed} erreurs)\n\nRechargez la page pour voir les changements.`);
      } else {
        const modeText = replace ? 'REMPLACÉ' : 'FUSIONNÉ';
        alert(`Import ${modeText} (projets/taxes/settings/membres). Rechargez la page pour voir les changements.`);
      }
    } catch (err) {
      console.error('Erreur parsing JSON:', err);
      alert("Erreur lors de la lecture du fichier JSON.");
    }
  };
  reader.readAsText(file);
}

function exportCsv() {
  const claims = getRegistreFilteredClaims();
  const headers = [
    "id",
    "step",
    "type",
    "projet",
    "date",
    "description",
    "province",
    "taxe",
    "montantHT",
    "montantTTC",
    "statut",
    "noFacture"
  ];
  const rows = [headers.join(";")];
  claims.forEach((c) => {
    const { ht, ttc, taxRate } = computeAmounts(c);
    rows.push(
      [
        c.id,
        c.step || "",
        c.type,
        c.project?.code || "",
        c.invoiceDate ? c.invoiceDate.slice(0, 10) : "",
        (c.description || "").replace(/;/g, ","),
        c.province || "",
        taxRate,
        ht.toFixed(2),
        ttc.toFixed(2),
        c.status || "",
        c.invoiceNumber || ""
      ].join(";")
    );
  });
  const blob = new Blob([rows.join("\n")], {
    type: "text/csv;charset=utf-8;"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rfacto-registre-filtre.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportExcel() {
  if (typeof XLSX === "undefined") {
    alert("La librairie Excel (XLSX) n'est pas chargée.");
    return;
  }

  const wb = XLSX.utils.book_new();
  const claims = getRegistreFilteredClaims();

  const rows = [];
  rows.push([
    "id",
    "Étape",
    "Type",
    "Projet",
    "Date",
    "Description",
    "Province",
    "Taxe",
    "Montant HT",
    "Montant TTC",
    "Statut",
    "No facture"
  ]);
  claims.forEach((c) => {
    const { ht, ttc, taxRate } = computeAmounts(c);
    rows.push([
      c.id,
      c.step || "",
      c.type,
      c.project?.code || "",
      c.invoiceDate ? c.invoiceDate.slice(0, 10) : "",
      c.description || "",
      c.province || "",
      taxRate,
      Number(ht.toFixed(2)),
      Number(ttc.toFixed(2)),
      c.status || "",
      c.invoiceNumber || ""
    ]);
  });
  const wsReg = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, wsReg, "Registre_filtré");

  const projRows = [["Code", "Libellé", "Taxe applicable"]];
  state.projects.forEach((p) =>
    projRows.push([p.code, p.label, p.taxProvince || ""])
  );
  const wsProj = XLSX.utils.aoa_to_sheet(projRows);
  XLSX.utils.book_append_sheet(wb, wsProj, "Projets");

  const taxRows = [["Province", "Taux"]];
  state.taxes.forEach((t) => taxRows.push([t.province, t.rate]));
  const wsTax = XLSX.utils.aoa_to_sheet(taxRows);
  XLSX.utils.book_append_sheet(wb, wsTax, "Taxes");

  XLSX.writeFile(wb, "rfacto-registre-filtre.xlsx");
}

function exportExcelFromRows(rows) {
  if (typeof XLSX === "undefined") {
    alert("La librairie Excel (XLSX) n'est pas chargée.");
    return;
  }
  const wb = XLSX.utils.book_new();
  const headers = [
    "id",
    "Étape",
    "Type",
    "Projet",
    "Date",
    "Description",
    "Province",
    "Taxe",
    "Montant HT",
    "Montant TTC",
    "Statut",
    "No facture"
  ];
  const wsData = [headers];
  rows.forEach((r) => {
    wsData.push([
      r.id || "",
      r.step || "",
      r.type || "",
      r.project || "",
      r.date || "",
      r.description || "",
      r.province || "",
      r.tax || "",
      r.ht != null && !Number.isNaN(r.ht) ? Number(r.ht) : "",
      r.ttc != null && !Number.isNaN(r.ttc) ? Number(r.ttc) : "",
      r.status || "",
      r.invoiceNumber || ""
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Registre_preview");
  XLSX.writeFile(wb, "rfacto-registre-preview.xlsx");
}

function openExcelPreview() {
  const claims = getRegistreFilteredClaims();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const headers = [
    "id",
    "Étape",
    "Type",
    "Projet",
    "Date",
    "Description",
    "Province",
    "Taxe",
    "Montant HT",
    "Montant TTC",
    "Statut",
    "No facture"
  ];

  // Collect unique values for dropdown filters
  const typeValues = new Set();
  const projectValues = new Set();
  const statusValues = new Set();

  const rowsHtml = claims
    .map((c) => {
      const { ht, ttc, taxRate } = computeAmounts(c);
      if (c.type) typeValues.add(c.type);
      if (c.project?.code) projectValues.add(c.project.code);
      if (c.status) statusValues.add(c.status);
      return `
        <tr>
          <td>${c.id || ""}</td>
          <td contenteditable="true">${c.step || ""}</td>
          <td contenteditable="true">${c.type || ""}</td>
          <td contenteditable="true">${c.project?.code || ""}</td>
          <td contenteditable="true">${c.invoiceDate ? c.invoiceDate.slice(0, 10) : ""}</td>
          <td contenteditable="true">${(c.description || "").replace(/</g, "&lt;")}</td>
          <td contenteditable="true">${c.province || ""}</td>
          <td contenteditable="true">${taxRate ?? ""}</td>
          <td contenteditable="true">${ht != null ? ht.toFixed(2) : ""}</td>
          <td contenteditable="true">${ttc != null ? ttc.toFixed(2) : ""}</td>
          <td contenteditable="true">${c.status || ""}</td>
          <td contenteditable="true">${c.invoiceNumber || ""}</td>
        </tr>
      `;
    })
    .join("");

  const buildFilterSelect = (id, values, placeholder, colIdx) => {
    const opts = Array.from(values)
      .filter((v) => v != null && v !== "")
      .sort((a, b) => a.localeCompare(b))
      .map((v) => `<option value="${escapeHtml(String(v))}">${escapeHtml(String(v))}</option>`)
      .join("");
    return `<select class="preview-filter-select" data-col="${colIdx}" id="${id}"><option value="">${placeholder}</option>${opts}</select>`;
  };

  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3 style="margin:0;">Prévisualisation XLSX (modifiable avant export)</h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn-ghost" id="previewFullscreenBtn">Plein écran</button>
          <button class="btn" id="previewCloseBtn">Fermer</button>
        </div>
      </div>
      <div class="modal-toolbar">
        <label>Alignement
          <select id="previewAlign">
            <option value="left">Gauche</option>
            <option value="center">Centre</option>
            <option value="right">Droite</option>
          </select>
        </label>
        <label>Couleur texte
          <input type="color" id="previewTextColor" value="#0f172a" />
        </label>
        <label>Fond en-tête
          <input type="color" id="previewHeaderBg" value="#f1f5f9" />
        </label>
        <label>Fond lignes
          <input type="color" id="previewRowBg" value="#ffffff" />
        </label>
        <label>Tri
          <select id="previewSortCol">
            ${headers.map((h, idx) => `<option value="${idx}">${h}</option>`).join("")}
          </select>
        </label>
        <label>Type
          <select id="previewSortType">
            <option value="text">Alpha</option>
            <option value="num">Numérique</option>
          </select>
        </label>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary" id="previewSortAsc">Tri ↑</button>
          <button class="btn btn-secondary" id="previewSortDesc">Tri ↓</button>
        </div>
      </div>
      <div class="modal-body">
        <div style="overflow:auto;max-height:65vh;">
          <table class="preview-table">
            <thead>
              <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
              <tr class="preview-filter-row">${headers
                .map((h, idx) => {
                  if (idx === 2) {
                    return `<th>${buildFilterSelect("filterType", typeValues, "Type (tous)", idx)}</th>`;
                  }
                  if (idx === 3) {
                    return `<th>${buildFilterSelect("filterProject", projectValues, "Projet (tous)", idx)}</th>`;
                  }
                  if (idx === 10) {
                    return `<th>${buildFilterSelect("filterStatus", statusValues, "Statut (tous)", idx)}</th>`;
                  }
                  return "<th></th>";
                })
                .join("")}</tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="previewCancelBtn">Annuler</button>
        <button class="btn primary" id="previewExportBtn">Exporter XLSX</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const cleanup = () => overlay.remove();
  overlay.querySelector("#previewCloseBtn")?.addEventListener("click", cleanup);
  overlay.querySelector("#previewCancelBtn")?.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cleanup();
  });

  overlay.querySelector("#previewExportBtn")?.addEventListener("click", () => {
    const trs = overlay.querySelectorAll("tbody tr");
    const rows = Array.from(trs).map((tr) => {
      const cells = tr.querySelectorAll("td");
      const val = (idx) => (cells[idx]?.textContent || "").trim();
      const parseNum = (idx) => {
        const n = parseFloat(val(idx).replace(",", "."));
        return Number.isFinite(n) ? n : null;
      };
      return {
        id: val(0),
        step: val(1),
        type: val(2),
        project: val(3),
        date: val(4),
        description: val(5),
        province: val(6),
        tax: val(7),
        ht: parseNum(8),
        ttc: parseNum(9),
        status: val(10),
        invoiceNumber: val(11)
      };
    });
    exportExcelFromRows(rows);
    cleanup();
  });

  // Style controls
  const table = overlay.querySelector(".preview-table");
  const alignSel = overlay.querySelector("#previewAlign");
  const textColor = overlay.querySelector("#previewTextColor");
  const headerBg = overlay.querySelector("#previewHeaderBg");
  const rowBg = overlay.querySelector("#previewRowBg");
  const filters = overlay.querySelectorAll(".preview-filter-select");
  const sortCol = overlay.querySelector("#previewSortCol");
  const sortType = overlay.querySelector("#previewSortType");
  const sortAsc = overlay.querySelector("#previewSortAsc");
  const sortDesc = overlay.querySelector("#previewSortDesc");
  const fullscreenBtn = overlay.querySelector("#previewFullscreenBtn");

  const setupColumnResizers = () => {
    if (!table) return;
    const headerRow = table.querySelector("thead tr:first-child");
    if (!headerRow) return;
    const headerCells = headerRow.querySelectorAll("th");
    headerCells.forEach((th, idx) => {
      if (th.querySelector(".col-resizer")) return;
      th.style.position = "relative";
      const handle = document.createElement("div");
      handle.className = "col-resizer";
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = th.offsetWidth;
        const colIdx = idx + 1;
        const colCells = Array.from(
          table.querySelectorAll(
            `thead tr th:nth-child(${colIdx}), tbody tr td:nth-child(${colIdx})`
          )
        );
        const onMouseMove = (ev) => {
          const delta = ev.clientX - startX;
          const newWidth = Math.max(70, startWidth + delta);
          colCells.forEach((cell) => {
            cell.style.width = `${newWidth}px`;
            cell.style.minWidth = `${newWidth}px`;
            cell.style.maxWidth = `${newWidth}px`;
          });
        };
        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
      th.appendChild(handle);
    });
  };

  const applyStyles = () => {
    if (!table) return;
    table.style.color = textColor.value;
    table.querySelectorAll("td").forEach((td) => {
      td.style.textAlign = alignSel.value;
      td.style.background = rowBg.value;
    });
    table.querySelectorAll("th").forEach((th) => {
      th.style.background = headerBg.value;
      th.style.textAlign = "center";
    });
  };

  [alignSel, textColor, headerBg, rowBg].forEach((ctrl) => {
    ctrl?.addEventListener("input", applyStyles);
    ctrl?.addEventListener("change", applyStyles);
  });

  applyStyles();
  setupColumnResizers();

  const filterRows = () => {
    const active = {};
    filters.forEach((sel) => {
      const col = Number(sel.dataset.col);
      const val = sel.value.trim().toLowerCase();
      if (val) active[col] = val;
    });
    const trs = table.querySelectorAll("tbody tr");
    trs.forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      const visible = Object.entries(active).every(([col, fval]) => {
        const val = (cells[col]?.textContent || "").toLowerCase();
        return val.includes(fval);
      });
      tr.style.display = visible ? "" : "none";
    });
  };

  filters.forEach((sel) => {
    sel.addEventListener("change", filterRows);
  });

  const sortRows = (order) => {
    const trs = Array.from(table.querySelectorAll("tbody tr"));
    const col = Number(sortCol.value) || 0;
    const type = sortType.value;
    trs.sort((a, b) => {
      const va = (a.cells[col]?.textContent || "").trim();
      const vb = (b.cells[col]?.textContent || "").trim();
      if (type === "num") {
        const na = parseFloat(va.replace(",", "."));
        const nb = parseFloat(vb.replace(",", "."));
        const an = Number.isFinite(na) ? na : Number.NEGATIVE_INFINITY;
        const bn = Number.isFinite(nb) ? nb : Number.NEGATIVE_INFINITY;
        return order === "asc" ? an - bn : bn - an;
      }
      return order === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    const tbody = table.querySelector("tbody");
    trs.forEach((tr) => tbody.appendChild(tr));
  };

  sortAsc?.addEventListener("click", () => sortRows("asc"));
  sortDesc?.addEventListener("click", () => sortRows("desc"));

  fullscreenBtn?.addEventListener("click", () => {
    const card = overlay.querySelector(".modal-card");
    if (!card) return;
    card.classList.toggle("fullscreen");
    fullscreenBtn.textContent = card.classList.contains("fullscreen") ? "Quitter plein écran" : "Plein écran";
  });
}

function exportPdf() {
  window.print();
}

// === LOAD DATA =====================================================
async function loadData() {
  // Ne pas tenter de charger les données tant que l'utilisateur n'est pas authentifié.
  // Sinon, les appels /projects /taxes /settings /claims échouent en 401 et polluent la console.
  if (!USE_MOCK) {
    const ok = await checkAuth();
    if (!ok) return;
  }

  // Éviter d'écraser des modifications locales non encore persistées
  await flushPendingClaimSaves();

  let health = null;
  try {
    health = await apiGet("/health");
  } catch (e) {
    console.warn("Impossible de récupérer /health :", e);
  }
  if (health && health.user) {
    state.currentUser = health.user;
    console.log('✅ Utilisateur chargé depuis /health:', state.currentUser);
  } else {
    // Garder l'utilisateur issu de MSAL (checkAuth) si le backend ne renvoie pas d'objet user.
    state.currentUser = state.currentUser || { role: "user" };
    console.warn('⚠️ /health n\'a pas retourné user, fallback:', state.currentUser);
  }

  renderUserBubble();

  // Certains backends (notamment en local) ne supportent pas encore tous les endpoints.
  // Ne pas bloquer tout le chargement si /amendments n'existe pas.
  const amendmentsPromise = apiGet("/amendments").catch((err) => {
    console.warn('⚠️ /amendments indisponible, on continue sans amendments:', err?.message || err);
    return [];
  });

  const basePromises = [
    apiGet("/projects"),
    apiGet("/taxes"),
    apiGet("/settings"),
    amendmentsPromise,
    apiGet("/claims")
  ];
  // Ne charger les membres que pour les admins
  const teamMembersPromise = (state.currentUser?.role === 'admin')
    ? apiGet("/team-members").catch(() => ({ __error: true }))
    : Promise.resolve([]);

  const [projects, taxes, settings, amendments, claims, teamMembersOrError] =
    await Promise.all([...basePromises, teamMembersPromise]);

  state.projects = projects;
  state.taxes = taxes;
  state.settings = settings;
  state.amendments = Array.isArray(amendments) ? amendments : [];
  state.claims = claims;
  
  // Debug NLT5/NLT6
  const nlt5Claims = claims.filter(c => c.project?.code === 'NLT5');
  const nlt6Claims = claims.filter(c => c.project?.code === 'NLT6');
  console.log('[loadData] NLT5 claims:', nlt5Claims.length, nlt5Claims.slice(0, 2));
  console.log('[loadData] NLT6 claims:', nlt6Claims.length, nlt6Claims.slice(0, 2));
  
  console.log('[loadData] Données chargées:', {
    projects: state.projects?.length || 0,
    claims: state.claims?.length || 0,
    mode: USE_MOCK ? 'MOCK' : 'BACKEND'
  });
  
  if (USE_MOCK) {
    console.warn('⚠️ MODE MOCK ACTIF - Les modifications ne seront PAS sauvegardées!');
  }
  state.teamMembers = Array.isArray(teamMembersOrError)
    ? teamMembersOrError
    : [];
  // Payment claim rows persistence
  if (settings?.paymentClaimRowsJson) {
    try {
      const parsed = JSON.parse(settings.paymentClaimRowsJson);
      if (Array.isArray(parsed)) state.paymentClaimRows = parsed;
    } catch (err) {
      console.warn('paymentClaimRowsJson invalide', err);
    }
  }
  state.archiveFiles = {}; // on repart sur une archive fraîche

  renderFiltersProjects();
  renderRegistre();
  renderBilan();
  renderRapport();
  renderProjects();
  renderTaxes();
  renderAmendments();
  renderSettings();
  renderTeamMembers();
  renderArchive();
  renderAudit();
  renderTraitement();
  updateNotifications();
}

// === INIT DOM ======================================================

// === INIT DOM ======================================================
document.addEventListener("DOMContentLoaded", async () => {
  // Nettoyage automatique du localStorage (mock ne doit plus être persistant)
  if (localStorage.getItem('rfacto_use_mock')) {
    console.info('🧹 Nettoyage localStorage: suppression flag mock obsolète');
    localStorage.removeItem('rfacto_use_mock');
  }
  
  // D'abord traiter le callback de redirect (si retour d'Azure AD)
  // Ceci ne doit être appelé qu'UNE SEULE FOIS au démarrage
  try {
    await msalAuth.handleRedirectCallback();
    // Attendre un peu pour que MSAL nettoie son état
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.warn('Erreur handleRedirectCallback:', error);
  }
  
  // Si le backend est disponible, forcer la sortie du mode mock
  await ensureBackendAvailableAndDisableMock();

  // Marquer MSAL comme prêt
  msalReady = true;
  console.log('MSAL initialisé et prêt');
  
  // Gestionnaire pour le bouton de connexion
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', handleLogin);
  }
  
  // Initialiser l'app
  await initApp();
  
  renderTabs();

  // Attacher les event listeners aux boutons des onglets
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = btn.getAttribute('data-tab');
      if (!tabName) return;
      
      // Retirer la classe active de tous les boutons et panneaux
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      
      // Ajouter la classe active au bouton et au panneau
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + tabName);
      if (panel) {
        panel.classList.add('active');
      }
      
      // Appeler la fonction de rendu correspondante
      const renderMap = {
        'registre': async () => {
          // Flusher les sauvegardes en attente puis recharger les claims depuis le backend avant d'afficher
          await flushPendingClaimSaves();
          const claimsFromServer = await apiGet("/claims").catch(() => []);
          state.claims = claimsFromServer;
          renderRegistre();
        },
        'bilan': async () => {
          // Flusher les sauvegardes en attente puis recharger les claims depuis le backend avant d'afficher
          await flushPendingClaimSaves();
          const claimsFromServer = await apiGet("/claims").catch(() => []);
          state.claims = claimsFromServer;
          renderBilan();
        },
        'rapport': async () => {
          // Flusher les sauvegardes en attente puis recharger les claims depuis le backend avant d'afficher
          await flushPendingClaimSaves();
          const claimsFromServer = await apiGet("/claims").catch(() => []);
          state.claims = claimsFromServer;
          renderRapport();
        },
        'archive': renderArchive,
        'audit': renderAudit,
        'traitement': renderTraitement,
        'parametres': () => {
          renderProjects();
          renderTaxes();
          renderSettings();
          renderTeamMembers();
        }
      };
      
      if (renderMap[tabName]) {
        const result = renderMap[tabName]();
        // Attendre si c'est une Promise
        if (result && typeof result.then === 'function') {
          result.catch(err => console.error('Erreur lors du rendu:', err));
        }
      }
    });
  });

  // Sous-onglets du module Traitement
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.getAttribute('data-subtab');
      document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('subtab-' + subtab);
      if (panel) panel.classList.add('active');

      if (subtab === 'paiement-claim') {
        renderTraitement();
      } else if (subtab === 'compilation') {
        renderCompilation();
      }
    });
  });

  const btnOpenSettings = document.getElementById("btnOpenSettings");
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener("click", () => {
      const paramTabBtn = document.querySelector(
        '.tab-btn[data-tab="parametres"]'
      );
      if (paramTabBtn) paramTabBtn.click();
    });
  }

  // User bubble dropdown
  const userBubble = document.getElementById("userBubble");
  if (userBubble) {
    userBubble.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleUserDropdown();
    });
  }

  // Bouton paramètres utilisateur
  const btnUserSettings = document.getElementById("btnUserSettings");
  if (btnUserSettings) {
    btnUserSettings.addEventListener("click", () => {
      hideUserDropdown();
      const paramTabBtn = document.querySelector('.tab-btn[data-tab="parametres"]');
      if (paramTabBtn) paramTabBtn.click();
    });
  }

  // Bouton déconnexion
  const btnUserLogout = document.getElementById("btnUserLogout");
  if (btnUserLogout) {
    btnUserLogout.addEventListener("click", () => {
      hideUserDropdown();
      handleLogout();
    });
  }

  // Fermer le dropdown si clic ailleurs
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("userDropdown");
    const bubble = document.getElementById("userBubble");
    if (dropdown && bubble && !bubble.contains(e.target) && !dropdown.contains(e.target)) {
      hideUserDropdown();
    }
  });

  // Fichier button
  const btnFichier = document.getElementById("btnFichier");
  if (btnFichier) {
    btnFichier.addEventListener("click", () => {
      // Switch to fichier tab
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('tab-fichier').classList.add('active');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    });
  }

  // Notifications
  const btnNotifications = document.getElementById("btnNotifications");
  if (btnNotifications) {
    btnNotifications.addEventListener("click", () => {
      const dropdown = document.getElementById("notificationDropdown");
      if (dropdown.style.display === 'none' || dropdown.style.display === '') {
        showNotificationDropdown();
      } else {
        hideNotificationDropdown();
      }
    });
  }

  // Hide dropdown when clicking outside
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("notificationDropdown");
    const btn = document.getElementById("btnNotifications");
    if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
      hideNotificationDropdown();
    }
  });

  const btnAddClaim = document.getElementById("btnAddClaim");
  if (btnAddClaim) {
    btnAddClaim.addEventListener("click", () => {
      if (isReadOnly()) {
        alert("Mode lecture seule : ajout de claims non autorisé.");
        return;
      }
      addClaim();
    });
  }

  // Filtres registre
  document
    .getElementById("filterRegType")
    ?.addEventListener("change", renderRegistre);
  document
    .getElementById("filterRegProjet")
    ?.addEventListener("change", renderRegistre);
  document
    .getElementById("filterRegStatut")
    ?.addEventListener("change", renderRegistre);
  document
    .getElementById("filterRegDateFrom")
    ?.addEventListener("change", renderRegistre);
  document
    .getElementById("filterRegDateTo")
    ?.addEventListener("change", renderRegistre);
  document
    .getElementById("filterRegSearch")
    ?.addEventListener("input", renderRegistre);
  document
    .getElementById("filterRegSortStep")
    ?.addEventListener("change", renderRegistre);

  document
    .querySelectorAll('input[name="regDateMode"]')
    .forEach((radio) => {
      radio.addEventListener("change", () => {
        const mode =
          document.querySelector('input[name="regDateMode"]:checked')
            ?.value || "all";
        const range = document.getElementById("regDateRange");
        if (range) {
          range.style.display = mode === "period" ? "flex" : "none";
        }
        renderRegistre();
      });
    });

  // Filtres bilan
  document
    .getElementById("filterBilanType")
    ?.addEventListener("change", renderBilan);
  document
    .getElementById("filterBilanProjet")
    ?.addEventListener("change", renderBilan);
  document
    .getElementById("filterBilanStatut")
    ?.addEventListener("change", renderBilan);
  document
    .getElementById("filterBilanSearch")
    ?.addEventListener("input", renderBilan);
  document
    .getElementById("filterBilanSortStep")
    ?.addEventListener("change", renderBilan);

  // Archive : recherche + tri
  document
    .getElementById("archiveSearch")
    ?.addEventListener("input", renderArchive);
  document
    .getElementById("archiveSort")
    ?.addEventListener("change", renderArchive);

  // Audit : filtres
  document
    .getElementById("auditDateFrom")
    ?.addEventListener("change", renderAudit);
  document
    .getElementById("auditDateTo")
    ?.addEventListener("change", renderAudit);
  document
    .getElementById("auditFilterType")
    ?.addEventListener("change", renderAudit);
  document
    .getElementById("auditFilterStatut")
    ?.addEventListener("change", renderAudit);
  document
    .getElementById("auditFilterProjet")
    ?.addEventListener("change", renderAudit);
  document
    .getElementById("auditSearch")
    ?.addEventListener("input", renderAudit);

  document
    .getElementById("auditSort")
    ?.addEventListener("change", renderAudit);

  // Audit : boutons
  document.getElementById("btnAuditNew")?.addEventListener("click", () => {
    startNewAudit();
  });
  document
    .getElementById("btnSaveSnapshot")
    ?.addEventListener("click", () => {
      exportJson();
    });

  // Export buttons (Fichiers tab)
  document.getElementById("btnExportJson")?.addEventListener("click", exportJson);
  document.getElementById("btnExportCsv")?.addEventListener("click", exportCsv);
  document.getElementById("btnExportExcel")?.addEventListener("click", exportExcel);
  document.getElementById("btnExportPdf")?.addEventListener("click", exportPdf);
  document
    .getElementById("btnExportExcelPreview")
    ?.addEventListener("click", openExcelPreview);

  // Import JSON
  document
    .getElementById("btnImportJson")
    ?.addEventListener("click", importJson);

  // Settings
  document
    .getElementById("envContratNumero")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("envContratHt")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("envContratTtc")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("envDefaultProvMs")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("envDefaultProvDcr")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("envDefaultProvReserve")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("procTaxDefault1")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("procTaxDefault2")
    ?.addEventListener("change", saveSettings);
  document
    .getElementById("procTaxDefault3")
    ?.addEventListener("change", saveSettings);

  // Ajout projet
  document.getElementById("btnAddProject")?.addEventListener("click", async () => {
    if (isSettingsReadOnly()) {
      alert("Seuls les administrateurs peuvent ajouter des projets.");
      return;
    }

    const existingCodes = new Set(state.projects.map((p) => p.code));
    const base = "PRJ";
    let i = 1;
    let newCode = base + String(i).padStart(3, "0");
    while (existingCodes.has(newCode)) {
      i++;
      newCode = base + String(i).padStart(3, "0");
    }

    try {
      const proj = await apiPost("/projects", {
        code: newCode,
        label: "Nouveau projet",
        taxProvince: null
      });
      state.projects.push(proj);
      renderFiltersProjects();
      renderProjects();
    } catch (e) {
      console.error(e);
      alert(
        "Erreur lors de la création du projet : " + (e.message || "")
      );
    }
  });

  // Import milestones NLT5/6 (admin)
  document.getElementById("btnImportMilestonesNLT56")?.addEventListener("click", async () => {
    if (isSettingsReadOnly()) {
      alert("Seuls les administrateurs peuvent lancer l'import.");
      return;
    }
    if (!confirm("Importer les milestones NLT5/6 dans la base de données (sans doublons) ?")) return;
    try {
      const result = await apiPost("/admin/import-milestones", { projects: ["NLT5", "NLT6"] });
      const created = result?.created ?? result?.summary?.created ?? 0;
      const skipped = result?.skipped ?? result?.summary?.skipped ?? 0;
      alert(`Import terminé. Créés: ${created} | Déjà présents: ${skipped}`);
      await loadData();
      // Aller au registre pour voir tout de suite
      showTab("registre");
    } catch (e) {
      console.error(e);
      alert("Erreur import milestones: " + (e.message || e));
    }
  });

  // Ajout taxe
  document.getElementById("btnAddTax")?.addEventListener("click", async () => {
    if (isSettingsReadOnly()) {
      alert("Seuls les administrateurs peuvent ajouter des taxes.");
      return;
    }

    const existingProvinces = new Set(state.taxes.map((t) => t.province));
    let i = 1;
    let prov = "XX" + i;
    while (existingProvinces.has(prov)) {
      i++;
      prov = "XX" + i;
    }

    try {
      const tax = await apiPost("/taxes", { province: prov, rate: 0 });
      state.taxes.push(tax);
      renderTaxes();
    } catch (e) {
      console.error(e);
      alert(
        "Erreur lors de la création de la taxe : " + (e.message || "")
      );
    }
  });

  // Ajout membre
  document
    .getElementById("btnAddMember")
    ?.addEventListener("click", async () => {
      if (isReadOnly()) {
        alert("Mode lecture seule : ajout de membres non autorisé.");
        return;
      }
      const role = state.currentUser?.role || "admin";
      if (role !== "admin") {
        alert("Seuls les administrateurs peuvent gérer les membres.");
        return;
      }
      const email = prompt(
        "Email professionnel du membre (ex: prenom.nom@entreprise.com) :"
      );
      if (!email) return;
      const created = await apiPost("/team-members", {
        email,
        name: "",
        role: "user",
        active: true
      });
      state.teamMembers.push(created);
      renderTeamMembers();
    });

  // Chargement des données déclenché par initApp() après authentification
});
