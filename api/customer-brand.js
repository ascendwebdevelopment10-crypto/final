import { currentCustomer, sameOrigin, saveCustomer } from '../lib/customer-auth.js';

function hex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : null; }

// Save a customer's brand colors (used to theme their workspace).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }

  const primary = hex(req.body && req.body.primaryColor);
  const secondary = hex(req.body && req.body.secondaryColor);
  if (!primary || !secondary) { res.status(400).json({ error: 'Enter valid colors.' }); return; }

  user.onboarding = user.onboarding || {};
  user.onboarding.data = user.onboarding.data || {};
  user.onboarding.data.primaryColor = primary;
  user.onboarding.data.secondaryColor = secondary;
  try {
    await saveCustomer(user);
    res.status(200).json({ ok: true, primaryColor: primary, secondaryColor: secondary });
  } catch (e) {
    res.status(500).json({ error: 'Could not save colors.' });
  }
}
