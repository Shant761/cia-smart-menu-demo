const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = clean(value);
    const key = text.toLocaleLowerCase('und');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
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
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} not found`);

  const [catalogSnapshot, productSnapshot] = await Promise.all([
    restaurantRef.collection('ingredients_catalog').get(),
    restaurantRef.collection('products').get()
  ]);

  const byPosterIngredientId = new Map();
  for (const doc of catalogSnapshot.docs) {
    const data = doc.data();
    const id = data.posterIngredientId;
    if (id === null || id === undefined) continue;
    byPosterIngredientId.set(String(id), { catalogDocId: doc.id, ...data });
  }

  const writes = [];
  let products = 0;
  let recipeRows = 0;
  let matchedRows = 0;
  let productsWithFullCoverage = 0;

  for (const doc of productSnapshot.docs) {
    const product = doc.data();
    if (product.source !== 'poster' || product.active === false) continue;
    products += 1;

    const recipe = Array.isArray(product.posterRecipeIngredients) ? product.posterRecipeIngredients : [];
    const privateRows = [];
    const display = { hy: [], ru: [], en: [] };
    let matched = 0;

    for (const row of recipe) {
      recipeRows += 1;
      const posterIngredientId = row?.ingredientId;
      const catalog = posterIngredientId !== null && posterIngredientId !== undefined
        ? byPosterIngredientId.get(String(posterIngredientId))
        : null;

      if (catalog?.canonicalId) {
        matched += 1;
        matchedRows += 1;
      }

      const sourceName = clean(row?.name);
      const names = {
        hy: clean(catalog?.translations?.hy || sourceName),
        ru: clean(catalog?.translations?.ru || sourceName),
        en: clean(catalog?.translations?.en || sourceName)
      };

      display.hy.push(names.hy);
      display.ru.push(names.ru);
      display.en.push(names.en);

      privateRows.push({
        posterIngredientId: posterIngredientId ?? null,
        sourceName,
        catalogDocId: catalog?.catalogDocId || null,
        canonicalId: catalog?.canonicalId || null,
        names,
        foodCategory: catalog?.foodCategory || null,
        isPreparedComponent: catalog?.isPreparedComponent === true,
        analysisStatus: catalog?.analysisStatus || 'unmatched',
        allergenCandidates: Array.isArray(catalog?.allergenCandidates) ? catalog.allergenCandidates : [],
        unit: clean(row?.unit),
        brutto: number(row?.brutto),
        netto: number(row?.netto),
        locked: row?.locked === true
      });
    }

    const coverage = recipe.length ? matched / recipe.length : 1;
    if (coverage === 1) productsWithFullCoverage += 1;

    // Private document: contains gram weights and analysis candidates. Current Firestore rules deny public reads here.
    writes.push({
      ref: restaurantRef.collection('product_analysis').doc(doc.id),
      data: {
        productId: product.posterProductId ?? product.id ?? doc.id,
        recipeSource: 'poster_tech_card',
        normalizedIngredients: privateRows,
        recipeRows: recipe.length,
        normalizedRows: matched,
        normalizationCoverage: coverage,
        needsReview: privateRows.some((item) => item.analysisStatus === 'needs_review'),
        updatedAt: FieldValue.serverTimestamp()
      }
    });

    // Public product: display names only. No recipe gram weights or private allergen candidates are exposed.
    writes.push({
      ref: doc.ref,
      data: {
        ingredients: {
          hy: dedupe(display.hy),
          ru: dedupe(display.ru),
          en: dedupe(display.en)
        },
        ingredientNormalization: {
          recipeRows: recipe.length,
          normalizedRows: matched,
          coverage,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
  }

  await commit(writes);
  await restaurantRef.set({
    productIngredientEnrichment: {
      activeProducts: products,
      recipeRows,
      normalizedRows: matchedRows,
      productsWithFullCoverage,
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Product enrichment] Restaurant: ${restaurantId}`);
  console.log(`[Product enrichment] Active products: ${products}`);
  console.log(`[Product enrichment] Recipe rows: ${recipeRows}`);
  console.log(`[Product enrichment] Normalized recipe rows: ${matchedRows}`);
  console.log(`[Product enrichment] Products with full recipe normalization: ${productsWithFullCoverage}/${products}`);
}

main().catch((error) => {
  console.error(`[Product enrichment] FAILED: ${error?.message || error}`);
  process.exit(1);
});
