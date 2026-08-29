const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Verified raw meat cuts. Values are per 100g edible portion.
// Armenian cut names were cross-checked against local restaurant/meat-market usage;
// nutrition values use the closest USDA raw cut.
const verified = {
  poster_202: {
    expectedName: 'Свиное каре /չալաղաջ/',
    kcalPer100g: 170,
    proteinPer100g: 20.71,
    fatPer100g: 9.03,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 168238; pork, fresh, loin, center loin (chops), bone-in, separable lean and fat, raw; Armenian խոզի չալաղաջ = pork loin/chop'
  },
  poster_206: {
    expectedName: 'Баранина /մատ/',
    kcalPer100g: 342,
    proteinPer100g: 15.32,
    fatPer100g: 30.71,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 174377; lamb, rib, separable lean and fat, trimmed to 1/8 fat, choice, raw; գառան մատ = lamb ribs'
  },
  poster_205: {
    expectedName: 'Баранина /չալաղաջ/',
    kcalPer100g: 279,
    proteinPer100g: 17.18,
    fatPer100g: 22.75,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 172551; lamb, loin, separable lean and fat, trimmed to 1/8 fat, choice, raw; գառան չալաղաջ = lamb loin/chop'
  }
};

let changed = 0;
let skipped = 0;
for (const entry of data.entries || []) {
  const value = verified[String(entry.id)];
  if (!value) continue;

  if (String(entry.name) !== value.expectedName) {
    console.warn(`[CIA Nutrition] meat batch 02 guard: ${entry.id} name changed from expected ${JSON.stringify(value.expectedName)} to ${JSON.stringify(entry.name)}; left for review`);
    skipped += 1;
    continue;
  }

  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(String) : [];
  if (aliases.length > 1 && aliases.some((alias) => alias !== value.expectedName)) {
    console.warn(`[CIA Nutrition] meat batch 02 guard: ${entry.id} has multiple source aliases; left for review`);
    skipped += 1;
    continue;
  }

  const { expectedName, ...nutrition } = value;
  Object.assign(entry, nutrition, { verified: true, status: 'verified' });
  changed += 1;
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`[CIA Nutrition] clean meat batch 02 verified: ${changed}; guarded/skipped: ${skipped}`);
