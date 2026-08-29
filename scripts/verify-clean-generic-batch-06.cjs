const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Clean generic foods with close USDA matches. Values are per 100g.
const verified = {
  poster_58: {
    expectedName: 'помидоры запеченные',
    kcalPer100g: 18,
    proteinPer100g: 0.95,
    fatPer100g: 0.11,
    carbsPer100g: 4.01,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 170050; tomatoes, red, ripe, cooked; close generic base for baked tomatoes without added oil'
  },
  poster_201: {
    expectedName: 'Свинина',
    kcalPer100g: 177,
    proteinPer100g: 20.1,
    fatPer100g: 10.1,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 168316; pork, fresh, composite of trimmed retail cuts (loin and shoulder blade), separable lean and fat, raw; generic raw pork base when cut is unspecified'
  },
  poster_301: {
    expectedName: 'тоник',
    kcalPer100g: 34,
    proteinPer100g: 0,
    fatPer100g: 0,
    carbsPer100g: 8.8,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171869; beverages, carbonated, tonic water'
  },
  poster_306: {
    expectedName: 'Цыпленок',
    kcalPer100g: 215,
    proteinPer100g: 18.6,
    fatPer100g: 15.06,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171447; chicken, broilers or fryers, meat and skin, raw; generic whole-chicken edible meat-and-skin base'
  }
};

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;

  if (String(entry.name) !== value.expectedName) {
    console.warn(`[CIA Nutrition] generic batch 06 guard: ${entry.id} name changed from expected ${JSON.stringify(value.expectedName)} to ${JSON.stringify(entry.name)}; left for review`);
    skipped += 1;
    continue;
  }

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias !== value.expectedName)) {
    console.warn(`[CIA Nutrition] generic batch 06 guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean generic batch 06 verified: ${changed}; guarded/skipped: ${skipped}`);
