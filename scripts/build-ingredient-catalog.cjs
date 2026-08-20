const crypto = require('crypto');
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

if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(restaurantId)) {
  throw new Error('CIA_RESTAURANT_ID must contain only letters, numbers, _ or -');
}

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}
function firstLocalizedText(value) {
  if (typeof value === 'string') return normalizeText(value);
  if (!value || typeof value !== 'object') return '';
  return normalizeText(value.hy || value.ru || value.en || Object.values(value).find(Boolean) || '');
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function ingredientDocId(ingredientId, name) {
  if (ingredientId !== null && ingredientId !== undefined && String(ingredientId).trim()) return `poster_${String(ingredientId).trim()}`;
  return `name_${hash(normalizeText(name).toLowerCase()).slice(0, 20)}`;
}
function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
async function commitWrites(writes) {
  const chunkSize = 400;
  for (let index = 0; index < writes.length; index += chunkSize) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + chunkSize)) {
      if (write.type === 'set') batch.set(write.ref, write.data, write.options || {});
      if (write.type === 'update') batch.update(write.ref, write.data);
    }
    await batch.commit();
  }
}

async function buildCatalog() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found in Firestore`);

  const [productSnapshot, existingCatalogSnapshot] = await Promise.all([
    restaurantRef.collection('products').get(),
    restaurantRef.collection('ingredients_catalog').get()
  ]);
  const existingCatalog = new Map(existingCatalogSnapshot.docs.map((doc) => [doc.id, doc.data()]));
  const catalog = new Map();
  let activePosterProducts = 0;
  let recipeRows = 0;

  for (const productDoc of productSnapshot.docs) {
    const product = productDoc.data();
    if (product?.source !== 'poster' || product?.active === false) continue;
    activePosterProducts += 1;
    const productName = firstLocalizedText(product.name) || `Product ${productDoc.id}`;
    const ingredients = Array.isArray(product.posterRecipeIngredients) ? product.posterRecipeIngredients : [];

    for (const ingredient of ingredients) {
      const name = normalizeText(ingredient?.name);
      if (!name) continue;
      recipeRows += 1;
      const posterIngredientId = ingredient?.ingredientId ?? null;
      const docId = ingredientDocId(posterIngredientId, name);
      const unit = normalizeText(ingredient?.unit);
      const netto = numberOrZero(ingredient?.netto);
      const brutto = numberOrZero(ingredient?.brutto);

      if (!catalog.has(docId)) {
        catalog.set(docId, { docId, posterIngredientId, names: new Set(), units: new Set(), occurrences: 0, totalNetto: 0, totalBrutto: 0, productIds: new Set(), samples: [] });
      }
      const entry = catalog.get(docId);
      entry.names.add(name);
      if (unit) entry.units.add(unit);
      entry.occurrences += 1;
      entry.totalNetto += netto;
      entry.totalBrutto += brutto;
      entry.productIds.add(String(product.posterProductId ?? productDoc.id));
      if (entry.samples.length < 12) entry.samples.push({ productId: String(product.posterProductId ?? productDoc.id), productName, netto, brutto, unit });
    }
  }

  const now = FieldValue.serverTimestamp();
  const writes = [];
  let pendingReview = 0;
  let unchanged = 0;
  let needsReview = 0;

  for (const entry of catalog.values()) {
    const names = [...entry.names].sort((a, b) => a.localeCompare(b));
    const units = [...entry.units].sort((a, b) => a.localeCompare(b));
    const primaryName = names[0] || '';
    const sourceHash = hash(JSON.stringify({ posterIngredientId: entry.posterIngredientId, names, units }));
    const existing = existingCatalog.get(entry.docId) || {};
    const sourceChanged = existing.sourceHash && existing.sourceHash !== sourceHash;
    let analysisStatus = existing.analysisStatus || 'pending_review';

    if (!existing.sourceHash) {
      analysisStatus = 'pending_review';
      pendingReview += 1;
    } else if (sourceChanged) {
      analysisStatus = existing.restaurantVerified === true ? 'needs_review' : 'pending_review';
      if (analysisStatus === 'needs_review') needsReview += 1;
      else pendingReview += 1;
    } else {
      unchanged += 1;
    }

    writes.push({
      type: 'set',
      ref: restaurantRef.collection('ingredients_catalog').doc(entry.docId),
      data: {
        id: entry.docId,
        source: 'poster_recipe',
        activeInMenu: true,
        posterIngredientId: entry.posterIngredientId,
        primaryName,
        sourceNames: names,
        units,
        occurrences: entry.occurrences,
        totalNetto: Number(entry.totalNetto.toFixed(4)),
        totalBrutto: Number(entry.totalBrutto.toFixed(4)),
        usedInProductCount: entry.productIds.size,
        usedInProductIds: [...entry.productIds].slice(0, 100),
        sampleProducts: entry.samples,
        sourceHash,
        analysisStatus,
        lastSeenAt: now,
        updatedAt: now
      },
      options: { merge: true }
    });
  }

  for (const oldDoc of existingCatalogSnapshot.docs) {
    if (!catalog.has(oldDoc.id) && oldDoc.data()?.activeInMenu !== false) {
      writes.push({ type: 'update', ref: oldDoc.ref, data: { activeInMenu: false, lastSeenAt: now, updatedAt: now } });
    }
  }

  writes.push({
    type: 'set',
    ref: restaurantRef,
    data: {
      ingredientCatalog: { uniqueIngredients: catalog.size, activePosterProducts, recipeRows, pendingReview, needsReview, unchanged, lastBuildAt: now, version: 2 },
      updatedAt: now
    },
    options: { merge: true }
  });

  await commitWrites(writes);
  console.log(`[Ingredient catalog] Restaurant: ${restaurantId}`);
  console.log(`[Ingredient catalog] Active Poster products: ${activePosterProducts}`);
  console.log(`[Ingredient catalog] Recipe rows: ${recipeRows}`);
  console.log(`[Ingredient catalog] Unique ingredients: ${catalog.size}`);
  console.log(`[Ingredient catalog] Pending review: ${pendingReview}, needs review: ${needsReview}, unchanged: ${unchanged}`);
}

buildCatalog().catch((error) => {
  console.error(`[Ingredient catalog] FAILED: ${error?.message || error}`);
  process.exit(1);
});
