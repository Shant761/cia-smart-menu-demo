const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Conservative batch 09. Only exact Poster source names are eligible.
// Values are reference-grade USDA matches; ambiguous preparation/brand/state stays for review.
const verified = {
  sesame: {
    names: ['кунжут', 'семена кунжута'],
    kcalPer100g: 573,
    proteinPer100g: 17.73,
    fatPer100g: 49.67,
    carbsPer100g: 23.45,
    source: 'USDA FoodData Central',
    sourceReference: 'SR Legacy; seeds, sesame seeds, whole, dried'
  }
};

function norm(v) {
  return String(v || '').toLowerCase().normalize('NFKC').replace(/ё/g, 'е').trim().replace(/\s+/g, ' ');
}

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const entryName = norm(entry.name);
  const match = Object.values(verified).find(v => v.names.map(norm).includes(entryName));
  if (!match) continue;

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(norm).filter(Boolean) : [];
  const allowed = new Set(match.names.map(norm));
  if (aliases.some(alias => !allowed.has(alias))) {
    console.warn(`[CIA Nutrition] generic batch 09 guard: ${entry.id} has ambiguous aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { names, ...nutrition } = match;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean generic batch 09 verified: ${changed}; guarded/skipped: ${skipped}`);
