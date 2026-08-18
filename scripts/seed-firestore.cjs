const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const projectId = 'cia-smart-menu';
const restaurantId = 'garden-table';
const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
const diagnosticPath = path.join(__dirname, '..', 'seed-error.txt');

function writeDiagnostic(error, stage = 'seed') {
  const diagnostic = {
    stage,
    name: error?.name || 'Error',
    code: error?.code || null,
    message: String(error?.message || error || 'Unknown error')
      .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED API KEY]')
  };
  fs.writeFileSync(diagnosticPath, JSON.stringify(diagnostic, null, 2));
}

async function main() {
  if (!rawCredentials) {
    throw Object.assign(new Error('FIREBASE_SERVICE_ACCOUNT is required'), { stage: 'credentials' });
  }

  let credentials;
  try {
    credentials = JSON.parse(rawCredentials);
  } catch (error) {
    error.stage = 'credentials-json';
    throw error;
  }

  try {
    initializeApp({
      credential: cert(credentials),
      projectId
    });
  } catch (error) {
    error.stage = 'initialize';
    throw error;
  }

  const db = getFirestore();
  const sourcePath = path.join(__dirname, '..', 'data', 'products.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const batch = db.batch();

  batch.set(restaurantRef, {
    id: restaurantId,
    type: 'restaurant',
    name: source.restaurant.name,
    meta: source.restaurant.meta,
    published: true,
    source: 'demo',
    updatedAt: FieldValue.serverTimestamp()
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
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await batch.commit();
  if (fs.existsSync(diagnosticPath)) fs.unlinkSync(diagnosticPath);
  console.log(`Seeded ${source.categories.length} categories and ${source.products.length} products for ${restaurantId}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    writeDiagnostic(error, error?.stage || 'seed');
    console.error(`${error?.code || error?.name || 'Error'}: ${error?.message || error}`);
    process.exit(1);
  });
