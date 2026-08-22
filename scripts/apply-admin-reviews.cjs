const crypto = require('node:crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))]; }
function stable(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function hash(value) { return crypto.createHash('sha256').update(stable(value), 'utf8').digest('hex'); }
function isQuotaError(error) { return /RESOURCE_EXHAUSTED|quota exceeded|daily limit|too many requests/i.test(String(error?.message || '')); }

async function commit(writes) {
  for (let offset = 0; offset < writes.length; offset += 350) {
    try {
      const batch = db.batch();
      for (const write of writes.slice(offset, offset + 350)) batch.set(write.ref, write.data, { merge: true });
      await batch.commit();
    } catch (error) {
      if (isQuotaError(error)) throw new Error(`Firestore quota exceeded; stopping immediately instead of retrying. ${error.message}`);
      throw error;
    }
  }
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const products = await restaurantRef.collection('products').get();
  const writes = [];
  let reviewedProducts = 0;
  let confirmedLinks = 0;
  let rejectedLinks = 0;
  let skipped = 0;

  for (const snapshot of products.docs) {
    const product = snapshot.data();
    if (product.source !== 'poster' || product.active === false) continue;
    const review = product.allergenReview;
    if (!review || (!Array.isArray(review.confirmed) && !Array.isArray(review.rejected))) continue;

    reviewedProducts += 1;
    const confirmed = new Set(unique(review.confirmed));
    const rejected = new Set(unique(review.rejected));
    confirmedLinks += confirmed.size;
    rejectedLinks += rejected.size;

    const byId = new Map();
    for (const item of Array.isArray(product.allergens) ? product.allergens : []) {
      const id = String(item?.id || '').trim();
      if (!id || rejected.has(id)) continue;
      byId.set(id, confirmed.has(id)
        ? { ...item, id, status: 'confirmed', source: 'restaurant_review', restaurantVerified: true }
        : item);
    }
    for (const id of confirmed) {
      if (rejected.has(id)) continue;
      if (!byId.has(id)) byId.set(id, { id, status: 'confirmed', source: 'restaurant_review', restaurantVerified: true });
    }

    const allergens = [...byId.values()];
    const suggestedCount = allergens.filter((item) => item.status !== 'confirmed').length;
    const reviewHash = hash({ confirmed: [...confirmed].sort(), rejected: [...rejected].sort(), allergens, suggestedCount });
    if (product.allergenReviewAppliedHash === reviewHash) { skipped += 1; continue; }

    writes.push({ ref: snapshot.ref, data: {
      allergens,
      allergenAnalysis: {
        source: 'poster_source_plus_validated_rules_plus_restaurant_review',
        status: suggestedCount ? 'needs_restaurant_confirmation' : 'restaurant_review_applied',
        suggestedCount
      },
      allergenReviewAppliedHash: reviewHash,
      updatedAt: FieldValue.serverTimestamp()
    }});
  }

  await commit(writes);
  console.log(`[Admin reviews] Restaurant: ${restaurantId}`);
  console.log(`[Admin reviews] Reviewed products reapplied: ${reviewedProducts}`);
  console.log(`[Admin reviews] Confirmed allergen links: ${confirmedLinks}`);
  console.log(`[Admin reviews] Rejected allergen links: ${rejectedLinks}`);
  console.log(`[Admin reviews] Skipped unchanged: ${skipped}`);
  console.log(`[Admin reviews] Firestore writes to commit: ${writes.length}`);
  console.log('[Admin reviews] Poster tech cards were not modified.');
}

main().catch((error) => {
  console.error(`[Admin reviews] FAILED: ${error?.message || error}`);
  process.exit(1);
});