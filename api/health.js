const ALLOWED_ORIGIN = 'https://shant761.github.io';

export default function handler(req, res) {
  const origin = req.headers.origin;

  res.setHeader(
    'Access-Control-Allow-Origin',
    origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '*'
  );
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  return res.status(200).json({
    ok: true,
    service: 'cia-smart-menu-api',
    time: new Date().toISOString()
  });
}
