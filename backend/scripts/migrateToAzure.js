// Script de migration vers Azure (ou autre destination)
// Trouve le dernier backup et l'importe dans la base de données configurée (via DATABASE_URL)
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Démarrage de la migration des données vers la base de destination...');
  
  // 1. Trouver le dernier backup
  const backupsDir = path.join(__dirname, '../backups');
  let backupFile = null;

  if (fs.existsSync(backupsDir)) {
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
      .reverse(); // Le plus récent en premier
    
    if (files.length > 0) {
      backupFile = path.join(backupsDir, files[0]);
    }
  }

  // Fallback sur le backup racine si aucun dans backups/
  if (!backupFile) {
    const rootBackup = path.join(__dirname, '../../backup.json');
    if (fs.existsSync(rootBackup)) {
      backupFile = rootBackup;
    }
  }

  if (!backupFile) {
    console.error('❌ Aucun fichier de backup trouvé !');
    process.exit(1);
  }

  console.log(`📦 Fichier source identifié : ${path.basename(backupFile)}`);
  const data = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

  // 2. Nettoyage de la base de destination
  console.log('\n🧹 Nettoyage de la base de données cible...');
  try {
    // Ordre de suppression important (FK)
    await prisma.claimFile.deleteMany({});
    await prisma.claim.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.settings.deleteMany({});
    await prisma.taxRate.deleteMany({});
    await prisma.project.deleteMany({});
    console.log('  ✓ Base vidée avec succès');
  } catch (e) {
    console.error('  ⚠️ Erreur lors du nettoyage (la base est peut-être déjà vide ou tables manquantes):', e.message);
  }

  // 3. Import
  console.log('\n📥 Import des données...');

  // --- Projects ---
  if (data.projects?.length) {
    for (const p of data.projects) {
      await prisma.project.create({
        data: {
          id: p.id,
          code: p.code,
          label: p.label,
          taxProvince: p.taxProvince
        }
      });
    }
    console.log(`  ✓ ${data.projects.length} projets`);
  }

  // --- Taxes ---
  if (data.taxes?.length) {
    for (const t of data.taxes) {
      await prisma.taxRate.create({
        data: {
          id: t.id,
          province: t.province,
          rate: t.rate || t.taxRate
        }
      });
    }
    console.log(`  ✓ ${data.taxes.length} taxes`);
  }

  // --- Settings ---
  if (data.settings) {
    const s = data.settings;
    // Azure SQL/Prisma typage
    const paymentClaimRowsJson = typeof s.paymentClaimRowsJson === 'string' 
      ? s.paymentClaimRowsJson 
      : JSON.stringify(s.paymentClaimRowsJson || []);
      
    const columnNames = typeof s.columnNames === 'string'
      ? s.columnNames
      : JSON.stringify(s.columnNames || {});

    await prisma.settings.create({
      data: {
        id: 1, // Force ID 1
        contractHT: s.contractHT ?? 0,
        contractTTC: s.contractTTC ?? 0,
        contractNumber: s.contractNumber,
        defaultProvMs: s.defaultProvMs,
        defaultProvDcr: s.defaultProvDcr,
        defaultProvReserve: s.defaultProvReserve,
        processingTaxProv1: s.processingTaxProv1,
        processingTaxProv2: s.processingTaxProv2,
        processingTaxProv3: s.processingTaxProv3,
        paymentClaimRowsJson: paymentClaimRowsJson,
        columnNames: columnNames,
        delayAFacturer: s.delayAFacturer ?? 1,
        delayFacture: s.delayFacture ?? 1,
        delayPaye: s.delayPaye ?? 1,
        delayAFacturerUnit: s.delayAFacturerUnit ?? 'months',
        delayFactureUnit: s.delayFactureUnit ?? 'months',
        delayPayeUnit: s.delayPayeUnit ?? 'months'
      }
    });
    console.log(`  ✓ Settings`);
  }

  // --- Team Members ---
  if (data.teamMembers?.length) {
    for (const m of data.teamMembers) {
      await prisma.teamMember.create({
        data: {
          // Pas d'id forcé si possible, mais pour synchro user on peut garder le même si pas conflit
          // Ici on laisse autoincrement ou on force selon la dispo dans backup
          email: m.email.toLowerCase(),
          name: m.name,
          role: m.role || 'user',
          active: m.active ?? true
        }
      });
    }
    console.log(`  ✓ ${data.teamMembers.length} membres`);
  }

  // --- Claims ---
  if (data.claims?.length) {
    let count = 0;
    for (const c of data.claims) {
      await prisma.claim.create({
        data: {
          id: c.id, // Important de garder l'historique des IDs
          type: c.type,
          step: c.step,
          invoiceDate: c.invoiceDate ? new Date(c.invoiceDate) : null,
          description: c.description,
          province: c.province,
          taxRate: c.taxRate,
          amountHT: c.amountHT,
          amountTTC: c.amountTTC,
          invoiceNumber: c.invoiceNumber,
          status: c.status,
          extraC228: c.extraC228,
          extraC229: c.extraC229,
          extraC230: c.extraC230,
          extraC231: c.extraC231,
          extraNLT5: c.extraNLT5,
          extraNLT6: c.extraNLT6,
          projectId: c.projectId // Relation FK valide car projets importés avant
        }
      });
      count++;
      if (count % 50 === 0) process.stdout.write('.');
    }
    console.log(`\n  ✓ ${count} claims`);
  }

  console.log('\n✅ Migration terminée avec succès !');
}

main()
  .catch(e => {
    console.error('❌ Erreur fatale:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
