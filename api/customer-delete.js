import { isAuthorized } from '../lib/auth.js';
import { kv } from '@vercel/kv';

// Admin-only: permanently delete a customer account (owner dashboard action).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!email) { res.status(400).json({ error: 'Missing email' }); return; }

  try {
    const id = await kv.get('customer:email:' + email);
    if (!id) { res.status(404).json({ error: 'Account not found' }); return; }
    await kv.del('customer:user:' + String(id));
    await kv.del('customer:email:' + email);
    res.status(200).json({ ok: true, deleted: email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
