const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const rawServiceAccount = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();

if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');

let serviceAccount;
try {
  serviceAccount = JSON.parse(rawServiceAccount);
} catch (error) {
  throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${error.message}`);
}

if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT is invalid: project_id is missing');

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = getFirestore();

async function main() {
  const snapshot = await db
    .collection('restaurants')
    .doc(restaurantId)
    .collection('nutrition_review')
    .get();

  if (snapshot.empty) {
    throw new Error(`No nutrition_review entries found for ${restaurantId}. Run Stage 2 first.`);
  }

  const entries = snapshot.docs
    .map((doc) => {
      const item = doc.data() || {};
      return {
        id: doc.id,
        name: item.primaryName || item.name || doc.id,
        aliases: Array.isArray(item.aliases) ? item.aliases : [],
        ingredientIds: Array.isArray(item.ingredientIds) ? item.ingredientIds : [],
        posterIngredientIds: Array.isArray(item.posterIngredientIds) ? item.posterIngredientIds : [],
        units: Array.isArray(item.units) ? item.units : [],
        occurrences: Number(item.occurrences || 0),
        usedInProductCount: Number(item.usedInProductCount || 0),
        nutrition: item.nutrition || null,
        source: item.source || 'CIA-owned',
        verified: item.verified === true,
        status: item.status || 'needs_nutrition',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const outputPath = path.join(__dirname, '..', 'data', 'nutrition-review-queue.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ version: '1.0.0', restaurantId, entries }, null, 2) + '\n'
  );

  console.log(`[CIA nutrition stage 2B] Firestore review entries: ${entries.length}`);
  console.log(`[CIA nutrition stage 2B] Exported to ${outputPath}`);
}

main().catch((error) => {
  console.error(`[CIA nutrition stage 2B] FAILED: ${error?.message || error}`);
  process.exit(1);
});
