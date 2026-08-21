const POSTER_API_BASE = 'https://joinposter.com/api/';

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const posterToken = requiredEnv('POSTER_ACCESS_TOKEN');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const sampleLimit = Math.max(1, Math.min(50, Number(process.env.POSTER_RECIPE_INSPECT_LIMIT || 25)));

async function posterRequest(method, params = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', posterToken);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CIA-Smart-Menu/1.0 recipe-inspector' },
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

function collectPreparationLikeKeys(value, path = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (/prepar|полуфаб|заготов/i.test(key)) found.push(currentPath);
    if (child && typeof child === 'object') collectPreparationLikeKeys(child, currentPath, found);
  }
  return found;
}

function compactComponent(component) {
  if (!component || typeof component !== 'object') return component;
  const result = {};
  for (const [key, value] of Object.entries(component)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.length > 500) result[key] = `${value.slice(0, 500)}…`;
    else if (typeof value === 'object') result[key] = value;
    else result[key] = value;
  }
  return result;
}

async function main() {
  console.log(`[Recipe inspector] restaurant=${restaurantId} limit=${sampleLimit}`);
  const products = await posterRequest('menu.getProducts');
  if (!Array.isArray(products) || !products.length) throw new Error('Poster menu.getProducts returned no products');

  const sample = products.slice(0, sampleLimit);
  const output = {
    generatedAt: new Date().toISOString(),
    restaurantId,
    productCount: products.length,
    inspectedProductCount: sample.length,
    products: [],
    preparationLikePaths: []
  };

  for (const product of sample) {
    const productId = product?.product_id ?? product?.id;
    if (productId == null) continue;

    try {
      const detail = await posterRequest('menu.getProduct', { product_id: productId });
      const ingredients = Array.isArray(detail?.ingredients) ? detail.ingredients : [];
      const preparationLikePaths = collectPreparationLikeKeys(detail);
      output.preparationLikePaths.push(...preparationLikePaths);
      output.products.push({
        productId: String(productId),
        productName: String(detail?.product_name ?? product?.product_name ?? ''),
        detailKeys: Object.keys(detail || {}).sort(),
        ingredientCount: ingredients.length,
        ingredientKeySets: [...new Set(ingredients.map((item) => Object.keys(item || {}).sort().join('|')).filter(Boolean))],
        ingredients: ingredients.map(compactComponent),
        preparationLikePaths: [...new Set(preparationLikePaths)]
      });
    } catch (error) {
      output.products.push({ productId: String(productId), error: error.message });
    }
  }

  output.preparationLikePaths = [...new Set(output.preparationLikePaths)].sort();
  require('fs').writeFileSync('poster-recipe-shape.json', `${JSON.stringify(output, null, 2)}\n`);

  console.log(`[Recipe inspector] inspected=${output.products.length}`);
  console.log(`[Recipe inspector] preparation-like paths: ${output.preparationLikePaths.length ? output.preparationLikePaths.join(', ') : 'none found in sampled payloads'}`);
  for (const item of output.products) {
    console.log(`\n[Recipe inspector] ${item.productId} ${item.productName || ''}`);
    console.log(`  detail keys: ${(item.detailKeys || []).join(', ')}`);
    console.log(`  ingredient count: ${item.ingredientCount ?? 0}`);
    console.log(`  ingredient key sets: ${(item.ingredientKeySets || []).join(' || ') || 'none'}`);
    if (item.preparationLikePaths?.length) console.log(`  preparation-like paths: ${item.preparationLikePaths.join(', ')}`);
    if (item.error) console.log(`  ERROR: ${item.error}`);
  }

  console.log('\n[Recipe inspector] Wrote poster-recipe-shape.json');
}

main().catch((error) => {
  console.error(`[Recipe inspector] FAILED: ${error.stack || error.message}`);
  process.exit(1);
});
