const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Parse dates in DD/MM/YYYY or YYYY-MM-DD format
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Try DD/MM/YYYY format
  if (dateStr.includes('/')) {
    const [day, month, year] = dateStr.split('/');
    if (day && month && year) {
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
  }
  
  // Try YYYY-MM-DD format
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }
  
  return null;
}

async function importDcrsFactures() {
  try {
    // Lire le fichier JSON
    const jsonPath = path.join(__dirname, '../data/dcrs-factures.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    console.log(`📦 ${data.length} DCR à traiter...`);
    
    let created = 0;
    let updated = 0;
    let errors = 0;
    
    for (const item of data) {
      try {
        // Extraire le code DCR (ex: "DCR-001")
        const dcrCode = item.dcr;
        
        // Préparer les données avec les vrais noms de colonnes du schéma
        const claimData = {
          type: 'dcr',
          step: item.description,
          status: 'Facturé', // IMPORTANT: statut "Facturé"
          taxRate: item.taxe || 0,
          projectId: 1, // Valeur par défaut
          invoiceDate: parseDate(item.date_facture),
          invoiceNumber: item.no_facture || null,
          amountHT: item.montant_ht || 0,
          amountTTC: item.montant_ttc || 0,
          extraC228: item.nlt1 || null,
          extraC229: item.nlt2 || null,
          extraC230: item.nlt3 || null,
          extraC231: item.nlt4 || null,
        };
        
        // Chercher si le DCR existe déjà (par type 'dcr' et step contenant le code)
        const existing = await prisma.claim.findFirst({
          where: {
            type: 'dcr',
            step: {
              contains: dcrCode
            }
          }
        });
        
        if (existing) {
          // Mettre à jour
          await prisma.claim.update({
            where: { id: existing.id },
            data: claimData
          });
          console.log(`✓ Mis à jour: ${dcrCode} - ${item.description} (Facture: ${item.no_facture})`);
          updated++;
        } else {
          // Créer
          await prisma.claim.create({
            data: claimData
          });
          console.log(`✓ Créé: ${dcrCode} - ${item.description} (Facture: ${item.no_facture})`);
          created++;
        }
        
      } catch (error) {
        console.error(`✗ Erreur pour ${item.dcr}:`, error.message);
        errors++;
      }
    }
    
    console.log('\n📊 Résumé:');
    console.log(`  ✓ DCR créés: ${created}`);
    console.log(`  ✓ DCR mis à jour: ${updated}`);
    console.log(`  ✗ Erreurs: ${errors}`);
    
    // Afficher le nombre total de claims
    const totalCount = await prisma.claim.count();
    const dcrCount = await prisma.claim.count({ where: { type: 'dcr' } });
    const milestoneCount = await prisma.claim.count({ where: { type: 'milestone' } });
    
    console.log(`\n🗄️  Base de données:`);
    console.log(`  Total claims: ${totalCount}`);
    console.log(`  DCR: ${dcrCount}`);
    console.log(`  Milestones: ${milestoneCount}`);
    
  } catch (error) {
    console.error('Erreur lors de l\'import:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

importDcrsFactures();
