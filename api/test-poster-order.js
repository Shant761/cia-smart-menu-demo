export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.POSTER_TEST_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({
      ok: false,
      error: 'POSTER_TEST_ACCESS_TOKEN is not configured on the backend.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const phone = String(body.phone || '').trim();
    const firstName = String(body.first_name || 'CIA').trim();
    const lastName = String(body.last_name || 'Smart Menu Test').trim();
    const comment = String(body.comment || 'CIA Smart Menu browser test').trim();
    const spotId = Number(body.spot_id || 1);
    const productId = Number(body.product_id || 46);
    const count = Number(body.count || 1);
    const confirm = body.confirm === true;

    if (!confirm) {
      return res.status(400).json({ ok: false, error: 'Order confirmation is required.' });
    }
    if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/[\s()-]/g, ''))) {
      return res.status(400).json({ ok: false, error: 'Invalid phone number.' });
    }
    if (productId !== 46) {
      return res.status(400).json({ ok: false, error: 'This test endpoint only allows Cola product ID 46.' });
    }
    if (!Number.isInteger(spotId) || spotId < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid spot_id.' });
    }
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      return res.status(400).json({ ok: false, error: 'Count must be between 1 and 20.' });
    }

    const posterResponse = await fetch(
      `https://joinposter.com/api/incomingOrders.createIncomingOrder?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_id: spotId,
          phone,
          first_name: firstName,
          last_name: lastName,
          comment,
          products: [{ product_id: productId, count }]
        })
      }
    );

    const raw = await posterResponse.text();
    let posterData;
    try {
      posterData = JSON.parse(raw);
    } catch {
      posterData = { raw };
    }

    if (!posterResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: 'Poster API returned an HTTP error.',
        posterStatus: posterResponse.status,
        poster: posterData
      });
    }

    return res.status(200).json({
      ok: true,
      posterStatus: posterResponse.status,
      poster: posterData
    });
  } catch (error) {
    console.error('Poster test order failed:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown server error'
    });
  }
}
