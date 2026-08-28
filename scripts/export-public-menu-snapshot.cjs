const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const LANGS = ['hy', 'ru', 'en'];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function ingredientOverrideKey(row, index) {
  const id = row?.ingredientId ?? row?.posterIngredientId;
  if (id !== null && id !== undefined && clean(id)) return `id:${clean(id)}`;
  return `name:${clean(row?.name ?? row?.sourceName ?? '') || `row-${index}`}`;
}
function applyProductNameOverrides(product) {
  const nameOverrides = product?.nameOverrides;
  if (nameOverrides && typeof nameOverrides === 'object') {
    product.name = {
      ...(product.name || {}),
      ...Object.fromEntries(LANGS.filter((lang) => clean(nameOverrides[lang])).map((lang) => [lang, clean(nameOverrides[lang])]))
    };
  }

  const overrides = product?.ingredientNameOverrides;
  const recipe = Array.isArray(product?.posterRecipeIngredients) ? product.posterRecipeIngredients : [];
  const baseIngredients = product?.ingredients || {};
  if (!overrides || typeof overrides !== 'object' || !recipe.length) return product;

  const nextIngredients = { hy: [], ru: [], en: [] };
  const seenSourceNames = new Set();
  let baseIndex = 0;

  for (let index = 0; index < recipe.length; index += 1) {
    const row = recipe[index] || {};
    const sourceName = clean(row.name);
    const sourceKey = sourceName.toLocaleLowerCase('und');
    if (seenSourceNames.has(sourceKey)) continue;
    seenSourceNames.add(sourceKey);

    const key = ingredientOverrideKey(row, index);
    const override = overrides[key] && typeof overrides[key] === 'object' ? overrides[key] : {};

    for (const lang of LANGS) {
      const list = Array.isArray(baseIngredients[lang]) ? baseIngredients[lang] : [];
      const base = clean(list[baseIndex] || sourceName);
      const value = clean(override[lang]) || base;
      nextIngredients[lang].push(value);
    }
    baseIndex += 1;
  }

  for (const lang of LANGS) {
    if (nextIngredients[lang].length) {
      product.ingredients = product.ingredients || {};
      product.ingredients[lang] = [...new Set(nextIngredients[lang].filter(Boolean))];
    }
  }

  return product;
}
function compactNutrition(nutrition) {
  if (!nutrition || typeof nutrition !== 'object') return null;
  return {
    status: nutrition.status || null,
    calories: nutrition.calories ?? null,
    protein: nutrition.protein ?? null,
    fat: nutrition.fat ?? null,
    carbohydrates: nutrition.carbohydrates ?? null,
    servingGrams: nutrition.servingGrams ?? null,
    per100g: nutrition.per100g || null,
    source: nutrition.source || null
  };
}
function compactAllergens(allergens) {
  if (!Array.isArray(allergens)) return [];
  return allergens
    .map((item) => {
      if (typeof item === 'string') return clean(item);
      if (!item || typeof item !== 'object') return null;
      return {
        id: item.id || null,
        status: item.status || null,
        source: item.source || null
      };
    })
    .filter(Boolean);
}
function compactCategory(category) {
  return {
    id: String(category.id),
    name: category.name || {},
    order: category.order ?? 999
  };
}
function compactProduct(product) {
  const posterProductId = product.posterProductId ?? product.id ?? null;
  return {
    id: Number(product.id ?? posterProductId),
    posterProductId,
    name: product.name || {},
    description: product.description || {},
    price: product.price ?? null,
    category: String(product.category ?? product.posterCategoryId ?? ''),
    image: product.image || product.posterPhotoPath || null,
    emoji: product.emoji || '🍽️',
    ingredients: product.ingredients || {},
    allergens: compactAllergens(product.allergens),
    nutrition: compactNutrition(product.nutrition),
    sortOrder: product.sortOrder ?? 9999
  };
}

async function exportPublicMenu(restaurantId) {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const restaurantSnapshot = await restaurantRef.get();
  if (!restaurantSnapshot.exists) throw new Error(`Restaurant ${restaurantId} was not found in Firestore`);

  const restaurant = restaurantSnapshot.data();
  if (restaurant.published === false) throw new Error(`Restaurant ${restaurantId} is not published`);

  const [categorySnapshot, productSnapshot] = await Promise.all([
    restaurantRef.collection('categories').get(),
    restaurantRef.collection('products').get()
  ]);

  const categories = categorySnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.active !== false && (item.id === 'all' || item.smartMenuPublished !== false))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const visibleCategoryIds = new Set(categories.filter((item) => item.id !== 'all').map((item) => String(item.id)));
  const products = productSnapshot.docs
    .map((item) => applyProductNameOverrides({ id: Number(item.data().id ?? item.id), ...item.data() }))
    .filter((item) => item.active !== false)
    .filter((item) => item.smartMenuPublished !== false)
    .filter((item) => visibleCategoryIds.has(String(item.category)))
    .sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));

  return {
    version: 2,
    source: 'firestore_public_menu_snapshot',
    restaurantId,
    exportedAt: new Date().toISOString(),
    restaurant: {
      name: restaurant.name || {},
      meta: restaurant.meta || {}
    },
    categories: categories.map(compactCategory),
    products: products.map(compactProduct)
  };
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(restaurantId)) {
  throw new Error('CIA_RESTAURANT_ID must contain only letters, numbers, _ or -');
}

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

exportPublicMenu(restaurantId).then((menu) => {
  const outDir = path.join(__dirname, '..', 'data', 'public-menus');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${restaurantId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(menu, null, 2) + '\n');
  console.log(`[Public menu snapshot] Restaurant: ${restaurantId}`);
  console.log(`[Public menu snapshot] Categories: ${menu.categories.length}`);
  console.log(`[Public menu snapshot] Products: ${menu.products.length}`);
  console.log(`[Public menu snapshot] Written: ${outPath}`);
}).catch((error) => {
  console.error(`[Public menu snapshot] FAILED: ${error?.message || error}`);
  process.exit(1);
});
