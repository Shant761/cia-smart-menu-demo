const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const PROJECT_ID = 'cia-smart-menu';
const DATA_DIR = path.join(process.cwd(), 'data');

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const posterToken = requiredEnv('POSTER_ACCESS_TOKEN');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const clean = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const localized = (value) => ({ hy: clean(value), ru: clean(value), en: clean(value) });

function isQuotaError(error) {
  return /RESOURCE_EXHAUSTED|quota exceeded|quotaexceeded|daily limit|too many requests/i.test(String(error?.message || ''));
}

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function loadPack() {
  const file = path.join(DATA_DIR, `${restaurantId}-category-translations.json`);
  if (!fs.existsSync(file)) return { file: null, version: 0, categories: {} };
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.restaurantId && config.restaurantId !== restaurantId) {
    throw new Error(`Category translation pack restaurantId=${config.restaurantId} does not match ${restaurantId}`);
  }
  return { file: path.basename(file), version: Number(config.version || 1), categories: config.categories || {} };
}

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', posterToken);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu/1.0' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Poster ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) {
    const code = payload.error.code ?? payload.error.error_code ?? 'unknown';
    const message = payload.error.message ?? payload.error.error_message ?? 'Poster API error';
    throw new Error(`Poster ${method} error ${code}: ${message}`);
  }
  return payload?.response;
}

async function commitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) batch.set(write.ref, write.data, { merge: true });
    try {
      await batch.commit();
    } catch (error) {
      if (isQuotaError(error)) throw new Error(`Firestore quota exceeded; stopping immediately instead of retrying. ${error.message}`);
      throw error;
    }
  }
}

function sameCategoryFields(current, desired) {
  return hash({
    name: current?.name || null,
    posterOriginalName: current?.posterOriginalName || null,
    categoryTranslation: current?.categoryTranslation ? {
      version: current.categoryTranslation.version,
      sourceText: current.categoryTranslation.sourceText,
      sourceHash: current.categoryTranslation.sourceHash,
      status: current.categoryTranslation.status,
      method: current.categoryTranslation.method,
      needsReview: current.categoryTranslation.needsReview,
      expectedSourceText: current.categoryTranslation.expectedSourceText ?? null
    } : null
  }) === hash(desired);
}

async function main() {
  const pack = loadPack();
  if (!pack.file) {
    console.log(`[Category translations] No pack for ${restaurantId}; skipped.`);
    return;
  }

  const posterCategoriesRaw = await posterRequest('menu.getCategories');
  const posterCategories = new Map();
  for (const raw of Array.isArray(posterCategoriesRaw) ? posterCategoriesRaw : []) {
    const id = clean(raw?.menu_category_id ?? raw?.category_id ?? raw?.id ?? raw?.categoryId);
    const source = clean(raw?.category_name ?? raw?.menu_category_name ?? raw?.name ?? raw?.categoryName);
    if (id && source) posterCategories.set(id, source);
  }

  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} not found`);
  const snapshot = await restaurantRef.collection('categories').get();
  const byId = new Map(snapshot.docs.map((doc) => [String(doc.id), { ref: doc.ref, ...doc.data() }]));

  const writes = [];
  let applied = 0;
  let stale = 0;
  let missingFirestore = 0;
  let missingPoster = 0;
  let needsReview = 0;
  let skipped = 0;

  const queueIfChanged = (category, desired) => {
    if (sameCategoryFields(category, desired)) {
      skipped += 1;
      return;
    }
    writes.push({ ref: category.ref, data: desired });
  };

  for (const [id, rule] of Object.entries(pack.categories)) {
    const category = byId.get(String(id));
    if (!category) { missingFirestore += 1; continue; }

    const source = id === 'all' ? clean(rule.source || 'Բոլորը') : clean(posterCategories.get(String(id)));
    if (!source) { missingPoster += 1; continue; }

    const expected = clean(rule.source);
    const sourceMatches = Boolean(expected && source === expected);
    const displayName = sourceMatches ? { hy: clean(rule.hy), ru: clean(rule.ru), en: clean(rule.en) } : localized(source);

    if (sourceMatches && (!displayName.hy || !displayName.ru || !displayName.en)) throw new Error(`Category ${id} has incomplete translations`);

    if (sourceMatches) {
      applied += 1;
      if (rule.needsReview === true) needsReview += 1;
    } else stale += 1;

    const desired = {
      name: displayName,
      posterOriginalName: source,
      categoryTranslation: {
        version: pack.version,
        sourceText: source,
        sourceHash: hash(source),
        status: sourceMatches ? 'curated' : 'stale_source',
        method: sourceMatches ? 'curated_without_external_api' : 'poster_source_fallback',
        needsReview: sourceMatches && rule.needsReview === true,
        expectedSourceText: expected || null
      }
    };
    queueIfChanged(category, desired);
  }

  for (const [id, source] of posterCategories.entries()) {
    if (pack.categories[id] || !byId.has(id)) continue;
    const category = byId.get(id);
    queueIfChanged(category, {
      name: localized(source),
      posterOriginalName: source,
      categoryTranslation: {
        version: pack.version,
        sourceText: source,
        sourceHash: hash(source),
        status: 'missing_translation',
        method: 'poster_source_fallback',
        needsReview: true,
        expectedSourceText: null
      }
    });
  }

  await commitWrites(writes);

  const summary = {
    version: pack.version,
    pack: pack.file,
    configured: Object.keys(pack.categories).length,
    posterCategories: posterCategories.size,
    applied,
    stale,
    missingFirestore,
    missingPoster,
    needsReview,
    skipped
  };

  const restaurant = (await restaurantRef.get()).data() || {};
  const currentSummary = restaurant.categoryTranslations || {};
  const summaryChanged = hash(currentSummary) !== hash(summary);
  if (summaryChanged) await restaurantRef.set({ categoryTranslations: { ...summary, lastRunAt: new Date() } }, { merge: true });

  console.log(`[Category translations] Restaurant: ${restaurantId}`);
  console.log(`[Category translations] Pack: ${pack.file}`);
  console.log(`[Category translations] Poster categories: ${posterCategories.size}`);
  console.log(`[Category translations] Applied exact-source translations: ${applied}`);
  console.log(`[Category translations] Stale source fallbacks: ${stale}`);
  console.log(`[Category translations] Needs review: ${needsReview}`);
  console.log(`[Category translations] Missing Firestore categories: ${missingFirestore}`);
  console.log(`[Category translations] Missing Poster categories: ${missingPoster}`);
  console.log(`[Category translations] Skipped unchanged: ${skipped}`);
  console.log(`[Category translations] Firestore writes to commit: ${writes.length + (summaryChanged ? 1 : 0)}`);
  console.log('[Category translations] Poster category names were READ ONLY; no Poster data was modified.');
}

main().catch((error) => {
  const safeMessage = String(error?.message || error)
    .replaceAll(posterToken, '[REDACTED_POSTER_TOKEN]')
    .replace(/token=[^&\s]+/gi, 'token=[REDACTED]');
  console.error(`[Category translations] FAILED: ${safeMessage}`);
  process.exit(1);
});
