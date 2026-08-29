const fs = require('node:fs');
const path = require('node:path');

const token = String(process.env.POSTER_ACCESS_TOKEN || '').trim();
if (!token) throw new Error('POSTER_ACCESS_TOKEN is required');

const API_BASE = 'https://joinposter.com/api/';
const OUTPUT = path.join(process.cwd(), 'data', 'poster-test-preparations.json');

const TARGETS = [
  { id: '588', expectedName: 'фарш мясной для долмы' },
  { id: '594', expectedName: 'фарш для ярах' },
  { id: '530', expectedName: 'куринный паштет' },
  { id: '543', expectedName: 'фарш для хинкали' },
  { id: '510', expectedName: 'фарш для баклажана' }
];

async function posterRequest(method, params = {}) {
  const url = new URL(`${API_BASE}${method}`);
  url.searchParams.set('token', token);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Preparation-Probe/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Poster ${method} HTTP ${res.status}`);
  const payload = await res.json();
  if (payload?.error) throw new Error(`Poster ${method}: ${JSON.stringify(payload.error)}`);
  return payload?.response;
}

function normalizeIngredient(item) {
  return {
    structureId: item?.structure_id != null ? String(item.structure_id) : null,
    structureType: item?.structure_type != null ? Number(item.structure_type) : null,
    ingredientId: item?.ingredient_id != null ? String(item.ingredient_id) : null,
    name: String(item?.ingredient_name ?? item?.name ?? '').trim(),
    unit: String(item?.structure_unit ?? item?.ingredient_unit ?? '').trim(),
    brutto: Number(item?.structure_brutto ?? 0),
    netto: Number(item?.structure_netto ?? 0)
  };
}

(async () => {
  const ingredientResponse = await posterRequest('menu.getIngredients');
  const ingredients = Array.isArray(ingredientResponse) ? ingredientResponse : [];
  const ingredientById = new Map(ingredients.map((item) => [String(item?.ingredient_id ?? ''), item]));

  const probes = [];
  for (const target of TARGETS) {
    const ingredientRow = ingredientById.get(target.id) || null;
    let product = null;
    let productError = null;
    try {
      product = await posterRequest('menu.getProduct', { product_id: target.id });
    } catch (error) {
      productError = error.message;
    }

    probes.push({
      requestedId: target.id,
      expectedName: target.expectedName,
      ingredientRecord: ingredientRow ? {
        ingredientId: String(ingredientRow?.ingredient_id ?? ''),
        name: String(ingredientRow?.ingredient_name ?? '').trim(),
        ingredientsType: String(ingredientRow?.ingredients_type ?? ''),
        unit: String(ingredientRow?.ingredient_unit ?? '').trim()
      } : null,
      productRecord: product ? {
        productId: String(product?.product_id ?? product?.id ?? ''),
        name: String(product?.product_name ?? product?.name ?? '').trim(),
        type: Number(product?.type ?? 0),
        out: Number(product?.out ?? 0),
        unit: String(product?.unit ?? '').trim(),
        productionDescription: String(product?.product_production_description ?? '').trim(),
        ingredients: (Array.isArray(product?.ingredients) ? product.ingredients : []).map(normalizeIngredient)
      } : null,
      productError
    });
  }

  const typeCounts = {};
  for (const item of ingredients) {
    const type = String(item?.ingredients_type ?? 'unknown');
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  const payload = {
    version: '2.0.0',
    restaurantId: 'poster-test',
    source: 'Poster menu.getIngredients + direct menu.getProduct probes',
    exportedAt: new Date().toISOString(),
    ingredientCount: ingredients.length,
    ingredientTypeCounts: typeCounts,
    probes
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[Poster prep probe] ingredients=${ingredients.length}; types=${JSON.stringify(typeCounts)}; probes=${probes.length}`);
})();
