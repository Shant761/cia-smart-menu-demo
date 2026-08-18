const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const productId = String(process.env.CIA_PRODUCT_ID || '104').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const [productSnap, analysisSnap] = await Promise.all([
    restaurantRef.collection('products').doc(productId).get(),
    restaurantRef.collection('product_analysis').doc(productId).get()
  ]);

  if (!productSnap.exists) throw new Error(`Product ${productId} not found`);
  const p = productSnap.data();
  const a = analysisSnap.exists ? analysisSnap.data() : {};

  console.log(`PRODUCT\t${productId}\t${p?.name?.hy || p?.name?.ru || ''}`);
  console.log('RAW_POSTER_RECIPE');
  for (const row of Array.isArray(p.posterRecipeIngredients) ? p.posterRecipeIngredients : []) {
    console.log(`${row.ingredientId ?? ''}\t${String(row.name || '').replace(/[\t\r\n]+/g,' ').trim()}`);
  }
  console.log('NORMALIZED');
  for (const row of Array.isArray(a.normalizedIngredients) ? a.normalizedIngredients : []) {
    console.log(`${row.posterIngredientId ?? ''}\t${row.sourceName || ''}\t${row.canonicalId || ''}\t${row?.names?.ru || ''}`);
  }
}

main().catch((error) => {
  console.error(`FAILED\t${error?.message || error}`);
  process.exit(1);
});
