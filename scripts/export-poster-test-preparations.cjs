const fs = require('node:fs');
const path = require('node:path');

const token = String(process.env.POSTER_ACCESS_TOKEN || '').trim();
if (!token) throw new Error('POSTER_ACCESS_TOKEN is required');

const API_BASE = 'https://joinposter.com/api/';
const OUTPUT = path.join(process.cwd(), 'data', 'poster-test-preparations.json');
const CATALOG_PATH = path.join(process.cwd(), 'data', 'cia-nutrition-priority-top500.json');

const TARGET_NAMES = [
  'фарш мясной для долмы',
  'фарш для ярах',
  'куринный паштет',
  'фарш для хинкали',
  'фарш для баклажана',
  'говядина отварная',
  'куриная печень очищенная',
  'куриный рулет'
];

const normalize = (value) => String(value || '').toLowerCase().normalize('NFKC').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

async function posterRequest(method, params = {}) {
  const url = new URL(`${API_BASE}${method}`);
  url.searchParams.set('token', token);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Raw-Preparation-Probe/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Poster ${method} HTTP ${res.status}`);
  const payload = await res.json();
  if (payload?.error) throw new Error(`Poster ${method}: ${JSON.stringify(payload.error)}`);
  return payload?.response;
}

(async () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const targetSet = new Set(TARGET_NAMES.map(normalize));

  const targetEntries = entries.filter((entry) => {
    const names = [entry?.name, ...(entry?.aliases || [])].map(normalize);
    return names.some((name) => targetSet.has(name));
  });

  const productIds = [...new Set(targetEntries.flatMap((entry) => (entry?.sampleProducts || []).map((p) => String(p?.productId || '')).filter(Boolean)))];
  const products = [];

  for (const productId of productIds) {
    const detail = await posterRequest('menu.getProduct', { product_id: productId });
    if (!detail) continue;
    const rows = Array.isArray(detail?.ingredients) ? detail.ingredients : [];
    const preparationRows = rows.filter((row) => Number(row?.structure_type) === 2);
    const targetRows = rows.filter((row) => targetSet.has(normalize(row?.ingredient_name)));
    if (!preparationRows.length && !targetRows.length) continue;
    products.push({
      productId: String(detail?.product_id ?? productId),
      productName: String(detail?.product_name ?? '').trim(),
      productType: detail?.type ?? null,
      out: detail?.out ?? null,
      unit: detail?.unit ?? null,
      preparationRows,
      targetRows,
      ingredientFieldNames: [...new Set(rows.flatMap((row) => Object.keys(row || {})))].sort()
    });
  }

  const payload = {
    version: '3.0.0',
    restaurantId: 'poster-test',
    source: 'Poster raw menu.getProduct rows selected from local full catalog samples',
    exportedAt: new Date().toISOString(),
    targets: targetEntries.map((entry) => ({
      priority: entry.priority,
      catalogId: entry.id,
      posterIngredientId: entry.posterIngredientId,
      name: entry.name,
      aliases: entry.aliases || [],
      sampleProducts: entry.sampleProducts || []
    })),
    inspectedProductCount: productIds.length,
    productsWithPreparationRows: products.length,
    products
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[Poster prep raw probe] targets=${targetEntries.length}; products=${productIds.length}; withPrepRows=${products.length}`);
})();
