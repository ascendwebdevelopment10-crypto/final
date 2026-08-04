import { currentCustomer } from '../lib/customer-auth.js';
import { kv } from '@vercel/kv';
import { getEmailEvents, getEmailLog, getReplies } from '../lib/store.js';
import { ensureOutreachWebhook } from '../lib/outreach-webhook.js';

// Owner-only business data, gated by the owner's own customer login (no separate admin session).
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
const MOUNTAIN_TIME_ZONE = 'America/Denver';
const DATA_CENTER_CITIES = new Set(['council bluffs', 'ashburn', 'boardman', 'the dalles']);
const OUTREACH_TRACKING_START = Date.parse(process.env.OUTREACH_TRACKING_START || '2026-08-04T14:00:00.000Z');

function emailAddress(value) {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function isLikelyDataCenterVisit(visit) {
  const rawCity = String(visit?.city || '').trim().replace(/\+/g, ' ');
  let city = rawCity.toLowerCase();
  try { city = decodeURIComponent(rawCity).toLowerCase(); } catch {}
  return !visit?.email && DATA_CENTER_CITIES.has(city);
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
      const rawVisitors = await kv.lrange('stats:site:v2:visitors', 0, 999);
      const allVisitors = (rawVisitors || []).map(value => {
        if (typeof value === 'object' && value) return value;
        try { return JSON.parse(value); } catch { return null; }
      }).filter(Boolean);
      const excludedVisitors = allVisitors.filter(isLikelyDataCenterVisit);
      const visitors = allVisitors.filter(visit => !isLikelyDataCenterVisit(visit));
      const excludedUnique = new Set(excludedVisitors.map(visit => visit.visitorId).filter(Boolean)).size;
      const excludedSessions = new Set(excludedVisitors.map(visit => visit.sessionId).filter(Boolean)).size;
      const excludedToday = excludedVisitors.filter(visit => mountainDay(new Date(visit.viewedAt || visit.visitedAt || 0)) === day);
      const excludedUniqueToday = new Set(excludedToday.map(visit => visit.visitorId).filter(Boolean)).size;
      const excludedSessionsToday = new Set(excludedToday.map(visit => visit.sessionId).filter(Boolean)).size;
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
        siteUnique: Math.max(0, Number(siteUnique || 0) - excludedUnique),
        uniqueToday: Math.max(0, Number(uniqueToday || 0) - excludedUniqueToday),
        siteSessions: Math.max(0, Number(siteSessions || 0) - excludedSessions),
        sessionsToday: Math.max(0, Number(sessionsToday || 0) - excludedSessionsToday),
        sitePageviews: Math.max(0, Number(sitePageviews || 0) - excludedVisitors.length),
        pageviewsToday: Math.max(0, Number(pageviewsToday || 0) - excludedToday.length),
        analyticsTimeZone: MOUNTAIN_TIME_ZONE,
        analyticsQuality: {
          measurement: 'First-party browser tracking',
          ownerExcluded: true,
          botsExcluded: true,
          dataCenterTrafficExcluded: true,
          identity: 'Signed-in customers are identified by account; anonymous visitors use a privacy-safe browser ID.',
          limitations: 'Ad blockers, cleared storage, private browsing, VPNs, and approximate IP location can affect counts and location accuracy.',
        },
        visitors,
        auditLeads,
      });
      return;
    }

    if (action === 'outreach') {
      const [allLog, allReplies, events, webhook] = await Promise.all([getEmailLog(300), getReplies(300), getEmailEvents(), ensureOutreachWebhook()]);
      const replies = allReplies.filter(reply => Number(reply.timestamp || 0) >= OUTREACH_TRACKING_START);
      const repliesBySender = new Map();
      for (const reply of replies) {
        const sender = emailAddress(reply.from);
        if (sender && !repliesBySender.has(sender)) repliesBySender.set(sender, reply);
      }
      const log = allLog
        .filter(entry => Number(entry.timestamp || 0) >= OUTREACH_TRACKING_START)
        .map(entry => {
          const providerEvent = entry.providerId ? events[entry.providerId] : null;
          const reply = repliesBySender.get(emailAddress(entry.to));
          return {
            ...entry,
            status: reply ? 'replied' : (providerEvent?.status || entry.status || 'sent'),
            statusAt: reply?.timestamp || providerEvent?.timestamp || entry.timestamp,
            statusDetail: providerEvent?.detail || '',
            replied: !!reply,
            reply: reply ? { from: reply.from, subject: reply.subject, body: reply.body, timestamp: reply.timestamp } : null,
          };
        });
      const today = mountainDay();
      const todayCount = log.filter(entry => mountainDay(new Date(entry.timestamp)) === today).length;
      const replied = log.filter(entry => entry.replied).length;
      const delivered = log.filter(entry => ['delivered', 'replied'].includes(entry.status)).length;
      const failed = log.filter(entry => ['bounced', 'failed', 'complained', 'suppressed'].includes(entry.status)).length;
      res.status(200).json({
        trackingStart: new Date(OUTREACH_TRACKING_START).toISOString(),
        webhook,
        log,
        stats: { todayEmailSent: todayCount, totalEmailSent: log.length, emailReplies: replied, delivered, failed },
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
