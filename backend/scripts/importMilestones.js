// scripts/importMilestones.js
const { PrismaClient } = require("@prisma/client");
const path = require("path");

const prisma = new PrismaClient();

// correspondance nlt1..4 -> code projet
const PROJECT_CODES = {
  1: "NLT1",
  2: "NLT2",
  3: "NLT3",
  4: "NLT4"
};

async function main() {
  console.log("=== Import des milestones ===");

  // On charge ton fichier JS directement
  const dataPath = path.join(__dirname, "../data/milestones.js");
  const milestones = require(dataPath);

  for (const item of milestones) {
    const milestoneRef = item.milestone;

    // on ignore la dernière ligne de totaux ou les lignes vides
    if (
      milestoneRef === null ||
      typeof milestoneRef === "undefined" ||
      Number.isNaN(milestoneRef)
    ) {
      continue;
    }

    const stepRef = String(milestoneRef).trim(); // ex: "9.3a", "4.2b", "1"
    const description = (item.description || "").trim();

    // pour chaque NLT1..4
    for (const idx of [1, 2, 3, 4]) {
      const key = "nlt" + idx;
      let value = item[key];

      // si valeur absente ou NaN → on saute
      if (value == null || Number.isNaN(value)) continue;

      value = Number(value);
      if (!Number.isFinite(value) || value === 0) continue;

      const codeProjet = PROJECT_CODES[idx];
      if (!codeProjet) {
        console.warn("Projet inconnu pour index", idx, "milestone", stepRef);
        continue;
      }

      // vérifier / créer le projet NLT1..4
      let project = await prisma.project.findUnique({
        where: { code: codeProjet }
      });

      if (!project) {
        project = await prisma.project.create({
          data: {
            code: codeProjet,
            label: codeProjet + " (auto-import milestones)",
            taxProvince: null
          }
        });
        console.log("→ Projet créé :", codeProjet);
      }

      // créer le claim milestone
      const dataClaim = {
        type: "milestone",
        project: { connect: { id: project.id } }, // Modification pour utiliser 'connect'
        step: stepRef,               // colonne ÉTAPE (#) dans l’UI
        description,
        amountHT: value,
        amountTTC: 0,             // CORRECTION: 0 au lieu de null (champ Float non-nullable)
        taxRate: 0,
        province: null,
        status: "À facturer",
        invoiceDate: null,
        invoiceNumber: null,

        extraC228: null,
        extraC229: null,
        extraC230: null,
        extraC231: null,
        extraNLT5: null,
        extraNLT6: null
      };

      await prisma.claim.create({ data: dataClaim });

      console.log(
        `+ Milestone importé : ${stepRef} | ${codeProjet} | ${description} | ${value} $`
      );
    }
  }

  console.log("=== Import milestones terminé ===");
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
