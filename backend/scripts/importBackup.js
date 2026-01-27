// Script pour importer les données depuis rfacto-export.json
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('📦 Chargement du fichier de backup...');
  // Modification pour utiliser le backup racine qui contient ~260 claims
  const backupPath = path.join(__dirname, '../../backup.json');
  
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Fichier backup.json introuvable: ${backupPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  
  console.log('📊 Données trouvées:');
  console.log(`  - ${data.projects?.length || 0} projets`);
  console.log(`  - ${data.taxes?.length || 0} taxes`);
  console.log(`  - ${data.settings ? 1 : 0} settings`);
  console.log(`  - ${data.claims?.length || 0} claims`);
  console.log(`  - ${data.teamMembers?.length || 0} membres d'équipe`);

  // Demander confirmation
  console.log('\n⚠️  Cette opération va:');
  console.log('  1. SUPPRIMER toutes les données existantes');
  console.log('  2. Importer les données du backup');
  console.log('\nContinuer ? Tapez "OUI" pour confirmer:');
  
  // Attendre confirmation (en mode non-interactif, on continue)
  const isInteractive = process.stdin.isTTY;
  if (isInteractive) {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      readline.question('', resolve);
    });
    readline.close();
    
    if (answer.toUpperCase() !== 'OUI') {
      console.log('❌ Import annulé');
      process.exit(0);
    }
  }

  console.log('\n🗑️  Suppression des données existantes...');
  
  // Supprimer dans l'ordre pour respecter les contraintes FK
  await prisma.claimFile.deleteMany({});
  console.log('  ✓ Fichiers de claims supprimés');
  
  await prisma.claim.deleteMany({});
  console.log('  ✓ Claims supprimés');
  
  await prisma.teamMember.deleteMany({});
  console.log('  ✓ Membres d\'équipe supprimés');
  
  await prisma.settings.deleteMany({});
  console.log('  ✓ Settings supprimés');
  
  await prisma.taxRate.deleteMany({});
  console.log('  ✓ Taxes supprimées');
  
  await prisma.project.deleteMany({});
  console.log('  ✓ Projets supprimés');

  console.log('\n📥 Import des données...');

  // Import des projets
  if (data.projects && data.projects.length > 0) {
    for (const project of data.projects) {
      await prisma.project.create({
        data: {
          id: project.id,
          code: project.code,
          label: project.label,
          taxProvince: project.taxProvince
        }
      });
    }
    console.log(`  ✓ ${data.projects.length} projets importés`);
  }

  // Import des taxes
  if (data.taxes && data.taxes.length > 0) {
    for (const tax of data.taxes) {
      await prisma.taxRate.create({
        data: {
          id: tax.id,
          province: tax.province,
          rate: tax.taxRate || tax.rate
        }
      });
    }
    console.log(`  ✓ ${data.taxes.length} taxes importées`);
  }

  // Import des settings (mapper vers le schéma actuel)
  if (data.settings) {
    const s = data.settings;
    await prisma.settings.create({
      data: {
        id: 1,
        contractHT: s.contractHT ?? 0,
        contractTTC: s.contractTTC ?? 0,
        defaultProvMs: s.defaultProvMs ?? null,
        defaultProvDcr: s.defaultProvDcr ?? null,
        defaultProvReserve: s.defaultProvReserve ?? null
      }
    });
    console.log('  ✓ Settings importés');
  }

  // Import des claims
  if (data.claims && data.claims.length > 0) {
    let imported = 0;
    for (const claim of data.claims) {
      try {
        await prisma.claim.create({
          data: {
            id: claim.id,
            type: claim.type,
            step: claim.step,
            invoiceDate: claim.invoiceDate ? new Date(claim.invoiceDate) : null,
            description: claim.description,
            province: claim.province,
            taxRate: claim.taxRate,
            amountHT: claim.amountHT,
            amountTTC: claim.amountTTC,
            invoiceNumber: claim.invoiceNumber,
            status: claim.status,
            extraC228: claim.extraC228,
            extraC229: claim.extraC229,
            extraC230: claim.extraC230,
            extraC231: claim.extraC231,
            extraNLT5: claim.extraNLT5,
            extraNLT6: claim.extraNLT6,
            projectId: claim.projectId
          }
        });
        imported++;
        if (imported % 50 === 0) {
          console.log(`  ... ${imported} claims importés`);
        }
      } catch (error) {
        console.error(`  ⚠️  Erreur import claim ${claim.id}:`, error.message);
      }
    }
    console.log(`  ✓ ${imported} claims importés sur ${data.claims.length}`);
  }

  // Import des team members (mapper vers le schéma actuel)
  if (data.teamMembers && data.teamMembers.length > 0) {
    for (const member of data.teamMembers) {
      await prisma.teamMember.create({
        data: {
          email: String(member.email || '').toLowerCase().trim(),
          name: member.name ?? member.displayName ?? null,
          role: member.role ?? 'user',
          active: member.active ?? true
        }
      });
    }
    console.log(`  ✓ ${data.teamMembers.length} membres d'équipe importés`);
  }

  console.log('\n✅ Import terminé avec succès !');
  console.log('\n📊 Résumé final:');
  
  const counts = await Promise.all([
    prisma.project.count(),
    prisma.taxRate.count(),
    prisma.claim.count(),
    prisma.teamMember.count()
  ]);
  
  console.log(`  - ${counts[0]} projets`);
  console.log(`  - ${counts[1]} taxes`);
  console.log(`  - ${counts[2]} claims`);
  console.log(`  - ${counts[3]} membres d'équipe`);
}

main()
  .catch((e) => {
    console.error('❌ Erreur:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
