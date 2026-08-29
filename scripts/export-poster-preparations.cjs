const fs = require('node:fs');
const path = require('node:path');

const POSTER_API_BASE = 'https://joinposter.com/api/';
const token = String(process.env.POSTER_ACCESS_TOKEN || '').trim();
const restaurantId = String(process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const outputPath = path.join(process.cwd(), 'data', `${restaurantId}-preparations.json`);

if (!token) throw new Error('POSTER_ACCESS_TOKEN is required');
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(restaurantId)) {
  throw new Error('CIA_RESTAURANT_ID contains unsupported characters');
}

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', token);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'CIA-Smart-Menu/1.0'
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) throw new Error(`Poster ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) {
    const code = payload.error.code ?? payload.error.error_code ?? 'unknown';
    const message = payload.error.message ?? payload.error.error_message ?? 'Poster API error';
    throw new Error(`Poster ${method} error ${code}: ${message}`);
  }
  return payload?.response;
}

async function mapWithConcurrency(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, run));
  return result;
}

function compactIngredient(raw) {
  return {
    structureId: String(raw?.structure_id ?? ''),
    ingredientId: String(raw?.ingredient_id ?? ''),
    ingredientName: String(raw?.ingredient_name ?? '').trim(),
    structureType: Number(raw?.structure_type ?? 0),
    unit: String(raw?.structure_unit ?? raw?.ingredient_unit ?? '').trim(),
    brutto: Number(raw?.structure_brutto ?? 0),
    netto: Number(raw?.structure_netto ?? 0)
  };
}

async function main() {
  const products = await posterRequest('menu.getProducts');
  if (!Array.isArray(products)) throw new Error('Poster menu.getProducts did not return an array');

  const semiFinished = products.filter((product) => Number(product?.type) === 1);
  console.log(`[Poster preparations] Found ${semiFinished.length} semi-finished products`);

  const details = await mapWithConcurrency(semiFinished, 4, async (product) => {
    const productId = String(product?.product_id ?? product?.id ?? '').trim();
    if (!productId) return null;
    try {
      return await posterRequest('menu.getProduct', { product_id: productId });
    } catch (error) {
      console.warn(`[Poster preparations] product ${productId} skipped: ${error.message}`);
      return null;
    }
  });

  const preparations = details
    .filter(Boolean)
    .map((detail) => ({
      productId: String(detail?.product_id ?? detail?.id ?? ''),
      ingredientId: String(detail?.ingredient_id ?? ''),
      name: String(detail?.product_name ?? '').trim(),
      type: Number(detail?.type ?? 0),
      out: Number(detail?.out ?? 0),
      ingredients: (Array.isArray(detail?.ingredients) ? detail.ingredients : [])
        .map(compactIngredient)
        .filter((ingredient) => ingredient.ingredientId || ingredient.ingredientName)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const payload = {
    version: '1.0.0',
    restaurantId,
    source: 'Poster menu.getProducts + menu.getProduct',
    exportedAt: new Date().toISOString(),
    count: preparations.length,
    preparations
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[Poster preparations] Wrote ${preparations.length} recipes to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
