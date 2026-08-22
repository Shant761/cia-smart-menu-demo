const POSTER_API_BASE = 'https://joinposter.com/api/';

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const posterToken = requiredEnv('POSTER_TEST_ACCESS_TOKEN');
const requestedSpotId = (process.env.POSTER_TEST_SPOT_ID || '').trim();
const requestedProductId = (process.env.POSTER_TEST_PRODUCT_ID || '').trim();
const count = Number(process.env.POSTER_TEST_COUNT || '1');
const confirm = (process.env.CONFIRM_CREATE_ORDER || '').trim().toUpperCase();

if (!Number.isFinite(count) || count <= 0) throw new Error('POSTER_TEST_COUNT must be a positive number');

async function posterRequest(method, { httpMethod = 'GET', body = null } = {}) {
  const url = new URL(`${POSTER_API_BASE}${method}`);
  url.searchParams.set('token', posterToken);
  url.searchParams.set('format', 'json');

  const response = await fetch(url, {
    method: httpMethod,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'User-Agent': 'CIA-Smart-Menu-Test/1.0'
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000)
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Poster ${method} returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.error_message || text.slice(0, 300);
    throw new Error(`Poster ${method} returned HTTP ${response.status}: ${message}`);
  }
  if (payload?.error) {
    const code = payload.error.code ?? payload.error.error_code ?? 'unknown';
    const message = payload.error.message ?? payload.error.error_message ?? 'Poster API error';
    throw new Error(`Poster ${method} error ${code}: ${message}`);
  }
  return payload?.response;
}

function detectSpotId(products) {
  if (requestedSpotId) return requestedSpotId;
  for (const product of products) {
    const spots = Array.isArray(product?.spots) ? product.spots : [];
    const visible = spots.find((spot) => String(spot?.visible ?? '1') !== '0' && spot?.spot_id != null);
    if (visible) return String(visible.spot_id);
  }
  for (const product of products) {
    const spots = Array.isArray(product?.spots) ? product.spots : [];
    const first = spots.find((spot) => spot?.spot_id != null);
    if (first) return String(first.spot_id);
  }
  return '';
}

function findProduct(products, spotId) {
  if (requestedProductId) return products.find((p) => String(p?.product_id ?? p?.id) === requestedProductId) || null;
  return products.find((product) => {
    const hidden = String(product?.hidden ?? '0') === '1';
    if (hidden) return false;
    const spots = Array.isArray(product?.spots) ? product.spots : [];
    if (!spotId) return true;
    return spots.some((spot) => String(spot?.spot_id) === spotId && String(spot?.visible ?? '1') !== '0');
  }) || null;
}

async function main() {
  console.log('[Poster test] Reading products from the TEST account...');
  const products = await posterRequest('menu.getProducts');
  if (!Array.isArray(products) || !products.length) throw new Error('Poster test account returned no products');

  const spotId = detectSpotId(products);
  if (!spotId) throw new Error('Could not detect a Poster spot. Set POSTER_TEST_SPOT_ID manually.');

  const product = findProduct(products, spotId);
  if (!product) throw new Error('Could not select a product. Set POSTER_TEST_PRODUCT_ID manually.');

  const productId = String(product?.product_id ?? product?.id);
  const productName = String(product?.product_name ?? product?.name ?? `Product ${productId}`);
  const spots = Array.isArray(product?.spots) ? product.spots : [];
  const spot = spots.find((item) => String(item?.spot_id) === spotId);
  const priceMinor = spot?.price ?? product?.price ?? null;

  console.log(`[Poster test] Account: ciasift.joinposter.com`);
  console.log(`[Poster test] Selected spot_id=${spotId}`);
  console.log(`[Poster test] Selected product_id=${productId}`);
  console.log(`[Poster test] Product: ${productName}`);
  console.log(`[Poster test] Count: ${count}`);
  if (priceMinor != null) console.log(`[Poster test] Price from Poster: ${Number(priceMinor) / 100}`);

  if (confirm !== 'YES') {
    console.log('[Poster test] DRY RUN: no order was created. Set CONFIRM_CREATE_ORDER=YES to create exactly one test order.');
    return;
  }

  const order = {
    spot_id: Number.isFinite(Number(spotId)) ? Number(spotId) : spotId,
    phone: '+37400000000',
    first_name: 'CIA',
    last_name: 'Smart Menu Test',
    comment: 'CIA Smart Menu API test order',
    products: [{ product_id: Number.isFinite(Number(productId)) ? Number(productId) : productId, count }]
  };

  console.log('[Poster test] Creating test online order...');
  const response = await posterRequest('incomingOrders.createIncomingOrder', {
    httpMethod: 'POST',
    body: order
  });

  console.log(`[Poster test] SUCCESS: incoming_order_id=${response?.incoming_order_id ?? 'unknown'}`);
  console.log(`[Poster test] status=${response?.status ?? 'unknown'} spot_id=${response?.spot_id ?? spotId}`);
}

main().catch((error) => {
  const safeMessage = String(error?.message || error)
    .replaceAll(posterToken, '[REDACTED_POSTER_TEST_TOKEN]')
    .replace(/token=[^&\s]+/gi, 'token=[REDACTED]');
  console.error(`[Poster test] FAILED: ${safeMessage}`);
  process.exit(1);
});
