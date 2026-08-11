const AUTOMATED_BURST_WINDOW_MS = 2 * 60 * 1000;
const AUTOMATED_BURST_MIN_VISITORS = 4;

function visitIdentity(visit) {
  return visit?.email || visit?.visitorId || visit?.sessionId || visit?.id;
}

function isOutreachVisit(visit) {
  const source = String(visit?.utmSource || '').trim().toLowerCase();
  return source === 'outreach' || source === 'out' || !!visit?.outreachId;
}

function normalizedLocation(visit) {
  const values = [visit?.city, visit?.region, visit?.country].map(value => {
    const raw = String(value || '').trim().replace(/\+/g, ' ');
    try { return decodeURIComponent(raw).toLowerCase(); } catch { return raw.toLowerCase(); }
  });
  return values.filter(Boolean).join('|');
}

// Email security services often execute JavaScript and can even navigate to a
// second page, which makes an individual scan look engaged. Their giveaway is
// the coordinated burst: several anonymous outreach identities from the same
// location and device within seconds. Flag the disposable browser identities,
// not the city itself, so a normal visitor from that location still counts.
export function automatedOutreachBurstIdentities(
  visits,
  windowMs = AUTOMATED_BURST_WINDOW_MS,
  minVisitors = AUTOMATED_BURST_MIN_VISITORS,
) {
  const groups = new Map();
  for (const visit of visits || []) {
    const identity = visitIdentity(visit);
    const timestamp = Date.parse(visit?.viewedAt || visit?.visitedAt || 0);
    const location = normalizedLocation(visit);
    if (!identity || visit?.email || !isOutreachVisit(visit) || !location || !Number.isFinite(timestamp)) continue;
    const device = String(visit?.device || 'unknown').trim().toLowerCase();
    const key = `${location}|${device}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ identity, timestamp });
  }

  const automated = new Set();
  for (const records of groups.values()) {
    records.sort((a, b) => a.timestamp - b.timestamp);
    let start = 0;
    const identityCounts = new Map();
    for (let end = 0; end < records.length; end += 1) {
      const current = records[end];
      identityCounts.set(current.identity, (identityCounts.get(current.identity) || 0) + 1);
      while (current.timestamp - records[start].timestamp > windowMs) {
        const expired = records[start++];
        const remaining = (identityCounts.get(expired.identity) || 1) - 1;
        if (remaining) identityCounts.set(expired.identity, remaining);
        else identityCounts.delete(expired.identity);
      }
      if (identityCounts.size >= minVisitors) {
        for (const identity of identityCounts.keys()) automated.add(identity);
      }
    }
  }
  return automated;
}
