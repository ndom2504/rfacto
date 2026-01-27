// scripts/updateDcrStatus.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ✅ DCR qui doivent rester "À facturer"
const stepsAFacturer = [
  "DCR-001",
  "DCR-004",
  "DCR-006",
  "DCR-007",
  "DCR-008",
  "DCR-009",
  "DCR-011",
  "DCR-013",
  "DCR-014",
  "DCR-015",
  "DCR-016",
  "DCR-025",
  "DCR-027",
  "DCR-028",
  "DCR-032",
  "DCR-033",
  "DCR-034",
  "DCR-035",
  "DCR-036",
  "DCR-037",
  "DCR-038",
  "DCR-039",
  "DCR-040",
  "DCR-043",
  "DCR-044"
];

// 👉 Projets correspondant aux navires 230 et 231
const projects230_231 = ["NLT3", "NLT4"];

async function main() {
  console.log("=== Mise à jour des statuts DCR ===");

  // 1. Tout remettre à "Facturé"
  const all = await prisma.claim.updateMany({
    where: { type: "dcr" },
    data: { status: "Facturé" }
  });
  console.log(`Toutes les DCR passent en "Facturé" (${all.count})`);

  // 2. Remettre en "À facturer" uniquement :
  //    - DCR dans stepsAFacturer
  //    - ET projet = NLT3 ou NLT4 (C-230 / C-231)
  const pending = await prisma.claim.updateMany({
    where: {
      type: "dcr",
      step: { in: stepsAFacturer },
      project: {
        is: {
          code: { in: projects230_231 }
        }
      }
    },
    data: { status: "À facturer" }
  });

  console.log(`${pending.count} DCR (NLT3 & NLT4) mises en "À facturer"`);
  console.log("=== Terminé ===");
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
});
