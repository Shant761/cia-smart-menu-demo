const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const verified = {
  poster_645: {
    kcalPer100g: 29,
    proteinPer100g: 1.1,
    fatPer100g: 0.3,
    carbsPer100g: 9.32,
    aliases: ['лимон/лайм', 'лимон', 'лайм'],
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 167746; lemons, raw, without peel; used as conservative lemon/lime base'
  },
  poster_395: {
    kcalPer100g: 884,
    proteinPer100g: 0,
    fatPer100g: 100,
    carbsPer100g: 0,
    aliases: ['растительное масло', 'vegetable oil'],
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 172370; vegetable oil, refined'
  },
  poster_256: {
    kcalPer100g: 9,
    proteinPer100g: 0.12,
    fatPer100g: 0.18,
    carbsPer100g: 1.67,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171891; coffee, brewed, espresso, restaurant-prepared'
  },
  poster_442: {
    kcalPer100g: 44,
    proteinPer100g: 3.29,
    fatPer100g: 0.73,
    carbsPer100g: 8.41,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 173475; spearmint, fresh'
  },
  poster_353: {
    kcalPer100g: 143,
    proteinPer100g: 12.56,
    fatPer100g: 9.51,
    carbsPer100g: 0.72,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171287; egg, whole, raw, fresh'
  },
  poster_436: {
    kcalPer100g: 29,
    proteinPer100g: 1.1,
    fatPer100g: 0.3,
    carbsPer100g: 9.32,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 167746; lemons, raw, without peel'
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
console.log(`[CIA Nutrition] verified baseline entries updated: ${changed}`);
console.log('[CIA Nutrition] baseline verified overrides applied where matching entries exist.');
