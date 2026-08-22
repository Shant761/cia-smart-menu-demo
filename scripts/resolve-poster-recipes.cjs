const crypto = require('node:crypto');
const { cert, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { resolveRecipe } = require('./recipe-resolver.cjs');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const PROJECT_ID = 'cia-smart-menu';
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const firebaseServiceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const posterToken = requiredEnv('POSTER_ACCESS_TOKEN');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const maxDepth = Number(process.env.POSTER_RECIPE_MAX_DEPTH || 12);

initializeApp({ credential: cert(firebaseServiceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const normalize = (value) => String(value || '').toLocaleLowerCase('und').normalize('NFKC').replace(/[.,;:()\[\]{}'"`]/g, ' ').replace(/\s+/g, ' ').trim();
const stable = (value) => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const hash = (value) => crypto.createHash('sha256').update(stable(value), 'utf8').digest('hex');

const ALLERGEN_RULES = [
  { id: 'milk', words: ['молок', 'milk', 'молоч', 'сливк', 'cream', 'butter', 'масл', 'сыр', 'cheese', 'йогурт', 'yogurt', 'кефир', 'կաթ', 'պանիր', 'կարագ', 'սերուցք'] },
  { id: 'egg', words: ['яйц', 'egg', 'eggs', 'майонез', 'mayonnaise', 'meringue', 'безе', 'ձու', 'մայոնեզ'] },
  { id: 'gluten', words: ['глютен', 'gluten', 'мук', 'flour', 'мука', 'хлеб', 'bread', 'булоч', 'bun', 'пшен', 'wheat', 'лаваш', 'lavash', 'макарон', 'pasta', 'спагетти', 'croissant', 'круассан', 'ցորեն', 'ալյուր', 'հաց', 'մակարոն'] },
  { id: 'peanut', words: ['арахис', 'peanut', 'գետնանուշ'] },
  { id: 'nuts', words: ['орех', 'nut', 'almond', 'миндаль', 'walnut', 'грецк', 'hazelnut', 'фундук', 'pistachio', 'фисташ', 'cashew', 'кешью', 'pecan', 'пекан', 'բադամ', 'ընկույզ', 'պիստակ', 'քեշյու'] },
  { id: 'soy', words: ['соя', 'soy', 'соев', 'soybean', 'սոյա'] },
  { id: 'fish', words: ['рыб', 'fish', 'лосос', 'salmon', 'тунец', 'tuna', 'форел', 'trout', 'скумбр', 'mackerel', 'ձուկ', 'սաղմոն'] },
  { id: 'crustaceans', words: ['кревет', 'shrimp', 'prawn', 'краб', 'crab', 'лобстер', 'lobster', 'рак', 'crustacean', 'ծովախեցգետին'] },
  { id: 'molluscs', words: ['моллюск', 'mollusc', 'mussel', 'мид', 'устриц', 'oyster', 'кальмар', 'squid', 'осьминог', 'octopus', 'clam', 'ракуш', 'մոլյուսկ', 'կաղամար'] },
  { id: 'sesame', words: ['кунжут', 'sesame', 'թահին', 'տահին', 'քունջութ'] },
  { id: 'mustard', words: ['горчиц', 'mustard', 'մանանեխ'] },
  { id: 'celery', words: ['сельдер', 'celery', 'նեխուր'] },
  { id: 'sulphites', words: ['сульфит', 'sulphite', 'sulfite', 'sulfur dioxide', 'диоксид серы', 'метабисульфит', 'մետաբիսուլֆիտ'] },
  { id: 'lupin', words: ['люпин', 'lupin', 'լյուպին'] }
];

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', posterToken);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu/1.0' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Poster ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`Poster ${method} error ${payload.error.code ?? payload.error.error_code ?? 'unknown'}: ${payload.error.message ?? payload.error.error_message ?? 'Poster API error'}`);
  return payload?.response;
}

function findAllergens(ingredients) {
  const found = new Map();
  for (const ingredient of ingredients || []) {
    const name = normalize(ingredient?.name || ingredient?.ingredient_name || ingredient?.preparation_name);
    if (!name) continue;
    for (const rule of ALLERGEN_RULES) if (rule.words.some((word) => name.includes(normalize(word)))) found.set(rule.id, { id: rule.id, status: 'suggested', source: 'expanded_recipe_name' });
  }
  return [...found.values()];
}

function hasIngredients(payload) { return Array.isArray(payload?.ingredients) && payload.ingredients.length > 0; }

async function loadPreparation(component) {
  const raw = component?.raw || {};
  const preparationId = String(raw.preparation_id ?? raw.preparationId ?? raw.prep_id ?? raw.prepId ?? component.id ?? '').trim();
  if (!preparationId) return null;
  const attempts = [['menu.getPreparation', { preparation_id: preparationId }], ['menu.getProduct', { product_id: preparationId }]];
  const errors = [];
  for (const [method, params] of attempts) {
    try {
      const result = await posterRequest(method, params);
      if (hasIngredients(result)) return result;
      if (result && Array.isArray(result?.recipe)) return { ...result, ingredients: result.recipe };
    } catch (error) { errors.push(`${method}: ${error.message}`); }
  }
  const error = new Error(`Preparation ${preparationId} could not be resolved${errors.length ? ` (${errors.join(' | ')})` : ''}`);
  error.preparationId = preparationId;
  throw error;
}

function toRecipeData(resolved, sourceDetail) {
  const allergens = findAllergens(resolved.expandedIngredients);
  return {
    directIngredients: resolved.directIngredients.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit })),
    directPreparations: resolved.directPreparations.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit })),
    expandedIngredients: resolved.expandedIngredients,
    preparations: resolved.preparations.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, path: item.path, status: item.status })),
    warnings: resolved.warnings,
    stats: resolved.stats,
    allergens,
    source: 'poster',
    sourceProductId: sourceDetail?.product_id ?? sourceDetail?.id ?? null
  };
}

function isQuotaError(error) { return /RESOURCE_EXHAUSTED|quota exceeded|daily limit|too many requests/i.test(String(error?.message || '')); }

async function commitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 200) {
    try {
      const batch = db.batch();
      for (const write of writes.slice(offset, offset + 200)) batch.set(write.ref, write.data, { merge: true });
      await batch.commit();
    } catch (error) {
      if (isQuotaError(error)) throw new Error(`Firestore quota exceeded; stopping immediately instead of retrying. ${error.message}`);
      throw error;
    }
  }
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const snapshot = await restaurantRef.collection('products').where('source', '==', 'poster').get();
  console.log(`[Recipe resolver] restaurant=${restaurantId}, products=${snapshot.size}, maxDepth=${maxDepth}`);

  const writes = [];
  let resolvedCount = 0;
  let issueCount = 0;
  let skipped = 0;
  let errors = 0;

  for (const productDoc of snapshot.docs) {
    const product = productDoc.data();
    const productId = product?.posterProductId ?? productDoc.id;
    let detail;
    try { detail = await posterRequest('menu.getProduct', { product_id: productId }); }
    catch (error) {
      errors += 1;
      const issue = { hasIssues: true, severity: 'error', count: 1, issues: [{ type: 'product_recipe_load_error', message: error.message }], source: 'poster' };
      const owned = { recipeIssues: issue, recipeResolverHash: hash({ productId, error: error.message }) };
      if (hash({ recipeIssues: product.recipeIssues, recipeResolverHash: product.recipeResolverHash }) === hash(owned)) { skipped += 1; continue; }
      writes.push({ ref: productDoc.ref, data: { ...owned, updatedAt: FieldValue.serverTimestamp() } });
      continue;
    }

    const sourceIngredients = Array.isArray(detail?.ingredients) ? detail.ingredients : [];
    const resolved = await resolveRecipe({ ingredients: sourceIngredients }, loadPreparation, { maxDepth });
    const recipe = toRecipeData(resolved, detail);
    const issues = resolved.warnings || [];
    const severity = issues.length ? 'warning' : 'ok';
    if (issues.length) issueCount += 1; else resolvedCount += 1;
    const resolverHash = hash({ productId: String(productId), sourceIngredients, recipe, issues, severity });

    if (product.recipeResolverHash === resolverHash) { skipped += 1; continue; }

    writes.push({
      ref: productDoc.ref,
      data: {
        recipe,
        recipeIssues: { hasIssues: issues.length > 0, severity, count: issues.length, issues, source: 'poster' },
        posterRecipeSource: { productId: String(productId), topLevelKeys: Object.keys(detail || {}), ingredients: sourceIngredients.map((item) => ({ ...item })) },
        allergens: recipe.allergens,
        recipeResolverHash: resolverHash,
        updatedAt: FieldValue.serverTimestamp()
      }
    });
  }

  await commitWrites(writes);
  console.log(`[Recipe resolver] resolved=${resolvedCount}, productsWithIssues=${issueCount}, errors=${errors}`);
  console.log(`[Recipe resolver] skipped unchanged=${skipped}`);
  console.log(`[Recipe resolver] Firestore writes to commit=${writes.length}`);
}

main().catch((error) => {
  const safeMessage = String(error?.message || error).replaceAll(posterToken, '[REDACTED_POSTER_TOKEN]');
  console.error(`[Recipe resolver] FAILED: ${safeMessage}`);
  process.exit(1);
});