const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const s = await prisma.settings.findFirst();
  if (s?.paymentClaimRowsJson) {
    const rows = JSON.parse(s.paymentClaimRowsJson);
    const rates = new Set();
    rows.forEach(r => {
      if (!r.isTotal && r.taxRate != null) {
        rates.add(r.taxRate);
      }
    });
    console.log('Taux uniques:', Array.from(rates).sort((a,b) => a-b).map(r => (r*100).toFixed(2) + '%'));
    console.log('Nombre de lignes:', rows.length);
    console.log('Lignes non-total:', rows.filter(r => !r.isTotal).length);
    console.log('Lignes total:', rows.filter(r => r.isTotal).length);
  }
  await prisma.$disconnect();
})();
