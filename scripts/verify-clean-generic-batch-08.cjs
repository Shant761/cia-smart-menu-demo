const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Conservative batch: only apply when the Poster source name itself clearly
// identifies the food/preparation state. Ambiguous names remain for review.
const verified = {
  // USDA FoodData Central SR Legacy FDC 173757.
  // Chickpeas, mature seeds, cooked, boiled, without salt.
  chickpeas_cooked: {
    names: ['нут отварной', 'нут вареный', 'нут варёный'],
    kcalPer100g: 164,
    proteinPer100g: 8.86,
    fatPer100g: 2.59,
    carbsPer100g: 27.42,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 173757; chickpeas, mature seeds, cooked, boiled, without salt'
  },
  // USDA FoodData Central SR Legacy FDC 172421.
  // Lentils, mature seeds, cooked, boiled, without salt.
  lentils_cooked: {
    names: ['чечевица отварная', 'чечевица вареная', 'чечевица варёная'],
    kcalPer100g: 116,
    proteinPer100g: 9.02,
    fatPer100g: 0.38,
    carbsPer100g: 20.13,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 172421; lentils, mature seeds, cooked, boiled, without salt'
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

  // Do not pass entries whose Poster ID has unrelated aliases/source collisions.
  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(norm).filter(Boolean) : [];
  const allowed = new Set(match.names.map(norm));
  if (aliases.some(alias => !allowed.has(alias))) {
    console.warn(`[CIA Nutrition] generic batch 08 guard: ${entry.id} has ambiguous aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { names, ...nutrition } = match;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean generic batch 08 verified: ${changed}; guarded/skipped: ${skipped}`);
