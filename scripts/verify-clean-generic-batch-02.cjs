const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Conservative verified generic ingredients. Values are per 100g.
// Only close, unambiguous USDA FoodData Central matches are accepted here.
const verified = {
  poster_80: {
    kcalPer100g: 16,
    proteinPer100g: 0.79,
    fatPer100g: 0.25,
    carbsPer100g: 3.47,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 170051; tomatoes, red, ripe, canned, packed in tomato juice'
  },
  poster_51: {
    kcalPer100g: 51,
    proteinPer100g: 0.1,
    fatPer100g: 0,
    carbsPer100g: 24.1,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 172804; leavening agents, baking powder, double-acting, straight phosphate'
  },
  poster_571: {
    kcalPer100g: 0,
    proteinPer100g: 0,
    fatPer100g: 0,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 175040; leavening agents, baking soda'
  },
  poster_182: {
    kcalPer100g: 208,
    proteinPer100g: 20.42,
    fatPer100g: 13.42,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 175167; fish, salmon, Atlantic, farmed, raw'
  },
  poster_609: {
    kcalPer100g: 208,
    proteinPer100g: 20.42,
    fatPer100g: 13.42,
    carbsPer100g: 0,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 175167; fish, salmon, Atlantic, farmed, raw; cleaned fillet uses same edible-portion profile'
  },
  poster_338: {
    kcalPer100g: 141,
    proteinPer100g: 12.4,
    fatPer100g: 6.4,
    carbsPer100g: 11,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169283; soybeans, green, cooked, boiled, drained, without salt; Poster sample product identifies edamame'
  },
  poster_608: {
    kcalPer100g: 185,
    proteinPer100g: 26.41,
    fatPer100g: 7.92,
    carbsPer100g: 0.1,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171059; chicken, heart, all classes, cooked, simmered; Poster sample product identifies chicken hearts'
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
console.log(`[CIA Nutrition] clean generic batch 02 verified entries updated: ${changed}`);
