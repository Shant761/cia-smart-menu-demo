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
  },
  poster_398: {
    kcalPer100g: 41,
    proteinPer100g: 0.93,
    fatPer100g: 0.24,
    carbsPer100g: 9.58,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA SR Legacy / FoodData Central; carrots, raw'
  },
  poster_78: {
    kcalPer100g: 40,
    proteinPer100g: 1.87,
    fatPer100g: 0.44,
    carbsPer100g: 8.81,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA SR Legacy / FoodData Central; peppers, hot chili, red, raw; close base for piri-piri peppers'
  },
  poster_79: {
    kcalPer100g: 16,
    proteinPer100g: 0.79,
    fatPer100g: 0.25,
    carbsPer100g: 3.47,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; tomatoes, red, ripe, canned, packed in tomato juice; close base for Pelati'
  },
  poster_279: {
    kcalPer100g: 16,
    proteinPer100g: 0.68,
    fatPer100g: 0.1,
    carbsPer100g: 3.4,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169276; radishes, raw'
  },
  poster_478: {
    kcalPer100g: 321,
    proteinPer100g: 7.91,
    fatPer100g: 8.7,
    carbsPer100g: 54.4,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; milk, canned, condensed, sweetened'
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
