const fs = require('fs');
const path = require('path');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const RESTAURANT_ID = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const POSTER_TOKEN = (process.env.POSTER_ACCESS_TOKEN || '').trim();
if (!POSTER_TOKEN) throw new Error('POSTER_ACCESS_TOKEN is required');

const root = path.join(__dirname, '..');
const snapshotPath = path.join(root, 'data', 'public-menus', `${RESTAURANT_ID}.json`);
const manualPath = path.join(root, 'data', 'cia-nutrition-manual-top20.json');
const queuePath = path.join(root, 'data', 'cia-nutrition-research-queue.json');
const summaryPath = path.join(root, 'data', `${RESTAURANT_ID}-meat-nutrition-summary.json`);

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const manualById = new Map((manual.entries || []).map((entry) => [String(entry.id), entry]));
const safeVerifiedIds = new Set(
  (queue.entries || [])
    .filter((entry) => entry.kind === 'verified' && entry.verified === true)
    .map((entry) => String(entry.id))
);

const MEAT_RE = /(свинин|свин|говя|теля|курин|куриц|цыплен|баран|ягн|мяс|фарш|печен|сердеч|бекон|прошу|ветчин|индей|утк|кюфт|кавурм|pork|beef|chicken|lamb|veal|turkey|duck|meat|միս|խոզ|գառ|հավ|տավար|չալաղաջ|քուֆթ)/i;

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', POSTER_TOKEN);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu/1.0 meat-recalculator' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Poster ${method}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`Poster ${method}: ${payload.error.message || payload.error.error_message || JSON.stringify(payload.error)}`);
  return payload?.response;
}

function typedKey(row) {
  const id = String(row?.ingredient_id ?? '').trim();
  return Number(row?.structure_type ?? 1) === 2 ? `poster_prep_${id}` : `poster_${id}`;
}

function amountInGrams(row) {
  const unit = String(row?.structure_unit || row?.ingredient_unit || '').trim().toLowerCase();
  if (!['g', 'гр', 'gram', 'grams'].includes(unit)) return null;
  const amount = Number(row?.structure_netto ?? row?.structure_brutto);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function candidateText(product) {
  return [
    product?.name?.ru,
    product?.name?.hy,
    product?.name?.en,
    ...(product?.ingredients?.ru || []),
    ...(product?.ingredients?.hy || []),
    ...(product?.ingredients?.en || [])
  ].filter(Boolean).join(' ');
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function per100(total, grams) {
  if (!(grams > 0)) return null;
  return {
    calories: Math.round(total.calories / grams * 100),
    protein: round1(total.protein / grams * 100),
    fat: round1(total.fat / grams * 100),
    carbohydrates: round1(total.carbohydrates / grams * 100)
  };
}

function isSafeVerified(key, entry) {
  return Boolean(
    entry &&
    safeVerifiedIds.has(key) &&
    entry.status === 'verified' &&
    Number.isFinite(Number(entry.kcalPer100g))
  );
}

function makeNutrition(result) {
  const source = 'CIA verified nutrition + live Poster recipe';
  const totals = result.knownTotals;
  if (result.fullyResolved) {
    return {
      status: 'calculated',
      calories: Math.round(totals.calories),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbohydrates: round1(totals.carbohydrates),
      servingGrams: round1(result.totalGrams),
      per100g: per100(totals, result.totalGrams),
      partial: null,
      source
    };
  }

  if (!(totals.calories >= 0) || result.resolvedRows === 0) {
    return {
      status: 'needs_review',
      calories: null,
      protein: null,
      fat: null,
      carbohydrates: null,
      servingGrams: null,
      per100g: null,
      partial: null,
      source
    };
  }

  const gramCoverage = result.totalGrams > 0 ? result.knownGrams / result.totalGrams : 0;
  const rowCoverage = result.rows.length ? result.resolvedRows / result.rows.length : 0;
  const coverage = Math.max(0, Math.min(0.999, gramCoverage > 0 ? Math.min(gramCoverage, rowCoverage) : rowCoverage));
  return {
    status: 'needs_review',
    calories: null,
    protein: null,
    fat: null,
    carbohydrates: null,
    servingGrams: null,
    per100g: null,
    partial: {
      totalIngredients: result.rows.length,
      recipeGrams: round1(result.totalGrams),
      calories: Math.round(totals.calories),
      protein: round1(totals.protein),
      fat: round1(totals.fat),
      carbohydrates: round1(totals.carbohydrates),
      matchedIngredients: result.resolvedRows,
      reviewIngredients: result.unresolved.length,
      knownGrams: round1(result.knownGrams),
      coverage: round1(coverage * 1000) / 1000,
      per100g: per100(totals, result.knownGrams)
    },
    source
  };
}

async function main() {
  const products = Array.isArray(snapshot.products) ? snapshot.products : [];
  const candidates = products.filter((product) => String(product.category) === '10' || MEAT_RE.test(candidateText(product)));
  const summary = {
    version: '2.0.0',
    restaurantId: RESTAURANT_ID,
    generatedAt: new Date().toISOString(),
    publicProductCount: products.length,
    candidateCount: candidates.length,
    correctedImpossibleCount: 0,
    fullyCalculatedCount: 0,
    partialCount: 0,
    reviewWithoutKnownCount: 0,
    products: [],
    unresolvedMeatIngredients: []
  };
  const unresolvedMeat = new Map();
  const productById = new Map(products.map((product) => [String(product.posterProductId ?? product.id), product]));

  for (const product of candidates) {
    const productId = String(product.posterProductId ?? product.id);
    const detail = await posterRequest('menu.getProduct', { product_id: productId });
    const rows = Array.isArray(detail?.ingredients) ? detail.ingredients : [];
    if (!rows.length) continue;

    const hasMeatRow = rows.some((row) => MEAT_RE.test(String(row?.ingredient_name || '')));
    if (!hasMeatRow && String(product.category) !== '10' && !MEAT_RE.test(String(product?.name?.ru || product?.name?.hy || ''))) continue;

    const knownTotals = { calories: 0, protein: 0, fat: 0, carbohydrates: 0 };
    let totalGrams = 0;
    let knownGrams = 0;
    let resolvedRows = 0;
    let meatOnlyCalories = 0;
    const unresolved = [];

    for (const row of rows) {
      const key = typedKey(row);
      const entry = manualById.get(key);
      const grams = amountInGrams(row);
      if (grams !== null) totalGrams += grams;

      if (grams !== null && isSafeVerified(key, entry)) {
        const factor = grams / 100;
        const kcal = Number(entry.kcalPer100g) * factor;
        knownTotals.calories += kcal;
        knownTotals.protein += Number(entry.proteinPer100g || 0) * factor;
        knownTotals.fat += Number(entry.fatPer100g || 0) * factor;
        knownTotals.carbohydrates += Number(entry.carbsPer100g || 0) * factor;
        knownGrams += grams;
        resolvedRows += 1;
        if (MEAT_RE.test(String(row?.ingredient_name || ''))) meatOnlyCalories += kcal;
        continue;
      }

      const item = {
        key,
        ingredientId: String(row?.ingredient_id ?? ''),
        structureType: Number(row?.structure_type ?? 1),
        name: String(row?.ingredient_name || '').trim(),
        unit: String(row?.structure_unit || row?.ingredient_unit || ''),
        amount: Number(row?.structure_netto ?? row?.structure_brutto ?? 0),
        reason: grams === null ? 'unsupported_unit' : (entry ? `nutrition_${entry.status || 'not_verified'}` : 'nutrition_missing')
      };
      unresolved.push(item);
      if (MEAT_RE.test(item.name)) {
        if (!unresolvedMeat.has(key)) unresolvedMeat.set(key, { ...item, usedIn: [] });
        unresolvedMeat.get(key).usedIn.push({ productId, name: product?.name?.ru || product?.name?.hy || '' });
      }
    }

    const fullyResolved = unresolved.length === 0 && resolvedRows === rows.length && rows.length > 0;
    const result = { rows, knownTotals, totalGrams, knownGrams, resolvedRows, unresolved, fullyResolved };
    const nextNutrition = makeNutrition(result);
    const oldCalories = Number(product?.nutrition?.calories);
    const oldStatus = product?.nutrition?.status || null;
    const impossibleOld = oldStatus === 'calculated' && Number.isFinite(oldCalories) && meatOnlyCalories > oldCalories + 1;

    if (impossibleOld) summary.correctedImpossibleCount += 1;
    if (nextNutrition.status === 'calculated') summary.fullyCalculatedCount += 1;
    else if (nextNutrition.partial) summary.partialCount += 1;
    else summary.reviewWithoutKnownCount += 1;

    const target = productById.get(productId);
    if (target) target.nutrition = nextNutrition;

    summary.products.push({
      productId,
      name: product.name,
      category: String(product.category),
      oldStatus,
      oldCalories: Number.isFinite(oldCalories) ? oldCalories : null,
      newStatus: nextNutrition.status,
      newCalories: nextNutrition.status === 'calculated' ? nextNutrition.calories : nextNutrition.partial?.calories ?? null,
      displayedAsMinimum: nextNutrition.status !== 'calculated' && Boolean(nextNutrition.partial),
      totalRecipeRows: rows.length,
      resolvedRows,
      totalGrams: round1(totalGrams),
      knownGrams: round1(knownGrams),
      meatOnlyCalories: Math.round(meatOnlyCalories),
      impossibleOld,
      unresolved: unresolved.map((item) => ({ key: item.key, structureType: item.structureType, name: item.name, unit: item.unit, amount: item.amount, reason: item.reason }))
    });
  }

  summary.unresolvedMeatIngredients = [...unresolvedMeat.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  snapshot.exportedAt = new Date().toISOString();
  snapshot.source = 'firestore_public_menu_snapshot + local_live_poster_meat_nutrition';
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

  console.log(`[Meat recalc] public products=${products.length}`);
  console.log(`[Meat recalc] candidates=${candidates.length}; processed=${summary.products.length}`);
  console.log(`[Meat recalc] full=${summary.fullyCalculatedCount}; partial=${summary.partialCount}; review=${summary.reviewWithoutKnownCount}`);
  console.log(`[Meat recalc] corrected impossible old totals=${summary.correctedImpossibleCount}`);
  console.log(`[Meat recalc] unresolved meat ingredients=${summary.unresolvedMeatIngredients.length}`);
  for (const item of summary.products.filter((row) => row.impossibleOld || /чалагач/i.test(row.name?.ru || ''))) {
    console.log(`[Meat recalc] ${item.productId} ${item.name?.ru || item.name?.hy}: ${item.oldCalories} -> ${item.displayedAsMinimum ? '≥' : ''}${item.newCalories}; meatOnly=${item.meatOnlyCalories}; unresolved=${item.unresolved.length}`);
  }
}

main().catch((error) => {
  console.error(`[Meat recalc] FAILED: ${error.stack || error.message}`);
  process.exit(1);
});
