import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { contact, key } = req.body || {};

  if (key !== process.env.CRON_SECRET && key !== process.env.SUPPRESS_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  if (!contact) { res.status(400).json({ error: 'Missing contact' }); return; }

  function normPhone(s) {
    if (!s) return '';
    const d = String(s).replace(/[^0-9]/g, '');
    return d.length >= 10 ? d.slice(-10) : d;
  }
  function isPhone(s) {
    return String(s || '').replace(/[^0-9]/g, '').length >= 7;
  }
  function getKey(s) {
    if (!s) return '';
    if (isPhone(s)) return normPhone(s);
    return String(s).toLowerCase().trim();
  }

  const contactKey = getKey(contact);

  try {
    const raw = await kv.lrange('replies:log', 0, -1);
    const all = raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // Remove entries matching this contact (inbound from, outbound to)
    const kept = all.filter(r => {
      const rFrom = getKey(r.from || '');
      const rTo = getKey(r.to || '');
      return rFrom !== contactKey && rTo !== contactKey;
    });

    const removed = all.length - kept.length;

    if (removed === 0) {
      return res.status(200).json({ ok: true, removed: 0, message: 'Nothing to remove' });
    }

    // Rewrite the list
    await kv.del('replies:log');
    for (const entry of kept.reverse()) {
      await kv.lpush('replies:log', JSON.stringify(entry));
    }

    res.status(200).json({ ok: true, removed });
  } catch (e) {
    console.error('delete-conv error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
