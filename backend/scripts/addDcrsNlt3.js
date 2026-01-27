// scripts/addDcrsNlt3.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const NEW_DCRS_NLT3 = [
  {
    step: "DCR-033",
    description: "DCR 033 Bilge wells in U8 C-330",
    invoiceDate: "2025-10-28",
    taxRate: 0.14,
    amountHT: 16315.10,
    invoiceNumber: "90168188"
  },
  {
    step: "DCR-038",
    description: "DCR 038 Change of Shelves C-330",
    invoiceDate: "2024-04-11",
    taxRate: 0.14,
    amountHT: 8155.00,
    invoiceNumber: "90168186"
  },
  {
    step: "DCR-039",
    description: "DCR 039 Additional charger C-330",
    invoiceDate: "2025-10-15",
    taxRate: 0.14,
    amountHT: 34449.69,
    invoiceNumber: "90167374"
  },
  {
    step: "DCR-045",
    description: "DCR 045 Tarp for U8 hatch C-330",
    invoiceDate: "2025-11-26",
    taxRate: 0.14,
    amountHT: 1830.00,
    invoiceNumber: "90169936"
  }
];

async function main() {
  console.log("=== Ajout des DCR NLT3 (statut Facturé) ===");

  const project = await prisma.project.findUnique({
    where: { code: "NLT3" }
  });

  if (!project) {
    throw new Error("Projet NLT3 introuvable. Crée d'abord NLT3 dans /projects.");
  }

  for (const row of NEW_DCRS_NLT3) {
    const ht = row.amountHT;
    const ttc = ht * (1 + row.taxRate);

    const created = await prisma.claim.create({
      data: {
        type: "dcr",
        step: row.step,
        description: row.description,
        projectId: project.id,
        province: project.taxProvince || null,
        taxRate: row.taxRate,
        amountHT: ht,
        amountTTC: ttc,
        status: "Facturé",
        invoiceDate: new Date(row.invoiceDate),
        invoiceNumber: row.invoiceNumber
      }
    });

    console.log(`✔ Ajoutée : ${created.step} (${created.amountHT} $ HT)`);
  }

  console.log("=== Terminé ===");
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
});
