const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Clean generic foods with close USDA matches. Values are per 100g.
const verified = {
  poster_65: {
    expectedName: 'Виноградные листья',
    kcalPer100g: 93,
    proteinPer100g: 5.6,
    fatPer100g: 2.12,
    carbsPer100g: 17.31,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 168575; grape leaves, raw'
  },
  poster_512: {
    expectedName: 'картофель очищенный',
    kcalPer100g: 69,
    proteinPer100g: 1.68,
    fatPer100g: 0.1,
    carbsPer100g: 15.71,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 170028; potatoes, white, flesh and skin, raw; close generic base for peeled raw potato (skin removal has minor macro impact)'
  },
  poster_160: {
    expectedName: 'Моцарелла',
    kcalPer100g: 298,
    proteinPer100g: 23.7,
    fatPer100g: 20.4,
    carbsPer100g: 4.4,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 329370; cheese, mozzarella, low moisture, part-skim; generic restaurant mozzarella base'
  }
};

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;

  if (String(entry.name) !== value.expectedName) {
    console.warn(`[CIA Nutrition] generic batch 05 guard: ${entry.id} name changed from expected ${JSON.stringify(value.expectedName)} to ${JSON.stringify(entry.name)}; left for review`);
    skipped += 1;
    continue;
  }

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias !== value.expectedName)) {
    console.warn(`[CIA Nutrition] generic batch 05 guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean generic batch 05 verified: ${changed}; guarded/skipped: ${skipped}`);
