import { currentCustomer, requestOrigin, sameOrigin } from '../lib/customer-auth.js';
import { createContentCreditCheckoutSession, stripeConfigured } from '../lib/stripe.js';
import { contentCreditBalance } from '../lib/content-credits.js';

const PACKS = {
  starter: { id: 'starter', credits: 25, amountCents: 499, label: '25 Content credits' },
  creator: { id: 'creator', credits: 75, amountCents: 1199, label: '75 Content credits' },
  studio: { id: 'studio', credits: 250, amountCents: 3499, label: '250 Content credits' },
  growth: { id: 'growth', credits: 500, amountCents: 6499, label: '500 Content credits' },
  scale: { id: 'scale', credits: 1000, amountCents: 11999, label: '1,000 Content credits' },
  agency: { id: 'agency', credits: 2500, amountCents: 24999, label: '2,500 Content credits' },
};
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'nitrooutreach@outlook.com').toLowerCase();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  if (req.method === 'GET') {
    res.status(200).json({
      balance: contentCreditBalance(user),
      packs: Object.values(PACKS),
      configured: stripeConfigured(),
    });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  if (String(user.email || '').toLowerCase() === OWNER_EMAIL) {
    res.status(403).json({ error: 'Your owner account has unlimited Content Studio usage and does not need credits.' }); return;
  }
  if (!stripeConfigured()) { res.status(503).json({ error: 'Content credit checkout is not configured yet.' }); return; }

  const pack = PACKS[String(req.body?.pack || '').toLowerCase()];
  if (!pack) { res.status(400).json({ error: 'Choose a valid Content credit pack.' }); return; }
  const returnTo = req.body?.returnTo === 'billing' ? 'billing' : 'content';
  const origin = requestOrigin(req);
  try {
    const url = await createContentCreditCheckoutSession({
      customerId: user.id,
      email: user.email,
      stripeCustomerId: user.subscription?.stripeCustomerId || null,
      credits: pack.credits,
      amountCents: pack.amountCents,
      successUrl: `${origin}/app?contentCredits=success#${returnTo}`,
      cancelUrl: `${origin}/app#${returnTo}`,
    });
    res.status(200).json({ url });
  } catch (error) {
    console.error('Content credit checkout error:', error.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
}
