const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Conservative verified generic ingredients. Values are per 100g.
// Only close, unambiguous USDA FoodData Central matches are accepted here.
const verified = {
  poster_787: {
    kcalPer100g: 57,
    proteinPer100g: 0.28,
    fatPer100g: 0.15,
    carbsPer100g: 13.6,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 168202; apples, raw, Golden Delicious, with skin'
  },
  poster_72: {
    kcalPer100g: 48,
    proteinPer100g: 1.6,
    fatPer100g: 0.2,
    carbsPer100g: 11,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 2710087; okra, pickled'
  },
  poster_471: {
    kcalPer100g: 381,
    proteinPer100g: 0.26,
    fatPer100g: 0.05,
    carbsPer100g: 91.27,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169698; cornstarch'
  }
};

let changed = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;
  Object.assign(entry, value, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean generic batch 04 verified entries updated: ${changed}`);
