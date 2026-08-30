const fs = require('node:fs');
const path = require('node:path');

const PREPACKS_PATH = path.join(process.cwd(), 'data', 'poster-test-preparations.json');
const MANUAL_PATH = path.join(process.cwd(), 'data', 'cia-nutrition-manual-top20.json');
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'poster-test-prepack-nutrition.json');

function n(v) {
  const x = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
}

function round1(v) { return Number(v.toFixed(1)); }
function normalize(v) { return String(v || '').trim().toLowerCase(); }

function density(name) {
  const value = normalize(name);
  if (/масло|oil/.test(value)) return 0.92;
  if (/молоко|milk/.test(value)) return 1.03;
  if (/сливк|cream/.test(value)) return 1.01;
  if (/сироп|syrup/.test(value)) return 1.32;
  return 1;
}

function rowGrams(row) {
  const value = n(row?.structure_netto);
  if (value == null || value < 0) return null;
  const unit = normalize(row?.structure_unit || row?.ingredient_unit);
  if (['g', 'гр', 'г'].includes(unit)) return value;
  if (['kg', 'кг'].includes(unit)) return value * 1000;
  if (['ml', 'мл'].includes(unit)) return value * density(row?.ingredient_name);
  if (['l', 'л'].includes(unit)) return value * 1000 * density(row?.ingredient_name);
  if (['p', 'pc', 'pcs', 'шт'].includes(unit)) {
    const pieceWeight = n(row?.ingredient_weight);
    return pieceWeight && pieceWeight > 0 ? value * pieceWeight : null;
  }
  return null;
}

const prepData = JSON.parse(fs.readFileSync(PREPACKS_PATH, 'utf8'));
const manual = JSON.parse(fs.readFileSync(MANUAL_PATH, 'utf8'));
const prepacks = Array.isArray(prepData?.prepacks) ? prepData.prepacks : [];
const verified = new Map(
  (Array.isArray(manual?.entries) ? manual.entries : [])
    .filter((entry) => entry?.verified === true && entry?.status === 'verified')
    .map((entry) => [String(entry.id), entry])
);
const prepById = new Map(prepacks.map((prep) => [String(prep.productId), prep]));
const memo = new Map();

function nutrientValues(entry) {
  const values = {
    calories: n(entry?.kcalPer100g),
    protein: n(entry?.proteinPer100g),
    fat: n(entry?.fatPer100g),
    carbohydrates: n(entry?.carbsPer100g)
  };
  return Object.values(values).every((v) => v != null) ? values : null;
}

function calculatePrep(prepId, stack = []) {
  const id = String(prepId);
  if (memo.has(id)) return memo.get(id);
  if (stack.includes(id)) {
    return { status: 'needs_review', productId: id, reason: 'cycle_detected', unresolved: [{ type: 'prepack', id, reason: 'cycle_detected' }] };
  }

  const prep = prepById.get(id);
  if (!prep) {
    return { status: 'needs_review', productId: id, reason: 'prepack_not_found', unresolved: [{ type: 'prepack', id, reason: 'prepack_not_found' }] };
  }

  const totals = { calories: 0, protein: 0, fat: 0, carbohydrates: 0 };
  const resolved = [];
  const unresolved = [];
  let knownInputGrams = 0;

  for (const row of (Array.isArray(prep.ingredients) ? prep.ingredients : [])) {
    const grams = rowGrams(row);
    if (grams == null) {
      unresolved.push({ type: Number(row?.structure_type) === 2 ? 'prepack' : 'ingredient', id: String(row?.ingredient_id ?? ''), name: row?.ingredient_name || '', reason: 'unknown_weight_or_unit' });
      continue;
    }

    if (Number(row?.structure_type) === 2) {
      const nested = calculatePrep(String(row?.ingredient_id ?? ''), [...stack, id]);
      if (nested.status !== 'calculated' || !nested.per100g) {
        unresolved.push({ type: 'prepack', id: String(row?.ingredient_id ?? ''), name: row?.ingredient_name || '', grams: round1(grams), reason: nested.reason || 'nested_prepack_unresolved' });
        continue;
      }
      const factor = grams / 100;
      totals.calories += nested.per100g.calories * factor;
      totals.protein += nested.per100g.protein * factor;
      totals.fat += nested.per100g.fat * factor;
      totals.carbohydrates += nested.per100g.carbohydrates * factor;
      knownInputGrams += grams;
      resolved.push({ type: 'prepack', id: String(row?.ingredient_id ?? ''), name: row?.ingredient_name || '', grams: round1(grams), calories: Math.round(nested.per100g.calories * factor) });
      continue;
    }

    const ingredientId = String(row?.ingredient_id ?? '');
    const source = verified.get(`poster_${ingredientId}`);
    const values = nutrientValues(source);
    if (!values) {
      unresolved.push({ type: 'ingredient', id: ingredientId, name: row?.ingredient_name || '', grams: round1(grams), reason: 'verified_nutrition_missing' });
      continue;
    }

    const factor = grams / 100;
    totals.calories += values.calories * factor;
    totals.protein += values.protein * factor;
    totals.fat += values.fat * factor;
    totals.carbohydrates += values.carbohydrates * factor;
    knownInputGrams += grams;
    resolved.push({ type: 'ingredient', id: ingredientId, name: row?.ingredient_name || '', grams: round1(grams), calories: Math.round(values.calories * factor) });
  }

  const outputGrams = n(prep.out);
  const canCalculate = unresolved.length === 0 && outputGrams != null && outputGrams > 0;
  const status = canCalculate ? 'calculated' : 'needs_review';
  const per100g = outputGrams && outputGrams > 0 && knownInputGrams > 0 ? {
    calories: Math.round((totals.calories / outputGrams) * 100),
    protein: round1((totals.protein / outputGrams) * 100),
    fat: round1((totals.fat / outputGrams) * 100),
    carbohydrates: round1((totals.carbohydrates / outputGrams) * 100)
  } : null;

  const result = {
    productId: id,
    name: prep.name,
    outputGrams,
    status,
    source: 'Poster menu.getPrepacks + verified ingredient nutrition',
    per100g: canCalculate ? per100g : null,
    partialPer100g: !canCalculate ? per100g : null,
    knownInputGrams: round1(knownInputGrams),
    totalRows: Array.isArray(prep.ingredients) ? prep.ingredients.length : 0,
    resolvedRows: resolved.length,
    unresolvedRows: unresolved.length,
    resolved,
    unresolved
  };
  memo.set(id, result);
  return result;
}

const results = prepacks.map((prep) => calculatePrep(prep.productId));
const calculated = results.filter((item) => item.status === 'calculated');
const review = results.filter((item) => item.status !== 'calculated');
const targetIds = new Set((prepData?.targetPrepacks || []).map((prep) => String(prep.productId)));
const targetResults = results.filter((item) => targetIds.has(String(item.productId)));

const payload = {
  version: '1.0.0',
  restaurantId: prepData?.restaurantId || 'poster-test',
  source: 'Poster menu.getPrepacks + cia-nutrition-manual-top20 verified entries',
  generatedAt: new Date().toISOString(),
  prepackCount: results.length,
  calculatedCount: calculated.length,
  needsReviewCount: review.length,
  targetCount: targetResults.length,
  targetCalculatedCount: targetResults.filter((item) => item.status === 'calculated').length,
  targetNeedsReviewCount: targetResults.filter((item) => item.status !== 'calculated').length,
  targetResults,
  results
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`[Prepack nutrition] total=${payload.prepackCount}; calculated=${payload.calculatedCount}; review=${payload.needsReviewCount}; targets=${payload.targetCount}; targetCalculated=${payload.targetCalculatedCount}`);
