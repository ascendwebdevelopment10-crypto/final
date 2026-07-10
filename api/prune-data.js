import { kv } from '@vercel/kv';

// One-shot maintenance endpoint: prune SMS + email (+ reply) history to the last
// N days (default 4) and reset the running counters to 0, so the dashboard
// "restarts" while keeping recent activity. Intentionally does NOT touch the
// suppression list or the already-contacted / auto-replied sets, so pruning
// never causes anyone to be re-texted or re-emailed.
export const config = { maxDuration: 60 };

const KEEP_DAYS_DEFAULT = 4;

async function pruneList(key, cutoff) {
  const raw = await kv.lrange(key, 0, -1);
  const parsed = raw.map(r => (typeof r === 'string' ? JSON.parse(r) : r));
  const kept = parsed.filter(e => (e.timestamp || 0) >= cutoff);
  await kv.del(key);
  // lpush prepends, so push oldest-first to preserve the original newest-first order.
  for (const e of kept.reverse()) await kv.lpush(key, JSON.stringify(e));
  return { before: parsed.length, kept: kept.length };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const secret = process.env.CRON_SECRET;
  const suppressSecret = process.env.SUPPRESS_API_SECRET;
  const auth = req.headers['authorization'];
  const bodyKey = (req.body && req.body.key) || (req.query && req.query.key);
  const authorized =
    (secret && auth === 'Bearer ' + secret) ||
    (secret && bodyKey === secret) ||
    (suppressSecret && bodyKey === suppressSecret);
  if (!authorized) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const keepDays = parseInt((req.body && req.body.keepDays) || (req.query && req.query.keepDays) || KEEP_DAYS_DEFAULT, 10);
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;

  try {
    const results = {};
    results.sms = await pruneList('sms:log', cutoff);
    results.email = await pruneList('email:log', cutoff);
    results.replies = await pruneList('replies:log', cutoff);

    // Reset running totals to 0 — "restart" the dashboard counters.
    const zeroKeys = [
      'stats:total_sent', 'stats:replies', 'stats:unsubscribed',
      'stats:sms_total_sent', 'stats:sms_replies', 'stats:followup_sms',
      'stats:calls_made', 'stats:calls_answered',
    ];
    for (const k of zeroKeys) await kv.set(k, 0);

    // Clear per-day counters (they rebuild as new sends happen).
    try {
      const dailyKeys = await kv.keys('stats:daily:*');
      const smsDailyKeys = await kv.keys('stats:sms_daily:*');
      const all = [...(dailyKeys || []), ...(smsDailyKeys || [])];
      if (all.length) await kv.del(...all);
      results.dailyKeysCleared = all.length;
    } catch (e) {
      results.dailyKeysError = e.message;
    }

    res.status(200).json({ ok: true, keepDays, cutoff, cutoffISO: new Date(cutoff).toISOString(), results, timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
