import { isAuthorized } from '../lib/auth.js';
import { kv } from '@vercel/kv';

// Admin-only: list customer accounts with status + billing for the owner dashboard.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
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
        cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
        aiUsed: u.usage?.aiUsed || 0,
        websites: u.usage?.websites || 0,
        onboarded: !!u.onboarding?.completed,
        createdAt: u.createdAt || null,
      });
    }
    accounts.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.status(200).json({ total: keys.length, verified, unverified: keys.length - verified, accounts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
