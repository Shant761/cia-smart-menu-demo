const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Verified generic ingredients from priority 301-400.
// Values are per 100g and intentionally use close USDA FoodData Central matches.
const verified = {
  poster_179: {
    kcalPer100g: 264,
    proteinPer100g: 24.6,
    fatPer100g: 17.9,
    carbsPer100g: 4,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 174188; fish, caviar, black and red, granular'
  },
  poster_320: {
    kcalPer100g: 80,
    proteinPer100g: 1.82,
    fatPer100g: 0.75,
    carbsPer100g: 17.77,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169231; ginger root, raw'
  },
  poster_69: {
    kcalPer100g: 23,
    proteinPer100g: 2.36,
    fatPer100g: 0.86,
    carbsPer100g: 4.89,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 172238; capers, canned'
  },
  poster_59: {
    kcalPer100g: 120,
    proteinPer100g: 4.4,
    fatPer100g: 1.92,
    carbsPer100g: 21.3,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; quinoa, cooked'
  },
  poster_70: {
    kcalPer100g: 67,
    proteinPer100g: 2.29,
    fatPer100g: 1.22,
    carbsPer100g: 14.34,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169214; corn, sweet, yellow, canned, whole kernel, drained solids'
  },
  poster_71: {
    kcalPer100g: 60,
    proteinPer100g: 0.51,
    fatPer100g: 0.11,
    carbsPer100g: 15.56,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 167767; pineapple, canned, juice pack, drained'
  },
  poster_273: {
    kcalPer100g: 44,
    proteinPer100g: 0.94,
    fatPer100g: 0.1,
    carbsPer100g: 9.9,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 790577; onions, red, raw'
  },
  poster_470: {
    kcalPer100g: 52,
    proteinPer100g: 1.2,
    fatPer100g: 0.65,
    carbsPer100g: 11.94,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 167755; raspberries, raw'
  },
  poster_383: {
    kcalPer100g: 53,
    proteinPer100g: 0.81,
    fatPer100g: 0.31,
    carbsPer100g: 13.34,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169105; tangerines (mandarin oranges), raw'
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
console.log(`[CIA Nutrition] priority 301-400 verified entries updated: ${changed}`);
