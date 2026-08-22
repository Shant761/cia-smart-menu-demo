const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const DATA_DIR = path.join(process.cwd(), 'data');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const clean = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const sourceKey = (value) => clean(value).toLocaleLowerCase('und').replace(/[«»“”]/g, '"').replace(/[–—−]/g, '-');
const hash = (value) => crypto.createHash('sha256').update(clean(value), 'utf8').digest('hex');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(label, fn, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      const retryable = /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|429|quota exceeded/i.test(message);
      if (!retryable || attempt === attempts) throw error;
      const delay = Math.min(30000, 1500 * (2 ** (attempt - 1)));
      console.warn(`[Product translations] ${label} retry ${attempt}/${attempts - 1} after ${delay}ms: ${message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function loadPacks() {
  const safeId = restaurantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${safeId}-product-translations(?:-v(\\d+))?\\.json$`);
  const files = fs.readdirSync(DATA_DIR)
    .map((name) => {
      const match = name.match(re);
      if (!match) return null;
      return { name, order: match[1] ? Number(match[1]) : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const entries = {};
  let version = 0;
  for (const file of files) {
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file.name), 'utf8'));
    version = Math.max(version, Number(config.version || file.order || 1));
    for (const [id, value] of Object.entries(config.products || {})) entries[String(id)] = value;
  }
  return { files: files.map((f) => f.name), entries, version };
}

async function commitWrites(writes) {
  // Smaller batches plus retry/backoff reduce burst pressure on Firestore.
  for (let offset = 0; offset < writes.length; offset += 100) {
    const chunk = writes.slice(offset, offset + 100);
    await withRetry(`write batch ${Math.floor(offset / 100) + 1}`, async () => {
      const batch = db.batch();
      for (const write of chunk) batch.set(write.ref, write.data, { merge: true });
      await batch.commit();
    });
    if (offset + 100 < writes.length) await sleep(500);
  }
}

async function main() {
  const { files, entries, version } = loadPacks();
  if (!files.length) {
    console.log(`[Product translations] No translation packs for ${restaurantId}; skipped.`);
    return;
  }

  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const restaurantSnapshot = await withRetry('restaurant read', () => restaurantRef.get());
  if (!restaurantSnapshot.exists) throw new Error(`Restaurant ${restaurantId} not found`);

  // Read products in pages instead of one large burst.
  const products = [];
  const productEntries = [...Object.entries(entries)];
  for (let offset = 0; offset < productEntries.length; offset += 100) {
    const ids = productEntries.slice(offset, offset + 100).map(([id]) => String(id));
    const snapshots = await withRetry(`product page ${Math.floor(offset / 100) + 1}`, () =>
      Promise.all(ids.map((id) => restaurantRef.collection('products').doc(id).get()))
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists) products.push(snapshot);
    }
    if (offset + 100 < productEntries.length) await sleep(500);
  }

  const byId = new Map(products.map((doc) => [String(doc.id), { ref: doc.ref, ...doc.data() }]));
  const writes = [];
  let applied = 0;
  let skippedUnchanged = 0;
  let missing = 0;
  let sourceMismatch = 0;
  let needsReview = 0;

  for (const [id, rule] of productEntries) {
    const product = byId.get(String(id));
    if (!product) {
      missing += 1;
      continue;
    }

    const currentName = clean(product?.posterOriginalName || product?.name?.hy || product?.name?.ru || product?.name?.en || product?.name);
    const configuredHy = clean(rule.hy);
    const matchedByConfiguredSource = !configuredHy || sourceKey(currentName) === sourceKey(configuredHy);
    if (!matchedByConfiguredSource) sourceMismatch += 1;

    const ru = clean(rule.ru);
    const en = clean(rule.en);
    const hy = configuredHy || currentName;
    if (!ru || !en || !hy) continue;
    if (rule.needsReview === true) needsReview += 1;

    const existingName = product.name || {};
    const existingTranslation = product.titleTranslation || {};
    const unchanged = existingName.hy === hy &&
      existingName.ru === ru &&
      existingName.en === en &&
      existingTranslation.version === version &&
      existingTranslation.sourceHash === hash(currentName) &&
      existingTranslation.needsReview === (rule.needsReview === true);

    if (unchanged) {
      skippedUnchanged += 1;
      continue;
    }

    writes.push({
      ref: product.ref,
      data: {
        name: { hy, ru, en },
        posterOriginalName: currentName,
        titleTranslation: {
          version,
          sourceLanguage: 'hy',
          sourceText: currentName,
          configuredSourceText: configuredHy || null,
          sourceHash: hash(currentName),
          method: 'curated_without_external_api',
          matchedBy: 'poster_product_id',
          sourceNameMatch: matchedByConfiguredSource,
          needsReview: rule.needsReview === true,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
    applied += 1;
  }

  await commitWrites(writes);
  await withRetry('restaurant summary write', () => restaurantRef.set({
    productTitleTranslations: {
      version,
      packs: files,
      configured: Object.keys(entries).length,
      applied,
      skippedUnchanged,
      missing,
      sourceMismatch,
      needsReview,
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }));

  console.log(`[Product translations] Restaurant: ${restaurantId}`);
  console.log(`[Product translations] Packs: ${files.join(', ')}`);
  console.log(`[Product translations] Configured: ${Object.keys(entries).length}`);
  console.log(`[Product translations] Applied by product ID: ${applied}`);
  console.log(`[Product translations] Skipped unchanged: ${skippedUnchanged}`);
  console.log(`[Product translations] Source-name mismatches allowed: ${sourceMismatch}`);
  console.log(`[Product translations] Needs review: ${needsReview}`);
  console.log(`[Product translations] Missing products: ${missing}`);
}

main().catch((error) => {
  console.error(`[Product translations] FAILED: ${error?.message || error}`);
  process.exit(1);
});
