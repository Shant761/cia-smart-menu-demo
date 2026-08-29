const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const verified = {
  poster_500: {
    expectedName: 'сало',
    kcalPer100g: 812,
    proteinPer100g: 2.92,
    fatPer100g: 88.7,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 167811; pork, fresh, backfat, raw; used as the generic base for salo/backfat. 812 kcal, 2.92g protein, 88.7g fat, 0g carbohydrate per 100g.'
  }
};

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;
  if (String(entry.name).toLowerCase() !== value.expectedName.toLowerCase()) {
    console.warn(`[CIA Nutrition] meat batch 04 guard: ${entry.id} name mismatch; left for review`);
    skipped += 1;
    continue;
  }
  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias.toLowerCase() !== value.expectedName.toLowerCase())) {
    console.warn(`[CIA Nutrition] meat batch 04 guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }
  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean meat batch 04 verified: ${changed}; guarded/skipped: ${skipped}`);
