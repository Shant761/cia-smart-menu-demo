const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const dataPath = path.join(__dirname, '..', 'data', 'nutrition-ingredients.json');
const nutritionDb = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const entries = nutritionDb.ingredients || {};

function sameNutrition(existing, entry) {
  const nutrition = existing?.nutrition || {};
  const per100g = nutrition.per100g || {};
  return nutrition.status === 'matched'
    && nutrition.basis === entry.basis
    && per100g.calories === entry.calories
    && per100g.protein === entry.protein
    && per100g.fat === entry.fat
    && per100g.carbohydrates === entry.carbohydrates
    && nutrition.source === entry.source
    && (nutrition.sourceUrl || null) === (entry.sourceUrl || null)
    && nutrition.databaseVersion === nutritionDb.version;
}

function isQuotaError(error) {
  return /RESOURCE_EXHAUSTED|quota exceeded|quotaexceeded|daily limit|too many requests/i.test(String(error?.message || ''));
}

async function commitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 300) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 300)) batch.set(write.ref, write.data, { merge: true });
    try {
      await batch.commit();
    } catch (error) {
      if (isQuotaError(error)) {
        throw new Error(`Firestore quota exceeded; stopping immediately instead of retrying. ${error.message}`);
      }
      throw error;
    }
  }
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const restaurantSnapshot = await restaurantRef.get();
  if (!restaurantSnapshot.exists) throw new Error(`Restaurant ${restaurantId} not found`);

  const snapshot = await restaurantRef.collection('ingredients_catalog').get();
  const writes = [];
  let matched = 0;
  let available = 0;
  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const canonicalId = String(data.canonicalId || '').trim();
    const entry = canonicalId ? entries[canonicalId] : null;
    if (!entry) continue;

    matched += 1;
    if (entry.calories != null) available += 1;

    if (sameNutrition(data, entry)) {
      skipped += 1;
      continue;
    }

    updated += 1;
    writes.push({
      ref: doc.ref,
      data: {
        nutrition: {
          status: 'matched',
          basis: entry.basis,
          per100g: {
            calories: entry.calories,
            protein: entry.protein,
            fat: entry.fat,
            carbohydrates: entry.carbohydrates
          },
          source: entry.source,
          sourceUrl: entry.sourceUrl || null,
          databaseVersion: nutritionDb.version,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
  }

  await commitWrites(writes);

  const previousSummary = restaurantSnapshot.data()?.ingredientNutrition || {};
  const summary = {
    databaseVersion: nutritionDb.version,
    matchedCatalogIngredients: matched,
    nutritionEntriesApplied: available,
    sourcePolicy: nutritionDb.sourcePolicy
  };
  const summaryChanged = previousSummary.databaseVersion !== summary.databaseVersion
    || previousSummary.matchedCatalogIngredients !== summary.matchedCatalogIngredients
    || previousSummary.nutritionEntriesApplied !== summary.nutritionEntriesApplied
    || previousSummary.sourcePolicy !== summary.sourcePolicy;

  if (summaryChanged) {
    await restaurantRef.set({
      ingredientNutrition: {
        ...summary,
        lastRunAt: FieldValue.serverTimestamp()
      },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  console.log(`[Ingredient nutrition] Restaurant: ${restaurantId}`);
  console.log(`[Ingredient nutrition] Catalog matches: ${matched}`);
  console.log(`[Ingredient nutrition] Nutrition entries applied: ${available}`);
  console.log(`[Ingredient nutrition] Updated: ${updated}`);
  console.log(`[Ingredient nutrition] Skipped unchanged: ${skipped}`);
  console.log(`[Ingredient nutrition] Firestore writes to commit: ${writes.length}${summaryChanged ? ' + summary' : ''}`);
  console.log('[Ingredient nutrition] No unverified nutrition values were added.');
}

main().catch((error) => {
  console.error(`[Ingredient nutrition] FAILED: ${error?.message || error}`);
  process.exit(1);
});
