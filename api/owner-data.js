import { currentCustomer } from '../lib/customer-auth.js';
import { kv } from '@vercel/kv';

// Owner-only business data, gated by the owner's own customer login (no separate admin session).
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
const MOUNTAIN_TIME_ZONE = 'America/Denver';

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if ((user.email || '').toLowerCase() !== OWNER_EMAIL) { res.status(403).json({ error: 'Not authorized.' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const action = String((req.body && req.body.action) || '').toLowerCase();
  try {
    if (action === 'stats') {
      const keys = await kv.keys('customer:user:*');
      let verified = 0;
      const accounts = [];
      for (const k of keys) {
        let u = await kv.get(k);
        if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } }
        if (!u) continue;
        if (u.emailVerified) verified += 1;
        const sub = u.subscription || {};
        accounts.push({
          email: u.email,
          name: ((u.firstName || '') + ' ' + (u.lastName || '')).trim(),
          verified: !!u.emailVerified,
          plan: sub.plan || 'free',
          status: sub.status || 'active',
          billingMode: sub.billingMode || 'free',
          interval: sub.interval || 'monthly',
          aiUsed: u.usage?.aiUsed || 0,
          websites: u.usage?.websites || 0,
          createdAt: u.createdAt || null,
          updatedAt: u.updatedAt || null,
        });
      }
      accounts.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const day = mountainDay();
      const [siteUnique, uniqueToday, siteSessions, sessionsToday, sitePageviews, pageviewsToday] = await Promise.all([
        kv.get('stats:site:v2:unique'),
        kv.get(`stats:site:v2:unique:day:${day}`),
        kv.get('stats:site:v2:sessions'),
        kv.get(`stats:site:v2:sessions:day:${day}`),
        kv.get('stats:site:v2:pageviews'),
        kv.get(`stats:site:v2:pageviews:day:${day}`),
      ]);
      const rawVisitors = await kv.lrange('stats:site:v2:visitors', 0, 299);
      const visitors = (rawVisitors || []).map(value => {
        if (typeof value === 'object' && value) return value;
        try { return JSON.parse(value); } catch { return null; }
      }).filter(Boolean);
      const auditIds = await kv.lrange('growth:audits', 0, 199);
      const auditValues = auditIds.length ? await Promise.all(auditIds.map(id => kv.get(`growth:audit:${id}`))) : [];
      const auditLeads = auditValues.map(value => {
        if (typeof value === 'object' && value) return value;
        try { return JSON.parse(value); } catch { return null; }
      }).filter(Boolean).map(lead => ({
        id: lead.id, businessName: lead.businessName, website: lead.website, industry: lead.industry,
        email: lead.email, phone: lead.phone, goal: lead.goal, status: lead.status || 'New',
        score: Number(lead.report?.overallScore || 0), summary: lead.report?.summary || '', createdAt: lead.createdAt,
      }));
      res.status(200).json({
        total: keys.length,
        verified,
        unverified: keys.length - verified,
        accounts,
        siteUnique: Number(siteUnique || 0),
        uniqueToday: Number(uniqueToday || 0),
        siteSessions: Number(siteSessions || 0),
        sessionsToday: Number(sessionsToday || 0),
        sitePageviews: Number(sitePageviews || 0),
        pageviewsToday: Number(pageviewsToday || 0),
        analyticsTimeZone: MOUNTAIN_TIME_ZONE,
        analyticsQuality: {
          measurement: 'First-party browser tracking',
          ownerExcluded: true,
          botsExcluded: true,
          identity: 'Signed-in customers are identified by account; anonymous visitors use a privacy-safe browser ID.',
          limitations: 'Ad blockers, cleared storage, private browsing, VPNs, and approximate IP location can affect counts and location accuracy.',
        },
        visitors,
        auditLeads,
      });
      return;
    }

    if (action === 'delete') {
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      if (!email) { res.status(400).json({ error: 'Missing email' }); return; }
      if (email === OWNER_EMAIL) { res.status(400).json({ error: 'You cannot delete your own owner account.' }); return; }
      const id = await kv.get('customer:email:' + email);
      if (!id) { res.status(404).json({ error: 'Account not found' }); return; }
      await kv.del('customer:user:' + String(id));
      await kv.del('customer:email:' + email);
      res.status(200).json({ ok: true, deleted: email });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
