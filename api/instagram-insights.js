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

function average(posts, key) {
  const values = posts.map(post => post[key]).filter(value => Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
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
      const [clicksValue, leadsValue, signupsValue] = await Promise.all([
        kv.get(clickKey),
        kv.get(`customer:social-leads:${user.id}:${post.id}`),
        kv.get(`customer:social-signups:${user.id}:${post.id}`),
      ]);
      const clicks = Number(clicksValue || 0), leads = Number(leadsValue || 0), signups = Number(signupsValue || 0);
      const engagementCount = Number.isFinite(post.interactions) ? post.interactions : [post.likes, post.comments, post.shares, post.saved].filter(Number.isFinite).reduce((total, value) => total + value, 0);
      const engagementRate = Number.isFinite(post.reach) && post.reach > 0 ? engagementCount / post.reach * 100 : null;
      let trackingUrl = '';
      if (destination) {
        const token = makeSocialLinkToken(user.id, post.id, destination);
        trackingUrl = `${origin}/api/social-link?t=${encodeURIComponent(token)}`;
      }
      return { ...post, clicks, leads, signups, engagementRate, trackingUrl };
    }));
    const averageEngagementRate = average(enriched, 'engagementRate');
    const compared = enriched.map(post => ({
      ...post,
      performanceVsAverage: Number.isFinite(post.engagementRate) && Number.isFinite(averageEngagementRate) && averageEngagementRate > 0
        ? (post.engagementRate - averageEngagementRate) / averageEngagementRate * 100
        : null,
    }));
    const insightValues = compared.flatMap(post => [post.views, post.reach, post.saved, post.shares, post.interactions]);
    const noInsightsReturned = compared.length > 0 && !insightValues.some(Number.isFinite);
    const missingInsights = compared.some(post => post.insightsError && /permission|scope|authorized|access/i.test(post.insightsError)) ||
      (noInsightsReturned && compared.some(post => post.insightsError));
    const payload = {
      username: user.meta.igUsername || '',
      syncedAt: new Date().toISOString(),
      destination,
      needsReconnect: missingInsights,
      posts: compared,
      totals: {
        posts: compared.length,
        views: metricTotal(compared, 'views'),
        reach: metricTotal(compared, 'reach'),
        interactions: metricTotal(compared, 'interactions'),
        clicks: metricTotal(compared, 'clicks') || 0,
        leads: metricTotal(compared, 'leads') || 0,
        signups: metricTotal(compared, 'signups') || 0,
      },
      averages: {
        views: average(compared, 'views'),
        reach: average(compared, 'reach'),
        interactions: average(compared, 'interactions'),
        engagementRate: averageEngagementRate,
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
