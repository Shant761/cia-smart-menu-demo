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

async function loadPublicMenu(restaurantId = 'garden-table') {
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
    .map((item) => ({ id: Number(item.data().id ?? item.id), ...item.data() }))
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

window.ciaFirebase = {
  app,
  db,
  projectId: firebaseConfig.projectId,
  loadPublicMenu,
  ready: true
};

window.dispatchEvent(new CustomEvent('cia:firebase-ready'));
