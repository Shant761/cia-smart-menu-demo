const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Verified raw beef loin. Armenian մեջքամիս denotes the loin/back section.
// USDA Retail Beef Cuts Release 3.0: top loin steak, lean and fat, raw.
const verified = {
  poster_197: {
    expectedName: 'Говядина /մեջքամիս/',
    kcalPer100g: 191,
    proteinPer100g: 22,
    fatPer100g: 12,
    carbsPer100g: 0,
    source: 'USDA Agricultural Research Service',
    sourceReference: 'USDA Nutrient Data Set for Retail Beef Cuts Release 3.0; NDB 23387; beef loin, top loin steak, trimmed to 1/8 fat, select, lean and fat, raw; 191 kcal/100g, 22g protein, 12g fat. Armenian մեջքամիս = loin/back section.'
  }
};

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;

  if (String(entry.name) !== value.expectedName) {
    console.warn(`[CIA Nutrition] meat batch 03 guard: ${entry.id} name changed from expected ${JSON.stringify(value.expectedName)} to ${JSON.stringify(entry.name)}; left for review`);
    skipped += 1;
    continue;
  }

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias !== value.expectedName)) {
    console.warn(`[CIA Nutrition] meat batch 03 guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean meat batch 03 verified: ${changed}; guarded/skipped: ${skipped}`);
