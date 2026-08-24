const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const serviceAccount = JSON.parse((process.env.FIREBASE_SERVICE_ACCOUNT || '').trim());

if (!serviceAccount || !serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const snapshot = await restaurantRef.collection('ingredients_catalog').where('activeInMenu', '==', true).get();
  if (snapshot.empty) throw new Error(`No active ingredients_catalog entries found for ${restaurantId}`);

  const writes = [];
  let pending = 0;
  let existing = 0;

  for (const doc of snapshot.docs) {
    const item = doc.data() || {};
    const nutritionRef = restaurantRef.collection('nutrition_review').doc(doc.id);
    const current = await nutritionRef.get();
    const currentData = current.exists ? current.data() : {};
    if (current.exists) existing += 1;

    const status = currentData.status || 'pending';
    if (status === 'pending') pending += 1;

    writes.push({
      ref: nutritionRef,
      data: {
        ingredientId: doc.id,
        posterIngredientId: item.posterIngredientId ?? null,
        primaryName: normalize(item.primaryName),
        sourceNames: Array.isArray(item.sourceNames) ? item.sourceNames : [],
        units: Array.isArray(item.units) ? item.units : [],
        occurrences: Number(item.occurrences || 0),
        usedInProductCount: Number(item.usedInProductCount || 0),
        nutrition: currentData.nutrition || null,
        status,
        source: currentData.source || 'manual_cia',
        verified: currentData.verified === true,
        updatedAt: FieldValue.serverTimestamp()
      },
      options: { merge: true }
    });
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 400)) batch.set(write.ref, write.data, write.options);
    await batch.commit();
  }

  await restaurantRef.set({
    nutrition: {
      reviewQueueSize: snapshot.size,
      pendingReview: pending,
      existingEntries: existing,
      stage: 'ingredient-review',
      updatedAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[CIA nutrition stage 2] Restaurant: ${restaurantId}`);
  console.log(`[CIA nutrition stage 2] Ingredients queued: ${snapshot.size}`);
  console.log(`[CIA nutrition stage 2] Pending: ${pending}`);
  console.log(`[CIA nutrition stage 2] Existing review entries: ${existing}`);
}

main().catch((error) => {
  console.error(`[CIA nutrition stage 2] FAILED: ${error?.message || error}`);
  process.exit(1);
});
