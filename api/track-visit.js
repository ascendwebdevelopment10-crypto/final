import { kv } from '@vercel/kv';
import crypto from 'node:crypto';
import { currentCustomer } from '../lib/customer-auth.js';

function clean(value, max = 160) {
  return String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, max);
}
function deviceName(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
  return `${browser} · ${device}`;
}

// Counts landing-page visits and keeps a privacy-safe recent visitor trail.
// Raw IP addresses are never stored.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const iph = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 20);
    const sessionId = clean(req.body?.sessionId, 80).replace(/[^a-zA-Z0-9_-]/g, '');
    const sessionHash = crypto.createHash('sha256').update(`${iph}:${sessionId || 'default'}`).digest('hex').slice(0, 20);
    const fresh = await kv.set('visit:session:' + sessionHash, '1', { nx: true, ex: 1800 });
    if (fresh) {
      const now = new Date().toISOString();
      const day = now.slice(0, 10);
      let customer = null;
      try { customer = await currentCustomer(req); } catch {}
      const event = {
        id: `visit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        visitedAt: now,
        visitorId: iph.slice(0, 8).toUpperCase(),
        email: clean(customer?.email, 160),
        name: clean([customer?.firstName, customer?.lastName].filter(Boolean).join(' '), 120),
        path: clean(req.body?.path, 200) || '/',
        referrer: clean(req.body?.referrer, 240),
        utmSource: clean(req.body?.utmSource, 100),
        utmMedium: clean(req.body?.utmMedium, 100),
        utmCampaign: clean(req.body?.utmCampaign, 120),
        city: clean(req.headers['x-vercel-ip-city'], 80),
        region: clean(req.headers['x-vercel-ip-country-region'], 80),
        country: clean(req.headers['x-vercel-ip-country'], 8),
        device: deviceName(req.headers['user-agent']),
      };
      await kv.incr('stats:landing:views');
      await kv.incr('stats:landing:day:' + day);
      await kv.lpush('stats:landing:visitors', JSON.stringify(event));
      await kv.ltrim('stats:landing:visitors', 0, 499);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: true });
  }
}
