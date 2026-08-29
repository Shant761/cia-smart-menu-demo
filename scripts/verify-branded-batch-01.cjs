const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Brand-specific label values. Keep exact product-name guards so branded items
// are never silently replaced by a generic nutrition profile.
const verified = {
  poster_47: {
    expectedName: 'Нутелла',
    kcalPer100g: 539,
    proteinPer100g: 6.3,
    fatPer100g: 30.9,
    carbsPer100g: 57.5,
    source: 'Nutella / Ferrero official nutrition label',
    sourceReference: 'Nutella official EU/UK nutrition information; per 100g: 539 kcal, fat 30.9g, carbs 57.5g, protein 6.3g'
  },
  poster_297: {
    expectedName: 'Перриер',
    kcalPer100g: 0,
    proteinPer100g: 0,
    fatPer100g: 0,
    carbsPer100g: 0,
    source: 'PERRIER official product information',
    sourceReference: 'PERRIER Carbonated Mineral Water; zero calories and no sugar'
  },
  poster_298: {
    expectedName: 'Ред Булл',
    kcalPer100g: 46,
    proteinPer100g: 0,
    fatPer100g: 0,
    carbsPer100g: 11,
    source: 'Red Bull official nutrition label',
    sourceReference: 'Red Bull Energy Drink official nutrition; per 100ml: 46 kcal, carbs 11g, protein 0g, fat 0g'
  }
};

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;

  if (String(entry.name) !== value.expectedName) {
    console.warn(`[CIA Nutrition] branded batch 01 guard: ${entry.id} name changed from expected ${JSON.stringify(value.expectedName)} to ${JSON.stringify(entry.name)}; left for review`);
    skipped += 1;
    continue;
  }

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias !== value.expectedName)) {
    console.warn(`[CIA Nutrition] branded batch 01 guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] branded batch 01 verified: ${changed}; guarded/skipped: ${skipped}`);
