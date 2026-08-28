const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

const PROJECT_ID = 'cia-smart-menu';
function requiredEnv(name) { const v = process.env[name]?.trim(); if (!v) throw new Error(`${name} is required`); return v; }
function n(v) { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : null; }
function hash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function mlDensity(ingredient) {
  const name = String(ingredient?.name || '').toLowerCase();
  if (/масло|oil/.test(name)) return 0.92;
  if (/молоко|milk/.test(name)) return 1.03;
  if (/сироп|syrup/.test(name)) return 1.32;
  return 1;
}
function grams(ingredient) {
  const value = n(ingredient?.netto);
  if (value === null || value < 0) return null;
  const unit = String(ingredient?.unit || '').trim().toLowerCase();
  if (unit === 'g' || unit === 'гр' || unit === 'г') return value;
  if (unit === 'kg' || unit === 'кг') return value * 1000;
  if (unit === 'ml' || unit === 'мл') return value * mlDensity(ingredient);
  if (unit === 'l' || unit === 'л') return value * 1000 * mlDensity(ingredient);
  return null;
}
function macro(nutrition, key) {
  const value = nutrition?.per100g?.[key];
  return value == null ? null : n(value);
}
function isQuotaError(error) {
  return /RESOURCE_EXHAUSTED|quota exceeded|quotaexceeded|daily limit|too many requests/i.test(String(error?.message || ''));
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const force = String(process.env.NUTRITION_FORCE || 'false').toLowerCase() === 'true';
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function commitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 300) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 300)) batch.set(write.ref, write.data, { merge: true });
    try {
      await batch.commit();
    } catch (error) {
      if (isQuotaError(error)) throw new Error(`Firestore quota exceeded; stopping immediately instead of retrying. ${error.message}`);
      throw error;
    }
  }
}

async function main() {
  const restaurant = db.collection('restaurants').doc(restaurantId);
  const restaurantSnapshot = await restaurant.get();
  if (!restaurantSnapshot.exists) throw new Error(`Restaurant ${restaurantId} was not found`);

  const [products, catalog] = await Promise.all([
    restaurant.collection('products').get(),
    restaurant.collection('ingredients_catalog').get()
  ]);
  const byId = new Map(catalog.docs.map((d) => [d.id, d.data()]));
  let calculated = 0, review = 0, noRecipe = 0, skipped = 0;
  const writes = [];

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

    // Include both the Poster recipe and the nutrition state/version of every ingredient.
    // This means a product is recalculated when an ingredient's nutrition changes, but not otherwise.
    const calculationInput = recipe.map((x) => {
      const id = x?.ingredientId != null && String(x.ingredientId).trim() ? `poster_${String(x.ingredientId).trim()}` : null;
      const cat = id ? byId.get(id) : [...byId.values()].find((item) => (item.sourceNames || []).includes(x?.name));
      return {
        ingredientId: x?.ingredientId ?? null,
        name: x?.name || '',
        unit: x?.unit || '',
        netto: x?.netto ?? null,
        canonicalId: cat?.canonicalId || null,
        nutritionStatus: cat?.nutrition?.status || null,
        nutritionDatabaseVersion: cat?.nutrition?.databaseVersion || null,
        nutritionPer100g: cat?.nutrition?.per100g || null
      };
    });
    const calculationHash = hash(JSON.stringify(calculationInput));

    if (!force && product.nutrition?.calculationHash === calculationHash) {
      skipped++;
      continue;
    }

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
        recipeHash: hash(JSON.stringify(recipe.map((x) => ({ ingredientId: x.ingredientId ?? null, name: x.name || '', unit: x.unit || '', netto: x.netto ?? null })))),
        calculationHash,
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
    writes.push({ ref: doc.ref, data });
  }

  await commitWrites(writes);

  const previousSummary = restaurantSnapshot.data()?.nutritionCalculation || {};
  const summary = {
    metric: 'kcal_and_macros',
    calculated,
    needsReview: review,
    noRecipe,
    version: 4
  };
  const summaryChanged = previousSummary.metric !== summary.metric
    || previousSummary.calculated !== summary.calculated
    || previousSummary.needsReview !== summary.needsReview
    || previousSummary.noRecipe !== summary.noRecipe
    || previousSummary.version !== summary.version;

  if (summaryChanged) {
    await restaurant.set({
      nutritionCalculation: { ...summary, lastRunAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  console.log(`[Product nutrition] Restaurant: ${restaurantId}`);
  console.log(`[Product nutrition] kcal + macros calculated=${calculated}, needsReview=${review}, noRecipe=${noRecipe}`);
  console.log(`[Product nutrition] Skipped unchanged=${skipped}`);
  console.log(`[Product nutrition] Firestore writes to commit=${writes.length}${summaryChanged ? ' + summary' : ''}`);
}
main().catch((e) => { console.error(`[Product nutrition] FAILED: ${e.message}`); process.exit(1); });
