import { currentCustomer } from '../lib/customer-auth.js';
import { kv } from '@vercel/kv';

// Owner-only business data, gated by the owner's own customer login (no separate admin session).
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();

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
      const day = new Date().toISOString().slice(0, 10);
      const landingViews = Number((await kv.get('stats:landing:views')) || 0);
      const landingToday = Number((await kv.get('stats:landing:day:' + day)) || 0);
      const rawVisitors = await kv.lrange('stats:landing:visitors', 0, 199);
      const visitors = (rawVisitors || []).map(value => {
        if (typeof value === 'object' && value) return value;
        try { return JSON.parse(value); } catch { return null; }
      }).filter(Boolean);
      res.status(200).json({ total: keys.length, verified, unverified: keys.length - verified, accounts, landingViews, landingToday, visitors });
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
