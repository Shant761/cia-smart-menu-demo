const fs = require('node:fs');
const path = require('node:path');

const token = String(process.env.POSTER_ACCESS_TOKEN || '').trim();
if (!token) throw new Error('POSTER_ACCESS_TOKEN is required');

const API_BASE = 'https://joinposter.com/api/';
const OUTPUT = path.join(process.cwd(), 'data', 'poster-test-preparations.json');
const CATALOG_PATH = path.join(process.cwd(), 'data', 'cia-nutrition-priority-top500.json');

const TARGET_NAMES = [
  'фарш мясной для долмы', 'фарш для ярах', 'куринный паштет', 'фарш для хинкали',
  'фарш для баклажана', 'говядина отварная', 'куриная печень очищенная', 'куриный рулет'
];

const normalize = (value) => String(value || '').toLowerCase().normalize('NFKC').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

async function posterRequest(method, params = {}) {
  const url = new URL(`${API_BASE}${method}`);
  url.searchParams.set('token', token);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Preparation-Probe/2.0' }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Poster ${method} HTTP ${res.status}: ${text.slice(0, 300)}`); }
  if (!res.ok || payload?.error) throw new Error(`Poster ${method}: ${JSON.stringify(payload?.error || payload)}`);
  return payload?.response;
}

function compactProduct(product) {
  return {
    productId: String(product?.product_id ?? product?.id ?? ''),
    name: String(product?.product_name ?? product?.name ?? '').trim(),
    type: product?.type ?? null,
    ingredientId: String(product?.ingredient_id ?? ''),
    out: product?.out ?? null,
    unit: product?.unit ?? null
  };
}

(async () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const targetSet = new Set(TARGET_NAMES.map(normalize));
  const targetEntries = entries.filter((entry) => [entry?.name, ...(entry?.aliases || [])].map(normalize).some((name) => targetSet.has(name)));

  // Poster documents menu.getProducts type=1 as semi-finished/preparation.
  // Probe the full response and filter type=1 instead of searching only sellable menu names.
  const menuResponse = await posterRequest('menu.getProducts');
  const menuProducts = Array.isArray(menuResponse) ? menuResponse : [];
  const semiFinished = menuProducts.filter((p) => Number(p?.type) === 1);
  const targetPreparations = semiFinished.filter((p) => targetSet.has(normalize(p?.product_name ?? p?.name)));

  const preparationDetails = [];
  for (const prep of targetPreparations) {
    const productId = String(prep?.product_id ?? prep?.id ?? '');
    if (!productId) continue;
    const detail = await posterRequest('menu.getProduct', { product_id: productId });
    preparationDetails.push({
      ...compactProduct(detail || prep),
      ingredients: Array.isArray(detail?.ingredients) ? detail.ingredients : [],
      ingredientFieldNames: [...new Set((detail?.ingredients || []).flatMap((row) => Object.keys(row || {})))].sort()
    });
  }

  // Also retain type=2 references seen inside dish recipes. This is important because
  // existing poster-test data shows preparation IDs can collide with ordinary ingredient IDs.
  const sampleProductIds = [...new Set(targetEntries.flatMap((entry) => (entry?.sampleProducts || []).map((p) => String(p?.productId || '')).filter(Boolean)))];
  const usageRows = [];
  for (const productId of sampleProductIds) {
    const detail = await posterRequest('menu.getProduct', { product_id: productId });
    for (const row of (Array.isArray(detail?.ingredients) ? detail.ingredients : [])) {
      if (Number(row?.structure_type) !== 2 || !targetSet.has(normalize(row?.ingredient_name))) continue;
      usageRows.push({ usedInProductId: String(detail?.product_id ?? productId), usedInProductName: String(detail?.product_name ?? '').trim(), row });
    }
  }

  const payload = {
    version: '5.0.0', restaurantId: 'poster-test',
    source: 'Poster menu.getProducts type=1 semi-finished probe + menu.getProduct recipe expansion',
    exportedAt: new Date().toISOString(), menuProductCount: menuProducts.length,
    semiFinishedCount: semiFinished.length,
    semiFinishedSample: semiFinished.slice(0, 100).map(compactProduct),
    targetCount: targetEntries.length,
    targetPreparationMatchCount: targetPreparations.length,
    targetPreparations: targetPreparations.map(compactProduct),
    preparationDetails,
    preparationUsageRows: usageRows,
    targets: targetEntries.map((entry) => ({ priority: entry.priority, catalogId: entry.id, posterIngredientId: entry.posterIngredientId, name: entry.name, aliases: entry.aliases || [], sampleProducts: entry.sampleProducts || [] }))
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[Poster preparations] menu=${menuProducts.length}; type1=${semiFinished.length}; targets=${targetEntries.length}; matched=${targetPreparations.length}; details=${preparationDetails.length}; usageRows=${usageRows.length}`);
})();
