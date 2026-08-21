const fs = require('fs');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const token = String(process.env.POSTER_ACCESS_TOKEN || '').trim();
const restaurantId = String(process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const limit = Math.max(1, Math.min(50, Number(process.env.POSTER_INGREDIENT_DIAGNOSTIC_LIMIT || 50)));
if (!token) throw new Error('POSTER_ACCESS_TOKEN is required');

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', token);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu/1.0' }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 1000) }; }
  return { httpStatus: response.status, payload };
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['token', 'access_token'].includes(key)) continue;
    if (typeof item === 'object' && item !== null) out[key] = compact(item);
    else out[key] = item;
  }
  return out;
}

function uniqueIds(products) {
  const map = new Map();
  for (const product of products) {
    for (const component of Array.isArray(product.ingredients) ? product.ingredients : []) {
      const id = String(component.ingredient_id || '').trim();
      if (!id) continue;
      if (!map.has(id)) map.set(id, { ingredientId: id, names: new Set(), structureTypes: new Set(), examples: [] });
      const row = map.get(id);
      if (component.ingredient_name) row.names.add(String(component.ingredient_name));
      if (component.structure_type !== undefined) row.structureTypes.add(String(component.structure_type));
      if (row.examples.length < 3) row.examples.push({ ingredient_name: component.ingredient_name, structure_id: component.structure_id, structure_type: component.structure_type });
    }
  }
  return [...map.values()].slice(0, limit).map((row) => ({ ...row, names: [...row.names], structureTypes: [...row.structureTypes] }));
}

async function main() {
  const productsResponse = await posterRequest('menu.getProducts');
  const products = productsResponse.payload?.response || [];
  const selected = uniqueIds(products);
  const methods = [
    ['menu.getIngredient', (id) => ({ ingredient_id: id })],
    ['menu.getIngredients', (id) => ({ ingredient_id: id })],
    ['menu.getPreparation', (id) => ({ preparation_id: id })],
    ['menu.getProduct', (id) => ({ product_id: id })]
  ];

  const results = [];
  for (const row of selected) {
    const checks = {};
    for (const [method, params] of methods) {
      try {
        const result = await posterRequest(method, params(row.ingredientId));
        checks[method] = {
          httpStatus: result.httpStatus,
          hasError: Boolean(result.payload?.error),
          responseType: Array.isArray(result.payload?.response) ? 'array' : typeof result.payload?.response,
          responseKeys: result.payload?.response && typeof result.payload.response === 'object' && !Array.isArray(result.payload.response) ? Object.keys(result.payload.response) : [],
          response: compact(result.payload?.response)
        };
      } catch (error) {
        checks[method] = { error: error.message };
      }
    }
    results.push({ ...row, checks });
  }

  const output = {
    restaurantId,
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    inspectedIngredientIds: results.length,
    results
  };
  fs.writeFileSync('poster-ingredient-entities.json', JSON.stringify(output, null, 2));
  console.log(`[Ingredient diagnostic] restaurant=${restaurantId}, products=${products.length}, ingredientIds=${results.length}`);
  console.log('[Ingredient diagnostic] wrote poster-ingredient-entities.json');
}

main().catch((error) => {
  console.error(`[Ingredient diagnostic] FAILED: ${String(error.message || error).replaceAll(token, '[REDACTED_POSTER_TOKEN]')}`);
  process.exit(1);
});
