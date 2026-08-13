import { currentCustomer } from '../lib/customer-auth.js';
import { kv } from '@vercel/kv';
import { getEmailEngagement, getEmailEvents, getEmailLog, getReplies } from '../lib/store.js';
import { ensureOutreachWebhook } from '../lib/outreach-webhook.js';
import { funnelSummary } from '../lib/funnel.js';
import { automatedOutreachBurstIdentities } from '../lib/analytics-traffic.js';
import { automatedOpenIds, likelyHumanOpen } from '../lib/outreach-analytics.js';

// Owner-only business data, gated by the owner's own customer login (no separate admin session).
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();
const MOUNTAIN_TIME_ZONE = 'America/Denver';
const DATA_CENTER_CITIES = new Set(['council bluffs', 'ashburn', 'boardman', 'the dalles', 'boydton']);
const OUTREACH_TRACKING_START = Date.parse(process.env.OUTREACH_TRACKING_START || '2026-08-04T14:00:00.000Z');
const SITE_VISIT_TRACKING_START = Date.parse(process.env.SITE_VISIT_TRACKING_START || '2026-08-04T20:33:00.000Z');
const CONFIRMED_VISIT_TRACKING_START = Date.parse(process.env.CONFIRMED_VISIT_TRACKING_START || '2026-08-06T16:15:00.000Z');
// The first two audit submissions were owner QA runs, not leads. Keep the
// historical cleanup bounded so no genuine request after this release is lost.
const AUDIT_LEAD_CLEAN_START = Date.parse('2026-08-13T02:28:01.000Z');

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

function isOutreachVisit(visit) {
  const source = String(visit?.utmSource || '').trim().toLowerCase();
  return source === 'outreach' || source === 'out' || !!visit?.outreachId;
}

function visitIdentity(visit) {
  return visit?.email || visit?.visitorId || visit?.sessionId || visit?.id;
}

function isConfirmedOutreachVisit(visit, confirmedSessions) {
  return !!(visit?.outreachId && visit?.sessionId && confirmedSessions?.[`${visit.outreachId}:${visit.sessionId}`]);
}

function collapseRapidPageViews(visits, windowMs = 60000) {
  const ordered = [...visits].sort((a, b) => Date.parse(a.viewedAt || a.visitedAt || 0) - Date.parse(b.viewedAt || b.visitedAt || 0));
  const kept = [];
  const recent = new Map();
  for (const visit of ordered) {
    const path = String(visit.path || '/').split('?')[0].split('#')[0] || '/';
    const identity = visit.email || visit.visitorId || visit.sessionId || visit.id;
    const key = `${identity}:${path}`;
    const timestamp = Date.parse(visit.viewedAt || visit.visitedAt || 0);
    const previous = recent.get(key);
    if (previous && Number.isFinite(timestamp) && timestamp - previous.timestamp <= windowMs) {
      if (!previous.visit.utmSource && visit.utmSource) Object.assign(previous.visit, {
        utmSource: visit.utmSource, utmMedium: visit.utmMedium, utmCampaign: visit.utmCampaign,
      });
      continue;
    }
    const copy = { ...visit };
    kept.push(copy);
    recent.set(key, { timestamp, visit: copy });
  }
  return kept.sort((a, b) => Date.parse(b.viewedAt || b.visitedAt || 0) - Date.parse(a.viewedAt || a.visitedAt || 0));
}

function sourceLabel(visit) {
  const source = String(visit?.utmSource || '').trim().toLowerCase();
  if (source === 'outreach' || source === 'out' || visit?.outreachId) return 'Email outreach';
  if (['ig', 'instagram', 'igshopping'].includes(source)) return 'Instagram';
  if (['fb', 'facebook', 'meta'].includes(source)) return 'Facebook';
  if (['google', 'adwords'].includes(source)) return source === 'adwords' ? 'Google Ads' : 'Google';
  if (source) return source.charAt(0).toUpperCase() + source.slice(1);
  const referrer = String(visit?.referrer || '').trim().toLowerCase();
  if (!referrer || ['null', 'undefined', '-'].includes(referrer)) return 'Direct / unknown';
  if (referrer.includes('instagram')) return 'Instagram';
  if (referrer.includes('facebook')) return 'Facebook';
  if (referrer.includes('google')) return 'Google';
  if (referrer.includes('bing')) return 'Bing';
  if (referrer.includes('linkedin')) return 'LinkedIn';
  if (referrer.includes('nitrooutreach.com')) return 'On-site link';
  try { return new URL(referrer).hostname.replace(/^www\./, ''); } catch { return referrer; }
}

function groupVisitSessions(visits, windowMs = 30 * 60 * 1000) {
  const ordered = [...visits].sort((a, b) => Date.parse(a.viewedAt || a.visitedAt || 0) - Date.parse(b.viewedAt || b.visitedAt || 0));
  const sessions = [];
  const latestByVisitor = new Map();
  for (const visit of ordered) {
    const timestamp = Date.parse(visit.viewedAt || visit.visitedAt || 0);
    const identity = visit.email || visit.visitorId || visit.sessionId || visit.id;
    const previous = latestByVisitor.get(identity);
    const sameSession = previous && Number.isFinite(timestamp) && timestamp - previous.lastTimestamp <= windowMs;
    const path = String(visit.path || '/').split('?')[0].split('#')[0] || '/';
    if (sameSession) {
      previous.lastTimestamp = timestamp;
      previous.session.lastViewedAt = visit.viewedAt || visit.visitedAt;
      previous.session.viewCount += 1;
      if (!previous.session.pages.includes(path)) previous.session.pages.push(path);
      if (sourceLabel(previous.session) === 'Direct / unknown' && sourceLabel(visit) !== 'Direct / unknown') {
        Object.assign(previous.session, { referrer: visit.referrer, utmSource: visit.utmSource, utmMedium: visit.utmMedium, utmCampaign: visit.utmCampaign });
      }
      continue;
    }
    const session = { ...visit, firstViewedAt: visit.viewedAt || visit.visitedAt, lastViewedAt: visit.viewedAt || visit.visitedAt, viewCount: 1, pages: [path] };
    sessions.push(session);
    latestByVisitor.set(identity, { lastTimestamp: timestamp, session });
  }
  return sessions.sort((a, b) => Date.parse(b.lastViewedAt || 0) - Date.parse(a.lastViewedAt || 0));
}

function groupVisitors(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const identity = session.email || session.visitorId || session.sessionId || session.id;
    let group = groups.get(identity);
    if (!group) {
      group = { ...session, sessionCount: 0, viewCount: 0, pages: [], sessions: [] };
      groups.set(identity, group);
    }
    group.sessionCount += 1;
    group.viewCount += Number(session.viewCount || 1);
    if (Date.parse(session.firstViewedAt || 0) < Date.parse(group.firstViewedAt || 0)) group.firstViewedAt = session.firstViewedAt;
    if (Date.parse(session.lastViewedAt || 0) >= Date.parse(group.lastViewedAt || 0)) {
      Object.assign(group, {
        lastViewedAt: session.lastViewedAt,
        city: session.city, region: session.region, country: session.country, device: session.device,
        referrer: session.referrer, utmSource: session.utmSource, utmMedium: session.utmMedium,
        utmCampaign: session.utmCampaign, outreachId: session.outreachId || group.outreachId,
      });
    }
    for (const path of session.pages || [session.path || '/']) {
      if (!group.pages.includes(path)) group.pages.push(path);
    }
    group.sessions.push({
      firstViewedAt: session.firstViewedAt,
      lastViewedAt: session.lastViewedAt,
      viewCount: Number(session.viewCount || 1),
      pages: session.pages || [session.path || '/'],
      outreachId: session.outreachId || '',
    });
  }
  return [...groups.values()].sort((a, b) => Date.parse(b.lastViewedAt || 0) - Date.parse(a.lastViewedAt || 0));
}

export function enrichVisitorsWithOutreach(visitors, outreachLog) {
  const outreachById = new Map((outreachLog || []).map(entry => [String(entry?.id || ''), entry]));
  return (visitors || []).map(visitor => {
    const outreachIds = [visitor.outreachId, ...(visitor.sessions || []).map(session => session.outreachId)].filter(Boolean);
    const entry = outreachIds.map(id => outreachById.get(String(id))).find(Boolean);
    if (!entry) return visitor;
    return {
      ...visitor,
      businessName: entry.contactName || '',
      businessLocation: entry.businessLocation || '',
      businessWebsite: entry.businessWebsite || '',
      contactEmail: entry.to || '',
      industry: entry.industry || '',
      targetSegment: entry.targetSegment || '',
    };
  });
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

function happenedOnMountainDay(value, day) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && mountainDay(date) === day;
}

async function recentResendEvents() {
  if (!process.env.RESEND_API_KEY) return new Map();
  try {
    const response = await fetch('https://api.resend.com/emails?limit=100', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (!response.ok) return new Map();
    const payload = await response.json();
    return new Map((payload.data || []).map(email => [String(email.id || ''), String(email.last_event || 'sent')]));
  } catch {
    return new Map();
  }
}

function deliveryStatus(status) {
  const value = String(status || 'sent').replace(/^email\./, '');
  return ['opened', 'clicked'].includes(value) ? 'delivered' : value;
}

export function resolvedDeliveryStatus({ providerStatus, webhookStatus, replied }) {
  const provider = deliveryStatus(providerStatus);
  const webhook = deliveryStatus(webhookStatus);
  const failureStatuses = new Set(['bounced', 'failed', 'complained', 'suppressed']);
  const failure = [webhook, provider].find(status => failureStatuses.has(status));
  if (failure) return failure;
  if (replied) return 'replied';
  if (provider === 'delivered' || webhook === 'delivered') return 'delivered';
  if (webhook === 'delivery_delayed' || provider === 'delivery_delayed') return 'delivery_delayed';
  return webhook !== 'sent' ? webhook : provider;
}

export function firstDeliveryEvidence(entry, providerEvent, reply) {
  const providerDeliveredAt = deliveryStatus(providerEvent?.status) === 'delivered' ? Number(providerEvent?.timestamp || 0) : 0;
  const candidates = [providerDeliveredAt, Number(reply?.timestamp || 0)]
    .filter(value => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : Number(entry.timestamp || 0) || null;
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
      const productActivity = {
        contentCreated: 0,
        reelsCreated: 0,
        socialPublished: 0,
        socialScheduled: 0,
        outreachSent: 0,
        outreachReplies: 0,
        activeCampaigns: 0,
        connectedSocials: 0,
      };
      for (const k of keys) {
        let u = await kv.get(k);
        if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = null; } }
        if (!u) continue;
        // Owner/test activity is useful inside the owner's own workspace, but it
        // must never inflate customer acquisition or product-usage reporting.
        if (String(u.email || '').trim().toLowerCase() === OWNER_EMAIL) continue;
        if (u.emailVerified) verified += 1;
        const sub = u.subscription || {};
        const workspace = u.workspace || {};
        const content = Array.isArray(workspace.content) ? workspace.content : [];
        const socialDrafts = Array.isArray(workspace.socialDrafts) ? workspace.socialDrafts : [];
        const messages = Array.isArray(workspace.messages) ? workspace.messages : [];
        const campaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : [];
        const socialConnections = Object.values(u.socialConnections || {}).filter(connection => connection?.connected).length + (u.meta?.igUserId ? 1 : 0);
        productActivity.contentCreated += content.length;
        productActivity.reelsCreated += content.filter(item => item.type === 'video').length;
        productActivity.socialPublished += content.filter(item => item.postedToInstagram).length + socialDrafts.filter(item => item.status === 'published').length;
        productActivity.socialScheduled += socialDrafts.filter(item => item.status === 'scheduled').length;
        productActivity.outreachSent += messages.filter(item => item.status === 'sent').length;
        productActivity.outreachReplies += messages.filter(item => item.status === 'reply').length;
        productActivity.activeCampaigns += campaigns.filter(item => item.status === 'active').length;
        productActivity.connectedSocials += socialConnections;
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
      const [rawVisitors, outreachLog] = await Promise.all([
        kv.lrange('stats:site:v2:visitors', 0, 999),
        getEmailLog(1000),
      ]);
      const allVisitors = (rawVisitors || []).map(value => {
        if (typeof value === 'object' && value) return value;
        try { return JSON.parse(value); } catch { return null; }
      }).filter(Boolean);
      const confirmedSessions = await kv.hgetall('email:confirmed-visits:sessions');
      const automatedBurstIdentities = automatedOutreachBurstIdentities(allVisitors);
      const isExcludedVisit = visit => {
        const identity = visitIdentity(visit);
        return isLikelyDataCenterVisit(visit)
          || (!!identity && automatedBurstIdentities.has(identity))
          || (isOutreachVisit(visit) && !isConfirmedOutreachVisit(visit, confirmedSessions));
      };
      const excludedVisitors = allVisitors.filter(isExcludedVisit);
      const cleanVisitors = collapseRapidPageViews(allVisitors.filter(visit => !isExcludedVisit(visit)));
      const visitors = groupVisitSessions(cleanVisitors);
      const visitorGroups = enrichVisitorsWithOutreach(groupVisitors(visitors), outreachLog);
      const cleanToday = cleanVisitors.filter(visit => mountainDay(new Date(visit.viewedAt || visit.visitedAt || 0)) === day);
      const visitorsToday = groupVisitSessions(cleanToday);
      const uniqueVisitors = new Set(cleanVisitors.map(visit => visit.email || visit.visitorId).filter(Boolean)).size;
      const uniqueVisitorsToday = new Set(cleanToday.map(visit => visit.email || visit.visitorId).filter(Boolean)).size;
      const sourceCounts = new Map();
      for (const visit of visitors) {
        const label = sourceLabel(visit);
        sourceCounts.set(label, (sourceCounts.get(label) || 0) + 1);
      }
      const sourceBreakdown = [...sourceCounts.entries()].map(([source, sessions]) => ({ source, sessions })).sort((a, b) => b.sessions - a.sessions);
      const auditIds = await kv.lrange('growth:audits', 0, 199);
      const auditValues = auditIds.length ? await Promise.all(auditIds.map(id => kv.get(`growth:audit:${id}`))) : [];
      const parsedAuditLeads = auditValues.map(value => {
        if (typeof value === 'object' && value) return value;
        try { return JSON.parse(value); } catch { return null; }
      }).filter(Boolean);
      const ownerAuditTests = parsedAuditLeads.filter(lead => Date.parse(lead.createdAt || 0) < AUDIT_LEAD_CLEAN_START).slice(0, 2);
      if (ownerAuditTests.length) {
        await Promise.all(ownerAuditTests.flatMap(lead => [
          kv.del(`growth:audit:${lead.id}`),
          kv.lrem('growth:audits', 0, lead.id),
        ]));
      }
      const removedAuditIds = new Set(ownerAuditTests.map(lead => lead.id));
      const auditLeads = parsedAuditLeads.filter(lead => !removedAuditIds.has(lead.id)).map(lead => ({
        id: lead.id, businessName: lead.businessName, website: lead.website, industry: lead.industry,
        email: lead.email, phone: lead.phone, goal: lead.goal, status: lead.status || 'New',
        score: Number(lead.report?.overallScore || 0), summary: lead.report?.summary || '', createdAt: lead.createdAt,
      }));
      let funnel = [];
      try { funnel = await funnelSummary(); } catch {}
      res.status(200).json({
        total: accounts.length,
        verified,
        unverified: accounts.length - verified,
        accounts,
        siteUnique: uniqueVisitors,
        uniqueToday: uniqueVisitorsToday,
        siteSessions: visitors.length,
        sessionsToday: visitorsToday.length,
        sitePageviews: cleanVisitors.length,
        pageviewsToday: cleanToday.length,
        analyticsTimeZone: MOUNTAIN_TIME_ZONE,
        analyticsQuality: {
          measurement: 'First-party browser tracking',
          ownerExcluded: true,
          botsExcluded: true,
          dataCenterTrafficExcluded: true,
          identity: 'Signed-in customers are identified by account; anonymous visitors use a privacy-safe browser ID.',
          limitations: 'Rapid repeat loads are collapsed and page views are grouped into 30-minute visits. Unconfirmed outreach link loads, coordinated scanner bursts, and known data-center locations are excluded. Location is approximate and held consistent per browser for seven days; VPNs and private relays can still affect it.',
        },
        visitors,
        visitorGroups,
        sourceBreakdown,
        excludedAutomated: excludedVisitors.length,
        auditLeads,
        funnel,
        productActivity,
      });
      return;
    }

    if (action === 'outreach') {
      const [allLog, allReplies, events, engagement, webhook, resendEvents, confirmedCounts, confirmedFirst, confirmedLast, confirmedReasons, confirmedUrls] = await Promise.all([
        getEmailLog(null), getReplies(1000), getEmailEvents(), getEmailEngagement(), ensureOutreachWebhook(), recentResendEvents(),
        kv.hgetall('email:confirmed-visits:count'), kv.hgetall('email:confirmed-visits:first'),
        kv.hgetall('email:confirmed-visits:last'), kv.hgetall('email:confirmed-visits:reason'),
        kv.hgetall('email:confirmed-visits:url'),
      ]);
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
          const providerStatus = resendEvents.get(String(entry.providerId || '')) || providerEvent?.status || entry.status || 'sent';
          const reply = repliesBySender.get(emailAddress(entry.to));
          const openCount = Number(engagement.opens?.[entry.id] || 0);
          const knownAutomatedOpenCount = Number(engagement.automatedOpens?.[entry.id] || 0);
          const firstOpenedAt = Number(engagement.opensFirst?.[entry.id] || 0) || null;
          const lastOpenedAt = Number(engagement.opensLast?.[entry.id] || 0) || null;
          const visitCount = Number(engagement.clicks?.[entry.id] || 0);
          const firstVisitedAt = Number(engagement.clicksFirst?.[entry.id] || 0) || null;
          const lastVisitedAt = Number(engagement.clicksLast?.[entry.id] || 0) || null;
          const confirmedVisitCount = Number(confirmedCounts?.[entry.id] || 0);
          const firstConfirmedAt = Number(confirmedFirst?.[entry.id] || 0) || null;
          const lastConfirmedAt = Number(confirmedLast?.[entry.id] || 0) || null;
          const normalizedProviderStatus = resolvedDeliveryStatus({
            providerStatus,
            webhookStatus: providerEvent?.status,
            replied: !!reply,
          });
          const deliveredAt = ['delivered', 'replied'].includes(normalizedProviderStatus)
            ? firstDeliveryEvidence(entry, providerEvent, reply)
            : null;
          return {
            ...entry,
            status: normalizedProviderStatus,
            statusAt: reply?.timestamp || providerEvent?.timestamp || entry.timestamp,
            deliveredAt,
            statusDetail: providerEvent?.detail || (
              normalizedProviderStatus === 'delivered' && !['delivered', 'opened', 'clicked'].includes(deliveryStatus(providerStatus))
                ? 'Confirmed by recipient activity'
                : ''
            ),
            openCount,
            knownAutomatedOpenCount,
            opened: openCount > 0,
            firstOpenedAt,
            lastOpenedAt,
            visitCount,
            visitedSite: visitCount > 0,
            firstVisitedAt,
            lastVisitedAt,
            visitedPath: engagement.clicksUrl?.[entry.id] || '',
            linkLoaded: visitCount > 0,
            confirmedVisitCount,
            confirmedVisit: confirmedVisitCount > 0,
            firstConfirmedAt,
            lastConfirmedAt,
            confirmedReason: confirmedReasons?.[entry.id] || '',
            confirmedPath: confirmedUrls?.[entry.id] || '',
            replied: !!reply,
            reply: reply ? { from: reply.from, subject: reply.subject, body: reply.body, timestamp: reply.timestamp } : null,
          };
        });
      const automatedOpens = automatedOpenIds(log);
      for (const entry of log) {
        entry.automatedOpen = automatedOpens.has(entry.id);
        entry.likelyHumanOpen = likelyHumanOpen(entry, automatedOpens);
      }
      const today = mountainDay();
      const todayLog = log.filter(entry => happenedOnMountainDay(entry.timestamp, today));
      const todayCount = todayLog.length;
      const replied = log.filter(entry => entry.replied).length;
      const delivered = log.filter(entry => ['delivered', 'replied'].includes(entry.status)).length;
      const rawOpened = log.filter(entry => entry.opened).length;
      const opened = log.filter(entry => entry.likelyHumanOpen).length;
      const filteredOpens = log.filter(entry => entry.automatedOpen).length;
      const linkLoads = log.filter(entry => entry.linkLoaded).length;
      const confirmedVisits = log.filter(entry => entry.confirmedVisit).length;
      const failed = log.filter(entry => ['bounced', 'failed', 'complained', 'suppressed'].includes(entry.status)).length;
      const todayReplied = log.filter(entry => entry.replied && happenedOnMountainDay(entry.reply?.timestamp, today)).length;
      const todayDelivered = log.filter(entry => ['delivered', 'replied'].includes(entry.status) && happenedOnMountainDay(entry.deliveredAt, today)).length;
      const todayOpened = log.filter(entry => entry.likelyHumanOpen && happenedOnMountainDay(entry.firstOpenedAt, today)).length;
      const todayFilteredOpens = log.filter(entry => entry.automatedOpen && happenedOnMountainDay(entry.firstOpenedAt, today)).length;
      const todayLinkLoads = log.filter(entry => entry.linkLoaded && happenedOnMountainDay(entry.firstVisitedAt, today)).length;
      const todayConfirmedVisits = log.filter(entry => entry.confirmedVisit && happenedOnMountainDay(entry.firstConfirmedAt, today)).length;
      const todayFailed = log.filter(entry => ['bounced', 'failed', 'complained', 'suppressed'].includes(entry.status) && happenedOnMountainDay(entry.statusAt, today)).length;
      for (const entry of log) {
        entry.rawOpenCount = entry.openCount;
        entry.opened = entry.likelyHumanOpen;
        if (!entry.likelyHumanOpen) entry.openCount = 0;
      }
      res.status(200).json({
        trackingStart: new Date(OUTREACH_TRACKING_START).toISOString(),
        siteVisitTrackingStart: new Date(SITE_VISIT_TRACKING_START).toISOString(),
        confirmedVisitTrackingStart: new Date(CONFIRMED_VISIT_TRACKING_START).toISOString(),
        webhook,
        log: log.slice(0, 500),
        logCount: log.length,
        stats: {
          todayEmailSent: todayCount,
          totalEmailSent: log.length,
          emailReplies: replied,
          todayEmailReplies: todayReplied,
          delivered,
          todayDelivered,
          opened,
          todayOpened,
          rawOpened,
          filteredOpens,
          todayFilteredOpens,
          linkLoads,
          todayLinkLoads,
          confirmedVisits,
          todayConfirmedVisits,
          visitedSite: confirmedVisits,
          failed,
          todayFailed,
        },
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
