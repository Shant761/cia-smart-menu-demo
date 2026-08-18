const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const firebaseServiceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!firebaseServiceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');

initializeApp({ credential: cert(firebaseServiceAccount), projectId: PROJECT_ID });
const db = getFirestore();

const hasCyrillic = (value) => /[А-Яа-яЁё]/.test(String(value || ''));
const hasArmenian = (value) => /[Ա-Ֆա-ֆև]/.test(String(value || ''));
const hasLatin = (value) => /[A-Za-z]/.test(String(value || ''));
const clean = (value) => String(value || '').trim().replace(/\s+/g, ' ');

function classify(name) {
  const text = clean(name);
  if (!text) return 'missing';
  if (hasCyrillic(text)) return 'ru';
  if (hasArmenian(text)) return 'armenian';
  if (hasLatin(text)) return 'latin';
  return 'other';
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const restaurant = await restaurantRef.get();
  if (!restaurant.exists) throw new Error(`Restaurant ${restaurantId} not found`);

  const snapshot = await restaurantRef.collection('products').where('active', '==', true).get();
  const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const stats = { products: products.length, recipeRows: 0, ru: 0, armenian: 0, latin: 0, missing: 0, other: 0, displayMismatch: 0 };
  const issues = [];

  for (const product of products) {
    const recipe = Array.isArray(product.posterRecipeIngredients) ? product.posterRecipeIngredients : [];
    const displayRu = Array.isArray(product.ingredients?.ru) ? product.ingredients.ru.map(clean) : [];
    stats.recipeRows += recipe.length;

    recipe.forEach((row, index) => {
      const name = clean(row.name);
      const type = classify(name);
      stats[type] += 1;
      if (type !== 'ru') {
        issues.push({ productId: product.id, productName: product.name?.ru || product.name?.hy || '', index, ingredientId: row.ingredientId, sourceName: name, classification: type });
      }
    });

    const sourceNames = recipe.map((row) => clean(row.name)).filter(Boolean);
    if (sourceNames.length && JSON.stringify(sourceNames) !== JSON.stringify(displayRu)) {
      stats.displayMismatch += 1;
    }
  }

  console.log(JSON.stringify({
    restaurantId,
    summary: stats,
    issueCount: issues.length,
    issues: issues.slice(0, 250)
  }, null, 2));

  if (stats.missing > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
