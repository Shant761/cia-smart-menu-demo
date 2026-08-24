const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU;
    if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU');
    initializeApp({ credential: cert(JSON.parse(raw)), projectId: 'cia-smart-menu' });
  }
  return getFirestore();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const restaurantId = String(req.query?.restaurant || 'poster-test').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(restaurantId)) {
    return res.status(400).json({ error: 'Invalid restaurant' });
  }

  try {
    const db = getDb();
    const snapshot = await db.collection('restaurants').doc(restaurantId).collection('products').get();

    const products = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        nutrition: data.nutrition?.status === 'calculated' ? {
          status: 'calculated',
          calories: data.nutrition.calories,
          protein: data.nutrition.protein,
          fat: data.nutrition.fat,
          carbohydrates: data.nutrition.carbohydrates,
          per100g: data.nutrition.per100g || null,
          servingGrams: data.nutrition.servingGrams || null
        } : null
      };
    }).filter(p => p.active !== false && p.source === 'poster');

    return res.status(200).json({ restaurantId, products, count: products.length });
  } catch (error) {
    console.error('[menu] failed:', error);
    return res.status(500).json({ error: 'Failed to load menu' });
  }
};
