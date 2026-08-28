import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCE3QRts6mWqkDFySX8F4Bim7dIb7IaLq0',
  authDomain: 'cia-smart-menu.firebaseapp.com',
  projectId: 'cia-smart-menu',
  storageBucket: 'cia-smart-menu.firebasestorage.app',
  messagingSenderId: '62965932851',
  appId: '1:62965932851:web:56a31d76521be03fda9446'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const LANGS = ['hy', 'ru', 'en'];
const publicMenuCache = new Map();

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

async function fetchPublicMenu(restaurantId) {
  const restaurantSnapshot = await getDoc(doc(db, 'restaurants', restaurantId));
  if (!restaurantSnapshot.exists()) {
    throw new Error(`Restaurant ${restaurantId} was not found in Firestore`);
  }

  const restaurant = restaurantSnapshot.data();
  if (restaurant.published === false) {
    throw new Error(`Restaurant ${restaurantId} is not published`);
  }

  const [categorySnapshot, productSnapshot] = await Promise.all([
    getDocs(collection(db, 'restaurants', restaurantId, 'categories')),
    getDocs(collection(db, 'restaurants', restaurantId, 'products'))
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
    restaurant: {
      name: restaurant.name,
      meta: restaurant.meta
    },
    categories,
    products
  };
}

async function loadPublicMenu(restaurantId = 'garden-table') {
  if (!publicMenuCache.has(restaurantId)) {
    publicMenuCache.set(restaurantId, fetchPublicMenu(restaurantId));
  }
  return publicMenuCache.get(restaurantId);
}

window.ciaFirebase = {
  app,
  db,
  projectId: firebaseConfig.projectId,
  loadPublicMenu,
  ready: true
};

window.dispatchEvent(new CustomEvent('cia:firebase-ready'));
