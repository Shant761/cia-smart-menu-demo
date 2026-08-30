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
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Prepacks/3.0' }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Poster ${method} HTTP ${res.status}: ${text.slice(0, 300)}`); }
  if (!res.ok || payload?.error) throw new Error(`Poster ${method}: ${JSON.stringify(payload?.error || payload)}`);
  return payload?.response;
}

function compactPrep(prep) {
  return {
    productId: String(prep?.product_id ?? ''),
    ingredientId: String(prep?.ingredient_id ?? ''),
    name: String(prep?.product_name ?? '').trim(),
    cost: prep?.cost ?? null,
    costNetto: prep?.cost_netto ?? null,
    out: Number(prep?.out ?? 0),
    productionDescription: String(prep?.product_production_description ?? ''),
    ingredients: Array.isArray(prep?.ingredients) ? prep.ingredients : []
  };
}

(async () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const targetSet = new Set(TARGET_NAMES.map(normalize));
  const targetEntries = entries.filter((entry) => [entry?.name, ...(entry?.aliases || [])].map(normalize).some((name) => targetSet.has(name)));

  // Official Poster endpoint for semi-finished products. It returns the complete
  // prep recipe directly in each object's `ingredients` array.
  const response = await posterRequest('menu.getPrepacks');
  const prepacks = Array.isArray(response) ? response : [];
  const compact = prepacks.map(compactPrep);
  const targetPrepacks = compact.filter((prep) => targetSet.has(normalize(prep.name)));

  const nestedRows = compact.flatMap((prep) => prep.ingredients
    .filter((row) => Number(row?.structure_type) === 2)
    .map((row) => ({ parentProductId: prep.productId, parentName: prep.name, row })));

  const payload = {
    version: '6.0.0',
    restaurantId: 'poster-test',
    source: 'Poster menu.getPrepacks',
    exportedAt: new Date().toISOString(),
    prepackCount: compact.length,
    targetCount: targetEntries.length,
    targetPrepackMatchCount: targetPrepacks.length,
    targetPrepacks,
    nestedPrepackRows: nestedRows,
    prepacks: compact,
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
  const ingredientRows = compact.reduce((sum, prep) => sum + prep.ingredients.length, 0);
  console.log(`[Poster prepacks] total=${compact.length}; ingredientRows=${ingredientRows}; targets=${targetEntries.length}; matched=${targetPrepacks.length}; nested=${nestedRows.length}`);
})();
