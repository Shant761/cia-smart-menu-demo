const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const DATABASE_PATH = path.join(__dirname, '..', 'data', 'nutrition-database.json');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function intEnv(name, fallback, min, max) {
  const n = Number(process.env[name] || fallback);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}
function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()\[\]{}.,;:/\\_+\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function numberOrNull(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const limit = intEnv('NUTRITION_LIMIT', 500, 1, 5000);
const force = String(process.env.NUTRITION_FORCE || 'false').toLowerCase() === 'true';

if (!fs.existsSync(DATABASE_PATH)) throw new Error(`Nutrition database not found: ${DATABASE_PATH}`);
const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
const entries = Array.isArray(database.entries) ? database.entries : [];

function buildIndex() {
  const index = new Map();
  for (const entry of entries) {
    if (!entry?.id || !entry?.name) continue;
    const aliases = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
    for (const alias of aliases) {
      const key = normalize(alias);
      if (key) index.set(key, entry);
    }
  }
  return index;
}
const index = buildIndex();

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function findEntry(item) {
  const names = [item.primaryName, ...(Array.isArray(item.sourceNames) ? item.sourceNames : [])]
    .map(normalize)
    .filter(Boolean);
  for (const name of names) {
    const exact = index.get(name);
    if (exact) return { entry: exact, method: 'exact' };
  }
  return null;
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

  let matched = 0;
  let review = 0;
  let missing = 0;

  for (const item of items) {
    const result = findEntry(item);
    if (!result) {
      missing += 1;
      await item.ref.set({
        nutrition: {
          status: 'not_found',
          source: 'CIA-owned nutrition database',
          sourceHash: item.sourceHash,
          databaseVersion: database.version,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      continue;
    }

    const nutrition = result.entry.nutrition || {};
    const per100g = {
      calories: numberOrNull(nutrition.calories),
      protein: numberOrNull(nutrition.protein),
      fat: numberOrNull(nutrition.fat),
      carbohydrates: numberOrNull(nutrition.carbohydrates)
    };
    const complete = Object.values(per100g).every((value) => value !== null);
    const status = complete && result.entry.verified === true ? 'matched' : 'review';
    if (status === 'matched') matched += 1; else review += 1;

    await item.ref.set({
      nutrition: {
        status,
        source: 'CIA-owned nutrition database',
        canonicalId: result.entry.id,
        canonicalName: result.entry.name,
        matchMethod: result.method,
        per100g,
        sourceHash: item.sourceHash,
        databaseVersion: database.version,
        verified: result.entry.verified === true,
        updatedAt: FieldValue.serverTimestamp()
      },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  await restaurant.set({
    nutritionLookup: {
      source: 'CIA-owned nutrition database',
      metric: 'kcal_and_macros',
      databaseVersion: database.version,
      lastRunAt: FieldValue.serverTimestamp(),
      matched,
      review,
      missing,
      version: 1
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[CIA nutrition database] Restaurant: ${restaurantId}`);
  console.log(`[CIA nutrition database] Database entries: ${entries.length}`);
  console.log(`[CIA nutrition database] Selected ingredients: ${items.length}`);
  console.log(`[CIA nutrition database] matched=${matched}, review=${review}, missing=${missing}`);
}

main().catch((e) => {
  console.error(`[CIA nutrition database] FAILED: ${e.message}`);
  process.exit(1);
});
