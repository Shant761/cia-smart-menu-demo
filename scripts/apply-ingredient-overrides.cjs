const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const overridePath = path.join(process.cwd(), 'data', `${restaurantId}-ingredient-overrides.json`);

if (!fs.existsSync(overridePath)) {
  console.log(`[Ingredient overrides] No override file for ${restaurantId}; nothing to do.`);
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
const entries = config.ingredients && typeof config.ingredients === 'object' ? config.ingredients : {};
const version = Number(config.version || 1);

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

  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) {
      batch.set(write.ref, write.data, { merge: true });
    }
    await batch.commit();
  }

  await restaurantRef.set({
    restaurantIngredientOverrides: {
      version,
      lastRunAt: FieldValue.serverTimestamp(),
      configured: Object.keys(entries).length,
      applied,
      missing,
      protected: protectedCount,
      needsReview
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Ingredient overrides] Restaurant: ${restaurantId}`);
  console.log(`[Ingredient overrides] Configured: ${Object.keys(entries).length}`);
  console.log(`[Ingredient overrides] Applied: ${applied}`);
  console.log(`[Ingredient overrides] Needs review: ${needsReview}`);
  console.log(`[Ingredient overrides] Missing Poster IDs: ${missing}`);
  console.log(`[Ingredient overrides] Protected AI/restaurant records skipped: ${protectedCount}`);
}

main().catch((error) => {
  console.error(`[Ingredient overrides] FAILED: ${error?.message || error}`);
  process.exit(1);
});
