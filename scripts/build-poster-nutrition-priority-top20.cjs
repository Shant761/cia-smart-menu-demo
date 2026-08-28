const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const restaurantId = process.env.CIA_RESTAURANT_ID || 'poster-test';
const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
initializeApp({ credential: cert(serviceAccount), projectId: 'cia-smart-menu' });
const db = getFirestore();

const limit = Number(process.env.CIA_PRIORITY_LIMIT || 50);
const outPath = path.join(__dirname, '..', 'data', `cia-nutrition-priority-top${limit}.json`);

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const snapshot = await restaurantRef.collection('ingredients_catalog').get();

  const entries = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(entry => entry.activeInMenu !== false)
    .map(entry => ({
      id: entry.id,
      posterIngredientId: entry.posterIngredientId ?? null,
      name: entry.primaryName || entry.sourceNames?.[0] || entry.id,
      aliases: entry.sourceNames || [],
      usedInProductCount: Number(entry.usedInProductCount || 0),
      occurrences: Number(entry.occurrences || 0),
      totalNetto: Number(entry.totalNetto || 0),
      totalBrutto: Number(entry.totalBrutto || 0),
      units: entry.units || [],
      analysisStatus: entry.analysisStatus || 'unknown',
      sampleProducts: entry.sampleProducts || []
    }))
    .sort((a, b) =>
      b.usedInProductCount - a.usedInProductCount ||
      b.occurrences - a.occurrences ||
      a.name.localeCompare(b.name)
    )
    .slice(0, limit)
    .map((entry, index) => ({ priority: index + 1, ...entry }));

  const output = {
    version: '3.0.0',
    restaurantId,
    generatedFrom: 'Firestore restaurants/{restaurantId}/ingredients_catalog',
    ranking: 'usedInProductCount DESC, occurrences DESC, name ASC',
    limit,
    total: entries.length,
    entries
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`[CIA Nutrition Priority] Restaurant: ${restaurantId}`);
  console.log(`[CIA Nutrition Priority] Catalog ingredients: ${snapshot.size}`);
  console.log(`[CIA Nutrition Priority] Top entries: ${entries.length}`);
  for (const entry of entries) {
    console.log(`#${entry.priority} ${entry.name} | products=${entry.usedInProductCount} | occurrences=${entry.occurrences} | netto=${entry.totalNetto}`);
  }
}

main().catch(error => {
  console.error(`[CIA Nutrition Priority] FAILED: ${error?.message || error}`);
  process.exit(1);
});
