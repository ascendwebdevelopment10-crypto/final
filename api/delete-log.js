import { isAuthorized } from '../lib/auth.js';
import { kv } from '@vercel/kv';

const LISTS = { email: 'email:log', sms: 'sms:log', replies: 'replies:log' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { list, id, to, timestamp } = req.body || {};
  const kvKey = LISTS[list];
  if (!kvKey) { res.status(400).json({ error: 'Unknown list' }); return; }

  try {
    const raw = await kv.lrange(kvKey, 0, -1);
    const all = raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);

    let matched = false;
    const kept = all.filter(function (e) {
      if (matched) return true; // only remove the first match
      let isMatch;
      if (id != null && id !== '' && e.id != null) {
        isMatch = String(e.id) === String(id);
      } else {
        isMatch = String(e.to || '') === String(to || '') && String(e.timestamp || '') === String(timestamp || '');
      }
      if (isMatch) { matched = true; return false; }
      return true;
    });

    if (!matched) { res.status(200).json({ ok: true, removed: 0 }); return; }

    await kv.del(kvKey);
    for (const e of kept.reverse()) await kv.lpush(kvKey, JSON.stringify(e));

    res.status(200).json({ ok: true, removed: 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
