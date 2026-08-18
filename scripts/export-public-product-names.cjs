const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

function pickOriginalName(product) {
  const name = product?.name;
  if (name && typeof name === 'object') {
    return String(name.hy || name.ru || name.en || '').trim();
  }
  return String(name || '').trim();
}

async function main() {
  const snapshot = await db.collection('restaurants').doc(restaurantId).collection('products').get();
  const rows = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => item.source === 'poster' && item.active !== false)
    .map((item) => ({ id: String(item.posterProductId ?? item.id), hy: pickOriginalName(item) }))
    .filter((item) => item.hy)
    .sort((a, b) => Number(a.id) - Number(b.id));

  console.log(`COUNT\t${rows.length}`);
  for (const row of rows) {
    const safe = row.hy.replace(/[\t\r\n]+/g, ' ').trim();
    console.log(`${row.id}\t${safe}`);
  }
}

main().catch((error) => {
  console.error(`FAILED\t${error?.message || error}`);
  process.exit(1);
});
