const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
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
  const products = await restaurantRef.collection('products').get();
  const writes = [];
  let reviewedProducts = 0;
  let confirmedLinks = 0;
  let rejectedLinks = 0;

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
    writes.push({
      ref: snapshot.ref,
      data: {
        allergens,
        allergenAnalysis: {
          source: 'poster_source_plus_validated_rules_plus_restaurant_review',
          status: suggestedCount ? 'needs_restaurant_confirmation' : 'restaurant_review_applied',
          suggestedCount,
          updatedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
  }

  await commit(writes);
  console.log(`[Admin reviews] Restaurant: ${restaurantId}`);
  console.log(`[Admin reviews] Reviewed products reapplied: ${reviewedProducts}`);
  console.log(`[Admin reviews] Confirmed allergen links: ${confirmedLinks}`);
  console.log(`[Admin reviews] Rejected allergen links: ${rejectedLinks}`);
  console.log('[Admin reviews] Poster tech cards were not modified.');
}

main().catch((error) => {
  console.error(`[Admin reviews] FAILED: ${error?.message || error}`);
  process.exit(1);
});
