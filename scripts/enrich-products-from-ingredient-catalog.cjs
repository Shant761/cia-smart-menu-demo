const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const clean = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const textKey = (value) => clean(value).toLocaleLowerCase('und').replace(/ё/g, 'е');

const PUBLIC_ALLERGEN_ALIASES = {
  milk: 'milk', dairy: 'milk', egg: 'egg', eggs: 'egg', gluten: 'gluten',
  peanut: 'peanut', peanuts: 'peanut', nuts: 'nuts', tree_nuts: 'nuts', soy: 'soy',
  fish: 'fish', crustacean: 'crustaceans', crustaceans: 'crustaceans',
  mollusc: 'molluscs', molluscs: 'molluscs', sesame: 'sesame', mustard: 'mustard',
  celery: 'celery', sulphite: 'sulphites', sulphites: 'sulphites', sulfite: 'sulphites',
  sulfites: 'sulphites', lupin: 'lupin'
};

const RAW_ALLERGEN_RULES = [
  { id: 'milk', terms: ['молок', 'сливк', 'сметан', 'моцарел', 'пармез', 'фета', 'буррат', 'мацон', 'йогурт', 'творог', 'сыр', 'կաթ', 'սերուց', 'պանիր'] },
  { id: 'egg', terms: ['яйц', 'майонез', 'egg', 'ձու'] },
  { id: 'gluten', terms: ['мук', 'пшен', 'хлеб', 'сухар', 'макарон', 'паста', 'лаваш', 'пита', 'тесто', 'булк', 'багет', 'матнакаш', 'вафл', 'wheat', 'flour', 'bread', 'pasta', 'dough', 'ալյուր', 'ցորեն', 'լավաշ'] },
  { id: 'fish', terms: ['рыб', 'лосос', 'семг', 'форел', 'тунец', 'туна', 'сиг', 'стерлет', 'стерляд', 'икра', 'fish', 'salmon', 'tuna', 'trout', 'ձուկ', 'սաղմոն'] },
  { id: 'crustaceans', terms: ['кревет', 'краб', 'лангуст', 'shrimp', 'prawn', 'crab', 'ծովախեցգետ'] },
  { id: 'molluscs', terms: ['кальмар', 'миди', 'осьминог', 'squid', 'mussel', 'octopus'] },
  { id: 'peanut', terms: ['арахис', 'peanut', 'գետնանուշ'] },
  { id: 'nuts', terms: ['грецк', 'орех', 'миндал', 'фисташ', 'фундук', 'walnut', 'almond', 'pistach', 'hazelnut', 'ընկույզ', 'նուշ'] },
  { id: 'soy', terms: ['соев', 'соя', 'тофу', 'soy', 'tofu', 'սոյ'] },
  { id: 'sesame', terms: ['кунжут', 'sesame', 'քնջութ'] },
  { id: 'mustard', terms: ['горчиц', 'mustard', 'մանանեխ'] },
  { id: 'celery', terms: ['сельдер', 'celery', 'նեխուր'] },
  { id: 'sulphites', terms: ['сульфит', 'sulfite', 'sulphite'] },
  { id: 'lupin', terms: ['люпин', 'lupin'] }
];

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
  const raw = typeof candidate === 'string' ? candidate : candidate?.id || candidate?.allergenId || candidate?.allergen || '';
  const key = clean(raw).toLowerCase().replace(/[\s-]+/g, '_');
  return PUBLIC_ALLERGEN_ALIASES[key] || null;
}

function directAllergenIds(sourceName) {
  const key = textKey(sourceName);
  return RAW_ALLERGEN_RULES
    .filter((rule) => rule.terms.some((term) => key.includes(textKey(term))))
    .map((rule) => rule.id);
}

function catalogMappingTrusted(catalog) {
  if (!catalog) return false;
  if (catalog.restaurantVerified === true) return true;
  if (catalog.ai?.sourceHash && catalog.ai.sourceHash === catalog.sourceHash) return true;
  if (catalog.sourceValidation?.valid === false) return false;
  if (catalog.sourceValidation?.valid === true) return true;
  if (catalog.restaurantRuleOverride) return false;
  return ['exact', 'stripped_exact'].includes(catalog.ruleNormalization?.match);
}

function localizedNames(sourceName, catalog, trusted) {
  const translated = trusted && catalog?.translations ? catalog.translations : {};
  const names = {
    hy: clean(translated.hy || sourceName),
    ru: clean(translated.ru || sourceName),
    en: clean(translated.en || sourceName)
  };

  // The original Poster text is immutable source truth in its source language.
  const sourceLanguage = catalog?.sourceLanguage;
  if (sourceLanguage === 'hy') names.hy = sourceName;
  else if (sourceLanguage === 'en') names.en = sourceName;
  else names.ru = sourceName;
  return names;
}

function buildPublicAllergens(privateRows, existingAllergens) {
  const out = [];
  const seen = new Set();

  for (const item of Array.isArray(existingAllergens) ? existingAllergens : []) {
    const id = PUBLIC_ALLERGEN_ALIASES[clean(item?.id).toLowerCase().replace(/[\s-]+/g, '_')];
    const confirmed = item?.status === 'confirmed' || item?.verified === true || item?.restaurantVerified === true;
    if (!id || !confirmed || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...item, id, status: 'confirmed' });
  }

  for (const row of privateRows) {
    const candidates = [];
    if (row.mappingTrusted) {
      for (const candidate of Array.isArray(row.catalogAllergenCandidates) ? row.catalogAllergenCandidates : []) {
        const id = candidateId(candidate);
        if (id) candidates.push({ id, source: 'validated_mapping' });
      }
    }
    for (const id of row.rawAllergenIds) candidates.push({ id, source: 'poster_source_name_rule' });

    for (const candidate of candidates) {
      if (!candidate.id || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      out.push({ id: candidate.id, status: 'suggested', source: candidate.source });
    }
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
    if (id !== null && id !== undefined) byPosterIngredientId.set(String(id), { catalogDocId: doc.id, ...data });
  }

  const writes = [];
  let products = 0;
  let recipeRows = 0;
  let trustedRows = 0;
  let sourceTruthFallbackRows = 0;
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

    for (const row of recipe) {
      recipeRows += 1;
      const posterIngredientId = row?.ingredientId;
      const catalog = posterIngredientId !== null && posterIngredientId !== undefined
        ? byPosterIngredientId.get(String(posterIngredientId))
        : null;
      const sourceName = clean(row?.name);
      const trusted = catalogMappingTrusted(catalog);
      if (trusted) trustedRows += 1;
      else sourceTruthFallbackRows += 1;

      const names = localizedNames(sourceName, catalog, trusted);
      display.hy.push(names.hy);
      display.ru.push(names.ru);
      display.en.push(names.en);

      privateRows.push({
        posterIngredientId: posterIngredientId ?? null,
        sourceName,
        sourceLanguage: catalog?.sourceLanguage || null,
        catalogDocId: catalog?.catalogDocId || null,
        canonicalId: trusted ? catalog?.canonicalId || null : null,
        names,
        mappingTrusted: trusted,
        sourceValidation: catalog?.sourceValidation || null,
        foodCategory: trusted ? catalog?.foodCategory || null : null,
        isPreparedComponent: trusted && catalog?.isPreparedComponent === true,
        analysisStatus: trusted ? catalog?.analysisStatus || 'trusted' : 'poster_source_only',
        catalogAllergenCandidates: trusted && Array.isArray(catalog?.allergenCandidates) ? catalog.allergenCandidates : [],
        rawAllergenIds: directAllergenIds(sourceName),
        unit: clean(row?.unit),
        brutto: number(row?.brutto),
        netto: number(row?.netto),
        locked: row?.locked === true
      });
    }

    const publicAllergens = buildPublicAllergens(privateRows, product.allergens);
    const suggestedCount = publicAllergens.filter((item) => item.status === 'suggested').length;
    if (publicAllergens.length) productsWithAllergens += 1;
    suggestedAllergenLinks += suggestedCount;
    for (const item of publicAllergens) allergenProductCounts.set(item.id, (allergenProductCounts.get(item.id) || 0) + 1);

    const trustedForProduct = privateRows.filter((item) => item.mappingTrusted).length;
    const coverage = recipe.length ? trustedForProduct / recipe.length : 1;

    // Private derived analysis only. posterRecipeIngredients on the product document is never modified here.
    writes.push({
      ref: restaurantRef.collection('product_analysis').doc(doc.id),
      data: {
        productId: product.posterProductId ?? product.id ?? doc.id,
        recipeSource: 'poster_tech_card_read_only',
        normalizedIngredients: privateRows,
        recipeRows: recipe.length,
        trustedRows: trustedForProduct,
        sourceTruthFallbackRows: recipe.length - trustedForProduct,
        normalizationCoverage: coverage,
        needsReview: privateRows.some((item) => !item.mappingTrusted || item.analysisStatus === 'needs_review'),
        publicAllergenIds: publicAllergens.map((item) => item.id),
        updatedAt: FieldValue.serverTimestamp()
      }
    });

    // Public composition preserves the Poster ingredient list. Translation is used only for validated mappings.
    // No ingredients are added, removed, or written back to Poster.
    writes.push({
      ref: doc.ref,
      data: {
        ingredients: {
          hy: dedupe(display.hy),
          ru: dedupe(display.ru),
          en: dedupe(display.en)
        },
        allergens: publicAllergens,
        ingredientSource: 'poster_tech_card_read_only',
        allergenAnalysis: {
          source: 'poster_source_plus_validated_rules',
          status: suggestedCount ? 'needs_restaurant_confirmation' : 'no_candidate_detected',
          suggestedCount,
          updatedAt: FieldValue.serverTimestamp()
        },
        ingredientNormalization: {
          recipeRows: recipe.length,
          trustedRows: trustedForProduct,
          sourceTruthFallbackRows: recipe.length - trustedForProduct,
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
      trustedRows,
      sourceTruthFallbackRows,
      productsWithAllergens,
      suggestedAllergenLinks,
      allergenProductCounts: Object.fromEntries([...allergenProductCounts.entries()].sort()),
      sourcePolicy: 'poster_tech_card_read_only',
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Product enrichment] Restaurant: ${restaurantId}`);
  console.log(`[Product enrichment] Active products: ${products}`);
  console.log(`[Product enrichment] Poster recipe rows read: ${recipeRows}`);
  console.log(`[Product enrichment] Trusted mapped rows: ${trustedRows}`);
  console.log(`[Product enrichment] Raw Poster fallback rows: ${sourceTruthFallbackRows}`);
  console.log(`[Product enrichment] Products with allergen candidates: ${productsWithAllergens}/${products}`);
  console.log(`[Product enrichment] Suggested allergen links: ${suggestedAllergenLinks}`);
  console.log(`[Product enrichment] Allergen product counts: ${JSON.stringify(Object.fromEntries([...allergenProductCounts.entries()].sort()))}`);
  console.log('[Product enrichment] Poster tech cards were READ ONLY; no recipe composition was changed.');
}

main().catch((error) => {
  console.error(`[Product enrichment] FAILED: ${error?.message || error}`);
  process.exit(1);
});
