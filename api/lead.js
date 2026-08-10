import { kv } from '@vercel/kv';
import { notifyBestEffort } from '../lib/ntfy.js';

// Landing-page email capture. Works WITH and WITHOUT JavaScript: the static
// hero form posts here (form-encoded), we store the lead, then 303-redirect the
// visitor into /signup with their email prefilled. No auth. Never hard-fails.

function readEmail(req) {
  // Vercel auto-parses JSON and urlencoded bodies into req.body.
  const b = req.body;
  let email = '';
  if (b && typeof b === 'object') email = b.email || '';
  else if (typeof b === 'string') {
    try { email = JSON.parse(b).email || ''; }
    catch { email = new URLSearchParams(b).get('email') || ''; }
  }
  if (!email && req.query) email = req.query.email || '';
  return String(email || '').trim().toLowerCase();
}

const VALID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const email = readEmail(req);

  // Bad or missing email → send them to signup to fill it in themselves.
  if (!email || !VALID.test(email) || email.length > 200) {
    res.writeHead(303, { Location: '/signup' });
    res.end();
    return;
  }

  try {
    const key = 'lead:' + email;
    const fresh = await kv.set(key, JSON.stringify({
      email,
      source: 'landing',
      at: new Date().toISOString(),
    }), { nx: true });
    if (fresh) {
      await kv.incr('stats:leads');
      await kv.lpush('leads:list', email);
      await notifyBestEffort({ title: 'New qualified website lead', message: `${email} entered their email and continued to signup.`, priority: 'high', tags: 'dart,email', click: 'https://nitrooutreach.com/dashboard' });
    }
  } catch (e) {
    // Capture is best-effort — never block the visitor on a storage hiccup.
    console.error('lead capture error:', e && e.message);
  }

  res.writeHead(303, { Location: '/signup?email=' + encodeURIComponent(email) });
  res.end();
}
