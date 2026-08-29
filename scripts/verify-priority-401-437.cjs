const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Verified generic ingredients from priority 401-437.
// Values are per 100g and intentionally use close USDA FoodData Central matches.
const verified = {
  poster_85: {
    kcalPer100g: 29,
    proteinPer100g: 0.91,
    fatPer100g: 0.37,
    carbsPer100g: 6.5,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; peppers, jalapeno, raw'
  },
  poster_643: {
    kcalPer100g: 63,
    proteinPer100g: 1.06,
    fatPer100g: 0.2,
    carbsPer100g: 16.01,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; cherries, sweet, raw'
  },
  poster_527: {
    kcalPer100g: 331,
    proteinPer100g: 16.55,
    fatPer100g: 0.73,
    carbsPer100g: 72.73,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; spices, garlic powder'
  },
  poster_277: {
    kcalPer100g: 23,
    proteinPer100g: 2.86,
    fatPer100g: 0.39,
    carbsPer100g: 3.63,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; spinach, raw'
  },
  poster_385: {
    kcalPer100g: 52,
    proteinPer100g: 0.26,
    fatPer100g: 0.17,
    carbsPer100g: 13.81,
    source: 'USDA FoodData Central',
    sourceReference: 'USDA FoodData Central; apples, raw, with skin'
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
console.log(`[CIA Nutrition] priority 401-437 verified entries updated: ${changed}`);
