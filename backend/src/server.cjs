// backend/src/server.cjs
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

// Charge les variables d'environnement depuis .env.local / .env (si présents)
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
} catch (_) {
  // dotenv est optionnel (ex: en production Azure, on utilise App Settings)
}

const prisma = new PrismaClient();
const app = express();

const PORT = process.env.PORT || 4008;

console.log(`[Startup] NODE_ENV=${process.env.NODE_ENV}, PORT=${PORT}`);

// === GLOBAL ERROR HANDLERS (diagnostic) ==============================
process.on("uncaughtException", (err) => {
  try {
    console.error("[uncaughtException]", err && err.stack ? err.stack : err);
  } catch (_) {}
});

process.on("unhandledRejection", (reason, promise) => {
  try {
    console.error("[unhandledRejection]", reason);
  } catch (_) {}
});

process.on("exit", (code) => {
  try {
    console.error(`[process exit] code=${code}`);
  } catch (_) {}
});

// === STATIC UPLOADS ==================================================
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// === MULTER CONFIG ===================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    const uniquePrefix = Date.now();
    cb(null, uniquePrefix + "-" + safeName);
  },
});
const upload = multer({ storage });

// === MIDDLEWARE GLOBALS ==============================================
// CORS avant toute route/static pour autoriser fetch sur /uploads depuis d'autres origines
const allowedOrigins = [
  'https://rfacto-7d240.firebaseapp.com',
  'https://rfacto-7d240.web.app',
  'https://www.rfacto.com',
  'https://rfacto-c2cmgac5erbcfafq.canadacentral-01.azurewebsites.net',
  'http://localhost:5500',
  'http://localhost:3000'
];

app.use(
  cors({
    origin: true, // Autorise toutes les origins (fonctionne sur Azure)
    credentials: true,
    exposedHeaders: ["x-rfacto-user-email"],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-rfacto-user-email']
  })
);

// IMPORTANT pour les preflight OPTIONS
app.options("*", cors());

// ✅ Middleware CORS forcé sur TOUTES les réponses (y compris erreurs 401/403/500)
// Garantit que le navigateur peut lire le JSON même en cas d'erreur
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://rfacto-7d240.firebaseapp.com',
    'https://rfacto-7d240.web.app',
    'https://www.rfacto.com',
    'https://rfacto-c2cmgac5erbcfafq.canadacentral-01.azurewebsites.net',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://localhost:4008',
    'http://localhost:4010'
  ];
  
  // En dev, accepter toute origin localhost
  if (origin && (allowedOrigins.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    // En prod, forcer www.rfacto.com si origin non reconnue mais présente
    res.setHeader('Access-Control-Allow-Origin', 'https://www.rfacto.com');
  }
  
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-rfacto-user-email');
  res.setHeader('Access-Control-Expose-Headers', 'x-rfacto-user-email');
  res.setHeader('Vary', 'Origin');
  
  next();
});

// Static uploads avec CORS appliqué
app.use("/uploads", express.static(uploadDir));
app.use(express.json());

// === JWT AZURE AD VALIDATION =========================================
// Par défaut, on utilise les IDs configurés côté frontend (frontend/auth.js).
// En production, il est recommandé de définir explicitement ces variables d’environnement.
const AUTH_DEBUG = String(process.env.AUTH_DEBUG || '').trim() === '1';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '79f19744-dc18-4e15-b6b9-a65e89211776';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '4a3f05bb-fa7b-48b0-9732-3937868527fe';

// Optionnel: permet de spécifier explicitement l'audience attendue (Application ID URI)
// Ex: AZURE_API_AUDIENCE=api://<API_APP_CLIENT_ID>
const AZURE_API_AUDIENCE = String(process.env.AZURE_API_AUDIENCE || '').trim();

// Optionnel: scopes requis (scp) pour accéder à l’API
// Ex: AZURE_API_REQUIRED_SCOPES=access_as_user, user_impersonation
const AZURE_API_REQUIRED_SCOPES = String(process.env.AZURE_API_REQUIRED_SCOPES || '').trim();

function parseListEnv(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getExpectedAudiences() {
  const audiences = new Set();
  const clientId = String(AZURE_CLIENT_ID || '').trim();
  if (clientId) {
    audiences.add(clientId);
    audiences.add(`api://${clientId}`);
  }
  const explicit = parseListEnv(AZURE_API_AUDIENCE);
  explicit.forEach((a) => audiences.add(a));
  // Si on a une forme api://GUID, accepter aussi le GUID nu
  explicit.forEach((a) => {
    const m = /^api:\/\/(.+)$/.exec(a);
    if (m && m[1]) audiences.add(m[1]);
  });
  return Array.from(audiences);
}

function getExpectedIssuers() {
  const tenantId = String(AZURE_TENANT_ID || '').trim();
  return [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://login.microsoftonline.com/${tenantId}/`,
    `https://sts.windows.net/${tenantId}/`,
  ];
}

const EXPECTED_AUDIENCES = getExpectedAudiences();
const EXPECTED_ISSUERS = getExpectedIssuers();

function authErrorPayload(base) {
  if (!AUTH_DEBUG) return base;
  return {
    ...base,
    debug: {
      expectedAudiences: EXPECTED_AUDIENCES,
      expectedIssuers: EXPECTED_ISSUERS,
      requiredScopes: parseListEnv(AZURE_API_REQUIRED_SCOPES),
      nodeEnv: process.env.NODE_ENV || null,
    },
  };
}

function sendAuthError(res, status, error, reason, extra) {
  const payload = authErrorPayload({ error, reason, ...(extra || {}) });
  return res.status(status).json(payload);
}

// Client JWKS pour récupérer les clés publiques Microsoft
const jwksClientInstance = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 86400000 // 24h
});

function getSigningKey(header, callback) {
  jwksClientInstance.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

async function verifyAzureToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        // Audiences acceptées:
        // - AZURE_CLIENT_ID (GUID) et api://AZURE_CLIENT_ID
        // - et/ou AZURE_API_AUDIENCE si défini
        audience: EXPECTED_AUDIENCES,
        issuer: EXPECTED_ISSUERS,
        algorithms: ['RS256']
      },
      (err, decoded) => {
        if (err) {
          return reject(err);
        }
        resolve(decoded);
      }
    );
  });
}

function mapJwtVerifyErrorToReason(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || '');
  if (name === 'TokenExpiredError') return 'token_expired';
  if (msg.includes('jwt audience invalid')) return 'unexpected_audience';
  if (msg.includes('jwt issuer invalid')) return 'issuer_mismatch';
  if (msg.includes('invalid signature')) return 'invalid_signature';
  return 'token_invalid';
}

/**
 * Middleware d'authentification Azure AD
 * - Vérifie le token JWT dans le header Authorization
 * - Valide avec les clés publiques Microsoft
 * - Récupère les infos utilisateur depuis TeamMember
 * - Fallback en mode dev si pas de token
 */
async function authMiddleware(req, res, next) {
  try {
    // Endpoints publics (pas d'authentification requise)
    const publicPaths = ['/api/ping', '/api/health', '/api/debug/status-lite'];
    const authHeader = req.header("Authorization");
    // Si endpoint public ET pas de jeton fourni, on laisse passer.
    // Si un jeton est présent, on effectue quand même l'auth pour fournir req.currentUser.
    if (publicPaths.includes(req.path) && (!authHeader || !authHeader.startsWith('Bearer '))) {
      return next();
    }

    // Check loose equality for PORT just in case
    const isDev = process.env.NODE_ENV === 'development' || String(PORT) === '4008';
    
    // Mode développement: ACCEPTER TOUT
    if (isDev) {
      if (!req.currentUser) {
        req.currentUser = {
          email: "local-dev@rfacto.test",
          name: "Dev User",
          role: "admin",
        };
      }
      console.debug(`[auth] MODE DEV => accepté ${req.method} ${req.path}`);
      return next();
    }
    
    // En production, vérifier l'Authorization header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendAuthError(res, 401, "Token d'authentification requis", 'missing_bearer_token');
    }

    // Extraire le token
    const token = authHeader.substring(7);

    // Vérifier et décoder le token Azure AD
    let decoded;
    try {
      decoded = await verifyAzureToken(token);
    } catch (err) {
      console.error("Erreur validation token:", err.message);
      // Si c'est un path public, on continue sans user au lieu de bloquer
      if (publicPaths.includes(req.path)) {
         return next();
      }
      const reason = mapJwtVerifyErrorToReason(err);
      return sendAuthError(res, 401, "Token invalide ou expiré", reason, AUTH_DEBUG ? { message: String(err?.message || '') } : undefined);
    }

    // Logs de diagnostic pour comprendre le contenu du jeton reçu
    try {
      console.log(`[auth] aud=${decoded.aud} scp=${decoded.scp || ''} appid=${decoded.appid || ''} azp=${decoded.azp || ''} iss=${decoded.iss}`);
    } catch (_) {}

    // Attacher le jeton décodé pour les routes de debug
    req.tokenDecoded = decoded;

    // Extraire l'email du token (peut être dans preferred_username, email ou upn)
    const email = (decoded.preferred_username || decoded.email || decoded.upn || '').toLowerCase().trim();
    
    if (!email) {
      return sendAuthError(res, 401, "Email non trouvé dans le token", 'email_missing');
    }

    // Optionnel: imposer des scopes requis (scp) si configuré
    const requiredScopes = parseListEnv(AZURE_API_REQUIRED_SCOPES);
    if (requiredScopes.length > 0) {
      const tokenScopes = String(decoded?.scp || '').split(' ').map((s) => s.trim()).filter(Boolean);
      const missing = requiredScopes.filter((s) => !tokenScopes.includes(s));
      if (missing.length > 0) {
        return sendAuthError(
          res,
          403,
          'Scopes insuffisants',
          'insufficient_scopes',
          AUTH_DEBUG ? { missingScopes: missing, tokenScopes } : undefined
        );
      }
    }

    // Chercher l'utilisateur dans TeamMember
    const member = await prisma.teamMember.findUnique({
      where: { email },
    });

    if (!member || !member.active) {
      // Utilisateur non enregistré ou inactif => lecture seule par défaut
      req.currentUser = {
        email,
        name: decoded.name || email,
        role: "lecture",
        azureId: decoded.oid || decoded.sub
      };
      return next();
    }

    // Utilisateur trouvé et actif
    req.currentUser = {
      id: member.id,
      email: member.email,
      name: member.name || decoded.name || member.email,
      role: member.role || "user",
      azureId: decoded.oid || decoded.sub
    };

    next();
  } catch (err) {
    console.error("Erreur dans authMiddleware:", err);
    return res
      .status(500)
      .json({ error: "Erreur serveur pendant l'authentification." });
  }
}

function requireMinRole(minRole) {
  const weights = { lecture: 1, user: 2, admin: 3 };
  return (req, res, next) => {
    const role = req.currentUser?.role || "user";
    if (weights[role] < weights[minRole]) {
      return res
        .status(403)
        .json({ error: "Droits insuffisants pour cette opération." });
    }
    next();
  };
}

// Route de test PUBLIC (avant auth middleware)
app.get("/api/ping", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "RfactO API is running", 
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

// Middleware d'auth global
app.use(authMiddleware);

// Log de debug pour voir le rôle de chaque requête
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${req.method}] ${req.path} → role=${req.currentUser?.role || 'none'} email=${req.currentUser?.email || 'none'}`);
  }
  next();
});

// Route de santé
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", user: req.currentUser });
});

// === DEBUG ROUTES (protégées) ======================================
// Renvoie les informations du jeton reçu (aud, scp, iss, email)
app.get("/api/debug/token", (req, res) => {
  const d = req.tokenDecoded || {};
  res.json({
    aud: d.aud || null,
    scp: d.scp || null,
    iss: d.iss || null,
    appid: d.appid || null,
    azp: d.azp || null,
    sub: d.sub || null,
    name: d.name || null,
    preferred_username: d.preferred_username || null,
    email: d.email || req.currentUser?.email || null,
    upn: d.upn || null
  });
});

// Route de diagnostic légère (publique) pour vérifier la configuration côté serveur
app.get("/api/debug/status-lite", (req, res) => {
  try {
    const tenant = String(AZURE_TENANT_ID || '').trim();
    const client = String(AZURE_CLIENT_ID || '').trim();
    const safe = (v) => (v && v.length > 8 ? `${v.substring(0,4)}…${v.substring(v.length-4)}` : v || null);
    res.json({
      status: "ok",
      env: {
        nodeEnv: process.env.NODE_ENV || null,
        azureConfigured: Boolean(tenant && tenant !== 'YOUR_TENANT_ID' && client && client !== 'YOUR_CLIENT_ID'),
        tenantId_hint: safe(tenant),
        clientId_hint: safe(client),
      },
      auth: {
        expectedAudiences: [AZURE_CLIENT_ID, `api://${AZURE_CLIENT_ID}`],
        acceptedIssuers: [
          `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`,
          `https://login.microsoftonline.com/${AZURE_TENANT_ID}/`,
          `https://sts.windows.net/${AZURE_TENANT_ID}/`
        ]
      }
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'status-lite failed' });
  }
});

/* ===================== SETTINGS ===================== */

async function ensureSettings() {
  let settings = await prisma.settings.findUnique({
    where: { id: 1 },
  });
  if (!settings) {
    // On essaie de deviner des valeurs par défaut raisonnables
    const taxes = await prisma.taxRate.findMany();
    const defaultProv = taxes[0]?.province || null;

    settings = await prisma.settings.create({
      data: {
        id: 1,
        contractHT: 0,
        contractTTC: 0,
        defaultProvMs: defaultProv,
        defaultProvDcr: defaultProv,
        defaultProvReserve: defaultProv,
      },
    });
  }
  return settings;
}

app.get("/api/settings", requireMinRole("lecture"), async (req, res) => {
  try {
    const settings = await ensureSettings();
    res.json(settings);
  } catch (err) {
    console.error("GET /api/settings error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors du chargement des paramètres." });
  }
});

app.put("/api/settings", requireMinRole("user"), async (req, res) => {
  try {
    const {
      contractHT,
      contractTTC,
      defaultProvMs,
      defaultProvDcr,
      defaultProvReserve,
    } = req.body || {};

    const updated = await prisma.settings.update({
      where: { id: 1 },
      data: {
        contractHT: contractHT != null ? Number(contractHT) : 0,
        contractTTC: contractTTC != null ? Number(contractTTC) : 0,
        defaultProvMs: defaultProvMs || null,
        defaultProvDcr: defaultProvDcr || null,
        defaultProvReserve: defaultProvReserve || null,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("PUT /api/settings error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la mise à jour des paramètres." });
  }
});

/* ===================== PROJECTS ===================== */

app.get("/api/projects", requireMinRole("lecture"), async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { code: "asc" },
    });
    res.json(projects);
  } catch (err) {
    console.error("GET /api/projects error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors du chargement des projets." });
  }
});

app.post("/api/projects", requireMinRole("admin"), async (req, res) => {
  try {
    const { code, label, taxProvince } = req.body || {};
    if (!code || !label) {
      return res.status(400).json({ error: "code et label sont requis." });
    }

    const created = await prisma.project.create({
      data: {
        code,
        label,
        taxProvince: taxProvince || null,
      },
    });

    res.json(created);
  } catch (err) {
    console.error("POST /api/projects error:", err);
    if (err.code === "P2002") {
      return res
        .status(400)
        .json({ error: "Un projet avec ce code existe déjà." });
    }
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la création du projet." });
  }
});

app.put("/api/projects/:id", requireMinRole("user"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { code, label, taxProvince } = req.body || {};

    const updated = await prisma.project.update({
      where: { id },
      data: {
        code,
        label,
        taxProvince: taxProvince || null,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("PUT /api/projects/:id error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la mise à jour du projet." });
  }
});

app.delete("/api/projects/:id", requireMinRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.project.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/projects/:id error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la suppression du projet." });
  }
});

/* ===================== TAX RATES ===================== */

app.get("/api/taxes", requireMinRole("lecture"), async (req, res) => {
  try {
    const taxes = await prisma.taxRate.findMany({
      orderBy: { province: "asc" },
    });
    res.json(taxes);
  } catch (err) {
    console.error("GET /api/taxes error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors du chargement des taxes." });
  }
});

app.post("/api/taxes", requireMinRole("admin"), async (req, res) => {
  try {
    const { province, rate } = req.body || {};
    if (!province) {
      return res.status(400).json({ error: "province est requise." });
    }

    const created = await prisma.taxRate.create({
      data: {
        province,
        rate: rate != null ? Number(rate) : 0,
      },
    });

    res.json(created);
  } catch (err) {
    console.error("POST /api/taxes error:", err);
    if (err.code === "P2002") {
      return res
        .status(400)
        .json({ error: "Une taxe pour cette province existe déjà." });
    }
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la création de la taxe." });
  }
});

app.put("/api/taxes/:id", requireMinRole("user"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { province, rate } = req.body || {};

    const updated = await prisma.taxRate.update({
      where: { id },
      data: {
        province,
        rate: rate != null ? Number(rate) : 0,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("PUT /api/taxes/:id error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la mise à jour de la taxe." });
  }
});

app.delete("/api/taxes/:id", requireMinRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.taxRate.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/taxes/:id error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la suppression de la taxe." });
  }
});

/* ===================== TEAM MEMBERS ===================== */

app.get("/api/team-members", requireMinRole("admin"), async (req, res) => {
  try {
    const list = await prisma.teamMember.findMany({
      orderBy: { email: "asc" },
    });
    res.json(list);
  } catch (err) {
    console.error("GET /api/team-members error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors du chargement des membres." });
  }
});

app.post("/api/team-members", requireMinRole("admin"), async (req, res) => {
  try {
    const { email, name, role, active } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "email est requis." });
    }

    const created = await prisma.teamMember.create({
      data: {
        email: String(email).toLowerCase().trim(),
        name: name || null,
        role: role || "user",
        active: active != null ? !!active : true,
      },
    });

    res.json(created);
  } catch (err) {
    console.error("POST /api/team-members error:", err);
    if (err.code === "P2002") {
      return res
        .status(400)
        .json({ error: "Un membre avec cet email existe déjà." });
    }
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la création du membre." });
  }
});

app.put("/api/team-members/:id", requireMinRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { email, name, role, active } = req.body || {};

    const updated = await prisma.teamMember.update({
      where: { id },
      data: {
        email: email ? String(email).toLowerCase().trim() : undefined,
        name: name ?? null,
        role: role || "user",
        active: active != null ? !!active : true,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("PUT /api/team-members/:id error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la mise à jour du membre." });
  }
});

app.delete(
  "/api/team-members/:id",
  requireMinRole("admin"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      await prisma.teamMember.delete({ where: { id } });
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/team-members/:id error:", err);
      res.status(500).json({
        error: "Erreur serveur lors de la suppression du membre.",
      });
    }
  }
);

/* ===================== CLAIMS ===================== */

const claimInclude = {
  project: true,
};

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

async function resolveTaxRate(province, fallbackRate) {
  if (!province) return fallbackRate || 0;
  const tax = await prisma.taxRate.findUnique({
    where: { province },
  });
  if (!tax) return fallbackRate || 0;
  return tax.rate;
}

app.get("/api/claims", requireMinRole("lecture"), async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
      include: claimInclude,
      orderBy: [{ invoiceDate: "asc" }, { id: "asc" }],
    });
    res.json(claims);
  } catch (err) {
    console.error("GET /api/claims error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors du chargement des claims." });
  }
});

app.post("/api/claims", requireMinRole("user"), async (req, res) => {
  try {
    const {
      type,
      step,
      projectCode,
      invoiceDate,
      description,
      province,
      taxRate,
      amountHT,
      amountTTC,
      invoiceNumber,
      status,
      extraC228,
      extraC229,
      extraC230,
      extraC231,
      extraNLT5,
      extraNLT6,
    } = req.body || {};

    let projectId = null;
    let effectiveProvince = province || null;

    if (projectCode) {
      const project = await prisma.project.findUnique({
        where: { code: projectCode },
      });
      if (project) {
        projectId = project.id;
        if (!effectiveProvince && project.taxProvince) {
          effectiveProvince = project.taxProvince;
        }
      }
    }

    const rate = await resolveTaxRate(effectiveProvince, taxRate);
    const ht = amountHT != null ? Number(amountHT) : 0;
    const ttc =
      amountTTC != null ? Number(amountTTC) : ht * (1 + (rate || 0));

    // 🔒 Anti-doublon UNIQUEMENT pour les milestones
if ((type || "milestone") === "milestone" && step && projectId) {
  const existing = await prisma.claim.findFirst({
    where: {
      type: "milestone",
      step: step,
      projectId: projectId,
    },
  });

  if (existing) {
    return res.status(409).json({
      error:
        "Cette milestone existe déjà pour ce projet (même étape).",
    });
  }
}

    const created = await prisma.claim.create({
      data: {
        type: type || "milestone",
        step: step || null,
        projectId,
        invoiceDate: parseDateOrNull(invoiceDate),
        description: description || null,
        province: effectiveProvince,
        taxRate: rate,
        amountHT: ht,
        amountTTC: ttc,
        invoiceNumber: invoiceNumber || null,
        status: status || "À facturer",
        extraC228: extraC228 != null ? Number(extraC228) : null,
        extraC229: extraC229 != null ? Number(extraC229) : null,
        extraC230: extraC230 != null ? Number(extraC230) : null,
        extraC231: extraC231 != null ? Number(extraC231) : null,
        extraNLT5: extraNLT5 != null ? Number(extraNLT5) : null,
        extraNLT6: extraNLT6 != null ? Number(extraNLT6) : null,
      },
      include: claimInclude,
    });

    res.json(created);
  } catch (err) {
    console.error("POST /api/claims error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la création de la claim." });
  }
});

app.put("/api/claims/:id", requireMinRole("user"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    console.log(`[PUT /api/claims/${id}] Payload reçu:`, JSON.stringify(req.body));
    
    const {
      type,
      step,
      projectCode,
      invoiceDate,
      description,
      province,
      taxRate,
      amountHT,
      amountTTC,
      invoiceNumber,
      status,
      extraC228,
      extraC229,
      extraC230,
      extraC231,
      extraNLT5,
      extraNLT6,
    } = req.body || {};

    // ✅ PATCH PARTIEL : ne mettre à jour QUE les champs envoyés
    const dataToUpdate = {};

    if (type !== undefined) dataToUpdate.type = type;
    if (step !== undefined) dataToUpdate.step = step || null;
    if (description !== undefined) dataToUpdate.description = description || null;
    if (invoiceNumber !== undefined) dataToUpdate.invoiceNumber = invoiceNumber || null;
    if (status !== undefined) dataToUpdate.status = status || null;
    if (invoiceDate !== undefined) dataToUpdate.invoiceDate = parseDateOrNull(invoiceDate);

    // Projet
    if (projectCode !== undefined) {
      const project = await prisma.project.findUnique({
        where: { code: projectCode },
      });
      dataToUpdate.projectId = project ? project.id : null;
      
      // Si province non fournie et projet a une province par défaut, l'utiliser
      if (province === undefined && project?.taxProvince) {
        dataToUpdate.province = project.taxProvince;
      }
    }

    // Province
    if (province !== undefined) {
      dataToUpdate.province = province || null;
    }

    // Montants et taxes
    if (taxRate !== undefined || province !== undefined || projectCode !== undefined) {
      const effectiveProvince = dataToUpdate.province || province;
      const rate = await resolveTaxRate(effectiveProvince, taxRate);
      dataToUpdate.taxRate = rate;
    }

    if (amountHT !== undefined) {
      const ht = Number(amountHT) || 0;
      dataToUpdate.amountHT = ht;
      
      // Recalculer TTC si taxRate est connu
      if (dataToUpdate.taxRate !== undefined || taxRate !== undefined) {
        const rate = dataToUpdate.taxRate ?? taxRate ?? 0;
        dataToUpdate.amountTTC = ht * (1 + Number(rate));
      }
    }

    if (amountTTC !== undefined) {
      dataToUpdate.amountTTC = Number(amountTTC) || 0;
    }

    // Extras
    if (extraC228 !== undefined) dataToUpdate.extraC228 = extraC228 != null ? Number(extraC228) : null;
    if (extraC229 !== undefined) dataToUpdate.extraC229 = extraC229 != null ? Number(extraC229) : null;
    if (extraC230 !== undefined) dataToUpdate.extraC230 = extraC230 != null ? Number(extraC230) : null;
    if (extraC231 !== undefined) dataToUpdate.extraC231 = extraC231 != null ? Number(extraC231) : null;
    if (extraNLT5 !== undefined) dataToUpdate.extraNLT5 = extraNLT5 != null ? Number(extraNLT5) : null;
    if (extraNLT6 !== undefined) dataToUpdate.extraNLT6 = extraNLT6 != null ? Number(extraNLT6) : null;

    const updated = await prisma.claim.update({
      where: { id },
      data: dataToUpdate,
      include: claimInclude,
    });

    console.log(`[PUT /api/claims/${id}] Mise à jour réussie:`, { fieldsUpdated: Object.keys(dataToUpdate), resultId: updated.id });
    res.json(updated);
  } catch (err) {
    console.error("PUT /api/claims/:id error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la mise à jour de la claim." });
  }
});

app.delete("/api/claims/:id", requireMinRole("user"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.claim.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/claims/:id error:", err);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de la suppression de la claim." });
  }
});

/* ===================== CLAIM FILES (UPLOAD / LIST / DELETE) ===================== */

// Upload d’un fichier pour une claim
app.post(
  "/api/claims/:id/files",
  requireMinRole("user"),
  upload.single("file"),
  async (req, res) => {
    try {
      const claimId = Number(req.params.id);
      if (!claimId || Number.isNaN(claimId)) {
        return res.status(400).json({ error: "ID de claim invalide." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Aucun fichier reçu." });
      }

      const category =
        req.body.category === "claim" || req.body.category === "invoice"
          ? req.body.category
          : "invoice";

const storedName = req.file.filename;

const file = await prisma.claimFile.create({
  data: {
    claimId,
    category,
    name: req.file.originalname,
    storedName,                // <= AJOUTER CETTE LIGNE
    size: req.file.size,
    mimeType: req.file.mimetype,
    url: "/uploads/" + storedName,
  },
});

      res.json(file);
    } catch (err) {
      console.error("POST /api/claims/:id/files error:", err);
      res
        .status(500)
        .json({ error: "Erreur serveur lors de l'upload du fichier." });
    }
  }
);

// Liste des fichiers d’une claim
app.get(
  "/api/claims/:id/files",
  requireMinRole("lecture"),
  async (req, res) => {
    try {
      const claimId = Number(req.params.id);
      if (!claimId || Number.isNaN(claimId)) {
        return res.status(400).json({ error: "ID de claim invalide." });
      }

      const files = await prisma.claimFile.findMany({
        where: { claimId },
        orderBy: { uploadedAt: "desc" },
      });

      res.json(files);
    } catch (err) {
      console.error("GET /api/claims/:id/files error:", err);
      res
        .status(500)
        .json({ error: "Erreur serveur lors du chargement des fichiers." });
    }
  }
);

// Suppression d’un fichier d’une claim
app.delete(
  "/api/claims/:claimId/files/:fileId",
  requireMinRole("user"),
  async (req, res) => {
    try {
      const claimId = Number(req.params.claimId);
      const fileId = Number(req.params.fileId);

      if (!claimId || Number.isNaN(claimId) || !fileId || Number.isNaN(fileId)) {
        return res.status(400).json({ error: "Paramètres invalides." });
      }

      const existing = await prisma.claimFile.findUnique({
        where: { id: fileId },
      });

      if (!existing || existing.claimId !== claimId) {
        return res.status(404).json({ error: "Fichier introuvable." });
      }

      // suppression physique si possible
      if (existing.url) {
        const absolutePath = path.join(
          uploadDir,
          path.basename(existing.url)
        );
        if (fs.existsSync(absolutePath)) {
          try {
            fs.unlinkSync(absolutePath);
          } catch (e) {
            console.warn("Impossible de supprimer le fichier disque:", e);
          }
        }
      }

      await prisma.claimFile.delete({ where: { id: fileId } });

      res.json({ success: true });
    } catch (err) {
      console.error(
        "DELETE /api/claims/:claimId/files/:fileId error:",
        err
      );
      res
        .status(500)
        .json({ error: "Erreur serveur lors de la suppression du fichier." });
    }
  }
);

app.get(
  "/api/claims/dcr-duplicates",
  requireMinRole("lecture"),
  async (req, res) => {
    try {
      const dcrs = await prisma.claim.findMany({
        where: { type: "dcr" },
        include: { project: true },
        orderBy: [
          { projectId: "asc" },
          { step: "asc" },
          { invoiceDate: "asc" },
        ],
      });

      const map = new Map();
      const duplicates = [];

      for (const dcr of dcrs) {
        const key = [
          dcr.projectId,
          dcr.step,
          dcr.amountHT,
        ].join("|");

        if (map.has(key)) {
          duplicates.push(dcr);
        } else {
          map.set(key, dcr);
        }
      }

      res.json({
        total: duplicates.length,
        duplicates,
      });
    } catch (err) {
      console.error("GET /api/claims/dcr-duplicates error:", err);
      res.status(500).json({
        error: "Erreur lors de la détection des doublons DCR.",
      });
    }
  }
);

/* ===================== DATA RESET ===================== */

// Endpoint pour nettoyer complètement la base de données
app.post("/api/admin/reset-all", requireMinRole("admin"), async (req, res) => {
  try {
    console.log("[ADMIN] Réinitialisation complète de la base de données...");

    // Supprimer dans l'ordre pour respecter les FK
    await prisma.claimFile.deleteMany({});
    const claimsDeleted = await prisma.claim.deleteMany({});
    console.log(`  ✓ ${claimsDeleted.count} claims supprimées`);

    await prisma.teamMember.deleteMany({});
    console.log(`  ✓ Membres supprimés`);

    await prisma.taxRate.deleteMany({});
    console.log(`  ✓ Taxes supprimées`);

    await prisma.project.deleteMany({});
    console.log(`  ✓ Projets supprimés`);

    res.json({
      success: true,
      message: `Base de données réinitialisée. ${claimsDeleted.count} claims supprimées.`
    });
  } catch (err) {
    console.error("POST /api/admin/reset-all error:", err);
    res.status(500).json({ error: "Erreur lors de la réinitialisation." });
  }
});

/* ===================== START SERVER ===================== */

app.listen(PORT, () => {
  console.log(`RfactO backend listening on http://localhost:${PORT}`);
});

/* process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
}); */
