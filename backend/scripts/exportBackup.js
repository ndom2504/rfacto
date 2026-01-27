const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('📦 Démarrage de la sauvegarde...');

  try {
    // 1. Récupérer toutes les données reliées
    const projects = await prisma.project.findMany();
    const taxes = await prisma.taxRate.findMany();
    const settings = await prisma.settings.findFirst();
    const claims = await prisma.claim.findMany();
    const teamMembers = await prisma.teamMember.findMany();

    // 2. Préparer l'objet JSON
    const data = {
      metadata: {
        version: "1.0",
        timestamp: new Date().toISOString(),
        exportedBy: "script"
      },
      projects,
      taxes,
      settings,
      claims,
      teamMembers
    };

    // 3. Créer le dossier backups s'il n'existe pas
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // 4. Écrire le fichier timestampé
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${timestamp}.json`;
    const dest = path.join(backupDir, filename);

    fs.writeFileSync(dest, JSON.stringify(data, null, 2));
    
    console.log(`✅ Sauvegarde JSON réussie :`);
    console.log(`   📂 ${dest}`);
    console.log(`   📊 ${claims.length} claims archivés.`);

    // 5. Optionnel : Copier aussi le fichier .db pour une sécurité max
    const dbSource = path.join(__dirname, '..', 'prisma', 'rfacto.db');
    if (fs.existsSync(dbSource)) {
        const dbDest = path.join(backupDir, `rfacto-${timestamp}.db`);
        fs.copyFileSync(dbSource, dbDest);
        console.log(`   💾 Fichier SQLite copié : rfacto-${timestamp}.db`);
    }

  } catch (err) {
    console.error('❌ Erreur lors de la sauvegarde :', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
