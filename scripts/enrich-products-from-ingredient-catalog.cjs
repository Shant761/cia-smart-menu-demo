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

const PUBLIC_ALLERGEN_ALIASES = {
  milk: 'milk',
  dairy: 'milk',
  egg: 'egg',
  eggs: 'egg',
  gluten: 'gluten',
  peanut: 'peanut',
  peanuts: 'peanut',
  nuts: 'nuts',
  tree_nuts: 'nuts',
  soy: 'soy',
  fish: 'fish',
  crustacean: 'crustaceans',
  crustaceans: 'crustaceans',
  mollusc: 'molluscs',
  molluscs: 'molluscs',
  sesame: 'sesame',
  mustard: 'mustard',
  celery: 'celery',
  sulphite: 'sulphites',
  sulphites: 'sulphites',
  sulfite: 'sulphites',
  sulfites: 'sulphites',
  lupin: 'lupin'
};

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

function candidateId(candidate) {
  const raw = typeof candidate === 'string'
    ? candidate
    : candidate?.id || candidate?.allergenId || candidate?.allergen || '';
  const key = clean(raw).toLowerCase().replace(/[\s-]+/g, '_');
  return PUBLIC_ALLERGEN_ALIASES[key] || null;
}

function buildPublicAllergens(privateRows, existingAllergens) {
  const confirmed = [];
  const seen = new Set();

  for (const item of Array.isArray(existingAllergens) ? existingAllergens : []) {
    const id = PUBLIC_ALLERGEN_ALIASES[clean(item?.id).toLowerCase().replace(/[\s-]+/g, '_')];
    const isConfirmed = item?.status === 'confirmed' || item?.verified === true || item?.restaurantVerified === true;
    if (!id || !isConfirmed || seen.has(id)) continue;
    seen.add(id);
    confirmed.push({ ...item, id, status: 'confirmed' });
  }

  const suggested = [];
  for (const row of privateRows) {
    for (const candidate of Array.isArray(row.allergenCandidates) ? row.allergenCandidates : []) {
      const id = candidateId(candidate);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      suggested.push({ id, status: 'suggested', source: 'normalized_tech_card' });
    }
  }

  return [...confirmed, ...suggested];
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
  let productsWithAllergens = 0;
  let suggestedAllergenLinks = 0;
  const allergenProductCounts = new Map();

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

    const publicAllergens = buildPublicAllergens(privateRows, product.allergens);
    const suggestedCount = publicAllergens.filter((item) => item.status === 'suggested').length;
    if (publicAllergens.length) productsWithAllergens += 1;
    suggestedAllergenLinks += suggestedCount;
    for (const item of publicAllergens) {
      allergenProductCounts.set(item.id, (allergenProductCounts.get(item.id) || 0) + 1);
    }

    // Private document: contains gram weights and detailed analysis candidates. Firestore rules deny public reads here.
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
        publicAllergenIds: publicAllergens.map((item) => item.id),
        updatedAt: FieldValue.serverTimestamp()
      }
    });

    // Public product: translated ingredient names plus allergen IDs only. No recipe gram weights or private reasoning are exposed.
    // Generated allergens stay "suggested" until the restaurant confirms them. The frontend already treats suggested conflicts conservatively.
    writes.push({
      ref: doc.ref,
      data: {
        ingredients: {
          hy: dedupe(display.hy),
          ru: dedupe(display.ru),
          en: dedupe(display.en)
        },
        allergens: publicAllergens,
        allergenAnalysis: {
          source: 'normalized_tech_card',
          status: suggestedCount ? 'needs_restaurant_confirmation' : 'no_candidate_detected',
          suggestedCount,
          updatedAt: FieldValue.serverTimestamp()
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
      productsWithAllergens,
      suggestedAllergenLinks,
      allergenProductCounts: Object.fromEntries([...allergenProductCounts.entries()].sort()),
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Product enrichment] Restaurant: ${restaurantId}`);
  console.log(`[Product enrichment] Active products: ${products}`);
  console.log(`[Product enrichment] Recipe rows: ${recipeRows}`);
  console.log(`[Product enrichment] Normalized recipe rows: ${matchedRows}`);
  console.log(`[Product enrichment] Products with full recipe normalization: ${productsWithFullCoverage}/${products}`);
  console.log(`[Product enrichment] Products with allergen candidates: ${productsWithAllergens}/${products}`);
  console.log(`[Product enrichment] Suggested allergen links: ${suggestedAllergenLinks}`);
  console.log(`[Product enrichment] Allergen product counts: ${JSON.stringify(Object.fromEntries([...allergenProductCounts.entries()].sort()))}`);
}

main().catch((error) => {
  console.error(`[Product enrichment] FAILED: ${error?.message || error}`);
  process.exit(1);
});
