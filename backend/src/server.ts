import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Log de debug pour voir le rôle de chaque requête
app.use((req, _res, next) => {
  const user = (req as any).currentUser;
  if (req.path.startsWith('/api/')) {
    console.log(`[${req.method}] ${req.path} → role=${user?.role || 'none'} email=${user?.email || 'none'}`);
  }
  next();
});

// Petit healthcheck
app.get("/", (req, res) => {
  res.json({ ok: true, message: "RfactO backend up" });
});

/* ============================================================================
   PROJECTS
   ========================================================================== */

app.get("/api/projects", async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { code: "asc" }
    });
    res.json(projects);
  } catch (e) {
    console.error("GET /api/projects", e);
    res.status(500).json({ error: "Erreur lors de la lecture des projets." });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { code, label } = req.body || {};
    const created = await prisma.project.create({
      data: {
        code: code || "NEW",
        label: label || ""
      }
    });
    res.json(created);
  } catch (e) {
    console.error("POST /api/projects", e);
    res.status(500).json({ error: "Erreur lors de la création du projet." });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { code, label } = req.body || {};
    const updated = await prisma.project.update({
      where: { id },
      data: {
        code: code || "NEW",
        label: label || ""
      }
    });
    res.json(updated);
  } catch (e) {
    console.error("PUT /api/projects/:id", e);
    res.status(500).json({ error: "Erreur lors de la mise à jour du projet." });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.project.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/projects/:id", e);
    res.status(500).json({ error: "Erreur lors de la suppression du projet." });
  }
});

/* ============================================================================
   TAXES
   ========================================================================== */

app.get("/api/taxes", async (req, res) => {
  try {
    const taxes = await prisma.tax.findMany({
      orderBy: { province: "asc" }
    });
    res.json(taxes);
  } catch (e) {
    console.error("GET /api/taxes", e);
    res.status(500).json({ error: "Erreur lors de la lecture des taxes." });
  }
});

app.post("/api/taxes", async (req, res) => {
  try {
    const { province, rate } = req.body || {};
    const created = await prisma.tax.create({
      data: {
        province: province || "XX",
        rate: Number(rate) || 0
      }
    });
    res.json(created);
  } catch (e) {
    console.error("POST /api/taxes", e);
    res.status(500).json({ error: "Erreur lors de la création de la taxe." });
  }
});

app.put("/api/taxes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { province, rate } = req.body || {};
    const updated = await prisma.tax.update({
      where: { id },
      data: {
        province: province || "XX",
        rate: Number(rate) || 0
      }
    });
    res.json(updated);
  } catch (e) {
    console.error("PUT /api/taxes/:id", e);
    res.status(500).json({ error: "Erreur lors de la mise à jour de la taxe." });
  }
});

app.delete("/api/taxes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.tax.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/taxes/:id", e);
    res.status(500).json({ error: "Erreur lors de la suppression de la taxe." });
  }
});

/* ============================================================================
   SETTINGS (ENVIRONNEMENT)
   ========================================================================== */

app.get("/api/settings", async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          id: 1,
          contractHT: 0,
          contractTTC: 0,
          contractNumber: null,
          defaultProvMs: null,
          defaultProvDcr: null,
          defaultProvReserve: null,
          processingTaxProv1: null,
          processingTaxProv2: null,
          processingTaxProv3: null,
          paymentClaimRowsJson: null,
          delayAFacturer: 1,
          delayFacture: 1,
          delayPaye: 1,
          delayAFacturerUnit: "months",
          delayFactureUnit: "months",
          delayPayeUnit: "months",
          columnNames: JSON.stringify({
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
          })
        }
      });
    }
    res.json(settings);
  } catch (e) {
    console.error("GET /api/settings", e);
    res.status(500).json({ error: "Erreur lors de la lecture des paramètres." });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const { contractHT, contractTTC, contractNumber, defaultProvMs, defaultProvDcr, defaultProvReserve, processingTaxProv1, processingTaxProv2, processingTaxProv3, paymentClaimRowsJson, delayAFacturer, delayFacture, delayPaye, delayAFacturerUnit, delayFactureUnit, delayPayeUnit, columnNames } = req.body || {};
    const updated = await prisma.settings.upsert({
      where: { id: 1 },
      update: {
        contractHT: contractHT ?? 0,
        contractTTC: contractTTC ?? 0,
        contractNumber: contractNumber ?? null,
        defaultProvMs: defaultProvMs ?? null,
        defaultProvDcr: defaultProvDcr ?? null,
        defaultProvReserve: defaultProvReserve ?? null,
        processingTaxProv1: processingTaxProv1 ?? null,
        processingTaxProv2: processingTaxProv2 ?? null,
        processingTaxProv3: processingTaxProv3 ?? null,
        paymentClaimRowsJson: paymentClaimRowsJson ?? null,
        delayAFacturer: delayAFacturer ?? 1,
        delayFacture: delayFacture ?? 1,
        delayPaye: delayPaye ?? 1,
        delayAFacturerUnit: delayAFacturerUnit ?? "months",
        delayFactureUnit: delayFactureUnit ?? "months",
        delayPayeUnit: delayPayeUnit ?? "months",
        columnNames: columnNames ?? null
      },
      create: {
        id: 1,
        contractHT: contractHT ?? 0,
        contractTTC: contractTTC ?? 0,
        contractNumber: contractNumber ?? null,
        defaultProvMs: defaultProvMs ?? null,
        defaultProvDcr: defaultProvDcr ?? null,
        defaultProvReserve: defaultProvReserve ?? null,
        processingTaxProv1: processingTaxProv1 ?? null,
        processingTaxProv2: processingTaxProv2 ?? null,
        processingTaxProv3: processingTaxProv3 ?? null,
        paymentClaimRowsJson: paymentClaimRowsJson ?? null,
        delayAFacturer: delayAFacturer ?? 1,
        delayFacture: delayFacture ?? 1,
        delayPaye: delayPaye ?? 1,
        delayAFacturerUnit: delayAFacturerUnit ?? "months",
        delayFactureUnit: delayFactureUnit ?? "months",
        delayPayeUnit: delayPayeUnit ?? "months",
        columnNames: columnNames ?? JSON.stringify({
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
        })
      }
    });
    res.json(updated);
  } catch (e) {
    console.error("PUT /api/settings", e);
    res.status(500).json({ error: "Erreur lors de la mise à jour des paramètres." });
  }
});

/* ============================================================================
   CLAIMS
   ========================================================================== */

// Liste des claims
app.get("/api/claims", async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
      include: { project: true },
      orderBy: { id: "asc" }
    });
    res.json(claims);
  } catch (e) {
    console.error("GET /api/claims", e);
    res.status(500).json({ error: "Erreur lors de la lecture des claims." });
  }
});

// Création d'une claim (fix pour ton erreur)
app.post("/api/claims", async (req, res) => {
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
      extraNLT6
    } = req.body || {};

    const ht = Number(amountHT) || 0;
    const rate = Number(taxRate) || 0;
    const ttc = amountTTC != null ? Number(amountTTC) : ht * (1 + rate);

    const created = await prisma.claim.create({
      data: {
        type: type || "milestone",
        step: step ?? null,
        projectCode: projectCode || null,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
        description: description || "",
        province: province || null,
        taxRate: rate,
        amountHT: ht,
        amountTTC: ttc,
        invoiceNumber: invoiceNumber || "",
        status: status || null,
        extraC228: extraC228 ?? null,
        extraC229: extraC229 ?? null,
        extraC230: extraC230 ?? null,
        extraC231: extraC231 ?? null,
        extraNLT5: extraNLT5 ?? null,
        extraNLT6: extraNLT6 ?? null
      },
      include: { project: true }
    });

    res.json(created);
  } catch (e) {
    console.error("POST /api/claims", e);
    res.status(500).json({ error: "Erreur serveur lors de la création de la claim." });
  }
});

// Mise à jour d'une claim
app.put("/api/claims/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
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
      extraNLT6
    } = req.body || {};

    const ht = Number(amountHT) || 0;
    const rate = Number(taxRate) || 0;
    const ttc = amountTTC != null ? Number(amountTTC) : ht * (1 + rate);

    const updated = await prisma.claim.update({
      where: { id },
      data: {
        type: type || "milestone",
        step: step ?? null,
        projectCode: projectCode || null,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
        description: description || "",
        province: province || null,
        taxRate: rate,
        amountHT: ht,
        amountTTC: ttc,
        invoiceNumber: invoiceNumber || "",
        status: status || null,
        extraC228: extraC228 ?? null,
        extraC229: extraC229 ?? null,
        extraC230: extraC230 ?? null,
        extraC231: extraC231 ?? null,
        extraNLT5: extraNLT5 ?? null,
        extraNLT6: extraNLT6 ?? null
      },
      include: { project: true }
    });

    res.json(updated);
  } catch (e) {
    console.error("PUT /api/claims/:id", e);
    res.status(500).json({ error: "Erreur lors de la mise à jour de la claim." });
  }
});

// Suppression d'une claim
app.delete("/api/claims/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.claim.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/claims/:id", e);
    res.status(500).json({ error: "Erreur lors de la suppression de la claim." });
  }
});

/* ============================================================================
   TEAM MEMBERS (autorisations)
   ========================================================================== */

app.get("/api/team-members", async (req, res) => {
  try {
    const list = await prisma.teamMember.findMany({
      orderBy: { email: "asc" }
    });
    res.json(list);
  } catch (e) {
    console.error("GET /api/team-members", e);
    res.status(500).json({ error: "Erreur lors de la lecture des membres." });
  }
});

app.post("/api/team-members", async (req, res) => {
  try {
    const { email, name, role, active } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Email requis" });
    }
    const created = await prisma.teamMember.create({
      data: {
        email,
        name: name ?? null,
        role: role ?? "user",
        active: active !== false
      }
    });
    res.json(created);
  } catch (e) {
    console.error("POST /api/team-members", e);
    res.status(500).json({ error: "Erreur lors de la création du membre." });
  }
});

app.put("/api/team-members/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { email, name, role, active } = req.body || {};
    const updated = await prisma.teamMember.update({
      where: { id },
      data: {
        email,
        name: name ?? null,
        role: role ?? "user",
        active: active !== false
      }
    });
    res.json(updated);
  } catch (e) {
    console.error("PUT /api/team-members/:id", e);
    res.status(500).json({ error: "Erreur lors de la mise à jour du membre." });
  }
});

app.delete("/api/team-members/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.teamMember.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/team-members/:id", e);
    res.status(500).json({ error: "Erreur lors de la suppression du membre." });
  }
});

/* ============================================================================
   IMPORT GLOBAL (JSON)
   ========================================================================== */

app.post("/api/import", async (req, res) => {
  try {
    const { projects, taxes, settings, claims, teamMembers } = req.body || {};

    if (!projects || !taxes || !settings || !claims) {
      return res.status(400).json({
        error: "Format d'import invalide (projects, taxes, settings, claims requis)"
      });
    }

    // On vide tout
    await prisma.claim.deleteMany();
    await prisma.project.deleteMany();
    await prisma.tax.deleteMany();
    await prisma.settings.deleteMany();
    await prisma.teamMember.deleteMany();

    // Projets
    for (const p of projects) {
      await prisma.project.create({
        data: {
          code: p.code,
          label: p.label ?? ""
        }
      });
    }

    // Taxes
    for (const t of taxes) {
      await prisma.tax.create({
        data: {
          province: t.province,
          rate: Number(t.rate) || 0
        }
      });
    }

    // Settings
    await prisma.settings.create({
      data: {
        id: 1,
        contractHT: settings.contractHT ?? 0,
        contractTTC: settings.contractTTC ?? 0,
        contractNumber: settings.contractNumber ?? null,
        defaultProvMs: settings.defaultProvMs ?? null,
        defaultProvDcr: settings.defaultProvDcr ?? null,
        defaultProvReserve: settings.defaultProvReserve ?? null,
        processingTaxProv1: settings.processingTaxProv1 ?? null,
        processingTaxProv2: settings.processingTaxProv2 ?? null,
        processingTaxProv3: settings.processingTaxProv3 ?? null,
        paymentClaimRowsJson: settings.paymentClaimRowsJson ?? null
      }
    });

    // Team members (facultatif)
    if (Array.isArray(teamMembers)) {
      for (const m of teamMembers) {
        if (!m.email) continue;
        await prisma.teamMember.create({
          data: {
            email: m.email,
            name: m.name ?? null,
            role: m.role ?? "user",
            active: m.active !== false
          }
        });
      }
    }

    // Claims
    for (const c of claims) {
      const taxRate = Number(c.taxRate ?? c.rate ?? 0);
      const amountHT = Number(c.amountHT ?? 0);
      const amountTTC = amountHT * (1 + taxRate);
      const projectCode =
        c.projectCode ?? (c.project && c.project.code ? c.project.code : null);

      await prisma.claim.create({
        data: {
          type: c.type || "milestone",
          step: c.step ?? null,
          projectCode,
          invoiceDate: c.invoiceDate ? new Date(c.invoiceDate) : null,
          description: c.description ?? "",
          province: c.province ?? null,
          taxRate,
          amountHT,
          amountTTC,
          invoiceNumber: c.invoiceNumber ?? "",
          status: c.status ?? null,
          extraC228: c.extraC228 ?? null,
          extraC229: c.extraC229 ?? null,
          extraC230: c.extraC230 ?? null,
          extraC231: c.extraC231 ?? null,
          extraNLT5: c.extraNLT5 ?? null,
          extraNLT6: c.extraNLT6 ?? null
        }
      });
    }

    res.json({ ok: true, message: "Import RfactO terminé avec succès." });
  } catch (e) {
    console.error("POST /api/import", e);
    res.status(500).json({ error: "Erreur lors de l'import." });
  }
});

/* ============================================================================
   LANCEMENT DU SERVEUR
   ========================================================================== */

app.listen(PORT, () => {
  console.log(`RfactO backend listening on http://localhost:${PORT}`);
});
