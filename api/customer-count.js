import { isAuthorized } from '../lib/auth.js';
import { kv } from '@vercel/kv';

// Admin-only: how many customer accounts exist, and how many verified their email.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthorized(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const keys = await kv.keys('customer:user:*');
    let verified = 0;
    const emails = [];
    for (const k of keys) {
      const u = await kv.get(k);
      if (u) {
        if (u.emailVerified) verified += 1;
        emails.push({ email: u.email, verified: !!u.emailVerified, plan: u.subscription?.plan || 'free', createdAt: u.createdAt || null });
      }
    }
    res.status(200).json({ total: keys.length, verified, unverified: keys.length - verified, accounts: emails });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
