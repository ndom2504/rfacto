const fs = require('fs');

const filePath = './app.js';
let content = fs.readFileSync(filePath, 'utf8');

const oldPattern = `.map((r, i) => {
                const datalistId = \`pc-tax-dl-\${i}\`;
                const typeLabel = (r.type || "").toUpperCase() || "MIL";
                return \`
                <tr data-index="\${i}">`;

const newPattern = `.map((r, i) => {
                const datalistId = \`pc-tax-dl-\${i}\`;
                const typeLabel = (r.type || "").toUpperCase() || "MIL";
                if (r.isTotal) {
                  return \`
                <tr data-index="\${i}" class="pc-total-row">
                  <td><strong>\${escapeHtml(r.description)}</strong></td>
                  <td></td>
                  <td></td>
                  <td><strong>\${formatMoney(r.amountHT)} $</strong></td>
                  <td></td>
                  <td><strong>\${formatMoney(r.taxAmount)} $</strong></td>
                  <td><strong>\${formatMoney(r.totalToDate)} $</strong></td>
                  <td>
                    <button type="button" class="btn icon pc-delete" title="Supprimer">🗑</button>
                  </td>
                </tr>\`;
                }
                return \`
                <tr data-index="\${i}">`;

if (content.includes(oldPattern)) {
  content = content.replace(oldPattern, newPattern);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✓ Remplacement effectué avec succès');
} else {
  console.log('✗ Pattern non trouvé');
}
