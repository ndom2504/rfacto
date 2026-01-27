const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

function parseAmount(val) {
  if (val == null) return 0;
  const s = String(val).trim().replace(/\s+/g, "").replace(/\$/g, "").replace(/,/g, ".");
  const num = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function parseRate(val) {
  const s = String(val || "").trim().toUpperCase();
  if (!s) return 0;
  if (s.includes("AB")) return 0.05;
  if (s.includes("NS1")) return 0.15;
  if (s.includes("NS2")) return 0.14;
  
  // Parse le nombre et le map vers un des 3 taux valides (5%, 14%, 15%)
  const m = s.match(/([0-9]{1,2})([.,]?)([0-9]{0,2})\s*%/);
  if (m) {
    const n = parseFloat(`${m[1]}.${m[3] || ""}`);
    if (Number.isFinite(n)) {
      const rate = n / 100;
      // Mapper vers le taux le plus proche
      if (rate <= 0.095) return 0.05;  // <= 9.5% → 5%
      if (rate <= 0.145) return 0.14;  // <= 14.5% → 14%
      return 0.15;  // sinon → 15%
    }
  }
  const n2 = parseFloat(s.replace(/,/g, "."));
  if (Number.isFinite(n2)) {
    const rate = n2 > 1 ? n2 / 100 : n2;
    // Mapper vers le taux le plus proche
    if (rate <= 0.095) return 0.05;
    if (rate <= 0.145) return 0.14;
    return 0.15;
  }
  return 0;
}

function provinceFromRate(rate) {
  if (Math.abs(rate - 0.05) < 1e-6) return "AB";
  if (Math.abs(rate - 0.15) < 1e-6) return "NS1";
  if (Math.abs(rate - 0.14) < 1e-6) return "NS2";
  return "";
}

function parseCsvToRows(text) {
  const rawLines = String(text || "").split(/\r?\n/);
  const lines = [];
  let buffer = "";
  const pushBuffered = () => { if (buffer.trim()) { lines.push(buffer.trim()); buffer = ""; } };
  rawLines.forEach((ln) => {
    const l = ln.replace(/^\uFEFF/, ""); // strip BOM
    const quoteCount = (l.match(/"/g) || []).length;
    if (quoteCount % 2 === 1) {
      buffer += (buffer ? "\n" : "") + l;
    } else if (buffer) {
      buffer += "\n" + l;
      pushBuffered();
    } else {
      if (l.trim()) lines.push(l.trim());
    }
  });
  if (buffer) pushBuffered();

  const startIdx = lines.findIndex((l) => l.toUpperCase().startsWith("DESCRIPTION"));
  const dataLines = startIdx >= 0 ? lines.slice(startIdx + 1) : lines;
  const imported = [];
  dataLines.forEach((line) => {
    const parts = line.split(/[;,\t]/).map(p => p.trim());
    if (!parts[0]) return;
    const desc = parts[0];
    const numRaw = parts[1];
    const numParsed = numRaw ? parseInt(numRaw, 10) : null;
    const descLower = desc.toLowerCase();
      const amountHT = parseAmount(parts[2]);
    const rateRawCandidate = (parts[3] || "") || (parts[4] || "");
    const isTotal = descLower.startsWith("total ")
      || descLower.startsWith("total claim")
      || descLower.startsWith("total milestone")
      || (descLower.startsWith("claim") && numParsed === 0)
      || (!Number.isFinite(numParsed) && !rateRawCandidate)
      || (amountHT === 0 && desc.trim());
    const num = isTotal ? null : numParsed;
    const rateRaw = (parts[3] || "") || (parts[4] || "");
    const rate = parseRate(rateRaw);
    const proj = ""; // ce CSV n'a pas de colonne projet
    const type = (parts[6] || "").toLowerCase().startsWith("dcr") ? "dcr" : "milestone";
    const prov = isTotal ? "" : provinceFromRate(rate);
    if (!desc && !num && !amountHT) return;
    imported.push({ description: desc, num, amountHT, taxRate: isTotal ? 0 : rate, taxProvince: prov, projectCode: proj, type, isTotal });
  });
  return imported;
}

async function main() {
  console.log("=== Import Payment Claim CSV → Settings.paymentClaimRowsJson ===");
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "../data/payment_claims.csv");
  if (!fs.existsSync(inputPath)) {
    console.error("Fichier CSV introuvable:", inputPath);
    console.error("Utilisation: node scripts/importPaymentClaimsCsv.js <chemin-vers-csv>");
    process.exit(1);
  }
  const csv = fs.readFileSync(inputPath, "utf8");
  const rows = parseCsvToRows(csv);
  console.log(`→ ${rows.length} lignes parsées`);

  // Mettre à jour Settings
  let settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: 1 } });
  }
  await prisma.settings.update({
    where: { id: 1 },
    data: { paymentClaimRowsJson: JSON.stringify(rows) }
  });
  console.log("✓ paymentClaimRowsJson mis à jour dans Settings");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
