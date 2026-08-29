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
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu-Preparation-Export/1.1' },
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

function pickId(item) {
  const value = item?.pack_id ?? item?.id ?? item?.ingredient_id ?? item?.product_id;
  return value == null ? null : String(value);
}

function pickName(item) {
  return String(item?.pack_name ?? item?.name ?? item?.ingredient_name ?? item?.product_name ?? '').trim();
}

function extractIngredients(pack) {
  const candidates = [pack?.ingredients, pack?.structure, pack?.pack_ingredients, pack?.items];
  return candidates.find(Array.isArray) || [];
}

function normalizeIngredient(item) {
  return {
    structureId: item?.structure_id != null ? String(item.structure_id) : null,
    structureType: item?.structure_type != null ? Number(item.structure_type) : null,
    ingredientId: item?.ingredient_id != null ? String(item.ingredient_id) : null,
    name: String(item?.ingredient_name ?? item?.name ?? item?.product_name ?? '').trim(),
    unit: String(item?.structure_unit ?? item?.ingredient_unit ?? item?.unit ?? '').trim(),
    brutto: Number(item?.structure_brutto ?? item?.brutto ?? 0),
    netto: Number(item?.structure_netto ?? item?.netto ?? 0),
    clear: Number(item?.pr_in_clear ?? 0),
    cook: Number(item?.pr_in_cook ?? 0),
    fry: Number(item?.pr_in_fry ?? 0),
    stew: Number(item?.pr_in_stew ?? 0),
    bake: Number(item?.pr_in_bake ?? 0)
  };
}

function normalizePack(pack, fallback = {}) {
  const ingredients = extractIngredients(pack);
  return {
    packId: pickId(pack) || pickId(fallback),
    name: pickName(pack) || pickName(fallback),
    out: Number(pack?.out ?? pack?.pack_out ?? pack?.weight ?? fallback?.out ?? 0),
    unit: String(pack?.unit ?? pack?.pack_unit ?? fallback?.unit ?? '').trim(),
    productionDescription: String(pack?.production_description ?? pack?.product_production_description ?? pack?.description ?? '').trim(),
    sourceFields: Object.keys(pack || {}).sort(),
    ingredients: ingredients.map(normalizeIngredient)
  };
}

(async () => {
  const packsResponse = await posterRequest('storage.getPacks');
  const packs = Array.isArray(packsResponse) ? packsResponse : [];
  console.log(`[Poster preparations] storage packs=${packs.length}`);
  if (packs[0]) console.log(`[Poster preparations] sample fields=${Object.keys(packs[0]).sort().join(',')}`);

  const details = await mapWithConcurrency(packs, 4, async (pack) => {
    const id = pickId(pack);
    if (!id) return { detail: pack, fallback: pack, detailLoaded: false };
    try {
      const detail = await posterRequest('storage.getPack', { pack_id: id });
      return { detail: detail || pack, fallback: pack, detailLoaded: Boolean(detail) };
    } catch (error) {
      console.warn(`[Poster preparations] pack ${id} detail failed: ${error.message}`);
      return { detail: pack, fallback: pack, detailLoaded: false };
    }
  });

  const rows = details.map(({ detail, fallback, detailLoaded }) => ({
    ...normalizePack(detail, fallback),
    detailLoaded
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const payload = {
    version: '1.1.0',
    restaurantId: 'poster-test',
    source: 'Poster storage.getPacks + storage.getPack',
    exportedAt: new Date().toISOString(),
    count: rows.length,
    preparations: rows
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[Poster preparations] wrote ${rows.length} storage packs to data/poster-test-preparations.json`);
})();
