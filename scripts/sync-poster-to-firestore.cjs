const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const PROJECT_ID = 'cia-smart-menu';
const requiredEnv = (name) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; };
const firebaseServiceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const posterToken = requiredEnv('POSTER_ACCESS_TOKEN');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const restaurantName = (process.env.CIA_RESTAURANT_NAME || 'Poster Restaurant').trim();
const requestedSpotId = (process.env.POSTER_SPOT_ID || '').trim();
const syncRecipes = String(process.env.POSTER_SYNC_RECIPES || 'true').toLowerCase() !== 'false';
const publishMenu = String(process.env.CIA_PUBLISH_MENU || 'true').toLowerCase() !== 'false';
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(restaurantId)) throw new Error('CIA_RESTAURANT_ID must contain only letters, numbers, _ or -');
initializeApp({ credential: cert(firebaseServiceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const localized = (value) => { const text = String(value || '').trim(); return { ru: text, en: text, hy: text }; };
const toNumber = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
const posterPhotoUrl = (path) => { if (!path) return null; const text = String(path).trim(); if (!text) return null; return /^https?:\/\//i.test(text) ? text : `https://joinposter.com${text.startsWith('/') ? '' : '/'}${text}`; };

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`); url.searchParams.set('token', posterToken); url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu/1.0' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Poster ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) { const code = payload.error.code ?? payload.error.error_code ?? 'unknown'; const message = payload.error.message ?? payload.error.error_message ?? 'Poster API error'; throw new Error(`Poster ${method} error ${code}: ${message}`); }
  return payload?.response;
}

function normalizeCategory(raw, fallbackIndex = 0) {
  const id = String(raw?.menu_category_id ?? raw?.category_id ?? raw?.id ?? raw?.categoryId ?? '').trim();
  if (!id) return null;
  const name = raw?.category_name ?? raw?.menu_category_name ?? raw?.name ?? raw?.categoryName ?? `Category ${id}`;
  return { id, name: String(name), order: toNumber(raw?.sort_order ?? raw?.order, fallbackIndex + 1), active: String(raw?.hidden ?? '0') !== '1' };
}
function deriveCategoriesFromProducts(products) {
  const seen = new Map(); products.forEach((product, index) => { const category = normalizeCategory({ menu_category_id: product?.menu_category_id, category_name: product?.category_name, sort_order: index + 1 }, index); if (category && !seen.has(category.id)) seen.set(category.id, category); }); return [...seen.values()];
}
function detectSpotId(products) {
  if (requestedSpotId) return requestedSpotId;
  for (const product of products) { const spots = Array.isArray(product?.spots) ? product.spots : []; const visible = spots.find((spot) => String(spot?.visible ?? '1') !== '0' && spot?.spot_id != null); if (visible) return String(visible.spot_id); const first = spots.find((spot) => spot?.spot_id != null); if (first) return String(first.spot_id); }
  return '';
}
function chooseSpot(product, effectiveSpotId) {
  const spots = Array.isArray(product?.spots) ? product.spots : [];
  if (effectiveSpotId) { const exact = spots.find((spot) => String(spot?.spot_id) === effectiveSpotId); if (exact) return exact; }
  return spots.find((spot) => String(spot?.visible ?? '1') !== '0') || spots[0] || null;
}
async function mapWithConcurrency(items, limit, worker) {
  const result = new Array(items.length); let cursor = 0;
  async function run() { while (true) { const index = cursor++; if (index >= items.length) return; result[index] = await worker(items[index], index); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run)); return result;
}
async function loadProductDetails(products) {
  if (!syncRecipes) return new Map();
  console.log(`[Poster sync] Loading ${products.length} product recipes with concurrency 4...`);
  const details = await mapWithConcurrency(products, 4, async (product) => {
    const productId = product?.product_id ?? product?.id; if (!productId) return null;
    try { return await posterRequest('menu.getProduct', { product_id: productId }); }
    catch (error) { console.warn(`[Poster sync] Recipe ${productId} skipped: ${error.message}`); return null; }
  });
  const map = new Map(); details.forEach((detail) => { const id = detail?.product_id ?? detail?.id; if (id != null) map.set(String(id), detail); }); return map;
}
function isRetryableFirestoreError(error) { return ['8','10','13','14'].includes(String(error?.code ?? '')) || /RESOURCE_EXHAUSTED|ABORTED|UNAVAILABLE|DEADLINE_EXCEEDED/i.test(String(error?.message || '')); }
async function commitWrites(writes) {
  const chunkSize = 300;
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize); let attempt = 0;
    while (true) {
      try { const batch = db.batch(); chunk.forEach((write) => { if (write.type === 'set') batch.set(write.ref, write.data, write.options || {}); else batch.update(write.ref, write.data); }); await batch.commit(); break; }
      catch (error) { attempt += 1; if (!isRetryableFirestoreError(error) || attempt > 4) throw error; const delay = Math.min(8000, 500 * (2 ** (attempt - 1))); console.warn(`[Poster sync] Firestore transient error; retry ${attempt}/4 in ${delay}ms: ${error.message}`); await new Promise((resolve) => setTimeout(resolve, delay)); }
    }
  }
}

async function sync() {
  console.log(`[Poster sync] Starting restaurant=${restaurantId} spot=${requestedSpotId || 'auto'} recipes=${syncRecipes}`);
  const [productResult, categoryResult] = await Promise.allSettled([posterRequest('menu.getProducts'), posterRequest('menu.getCategories')]);
  if (productResult.status !== 'fulfilled') throw productResult.reason;
  const posterProducts = Array.isArray(productResult.value) ? productResult.value : [];
  if (!posterProducts.length) throw new Error('Poster menu.getProducts returned no products');
  const effectiveSpotId = detectSpotId(posterProducts); console.log(`[Poster sync] Using spot=${effectiveSpotId || 'none detected'}`);
  let posterCategories = categoryResult.status === 'fulfilled' && Array.isArray(categoryResult.value) ? categoryResult.value.map(normalizeCategory).filter(Boolean) : [];
  if (!posterCategories.length) posterCategories = deriveCategoriesFromProducts(posterProducts);
  const detailByProductId = await loadProductDetails(posterProducts);

  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const writes = []; const now = FieldValue.serverTimestamp();
  writes.push({ type: 'set', ref: restaurantRef, data: { id: restaurantId, type: 'restaurant', name: localized(restaurantName), meta: localized('Poster POS • Smart Menu'), published: publishMenu, source: 'poster', posterSpotId: effectiveSpotId || null, posterSyncRecipes: syncRecipes, posterLastSyncAt: now, updatedAt: now }, options: { merge: true } });
  writes.push({ type: 'set', ref: restaurantRef.collection('categories').doc('all'), data: { id: 'all', name: { ru: 'Все', en: 'All', hy: 'Բոլորը' }, order: 0, active: true, source: 'cia' }, options: { merge: true } });
  posterCategories.forEach((category, index) => writes.push({ type: 'set', ref: restaurantRef.collection('categories').doc(category.id), data: { id: category.id, name: localized(category.name), order: category.order || index + 1, active: category.active !== false, source: 'poster', posterCategoryId: category.id, updatedAt: now }, options: { merge: true } }));

  const currentPosterIds = new Set(); let activeCount = 0;
  posterProducts.forEach((product, index) => {
    const rawId = product?.product_id ?? product?.id; if (rawId == null) return; const docId = String(rawId); currentPosterIds.add(docId);
    const detail = detailByProductId.get(docId) || {}; const mergedPoster = { ...product, ...detail }; const spot = chooseSpot(mergedPoster, effectiveSpotId);
    const categoryId = String(mergedPoster?.menu_category_id ?? product?.menu_category_id ?? '0'); const hidden = String(mergedPoster?.hidden ?? product?.hidden ?? '0') === '1'; const visibleAtSpot = !spot || String(spot?.visible ?? '1') !== '0'; const active = !hidden && visibleAtSpot; if (active) activeCount += 1;
    const rawPrice = spot?.price ?? mergedPoster?.price ?? product?.price ?? 0; const price = toNumber(rawPrice) / 100; const photoPath = mergedPoster?.photo_origin || mergedPoster?.photo || product?.photo_origin || product?.photo || null;
    const recipeIngredients = Array.isArray(detail?.ingredients) ? detail.ingredients : []; const ingredientNames = recipeIngredients.map((ingredient) => String(ingredient?.ingredient_name || '').trim()).filter(Boolean); const productionDescription = String(detail?.product_production_description || '').trim();
    writes.push({ type: 'set', ref: restaurantRef.collection('products').doc(docId), data: {
      id: toNumber(rawId, rawId), posterProductId: toNumber(rawId, rawId), source: 'poster', active, category: categoryId,
      name: localized(mergedPoster?.product_name || product?.product_name || `Product ${docId}`), description: localized(productionDescription),
      ingredients: ingredientNames.length ? { ru: ingredientNames, en: ingredientNames, hy: ingredientNames } : { ru: [], en: [], hy: [] }, allergens: [], emoji: '🍽️', image: posterPhotoUrl(photoPath), price,
      sortOrder: toNumber(mergedPoster?.sort_order ?? product?.sort_order, index), posterCategoryId: categoryId, posterWorkshopId: mergedPoster?.workshop ?? product?.workshop ?? null, posterType: mergedPoster?.type ?? product?.type ?? null,
      posterSpotId: (spot?.spot_id ?? effectiveSpotId) || null, posterVisibleAtSpot: visibleAtSpot, posterPriceMinor: toNumber(rawPrice), posterPhotoPath: photoPath,
      posterRecipeIngredients: recipeIngredients.map((ingredient) => ({ ingredientId: ingredient?.ingredient_id ?? null, name: ingredient?.ingredient_name ?? '', unit: ingredient?.structure_unit ?? ingredient?.ingredient_unit ?? '', brutto: toNumber(ingredient?.structure_brutto), netto: toNumber(ingredient?.structure_netto), locked: String(ingredient?.structure_lock ?? '0') === '1' })), posterLastSyncAt: now, updatedAt: now
    }, options: { merge: true } });
  });
  console.log(`[Poster sync] Prepared ${writes.length} Firestore writes without reading the full existing product catalog.`);
  await commitWrites(writes);
  console.log(`[Poster sync] Success: ${posterProducts.length} products, ${activeCount} active, ${posterCategories.length} categories.`);
  console.log(`[Poster sync] Open menu with ?restaurant=${encodeURIComponent(restaurantId)}`);
}
sync().catch((error) => { const safeMessage = String(error?.message || error).replaceAll(posterToken, '[REDACTED_POSTER_TOKEN]').replace(/token=[^&\s]+/gi, 'token=[REDACTED]'); console.error(`[Poster sync] FAILED: ${safeMessage}`); process.exit(1); });
