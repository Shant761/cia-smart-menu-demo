const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const database = require('../data/nutrition-database.json');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function score(entry, names) {
  const candidates = [entry.name, ...(entry.aliases || [])].map(normalize).filter(Boolean);
  const queries = names.map(normalize).filter(Boolean);
  let best = 0;
  for (const q of queries) {
    for (const candidate of candidates) {
      if (candidate === q) best = Math.max(best, 100);
      else if (candidate.includes(q) || q.includes(candidate)) best = Math.max(best, 70);
      else {
        const words = q.split(' ');
        const hits = words.filter((w) => w.length > 2 && candidate.includes(w)).length;
        best = Math.max(best, Math.round((hits / Math.max(words.length, 1)) * 50));
      }
    }
  }
  return best;
}
function compatibleNames(a, b) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aWords = new Set(a.split(' ').filter((word) => word.length > 2));
  const bWords = new Set(b.split(' ').filter((word) => word.length > 2));
  return [...aWords].some((word) => bWords.has(word));
}
function hasSourceNameCollision(names) {
  const unique = [...new Set((names || []).map(normalize).filter(Boolean))];
  if (unique.length <= 1) return false;
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      if (!compatibleNames(unique[i], unique[j])) return true;
    }
  }
  return false;
}
function semanticNutrition(value) {
  if (!value) return null;
  return {
    status: value.status || null,
    source: value.source || null,
    canonicalId: value.canonicalId || null,
    matchedName: value.matchedName || '',
    matchScore: value.matchScore ?? null,
    per100g: value.per100g || null,
    sourceHash: value.sourceHash || null,
    reviewReason: value.reviewReason || null
  };
}
function sameSemanticNutrition(a, b) {
  return JSON.stringify(semanticNutrition(a)) === JSON.stringify(semanticNutrition(b));
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const force = String(process.env.NUTRITION_FORCE || 'false').toLowerCase() === 'true';

initializeApp({ credential: cert(serviceAccount), projectId: 'cia-smart-menu' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function commitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 300) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 300)) {
      batch.set(write.ref, write.data, { merge: true });
    }
    await batch.commit();
  }
}

async function main() {
  const restaurant = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurant.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found`);
  const snap = await restaurant.collection('ingredients_catalog').get();
  const entries = Array.isArray(database.entries) ? database.entries : [];
  if (!entries.length) throw new Error('CIA nutrition database is empty. Add verified ingredient entries before running nutrition.');

  let matched = 0;
  let review = 0;
  let missing = 0;
  let collisions = 0;
  let skipped = 0;
  const writes = [];

  for (const doc of snap.docs) {
    const item = doc.data();
    if (item.activeInMenu === false) continue;

    const names = [item.primaryName, ...(item.sourceNames || [])].filter(Boolean);
    const collision = hasSourceNameCollision(names);
    const ranked = entries.map((entry) => ({ entry, score: score(entry, names) })).sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const second = ranked[1];
    const verified = !collision && top && top.entry.verified === true && top.score >= 70 && (!second || top.score > second.score);

    if (collision) collisions += 1;
    if (!top) missing += 1;
    else if (verified) matched += 1;
    else review += 1;

    let nutrition;
    if (top) {
      nutrition = {
        status: verified ? 'matched' : 'review',
        source: 'CIA-owned nutrition database',
        databaseVersion: database.version,
        canonicalId: top.entry.id || null,
        matchedName: top.entry.name || '',
        matchScore: top.score,
        per100g: {
          calories: Number(top.entry.calories),
          protein: Number(top.entry.protein),
          fat: Number(top.entry.fat),
          carbohydrates: Number(top.entry.carbohydrates)
        },
        sourceHash: item.sourceHash,
        reviewReason: collision ? 'source_name_collision' : null
      };
    } else {
      nutrition = {
        status: 'not_found',
        source: 'CIA-owned nutrition database',
        databaseVersion: database.version,
        sourceHash: item.sourceHash,
        reviewReason: collision ? 'source_name_collision' : null
      };
    }

    if (!force && sameSemanticNutrition(item.nutrition, nutrition)) {
      skipped += 1;
      continue;
    }

    writes.push({
      ref: doc.ref,
      data: {
        nutrition: { ...nutrition, updatedAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
  }

  await commitWrites(writes);

  const summary = {
    source: 'CIA-owned nutrition database',
    metric: 'kcal_and_macros',
    lastRunAt: FieldValue.serverTimestamp(),
    matched,
    review,
    missing,
    sourceNameCollisions: collisions,
    version: database.version
  };
  await restaurant.set({ nutritionLookup: summary, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  console.log(`[CIA nutrition] Restaurant: ${restaurantId}`);
  console.log(`[CIA nutrition] matched=${matched}, review=${review}, missing=${missing}, sourceNameCollisions=${collisions}`);
  console.log(`[CIA nutrition] writes=${writes.length}, skipped unchanged=${skipped}`);
}

main().catch((error) => {
  console.error(`[CIA nutrition] FAILED: ${error.message}`);
  process.exit(1);
});
