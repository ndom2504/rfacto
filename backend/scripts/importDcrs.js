const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

// Correspondance nlt1..4 -> code projet
const PROJECT_CODES = {
  1: "NLT1",
  2: "NLT2",
  3: "NLT3",
  4: "NLT4"
};

async function main() {
  console.log("=== Import des DCR ===");

  const filePath = path.join(__dirname, "../data/dcrs.json");
  if (!fs.existsSync(filePath)) {
    console.error("Fichier dcrs.json introuvable :", filePath);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let dcrList;
  try {
    dcrList = JSON.parse(raw);
  } catch (err) {
    console.error("Erreur de parsing JSON sur dcrs.json :", err.message);
    console.error("Assure-toi que le fichier est un tableau JSON pur sans `const` ni `NaN`.");
    process.exit(1);
  }

  for (const item of dcrList) {
    // Référence DCR : "DCR 001", "DCR 037", etc.
    const stepRefRaw = item.dcr || item.DCR || null;
    const stepRef = stepRefRaw ? String(stepRefRaw).trim() : null;

    const baseDescription = item.description || item.Description || "";
    const extraVal = Number(item.extra ?? 0);
    const hasEng = Number.isFinite(extraVal) && extraVal !== 0;

    // Pour chaque NLT1..4
    for (const idx of [1, 2, 3, 4]) {
      const key = "nlt" + idx;
      let amount = item[key];

      // Si pas de montant -> on saute
      if (amount == null) continue;
      amount = Number(amount);
      if (!Number.isFinite(amount) || amount === 0) continue;

      const codeProjet = PROJECT_CODES[idx];
      if (!codeProjet) {
        console.warn("Code projet introuvable pour index", idx, "ligne DCR", stepRef);
        continue;
      }

      // Vérifier / créer le projet NLT1..4
      let project = await prisma.project.findUnique({
        where: { code: codeProjet }
      });

      if (!project) {
        project = await prisma.project.create({
          data: {
            code: codeProjet,
            label: codeProjet + " (auto-import DCRs)",
            taxProvince: null
          }
        });
        console.log("→ Projet créé :", codeProjet);
      }

      // Description avec mention ENG si extra > 0
      let description = baseDescription;
      if (hasEng) {
        description = description.trim();
        if (!description.toUpperCase().includes("ENG")) {
          description = description ? description + " (ENG)" : "ENG";
        }
      }

      const dataClaim = {
        type: "dcr",
        project: { connect: { id: project.id } }, // Modification pour utiliser 'connect'
        step: stepRef,           // colonne "Étape" (#) dans le front
        description,
        amountHT: amount,
        amountTTC: 0,         // CORRECTION: 0 au lieu de null
        taxRate: 0,
        province: null,
        status: "À facturer",
        invoiceDate: null,
        invoiceNumber: null,

        // Colonnes extra
        extraC228: null,
        extraC229: null,
        extraC230: null,
        extraC231: null,
        // je garde l’extra dans extraNLT5 pour info (optionnel)
        extraNLT5: hasEng ? extraVal : null,
        extraNLT6: null
      };

      await prisma.claim.create({ data: dataClaim });

      console.log(
        `+ DCR importée : ${stepRef || "N/A"} | ${codeProjet} | ${description} | ${amount} $` +
          (hasEng ? " (ENG)" : "")
      );
    }
  }

  console.log("=== Import DCR terminé ===");
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
