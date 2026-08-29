const fs = require('node:fs');
const path = require('node:path');

const token = String(process.env.POSTER_ACCESS_TOKEN || '').trim();
if (!token) throw new Error('POSTER_ACCESS_TOKEN is required');

const API_BASE = 'https://joinposter.com/api/';
const OUTPUT = path.join(process.cwd(), 'data', 'poster-test-preparations.json');

async function posterRequest(method, params = {}) {
  const url = new URL(`${API_BASE}${method}`);
  url.searchParams.set('token', token);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Preparation-Export/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Poster ${method} HTTP ${res.status}`);
  const payload = await res.json();
  if (payload?.error) throw new Error(`Poster ${method}: ${JSON.stringify(payload.error)}`);
  return payload?.response;
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return out;
}

function normalizeIngredient(item) {
  return {
    structureId: item?.structure_id != null ? String(item.structure_id) : null,
    structureType: item?.structure_type != null ? Number(item.structure_type) : null,
    ingredientId: item?.ingredient_id != null ? String(item.ingredient_id) : null,
    name: String(item?.ingredient_name || '').trim(),
    unit: String(item?.structure_unit || item?.ingredient_unit || '').trim(),
    brutto: Number(item?.structure_brutto ?? 0),
    netto: Number(item?.structure_netto ?? 0),
    clear: Number(item?.pr_in_clear ?? 0),
    cook: Number(item?.pr_in_cook ?? 0),
    fry: Number(item?.pr_in_fry ?? 0),
    stew: Number(item?.pr_in_stew ?? 0),
    bake: Number(item?.pr_in_bake ?? 0)
  };
}

(async () => {
  const products = await posterRequest('menu.getProducts');
  const all = Array.isArray(products) ? products : [];
  const preparations = all.filter((p) => Number(p?.type) === 1);
  console.log(`[Poster preparations] menu products=${all.length}; preparations=${preparations.length}`);

  const details = await mapWithConcurrency(preparations, 4, async (product) => {
    const id = product?.product_id ?? product?.id;
    if (id == null) return null;
    try {
      const detail = await posterRequest('menu.getProduct', { product_id: id });
      return detail || product;
    } catch (error) {
      console.warn(`[Poster preparations] product ${id} detail failed: ${error.message}`);
      return product;
    }
  });

  const rows = details.filter(Boolean).map((p) => ({
    productId: String(p?.product_id ?? p?.id ?? ''),
    name: String(p?.product_name ?? p?.name ?? '').trim(),
    type: Number(p?.type ?? 1),
    out: Number(p?.out ?? 0),
    unit: String(p?.unit || '').trim(),
    productionDescription: String(p?.product_production_description || '').trim(),
    ingredients: (Array.isArray(p?.ingredients) ? p.ingredients : []).map(normalizeIngredient)
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const payload = {
    version: '1.0.0',
    restaurantId: 'poster-test',
    source: 'Poster menu.getProducts + menu.getProduct',
    exportedAt: new Date().toISOString(),
    count: rows.length,
    preparations: rows
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[Poster preparations] wrote ${rows.length} preparations to data/poster-test-preparations.json`);
})();
