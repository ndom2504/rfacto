const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMigrations() {
  try {
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, logs 
      FROM _prisma_migrations 
      ORDER BY started_at DESC 
      LIMIT 10
    `;
    console.log('Dernières migrations:');
    console.log(JSON.stringify(migrations, null, 2));
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkMigrations();
