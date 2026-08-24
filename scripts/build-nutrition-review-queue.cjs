const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

const PROJECT_ID = 'cia-smart-menu';
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const rawServiceAccount = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
const serviceAccount = JSON.parse(rawServiceAccount);
if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT is invalid');

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function queueId(key) {
  return `nutrition_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found`);

  const snapshot = await restaurantRef.collection('ingredients_catalog').where('activeInMenu', '==', true).get();
  if (snapshot.empty) throw new Error(`No active ingredients_catalog entries found for ${restaurantId}`);

  const groups = new Map();
  for (const doc of snapshot.docs) {
    const item = doc.data() || {};
    const names = [item.primaryName, ...(Array.isArray(item.sourceNames) ? item.sourceNames : [])].filter(Boolean);
    const key = normalize(item.primaryName || names[0]);
    if (!key) continue;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        primaryName: item.primaryName || names[0],
        aliases: new Set(),
        ingredientIds: new Set(),
        posterIngredientIds: new Set(),
        units: new Set(),
        occurrences: 0,
        usedInProductCount: 0
      };
      groups.set(key, group);
    }

    for (const name of names) {
      if (normalize(name) !== key) group.aliases.add(String(name));
    }
    group.ingredientIds.add(doc.id);
    if (item.posterIngredientId != null) group.posterIngredientIds.add(String(item.posterIngredientId));
    for (const unit of item.units || []) group.units.add(String(unit));
    group.occurrences += Number(item.occurrences || 0);
    group.usedInProductCount += Number(item.usedInProductCount || 0);
  }

  const writes = [];
  for (const group of groups.values()) {
    const ref = restaurantRef.collection('nutrition_review').doc(queueId(group.key));
    const current = await ref.get();
    const currentData = current.exists ? current.data() || {} : {};

    writes.push({
      ref,
      data: {
        canonicalKey: group.key,
        primaryName: group.primaryName,
        aliases: [...group.aliases],
        ingredientIds: [...group.ingredientIds],
        posterIngredientIds: [...group.posterIngredientIds],
        units: [...group.units],
        occurrences: group.occurrences,
        usedInProductCount: group.usedInProductCount,
        nutrition: currentData.nutrition || null,
        status: currentData.status || 'needs_nutrition',
        source: 'CIA-owned',
        verified: currentData.verified === true,
        updatedAt: FieldValue.serverTimestamp()
      }
    });
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 400)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }

  await restaurantRef.set({
    nutrition: {
      reviewQueueSize: writes.length,
      sourceIngredientCatalogSize: snapshot.size,
      stage: 'ingredient-review',
      status: 'needs_nutrition',
      updatedAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[CIA nutrition stage 2] Restaurant: ${restaurantId}`);
  console.log(`[CIA nutrition stage 2] Catalog entries: ${snapshot.size}`);
  console.log(`[CIA nutrition stage 2] Normalized review entries: ${writes.length}`);
  console.log('[CIA nutrition stage 2] No nutrition values were invented or assigned.');
}

main().catch((error) => {
  console.error(`[CIA nutrition stage 2] FAILED: ${error?.message || error}`);
  process.exit(1);
});
