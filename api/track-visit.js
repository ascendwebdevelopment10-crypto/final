import { kv } from '@vercel/kv';
import crypto from 'node:crypto';
import { currentCustomer } from '../lib/customer-auth.js';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
const MOUNTAIN_TIME_ZONE = 'America/Denver';
const BOT_PATTERN = /(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|linkedinbot|twitterbot|discordbot|headlesschrome|lighthouse|pagespeed|vercel-screenshot)/i;

function clean(value, max = 160) {
  return String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, max);
}
function hash(value, length = 20) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}
function mountainDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function deviceName(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
  return `${browser} · ${device}`;
}
function productionHost(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().split(':')[0].toLowerCase();
  return host === 'nitrooutreach.com' || host === 'www.nitrooutreach.com';
}

// Production-only, privacy-safe analytics:
// - a page view is a real route/hash visit
// - a session is 30 minutes of activity
// - a unique visitor is one persistent browser ID
// Raw IP addresses and raw browser IDs are never stored.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    if (!productionHost(req)) { res.status(200).json({ ok: true, excluded: 'non-production' }); return; }
    const userAgent = String(req.headers['user-agent'] || '');
    const purpose = String(req.headers.purpose || req.headers['sec-purpose'] || '');
    if (BOT_PATTERN.test(userAgent) || /prefetch|prerender/i.test(purpose)) {
      res.status(200).json({ ok: true, excluded: 'automated' }); return;
    }

    let customer = null;
    try { customer = await currentCustomer(req); } catch {}
    if (String(customer?.email || '').toLowerCase() === OWNER_EMAIL) {
      res.status(200).json({ ok: true, excluded: 'owner' }); return;
    }

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const clientVisitorId = clean(req.body?.visitorId, 100).replace(/[^a-zA-Z0-9_-]/g, '');
    const clientSessionId = clean(req.body?.sessionId, 100).replace(/[^a-zA-Z0-9_-]/g, '');
    const visitorHash = hash(clientVisitorId || `ip:${ip}`);
    const sessionHash = hash(`${visitorHash}:${clientSessionId || 'default'}`);
    const path = clean(req.body?.path, 240) || '/';
    const now = new Date();
    const viewedAt = now.toISOString();
    const day = mountainDay(now);

    const sessionKey = `visit:session:v2:${sessionHash}`;
    const freshSession = await kv.set(sessionKey, '1', { nx: true, ex: 1800 });
    if (!freshSession) await kv.set(sessionKey, '1', { ex: 1800 });

    const uniqueKey = `visit:unique:v2:${visitorHash}`;
    const freshVisitor = await kv.set(uniqueKey, viewedAt, { nx: true });
    const dailyUniqueKey = `visit:unique:v2:day:${day}:${visitorHash}`;
    const freshToday = await kv.set(dailyUniqueKey, '1', { nx: true, ex: 172800 });

    const pageDedupeKey = `visit:page:v2:${sessionHash}:${hash(path, 12)}`;
    const freshPageView = await kv.set(pageDedupeKey, '1', { nx: true, ex: 20 });
    if (freshPageView) {
      const event = {
        id: `view_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        viewedAt,
        visitedAt: viewedAt,
        visitorId: visitorHash.slice(0, 8).toUpperCase(),
        sessionId: sessionHash.slice(0, 8).toUpperCase(),
        email: clean(customer?.email, 160),
        name: clean([customer?.firstName, customer?.lastName].filter(Boolean).join(' '), 120),
        path,
        pageTitle: clean(req.body?.pageTitle, 160),
        referrer: clean(req.body?.referrer, 240),
        utmSource: clean(req.body?.utmSource, 100),
        utmMedium: clean(req.body?.utmMedium, 100),
        utmCampaign: clean(req.body?.utmCampaign, 120),
        city: clean(req.headers['x-vercel-ip-city'], 80),
        region: clean(req.headers['x-vercel-ip-country-region'], 80),
        country: clean(req.headers['x-vercel-ip-country'], 8),
        device: deviceName(userAgent),
      };
      await kv.incr('stats:site:v2:pageviews');
      await kv.incr(`stats:site:v2:pageviews:day:${day}`);
      await kv.lpush('stats:site:v2:visitors', JSON.stringify(event));
      await kv.ltrim('stats:site:v2:visitors', 0, 999);
    }
    if (freshSession) {
      await kv.incr('stats:site:v2:sessions');
      await kv.incr(`stats:site:v2:sessions:day:${day}`);
    }
    if (freshVisitor) await kv.incr('stats:site:v2:unique');
    if (freshToday) await kv.incr(`stats:site:v2:unique:day:${day}`);

    res.status(200).json({ ok: true });
  } catch {
    // Analytics must never interrupt the page experience.
    res.status(200).json({ ok: true });
  }
}
