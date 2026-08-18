const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const DATA_DIR = path.join(process.cwd(), 'data');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadOverridePacks(restaurantId) {
  const safe = escapeRegex(restaurantId);
  const matcher = new RegExp(`^${safe}-ingredient-overrides(?:-v(\\d+))?\\.json$`);
  const files = fs.readdirSync(DATA_DIR)
    .map((name) => {
      const match = name.match(matcher);
      if (!match) return null;
      return {
        name,
        versionFromName: match[1] ? Number(match[1]) : 1
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.versionFromName - b.versionFromName || a.name.localeCompare(b.name));

  if (!files.length) return { files: [], entries: {}, version: 0 };

  const entries = {};
  let version = 0;
  for (const file of files) {
    const fullPath = path.join(DATA_DIR, file.name);
    const config = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    if (config.restaurantId && config.restaurantId !== restaurantId) {
      throw new Error(`${file.name} restaurantId=${config.restaurantId} does not match ${restaurantId}`);
    }
    const packVersion = Number(config.version || file.versionFromName || 1);
    version = Math.max(version, packVersion);
    if (config.ingredients && typeof config.ingredients === 'object') {
      Object.assign(entries, config.ingredients);
    }
  }

  return { files: files.map((item) => item.name), entries, version };
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const packs = loadOverridePacks(restaurantId);

if (!packs.files.length) {
  console.log(`[Ingredient overrides] No override files for ${restaurantId}; nothing to do.`);
  process.exit(0);
}

const entries = packs.entries;
const version = packs.version;

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function allergenCandidates(ids) {
  return (ids || []).map((id) => ({
    id,
    confidence: 0.95,
    source: 'restaurant_rule_override',
    reason: 'Poster ingredient ID mapped by deterministic restaurant-specific rule; candidate until restaurant verification.'
  }));
}

async function commitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) {
      batch.set(write.ref, write.data, { merge: true });
    }
    await batch.commit();
  }
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found`);

  const catalog = await restaurantRef.collection('ingredients_catalog').get();
  const byPosterId = new Map();
  for (const doc of catalog.docs) {
    const data = doc.data();
    if (data.posterIngredientId !== null && data.posterIngredientId !== undefined) {
      byPosterId.set(String(data.posterIngredientId), { ref: doc.ref, id: doc.id, ...data });
    }
  }

  const writes = [];
  let applied = 0;
  let missing = 0;
  let protectedCount = 0;
  let needsReview = 0;

  for (const [posterId, rule] of Object.entries(entries)) {
    const item = byPosterId.get(String(posterId));
    if (!item) {
      missing += 1;
      continue;
    }

    if (item.restaurantVerified === true || (item.ai?.sourceHash && item.ai.sourceHash === item.sourceHash)) {
      protectedCount += 1;
      continue;
    }

    if (rule.needsReview === true) needsReview += 1;

    writes.push({
      ref: item.ref,
      data: {
        canonicalId: rule.canonicalId,
        translations: rule.names || {},
        foodCategory: rule.category || 'unknown',
        isPreparedComponent: rule.prepared === true,
        allergenCandidates: allergenCandidates(rule.allergens),
        nutritionLookupQuery: rule.names?.en || rule.canonicalId,
        analysisStatus: rule.needsReview === true ? 'needs_review' : 'rule_analyzed',
        restaurantRuleOverride: {
          version,
          sourceFiles: packs.files,
          posterIngredientId: String(posterId),
          sourceHash: item.sourceHash || null,
          needsReview: rule.needsReview === true,
          appliedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
    applied += 1;
  }

  await commitWrites(writes);

  const refreshed = await restaurantRef.collection('ingredients_catalog').get();
  const active = refreshed.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => item.activeInMenu !== false);
  const normalized = active.filter((item) => Boolean(item.canonicalId));
  const unresolved = active
    .filter((item) => !item.canonicalId)
    .sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0));
  const reviewNow = active.filter((item) => item.analysisStatus === 'needs_review').length;

  await restaurantRef.set({
    restaurantIngredientOverrides: {
      version,
      sourceFiles: packs.files,
      lastRunAt: FieldValue.serverTimestamp(),
      configured: Object.keys(entries).length,
      applied,
      missing,
      protected: protectedCount,
      needsReview,
      coverage: {
        activeIngredients: active.length,
        normalized: normalized.length,
        unresolved: unresolved.length,
        needsReview: reviewNow
      }
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Ingredient overrides] Restaurant: ${restaurantId}`);
  console.log(`[Ingredient overrides] Packs: ${packs.files.join(', ')}`);
  console.log(`[Ingredient overrides] Configured unique Poster IDs: ${Object.keys(entries).length}`);
  console.log(`[Ingredient overrides] Applied: ${applied}`);
  console.log(`[Ingredient overrides] Needs review in configured rules: ${needsReview}`);
  console.log(`[Ingredient overrides] Missing Poster IDs: ${missing}`);
  console.log(`[Ingredient overrides] Protected AI/restaurant records skipped: ${protectedCount}`);
  console.log(`[Ingredient overrides] Coverage: normalized=${normalized.length}/${active.length}, unresolved=${unresolved.length}, needsReview=${reviewNow}`);

  if (unresolved.length) {
    console.log('[Ingredient overrides] Top unresolved ingredients after all rules:');
    for (const item of unresolved.slice(0, 120)) {
      console.log(`- ${item.id} | uses=${Number(item.occurrences || 0)} | ${item.primaryName || (item.sourceNames || [])[0] || ''}`);
    }
  }
}

main().catch((error) => {
  console.error(`[Ingredient overrides] FAILED: ${error?.message || error}`);
  process.exit(1);
});
