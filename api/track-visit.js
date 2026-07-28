import { kv } from '@vercel/kv';
import crypto from 'node:crypto';

// Counts landing-page visits. Deduplicates per visitor (IP) for 30 minutes so
// refreshes don't inflate the number. Public, no auth. Never throws to the client.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const iph = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 20);
    const fresh = await kv.set('visit:ip:' + iph, '1', { nx: true, ex: 1800 });
    if (fresh) {
      const day = new Date().toISOString().slice(0, 10);
      await kv.incr('stats:landing:views');
      await kv.incr('stats:landing:day:' + day);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: true });
  }
}
