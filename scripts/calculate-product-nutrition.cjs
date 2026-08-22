const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

const PROJECT_ID = 'cia-smart-menu';
function requiredEnv(name) { const v = process.env[name]?.trim(); if (!v) throw new Error(`${name} is required`); return v; }
function n(v) { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : null; }
function hash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function grams(ingredient) {
  const value = n(ingredient?.netto);
  if (value === null || value < 0) return null;
  const unit = String(ingredient?.unit || '').trim().toLowerCase();
  if (unit === 'g' || unit === 'гр' || unit === 'г') return value;
  if (unit === 'kg' || unit === 'кг') return value * 1000;
  return null;
}
function macro(nutrition, key) {
  const value = nutrition?.per100g?.[key];
  return value == null ? null : n(value);
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const force = String(process.env.NUTRITION_FORCE || 'false').toLowerCase() === 'true';
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function main() {
  const restaurant = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurant.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found`);
  const [products, catalog] = await Promise.all([restaurant.collection('products').get(), restaurant.collection('ingredients_catalog').get()]);
  const byId = new Map(catalog.docs.map((d) => [d.id, d.data()]));
  let calculated = 0, review = 0, noRecipe = 0;

  for (const doc of products.docs) {
    const product = doc.data();
    if (product?.source !== 'poster' || product?.active === false) continue;
    const recipe = Array.isArray(product.posterRecipeIngredients) ? product.posterRecipeIngredients : [];
    if (!recipe.length) { noRecipe++; continue; }

    let totalG = 0;
    const totals = { calories: 0, protein: 0, fat: 0, carbohydrates: 0 };
    const ingredientResults = [];
    let blocked = false;

    for (const ingredient of recipe) {
      const id = ingredient?.ingredientId != null && String(ingredient.ingredientId).trim() ? `poster_${String(ingredient.ingredientId).trim()}` : null;
      const cat = id ? byId.get(id) : [...byId.values()].find((x) => (x.sourceNames || []).includes(ingredient?.name));
      const g = grams(ingredient);
      const nut = cat?.nutrition;
      const values = {
        calories: n(nut?.per100g?.calories),
        protein: macro(nut, 'protein'),
        fat: macro(nut, 'fat'),
        carbohydrates: macro(nut, 'carbohydrates')
      };
      const missingNutrients = Object.entries(values).filter(([, value]) => value === null).map(([key]) => key);
      const ok = g !== null && nut?.status === 'matched' && missingNutrients.length === 0;
      ingredientResults.push({
        ingredientId: ingredient?.ingredientId ?? null,
        name: ingredient?.name || '',
        grams: g,
        canonicalId: cat?.canonicalId || null,
        status: ok ? 'matched' : 'needs_review',
        missingNutrients
      });
      if (!ok) { blocked = true; continue; }
      const factor = g / 100;
      totalG += g;
      totals.calories += values.calories * factor;
      totals.protein += values.protein * factor;
      totals.fat += values.fat * factor;
      totals.carbohydrates += values.carbohydrates * factor;
    }

    const recipeHash = hash(JSON.stringify(recipe.map((x) => ({ ingredientId: x.ingredientId ?? null, name: x.name || '', unit: x.unit || '', netto: x.netto ?? null }))));
    if (!force && product.nutrition?.recipeHash === recipeHash && product.nutrition?.status === 'calculated') continue;

    const status = blocked || totalG <= 0 ? 'needs_review' : 'calculated';
    if (status === 'calculated') calculated++; else review++;

    const rounded = {
      calories: Math.round(totals.calories),
      protein: Number(totals.protein.toFixed(1)),
      fat: Number(totals.fat.toFixed(1)),
      carbohydrates: Number(totals.carbohydrates.toFixed(1))
    };

    const data = {
      nutrition: {
        status,
        source: 'validated ingredient nutrition + Poster recipe',
        recipeHash,
        calories: status === 'calculated' ? rounded.calories : null,
        protein: status === 'calculated' ? rounded.protein : null,
        fat: status === 'calculated' ? rounded.fat : null,
        carbohydrates: status === 'calculated' ? rounded.carbohydrates : null,
        per100g: status === 'calculated' ? {
          calories: Math.round((totals.calories / totalG) * 100),
          protein: Number(((totals.protein / totalG) * 100).toFixed(1)),
          fat: Number(((totals.fat / totalG) * 100).toFixed(1)),
          carbohydrates: Number(((totals.carbohydrates / totalG) * 100).toFixed(1))
        } : null,
        servingGrams: status === 'calculated' ? Number(totalG.toFixed(2)) : null,
        ingredientResults,
        calculatedAt: FieldValue.serverTimestamp()
      },
      updatedAt: FieldValue.serverTimestamp()
    };
    await doc.ref.set(data, { merge: true });
  }

  await restaurant.set({ nutritionCalculation: { lastRunAt: FieldValue.serverTimestamp(), metric: 'kcal_and_macros', calculated, needsReview: review, noRecipe, version: 3 }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`[Product nutrition] Restaurant: ${restaurantId}`);
  console.log(`[Product nutrition] kcal + macros calculated=${calculated}, needsReview=${review}, noRecipe=${noRecipe}`);
}
main().catch((e) => { console.error(`[Product nutrition] FAILED: ${e.message}`); process.exit(1); });
