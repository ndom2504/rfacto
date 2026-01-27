// scripts/seedTaxRates.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * Codes utilisés :
 *  - AB, BC, MB, NB, NL, NT, NU, ON, PE, QC, SK, YT
 *  - NS1 = Nouvelle-Écosse 15 % (avant le 1er avril)
 *  - NS2 = Nouvelle-Écosse 14 % (après le 1er avril)
 *
 * Les valeurs sont des décimales (ex: 14.975 % = 0.14975)
 */

const TAX_RATES = [
  { province: "AB",  rate: 0.05    },   // Alberta
  { province: "BC",  rate: 0.12    },   // Colombie-Britannique (7 % + 5 %)
  { province: "MB",  rate: 0.12    },   // Manitoba (7 % + 5 %)
  { province: "NB",  rate: 0.15    },   // Nouveau-Brunswick (TVH 15 %)
  { province: "NL",  rate: 0.15    },   // Terre-Neuve-et-Labrador (TVH 15 %)
  { province: "NT",  rate: 0.05    },   // Territoires du Nord-Ouest (TPS 5 %)
  { province: "NS1", rate: 0.15    },   // Nouvelle-Écosse ancienne TVH 15 %
  { province: "NS2", rate: 0.14    },   // Nouvelle-Écosse nouvelle TVH 14 %
  { province: "NU",  rate: 0.05    },   // Nunavut (TPS 5 %)
  { province: "ON",  rate: 0.13    },   // Ontario (TVH 13 %)
  { province: "PE",  rate: 0.15    },   // Île-du-Prince-Édouard (TVH 15 %)
  { province: "QC",  rate: 0.14975 },   // Québec (TPS 5 % + TVQ 9.975 %)
  { province: "SK",  rate: 0.11    },   // Saskatchewan (6 % + 5 %)
  { province: "YT",  rate: 0.05    },   // Yukon (TPS 5 %)
];

async function main() {
  console.log("=== Seed des taxes provinciales ===");

  for (const t of TAX_RATES) {
    await prisma.taxRate.upsert({
      where: { province: t.province },
      update: { rate: t.rate },
      create: {
        province: t.province,
        rate: t.rate,
      },
    });
    console.log(`→ Taxe ${t.province} = ${(t.rate * 100).toFixed(3)} %`);
  }

  console.log("=== Seed terminé ===");
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
