import { currentCustomer, requestOrigin, sameOrigin } from '../lib/customer-auth.js';
import { createVideoCreditCheckoutSession, stripeConfigured } from '../lib/stripe.js';

const PACKS = {
  starter: { id: 'starter', credits: 5, amountCents: 499, label: '5 Reel credits' },
  creator: { id: 'creator', credits: 15, amountCents: 1199, label: '15 Reel credits' },
  studio: { id: 'studio', credits: 50, amountCents: 3499, label: '50 Reel credits' },
  growth: { id: 'growth', credits: 100, amountCents: 6499, label: '100 Reel credits' },
  scale: { id: 'scale', credits: 200, amountCents: 11999, label: '200 Reel credits' },
  agency: { id: 'agency', credits: 500, amountCents: 24999, label: '500 Reel credits' },
};
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  if (req.method === 'GET') {
    res.status(200).json({
      balance: Number(user.usage?.videoCredits || 0),
      packs: Object.values(PACKS),
      configured: stripeConfigured(),
    });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  if (String(user.email || '').toLowerCase() === OWNER_EMAIL) {
    res.status(403).json({ error: 'Your owner account already has unlimited Reel rendering and does not need credits.' }); return;
  }
  if (!stripeConfigured()) { res.status(503).json({ error: 'Video credit checkout is not configured yet.' }); return; }

  const pack = PACKS[String(req.body?.pack || '').toLowerCase()];
  if (!pack) { res.status(400).json({ error: 'Choose a valid video credit pack.' }); return; }
  const returnTo = req.body?.returnTo === 'billing' ? 'billing' : 'content';
  const origin = requestOrigin(req);
  try {
    const url = await createVideoCreditCheckoutSession({
      customerId: user.id,
      email: user.email,
      stripeCustomerId: user.subscription?.stripeCustomerId || null,
      credits: pack.credits,
      amountCents: pack.amountCents,
      successUrl: `${origin}/app?videoCredits=success#${returnTo}`,
      cancelUrl: `${origin}/app#${returnTo}`,
    });
    res.status(200).json({ url });
  } catch (error) {
    console.error('Video credit checkout error:', error.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
}
