const ALLOWED_ORIGIN = 'https://shant761.github.io';

export default async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const token = process.env.POSTER_TEST_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'Poster token is not configured on the backend.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const phone = String(body.phone || '').trim();
    const firstName = String(body.first_name || 'CIA Smart Menu').trim();
    const lastName = String(body.last_name || '').trim();
    const comment = String(body.comment || 'CIA Smart Menu order').trim().slice(0, 1000);
    const spotId = Number(body.spot_id || 1);
    const products = Array.isArray(body.products) ? body.products : [];
    const confirm = body.confirm === true;

    if (!confirm) return res.status(400).json({ ok: false, error: 'Order confirmation is required.' });
    if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/[\s()-]/g, ''))) return res.status(400).json({ ok: false, error: 'Invalid phone number.' });
    if (!Number.isInteger(spotId) || spotId < 1) return res.status(400).json({ ok: false, error: 'Invalid spot_id.' });
    if (!products.length || products.length > 50) return res.status(400).json({ ok: false, error: 'The order must contain 1–50 products.' });

    const normalizedProducts = products.map(item => ({
      product_id: Number(item.product_id),
      count: Number(item.count)
    }));

    if (normalizedProducts.some(item => !Number.isInteger(item.product_id) || item.product_id < 1 || !Number.isInteger(item.count) || item.count < 1 || item.count > 20)) {
      return res.status(400).json({ ok: false, error: 'Each product must have a valid product_id and count between 1 and 20.' });
    }

    const posterResponse = await fetch(`https://joinposter.com/api/incomingOrders.createIncomingOrder?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spot_id: spotId,
        phone,
        first_name: firstName,
        last_name: lastName,
        comment,
        products: normalizedProducts
      })
    });

    const raw = await posterResponse.text();
    let posterData;
    try { posterData = JSON.parse(raw); } catch { posterData = { raw }; }

    if (!posterResponse.ok) {
      return res.status(502).json({ ok: false, error: 'Poster API returned an HTTP error.', posterStatus: posterResponse.status, poster: posterData });
    }

    // Poster can return an application-level error inside a successful HTTP response.
    if (posterData?.error || posterData?.error_code || posterData?.error_message) {
      return res.status(502).json({
        ok: false,
        error: 'Poster rejected the order.',
        posterStatus: posterResponse.status,
        poster: posterData
      });
    }

    return res.status(200).json({ ok: true, posterStatus: posterResponse.status, poster: posterData });
  } catch (error) {
    console.error('Poster order failed:', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown server error' });
  }
}
