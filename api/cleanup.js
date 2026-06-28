import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const secret = req.query.key || req.headers['x-secret'];
  if (secret !== process.env.CRON_SECRET && secret !== process.env.SUPPRESS_API_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Read all replies
  const raw = await kv.lrange('replies:log', 0, -1);
  const all = raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);

  // Filter out fake test numbers
  const fakeNums = ['+12125550199', '+12345550199', '+12345550100'];
  function normPhone(n) { return (n || '').replace(/\D/g, '').slice(-10); }
  const fakeNorms = fakeNums.map(normPhone);

  const cleaned = all.filter(r => {
    const from = r.from || '';
    return !fakeNorms.includes(normPhone(from));
  });

  const removed = all.length - cleaned.length;

  if (removed === 0) {
    return res.status(200).json({ ok: true, message: 'Nothing to remove', total: all.length });
  }

  // Rewrite the list
  await kv.del('replies:log');
  for (const entry of cleaned.reverse()) {
    await kv.lpush('replies:log', JSON.stringify(entry));
  }

  // Fix stats counter
  await kv.set('stats:sms_replies', cleaned.filter(r => r.type === 'sms_reply').length);

  return res.status(200).json({ ok: true, removed, remaining: cleaned.length });
}
