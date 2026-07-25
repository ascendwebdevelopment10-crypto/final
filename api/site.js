import { kv } from '@vercel/kv';

// Public: serve a customer's generated website by id (read-only, no auth).
export default async function handler(req, res) {
  const id = String((req.query && req.query.id) || '').trim();
  if (!/^site_[0-9a-z_]+$/i.test(id)) { res.status(400).send('Invalid site id'); return; }
  try {
    const rec = await kv.get(`site:${id}`);
    if (!rec || !rec.html) { res.status(404).send('Site not found'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).send(rec.html);
  } catch (e) {
    res.status(500).send('Could not load site');
  }
}
