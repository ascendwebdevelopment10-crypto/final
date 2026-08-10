import { kv } from '@vercel/kv';
import { currentCustomer } from '../lib/customer-auth.js';
import { getPublishedInstagramMedia } from '../lib/meta.js';
import { makeSocialLinkToken } from '../lib/social-links.js';

export const config = { maxDuration: 60 };

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }

function websiteFor(user) {
  const candidates = [
    user.company?.website,
    user.onboarding?.data?.website,
    ...(user.workspace?.websites || []).map(site => site.url),
  ];
  for (const candidate of candidates) {
    try {
      const url = new URL(String(candidate || ''));
      if (url.protocol === 'https:') return url.toString();
    } catch {}
  }
  return '';
}

function requestOrigin(req) {
  const proto = clean(req.headers?.['x-forwarded-proto'], 20) || 'https';
  const host = clean(req.headers?.['x-forwarded-host'] || req.headers?.host, 300);
  return `${proto}://${host}`;
}

function metricTotal(posts, key) {
  const values = posts.map(post => post[key]).filter(value => Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }
  if (!user.meta?.igUserId || !user.meta?.token) { res.status(400).json({ error: 'Connect Instagram to see post performance.', needsConnection: true }); return; }

  const limit = Math.max(1, Math.min(25, Number(req.query?.limit) || 12));
  const cacheKey = `customer:instagram-insights:${user.id}:${limit}`;
  try {
    if (req.query?.refresh !== '1') {
      let cached = await kv.get(cacheKey);
      if (typeof cached === 'string') { try { cached = JSON.parse(cached); } catch { cached = null; } }
      if (cached) { res.status(200).json({ ...cached, cached: true }); return; }
    }

    const posts = await getPublishedInstagramMedia(user.meta.igUserId, user.meta.token, limit);
    const destination = websiteFor(user);
    const origin = requestOrigin(req);
    const enriched = await Promise.all(posts.map(async post => {
      const clickKey = `customer:social-clicks:${user.id}:${post.id}`;
      const clicks = Number(await kv.get(clickKey) || 0);
      let trackingUrl = '';
      if (destination) {
        const token = makeSocialLinkToken(user.id, post.id, destination);
        trackingUrl = `${origin}/api/social-link?t=${encodeURIComponent(token)}`;
      }
      return { ...post, clicks, trackingUrl };
    }));
    const missingInsights = enriched.some(post => post.insightsError && /permission|scope|authorized|access/i.test(post.insightsError));
    const payload = {
      username: user.meta.igUsername || '',
      syncedAt: new Date().toISOString(),
      destination,
      needsReconnect: missingInsights,
      posts: enriched,
      totals: {
        posts: enriched.length,
        views: metricTotal(enriched, 'views'),
        reach: metricTotal(enriched, 'reach'),
        interactions: metricTotal(enriched, 'interactions'),
        clicks: metricTotal(enriched, 'clicks') || 0,
      },
    };
    await kv.set(cacheKey, JSON.stringify(payload), { ex: 300 });
    res.status(200).json(payload);
  } catch (error) {
    console.error('Instagram insights error:', error.message);
    const reconnect = /permission|scope|authorized|access token|session/i.test(error.message || '');
    res.status(reconnect ? 403 : 502).json({ error: reconnect ? 'Reconnect Instagram once to allow post analytics.' : 'Instagram analytics could not load. Try again shortly.', needsReconnect: reconnect });
  }
}
