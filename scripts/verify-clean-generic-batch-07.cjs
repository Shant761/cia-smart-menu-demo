const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Clean generic foods with close USDA matches. Values are per 100g.
const verified = {
  poster_183: {
    expectedName: 'Сига',
    kcalPer100g: 134,
    proteinPer100g: 19.09,
    fatPer100g: 5.86,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 173711; fish, whitefish, mixed species, raw; generic raw whitefish base'
  },
  poster_186: {
    expectedName: 'Форель /шт/',
    kcalPer100g: 148,
    proteinPer100g: 20.77,
    fatPer100g: 6.61,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 175153; fish, trout, mixed species, raw; generic raw trout base'
  },
  poster_523: {
    expectedName: 'чипсы',
    kcalPer100g: 532,
    proteinPer100g: 6.39,
    fatPer100g: 33.98,
    carbsPer100g: 53.83,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169677; snacks, potato chips, plain, salted; generic potato-chip base'
  }
};

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;

  if (String(entry.name) !== value.expectedName) {
    console.warn(`[CIA Nutrition] generic batch 07 guard: ${entry.id} name changed from expected ${JSON.stringify(value.expectedName)} to ${JSON.stringify(entry.name)}; left for review`);
    skipped += 1;
    continue;
  }

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias !== value.expectedName)) {
    console.warn(`[CIA Nutrition] generic batch 07 guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean generic batch 07 verified: ${changed}; guarded/skipped: ${skipped}`);
