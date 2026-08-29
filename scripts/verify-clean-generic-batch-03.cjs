const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Conservative verified generic ingredients. Values are per 100g.
const verified = {
  poster_577: {
    kcalPer100g: 50,
    proteinPer100g: 0.54,
    fatPer100g: 0.12,
    carbsPer100g: 13.12,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169124; pineapple, raw, all varieties'
  },
  poster_604: {
    kcalPer100g: 23,
    proteinPer100g: 2.97,
    fatPer100g: 0.26,
    carbsPer100g: 3.75,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 168463; spinach, cooked, boiled, drained, without salt; close match for blanched spinach'
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
console.log(`[CIA Nutrition] clean generic batch 03 verified entries updated: ${changed}`);
