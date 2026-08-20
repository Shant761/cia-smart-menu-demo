const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const DATA_DIR = path.join(process.cwd(), 'data');

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const clean = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function loadProductPacks() {
  const safe = escapeRegex(restaurantId);
  const re = new RegExp(`^${safe}-product-translations(?:-v(\\d+))?\\.json$`);
  const files = fs.readdirSync(DATA_DIR).map((name) => {
    const match = name.match(re);
    return match ? { name, version: Number(match[1] || 1) } : null;
  }).filter(Boolean).sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
  const products = {};
  let version = 0;
  for (const file of files) {
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file.name), 'utf8'));
    version = Math.max(version, Number(config.version || file.version));
    Object.assign(products, config.products || {});
  }
  return { files, products, version };
}

function loadIngredientPacks() {
  const safe = escapeRegex(restaurantId);
  const re = new RegExp(`^${safe}-ingredient-overrides(?:-v(\\d+))?\\.json$`);
  const files = fs.readdirSync(DATA_DIR).map((name) => {
    const match = name.match(re);
    return match ? { name, version: Number(match[1] || 1) } : null;
  }).filter(Boolean).sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
  const ingredients = {};
  let version = 0;
  for (const file of files) {
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file.name), 'utf8'));
    version = Math.max(version, Number(config.version || file.version));
    Object.assign(ingredients, config.ingredients || {});
  }
  return { files, ingredients, version };
}

async function commit(writes) {
  for (let offset = 0; offset < writes.length; offset += 350) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 350)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const restaurant = await restaurantRef.get();
  if (!restaurant.exists) throw new Error(`Restaurant ${restaurantId} not found`);

  const [productsSnapshot, catalogSnapshot] = await Promise.all([
    restaurantRef.collection('products').get(),
    restaurantRef.collection('ingredients_catalog').get()
  ]);

  const productPacks = loadProductPacks();
  const ingredientPacks = loadIngredientPacks();
  const productRules = productPacks.products;
  const ingredientRules = ingredientPacks.ingredients;
  const productsById = new Map(productsSnapshot.docs.map((doc) => [String(doc.id), doc]));
  const catalogByPosterId = new Map();
  for (const doc of catalogSnapshot.docs) {
    const data = doc.data();
    if (data.posterIngredientId !== undefined && data.posterIngredientId !== null) {
      catalogByPosterId.set(String(data.posterIngredientId), doc);
    }
  }

  const writes = [];
  let productApplied = 0;
  let productMissing = 0;
  let ingredientApplied = 0;
  let ingredientMissing = 0;

  for (const [id, rule] of Object.entries(productRules)) {
    const doc = productsById.get(String(id));
    if (!doc || !rule?.ru || !rule?.en || !rule?.hy) {
      productMissing += 1;
      continue;
    }
    const source = clean(rule.hy);
    writes.push({
      ref: doc.ref,
      data: {
        name: { ru: clean(rule.ru), en: clean(rule.en), hy: source },
        titleTranslation: {
          version: productPacks.version,
          sourceLanguage: 'hy',
          sourceText: source,
          method: 'curated_repository_pack',
          needsReview: rule.needsReview === true,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
    productApplied += 1;
  }

  for (const [posterId, rule] of Object.entries(ingredientRules)) {
    const doc = catalogByPosterId.get(String(posterId));
    if (!doc || !rule?.names?.ru || !rule?.names?.en || !rule?.names?.hy) {
      ingredientMissing += 1;
      continue;
    }
    writes.push({
      ref: doc.ref,
      data: {
        translations: {
          ru: clean(rule.names.ru),
          en: clean(rule.names.en),
          hy: clean(rule.names.hy)
        },
        translationSource: 'curated_repository_pack',
        translationVersion: ingredientPacks.version,
        updatedAt: FieldValue.serverTimestamp()
      }
    });
    ingredientApplied += 1;
  }

  await commit(writes);
  await restaurantRef.set({
    localization: {
      status: 'curated',
      productPackVersion: productPacks.version,
      productPacks: productPacks.files.map((file) => file.name),
      productApplied,
      productMissing,
      ingredientPackVersion: ingredientPacks.version,
      ingredientPacks: ingredientPacks.files.map((file) => file.name),
      ingredientApplied,
      ingredientMissing,
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Localization] Restaurant: ${restaurantId}`);
  console.log(`[Localization] Product translations applied: ${productApplied}; missing: ${productMissing}`);
  console.log(`[Localization] Ingredient translations applied: ${ingredientApplied}; missing: ${ingredientMissing}`);
  console.log(`[Localization] Product pack version: ${productPacks.version}`);
  console.log(`[Localization] Ingredient pack version: ${ingredientPacks.version}`);
}

main().catch((error) => {
  console.error(`[Localization] FAILED: ${error?.message || error}`);
  process.exit(1);
});
