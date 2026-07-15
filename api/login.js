import { kv } from '@vercel/kv';
import { verifyPassword, makeSessionCookie, logoutCookie } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (req.body && req.body.action === 'logout') {
    res.setHeader('Set-Cookie', logoutCookie());
    res.status(200).json({ ok: true });
    return;
  }

  // Brute-force throttle: 15 failed attempts locks login for 10 minutes.
  let fails = 0;
  try { fails = parseInt((await kv.get('auth:login_fails')) || '0', 10); } catch {}
  if (fails >= 15) {
    res.status(429).json({ error: 'Too many failed attempts. Try again in ~10 minutes.' });
    return;
  }

  const ok = verifyPassword(req.body && req.body.password);
  if (!ok) {
    try {
      const n = await kv.incr('auth:login_fails');
      if (n === 1) await kv.expire('auth:login_fails', 600);
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
    res.status(401).json({ error: 'Wrong password' });
    return;
  }

  try { await kv.del('auth:login_fails'); } catch {}
  res.setHeader('Set-Cookie', makeSessionCookie());
  res.status(200).json({ ok: true });
}
