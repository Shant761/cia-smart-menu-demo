const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Verified raw meat ingredients. Values are per 100g edible portion.
// Keep prepared meats, marinades and Poster ID collisions out of this table.
const verified = {
  poster_203: {
    expectedName: 'свинина /մատ/',
    kcalPer100g: 277,
    proteinPer100g: 15.47,
    fatPer100g: 23.4,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 167853; pork, fresh, spareribs, separable lean and fat, raw; Armenian Խոզի մատ/մատեր = pork ribs'
  },
  poster_204: {
    expectedName: 'свинина /փափուկ/',
    kcalPer100g: 134,
    proteinPer100g: 21.2,
    fatPer100g: 4.86,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 168220; pork, fresh, composite of trimmed retail cuts (leg, loin, shoulder), separable lean only, raw; used as conservative generic base for Armenian խոզի փափուկ / pork flesh'
  },
  poster_515: {
    expectedName: 'говяжье суки очищенная',
    kcalPer100g: 139,
    proteinPer100g: 21.94,
    fatPer100g: 5.74,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171767; beef, loin, tenderloin steak, boneless, separable lean only, trimmed to 0 fat, all grades, raw; local суки = tenderloin/fillet, очищенная = trimmed'
  }
};

let changed = 0;
let skipped = 0;

for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;

  if (String(entry.name) !== value.expectedName) {
    console.warn(`[CIA Nutrition] meat guard: ${entry.id} name changed from expected ${JSON.stringify(value.expectedName)} to ${JSON.stringify(entry.name)}; left for review`);
    skipped += 1;
    continue;
  }

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias !== value.expectedName)) {
    console.warn(`[CIA Nutrition] meat guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean meat batch 01 verified: ${changed}; guarded/skipped: ${skipped}`);
