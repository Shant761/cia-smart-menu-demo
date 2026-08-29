const fs = require('fs');
const path = require('path');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const RESTAURANT_ID = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const POSTER_TOKEN = (process.env.POSTER_ACCESS_TOKEN || '').trim();
if (!POSTER_TOKEN) throw new Error('POSTER_ACCESS_TOKEN is required');

const snapshotPath = path.join(__dirname, '..', 'data', 'public-menus', `${RESTAURANT_ID}.json`);
const nutritionPath = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');
const outPath = path.join(__dirname, '..', 'data', `${RESTAURANT_ID}-meat-audit.json`);

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const nutrition = JSON.parse(fs.readFileSync(nutritionPath, 'utf8'));
const nutritionById = new Map((nutrition.entries || []).map((entry) => [String(entry.id), entry]));

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', POSTER_TOKEN);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu/1.0 meat-audit' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Poster ${method}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`Poster ${method}: ${payload.error.message || payload.error.error_message || JSON.stringify(payload.error)}`);
  return payload?.response;
}

function keyForRow(row) {
  const id = String(row?.ingredient_id ?? '').trim();
  const type = Number(row?.structure_type ?? 1);
  return type === 2 ? `poster_prep_${id}` : `poster_${id}`;
}

function gramsForRow(row) {
  const unit = String(row?.structure_unit || row?.ingredient_unit || '').toLowerCase().trim();
  if (unit !== 'g' && unit !== 'гр' && unit !== 'gram') return null;
  const value = Number(row?.structure_netto ?? row?.structure_brutto);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isMeatName(name) {
  return /(свинин|говя|теля|кур|цыплен|баран|ягн|мяс|фарш|печен|серд|бекон|прошу|ветчин|индей|утк|pork|beef|chicken|lamb|veal|turkey|duck)/i.test(String(name || ''));
}

function compactNutrition(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    name: entry.name,
    status: entry.status,
    verified: Boolean(entry.verified),
    kcalPer100g: Number.isFinite(Number(entry.kcalPer100g)) ? Number(entry.kcalPer100g) : null,
    proteinPer100g: Number.isFinite(Number(entry.proteinPer100g)) ? Number(entry.proteinPer100g) : null,
    fatPer100g: Number.isFinite(Number(entry.fatPer100g)) ? Number(entry.fatPer100g) : null,
    carbsPer100g: Number.isFinite(Number(entry.carbsPer100g)) ? Number(entry.carbsPer100g) : null,
    source: entry.source || null,
    sourceReference: entry.sourceReference || null
  };
}

async function main() {
  const meatProducts = (snapshot.products || []).filter((product) => String(product.category) === '10');
  const report = {
    version: '1.0.0',
    restaurantId: RESTAURANT_ID,
    generatedAt: new Date().toISOString(),
    categoryId: '10',
    categoryName: (snapshot.categories || []).find((category) => String(category.id) === '10')?.name || null,
    productCount: meatProducts.length,
    products: [],
    summary: {}
  };

  for (const product of meatProducts) {
    const detail = await posterRequest('menu.getProduct', { product_id: product.posterProductId ?? product.id });
    const rows = Array.isArray(detail?.ingredients) ? detail.ingredients : [];
    let knownKcal = 0;
    let knownProtein = 0;
    let knownFat = 0;
    let knownCarbs = 0;
    let knownGrams = 0;
    let recipeGrams = 0;
    let meatOnlyKcal = 0;
    const ingredients = [];
    const missingMeat = [];

    for (const row of rows) {
      const key = keyForRow(row);
      const entry = nutritionById.get(key);
      const grams = gramsForRow(row);
      if (grams !== null) recipeGrams += grams;
      const kcal100 = Number(entry?.kcalPer100g);
      const verified = entry?.status === 'verified' && Number.isFinite(kcal100);
      const rowKcal = verified && grams !== null ? grams * kcal100 / 100 : null;
      if (rowKcal !== null) {
        knownKcal += rowKcal;
        knownGrams += grams;
        knownProtein += grams * Number(entry?.proteinPer100g || 0) / 100;
        knownFat += grams * Number(entry?.fatPer100g || 0) / 100;
        knownCarbs += grams * Number(entry?.carbsPer100g || 0) / 100;
        if (isMeatName(row?.ingredient_name)) meatOnlyKcal += rowKcal;
      }
      if (isMeatName(row?.ingredient_name) && !verified) {
        missingMeat.push({
          key,
          ingredientId: String(row?.ingredient_id ?? ''),
          structureType: Number(row?.structure_type ?? 1),
          name: String(row?.ingredient_name || ''),
          grams,
          reason: entry ? `nutrition_${entry.status || 'unknown'}` : 'nutrition_missing'
        });
      }
      ingredients.push({
        key,
        ingredientId: String(row?.ingredient_id ?? ''),
        structureType: Number(row?.structure_type ?? 1),
        name: String(row?.ingredient_name || ''),
        unit: row?.structure_unit || row?.ingredient_unit || null,
        brutto: Number(row?.structure_brutto ?? 0),
        netto: Number(row?.structure_netto ?? 0),
        grams,
        nutrition: compactNutrition(entry),
        calculatedKcal: rowKcal === null ? null : Math.round(rowKcal * 10) / 10
      });
    }

    const oldCalories = Number(product?.nutrition?.calories);
    const oldStatus = product?.nutrition?.status || null;
    const impossibleOldTotal = Number.isFinite(oldCalories) && meatOnlyKcal > 0 && oldCalories + 1 < meatOnlyKcal;
    report.products.push({
      productId: String(product.posterProductId ?? product.id),
      name: product.name,
      oldNutrition: product.nutrition || null,
      posterRecipeGrams: Math.round(recipeGrams * 10) / 10,
      knownGrams: Math.round(knownGrams * 10) / 10,
      coverage: recipeGrams > 0 ? Math.round((knownGrams / recipeGrams) * 1000) / 1000 : 0,
      recalculatedKnown: {
        calories: Math.round(knownKcal),
        protein: Math.round(knownProtein * 10) / 10,
        fat: Math.round(knownFat * 10) / 10,
        carbohydrates: Math.round(knownCarbs * 10) / 10
      },
      meatOnlyCalories: Math.round(meatOnlyKcal),
      impossibleOldTotal,
      oldStatus,
      oldCalories: Number.isFinite(oldCalories) ? oldCalories : null,
      missingMeat,
      ingredients
    });
  }

  const uniqueMissing = new Map();
  for (const product of report.products) {
    for (const item of product.missingMeat) {
      if (!uniqueMissing.has(item.key)) uniqueMissing.set(item.key, { ...item, usedInProducts: [] });
      uniqueMissing.get(item.key).usedInProducts.push({ productId: product.productId, name: product.name?.ru || product.name?.hy || '' });
    }
  }
  report.summary = {
    productsAudited: report.products.length,
    impossibleOldTotals: report.products.filter((item) => item.impossibleOldTotal).length,
    productsWithMissingMeat: report.products.filter((item) => item.missingMeat.length).length,
    uniqueMissingMeatIngredients: [...uniqueMissing.values()]
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`[Meat audit] products=${report.summary.productsAudited}`);
  console.log(`[Meat audit] impossible old totals=${report.summary.impossibleOldTotals}`);
  console.log(`[Meat audit] products with missing meat=${report.summary.productsWithMissingMeat}`);
  console.log(`[Meat audit] unique missing meat ingredients=${report.summary.uniqueMissingMeatIngredients.length}`);
  for (const product of report.products.filter((item) => item.impossibleOldTotal || item.missingMeat.length)) {
    console.log(`[Meat audit] ${product.productId} ${product.name?.ru || product.name?.hy || ''}: old=${product.oldCalories}, known=${product.recalculatedKnown.calories}, meatOnly=${product.meatOnlyCalories}, missingMeat=${product.missingMeat.map((item) => item.name).join(', ') || '-'}`);
  }
}

main().catch((error) => {
  console.error(`[Meat audit] FAILED: ${error.stack || error.message}`);
  process.exit(1);
});
