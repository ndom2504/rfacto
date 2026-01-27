const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.claim.count();
  const dcr = await prisma.claim.count({ where: { type: 'dcr' } });
  const ms = await prisma.claim.count({ where: { type: 'milestone' } });
  console.log({ total, dcr, milestone: ms });
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
