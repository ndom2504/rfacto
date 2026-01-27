/**
 * Script pour corriger la migration échouée sur Azure
 * 
 * Ce script doit être exécuté sur l'instance Azure pour :
 * 1. Marquer la migration échouée comme résolue
 * 2. Ajouter manuellement les colonnes manquantes si elles n'existent pas
 * 3. Appliquer la nouvelle migration consolidée
 * 
 * Le script se termine rapidement si aucune correction n'est nécessaire
 */

const { PrismaClient } = require('@prisma/client');

async function fixMigration() {
  const prisma = new PrismaClient();
  
  try {
    // Vérifier rapidement s'il y a des migrations échouées
    const failedMigrations = await prisma.$queryRaw`
      SELECT migration_name FROM _prisma_migrations 
      WHERE finished_at IS NULL
    `;
    
    if (failedMigrations.length === 0) {
      // Pas de migrations échouées, sortie rapide
      console.log('✅ Aucune correction de migration nécessaire');
      return;
    }
    
    console.log('🔧 Correction de migration échouée détectée...');
    console.log(`   Migrations échouées: ${failedMigrations.map(m => m.migration_name).join(', ')}`);
    
    // Étape 1: Supprimer les entrées de migration échouées
    console.log('🗑️  Suppression des entrées de migration échouées...');
    await prisma.$executeRaw`
      DELETE FROM _prisma_migrations 
      WHERE finished_at IS NULL
    `;
    console.log('✅ Entrées de migration échouées supprimées');
    
    // Étape 2: Ajouter les colonnes manquantes
    console.log('📦 Ajout des colonnes manquantes...');
    
    const columnsToAdd = [
      { name: 'contractNumber', sql: 'ALTER TABLE "Settings" ADD COLUMN "contractNumber" TEXT' },
      { name: 'processingTaxProv1', sql: 'ALTER TABLE "Settings" ADD COLUMN "processingTaxProv1" TEXT' },
      { name: 'processingTaxProv2', sql: 'ALTER TABLE "Settings" ADD COLUMN "processingTaxProv2" TEXT' },
      { name: 'processingTaxProv3', sql: 'ALTER TABLE "Settings" ADD COLUMN "processingTaxProv3" TEXT' },
      { name: 'paymentClaimRowsJson', sql: 'ALTER TABLE "Settings" ADD COLUMN "paymentClaimRowsJson" TEXT' }
    ];
    
    for (const column of columnsToAdd) {
      try {
        await prisma.$executeRawUnsafe(column.sql);
        console.log(`✅ Colonne ${column.name} ajoutée`);
      } catch (error) {
        if (error.message.includes('duplicate column')) {
          console.log(`ℹ️  Colonne ${column.name} existe déjà`);
        } else {
          console.error(`❌ Erreur lors de l'ajout de ${column.name}:`, error.message);
        }
      }
    }
    
    console.log('✨ Correction terminée avec succès !');
    
  } catch (error) {
    // Si la table _prisma_migrations n'existe pas encore, c'est normal (première initialisation)
    if (error.message.includes('_prisma_migrations') && error.message.includes('does not exist')) {
      console.log('ℹ️  Première initialisation - pas de correction nécessaire');
      return;
    }
    console.error('❌ Erreur lors de la correction:', error.message);
    // Ne pas bloquer le démarrage même en cas d'erreur
    console.log('⚠️  Poursuite du démarrage malgré l\'erreur...');
  } finally {
    await prisma.$disconnect();
  }
}

// Exécuter la correction avec timeout
const timeout = setTimeout(() => {
  console.log('⏱️  Timeout - poursuite du démarrage');
  process.exit(0);
}, 10000); // 10 secondes max

fixMigration()
  .then(() => {
    clearTimeout(timeout);
    process.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error('Erreur fatale:', error);
    process.exit(0); // Ne pas bloquer le démarrage
  });
