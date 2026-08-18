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

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const hash = (value) => crypto.createHash('sha256').update(clean(value), 'utf8').digest('hex');

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
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }
}

async function main() {
  const { files, entries, version } = loadPacks();
  if (!files.length) throw new Error(`No translation packs found for ${restaurantId}`);

  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} not found`);

  const products = await restaurantRef.collection('products').get();
  const byId = new Map(products.docs.map((doc) => [String(doc.id), { ref: doc.ref, ...doc.data() }]));
  const writes = [];
  let applied = 0;
  let missing = 0;
  let stale = 0;
  let needsReview = 0;

  for (const [id, rule] of Object.entries(entries)) {
    const product = byId.get(String(id));
    if (!product) {
      missing += 1;
      continue;
    }

    const currentHy = clean(product?.name?.hy || product?.name?.ru || product?.name?.en || product?.name);
    const sourceHy = clean(rule.hy);
    if (!currentHy || !sourceHy || currentHy !== sourceHy) {
      stale += 1;
      continue;
    }

    const ru = clean(rule.ru);
    const en = clean(rule.en);
    if (!ru || !en) continue;
    if (rule.needsReview === true) needsReview += 1;

    writes.push({
      ref: product.ref,
      data: {
        name: { hy: currentHy, ru, en },
        posterOriginalName: currentHy,
        titleTranslation: {
          version,
          sourceLanguage: 'hy',
          sourceText: currentHy,
          sourceHash: hash(currentHy),
          method: 'curated_without_external_api',
          needsReview: rule.needsReview === true,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
    applied += 1;
  }

  await commitWrites(writes);
  await restaurantRef.set({
    productTitleTranslations: {
      version,
      packs: files,
      configured: Object.keys(entries).length,
      applied,
      missing,
      stale,
      needsReview,
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Product translations] Restaurant: ${restaurantId}`);
  console.log(`[Product translations] Packs: ${files.join(', ')}`);
  console.log(`[Product translations] Configured: ${Object.keys(entries).length}`);
  console.log(`[Product translations] Applied: ${applied}`);
  console.log(`[Product translations] Needs review: ${needsReview}`);
  console.log(`[Product translations] Missing products: ${missing}`);
  console.log(`[Product translations] Stale source names skipped: ${stale}`);
}

main().catch((error) => {
  console.error(`[Product translations] FAILED: ${error?.message || error}`);
  process.exit(1);
});
