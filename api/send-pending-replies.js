import { kv } from '@vercel/kv';

const CRON_SECRET = process.env.CRON_SECRET;

// Auto-replies are DISABLED — Ty answers every reply manually using the suggested
// reply that gets texted to him. This job now just drains any leftover queue so
// nothing old ever auto-sends.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }
  const auth = req.headers['authorization'];
  if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) { res.status(401).end('Unauthorized'); return; }
  let cleared = 0;
  try {
    const raw = await kv.lrange('sms:pending_replies', 0, -1);
    cleared = raw.length;
    if (cleared) await kv.del('sms:pending_replies');
  } catch (e) {
    return res.status(200).json({ sent: 0, cleared, error: e.message });
  }
  res.status(200).json({ sent: 0, cleared, note: 'auto-replies disabled', timestamp: new Date().toISOString() });
}
