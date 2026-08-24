const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'data', 'nutrition-database.json');
const outputPath = path.join(__dirname, '..', 'data', 'cia-nutrition-calculator.json');

if (!fs.existsSync(inputPath)) throw new Error(`Missing ${inputPath}`);
const db = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const entries = Array.isArray(db.entries) ? db.entries : [];
const byId = new Map(entries.map(e => [String(e.id), e]));
const byName = new Map(entries.map(e => [String(e.name || '').trim().toLowerCase(), e]));

function nutritionFor(entry) {
  if (!entry) return null;
  const n = entry.nutrition || entry;
  const kcal = Number(n.kcalPer100g ?? n.kcal ?? n.caloriesPer100g);
  const protein = Number(n.proteinPer100g ?? n.protein);
  const fat = Number(n.fatPer100g ?? n.fat);
  const carbs = Number(n.carbsPer100g ?? n.carbohydratesPer100g ?? n.carbs);
  if (![kcal, protein, fat, carbs].every(Number.isFinite)) return null;
  return { kcal, protein, fat, carbs };
}

function calculateIngredient(entry, grams) {
  const n = nutritionFor(entry);
  if (!n || !Number.isFinite(grams) || grams < 0) return null;
  const factor = grams / 100;
  return {
    grams,
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    fat: n.fat * factor,
    carbs: n.carbs * factor,
    source: entry.source || 'unknown',
    verified: entry.verified === true,
    status: entry.status || 'unknown'
  };
}

function calculateDish(name, ingredients) {
  const resolved = [];
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  let missing = 0;
  let estimated = 0;

  for (const item of ingredients) {
    const ref = item.ingredientId != null ? byId.get(String(item.ingredientId)) : byName.get(String(item.name || '').trim().toLowerCase());
    const result = calculateIngredient(ref, Number(item.grams));
    if (!result) {
      missing++;
      resolved.push({ ...item, status: 'missing_nutrition' });
      continue;
    }
    if (!result.verified) estimated++;
    totals.kcal += result.kcal;
    totals.protein += result.protein;
    totals.fat += result.fat;
    totals.carbs += result.carbs;
    resolved.push({ ...item, nutrition: result });
  }

  return {
    name,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v.toFixed(2))])),
    ingredients: resolved,
    missingIngredients: missing,
    nonVerifiedIngredients: estimated,
    status: missing ? 'needs_review' : (estimated ? 'estimated' : 'verified')
  };
}

// The engine is intentionally data-driven. A workflow can pass a JSON file with dishes later.
// Example: [{"name":"Caesar","ingredients":[{"ingredientId":"123","grams":120}]}]
const dishesPath = process.env.CIA_DISHES_FILE || path.join(__dirname, '..', 'data', 'nutrition-dishes.json');
let dishes = [];
if (fs.existsSync(dishesPath)) dishes = JSON.parse(fs.readFileSync(dishesPath, 'utf8'));

const result = {
  version: '1.0.0',
  sourceDatabase: 'CIA Nutrition Database',
  calculationBasis: 'nutrition values per 100g multiplied by recipe grams / 100',
  dishes: dishes.map(d => calculateDish(d.name || 'Unnamed dish', d.ingredients || []))
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(`[CIA Nutrition Calculator] database entries: ${entries.length}`);
console.log(`[CIA Nutrition Calculator] dishes calculated: ${result.dishes.length}`);
console.log(`[CIA Nutrition Calculator] output: ${outputPath}`);
