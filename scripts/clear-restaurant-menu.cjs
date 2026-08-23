const admin = require('firebase-admin');

const restaurantId = process.argv[2] || 'ciasift';
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountRaw) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT');
}

const serviceAccount = JSON.parse(serviceAccountRaw);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function deleteCollection(path) {
  const ref = db.collection(path);
  let total = 0;
  while (true) {
    const snap = await ref.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    total += snap.size;
    console.log(`Deleted ${snap.size} from ${path}`);
    if (snap.size < 400) break;
  }
  return total;
}

(async () => {
  if (!/^[a-z0-9_-]+$/i.test(restaurantId)) throw new Error(`Invalid restaurant id: ${restaurantId}`);
  const products = await deleteCollection(`restaurants/${restaurantId}/products`);
  const categories = await deleteCollection(`restaurants/${restaurantId}/categories`);
  console.log(JSON.stringify({ ok: true, restaurantId, productsDeleted: products, categoriesDeleted: categories }));
  await admin.app().delete();
})().catch(async (err) => {
  console.error(err);
  try { await admin.app().delete(); } catch {}
  process.exit(1);
});
