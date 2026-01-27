const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyMigration() {
  console.log('🔍 Vérification de l\'état des migrations et du schéma...\n');
  
  try {
    // 1. Vérifier les migrations appliquées
    console.log('📋 Migrations appliquées:');
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, logs 
      FROM _prisma_migrations 
      WHERE finished_at IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 5
    `;
    migrations.forEach(m => {
      console.log(`  ✅ ${m.migration_name}`);
    });
    
    // 2. Vérifier qu'il n'y a pas de migrations échouées
    console.log('\n⚠️  Vérification des migrations échouées:');
    const failedMigrations = await prisma.$queryRaw`
      SELECT migration_name, started_at, logs 
      FROM _prisma_migrations 
      WHERE finished_at IS NULL
    `;
    
    if (failedMigrations.length === 0) {
      console.log('  ✅ Aucune migration échouée');
    } else {
      console.log('  ❌ Migrations échouées détectées:');
      failedMigrations.forEach(m => {
        console.log(`     - ${m.migration_name}`);
      });
    }
    
    // 3. Vérifier la structure de la table Settings
    console.log('\n📦 Structure de la table Settings:');
    const tableInfo = await prisma.$queryRaw`PRAGMA table_info(Settings)`;
    const columnNames = tableInfo.map(col => col.name);
    
    const requiredColumns = [
      'id', 'contractHT', 'contractTTC', 'contractNumber',
      'defaultProvMs', 'defaultProvDcr', 'defaultProvReserve',
      'processingTaxProv1', 'processingTaxProv2', 'processingTaxProv3',
      'paymentClaimRowsJson', 'delayAFacturer', 'delayFacture', 'delayPaye',
      'delayAFacturerUnit', 'delayFactureUnit', 'delayPayeUnit', 'columnNames'
    ];
    
    let allColumnsPresent = true;
    requiredColumns.forEach(col => {
      if (columnNames.includes(col)) {
        console.log(`  ✅ ${col}`);
      } else {
        console.log(`  ❌ ${col} - MANQUANTE`);
        allColumnsPresent = false;
      }
    });
    
    // 4. Tester une requête simple
    console.log('\n🧪 Test de lecture Settings:');
    try {
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      if (settings) {
        console.log('  ✅ Lecture réussie');
        console.log(`     - contractNumber: ${settings.contractNumber || 'null'}`);
        console.log(`     - processingTaxProv1: ${settings.processingTaxProv1 || 'null'}`);
      } else {
        console.log('  ⚠️  Aucun enregistrement Settings trouvé (normal si base vide)');
      }
    } catch (error) {
      console.log('  ❌ Erreur:', error.message);
      allColumnsPresent = false;
    }
    
    // Résumé final
    console.log('\n' + '='.repeat(60));
    if (allColumnsPresent && failedMigrations.length === 0) {
      console.log('✅ SUCCÈS - Toutes les vérifications passées !');
      console.log('   L\'application est prête pour le déploiement.');
    } else {
      console.log('❌ ÉCHEC - Des problèmes ont été détectés.');
      console.log('   Exécutez: node scripts/fixAzureMigration.js');
    }
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Erreur lors de la vérification:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyMigration();
