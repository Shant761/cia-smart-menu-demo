const fs = require('node:fs');
const path = require('node:path');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const RESTAURANT_ID = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const POSTER_TOKEN = (process.env.POSTER_ACCESS_TOKEN || '').trim();
if (!POSTER_TOKEN) throw new Error('POSTER_ACCESS_TOKEN is required');

const root = path.join(__dirname, '..');
const snapshotPath = path.join(root, 'data', 'public-menus', `${RESTAURANT_ID}.json`);
const manualPath = path.join(root, 'data', 'cia-nutrition-manual-top20.json');
const queuePath = path.join(root, 'data', 'cia-nutrition-research-queue.json');
const prepackNutritionPath = path.join(root, 'data', `${RESTAURANT_ID}-prepack-nutrition.json`);
const summaryPath = path.join(root, 'data', `${RESTAURANT_ID}-dish-nutrition-summary.json`);

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const prepackNutrition = JSON.parse(fs.readFileSync(prepackNutritionPath, 'utf8'));
const manualById = new Map((manual.entries || []).map((entry) => [String(entry.id), entry]));
const safeVerifiedIds = new Set((queue.entries || []).filter((entry) => entry.kind === 'verified' && entry.verified === true).map((entry) => String(entry.id)));
const prepackById = new Map(
  (prepackNutrition.results || [])
    .filter((entry) => entry.status === 'calculated' && entry.per100g && Number(entry.per100g.calories) <= 1000)
    .map((entry) => [String(entry.productId), entry])
);
const ANIMAL_RE = /(говя|теля|свинин|свин|курин|куриц|цыплен|баран|ягн|мяс|печен|сердеч|бекон|индей|утк|pork|beef|chicken|lamb|veal|turkey|duck|meat)/i;

function n(v) { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : null; }
function round1(v) { return Math.round(v * 10) / 10; }
function normalize(v) { return String(v || '').trim().toLowerCase(); }
function density(name) {
  const value = normalize(name);
  if (/масло|oil/.test(value)) return 0.92;
  if (/молоко|milk/.test(value)) return 1.03;
  if (/сливк|cream/.test(value)) return 1.01;
  if (/сироп|syrup/.test(value)) return 1.32;
  return 1;
}

// In Poster dish tech cards structure_netto is already the net weight for piece rows.
// Example from the live account: 2 eggs => brutto=2, netto=120. Multiplying netto by
// ingredient_weight produced 720,000 g. Use the positive netto directly.
function rowGrams(row) {
  const netto = n(row?.structure_netto);
  const brutto = n(row?.structure_brutto);
  const unit = normalize(row?.structure_unit);
  if (unit === 'p' || ['pc', 'pcs', 'шт'].includes(unit)) return netto != null && netto > 0 ? netto : null;
  const value = netto ?? brutto;
  if (value == null || value < 0) return null;
  if (!unit || ['g', 'гр', 'г', 'gram', 'grams'].includes(unit)) return value;
  if (['ml', 'мл'].includes(unit)) return value * density(row?.ingredient_name);
  if (['l', 'л'].includes(unit)) return value * 1000 * density(row?.ingredient_name);
  return null;
}
function nutrientValues(entry, name = '') {
  const values = { calories: n(entry?.kcalPer100g), protein: n(entry?.proteinPer100g), fat: n(entry?.fatPer100g), carbohydrates: n(entry?.carbsPer100g) };
  if (!Object.values(values).every((v) => v != null)) return null;
  if (values.calories > 1000) return null;
  if (ANIMAL_RE.test(String(name)) && values.calories <= 0) return null;
  return values;
}
function verifiedIngredient(id) {
  const key = `poster_${id}`;
  const entry = manualById.get(key);
  return entry && safeVerifiedIds.has(key) && entry.status === 'verified' && entry.verified === true ? entry : null;
}
function per100(total, grams) {
  if (!(grams > 0)) return null;
  return { calories: Math.round(total.calories / grams * 100), protein: round1(total.protein / grams * 100), fat: round1(total.fat / grams * 100), carbohydrates: round1(total.carbohydrates / grams * 100) };
}
async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`); url.searchParams.set('token', POSTER_TOKEN); url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Dish-Recalc/1.3' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Poster ${method}: HTTP ${response.status}`);
  const payload = await response.json(); if (payload?.error) throw new Error(`Poster ${method}: ${payload.error.message || payload.error.error_message || JSON.stringify(payload.error)}`); return payload?.response;
}
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length); let next = 0;
  async function worker() { while (true) { const index = next++; if (index >= items.length) return; results[index] = await fn(items[index], index); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)); return results;
}
function calculateRows(rows) {
  const totals = { calories: 0, protein: 0, fat: 0, carbohydrates: 0 };
  let totalGrams = 0; let knownGrams = 0; let resolvedRows = 0; let prepackRows = 0; let resolvedPrepackRows = 0;
  const unresolved = []; const resolved = [];
  for (const row of rows) {
    const grams = rowGrams(row); if (grams != null) totalGrams += grams;
    const isPrepack = Number(row?.structure_type ?? 1) === 2; if (isPrepack) prepackRows += 1;
    if (grams == null) { unresolved.push({ id: String(row?.ingredient_id ?? ''), type: isPrepack ? 'prepack' : 'ingredient', name: String(row?.ingredient_name || '').trim(), structureUnit: String(row?.structure_unit || ''), ingredientUnit: String(row?.ingredient_unit || ''), rawNetto: n(row?.structure_netto), rawBrutto: n(row?.structure_brutto), reason: 'unknown_weight_or_unit' }); continue; }
    let values = null; let sourceName = '';
    if (isPrepack) {
      const prep = prepackById.get(String(row?.ingredient_id ?? ''));
      sourceName = prep?.name || '';
      if (prep?.per100g) {
        values = { calories: n(prep.per100g.calories), protein: n(prep.per100g.protein), fat: n(prep.per100g.fat), carbohydrates: n(prep.per100g.carbohydrates) };
        if (!Object.values(values).every((v) => v != null) || values.calories > 1000 || (ANIMAL_RE.test(String(row?.ingredient_name || prep.name || '')) && values.calories <= 0)) values = null;
      }
    } else {
      const source = verifiedIngredient(String(row?.ingredient_id ?? ''));
      sourceName = source?.name || '';
      values = nutrientValues(source, row?.ingredient_name);
    }
    if (!values) { unresolved.push({ id: String(row?.ingredient_id ?? ''), type: isPrepack ? 'prepack' : 'ingredient', name: String(row?.ingredient_name || '').trim(), grams: round1(grams), structureUnit: String(row?.structure_unit || ''), ingredientUnit: String(row?.ingredient_unit || ''), rawNetto: n(row?.structure_netto), rawBrutto: n(row?.structure_brutto), reason: isPrepack ? 'prepack_nutrition_unresolved' : 'verified_nutrition_missing' }); continue; }
    const factor = grams / 100;
    const rowCalories = values.calories * factor;
    totals.calories += rowCalories; totals.protein += values.protein * factor; totals.fat += values.fat * factor; totals.carbohydrates += values.carbohydrates * factor;
    knownGrams += grams; resolvedRows += 1; if (isPrepack) resolvedPrepackRows += 1;
    resolved.push({ id: String(row?.ingredient_id ?? ''), type: isPrepack ? 'prepack' : 'ingredient', name: String(row?.ingredient_name || sourceName || '').trim(), grams: round1(grams), kcalPer100g: round1(values.calories), calories: Math.round(rowCalories), structureUnit: String(row?.structure_unit || ''), ingredientUnit: String(row?.ingredient_unit || ''), rawNetto: n(row?.structure_netto), rawBrutto: n(row?.structure_brutto) });
  }
  const fullyResolved = rows.length > 0 && unresolved.length === 0 && resolvedRows === rows.length && knownGrams > 0;
  return { totals, totalGrams, knownGrams, resolvedRows, prepackRows, resolvedPrepackRows, unresolved, resolved, fullyResolved };
}
function makeNutrition(result) {
  const source = 'CIA verified ingredients + Poster menu.getPrepacks + live Poster dish recipe';
  if (result.fullyResolved) return { status: 'calculated', calories: Math.round(result.totals.calories), protein: round1(result.totals.protein), fat: round1(result.totals.fat), carbohydrates: round1(result.totals.carbohydrates), servingGrams: round1(result.totalGrams), per100g: per100(result.totals, result.totalGrams), partial: null, source };
  if (!(result.knownGrams > 0)) return { status: 'needs_review', calories: null, protein: null, fat: null, carbohydrates: null, servingGrams: null, per100g: null, partial: null, source };
  const gramCoverage = result.totalGrams > 0 ? result.knownGrams / result.totalGrams : 0; const rowCoverage = result.rowsLength > 0 ? result.resolvedRows / result.rowsLength : 0; const coverage = Math.max(0, Math.min(0.999, Math.min(gramCoverage || rowCoverage, rowCoverage)));
  return { status: 'needs_review', calories: null, protein: null, fat: null, carbohydrates: null, servingGrams: null, per100g: null, partial: { calories: Math.round(result.totals.calories), protein: round1(result.totals.protein), fat: round1(result.totals.fat), carbohydrates: round1(result.totals.carbohydrates), knownGrams: round1(result.knownGrams), recipeGrams: round1(result.totalGrams), matchedIngredients: result.resolvedRows, reviewIngredients: result.unresolved.length, totalIngredients: result.rowsLength, coverage: round1(coverage * 1000) / 1000, per100g: per100(result.totals, result.knownGrams) }, source };
}
async function main() {
  const products = Array.isArray(snapshot.products) ? snapshot.products : []; const productById = new Map(products.map((product) => [String(product.posterProductId ?? product.id), product])); const ids = [...productById.keys()].filter(Boolean);
  const details = await mapLimit(ids, 6, async (productId) => { try { return { productId, detail: await posterRequest('menu.getProduct', { product_id: productId }) }; } catch (error) { return { productId, error: error.message }; } });
  const summary = { version: '1.3.0', restaurantId: RESTAURANT_ID, generatedAt: new Date().toISOString(), publicProductCount: products.length, fetchedProductCount: 0, fetchErrorCount: 0, productsWithRecipe: 0, productsWithPrepackRows: 0, resolvedPrepackRows: 0, unresolvedPrepackRows: 0, fullyCalculatedCount: 0, partialCount: 0, reviewWithoutKnownCount: 0, suspiciousProductCount: 0, products: [] };
  for (const item of details) {
    if (item.error) { summary.fetchErrorCount += 1; summary.products.push({ productId: item.productId, status: 'fetch_error', error: item.error }); continue; }
    summary.fetchedProductCount += 1; const rows = Array.isArray(item.detail?.ingredients) ? item.detail.ingredients : []; if (!rows.length) continue; summary.productsWithRecipe += 1;
    const result = calculateRows(rows); result.rowsLength = rows.length; if (result.prepackRows > 0) summary.productsWithPrepackRows += 1; summary.resolvedPrepackRows += result.resolvedPrepackRows; summary.unresolvedPrepackRows += result.prepackRows - result.resolvedPrepackRows;
    const nutrition = makeNutrition(result); if (nutrition.status === 'calculated') summary.fullyCalculatedCount += 1; else if (nutrition.partial) summary.partialCount += 1; else summary.reviewWithoutKnownCount += 1;
    const target = productById.get(item.productId); if (target) target.nutrition = nutrition;
    const displayedCalories = nutrition.status === 'calculated' ? nutrition.calories : nutrition.partial?.calories ?? null;
    const suspicious = Number.isFinite(displayedCalories) && displayedCalories > 10000;
    if (suspicious) summary.suspiciousProductCount += 1;
    const resolvedTop = result.resolved.slice().sort((a, b) => b.calories - a.calories).slice(0, suspicious ? 12 : 3);
    summary.products.push({ productId: item.productId, name: target?.name || { ru: item.detail?.product_name || '' }, status: nutrition.status, displayedCalories, displayedAsMinimum: nutrition.status !== 'calculated' && Boolean(nutrition.partial), recipeRows: rows.length, resolvedRows: result.resolvedRows, prepackRows: result.prepackRows, resolvedPrepackRows: result.resolvedPrepackRows, suspicious, topResolvedContributions: resolvedTop, unresolved: result.unresolved });
    if (suspicious) {
      console.log(`[Dish anomaly] ${item.productId} ${target?.name?.ru || item.detail?.product_name || ''}: ${displayedCalories} kcal`);
      for (const row of resolvedTop.slice(0, 5)) console.log(`[Dish anomaly]   ${row.type} ${row.id} ${row.name}: grams=${row.grams}; kcal100=${row.kcalPer100g}; kcal=${row.calories}; structureUnit=${row.structureUnit}; ingredientUnit=${row.ingredientUnit}`);
    }
  }
  snapshot.exportedAt = new Date().toISOString(); snapshot.source = 'firestore_public_menu_snapshot + local_live_poster_nutrition_with_prepacks'; fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n'); fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`[Dish nutrition] public=${summary.publicProductCount}; fetched=${summary.fetchedProductCount}; fetchErrors=${summary.fetchErrorCount}`); console.log(`[Dish nutrition] recipes=${summary.productsWithRecipe}; withPrepackRows=${summary.productsWithPrepackRows}`); console.log(`[Dish nutrition] prepackRows resolved=${summary.resolvedPrepackRows}; unresolved=${summary.unresolvedPrepackRows}`); console.log(`[Dish nutrition] calculated=${summary.fullyCalculatedCount}; partial=${summary.partialCount}; review=${summary.reviewWithoutKnownCount}; suspicious=${summary.suspiciousProductCount}`);
}
main().catch((error) => { console.error(`[Dish nutrition] FAILED: ${error.stack || error.message}`); process.exit(1); });