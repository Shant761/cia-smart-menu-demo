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
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Preparation-Name-Probe/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Poster ${method} HTTP ${res.status}`);
  const payload = await res.json();
  if (payload?.error) throw new Error(`Poster ${method}: ${JSON.stringify(payload.error)}`);
  return payload?.response;
}

function compactProduct(product) {
  return {
    productId: String(product?.product_id ?? product?.id ?? ''),
    name: String(product?.product_name ?? product?.name ?? '').trim(),
    type: product?.type ?? null,
    categoryId: product?.menu_category_id ?? null,
    hidden: product?.hidden ?? null,
    out: product?.out ?? null,
    unit: product?.unit ?? null
  };
}

(async () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const targetSet = new Set(TARGET_NAMES.map(normalize));

  const targetEntries = entries.filter((entry) => {
    const names = [entry?.name, ...(entry?.aliases || [])].map(normalize);
    return names.some((name) => targetSet.has(name));
  });

  const menuResponse = await posterRequest('menu.getProducts');
  const menuProducts = Array.isArray(menuResponse) ? menuResponse : [];
  const exactProductMatches = menuProducts.filter((product) => targetSet.has(normalize(product?.product_name ?? product?.name))).map(compactProduct);

  const productDetails = [];
  for (const match of exactProductMatches) {
    if (!match.productId) continue;
    const detail = await posterRequest('menu.getProduct', { product_id: match.productId });
    productDetails.push({
      ...compactProduct(detail || match),
      ingredients: Array.isArray(detail?.ingredients) ? detail.ingredients : [],
      ingredientFieldNames: [...new Set((detail?.ingredients || []).flatMap((row) => Object.keys(row || {})))].sort()
    });
  }

  const sampleProductIds = [...new Set(targetEntries.flatMap((entry) => (entry?.sampleProducts || []).map((p) => String(p?.productId || '')).filter(Boolean)))];
  const usageRows = [];
  for (const productId of sampleProductIds) {
    const detail = await posterRequest('menu.getProduct', { product_id: productId });
    if (!detail) continue;
    const rows = Array.isArray(detail?.ingredients) ? detail.ingredients : [];
    for (const row of rows) {
      if (Number(row?.structure_type) !== 2) continue;
      if (!targetSet.has(normalize(row?.ingredient_name))) continue;
      usageRows.push({
        usedInProductId: String(detail?.product_id ?? productId),
        usedInProductName: String(detail?.product_name ?? '').trim(),
        row
      });
    }
  }

  const payload = {
    version: '4.0.0',
    restaurantId: 'poster-test',
    source: 'Poster menu.getProducts exact-name matching + raw menu.getProduct preparation rows',
    exportedAt: new Date().toISOString(),
    menuProductCount: menuProducts.length,
    targetCount: targetEntries.length,
    exactProductMatchCount: exactProductMatches.length,
    exactProductMatches,
    productDetails,
    preparationUsageRows: usageRows,
    targets: targetEntries.map((entry) => ({
      priority: entry.priority,
      catalogId: entry.id,
      posterIngredientId: entry.posterIngredientId,
      name: entry.name,
      aliases: entry.aliases || [],
      sampleProducts: entry.sampleProducts || []
    }))
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[Poster preparation names] menuProducts=${menuProducts.length}; targets=${targetEntries.length}; exactMatches=${exactProductMatches.length}; usageRows=${usageRows.length}`);
})();
