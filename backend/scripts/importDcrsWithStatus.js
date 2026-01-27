// backend/scripts/importDcrsWithStatus.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dataPath = path.join(__dirname, '..', 'data', 'dcrs-a-facturer.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Fichier introuvable:', dataPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(dataPath, 'utf-8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    console.error('JSON invalide:', e.message);
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  // Parser date format DD/MM/YYYY ou YYYY-MM-DD
  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    dateStr = String(dateStr).trim();
    let d;
    // Format DD/MM/YYYY
    if (dateStr.includes('/')) {
      const [day, month, year] = dateStr.split('/');
      d = new Date(`${year}-${month}-${day}`);
    } else {
      // Format YYYY-MM-DD
      d = new Date(dateStr);
    }
    return d && !isNaN(d.getTime()) ? d : null;
  };

  for (const it of items) {
    const code = String(it.dcr || '').trim();
    const desc = String(it.description || '').trim();
    const montant = Number(it.montant_ht) || 0;
    const status = 'À facturer';

    if (!code || montant <= 0) {
      console.warn(`⚠ Ignoré: ${code} (montant=${montant})`);
      errors++;
      continue;
    }

    // Chercher s'il existe déjà
    const existing = await prisma.claim.findFirst({
      where: {
        type: 'dcr',
        step: { contains: code },
        status: 'À facturer'
      }
    });

    if (existing) {
      // Mettre à jour
      await prisma.claim.update({
        where: { id: existing.id },
        data: {
          description: desc || existing.description,
          amountHT: montant,
          amountTTC: montant * (1 + (it.taxe || 0)),
          taxRate: it.taxe || 0,
          invoiceDate: parseDate(it.date_dcr),
          status
        }
      });
      updated++;
    } else {
      // Créer nouveau
      await prisma.claim.create({
        data: {
          type: 'dcr',
          step: code,
          description: desc || null,
          amountHT: montant,
          amountTTC: montant * (1 + (it.taxe || 0)),
          taxRate: it.taxe || 0,
          invoiceDate: parseDate(it.date_dcr),
          status,
          projectId: null,
          province: null
        }
      });
      created++;
    }
  }

  const totalDcr = await prisma.claim.count({ where: { type: 'dcr' } });
  const totalToInvoice = await prisma.claim.count({
    where: { type: 'dcr', status: 'À facturer' }
  });

  console.log(`✓ DCR créés: ${created}, mis à jour: ${updated}, erreurs: ${errors}`);
  console.log(`  Total DCR: ${totalDcr}, À facturer: ${totalToInvoice}`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
