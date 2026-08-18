const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const projectId = 'cia-smart-menu';
const restaurantId = 'garden-table';
const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawCredentials) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT is required');
}

const credentials = JSON.parse(rawCredentials);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
  projectId
});

const db = admin.firestore();
const sourcePath = path.join(__dirname, '..', 'data', 'products.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

async function seed() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const batch = db.batch();

  batch.set(restaurantRef, {
    id: restaurantId,
    type: 'restaurant',
    name: source.restaurant.name,
    meta: source.restaurant.meta,
    published: true,
    source: 'demo',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  source.categories.forEach((category, index) => {
    const categoryRef = restaurantRef.collection('categories').doc(String(category.id));
    batch.set(categoryRef, {
      id: category.id,
      name: category.name,
      order: index,
      active: true
    }, { merge: true });
  });

  source.products.forEach((product, index) => {
    const productRef = restaurantRef.collection('products').doc(String(product.id));
    batch.set(productRef, {
      ...product,
      id: product.id,
      active: true,
      sortOrder: index,
      posterProductId: product.posterProductId ?? null,
      source: 'demo',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await batch.commit();
  console.log(`Seeded ${source.categories.length} categories and ${source.products.length} products for ${restaurantId}.`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
