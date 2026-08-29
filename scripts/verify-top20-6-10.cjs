const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// CIA-owned verified nutrition overrides. Values are per 100g.
// Keep this list conservative: only add entries when the Poster ingredient is
// unambiguous and the nutrition reference is a close match.
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
  },

  // Priority 101-200: verified clean entries only.
  poster_368: {
    kcalPer100g: 42,
    proteinPer100g: 0.77,
    fatPer100g: 0.14,
    carbsPer100g: 10.66,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 174673; grapefruit, raw, pink and red, all areas'
  },
  poster_321: {
    kcalPer100g: 311,
    proteinPer100g: 10.76,
    fatPer100g: 6.7,
    carbsPer100g: 68.47,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 170919; spices, cardamom'
  },
  poster_283: {
    kcalPer100g: 289,
    proteinPer100g: 3.49,
    fatPer100g: 14.04,
    carbsPer100g: 37.2,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169836; restaurant, family style, french fries'
  },
  poster_272: {
    kcalPer100g: 40,
    proteinPer100g: 1.1,
    fatPer100g: 0.1,
    carbsPer100g: 9.34,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 170000; onions, raw'
  },
  poster_390: {
    kcalPer100g: 680,
    proteinPer100g: 0.96,
    fatPer100g: 74.85,
    carbsPer100g: 0.57,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171009; salad dressing, mayonnaise, regular'
  },
  poster_74: {
    kcalPer100g: 12,
    proteinPer100g: 0.5,
    fatPer100g: 0.3,
    carbsPer100g: 2.41,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 168558; pickles, cucumber, dill or kosher dill'
  },
  poster_498: {
    kcalPer100g: 579,
    proteinPer100g: 21.15,
    fatPer100g: 49.93,
    carbsPer100g: 21.55,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 170567; nuts, almonds'
  },
  poster_331: {
    kcalPer100g: 265,
    proteinPer100g: 9,
    fatPer100g: 4.28,
    carbsPer100g: 68.92,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 171328; spices, oregano, dried'
  },
  poster_162: {
    kcalPer100g: 392,
    proteinPer100g: 35.75,
    fatPer100g: 25.83,
    carbsPer100g: 3.22,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 170848; cheese, parmesan, hard'
  },
  poster_610: {
    kcalPer100g: 16,
    proteinPer100g: 0.68,
    fatPer100g: 0.1,
    carbsPer100g: 3.4,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169276; radishes, raw'
  },
  poster_253: {
    kcalPer100g: 14,
    proteinPer100g: 0.69,
    fatPer100g: 0.17,
    carbsPer100g: 2.97,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 169988; celery, raw'
  },
  poster_300: {
    kcalPer100g: 54,
    proteinPer100g: 0.15,
    fatPer100g: 0.29,
    carbsPer100g: 13.13,
    source: 'USDA FoodData Central',
    sourceReference: 'FDC 167787; pomegranate juice, bottled'
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
console.log('[CIA Nutrition] conservative verified overrides applied where matching entries exist.');
