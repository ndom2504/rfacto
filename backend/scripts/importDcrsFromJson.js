// backend/scripts/importDcrsFromJson.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dataPath = path.join(__dirname, '..', 'data', 'dcrs.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Fichier introuvable:', dataPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(dataPath, 'utf-8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    console.error('JSON invalide dans dcrs.json:', e.message);
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;

  // Utilitaire: normalise une valeur numérique
  const n = (v) => {
    if (v == null) return null;
    const num = Number(v);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  for (const it of items) {
    const code = String(it.dcr || '').trim();
    const desc = String(it.description || '').trim();
    if (!code) { skipped++; continue; }
    if (/CANCELLED/i.test(code)) { skipped++; continue; }

    const entries = [
      { key: 'EXTRA', amount: n(it.extra) },
      { key: 'NLT1', amount: n(it.nlt1) },
      { key: 'NLT2', amount: n(it.nlt2) },
      { key: 'NLT3', amount: n(it.nlt3) },
      { key: 'NLT4', amount: n(it.nlt4) },
    ].filter(e => e.amount != null);

    if (entries.length === 0) { skipped++; continue; }

    for (const e of entries) {
      const step = `${code} - ${e.key}`;
      // Vérifier si déjà présent (type+step+projectId null)
      const exists = await prisma.claim.findFirst({
        where: { type: 'dcr', step, projectId: null },
      });
      if (exists) { skipped++; continue; }

      await prisma.claim.create({
        data: {
          type: 'dcr',
          step,
          description: desc || null,
          amountHT: e.amount,
          amountTTC: e.amount, // taxRate par défaut = 0
          taxRate: 0,
          status: 'À facturer',
          projectId: null,
          province: null,
          invoiceDate: null,
        }
      });
      created++;
    }
  }

  const totalDcr = await prisma.claim.count({ where: { type: 'dcr' } });
  console.log(`✓ DCR importés: ${created}, ignorés: ${skipped}, total en DB: ${totalDcr}`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
