const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const USDA_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function intEnv(name, fallback, min, max) {
  const n = Number(process.env[name] || fallback);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}
function kcalValue(food) {
  const nutrient = (food.foodNutrients || []).find((x) => Number(x.nutrientId) === 1008);
  return Number.isFinite(Number(nutrient?.value)) ? Number(nutrient.value) : null;
}
function score(food, query) {
  const q = query.toLowerCase().split(/\s+/).filter((x) => x.length > 2);
  const text = String(food.description || '').toLowerCase();
  return q.reduce((s, word) => s + (text.includes(word) ? 1 : 0), 0);
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const apiKey = requiredEnv('USDA_DATA_API_KEY');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const limit = intEnv('NUTRITION_LIMIT', 50, 1, 500);
const force = String(process.env.NUTRITION_FORCE || 'false').toLowerCase() === 'true';

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function search(query) {
  const url = new URL(USDA_URL);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', '8');
  url.searchParams.set('dataType', 'Foundation,SR Legacy');
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`USDA HTTP ${res.status}: ${body?.message || 'request failed'}`);
  return (body.foods || []).sort((a, b) => score(b, query) - score(a, query));
}

async function main() {
  const restaurant = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurant.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found`);
  const snap = await restaurant.collection('ingredients_catalog').get();
  const items = snap.docs.map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
    .filter((x) => x.activeInMenu !== false)
    .filter((x) => force || !x.nutrition?.sourceHash || x.nutrition.sourceHash !== x.sourceHash)
    .sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0))
    .slice(0, limit);

  console.log(`[USDA nutrition] Restaurant: ${restaurantId}`);
  console.log(`[USDA nutrition] Selected: ${items.length}`);
  let matched = 0, review = 0, missing = 0;

  for (const item of items) {
    const query = String(item.nutritionLookupQuery || item.primaryName || '').trim();
    if (!query) continue;
    const foods = await search(query);
    const food = foods[0];
    if (!food) {
      missing += 1;
      await item.ref.set({ nutrition: { status: 'not_found', source: 'USDA FoodData Central', query, sourceHash: item.sourceHash, updatedAt: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      continue;
    }

    const kcal = kcalValue(food);
    const topScore = score(food, query);
    const secondScore = foods.length > 1 ? score(foods[1], query) : -1;
    const confidence = kcal !== null && !(topScore > 0 && topScore === secondScore) ? 'matched' : 'review';
    if (confidence === 'review') review += 1; else matched += 1;

    await item.ref.set({
      nutrition: {
        status: confidence,
        source: 'USDA FoodData Central',
        fdcId: food.fdcId,
        description: food.description || '',
        query,
        matchScore: topScore,
        per100g: { calories: kcal },
        sourceHash: item.sourceHash,
        retrievedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  await restaurant.set({ nutritionLookup: { source: 'USDA FoodData Central', metric: 'kcal_only', lastRunAt: FieldValue.serverTimestamp(), matched, review, missing, version: 3 }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`[USDA nutrition] matched=${matched}, review=${review}, missing=${missing}`);
}

main().catch((e) => { console.error(`[USDA nutrition] FAILED: ${e.message}`); process.exit(1); });
