const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('node:crypto');

const PROJECT_ID = 'cia-smart-menu';
const USDA_API_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_API_KEY = (process.env.USDA_API_KEY || '').trim();
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
if (!USDA_API_KEY) throw new Error('USDA_API_KEY is required');

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nutrient(food, number) {
  const item = (food.foodNutrients || []).find((x) => String(x.nutrientNumber || '') === String(number));
  const value = Number(item?.value);
  return Number.isFinite(value) ? value : null;
}

function candidateNames(data) {
  return [...new Set([
    data.name,
    ...(Array.isArray(data.sourceNames) ? data.sourceNames : [])
  ].map((x) => String(x || '').trim()).filter(Boolean))];
}

function isSafeMatch(query, food) {
  const q = normalize(query);
  const d = normalize(food.description);
  if (!q || !d) return false;
  if (d === q || d.includes(q) || q.includes(d)) return true;
  const tokens = q.split(' ').filter((x) => x.length >= 3);
  if (!tokens.length) return false;
  const hits = tokens.filter((token) => d.includes(token)).length;
  return hits / tokens.length >= 0.75;
}

async function searchUSDA(query) {
  // USDA documents POST /foods/search with the query in JSON. Using POST avoids
  // URL/query-string edge cases with non-Latin ingredient names and follows the
  // official FoodData Central API examples.
  const url = new URL(USDA_API_URL);
  url.searchParams.set('api_key', USDA_API_KEY);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      pageSize: 8,
      pageNumber: 1
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`USDA ${response.status} for query ${JSON.stringify(query)}: ${body}`);
  }

  return response.json();
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} not found`);

  const snapshot = await restaurantRef.collection('ingredients_catalog').get();
  const pending = snapshot.docs.filter((doc) => {
    const data = doc.data();
    return data?.nutrition?.status !== 'matched';
  });

  console.log(`[USDA nutrition] Catalog ingredients: ${snapshot.size}`);
  console.log(`[USDA nutrition] New/unmatched ingredients: ${pending.length}`);

  const writes = [];
  let searched = 0;
  let matched = 0;
  let needsReview = 0;
  let cachedNoMatch = 0;

  for (const doc of pending) {
    const data = doc.data();
    const names = candidateNames(data);
    if (!names.length) continue;

    // A no-match is cached so repeated scheduled runs do not hammer USDA.
    if (data?.nutrition?.status === 'needs_review' && data?.nutrition?.source === 'USDA FoodData Central') {
      cachedNoMatch++;
      needsReview++;
      continue;
    }

    let found = null;
    let usedQuery = null;
    for (const query of names) {
      searched++;
      const result = await searchUSDA(query);
      const safe = (result.foods || []).find((food) => isSafeMatch(query, food));
      if (safe) {
        found = safe;
        usedQuery = query;
        break;
      }
    }

    if (!found) {
      needsReview++;
      writes.push({
        ref: doc.ref,
        data: {
          nutrition: {
            status: 'needs_review',
            source: 'USDA FoodData Central',
            reason: 'No conservative USDA match found',
            matchedQuery: names[0],
            updatedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        }
      });
      continue;
    }

    const calories = nutrient(found, '1008');
    const protein = nutrient(found, '1003');
    const fat = nutrient(found, '1004');
    const carbohydrates = nutrient(found, '1005');
    if ([calories, protein, fat, carbohydrates].some((x) => x === null)) {
      needsReview++;
      writes.push({
        ref: doc.ref,
        data: {
          nutrition: {
            status: 'needs_review',
            source: 'USDA FoodData Central',
            reason: 'USDA result is missing one or more required nutrients',
            matchedQuery: usedQuery,
            fdcId: found.fdcId,
            matchedName: found.description,
            updatedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        }
      });
      continue;
    }

    const sourceHash = hash(`${data.canonicalId || doc.id}|${found.fdcId}|${found.description}`);
    writes.push({
      ref: doc.ref,
      data: {
        nutrition: {
          status: 'matched',
          basis: '100g',
          per100g: {
            calories,
            protein,
            fat,
            carbohydrates
          },
          source: 'USDA FoodData Central',
          sourceUrl: `https://fdc.nal.usda.gov/food-details/${found.fdcId}/nutrients`,
          fdcId: found.fdcId,
          matchedName: found.description,
          matchedQuery: usedQuery,
          sourceHash,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
    matched++;
  }

  for (let offset = 0; offset < writes.length; offset += 300) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 300)) {
      batch.set(write.ref, write.data, { merge: true });
    }
    await batch.commit();
  }

  await restaurantRef.set({
    ingredientNutrition: {
      usda: {
        source: 'USDA FoodData Central',
        searched,
        matched,
        needsReview,
        cachedNoMatch,
        lastRunAt: FieldValue.serverTimestamp()
      }
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[USDA nutrition] USDA searches: ${searched}`);
  console.log(`[USDA nutrition] New matches: ${matched}`);
  console.log(`[USDA nutrition] Needs review: ${needsReview}`);
  console.log(`[USDA nutrition] Cached no-match records skipped: ${cachedNoMatch}`);
  console.log('[USDA nutrition] Existing matched nutrition was not queried or rewritten.');
}

main().catch((error) => {
  console.error(`[USDA nutrition] FAILED: ${error?.message || error}`);
  process.exit(1);
});
